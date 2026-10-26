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
/* ★ E 段（2026-10-26 三定稿 · 管理助理改「指派已有 Agent」）：跨前后端两处真值 */
const SRC_SEAT_SUMMARY = join(WS, 'src/client/seat-summary.ts')
const STORE_PY = process.env.KAIPU_STORE_PY
  || '/opt/shanhai-toolkit-opensource/modules/08-workshop/kai-pu/src/store.py'

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

for (const f of [SRC_PANEL, SRC_GRANT, LIB_GRANT, LIB_BUNDLE, SRC_SEAT_SUMMARY, STORE_PY]) {
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

/* ★★ 2026-10-26 台阶④：四段形态从「竖排长条」改为「并排一行两行式」，
   C-3/C-4 原判据绑的是旧形态（{sec.title}</b> 包在 <b> 里 + › 箭头旋转），
   形态按阿开定稿变了 ⇒ 判据必须跟着改，否则它挡住的是新设计而非缺陷。
   新形态（设计图V3 §三）：段名是 <span>、指示是文字「展开 ▾ / 收起 ▴」、圆点表有无活。 */
check('C-3 数量 = 该段**当前实际条数**（list.length，不是估算的常量）',
  /* ★ 2026-10-26 台阶⑤：数据源从 `visibleTasks` 改为 `searchedTasks`
     （阿开定的搜索：任务模式跨全部项目筛选）。判据跟着实现走，不许反过来绑住实现 ——
     但仍必须验「四段各自的 list 是从**筛选后**的数据来的」，不许直接用全量 tasks。 */
  /\{list\.length\}/.test(panel) && /const list = (?:searchedTasks|visibleTasks)\.filter/.test(panel),
  `list.length 渲染=${/\{list\.length\}/.test(panel)} · 数据源=${(/const list = (searchedTasks|visibleTasks)\.filter/.exec(panel) || [])[1] || '无'}`)

check('C-4 展开指示是**文字**（展开 ▾ / 收起 ▴），不靠箭头图形',
  panel.includes("'收起 ▴' : '展开 ▾'") || panel.includes('收起 ▴') && panel.includes('展开 ▾'),
  `文字线索=${panel.includes('收起 ▴')}`)

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

/* ═════════════ E 段 · 管理助理 = 「指派已有 Agent」（2026-10-26 三定稿） ═════════════
 *
 * ★ 阿开原话：「管理助理位参考 2.84 版本的功能……当时是可以选择代理时间。
 *   **指定某个工位的 Agent 做助理**」
 *   ⇒ 首选形态是**从本铺已坐着的 Agent 里挑人**，不是发码让新人进来。
 *   ⇒ 助理位**不再占卡片**，入口搬到「工位布局」标题行右侧。
 *
 * ★ 为什么 E 段必须存在：本轮改完后我做过注入验证 —— 把标题按钮删掉、
 *   把 onAssign 改名、把助理位加回 SEAT_ORDER、把 DEFAULT_SEATS 加回助理位，
 *   **原有 8 套判据全部照绿**。判据不认这四处改动，等于这一轮没有判据。
 *   所以 E 段每条都配了反向对照（改坏必须变红）。
 */

console.log('\n── E 段 · 管理助理 = 指派已有 Agent（本轮新形态）──')

const seatSum = decodeEscapes(stripComments(readFileSync(SRC_SEAT_SUMMARY, 'utf8')))
const storePy = readFileSync(STORE_PY, 'utf8')

/* E-1 座位顺序里不再有 management_assistant（它不占格子） */
const orderBlock = (() => {
  const i = seatSum.indexOf('export const SEAT_ORDER')
  const j = seatSum.indexOf(']', i)
  return i >= 0 && j > i ? seatSum.slice(i, j) : ''
})()
check('E-1 SEAT_ORDER 里没有 management_assistant（助理不占座位卡）',
  orderBlock.length > 0 && !orderBlock.includes('management_assistant'),
  `orderBlock 含助理位=${orderBlock.includes('management_assistant')} · 长度=${orderBlock.length}`)

/* E-1b 但 SEAT_LABELS 仍保留它 —— 老数据里可能还有这个 key，删了会变成 unknown 假读数 */
check('E-1b SEAT_LABELS 仍保留 management_assistant 的中文名（老数据不落 unknown）',
  /management_assistant:\s*'管理助理位'/.test(seatSum),
  '标签保留=true')

/* E-2 审计位仍在 SEAT_ORDER（撤助理位不能连带把审计位也删了） */
check('E-2 审计位仍在 SEAT_ORDER（撤助理位不连带删审计位）',
  /'audit',\s*\n?\s*'execution'/.test(orderBlock) || orderBlock.includes("'audit'"),
  `含 audit=${orderBlock.includes("'audit'")} · 含 execution=${orderBlock.includes("'execution'")}`)

/* E-3 标题行有助理入口按钮，且它的开关是 grantOpen（不是 showJoin / inviting） */
check('E-3 「工位布局」标题行有管理助理入口（👑 管理助理）',
  panel.includes('👑 管理助理') && /setGrantOpen\(\(v\) => !v\)/.test(panel),
  `含按钮=${panel.includes('👑 管理助理')} · 含 setGrantOpen 切换=${/setGrantOpen\(\(v\) => !v\)/.test(panel)}`)

/* E-4 入口挂在 OrgSection（工位布局）里，不是挂在别处 */
const orgStart = panel.indexOf('function OrgSection')
const orgEnd = panel.indexOf('function OrgNodeCard', orgStart)
const orgBody = orgStart >= 0 && orgEnd > orgStart ? panel.slice(orgStart, orgEnd) : ''
check('E-4 助理入口与展开区都在 OrgSection 体内（就在工位布局标题下）',
  orgBody.includes('👑 管理助理') && orgBody.includes('<ManagementGrantSection embedded />'),
  `入口在=${orgBody.includes('👑 管理助理')} · 组件在=${orgBody.includes('<ManagementGrantSection embedded />')}`)

/* E-5 指派走 grantCreate（直传 granteeId），不是 grantGenerate（发码）
 *
 * ★★ 注入验证逼出来的修正：初版只查「grantCreate 在不在这一节里」——
 *    我把 `onAssign` 改名（等于指派按钮点了没反应）它照样绿。
 *    原因：`grantCreate` 这串字符在文件里出现了，**不管有没有被调用**。
 *    ⇒ 改成查**调用链完整**：定义存在 + 按钮 onClick 绑的是它。
 *    （这是「字符串在文件里出现 ≠ 功能还在」的第二次踩坑，记在这儿。） */
const grantSecBody = panel.slice(
  panel.indexOf('function ManagementGrantSection'),
  panel.indexOf('function groupPacks', panel.indexOf('function ManagementGrantSection')))
const hasOnAssignDef = /const onAssign\s*=\s*async/.test(grantSecBody)
const assignBtnBinds = /onClick=\{\(\) => void onAssign\(\)\}/.test(grantSecBody)
const callsGrantCreate = /callPack<[^>]*>\('grantCreate'/.test(grantSecBody)
check('E-5 指派走 grantCreate 且调用链完整（定义 + 按钮绑定 + 真调用）',
  hasOnAssignDef && assignBtnBinds && callsGrantCreate,
  `定义=${hasOnAssignDef} · 按钮绑定=${assignBtnBinds} · 调 grantCreate=${callsGrantCreate}`)

/* E-6 指派必须带 granteeId + ttlHours（缺一个后端就 400） */
check('E-6 指派请求体含 granteeId 与 ttlHours',
  /granteeId:\s*pickAgent/.test(grantSecBody) && /ttlHours:\s*ttl\b/.test(grantSecBody),
  `granteeId=${/granteeId:\s*pickAgent/.test(grantSecBody)} · ttlHours=${/ttlHours:\s*ttl\b/.test(grantSecBody)}`)

/* E-7 候选人来自 occupants（真实在场者），不是 holder.name（位属于谁） */
check('E-7 候选人取自 occupants（真实在场），且真的灌进 seatAgents',
  /\.occupants/.test(grantSecBody) && !/holder\.name/.test(grantSecBody)
  && /setSeatAgents\(out\)/.test(grantSecBody),
  `occupants=${/\.occupants/.test(grantSecBody)} · 误用 holder.name=${/holder\.name/.test(grantSecBody)} · setSeatAgents=${/setSeatAgents\(out\)/.test(grantSecBody)}`)

/* E-8 发码形态保留为兜底（对方还没进铺时才用得上） */
check('E-8 发码（grantGenerate）保留为兜底路径',
  /callPack<[^>]*>\('grantGenerate'/.test(grantSecBody),
  `grantGenerate 命中=${/callPack<[^>]*>\('grantGenerate'/.test(grantSecBody)}`)

/* E-9 后端 DEFAULT_SEATS 不再定义管理助理位 */
const defSeats = (() => {
  const i = storePy.indexOf('DEFAULT_SEATS = [')
  const j = storePy.indexOf(']', i)
  return i >= 0 && j > i ? storePy.slice(i, j) : ''
})()
check('E-9 后端 DEFAULT_SEATS 不再定义 management_assistant',
  defSeats.length > 0 && !defSeats.includes('"management_assistant"'),
  `含助理位=${defSeats.includes('"management_assistant"')} · 座位线条数=${(defSeats.match(/^\s+\("/gm) || []).length}`)

/* E-10 后端仍保留 6→5 位的重排：reconcile 里有「清理不在 DEFAULT_SEATS 的系统位」 */
check('E-10 reconcile_org_seats 会清掉已移除的系统位（否则存量铺子永远残留助理卡）',
  /keep_seats\s*=\s*\{[^}]*DEFAULT_SEATS/.test(storePy) && /archived_at=\?/.test(storePy) &&
  /st_seat in keep_seats/.test(storePy),
  `keep_seats=${/keep_seats\s*=\s*\{[^}]*DEFAULT_SEATS/.test(storePy)} · 归档=${/archived_at=\?/.test(storePy)}`)

/* E-11 清理必须保护「有人的位」（不能把在场 Agent 连人带位抹掉） */
check('E-11 清理跳过有 enabled agent 的位（不误删活人）',
  /status='enabled'\s+LIMIT 1/.test(storePy) && /kept_busy/.test(storePy),
  `查 enabled=${/status='enabled'\s+LIMIT 1/.test(storePy)} · kept_busy=${/kept_busy/.test(storePy)}`)

/* E-12 产物里真的含助理入口（防「漏跑 build 打旧包」） */
check('E-12 产物 bundle 含「👑 管理助理」（build 吃到改动）',
  bundle.includes('👑 管理助理'),
  `bundle 含=${bundle.includes('👑 管理助理')} · 大小=${(bundle.length / 1024).toFixed(1)}KB`)

/* ─────────────────────────── 汇总 ─────────────────────────── */

console.log(`\n${fail === 0 ? '全绿' : '有红'}：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`)
process.exit(fail === 0 ? 0 : 1)
