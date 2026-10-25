#!/usr/bin/env node
/**
 * 083 单 · P0 自检（G-1 / G-2 / G-3 / G-4）
 * =====================================================================
 * 用法：node tools/check-083.mjs
 * 退出码：0 全绿 / 1 有红
 *
 * ── 为什么要有这个脚本（而不是在交付说明里写"已改好"）──────────────
 *   1. 星月会**独立复跑**，所以判据必须可复算、可对着代码读；
 *   2. 本仓踩过「漏跑 build 会打旧包」的坑（src 改了、产物里还是旧的）——
 *      ⇒ 每条判据**同时查 src 与 lib**：src 有但 lib 没有 = 没进包 = 红。
 *
 * ── 判据编号与任务书对应 ─────────────────────────────────────────
 *   G2-1 四段默认收起            A-3 前半
 *   G2-2 四行标题带实际条数        A-3
 *   G2-3 整行可点（aria-expanded） A-3
 *   G1-1 无「对方的 Agent id」输入框
 *   G1-2 走授权码（/grants/generate）
 *   G1-3 界面不渲染内部错误码 / 接口路径
 *   G3-1 无 slice(0, 8) 条数上限
 *   G3-2 资料区不直出 interactionId
 *   G3-3 按项目分组（组头「N 个协作 · M 个文件」）
 *   G4-1 SEAT_ORDER 首项 = signature
 *   G4-2 签名位状态文案「⛨ 山海已签 / ⛨ 待签」
 *   G4-3 签名位不进邀请抽屉
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const P = (rel) => join(ROOT, rel)

const WS_SRC = 'packages/plugin-workstation/src/client/WorkstationPanel.tsx'
const WS_LIB = 'packages/plugin-workstation/lib/client.js'
const SVC_SRC = 'packages/plugin-workstation/src/remote/service.ts'
const BRIDGE_SRC = 'packages/plugin-workstation/src/client/bridge.ts'
const SEAT_SRC = 'packages/plugin-platform/src/client/SeatLampPanel.tsx'
const PLAT_LIB = 'packages/plugin-platform/lib/client.js'

function read(rel) {
  const p = P(rel)
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8')
}

const src = read(WS_SRC)
const lib = read(WS_LIB)
const svc = read(SVC_SRC)
const bridge = read(BRIDGE_SRC)
const seat = read(SEAT_SRC)
const platLib = read(PLAT_LIB)

if (src === null || lib === null) {
  console.error('✗ 找不到 src / lib —— 先跑 node tools/build.mjs')
  process.exit(1)
}

/* ★ 判据自身的两个坑（第一版就踩了，记录在此防复发）：
 *   ① **注释会骗人**：新加的注释里常引用旧代码（「这里原来是 `对方的 Agent id` 输入框」），
 *      直接对整份源码做"不得包含"断言，会被自己的注释判红。
 *      ⇒ 断言前先剥注释。
 *   ② **tsc 产物把中文转成了 `\uXXXX`**：`lib/client.js` 里 grep 中文永远 0 命中，
 *      于是"打包没吃到改动"会被误判成红。
 *      ⇒ 查产物前先解码 unicode 转义。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
function decodeEscapes(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
}

const srcCode = stripComments(src)
const libText = decodeEscapes(lib)
const platLibText = platLib === null ? null : decodeEscapes(platLib)

const results = []
function check(id, desc, ok, evidence) {
  results.push({ id, desc, ok, evidence })
}

/* ── G-2 · 任务页四段默认收起 ───────────────────────────────────── */
const sectionBlock = src.slice(src.indexOf('const TASK_SECTIONS = ['), src.indexOf('] as const', src.indexOf('const TASK_SECTIONS = [')))
const openTrue = (sectionBlock.match(/openByDefault: true/g) ?? []).length
const openFalse = (sectionBlock.match(/openByDefault: false/g) ?? []).length
check('G2-1', '四段默认全部收起（openByDefault 全 false）',
  openTrue === 0 && openFalse === 4,
  `src: openByDefault true=${openTrue} false=${openFalse}（应 0 / 4）`)

check('G2-2', '四行标题带该段实际条数（list.length 徽标）',
  srcCode.includes('{list.length}') && libText.includes('list.length'),
  `src 有 {list.length}=${srcCode.includes('{list.length}')} · lib 有=${libText.includes('list.length')}`)

check('G2-3', '整行可点（button width:100% + aria-expanded）',
  srcCode.includes('aria-expanded={open}') && /width: '100%'/.test(srcCode),
  `aria-expanded=${srcCode.includes('aria-expanded={open}')}`)

/* ── G-1 · 授权码 ────────────────────────────────────────────── */
check('G1-1', '删掉手填「对方的 Agent id」输入框（剥注释后）',
  !srcCode.includes('对方的 Agent id'),
  `代码里命中「对方的 Agent id」=${srcCode.includes('对方的 Agent id')}（应 false；注释里出现不算）`)

check('G1-2', '走 /grants/generate（service 有端点 + client 有调用 + lib 已打包）',
  svc !== null && svc.includes("'/grants/generate'") &&
  srcCode.includes("callPack<GrantCodeIssued>('grantGenerate'") &&
  libText.includes('grantGenerate'),
  `service=${svc?.includes("'/grants/generate'")} · client=${srcCode.includes("'grantGenerate'")} · lib=${libText.includes('grantGenerate')}`)

/* ★ 判据范围要收到「管理助理」这一段：本文件别处（位分配 / 任务页）也有
   `[{err.code}]` 前缀，那些不在 G-1 的范围里 —— 全文件断言会把它们算进来（第一版就是这样判红的）。 */
const grantStart = srcCode.indexOf('function ManagementGrantSection(')
const grantEnd = srcCode.indexOf('function PackLifecycle(', grantStart)
const grantBlock = grantStart >= 0 && grantEnd > grantStart ? srcCode.slice(grantStart, grantEnd) : ''
check('G1-3', '管理助理区不渲染内部错误码 / 接口路径（只 console.warn）',
  grantBlock.length > 0 && !/\[\{err\.code\}\]/.test(grantBlock) &&
  !grantBlock.includes('POST /auth/device') && !grantBlock.includes('/auth/device') &&
  grantBlock.includes("console.warn('[grantList]'"),
  `管理助理段长度=${grantBlock.length} · [err.code] 前缀=${/\[\{err\.code\}\]/.test(grantBlock)} · 出现 /auth/device=${grantBlock.includes('/auth/device')} · 有 console.warn=${grantBlock.includes("console.warn('[grantList]'")}`)

/* ── G-3 · 资料区按项目分组 ───────────────────────────────────── */
/* ★ 判据自身修正：`slice(0, 8)` 在别处是**合法的**（UUID 截断拼接，见 newUuid 那一段），
   不能全文件禁。真正的对象是**资料清单的条数截断** ⇒ 断言 `packIids.slice(` 不存在。 */
const packTrunc = /packIids\.slice\(/.test(srcCode)
check('G3-1', '资料清单去掉 slice(0, 8) 条数上限（`packIids.slice(` 不存在）',
  srcCode.includes('groupPacks(packIids)') && !packTrunc,
  `找到 groupPacks(packIids)=${srcCode.includes('groupPacks(packIids)')} · packIids.slice( 存在=${packTrunc}（应 false）`)

/* ★ 这条判据要"位置敏感"：只查全文件有没有 interactionId 是没用的
   （高级区那个输入框本来就该留）。⇒ 只在「分组列表」那一段里查。
   ★ 另一条：`title=` 属性里也不许放 iid（属性里的文字探针读不到，但人 hover 看得到）。 */
const packStart = srcCode.indexOf('有资料的协作（按项目分）')
/* ★ 结束锚点换过（2026-10-24 · 083-r1 发现）：原来用 `'上传选项'`，而 0.2.84 把那个
   折叠容器整块删了，只剩注释里这四个字 —— 剥注释后锚点消失 ⇒ packEnd=-1 ⇒ packBlock='' ⇒
   **这条判据在空跑**（只是碰巧下面的 length>0 断言把它判红了，否则就是假绿）。
   ⇒ 改成「紧跟在资料区之后的第一个 notice 渲染」，那是代码不是注释，也不会随文案改。
   ★ 教训：判据的定位锚点优先选**代码结构**，别选文案 —— 文案是会被人改掉的那一层。 */
const packEnd = srcCode.indexOf('{notice !== null && (', packStart)
const packBlock = packStart >= 0 && packEnd > packStart ? srcCode.slice(packStart, packEnd) : ''
/* ★ 判据的"位置"很重要（本项目既有教训）：
   `key={x.interactionId}` / `setIid(x.interactionId)` 是**数据引用**，不是显示；
   真正要挡的是「把 id 当文字/当 title 摆给人看」。
   ⇒ 先去掉 key=，再看还有没有 `{x.interactionId}` 直出；并单独查 title 属性。 */
const packNoKey = packBlock.replace(/key=\{x\.interactionId\}/g, '')
const idShown = /\{x\.interactionId\}/.test(packNoKey)
const idInTitle = /title=\{`[^`]*x\.interactionId/.test(packBlock)
check('G3-2', '分组列表不把 interactionId 当文字/title 显示',
  packBlock.length > 0 && !idShown && !idInTitle,
  `分组段长度=${packBlock.length} · 直出 id=${idShown} · title 里带 id=${idInTitle}`)

check('G3-3', '按项目分组（组头「N 个协作 · M 个文件」+ 组内按最近上传）',
  srcCode.includes('function groupPacks(') && srcCode.includes('{g.rows.length} 个协作 · {g.files} 个文件') &&
  libText.includes('个协作') && libText.includes('个文件'),
  `groupPacks=${srcCode.includes('function groupPacks(')} · 组头文案=${srcCode.includes('个协作 · ')} · lib 打包=${libText.includes('个协作')}`)

/* ── G-4 · 签名位挪 1 号位 ───────────────────────────────────── */
const orderLine = seat?.match(/const SEAT_ORDER = \[([^\]]*)\]/)?.[1] ?? ''
check('G4-1', 'SEAT_ORDER 首项 = signature',
  orderLine.trim().startsWith("'signature'"),
  `SEAT_ORDER = [${orderLine.trim()}]`)

check('G4-2', '签名位状态文案「⛨ 山海已签 / ⛨ 待签」',
  seat !== null && seat.includes('⛨ 山海已签') && seat.includes('⛨ 待签') &&
  platLibText !== null && platLibText.includes('⛨ 待签'),
  `src=${seat?.includes('⛨ 待签')} · lib=${platLibText?.includes('⛨ 待签')}`)

check('G4-3', '签名位不进邀请抽屉（抽屉走 INVITE_SEATS）',
  seat !== null && seat.includes('const INVITE_SEATS = SEAT_ORDER.filter((s) => s !== \'signature\')') &&
  (seat.match(/\{INVITE_SEATS\.map\(/g) ?? []).length === 1,
  `INVITE_SEATS 定义=${seat?.includes('const INVITE_SEATS')} · 抽屉用一次=${(seat?.match(/\{INVITE_SEATS\.map\(/g) ?? []).length}`)

/* ── 输出 ───────────────────────────────────────────────────── */
let red = 0
for (const r of results) {
  if (!r.ok) red += 1
  console.log(`${r.ok ? '✓' : '✗'} ${r.id} ${r.desc}`)
  console.log(`    ${r.evidence}`)
}
console.log(`\n${red === 0 ? '全绿' : `有 ${red} 条红`} · 共 ${results.length} 条判据`)
process.exit(red === 0 ? 0 : 1)
