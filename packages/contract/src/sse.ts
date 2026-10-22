/**
 * 山海·开铺 · 契约层 · SSE 事件（POST /scene/{id}/run）
 * =====================================================================
 * ★★ 本文件是**全场最容易出错的地方**，两条纪律写在这里：
 *
 *   1) **归组键 = (round, lamp)**。
 *      `round_start` / `round_done` 给**流程语义**（界面画"第 N 轮"分段）；
 *      每个 `lamp_*` **自带 `round`** 作**兜底** ——
 *      即便漏接了 `round_start`，也不会把第 2 轮的 `lamp_delta` 串进第 1 轮。
 *      ★ 依据：004 Q5「关键状态不能只有一个来源」（契约变更 #2）。
 *      003 教训同源：**只靠一个信号判断状态，迟早在并发/丢包下串台**。
 *
 *   2) **断开 ≠ 取消**。
 *      客户端断开 SSE = "客户端不再接收"，**服务端仍在算完并落 `lamp_runs`**。
 *      ⇒ 界面写「**已停止接收**」，**不写「已取消」**（004 Q8）。
 */

/** 四类判定（流程透明是卖点 ⇒ 界面必须可区分） */
export type Verdict = '✅通过' | '⚡有条件' | '❌驳回' | '⛔拒收'

export type VerdictTone = 'pass' | 'conditional' | 'reject' | 'refuse'

export const VERDICT_TONE: Record<Verdict, VerdictTone> = {
  '✅通过': 'pass',
  '⚡有条件': 'conditional',
  '❌驳回': 'reject',
  '⛔拒收': 'refuse',
}

export interface SseStart {
  event: 'start'
  requestId: string
  scene: string
  /** 本次**实际参与**的维度（`dims` 裁剪后的结果） */
  lamps: string[]
  serverTime: string
}

export interface SseRoundStart {
  event: 'round_start'
  round: number
  /** 例：'首轮' / '⚡有条件回炉' */
  reason: string
}

export interface SseLampStart {
  event: 'lamp_start'
  round: number
  lamp: string
  agent: string
}

export interface SseLampDelta {
  event: 'lamp_delta'
  round: number
  lamp: string
  text: string
}

export interface SseLampDone {
  event: 'lamp_done'
  round: number
  lamp: string
  verdict: Verdict
  detail: string
  latencyMs: number
}

export interface SseRoundDone {
  event: 'round_done'
  round: number
  verdict: Verdict
}

export interface SseSummary {
  event: 'summary'
  verdict: Verdict
  conditions: string[]
  round: number
  /** ★ 契约变更 #4：报告不能给出"审全了"的错觉 */
  participatedDims: string[]
  skippedDims: string[]
}

export interface SseUsage {
  event: 'usage'
  tokensIn: number
  tokensOut: number
  credits: number
  balanceAfter: number
}

export interface SseDone {
  event: 'done'
  finishReason: string
}

/**
 * ★★ `error` 事件 —— **2026-10-06 补进判别联合**（差异单 B 组，我方自己的账）。
 *
 * 为什么之前缺它：契约 §3.4 的示例里**一直有** `event: error`
 * （`{"code":"insufficient_credits","message":"积分不足，请充值后再试"}`），
 * 但我方判别联合漏了它 ⇒ host 侧只能把 error 帧**转成抛出**，
 * 于是"运行中收到一条错误"被表达成了"这次运行挂了"。**两者不是一回事**：
 *
 * | | 触发 | 应有的表现 |
 * |:--|:--|:--|
 * | **请求失败** | HTTP 层失败（4xx/5xx）⇒ 运行**没跑起来** | `ErrorSurface`：可关闭的提示 |
 * | **流内 `error`** | 运行**跑起来了**，中途服务端报一条实况 | **运行记录的一部分**：不该可关闭、不该打断视图 |
 *
 * ★ 且契约示例里 `error` **排在 `usage` 之后、`done` 之前** ⇒ 它是一个**普通事件**，
 *   **流会继续**（不是终止信号）。⇒ 收到它**不**结束 `for await`，由 `done` 收尾；
 *   若此后没有 `done`，现有逻辑会如实报"事件流提前结束"。
 *
 * ★ `code` 与 §8.2 文案表**同一套**（`snake_case`）。客户端渲染纪律：
 *   **表里有该 code ⇒ 用契约译法**（口径统一）；
 *   **表里没有 ⇒ 如实显示服务端的 `message`，并标记"未收录"** ——
 *   ★ 但**不许自己编一条文案补进去**：§8.2 是对方维护的表，发现缺口**要报，不单方补**。
 */
export interface SseError {
  event: 'error'
  /** `snake_case` 错误码（与 §8.2 同一套；也可能出现表外码 —— 那要报给对方） */
  code: string
  /** 服务端给的人可读中文。**用作"表里没收录时"的如实回落**，不是主文案来源 */
  message: string
}

export type SceneRunEvent =
  | SseStart
  | SseRoundStart
  | SseLampStart
  | SseLampDelta
  | SseLampDone
  | SseRoundDone
  | SseSummary
  | SseUsage
  | SseError
  | SseDone

/** 事件名（与契约逐字一致，不要在这些位置写字面量） */
export const SSE_EVENT = {
  start: 'start',
  roundStart: 'round_start',
  lampStart: 'lamp_start',
  lampDelta: 'lamp_delta',
  lampDone: 'lamp_done',
  roundDone: 'round_done',
  summary: 'summary',
  usage: 'usage',
  error: 'error',
  done: 'done',
} as const

/** 归组键：**必须**用 (round, lamp)，不要只用 lamp。 */
export function lampKey(round: number, lamp: string): string {
  return `${round}\u0000${lamp}`
}
