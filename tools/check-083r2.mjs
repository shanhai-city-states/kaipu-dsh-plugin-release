#!/usr/bin/env node
/**
 * 083-r2（dispatch-083-r2-invite · 邀请码列表化 + 受邀即显示）· 前端判据
 * =====================================================================
 * A 段 · `invite-code.ts` 纯函数：直接 import 编译产物，喂输入看输出
 * B 段 · 接线：先剥注释、先解 \uXXXX，再查**代码结构**（不查文案）
 * C 段 · 工位三态与受邀态：`node-pick.ts` 纯函数 + OrgNodeCard 接线
 *
 * 写法沿用 check-join-083 / 083b / 083r1（星月 R-6）：
 *   **不对源码 grep 关键词**，而是把判断函数当黑盒跑输入→输出；
 *   每条关键判据都配反向对照 —— 全绿不算证据，能变红才算。
 *
 * 跑法：node tools/build.mjs && node tools/check-083r2.mjs（期望退出码 0）
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const WS = join(ROOT, 'packages/plugin-workstation')
const SRC_PANEL = join(WS, 'src/client/WorkstationPanel.tsx')
const SRC_CODE = join(WS, 'src/client/invite-code.ts')
const SRC_NODE = join(WS, 'src/client/node-pick.ts')
const SRC_BRIDGE = join(WS, 'src/client/bridge.ts')
const SRC_SERVICE = join(WS, 'src/remote/service.ts')
const LIB_CODE = join(WS, 'lib/client/invite-code.js')
const LIB_NODE = join(WS, 'lib/client/node-pick.js')
const LIB_BUNDLE = join(WS, 'lib/client.js')

let pass = 0
let fail = 0
/* ★ 三参签名（id 已含标题）：本文件的 id 就是完整一句话，
   四参写法曾把表达式喂进 title 位，导致「看着全红、其实表达式为真」的假红。 */
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

for (const f of [SRC_PANEL, SRC_CODE, SRC_NODE, SRC_BRIDGE, SRC_SERVICE, LIB_CODE, LIB_NODE, LIB_BUNDLE]) {
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
const M = loadMod(LIB_CODE)
const N = loadMod(LIB_NODE)

const panel = decodeEscapes(stripComments(readFileSync(SRC_PANEL, 'utf8')))
const bridge = stripComments(readFileSync(SRC_BRIDGE, 'utf8'))
const service = stripComments(readFileSync(SRC_SERVICE, 'utf8'))
const bundle = decodeEscapes(readFileSync(LIB_BUNDLE, 'utf8'))

const H = 'abcdef123456'
const NOW = Date.parse('2026-10-24T12:00:00Z')
function row(over) {
  return {
    codeHash: H, state: 'pending', createdAt: '2026-10-24T10:00:00Z',
    expiresAt: '2026-10-25T10:00:00Z', usedAt: null, usedBy: '', revokedAt: null, ...over,
  }
}

/* ══ A · 纯函数 ═══════════════════════════════════════════════════════ */
console.log('── A · 邀请码列表口径 ──')

check('A-1 四档状态都有中文，未知状态不吞（原样带出）',
  M.stateLabel('pending') === '待用' && M.stateLabel('used') === '已用'
  && M.stateLabel('expired') === '已过期' && M.stateLabel('revoked') === '已作废'
  && M.stateLabel('weird').includes('weird'),
  `${M.stateLabel('pending')} / ${M.stateLabel('used')} / ${M.stateLabel('expired')} / ${M.stateLabel('revoked')} / ${M.stateLabel('weird')}`)

check('A-2 反向对照：只有 pending 可操作，另三档一律不可',
  M.isActionable('pending') === true && M.isActionable('used') === false
  && M.isActionable('revoked') === false && M.isActionable('expired') === false)

check('A-3 剩余时间：未来给「还剩」、过期给「已过期」、脏值不抛',
  M.remainingText('2026-10-25T12:00:00Z', NOW).startsWith('还剩 1 天')
  && M.remainingText('2026-10-24T11:00:00Z', NOW) === '已过期'
  && M.remainingText('not-a-date', NOW) === '有效期读不出来',
  `${M.remainingText('2026-10-25T12:00:00Z', NOW)} | ${M.remainingText('2026-10-24T11:00:00Z', NOW)}`)

check('A-4 无明文时明说「明文未保存在本机」，不留空也不撒谎',
  M.codeTextOf(H, '') === '已生成 · 明文未保存在本机' && M.codeTextOf(H, 'abc123') === 'abc123',
  M.codeTextOf(H, ''))

check('A-5 「已用」要报是谁用的；待用不谈 usedBy',
  M.usedByText(row({ state: 'used', usedBy: '阿舟' })) === '被 阿舟 用掉'
  && M.usedByText(row({ state: 'used', usedBy: '' })).includes('没记')
  && M.usedByText(row({})) === '')

check('A-6 待用张数只数 pending（已用/已作废/已过期不占额度）',
  M.pendingCount([row({}), row({ codeHash: 'b' }), row({ codeHash: 'c', state: 'used' }),
    row({ codeHash: 'd', state: 'revoked' }), row({ codeHash: 'e', state: 'expired' })]) === 2)

check('A-7 额度 3：2 张还能生、3 张按钮该变灰且给得出人话理由',
  M.canCreateMore(2) === true && M.canCreateMore(3) === false
  && M.createBlockedTip(2) === '' && M.createBlockedTip(3).includes('先作废'),
  `tip(3)=${M.createBlockedTip(3)}`)

check('A-8 批量张数受剩余额度限制（0→1/2/3，2→只 1，3→只 1 即不可选）',
  JSON.stringify(M.batchChoices(0)) === '[1,2,3]'
  && JSON.stringify(M.batchChoices(2)) === '[1]'
  && JSON.stringify(M.batchChoices(3)) === '[1]',
  `${JSON.stringify(M.batchChoices(0))} · ${JSON.stringify(M.batchChoices(2))} · ${JSON.stringify(M.batchChoices(3))}`)

const has = (list) => (h) => list.includes(h)
check('A-9 失效即清明文：used/revoked/expired/待用已过期 都清；待用未过期不清',
  JSON.stringify(M.staleHashes([
    row({ codeHash: 'a', state: 'used' }),
    row({ codeHash: 'b', state: 'revoked' }),
    row({ codeHash: 'c', state: 'expired' }),
    row({ codeHash: 'd', state: 'pending', expiresAt: '2026-10-24T11:00:00Z' }),
    row({ codeHash: 'e', state: 'pending' }),
  ], has(['a', 'b', 'c', 'd', 'e']), NOW)) === '["a","b","c","d"]')

check('A-9b 反向对照：本机没有明文的不进清理列表（不做无意义的删除）',
  M.staleHashes([row({ state: 'used' })], has([]), NOW).length === 0)

check('A-10 错误人话：额度满带张数、作废不了、续不了期（★ 续期那条是实测出来的码）',
  M.humanizeCodeError('too_many_pending_codes', 'x', 3).includes('3 张')
  && M.humanizeCodeError('too_many_pending_codes', 'x').includes('先作废')
  && M.humanizeCodeError('code_not_revocable', 'x').includes('作废不了')
  && M.humanizeCodeError('code_not_renewable', 'x').includes('续不了期'),
  M.humanizeCodeError('code_not_renewable', '这张码已经用过或已作废，不能续期'))

check('A-10b 反向对照：不认识的码不吞成成功文案，退回服务端 message',
  M.humanizeCodeError('some_new_code', '服务端原话').includes('服务端原话'))

check('A-11 sha256 对齐标准向量，codeHash 对齐服务端口径（实测真码）',
  M.sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  && M.codeHashOf('dXsxbHIEkbpA') === '2e45be425a23',
  `sha256(abc)=${M.sha256Hex('abc').slice(0, 16)}… · codeHashOf(dXsxbHIEkbpA)=${M.codeHashOf('dXsxbHIEkbpA')}`)

const vPending = M.codeRowView(row({}), 'abc123', NOW)
const vUsed = M.codeRowView(row({ state: 'used', usedBy: '阿舟' }), '', NOW)
check('A-12 行视图：待用给剩余时间+可操作；已用不给剩余时间、改给使用人',
  vPending.actionable === true && vPending.remainText.length > 0 && vPending.plainLocal === true
  && vUsed.actionable === false && vUsed.remainText === '' && vUsed.usedByText.includes('阿舟'),
  `pending=${vPending.stateText}/${vPending.remainText} · used=${vUsed.stateText}/${vUsed.usedByText}`)

check('A-13 空列表要有一句引导（铺主看到空框会以为加载失败）',
  M.emptyListText(true).length > 0 && M.emptyListText(false) === '')

/* ══ B · 接线 ════════════════════════════════════════════════════════ */
console.log('── B · 端点与接线 ──')

check('B-1 三个端点都注册了（bridge 枚举 + service @Remote）',
  bridge.includes("deviceJoinCodes: 'deviceJoinCodes'")
  && bridge.includes("deviceJoinCodeRevoke: 'deviceJoinCodeRevoke'")
  && bridge.includes("deviceJoinCodeRenew: 'deviceJoinCodeRenew'")
  && service.includes("@Remote('deviceJoinCodes')")
  && service.includes("@Remote('deviceJoinCodeRevoke')")
  && service.includes("@Remote('deviceJoinCodeRenew')"))

check('B-2 service 走的是契约路径（GET /device-join-codes、POST .../{hash}/revoke|renew）',
  service.includes("'GET', `/device-join-codes${qs}`")
  && service.includes("`/device-join-codes/${encodeURIComponent(h)}/revoke`")
  && service.includes("`/device-join-codes/${encodeURIComponent(h)}/renew`"))

check('B-3 JoinCodeCard 按列表渲染（codeRows.map + codeRowView）',
  panel.includes('codeRows.map(') && panel.includes('codeRowView('))

check('B-4 明文用 codeHashOf(明文) 落盘（精确对应，不按批次顺序猜）',
  panel.includes('const h = codeHashOf(p)') && panel.includes('safeSet(plainStoreKey(h), p)'))

check('B-5 反向对照：明文键既不用 batchId、也不用行号（只用 codeHashOf(明文)）',
  panel.includes('safeSet(plainStoreKey(h), p)')
  && !panel.includes('plainStoreKey(batchId')
  && !panel.includes('plainStoreKey(String(i') && !panel.includes('plainStoreKey(idx'))

check('B-6 刷新顺序：先清失效明文，再做本机快照（反过来会多显示一轮已经作废的码）',
  panel.indexOf('const stale = staleHashes(') > -1
  && panel.indexOf('const stale = staleHashes(') < panel.indexOf('const snap: Record<string, string> = {}'))

check('B-7 作废成功后立刻抹掉本机明文（safeRemove）',
  panel.includes('deviceJoinCodeRevoke') && panel.includes('safeRemove(plainStoreKey(hash))'))

check('B-8 生成按钮受额度控制：disabled 本身就要接额度（只写在 title/底色里等于能点）',
  panel.includes('disabled={busy || (owner === true && !canCreateMore(pendingCodes))}')
  && panel.includes('createBlockedTip(pendingCodes)'))

check('B-9 列表只在铺主视角拉（申请人拉必 403，不能让它变红字）',
  panel.includes('if (owner !== true) return') )

check('B-10 产物里真有新端点（证明 build 吃到了改动）',
  bundle.includes('deviceJoinCodes') && bundle.includes('deviceJoinCodeRenew'))

/* ══ C · 工位三态 + 受邀态 ═══════════════════════════════════════════ */
console.log('── C · 工位三态与受邀态 ──')

check('C-1 joinStateOf 认三态；缺字段按 online 退一格（★ 绝不把缺字段当成「受邀未到」）',
  N.joinStateOf({ joinState: 'present' }) === 'present'
  && N.joinStateOf({ joinState: 'invited' }) === 'invited'
  && N.joinStateOf({ online: true }) === 'present'
  && N.joinStateOf({ online: false }) === 'joined'
  && N.joinStateOf({}) === 'joined')

check('C-2 状态点：在场绿实心、离线灰实心、受邀灰空心',
  N.dotOf('present').color === '#27ae60' && N.dotOf('present').hollow === false
  && N.dotOf('joined').hollow === false && N.dotOf('invited').hollow === true)

check('C-3 受邀文案：有名带名，没名说「等待接入」',
  N.invitedLabel({ invitedName: '张三' }) === '已受邀：张三'
  && N.invitedLabel({}).includes('等待接入'))

check('C-4 反向对照：holders 非空时不算受邀态（人来了就不该再挂「已受邀」）',
  N.showInvited([{ name: '阿舟' }], { invitedName: '张三' }) === false
  && N.showInvited([], { invitedName: '张三' }) === true
  && N.showInvited([], null) === false)

check('C-5 OrgNodeCard 接上 showInvited 与 dotOf（不是只写在工具里没人用）',
  panel.includes('showInvited(holders, node.invited)') && panel.includes('dotOf(st)'))

/* ★ 2026-10-26：`holderUnknownText` 加了第 3 个参数（seatVacantish），
   原来锚死整串调用文本 ⇒ 接线没坏也假红。这里只锚「函数 + 第一参数」，
   参数表变化不再误判 —— 判据该守**顺序**，不该守参数写法。 */
const iInvited = panel.indexOf('showInvited(holders, node.invited) ? (')
const iUnknown = panel.search(/holderUnknownText\(\s*holders\.length\s*,/)
check('C-6 空位与受邀分得开：受邀分支在「有人但读不到」之前判',
  iInvited > -1 && iUnknown > -1 && iInvited < iUnknown,
  `invited=${iInvited} · unknown=${iUnknown}`)

console.log(`\n全绿：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`)
process.exit(fail === 0 ? 0 : 1)
