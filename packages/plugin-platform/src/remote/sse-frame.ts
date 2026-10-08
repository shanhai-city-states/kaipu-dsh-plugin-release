/**
 * 山海·开铺 · 场地插件 · **SSE 分帧与事件映射**（纯模块 · 零运行时依赖）
 * =====================================================================
 * ★★ 为什么单独一个文件（2026-10-06 抽出）：
 *
 *   这段逻辑原来长在 `remote/service.ts` 的 class 里，其中 `frameToEvent` 的注释
 *   明写"**纯函数，便于单独断言**"—— **但它当时是 `private`，根本断言不了**。
 *   注释说了没做的事，就是一处**假承诺**。
 *
 *   而"流内 `error` 帧"这个输入**在真服务端上很难自然发生**（正常路径不发），
 *   ⇒ 想验证"error 帧会被解析成**事件**、而不是被当成『这次运行挂了』"，
 *     就**必须能把一帧直接喂进去**。
 *
 *   ⇒ 抽成零依赖模块：`import type` 契约类型（**编译后无运行时 import**），
 *     于是**判据可以直接 import 编译产物来喂帧**（由配套探针脚本）。
 *     —— 判据要断在**真会发生的输入**上；发生不了就**造**一个。
 */
import type { SceneRunEvent } from '@shanhai/kaipu-contract'

/* ══════════════════════════════════════════════════════════════════
   一、分帧（契约 §3.4）
   ══════════════════════════════════════════════════════════════════
 * 只做**分帧**这一件事：字节流 → `{ event, data }`。把"帧 → 业务事件对象"的
 * 映射交给 `frameToEvent`（那里才持有 `curRound` 这类流内状态）。
 *
 * ★ 三个必须处理对的地方（SSE 规范里最容易漏的三条）：
 *   ① 分隔符是**空行**，且可能是 `\r\n\r\n` ⇒ 先归一化行尾再找 `\n\n`；
 *   ② 一帧可以有多行 `data:`（规范要求**用 `\n` 拼起来**，不是后者覆盖前者）；
 *   ③ 帧尾可能**没有**结尾空行（服务端直接关闭连接）⇒ 收尾时必须再解一次缓冲。
 */
export interface SseFrame {
  event: string
  data: string
}

/** 解一帧。`null` = 没有 `data:` 行（注释 / 心跳 / 空帧），**不是错误** */
export function parseSseFrame(frame: string): SseFrame | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const raw of frame.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  return dataLines.length === 0 ? null : { event, data: dataLines.join('\n') }
}

/* ══════════════════════════════════════════════════════════════════
   二、契约内的事件名与"带不带 round"
   ══════════════════════════════════════════════════════════════════ */

/**
 * 契约 §3.4 的**十个**事件名。★ **不在表里的帧一律不产出**（fail-closed）。
 *
 * ★ 2026-10-06 补 `'error'`（差异单 B 组）：契约 §3.4 的示例里**一直有** `event: error`，
 *   是本仓这张表漏了它 ⇒ 后果是 error 帧被下游**转成抛出**，
 *   把"运行中收到一条错误"表达成了"**这次运行挂了**"（两回事，见 `frameToEvent` 注释）。
 */
export const SSE_KNOWN: ReadonlySet<string> = new Set([
  'start',
  'round_start',
  'lamp_start',
  'lamp_delta',
  'lamp_done',
  'round_done',
  'summary',
  'usage',
  'error',
  'done',
])

/**
 * ★ 需要 `round` 的事件 —— **正向白名单**（2026-10-06 改）。
 *
 * 原来写的是"排除法"（`!== start && !== summary && …`）：每加一个新事件，
 * 都要记得往**排除列表**里补一次 —— 漏一次就给它错误地补上一个 `round`。
 * ⇒ 改成正向列举：**新事件默认不带 `round`**。
 *   这个默认方向更安全：漏加的后果只是"少一个字段"，而 reducer 对缺 `round`
 *   本来就有兜底（用最近一次 `round_start`）；反过来（**多**一个来路不明的 round）
 *   会把事件分到**错误的分段**里 —— 那是"看起来对、其实错"的一类。
 */
export const ROUNDED_EVENTS: ReadonlySet<string> = new Set([
  'round_start',
  'lamp_start',
  'lamp_delta',
  'lamp_done',
  'round_done',
])

/* ══════════════════════════════════════════════════════════════════
   三、帧 → 事件
   ══════════════════════════════════════════════════════════════════ */

/** 一帧的产物：一个事件，或者"一个事件 + 它顺带推进了 `round`" */
export type FrameOutcome =
  | { kind: 'event'; event: SceneRunEvent }
  | { kind: 'round'; round: number; event: SceneRunEvent }

/**
 * 一帧 → 一个事件。
 *
 * ★ **纯函数**（`curRound` 由调用方持有并传入）—— 现在这句是**真的**：
 *   本函数已从 class 里抽出并导出，判据可以直接喂帧断言它。
 *
 * ★★ 2026-10-06 改动：**移除了 `error` 帧的特殊分支**。
 *   原来它被转成 `{ kind: 'error', message }`（下游当**抛出**处理）——
 *   也就是说"运行中收到一条服务端错误"被表达成"**这次运行挂了**"。
 *   但 `error` 是契约 §3.4 的**普通事件**（示例里排在 `usage` 后、`done` 前）
 *   ⇒ 现在它产出正常的 `SceneRunEvent`，由**界面**当"运行记录的一部分"如实显示
 *     （不打断视图、不可关闭）。
 *
 * ★ fail-closed 三处（都是"宁可少产出，不可编造"）：
 *   ① 契约外的事件名 ⇒ 不产出；
 *   ② 坏 JSON / 非对象 ⇒ 跳过该帧；
 *   ③ 带 `round` 的事件缺 `round` ⇒ **填最近一次 `round_start` 的值**（不新造轮次）。
 */
export function frameToEvent(frame: SseFrame | null, curRound: number): FrameOutcome | null {
  if (frame === null) return null
  // ★ fail-closed ①：契约外的事件名 ⇒ 不产出
  if (!SSE_KNOWN.has(frame.event)) return null

  let obj: unknown
  try {
    obj = JSON.parse(frame.data)
  } catch {
    return null // ★ fail-closed ②：坏 JSON ⇒ 跳过该帧
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null

  const rec = obj as Record<string, unknown>
  // ★ fail-closed ③：**带 `round` 的事件**缺 `round` ⇒ 填最近一次 `round_start` 的值
  const needsRound = ROUNDED_EVENTS.has(frame.event)
  const withR = needsRound && typeof rec['round'] !== 'number' ? { ...rec, round: curRound } : rec

  // ★★ `error` 事件：把 `code` / `message` **归一化成字符串**
  //    （缺字段 ⇒ **空串**，而不是 `undefined`）。
  //    ★ 这里**只做归一，不编内容** —— 缺了就是缺了，由界面如实说"服务端没给细节"。
  //      （同 `#4`「不许编空数组」：兜底不能变成"假装有信息"。）
  if (frame.event === 'error') {
    const code = typeof withR['code'] === 'string' ? (withR['code'] as string) : ''
    const message = typeof withR['message'] === 'string' ? (withR['message'] as string) : ''
    return { kind: 'event', event: { event: 'error', code, message } }
  }

  const event = { ...withR, event: frame.event } as unknown as SceneRunEvent

  if (frame.event === 'round_start' && typeof withR['round'] === 'number') {
    return { kind: 'round', round: withR['round'], event }
  }
  return { kind: 'event', event }
}
