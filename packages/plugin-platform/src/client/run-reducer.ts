/**
 * 山海·开铺 · 场地插件 · **运行归约器**（纯函数）
 * =====================================================================
 * 输入一串契约 SSE 事件，输出**只与渲染有关**的视图状态。
 *
 * ★★ 为什么单独一个模块、而且是纯函数
 *
 *   契约里最容易出错的正是这一步（`sse.ts` 的注释把它叫"全场最容易出错的地方"）。
 *   把它做成**纯函数**以后：
 *     · 事件从哪来（mock / 真 SSE / 断线补拉）**与本模块无关** —— 换来源不改它；
 *     · 可被单测/探针直接喂事件断言结果，不需要起浏览器。
 *   ⇒ 这正是"一个服务只做一件事"的落法：**归约只做归约**。
 *
 * ★★ 三条契约硬约束（逐条对应 sse-events.json 的 renderRules）
 *
 *   [R1] 归组键 = **(round, lamp)**，不是 `lamp`。
 *        `round_start`/`round_done` 给流程语义；每个 `lamp_*` **自带 round** 作兜底。
 *        ⇒ 即便漏接 `round_start`，也**不会**把第 2 轮的 delta 串进第 1 轮。
 *   [R2] 按「第 N 轮」**分段**，回炉可见 —— 不合并成一条流水。
 *   [R6] 轮数**由服务端 `loopPolicy` 决定，客户端不得推断**。
 *        ⇒ 本模块**只反映事件里说的**，永不自己造一个轮次
 *          （所以"兜底"只兜"分组"，不兜"编造第几轮"）。
 *
 * ★ 另有一条不属于本模块但必须记住：[R5] 断开 ≠ 取消。
 *   断开只改**客户端的接收状态**（`status: 'stopped'`），
 *   服务端的最终判定仍以 `summary` 为准 —— 两者分开存，界面才不会说出"已取消"。
 */
import { lampKey, VERDICT_TONE, type SceneRunEvent, type Verdict, type VerdictTone } from '@shanhai/kaipu-contract'

export interface LampView {
  lamp: string
  /** `null` ⇒ 该维度尚未接入执行方（界面对应「待接入」） */
  agent: string | null
  /** `lamp_delta` 累积的流式文本（按到达顺序） */
  lines: string[]
  verdict: Verdict | null
  detail: string
  latencyMs: number | null
}

export interface RoundView {
  round: number
  reason: string
  /**
   * ★ 该轮**没有收到 `round_start`** ⇒ 由 `lamp_*` 自带的 `round` 兜出来的分段。
   *   界面据此可以提示"轮次开始事件缺失"，**而不是假装它是正常的第 N 轮**。
   */
  degraded: boolean
  lamps: LampView[]
  verdict: Verdict | null
}

export interface SummaryView {
  verdict: Verdict
  conditions: string[]
  round: number
  participatedDims: string[]
  skippedDims: string[]
  /**
   * ★★ 服务端**到底有没有给**维度信息（`participatedDims` / `skippedDims`）。
   *
   * 为什么必须单独记这一位（2026-10-05 接真 SSE 后当场立的）：
   *   契约变更 #4 要求 `summary` 带这两个数组，用意是**「报告不能给出『审全了』的错觉」**。
   *   但**实测**（配套的联调探针，2026-10-05）服务端发的是：
   *     `{"verdict":"⚪未接入","conditions":[…],"round":1}`   ← **没有这两个字段**
   *   若我们把"缺字段"兜底成空数组，界面就会显示「未参与维度：（无）」
   *   —— 那**恰好**制造了 #4 要防的那个错觉：看起来"该审的都审了"。
   *   ⇒ 所以缺字段时**不许编**：留 `false`，界面据此说清"服务端没给维度信息，
   *     因此**无法判断是否审全**"。**如实说不确定，好过编一个确定的坏答案。**
   */
  dimsReported: boolean
}

export interface UsageView {
  tokensIn: number
  tokensOut: number
  credits: number
  /**
   * ★ 实测（2026-10-05）服务端会回 `balanceAfter: null`（契约写的是 number）
   *   —— 计费未接入时**如实 null，不编造**（契约 §20.2 同款口径）。
   *   ⇒ 类型放宽成 `number | null`：**让"没给"能被表达出来**，
   *     否则界面只能显示一个假的 0。
   */
  balanceAfter: number | null
  /**
   * ★ 服务端附的**口径说明**（契约里没有，是实测多出来的字段）。
   *   例：`"P1 占位：无真实模型调用 ⇒ 用量为 0（不虚报）"`。
   *   为什么要透传：没有它，"用量 0"会被读成"这次没花钱"，而实际含义是
   *   **"这一档还没接真实计费"** —— 两者是完全不同的意思。
   */
  note: string | null
}

/**
 * `idle`     —— 没跑过（**不是错误态**，这是正常状态）
 * `running`  —— 收到事件但还没 `done`
 * `stopped`  —— **客户端断开**（R5：措辞是「已停止接收」，不是「已取消」）
 * `done`     —— 收到 `done`
 */
export type RunStatus = 'idle' | 'running' | 'stopped' | 'done'

/**
 * 流内 `error` 事件（契约 §3.4 · 2026-10-06 补进判别联合后的消费形状）。
 *
 * `code` 与 §8.2 文案表**同一套**；`message` 是服务端给的原文。
 * ★ 界面渲染纪律：**有译法用译法**（口径统一）；**没收录**才回落到 `message`，
 *   且要**标记「未收录」** —— **不许自己补文案**（§8.2 归对方维护，缺口要报不单方补）。
 */
export interface RunErrorView {
  code: string
  message: string
}

export interface RunView {
  requestId: string | null
  scene: string | null
  status: RunStatus
  /** `start.lamps` = 本次**实际参与**的维度（dims 裁剪后的结果） */
  participated: string[]
  rounds: RoundView[]
  summary: SummaryView | null
  usage: UsageView | null
  finishReason: string | null
  /**
   * ★★ **流内** `error` 事件（2026-10-06 加 · 差异单 B 组补完）。
   *
   * ★ 为什么它不是"那条错误提示"——两者同名但完全不同：
   *   · **请求失败**（HTTP 层）⇒ 运行**根本没跑起来** ⇒ 走 `runError` / `ErrorSurface`：
   *     一条**可关闭**的提示。
   *   · **流内 `error`** ⇒ 运行**跑起来了**，中途服务端报一条实况（如"积分不足"）
   *     ⇒ 它是**运行记录的一部分**：**不可关闭、不打断视图**，按到达顺序留着。
   * ★ 契约示例里 `error` 排在 `usage` 之后、`done` 之前 ⇒ 它**不是终止信号**，流会继续。
   */
  errors: RunErrorView[]
}

export const EMPTY_RUN: RunView = {
  requestId: null,
  scene: null,
  status: 'idle',
  participated: [],
  rounds: [],
  summary: null,
  usage: null,
  finishReason: null,
  errors: [],
}

/**
 * 归约。
 * @param events   契约事件序列（mock / 真 SSE 均可）
 * @param stopped  客户端是否已停止接收（由 UI 传入 —— 它不属于事件流，见 R5）
 */
export function reduceRun(events: readonly SceneRunEvent[], stopped = false): RunView {
  const view: RunView = { ...EMPTY_RUN, participated: [], rounds: [] }
  /** ★ 归组键必须 (round, lamp) —— 见 R1 */
  const lampIndex = new Map<string, LampView>()
  const roundIndex = new Map<number, RoundView>()

  /** 取或建某一轮的分段。`fromLampEvent` = 该分段是**兜底**出来的（没见着 round_start）。 */
  const ensureRound = (round: number, reason: string | null, fromLampEvent = false): RoundView => {
    const hit = roundIndex.get(round)
    if (hit !== undefined) return hit
    const created: RoundView = {
      round,
      /**
       * ★★ 「没有 reason」有**两种**，必须说成两句不同的话（2026-10-05 抓到的真缺陷）：
       *   · `fromLampEvent` ⇒ 压根**没收到 `round_start`**（那是我们的兜底分组）
       *   · 否则           ⇒ **收到了 `round_start`，但服务端没给 `reason`**
       * 原来一律写成"（未收到轮次开始事件）" ⇒ 服务端明明发了却说没收到，
       * **那是错误陈述** —— 比不显示更坏。
       * （触发背景：服务端 2026-10-05 补发了 `round_start`，但它的 data 是
       *  `{round, lamps}`，**没有** §3.4 里的 `reason` ⇒ 这条立刻显形。）
       */
      reason: reason ?? (fromLampEvent ? '（未收到轮次开始事件）' : '（服务端未给本轮说明）'),
      // ★ 兜底分组才算 degraded；"收到了但没给说明"**不是** degraded，是服务端少给一个字段
      degraded: fromLampEvent,
      lamps: [],
      verdict: null,
    }
    roundIndex.set(round, created)
    view.rounds.push(created)
    return created
  }

  const ensureLamp = (round: number, lamp: string, agent: string | null): LampView => {
    const key = lampKey(round, lamp) // ← ★ 契约提供的键构造，不许本地拼字符串
    const hit = lampIndex.get(key)
    if (hit !== undefined) {
      if (agent !== null && hit.agent === null) hit.agent = agent
      return hit
    }
    const created: LampView = { lamp, agent, lines: [], verdict: null, detail: '', latencyMs: null }
    lampIndex.set(key, created)
    ensureRound(round, null, true).lamps.push(created)
    return created
  }

  for (const e of events) {
    switch (e.event) {
      case 'start': {
        view.requestId = e.requestId
        view.scene = e.scene
        view.participated = [...e.lamps]
        break
      }
      case 'round_start': {
        ensureRound(e.round, e.reason)
        break
      }
      case 'lamp_start': {
        ensureLamp(e.round, e.lamp, e.agent)
        break
      }
      case 'lamp_delta': {
        ensureLamp(e.round, e.lamp, null).lines.push(e.text)
        break
      }
      case 'lamp_done': {
        const l = ensureLamp(e.round, e.lamp, null)
        l.verdict = e.verdict
        l.detail = e.detail
        l.latencyMs = e.latencyMs
        break
      }
      case 'round_done': {
        ensureRound(e.round, null, true).verdict = e.verdict
        break
      }
      case 'summary': {
        // ★ `conditions` 契约里是必填；服务端给了就给，没给就空数组（不编内容）
        const conditions = Array.isArray(e.conditions) ? [...e.conditions] : []
        // ★★ 维度信息：**服务端给没给**是两件事，必须分开记（见 SummaryView.dimsReported）
        const hasDims = Array.isArray(e.participatedDims) && Array.isArray(e.skippedDims)
        view.summary = {
          verdict: e.verdict,
          conditions,
          round: typeof e.round === 'number' ? e.round : 1,
          participatedDims: Array.isArray(e.participatedDims) ? [...e.participatedDims] : [],
          skippedDims: Array.isArray(e.skippedDims) ? [...e.skippedDims] : [],
          dimsReported: hasDims,
        }
        break
      }
      case 'usage': {
        // ★ 契约：usage 是**唯一可信计费口径**，客户端不得自行计算 ⇒ 原样存、原样显示
        //   ★ 兜底只用 `typeof` 判型（**不填 0**）：没有的数就让它"没有"，
        //     界面才可能如实说"未提供"。编一个 0 = 替服务端撒谎。
        const u = e as unknown as Record<string, unknown>
        view.usage = {
          tokensIn: typeof u['tokensIn'] === 'number' ? u['tokensIn'] : 0,
          tokensOut: typeof u['tokensOut'] === 'number' ? u['tokensOut'] : 0,
          credits: typeof u['credits'] === 'number' ? u['credits'] : 0,
          balanceAfter: typeof u['balanceAfter'] === 'number' ? u['balanceAfter'] : null,
          note: typeof u['note'] === 'string' && u['note'] !== '' ? u['note'] : null,
        }
        break
      }
      case 'done': {
        view.finishReason = e.finishReason
        break
      }
      /**
       * ★★ 流内 `error`（契约 §3.4 · 2026-10-06 补）。
       *
       * ★ **不改 `status`**：收到它**不代表这次运行结束了**（契约示例里它排在 `done` 之前）
       *   ⇒ 不能在这里把 status 置成 `done`/失败 —— 那是**替服务端下结论**。
       *   若服务端之后真不发 `done`，流结束时的"提前结束"检查会**如实说出来**。
       * ★ **按到达顺序留着**（可能是多条）：同一次运行里不同阶段各报一条是合理的，
       *   合并/去重都会丢掉"发生过几次"这个信息。
       */
      case 'error': {
        view.errors = [
          ...view.errors,
          {
            code: typeof e.code === 'string' ? e.code : '',
            message: typeof e.message === 'string' ? e.message : '',
          },
        ]
        break
      }
    }
  }

  view.status = view.requestId === null ? 'idle' : (stopped ? 'stopped' : (view.finishReason === null ? 'running' : 'done'))
  return view
}

/* ─────────────────────────── 渲染辅助（纯函数） ─────────────────────────── */

/**
 * 判定 → 配色档位。
 *
 * ★★ **未知判定必须回 `null`（中性灰），不能回 `undefined`** —— 2026-10-05 联调实测抓到的真洞：
 *   服务端已在发**契约里没有的第五类判定 `⚪未接入`**（`agents` 表为空时，维度无执行方）。
 *   原实现是 `VERDICT_TONE[verdict]`：
 *     · 类型上 `Record<Verdict, VerdictTone>` 让 TS 以为**永远有值**（类型在说谎）
 *     · 运行时未知键得 `undefined` ⇒ 下游 `tone === null ? 灰 : TONE_BG[undefined]` 走后者
 *       ⇒ `background: undefined` ⇒ **徽标没有底色**，而"兜底那行"永远到不了
 *   ⇒ **兜底写了但不可达 = 没有兜底**。这里 `?? null` 把它接上。
 *   （这也是"第三道闸门·客户端不渲染未授权/未知取值"的落点。）
 */
export function toneOf(verdict: Verdict | null): VerdictTone | null {
  if (verdict === null) return null
  return VERDICT_TONE[verdict] ?? null
}

export const STATUS_TEXT: Record<RunStatus, string> = {
  idle: '尚未运行',
  running: '运行中',
  // ★ R5：断开 = **已停止接收**。契约明文禁止写「已取消」——
  //   因为服务端仍在算完并落 lamp_runs，写"已取消"就是在说一件没发生的事。
  stopped: '已停止接收',
  done: '已完成',
}

export const STOPPED_EXPLAIN = '已停止接收 —— 服务端仍在算完并落 lamp_runs；最终判定以服务端报告为准。'

export const DIMS_FOOTER = {
  participated: '本次参与维度',
  skipped: '未参与维度',
  basis: '裁剪依据',
} as const
