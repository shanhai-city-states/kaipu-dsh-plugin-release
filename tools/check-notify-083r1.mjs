#!/usr/bin/env node
/**
 * 083-r1（dispatch-083-r1-notify · 派活可点名 Agent）· 前端判据
 * =====================================================================
 * 任务 1 · 「顺手通知谁」：纯逻辑直接 import 编译产物喂输入看输出
 * 任务 2 · 卡片人数显示：`＋N` 徽标 + 「有人但读不到是谁」
 *
 * 写法沿用 check-join-083/083b（星月 R-6）：**不对源码 grep 关键词**，
 * 而是把判断函数当黑盒跑输入→输出；接线层面再查源码文本，且先剥注释、先解 \uXXXX。
 * 每条判据都配一条反向对照 —— 全绿不算证据，能变红才算。
 *
 * 跑法：node tools/build.mjs && node tools/check-notify-083r1.mjs（期望退出码 0）
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const WS = join(ROOT, 'packages/plugin-workstation')
const SRC_PANEL = join(WS, 'src/client/WorkstationPanel.tsx')
const SRC_COPY = join(WS, 'src/client/notify-copy.ts')
const SRC_LIVE = join(WS, 'src/client/live.ts')
const SRC_SERVICE = join(WS, 'src/remote/service.ts')
const LIB_COPY = join(WS, 'lib/client/notify-copy.js')
const LIB_BUNDLE = join(WS, 'lib/client.js')

let pass = 0
let fail = 0
function check(id, title, ok, detail) {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '✓' : '✗'} ${id} ${title}${detail === undefined ? '' : `\n    ${detail}`}`)
}
function decodeEscapes(t) {
  return t.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
}
function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

for (const f of [SRC_PANEL, SRC_COPY, SRC_LIVE, SRC_SERVICE, LIB_COPY, LIB_BUNDLE]) {
  if (!existsSync(f)) {
    console.error(`缺文件：${f}\n（先跑 node tools/build.mjs）`)
    process.exit(2)
  }
}

/* lib/client/*.js 是 tsc 的 CommonJS 产物，仓是 "type":"module" ⇒ 直接用壳跑 */
const mod = (() => {
  const code = readFileSync(LIB_COPY, 'utf8')
  const shell = { exports: {} }
  const fn = new Function('exports', 'module', 'require', code)
  fn(shell.exports, shell, () => { throw new Error('notify-copy 不该 require 任何东西') })
  return shell.exports
})()
const {
  agentChoices,
  extraHolderBadge,
  extraHolderTitle,
  holderUnknownText,
  isNotifyUnsupported,
  notifyFailText,
  notifyPickHint,
  NOTIFY_PUBLIC_VALUE,
  NOTIFY_PUBLIC_LABEL,
  NOTIFY_DEGRADED_NOTICE,
} = mod

const panelAll = stripComments(readFileSync(SRC_PANEL, 'utf8'))
const copySrc = stripComments(readFileSync(SRC_COPY, 'utf8'))
const liveSrc = stripComments(readFileSync(SRC_LIVE, 'utf8'))
const serviceSrc = stripComments(readFileSync(SRC_SERVICE, 'utf8'))
const libText = decodeEscapes(readFileSync(LIB_BUNDLE, 'utf8'))
/* 判据范围收到 TaskSection 与 OrgNodeCard 两段（本文件别处也有 setNotice/select，
   全文件断言会把无关代码算进来 —— 083b 第一版就栽在范围上） */
const taskStart = panelAll.indexOf('function TaskSection(')
const orgStart = panelAll.indexOf('function OrgNodeCard(')
const orgEnd = panelAll.indexOf('\nfunction ', orgStart + 10)
const taskCode = taskStart >= 0 ? panelAll.slice(taskStart) : ''
const orgCode = orgStart >= 0 && orgEnd > orgStart ? panelAll.slice(orgStart, orgEnd) : ''

console.log('── A · 名单来源与默认值（agentChoices）──')

/* A-1 基本筛选：只出 agent，不出人 */
{
  const members = [
    { id: 'a1', name: '阿舟', kind: 'agent', membershipActive: true },
    { id: 'h1', name: '阿开', kind: 'human', membershipActive: true },
    { id: 'a2', name: '星月', kind: 'agent', membershipActive: true },
  ]
  const got = agentChoices(members)
  check('A-1', '只把 kind=agent 的列进下拉（人不进）',
    got.length === 2 && got.every((x) => x.id !== 'h1'),
    `得到 ${JSON.stringify(got)}`)
}

/* A-2 反向对照：如果不过滤 kind，就会把人也列进来 —— 证明 A-1 不是必然通过 */
{
  const members = [{ id: 'h1', name: '阿开', kind: 'human', membershipActive: true }]
  check('A-2', '反向对照：只有人时下拉为空',
    agentChoices(members).length === 0,
    `得到 ${JSON.stringify(agentChoices(members))}（应 []）`)
}

/* A-3 离场（membershipActive=false）不列；离座（presence=away）照列 */
{
  const members = [
    { id: 'gone', name: '已离场', kind: 'agent', membershipActive: false },
    { id: 'away', name: '离座中', kind: 'agent', membershipActive: true, presence: 'away' },
  ]
  const got = agentChoices(members)
  check('A-3', '离场的不列、离座的照列（离座≠离场）',
    got.length === 1 && got[0].id === 'away',
    `得到 ${JSON.stringify(got)}`)
}

/* A-4 老数据没 membershipActive 字段 ⇒ 按在编处理（不许凭空把人藏了） */
{
  const got = agentChoices([{ id: 'old', name: '老数据', kind: 'agent' }])
  check('A-4', '缺 membershipActive 的老数据仍然列出（不藏人）',
    got.length === 1 && got[0].id === 'old',
    `得到 ${JSON.stringify(got)}`)
}

/* A-5 同 id 去重；空 id 丢弃 */
{
  const got = agentChoices([
    { id: 'dup', name: 'A', kind: 'agent', membershipActive: true },
    { id: 'dup', name: 'A 副本', kind: 'agent', membershipActive: true },
    { id: '   ', name: '空 id', kind: 'agent', membershipActive: true },
  ])
  check('A-5', '按 id 去重（名字可重、id 不会）+ 空 id 不列',
    got.length === 1 && got[0].id === 'dup',
    `得到 ${JSON.stringify(got)}`)
}

/* A-6 无名字时退回 id（不许出现空选项） */
{
  const got = agentChoices([{ id: 'x9', name: '  ', kind: 'agent', membershipActive: true }])
  check('A-6', '没名字时用 id 兜底，不出空选项',
    got.length === 1 && got[0].name === 'x9',
    `得到 ${JSON.stringify(got)}`)
}

/* A-7 默认值必须是空串（硬约束 4：默认不点名） */
check('A-7', '默认值 = 空串（谁在岗谁领），不是第一个 Agent',
  NOTIFY_PUBLIC_VALUE === '' && /谁在岗谁领/.test(NOTIFY_PUBLIC_LABEL),
  `NOTIFY_PUBLIC_VALUE=${JSON.stringify(NOTIFY_PUBLIC_VALUE)} label=${NOTIFY_PUBLIC_LABEL}`)

/* A-8 选了人对提示 / 没选对提示，两句话必须不同（不能一句 catch-all） */
{
  const a = notifyPickHint(null)
  const b = notifyPickHint({ id: 'a1', name: '阿舟' })
  check('A-8', '未选/已选 的提示文案不同，且已选含该人名',
    a !== b && b.includes('阿舟'),
    `未选="${a}"\n    已选="${b}"`)
}

console.log('── B · 失败文案（notifyFailText，AC-3）──')

/* B-1 agent_not_found 必须说人话，且不上屏码 */
{
  const t = notifyFailText('agent_not_found', 'agent_not_found: 404')
  check('B-1', 'agent_not_found → 人话，且不含内部码',
    /不在这个铺子里/.test(t) && !t.includes('agent_not_found') && !/404/.test(t),
    `"${t}"`)
}

/* B-2 反向对照：任意码都给同一句 catch-all 必须被抓到 */
{
  const a = notifyFailText('agent_not_found', 'x')
  const b = notifyFailText('some_other_code', 'y')
  check('B-2', '反向对照：不同错误码不能给同一句 catch-all',
    a !== b,
    `agent_not_found="${a}"\n    其他="${b}"`)
}

/* B-3 未知码保留服务端原文（带线索），不覆盖成空话 */
{
  const t = notifyFailText('weird_code', '服务端说：项目已归档')
  check('B-3', '未知错误码保留服务端原文（不吞线索）',
    t === '服务端说：项目已归档',
    `"${t}"`)
}

/* B-4 后端还没上线该字段时的识别：必须 code 与字段名同时对上 */
{
  check('B-4', 'unknown_field + notifyAgent → 判定为「能力未上线」',
    isNotifyUnsupported('unknown_field', "不认识的字段：['notifyAgent']") === true,
    '')
  check('B-5', '反向对照：unknown_field 但字段是别的 → **不能**当成通知未上线',
    isNotifyUnsupported('unknown_field', "不认识的字段：['kind']") === false,
    '（否则别的字段写错会被静默降级，把真 bug 藏了）')
  check('B-6', '反向对照：只是别的 400 码 → 不算未上线',
    isNotifyUnsupported('bad_request', 'notifyAgent 不合法') === false,
    '')
}

/* B-7 降级提示必须说明「其实没点名」 */
check('B-7', '降级提示说清「按公池发」+「服务端还没开通」',
  /谁在岗谁领|公池/.test(NOTIFY_DEGRADED_NOTICE) && /还没/.test(NOTIFY_DEGRADED_NOTICE),
  `"${NOTIFY_DEGRADED_NOTICE}"`)

console.log('── C · 接线（notifyAgent 一路传到 POST /tasks）──')

/* C-1 live.createTask 有第 6 参，并往下传 */
check('C-1', 'createTask 接受第 6 参 notifyAgent 并放进 query',
  /notifyAgent\?: string/.test(liveSrc) && /query\.notifyAgent = notifyAgent/.test(liveSrc),
  `签名有=${/notifyAgent\?: string/.test(liveSrc)} · 赋值有=${/query\.notifyAgent = notifyAgent/.test(liveSrc)}`)

/* C-2 service 把 notifyAgent 放进 body（camelCase） */
check('C-2', 'tasksCreate 把 notifyAgent 放进请求体（camelCase）',
  /body\.notifyAgent = query\.notifyAgent/.test(serviceSrc),
  `命中=${/body\.notifyAgent = query\.notifyAgent/.test(serviceSrc)}`)

/* C-3 反向对照：**不许**发 snake_case —— 实测被服务端 unknown_field 硬拒 */
check('C-3', '反向对照：请求体不出现 notify_agent（实测会被 400 unknown_field）',
  !/body\.notify_agent/.test(serviceSrc) && !/body\[['"]notify_agent['"]\]/.test(serviceSrc),
  `命中 snake 赋值=${/body\.notify_agent/.test(serviceSrc)}（应 false）`)

/* C-4 空值不发（默认不点名 = 请求里根本没有这个键） */
check('C-4', '空串/未选时不发该字段（存量调用零影响）',
  /if \(typeof notifyAgent === 'string' && notifyAgent\.length > 0\)/.test(liveSrc) &&
  /if \(typeof query\.notifyAgent === 'string' && query\.notifyAgent\.length > 0\)/.test(serviceSrc),
  `live 判空=${/notifyAgent\.length > 0/.test(liveSrc)} · service 判空=${/query\.notifyAgent\.length > 0/.test(serviceSrc)}`)

/* C-5 签名域不许被动：createTask 的第 6 参不进 `POST /agent/tasks` 的签名串 */
check('C-5', '不碰签名域（本字段只走铺主 Bearer 的 POST /tasks）',
  !/agent_id.*notifyAgent|notifyAgent.*isDestructive/.test(serviceSrc + liveSrc),
  '（签名仍是 agent_id|ts|title|isDestructive）')

/* C-6 UI 真的把选中的 id 传下去了 */
/* ★ 判据自身修正：第一版写 `createTask\([^)]*notifyId`，被 `detail.trim()` 那个
   右括号截断 ⇒ 假红。参数里有嵌套括号，必须用非贪婪跨字符而不是排除 `)`。 */
check('C-6', '表单把 notifyId 传给 createTask（不是只做了个下拉）',
  /createTask\([\s\S]{0,240}?notifyId \|\| undefined/.test(taskCode),
  `命中=${/createTask\([\s\S]{0,240}?notifyId \|\| undefined/.test(taskCode)}（083-r3 把调用改成多行，锚点随结构放宽）`)

/* C-7 降级重发时**不带** notifyAgent（否则必然再 400 一次） */
{
  const m = taskCode.match(/if \(!r\.ok && notifyId\.length > 0 && isNotifyUnsupported[\s\S]{0,400}?\n      \}/)
  const block = m === null ? '' : m[0]
  /* ★ 083-r3 起调用是多行，且末尾多了 nodeId 参数（工位要保留）——
     断言改成「这一段里 createTask 的参数不含 notifyId」，仍锁住本意：
     降级那次**不能**再带 notifyAgent，否则必然再 400 一次。 */
  const call = block.match(/createTask\([\s\S]{0,240}?\)/)
  const callText = call === null ? '' : call[0]
  check('C-7', '降级重发那次调用不带 notifyAgent（工位参数要保留）',
    block.length > 0 && callText.length > 0 && !callText.includes('notifyId'),
    block.length === 0 ? '没找到降级分支' : `降级调用=${callText.replace(/\s+/g, ' ').slice(0, 140)}`)
}

/* C-8 名单读不到 ⇒ 整行不渲染（不给空下拉假信号） */
check('C-8', '名单读不到时整行不渲染（agentOpts===null 才渲染）',
  /agentOpts !== null \?/.test(taskCode) && /setAgentOpts\(agentChoices/.test(taskCode),
  `条件=${/agentOpts !== null \?/.test(taskCode)}`)

/* C-9 产物里真的有这段（防「改了源码没跑 build」） */
check('C-9', '产物 client.js 含 notifyAgent（证明 build 吃到改动）',
  libText.includes('notifyAgent'),
  `命中=${libText.includes('notifyAgent')}`)

console.log('── D · 任务 2 · 卡片人数 ──')

/* D-1 1 人不显示徽标 */
check('D-1', '只有 1 个人时不出徽标',
  extraHolderBadge(1) === '' && extraHolderTitle(1) === '',
  `extraHolderBadge(1)=${JSON.stringify(extraHolderBadge(1))}`)

/* D-2 2 人 → ＋1（额外人数，不是总数） */
check('D-2', '2 人 → ＋1（报「多出来的」，不是「总共」）',
  extraHolderBadge(2) === '＋1' && extraHolderTitle(2).includes('1'),
  `badge=${JSON.stringify(extraHolderBadge(2))} title="${extraHolderTitle(2)}"`)

/* D-3 3 人 → ＋2；边界 0 人不出 */
check('D-3', '3 人 → ＋2；0 人不出徽标；非法值不抛',
  extraHolderBadge(3) === '＋2' && extraHolderBadge(0) === '' && extraHolderBadge(NaN) === '',
  `3→${extraHolderBadge(3)} · 0→"${extraHolderBadge(0)}" · NaN→"${extraHolderBadge(NaN)}"`)

/* D-4 「有人但读不到是谁」：只有 席位>0 且 名单空 才出 */
check('D-4', '席位被占但名单空 → 提示「有人，但读不到是谁」',
  holderUnknownText(0, 2) === '有人，但读不到是谁',
  `holderUnknownText(0,2)="${holderUnknownText(0, 2)}"`)
check('D-5', '反向对照：空位（席位=0）与有名有姓时都不出该提示',
  holderUnknownText(0, 0) === '' && holderUnknownText(2, 1) === '',
  `空位="${holderUnknownText(0, 0)}" · 有人="${holderUnknownText(2, 1)}"`)

/* D-6 卡片真的用了这两个函数（否则纯函数写得再对也没接线） */
/* ★ 2026-10-26：判据不能锚死参数表 —— holderUnknownText 加了第三个参数
   （seatVacantish，修「有人但读不到」假阳性），死锚 `node.seat_count` 就假红。
   判据该管的是「**用了这个函数、且拿 holders 的条数当第 1 参数**」。 */
const d6Unknown = /holderUnknownText\(\s*holders\.length\s*,/.test(orgCode)
check('D-6', 'OrgNodeCard 接线：用 extraHolderBadge 与 holderUnknownText',
  /extraHolderBadge\(holders\.length\)/.test(orgCode) && d6Unknown,
  `badge=${/extraHolderBadge\(holders\.length\)/.test(orgCode)} · unknown=${d6Unknown}`)

/* D-7 反向对照：旧的「等 N 人」必须已经不在渲染里 */
check('D-7', '反向对照：旧的「等 N 人」已撤（不再随名字一起被挤掉）',
  !/等 \{holders\.length\} 人/.test(orgCode),
  `残留=${/等 \{holders\.length\} 人/.test(orgCode)}（应 false）`)

/* D-8 名字让位：名字 span 必须有 minWidth:0，否则徽标会被挤出可视区 */
check('D-8', '名字可收缩（minWidth:0），徽标 flex:0 0 auto 不被挤掉',
  /whiteSpace: 'nowrap', minWidth: 0 \}/.test(orgCode) && /flex: '0 0 auto',\s*\n\s*marginLeft: 2/.test(orgCode),
  `minWidth=${/whiteSpace: 'nowrap', minWidth: 0 \}/.test(orgCode)}`)

console.log('')
console.log(`${fail === 0 ? '全绿' : '有红'}：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`)
process.exit(fail === 0 ? 0 : 1)
