#!/usr/bin/env node
/**
 * 083 第一批 · 邀请码补发闭环（块 A）· 前端判据
 * =====================================================================
 * 为什么这么写（星月 §六 R-6 的教训）：
 *   「所有包用同一张关键词表判定 = 逻辑必然 0 命中，那不是通过，是没测。」
 *   ⇒ 本脚本分两类证据：
 *     ① **行为断言**：直接 import 编译产物 `lib/client/join-copy.js`，喂不同输入看输出。
 *        每条都配**反向对照**（改一个输入必须让结论变），证不了能变红的不算数。
 *     ② **接线断言**：源码/产物层面的结构检查（端点两侧同值、无内部码、无跳出）。
 *
 * 跑法：node tools/check-join-083.mjs        （期望退出码 0）
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const WS = join(ROOT, 'packages/plugin-workstation')
const SRC_PANEL = join(WS, 'src/client/WorkstationPanel.tsx')
const SRC_COPY = join(WS, 'src/client/join-copy.ts')
const LIB_COPY = join(WS, 'lib/client/join-copy.js')
const LIB_BUNDLE = join(WS, 'lib/client.js')
const SRC_BRIDGE = join(WS, 'src/client/bridge.ts')
const SRC_SERVICE = join(WS, 'src/remote/service.ts')
const SRC_HTTP = join(WS, 'src/remote/kai-pu-http.ts')

let pass = 0
let fail = 0
const rows = []

function check(id, title, ok, detail) {
  if (ok) pass += 1
  else fail += 1
  rows.push({ id, title, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${id} ${title}${detail === undefined ? '' : `\n    ${detail}`}`)
}

/** ts 产物把中文转成 \uXXXX —— 断言中文前必须解码（本项目老坑，第二回了） */
function decodeEscapes(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
}
/** 剥注释：新注释里常引用旧代码，直接断言「不得包含」会被自己的注释判红 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

for (const f of [SRC_PANEL, SRC_COPY, LIB_COPY, LIB_BUNDLE, SRC_BRIDGE, SRC_SERVICE, SRC_HTTP]) {
  if (!existsSync(f)) {
    console.error(`缺文件：${f}\n（先跑 node tools/build.mjs）`)
    process.exit(2)
  }
}

const panelSrc = readFileSync(SRC_PANEL, 'utf8')
const panelCode = stripComments(panelSrc)
const copySrc = readFileSync(SRC_COPY, 'utf8')
const bridgeSrc = readFileSync(SRC_BRIDGE, 'utf8')
const serviceSrc = readFileSync(SRC_SERVICE, 'utf8')
const httpSrc = readFileSync(SRC_HTTP, 'utf8')
const libBundle = decodeEscapes(readFileSync(LIB_BUNDLE, 'utf8'))

const mod = (() => {
  /* ★ 产物是 **CommonJS**（tsc client 走 cjs），而本仓 `"type": "module"`
     ⇒ 直接 import 会被当 ESM 解析并在 `exports is not defined` 处炸（第一次就踩了）。
     用一个 5 行的 CJS 壳把产物执行出来，零依赖、不落临时文件。 */
  const code = readFileSync(LIB_COPY, 'utf8')
  const shell = { exports: {} }
  const fn = new Function('exports', 'module', 'require', code)
  fn(shell.exports, shell, () => { throw new Error('join-copy 不该 require 任何东西') })
  return shell.exports
})()
const { humanizeJoinError, containsInternalCode, joinRowLabel, applicantView, joinGuideText, JOIN_GUIDE_SECTION } = mod

console.log('083 第一批 · 邀请码补发闭环 · 前端判据\n')

/* ══════════════════════════════════════════════════════════════════
 * A · 错误人话化（AC-10 的直接证据）
 * ══════════════════════════════════════════════════════════════════ */
{
  const cred = humanizeJoinError('no_credential')
  check('A-1', 'AC-10 · no_credential 翻成「查不到你的身份…」且不含内部码',
    cred.includes('查不到你的身份') && !cred.includes('no_credential'),
    `输出="${cred}"`)

  const acc = humanizeJoinError('account_not_found')
  check('A-2', '反向对照：不同错误码给不同话（不是咬死一句）',
    acc !== cred && acc.includes('找不到这个铺子'),
    `no_credential→"${cred}" ｜ account_not_found→"${acc}"`)

  /* 全码表两两不同 —— 证明它真在查表，不是 catch-all */
  const codes = ['no_credential', 'account_not_found', 'duplicate_pending', 'not_owner',
    'not_applicant', 'already_decided', 'expired', 'not_found', 'denied']
  const texts = codes.map((c) => humanizeJoinError(c))
  const uniq = new Set(texts)
  check('A-3', `九个错误码 → 九句不同的话（uniq=${uniq.size}/${codes.length}）`,
    uniq.size === codes.length,
    texts.map((t, i) => `${codes[i]}:${t.slice(0, 12)}…`).join(' ｜ '))

  const unknown = humanizeJoinError('some_new_code_v9')
  const leaky = humanizeJoinError('some_new_code_v9', 'failed: no_credential at /join/request')
  check('A-4', '未知码 / 服务端原文里带内部码 ⇒ 一律走兜底句，不漏码不漏路径',
    !containsInternalCode(unknown) && !containsInternalCode(leaky) &&
    unknown === '这次没提交成功，过一会儿再试一次',
    `unknown="${unknown}" ｜ leaky="${leaky}"`)

  check('A-5', '合法中文原文可以直接用（别把好话也丢掉）',
    humanizeJoinError('', '码已过期，请重新申请') === '码已过期，请重新申请',
    `输出="${humanizeJoinError('', '码已过期，请重新申请')}"`)
}

/* ══════════════════════════════════════════════════════════════════
 * B · 待审批一行摘要
 * ══════════════════════════════════════════════════════════════════ */
{
  const a = joinRowLabel({ nodeId: '3', applicantName: '张三', applicantKind: 'human', reason: '邀请码已过期' })
  const b = joinRowLabel({ nodeId: '5', applicantKind: 'agent' })
  check('B-1', '摘要拼装：工位号 · 姓名 · 原因',
    a === '工位 3 · 张三 · 邀请码已过期',
    `"${a}"`)
  check('B-2', '反向对照：换工位号/没姓名 ⇒ 输出确实变（不是硬编码一句话）',
    b === '工位 5 · (Agent) · Agent 申请补发' && a !== b,
    `"${b}"`)
  check('B-3', '缺 nodeId 时退到 seat；两个都缺则不摆「工位 undefined」',
    joinRowLabel({ seat: '执行位', applicantName: '李四', applicantKind: 'human' }) === '执行位 · 李四 · 申请补发加入码' &&
    !joinRowLabel({ applicantName: '王五', applicantKind: 'human' }).includes('undefined'),
    `seat 版="${joinRowLabel({ seat: '执行位', applicantName: '李四', applicantKind: 'human' })}" · 无位版="${joinRowLabel({ applicantName: '王五', applicantKind: 'human' })}"`)
}

/* ══════════════════════════════════════════════════════════════════
 * C · 申请人四态（任务2）
 * ══════════════════════════════════════════════════════════════════ */
{
  const st = (s) => applicantView(s)
  check('C-1', 'pending：不可重复点、无红点',
    st('pending').canRetry === false && st('pending').dot === false && st('pending').text.includes('等铺主通过'),
    `"${st('pending').text}"`)
  check('C-2', 'approved：**红点 1** + 可拿新码（dot=true, canRetry=false）',
    st('approved').dot === true && st('approved').canRetry === false && st('approved').text.includes('新码'),
    `"${st('approved').text}"`)
  check('C-3', 'rejected：可说「重新申请」（canRetry=true）',
    st('rejected').canRetry === true && st('rejected').text.includes('拒绝'),
    `"${st('rejected').text}"`)
  check('C-4', 'expired：也允许重新申请（AC-07 到期后不能卡死）',
    st('expired').canRetry === true && st('expired').dot === true,
    `"${st('expired').text}"`)
  check('C-5', '反向对照：四种状态两两不同（不是同一句）',
    new Set(['pending', 'approved', 'rejected', 'expired'].map((s) => st(s).text)).size === 4,
    '')
  const empty = st('')
  check('C-6', '没有申请时不出字（不摆空状态）',
    empty.text === '' && empty.dot === false && empty.canRetry === false,
    JSON.stringify(empty))
}

/* ══════════════════════════════════════════════════════════════════
 * D · Agent 指令第五条（任务4 · 不加这条整链是死的）
 * ══════════════════════════════════════════════════════════════════ */
{
  const base = ['一、装插件', '二、用加入码进铺', '三、装技能', '四、以后传资料']
  const text = joinGuideText(base)
  check('D-1', '第五节真的拼进去了（且前四节一字未动）',
    text.startsWith(base.join('\n')) && text.includes('五、如果你发现邀请码失效了'),
    `长度 ${base.join('\n').length} → ${text.length}`)
  check('D-2', '含可直接抄的 curl（POST 补发 + GET 查状态两条）',
    text.includes('/kai-pu/join/request') && text.includes('/join/request/{requestId}') &&
    text.includes('"applicantKind":"agent"'),
    '')
  check('D-3', '含状态机提示：approved 后 joinCode 就是新码',
    text.includes('approved') && text.includes('joinCode') && text.includes('新码'),
    '')
  check('D-4', '反向对照：没有第五节时文本更短（证明拼接真的加了东西）',
    base.join('\n').length < text.length && JOIN_GUIDE_SECTION.length >= 15,
    `第五节 ${JOIN_GUIDE_SECTION.length} 行`)

  const usedInSrc = panelCode.includes('joinGuideText(')
  check('D-5', '组件里确实走 joinGuideText（不是另抄一份文案）',
    usedInSrc && libBundle.includes('如果你发现邀请码失效了'),
    `src 调用=${usedInSrc} · 产物含第五节=${libBundle.includes('如果你发现邀请码失效了')}`)
}

/* ══════════════════════════════════════════════════════════════════
 * E · 端点接线：client bridge ↔ host service 两侧同值（5 个）
 * ══════════════════════════════════════════════════════════════════ */
{
  const names = ['joinRequests', 'joinRequestGet', 'joinRequestCreate', 'joinRequestApprove', 'joinRequestReject']
  const missing = names.filter((n) => !bridgeSrc.includes(`${n}: '${n}'`) || !serviceSrc.includes(`@Remote('${n}')`))
  check('E-1', '5 个端点两侧同名同值（bridge 常量 + @Remote 装饰器）',
    missing.length === 0, missing.length === 0 ? names.join(', ') : `缺：${missing.join(', ')}`)

  const paths = [
    ['/join/requests?status=${encodeURIComponent(status)}', 'GET 待审批列表'],
    ["`/join/request/${encodeURIComponent(rid)}`", 'GET 单条'],
    ["'/join/request'", 'POST 提交'],
    ['/approve`', 'POST 同意'],
    ['/reject`', 'POST 拒绝'],
  ]
  const noPath = paths.filter(([p]) => !serviceSrc.includes(p)).map(([, t]) => t)
  check('E-2', '5 条路径与契约逐字一致（含 status=pending 查询）',
    noPath.length === 0, noPath.length === 0 ? paths.map(([, t]) => t).join(' / ') : `缺：${noPath.join(', ')}`)

  check('E-3', 'deviceFp 由 host 自动填（渲染层不碰指纹）',
    serviceSrc.includes('fingerprintHint()') && serviceSrc.includes('body.deviceFp = fp') &&
    !panelCode.includes('deviceFp'),
    `service 用 fingerprintHint=${serviceSrc.includes('fingerprintHint()')} · 面板里出现 deviceFp=${panelCode.includes('deviceFp')}`)

  check('E-4', 'POST /join/request 走**匿名**通道（申请人还没入册，不会再握手 401）',
    serviceSrc.includes('callAnon<JoinRequestCreated>') && httpSrc.includes('async callAnon<T>'),
    '（这是本条链能不能成立的关键 —— 走 call() 会在 ensureToken 就炸）')
}

/* ══════════════════════════════════════════════════════════════════
 * F · 界面纪律（AC-9 / AC-10 / 不用 confirm / 不跳页）
 * ══════════════════════════════════════════════════════════════════ */
{
  /* 只切 JoinCodeCard 这一段来看（文件里别处还有 `[{err.code}]`，不在本单范围） */
  const start = panelCode.indexOf('function JoinCodeCard(')
  const block = start >= 0 ? panelCode.slice(start) : ''

  check('F-1', 'AC-10 · 加入码卡片内不渲染 `[code] 原文`（无 `{err.code}` / `{r.code}` 直出）',
    block.length > 0 && !/\{\s*(err|r|me)\.code\s*\}/.test(block) && !block.includes('no_credential'),
    `卡片段长度=${block.length} · 直出 code=${/\{\s*(err|r|me)\.code\s*\}/.test(block)} · 含 no_credential=${block.includes('no_credential')}`)

  check('F-2', 'AC-9 · 同意后就地出新码（setIssued + 同组件渲染 issued.code，无跳转）',
    block.includes('setIssued({ requestId: rid') && block.includes('{issued.code') &&
    !/location\.(href|assign|replace)/.test(block) && !block.includes('window.open'),
    `setIssued=${block.includes('setIssued({ requestId: rid')} · 渲染 issued.code=${block.includes('{issued.code')}`)

  check('F-3', '不用 window.confirm / alert（DSH 宿主里不可靠 —— 任务书 §五-7）',
    !block.includes('window.confirm') && !block.includes('window.alert') && !block.includes('confirm('),
    '')

  check('F-4', '红点数字取服务端 count（不是自己数 items）',
    panelCode.includes('setWaiting(r.data.items)') && panelCode.includes('waiting.length'),
    '（count 已由 host 兜底成「服务端给的优先」，见 service.joinRequests）')

  check('F-5', '申请人轮询 60 秒（不是 5 秒）',
    block.includes('60_000') && !block.includes('5_000'),
    `60_000=${block.includes('60_000')} · 5_000=${block.includes('5_000')}`)

  check('F-6', '空列表整块不渲染（不摆空框）',
    /owner === true && pendingCount > 0 \?/.test(block) && block.includes('待审批 {pendingCount} 件'),
    '')

  check('F-7', '产物含新逻辑（防「漏跑 build 打旧包」）',
    libBundle.includes('码用不了了') && libBundle.includes('已申请，等铺主通过') &&
    libBundle.includes('待审批'),
    `产物 ${(readFileSync(LIB_BUNDLE).length / 1024).toFixed(1)} KB`)
}

console.log(`\n${fail === 0 ? '全绿' : '有红'} · 共 ${pass + fail} 条判据（通过 ${pass} / 失败 ${fail}）`)
process.exit(fail === 0 ? 0 : 1)
