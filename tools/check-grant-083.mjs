#!/usr/bin/env node
/**
 * 006 打回修复单（任务 25ed5c14）· 工位两项改造判据
 * =================================================
 * 覆盖需求 A（管理助理授权码）与需求 B（任务页四段折叠）里
 * **主单 check-083.mjs 没锁住的那几条** —— 主单已覆盖：
 *   G1-1 删掉 Agent id 输入框 / G1-2 走 /grants/generate / G1-3 不露错误码
 *   G2-1 四段默认收起 / G2-2 数量徽标 / G2-3 整行可点
 * 本文件补的是：
 *   A-③ 复制「整段话」（不是只复制码）
 *   A-④ 未兑换的码能看见、能作废
 *   A-⑤ 已兑换显示名字；没填名字说「对方未填名字」；**绝不显示内部 ID**
 *   B-2  四段互不互斥（可同时展开多段）
 *   B-6  记住用户选择（卷起状态在组件 state，不是每次渲染重置）
 *
 * 写法沿用 check-join-083 / 083b / 083r1 / 083r2：
 *   纯函数当黑盒跑输入→输出；接线层先剥注释再查结构。
 *   每条关键判据都配反向对照 —— 全绿不算证据，能变红才算。
 *
 * 跑法：node tools/build.mjs && node tools/check-grant-083.mjs（期望退出码 0）
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const WS = join(ROOT, 'packages/plugin-workstation')
const SRC_PANEL = join(WS, 'src/client/WorkstationPanel.tsx')
const SRC_GRANT = join(WS, 'src/client/grant-copy.ts')
const LIB_GRANT = join(WS, 'lib/client/grant-copy.js')
const LIB_BUNDLE = join(WS, 'lib/client.js')

let pass = 0
let fail = 0

/* ★ 三参签名（id 里已写标题）。四参会把表达式喂进 title 位，
   输出「✗ … true」——看着全红、其实表达式为真（083 那边踩过）。 */
function check(id, ok, detail) {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '✓' : '✗'} ${id}${detail === undefined ? '' : `\n    ${detail}`}`)
}

function decodeEscapes(t) {
  return t.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
}
function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

for (const f of [SRC_PANEL, SRC_GRANT, LIB_GRANT, LIB_BUNDLE]) {
  if (!existsSync(f)) {
    console.error(`缺文件：${f}\n（先跑 node tools/build.mjs）`)
    process.exit(2)
  }
}

function loadMod(path) {
  const code = readFileSync(path, 'utf8')
  const shell = { exports: {} }
  const fn = new Function('exports', 'module', 'require', code)
  fn(shell.exports, shell, () => { throw new Error('纯函数模块不该 require 任何东西') })
  return shell.exports
}
const G = loadMod(LIB_GRANT)
const panel = decodeEscapes(stripComments(readFileSync(SRC_PANEL, 'utf8')))
const grant = stripComments(readFileSync(SRC_GRANT, 'utf8'))
const bundle = decodeEscapes(readFileSync(LIB_BUNDLE, 'utf8'))

/* ─────────────────────────── A 段 · 纯函数 ─────────────────────────── */

console.log('\n── A 段 · granteeLabel：已兑换显示谁 ──')

check('A-1 有名字就用名字',
  G.granteeLabel('小张', 'dev-abc') === '小张',
  `实际=${JSON.stringify(G.granteeLabel('小张', 'dev-abc'))}`)

check('A-2 没名字但有 id ⇒「对方未填名字」（不是空白）',
  G.granteeLabel('', 'dev-abc') === '对方未填名字',
  `实际=${JSON.stringify(G.granteeLabel('', 'dev-abc'))}`)

check('A-3 只填了空格也算没名字（trim 后再判）',
  G.granteeLabel('   ', 'dev-abc') === '对方未填名字',
  `实际=${JSON.stringify(G.granteeLabel('   ', 'dev-abc'))}`)

check('A-4 既没名字也没 id ⇒「未兑换」（这码压根没人换）',
  G.granteeLabel('', '') === '未兑换',
  `实际=${JSON.stringify(G.granteeLabel('', ''))}`)

check('A-5 传 null/undefined 不炸也不出 "undefined" 字样',
  G.granteeLabel(null, undefined) === '未兑换'
  && !String(G.granteeLabel(null, undefined)).includes('undefined'),
  `实际=${JSON.stringify(G.granteeLabel(null, undefined))}`)

/* ★ 这条是需求 A-⑤ 的硬线：内部 ID 绝不能上屏。
   反向对照：假如实现写成 `return name || id`，下面立刻红。 */
check('A-6 **绝不返回内部 ID**（拿 id 顶名字就是这条要挡的）',
  G.granteeLabel('', 'dev-cf78b69e0e8c') !== 'dev-cf78b69e0e8c'
  && !G.granteeLabel('', 'dev-cf78b69e0e8c').includes('dev-'),
  `实际=${JSON.stringify(G.granteeLabel('', 'dev-cf78b69e0e8c'))}`)

console.log('\n── A 段 · grantCopyText：复制的是「一整段话」 ──')

const copyText = G.grantCopyText('SHANHAI-GRANT-7K3F-9QW2', 72, '2026-10-31T18:00:00Z')
check('A-7 整段话里含码本身',
  copyText.includes('SHANHAI-GRANT-7K3F-9QW2'),
  copyText.split('\n')[0])
check('A-8 整段话里说清代管时长（72 小时）',
  copyText.includes('72 小时'),
  `实际=${JSON.stringify(copyText.split('\n')[0])}`)
check('A-9 整段话里说清码的兑换截止日（2026-10-31）',
  copyText.includes('2026-10-31'),
  `实际=${JSON.stringify(copyText.split('\n')[0])}`)
check('A-10 是**多行**的一段话（不是只有一串码）',
  copyText.split('\n').filter((x) => x.trim().length > 0).length >= 3,
  `非空行=${copyText.split('\n').filter((x) => x.trim().length > 0).length}`)
check('A-11 截止日缺失时给兜底说法，不吐 "undefined"',
  !G.grantCopyText('CODE-X', 24, '').includes('undefined')
  && G.grantCopyText('CODE-X', 24, '').includes('7 天'),
  `实际=${JSON.stringify(G.grantCopyText('CODE-X', 24, '').split('\n')[0])}`)

console.log('\n── A 段 · codeLeftText：未兑换码剩多久 ──')

const NOW = Date.parse('2026-10-24T12:00:00Z')
check('A-12 未来 3 天 ⇒「剩 3 天」',
  G.codeLeftText('2026-10-27T12:00:00Z', NOW) === '剩 3 天',
  `实际=${JSON.stringify(G.codeLeftText('2026-10-27T12:00:00Z', NOW))}`)
check('A-13 已过期 ⇒「码已过期」',
  G.codeLeftText('2026-10-20T12:00:00Z', NOW) === '码已过期',
  `实际=${JSON.stringify(G.codeLeftText('2026-10-20T12:00:00Z', NOW))}`)
check('A-14 服务端没给时间 ⇒ 不猜，说「码 7 天内有效」',
  G.codeLeftText(undefined, NOW) === '码 7 天内有效',
  `实际=${JSON.stringify(G.codeLeftText(undefined, NOW))}`)

/* ─────────────────────── B 段 · 接线（剥注释后） ─────────────────────── */

console.log('\n── B 段 · 面板接线 ──')

/* 只截 GrantSection 这一段来断言：整文件里 `g.granteeId` 出现在别处是合法的
   （比如历史判断），断言范围过大会造成假红 —— 083 那边踩过。
   ★ 结束锚点必须是**代码**（`function groupPacks`），不能用注释：
     本文件的 panel 已经过 stripComments，注释锚点必然 indexOf = -1，
     段长会变 0，后面几条全变成空跑（假绿）—— 这个坑第一次跑就踩到了。 */
const grantSecStart = panel.indexOf('function ManagementGrantSection')
const grantSecEnd = panel.indexOf('function groupPacks', grantSecStart)
const grantSec = grantSecStart >= 0 && grantSecEnd > grantSecStart
  ? panel.slice(grantSecStart, grantSecEnd) : ''

check('B-1 找到 ManagementGrantSection 段（找不到说明锚点失效，后面几条全是空跑）',
  grantSec.length > 1500,
  `段长=${grantSec.length}`)

/* ★ B-2 第一版只断言「包含」，注入把其中一处改回裸 granteeName 时另一处仍命中
   ⇒ 判据不红、注入白做。现在数次数，并用 B-3b 禁掉裸表达式。 */
check('B-2 两处显示「谁在代管」都走 granteeLabel（生效中 + 历史，少一处就有一条会留白）',
  (grantSec.match(/granteeLabel\(g\.granteeName, g\.granteeId\)/g) || []).length === 2,
  `出现次数=${(grantSec.match(/granteeLabel\(g\.granteeName, g\.granteeId\)/g) || []).length}（应=2）`)

check('B-3b 代管区**不允许出现裸 {g.granteeName}**（名字空就是一片空白）',
  !/\{g\.granteeName\}/.test(grantSec),
  `裸渲染处数=${(grantSec.match(/\{g\.granteeName\}/g) || []).length}`)

check('B-3 代管区**不把 granteeId 渲染出来**（只准当判断依据）',
  !/\{g\.granteeId\}|\{g\.granteeId\s*\|\||String\(g\.granteeId\)/.test(grantSec),
  `违规片段=${JSON.stringify((grantSec.match(/\{g\.granteeId[^}]*\}/g) || []).slice(0, 2))}`)

check('B-4 未兑换的码单独列出来（status==="available" ⇒ pending）',
  /const pending = \(rows \?\? \[\]\)\.filter\(\(x\) => x\.status === 'available'\)/.test(grantSec),
  `pending 定义命中=${/const pending = \(rows \?\? \[\]\)/.test(grantSec)}`)

check('B-5 未兑换的码上就有「作废」按钮，且接的是 onRevoke（不是摆设）',
  /作废\s*<\/button>/.test(grantSec)
  && /onClick=\{\(\) => void onRevoke\(g\.grantId\)\}/.test(grantSec),
  `作废按钮=${/作废\s*<\/button>/.test(grantSec)}，接 onRevoke=${/onRevoke\(g\.grantId\)/.test(grantSec)}`)

/* ★ 必须锚到 `const text =`：页面上另一处 <pre> 也会渲染整段话，
   只断言「出现 grantCopyText(...)」时，把 onCopy 里那句换掉仍会命中 ⇒ 假绿。 */
check('B-6 「复制」按钮复制的是那一整段话（const text = grantCopyText(...)，不是 issued.code）',
  /const text = grantCopyText\(issued\.code, issued\.ttlHours, issued\.codeExpiresAt\)/.test(grantSec),
  `命中=${/const text = grantCopyText\(issued\.code/.test(grantSec)}`)

check('B-7 剩余天数走 codeLeftText（三态集中在一处，别在 JSX 里写三元套三元）',
  grantSec.includes('codeLeftText(g.codeExpiresAt)'),
  `命中=${grantSec.includes('codeLeftText(')}`)

/* ─────────────────────── C 段 · 四段折叠（需求 B） ─────────────────────── */

console.log('\n── C 段 · 任务页四段 ──')

const secStart = panel.indexOf('const TASK_SECTIONS = [')
const secEnd = panel.indexOf('] as const', secStart) > 0
  ? panel.indexOf('] as const', secStart)
  : panel.indexOf('\n]', secStart)
const secBlock = secStart >= 0 ? panel.slice(secStart, secEnd > 0 ? secEnd : secStart + 2500) : ''

check('C-1 四段都在，且 openByDefault 全是 false（默认收起）',
  (secBlock.match(/key: '/g) || []).length === 4
  && (secBlock.match(/openByDefault: false/g) || []).length === 4
  && !secBlock.includes('openByDefault: true'),
  `段数=${(secBlock.match(/key: '/g) || []).length}，false=${(secBlock.match(/openByDefault: false/g) || []).length}`)

check('C-2 展开状态是**一张表**（openSec[key]），不是单个 key —— 否则只能开一段',
  /const \[openSec, setOpenSec\] = useState<Record<string, boolean>>\(\{\}\)/.test(panel)
  && /const open = openSec\[sec\.key\] \?\? sec\.openByDefault/.test(panel),
  `声明命中=${/useState<Record<string, boolean>>\(\{\}\)/.test(panel)}，取值命中=${/openSec\[sec\.key\]/.test(panel)}`)

check('C-3 数量徽标 = 该段**当前实际条数**（list.length，不是估算的常量）',
  /\{sec\.title\}<\/b>/.test(panel) && /\{list\.length\}/.test(panel),
  `list.length 渲染=${/\{list\.length\}/.test(panel)}`)

check('C-4 收起箭头是 ›，展开时旋转 90°（视觉上就是 ⌄）',
  panel.includes('›') && /transform: open \? 'rotate\(90deg\)' : 'none'/.test(panel),
  `旋转命中=${/rotate\(90deg\)/.test(panel)}`)

check('C-5 整行可点（button 撑满宽度 + aria-expanded 供读屏）',
  /width: '100%'/.test(panel) && /aria-expanded=\{open\}/.test(panel),
  `aria-expanded=${/aria-expanded=\{open\}/.test(panel)}`)

check('C-6 切段时**不动别的段**（setOpenSec 用展开运算符合并，不是整体覆盖）',
  /setOpenSec\(\(p\) => \(\{ \.\.\.p, \[sec\.key\]: !open \}\)\)/.test(panel),
  `命中=${/setOpenSec\(\(p\) => \(\{ \.\.\.p, \[sec\.key\]/.test(panel)}`)

/* ─────────────────────── D 段 · 反向对照 ─────────────────────── */

console.log('\n── D 段 · 反向对照（这些写法出现就是退化了） ──')

check('D-1 面板里没有「名字为空就留白」的裸渲染（旧写法 {g.granteeName} 单标签）',
  !/<span style=\{\{ fontWeight: 600 \}\}>\{g\.granteeName\}<\/span>/.test(panel),
  '旧写法已消失')

check('D-2 纯函数模块被真的打进 client 包（不是只在 src 里躺着）',
  bundle.includes('对方未填名字') && bundle.includes('SHANHAI-GRANT') === false
  || bundle.includes('对方未填名字'),
  `bundle 含「对方未填名字」=${bundle.includes('对方未填名字')}`)

check('D-3 复制文案里不含 API 路径 / 错误码（给人看的话不该出现机器词）',
  !/POST \/|GET \/|401|unauthorized/i.test(copyText),
  `实际=${JSON.stringify(copyText)}`)

check('D-4 grant-copy.ts 不 import 任何东西（纯函数才判得动）',
  !/^\s*import\s/m.test(grant),
  `import 命中=${/^\s*import\s/m.test(grant)}`)

/* ─────────────────────────── 汇总 ─────────────────────────── */

console.log(`\n${fail === 0 ? '全绿' : '有红'}：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`)
process.exit(fail === 0 ? 0 : 1)
