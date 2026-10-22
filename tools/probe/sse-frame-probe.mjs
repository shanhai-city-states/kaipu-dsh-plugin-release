#!/usr/bin/env node
/**
 * 山海·开铺 · **SSE 帧 → 事件** 的行为判据（契约 §3.4）
 * =====================================================================
 * ★★★ 为什么需要它 · 为什么长这样（2026-10-06 · 差异单 B 组收口）
 *
 *   **问题**：契约 §3.4 的示例里**一直有** `event: error`，
 *   但我方判别联合漏了它 ⇒ host 侧把 error 帧**转成抛出**，
 *   于是"运行中收到一条错误"被表达成"**这次运行挂了**"（两回事）。
 *
 *   **修完要判据看住 —— 但这个输入很难自然发生**：
 *   真服务端**正常路径根本不发 `error`**（实测 9 帧无 error）
 *   ⇒ 端到端探针**测不到**它。
 *
 *   ⇒ **判据要断在「真会发生的输入」上；发生不了，就造一个。**
 *     所以把分帧与映射抽成**零依赖模块**（`src/remote/sse-frame.ts`），
 *     本判据**直接 import 编译产物、喂各种帧进去**。
 *
 *   ★ 这顺手兑现了那段代码注释里"**纯函数，便于单独断言**"的承诺 ——
 *     它原来是 class 的 `private`，**断言不了**（注释说了没做的事，就是一处假承诺）。
 *
 * ★ 本判据断的是**行为**，不是源码里有没有某个字面量：
 *   若谁把 `'error'` 从事件表里删掉、或把抛出逻辑加回去，第 ① 节会**红**。
 *
 * 用法：node tools/probe/sse-frame-probe.mjs
 * 退出码：0 = 全过；1 = 有断言不过
 */
import { frameToEvent, parseSseFrame, SSE_KNOWN } from '../../packages/plugin-platform/lib/remote/sse-frame.js'

let failed = 0
const say = (ok, label, got, want) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) {
    if (got !== undefined) console.log(`      实测: ${got}`)
    if (want !== undefined) console.log(`      期望: ${want}`)
    failed++
  }
}

/** 造一帧（走真实的分帧函数，不绕开它） */
const f = (event, data) => parseSseFrame(`event: ${event}\ndata: ${data}`)

console.log('── ① `error` 帧：必须产出**事件**（B 组核心 · 修的就是这里）──')
const e1 = frameToEvent(f('error', '{"code":"insufficient_credits","message":"积分不足，请充值后再试"}'), 1)
say(e1 !== null, '★ error 帧**不丢**（以前是转成抛出 ⇒ 现在应产出事件）', JSON.stringify(e1)?.slice(0, 90), '一个事件对象')
say(e1?.kind === 'event', '★ 产出的是 `kind: event`（不是 `round`、更不是抛出）', String(e1?.kind), 'event')
say(e1?.event?.event === 'error', '事件名 = `error`', String(e1?.event?.event), 'error')
say(e1?.event?.code === 'insufficient_credits', '`code` 正确透传', String(e1?.event?.code), 'insufficient_credits')
say(e1?.event?.message === '积分不足，请充值后再试', '`message` 正确透传', String(e1?.event?.message), '积分不足，请充值后再试')
say(
  (e1?.event)?.round === undefined,
  '★ `error` **不被动加 `round`**（它不在需 round 的事件里）',
  JSON.stringify((e1?.event)?.round),
  'undefined',
)

console.log('\n── ② `error` 字段缺失 ⇒ 空串（**不是 undefined**）──')
const e2 = frameToEvent(f('error', '{}'), 1)
say(e2?.event?.code === '', '缺 `code` ⇒ 空串', JSON.stringify(e2?.event?.code), '""')
say(e2?.event?.message === '', '缺 `message` ⇒ 空串', JSON.stringify(e2?.event?.message), '""')
say(
  typeof e2?.event?.code === 'string' && typeof e2?.event?.message === 'string',
  '★ 两个字段都是 string（界面因此不必再判 `undefined`）',
  typeof e2?.event?.code,
  'string',
)

console.log('\n── ③ fail-closed 仍在（补 error 不能把闸门拆了）──')
say(frameToEvent(f('not_a_real_event', '{}'), 1) === null, '契约外事件名 ⇒ 不产出', '—', 'null')
say(frameToEvent(f('lamp_start', '{bad json'), 1) === null, '坏 JSON ⇒ 不产出', '—', 'null')
say(frameToEvent(f('lamp_start', '[1,2]'), 1) === null, 'JSON 是数组（不是对象）⇒ 不产出', '—', 'null')
say(frameToEvent(f('lamp_start', '"just a string"'), 1) === null, 'JSON 是字符串 ⇒ 不产出', '—', 'null')
say(frameToEvent(null, 1) === null, '空帧 ⇒ 不产出', '—', 'null')

console.log('\n── ④ `round` 回填（fail-closed ③）──')
const r1 = frameToEvent(f('lamp_delta', '{"lamp":"技术维度"}'), 3)
say(r1?.event?.round === 3, '带 round 的事件缺 `round` ⇒ **填 curRound**（不新造轮次）', String(r1?.event?.round), '3')
const r2 = frameToEvent(f('round_start', '{"round":2,"reason":"首轮"}'), 1)
say(r2?.kind === 'round', '`round_start` ⇒ `kind: round`（让调用方推进 curRound）', String(r2?.kind), 'round')
say(r2?.kind === 'round' && r2.round === 2, '并把**新轮次**回传（2，不是传入的 1）', r2?.kind === 'round' ? String(r2.round) : '—', '2')

console.log('\n── ⑤ 事件表：契约 §3.4 的**十个**──')
const WANT = ['start', 'round_start', 'lamp_start', 'lamp_delta', 'lamp_done', 'round_done', 'summary', 'usage', 'error', 'done']
const missing = WANT.filter((x) => !SSE_KNOWN.has(x))
say(missing.length === 0, `事件表含全部 ${WANT.length} 个（当前 ${SSE_KNOWN.size} 个）`, missing.join(', ') || '齐全', WANT.join(' | '))

console.log(`\n${failed === 0 ? '全过 ✓' : `有 ${failed} 条不过 ✗`}`)
process.exit(failed === 0 ? 0 : 1)
