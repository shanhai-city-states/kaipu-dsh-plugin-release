/**
 * 山海·开铺 · 契约层 · 接口形状（I-3）
 * =====================================================================
 * ★ 只放**契约里有的**字段。服务端内部实现、我方 Agent 资产
 *   （skill 全文 / memory / 内部 prompt）**永远不进这些类型**（INV-9 / CN-1）。
 */

/* ────────────────────────── GET /agents ────────────────────────── */

export interface AgentCard {
  id: string
  slug: string
  /** 显示名，由服务端下发 */
  name: string
  role: string
  capabilities: string[]
  /** ★ 卡片摘要 · **非全文** */
  skillSummary: string
  /**
   * ★★ 三态，来源是**两处契约**（合并取值，不是拍脑袋加的）：
   *
   *   · `'enabled'`   已接入可用 —— 契约 §3.1（v1.0 冻结原件）
   *   · `'disabled'`  被有意关掉 —— 契约 §3.1：**返回全部（含 disabled）**，
   *                   界面灰显「已停用」不许点。理由：看不见被关掉，用户会以为是自己出错（004 Q14）。
   *   · `'pending'`   ★ **占地未接入** —— 契约 v1.3 §23.4（追加节 · 2026-10-05）
   *                   明文新增：取值 `"enabled"` 已接入可用 ｜ `"pending"` 占地未接入。
   *                   对应 `/agents` 的**占位条目**（与 `lamp_start.agent` 的 `id` 同源），
   *                   以及 §12.1 变更 #11「`agentId: null` = 该维度待接入」。
   *
   * ★★ `'pending'` 与 `'disabled'` **绝不能混**（2026-10-05 真服务端实测抓到过）：
   *   · `pending` = **还没有人接这个位子**（正常态，等接入）
   *   · `disabled` = **有人把它关掉了**（一个"某人在某时做了决定"的事实）
   *   两者给用户的**下一步动作完全不同**：前者"去接入"，后者"去问为什么关掉"。
   *   把 `pending` 显示成「已停用」不是"保守"，是**编造了一个不存在的事实**。
   *
   * ⚠️ ~~待对方澄清~~ → ✅ **已裁定（对方 `034` §二 · 2026-10-06）**：
   *   **值域 = 三值**（`enabled` | `pending` | `disabled`）—— 取"**保留设计意图**"：
   *   · `disabled` 是**已定义的保留值**：语义 = **某执行方被关停**，界面灰显「已停用」不许点
   *     （承 §3.1 与 004 Q14「看不见被关掉，用户会以为是自己出错」）
   *   · **当前实现读数只有二值**（`enabled` | `pending`）—— 因为"关停 Agent"这个**动作尚未实现**
   *   ⇒ ★ 对方把原 §23.4 的毛病点出来了：它把「**值域**」与「**当下实现读数**」写成了同一件事，
   *     读者会以为"契约只允许二值"。**订正后两者分开**（值域归值域、读数归读数）。
   *   ★ 对方并认了我方 `033 §四` 的方向判断（"是我方欠一句答复，不是等你"）。
   */
  status: 'enabled' | 'pending' | 'disabled'
  /** ★ 可能为 `0`（占位条目不带版本）⇒ 界面**不要**把 0 当作有意义的值显示 */
  version: number
}

export interface AgentsResponse {
  agents: AgentCard[]
}

/* ────────────────────────── GET /scenes ────────────────────────── */

/** ★ 契约变更 #3：`lamps` 从**字符串数组**改为**对象数组** */
export interface SceneLamp {
  lamp: string
  /** ★ `null` ⇒ **该维度尚未接入执行方** ⇒ 界面显「待接入」。
   *  这是 A-3「场地零内置可跑」的用户可见面 —— **当一等公民做**。 */
  agentId: string | null
  agentName: string | null
  /**
   * ★★ 契约 **v1.5 §3.3** 已落：**审核面职责短名**（如「工程落地与系统维护」）。
   *
   * ★ 权威源 = **官网 `.t-role`**（契约原文：**职责短名跟官网走 · 灯名跟契约走** ——
   *   同一批人，两个面向）。
   * ★ **单灯场景可为空串**（如 `light-review`）—— 契约明写「**不给假职责**」：
   *   拿不到就留空，**不许编一个听起来像的**。
   * ★ 写成**可选**（`?`）：服务端是否已下发未实测，可选 = **两种响应都能读**，
   *   不会因为缺这个字段而把整份场景清单判成非法。
   */
  duty?: string
  /** 职责的一句话说明（如「把图纸砌成城墙」）—— 与 `duty` 同源、同场合使用 */
  dutyNote?: string
}

export interface LoopPolicy {
  maxLoop: number
  maxGlobalLoops: number
}

/**
 * ★★ 权威形状在**契约 v1.3 §23.3**（`#23` 追加节）：**数组**，不是对象。
 *
 *      seatHolders: [{ seat, holderType, holderId, holderName }]
 *
 * ⇒ 2026-10-05 按契约改正（我方原类型是「对象 + 三个固定键」的**早期推测形状**，
 *   契约落纸后以契约为准 —— 这种"我方先猜、契约后定"的字段要**照契约改回来**）。
 *
 * ★ 现状：服务端**尚未下发**（§23.4 标「⏸ 待落地 · P1」）⇒ 本次改类型**不影响任何现有行为**，
 *   也正是"趁没落地时对齐"，免得落地时才发现两边形状不同。
 */
export interface SeatHolder {
  /** 执行位名（实测四席：`execution` / `audit` / `management` / `signature`） */
  seat: string
  /**
   * 承担方类型。
   *
   * ⚠️ ~~契约内部两套词表（待明确）~~ → ✅ **已裁定（对方 `034` §三 · 2026-10-06）**：
   *
   * ```text
   * 权威值域 = builtin | external | platform   （none 兜底：holder_type 为空时）
   *   builtin  —— 平台内建的备选承担方（智囊团 / 山海第三方审计 / 山海管理方）
   *   external —— 外部接入的 Agent（客户自有 / 第三方）
   *   platform —— 平台自身提供的服务位（当前仅签名位 shanhai-signer）
   *   none     —— 无承担方（兜底）
   * ```
   *
   * ★ **真缺陷定位**：原 §23.3 **写漏了 `builtin`** —— 而它恰恰是 `role_seats` 种子里的
   *   **默认值**（四席中 `execution`/`audit`/`management` 三席即 `builtin`）。
   *   与 `status` 那处**同源**：写契约时没对照实现。
   *
   * ★★ **形状各异是「有意」，不是冲突**（对方明写，防下次又被当矛盾报上来）：
   *   `/roles/seats` 用**嵌套** `holder:{type,id,name}`（贴"席位-承担方"对象模型）；
   *   `/scenes[].seatHolders` 用**扁平** `{seat,holderType,holderId,holderName}`（贴"场景快照"逐行表达）。
   */
  holderType: 'builtin' | 'external' | 'platform' | 'none'
  holderId: string
  holderName: string
}

export type SeatHolders = SeatHolder[]

/** ★ 契约变更 #17（**纯追加**）：场景分类 —— 让客户**先认出场合**，而不是先学术语 */
export interface SceneCategory {
  key: string
  label: string
  /** 客户视角一句话（svc-012 §4.1 给的语义） */
  intent: string
}

/**
 * ★ 契约变更 #17：推荐组合。
 *
 * ★★ `when` 是**「对什么场合推荐」**，**不是「高频/热门」** —— svc-012 §4.1 点名：
 *    「若你在界面上要显示『推荐』二字，请用『适合什么场合』，不要写『热门/多数人选』——
 *      后者需要统计依据，现在没有，写了就是编。」
 */
export interface SceneRecommendation {
  key: string
  label: string
  /** 客户能认出的场景话（如「就一个东西，想快点知道有没有硬伤」） */
  when: string
  outputLevel: OutputLevel
}

export interface SceneCard {
  scene: string
  label: string
  version: string
  lamps: SceneLamp[]
  loopPolicy: LoopPolicy
  /** true ⇒ `run` 需带 `reservationId`；无有效预约 ⇒ 409 not_checked_in */
  requiresExternal: boolean
  /** ★ 契约变更 #3 新增 */
  seatHolders?: SeatHolders
  description?: string
  /**
   * ★ 所属分类 key（对应 `ScenesResponse.categories[].key`）。
   *
   * ★★ **空串不是正常态，是服务端 bug**（契约 v1.3 §23.3 ＋ 差异单 D 组）：
   *   `categories[].scenes` 是**单一正本**；每个 scene 的 `category` 必须等于**它所属组的 key**。
   *   2026-10-05 实测：`multi-dim-review` 的 `category` 是**空串**，却列在 `standard_review` 组的
   *   `scenes` 里 —— 对方已认领（服务端回填），**修完给读数**。
   *
   * ★ 界面对空串仍要**容错**（按「未归类」单列如实展示 —— 契约 #17「未归类不藏」），
   *   但**不许把空串当成契约允许的常态**：那是我们的兜底，不是对方的承诺。
   *   （差别要紧：兜底写成"正常"，就会把对方的 bug 静默吸收掉，谁都不再知道它还在。）
   */
  category?: string
}

export interface ScenesResponse {
  scenes: SceneCard[]
  /**
   * ★ 契约变更 #17 新增。
   * ★ **空分类不出**：某分类若一个场景都没有 ⇒ 响应里**不会出现**它
   *   ⇒ 客户端**按响应渲染即可，不必自己判空**（svc-012 §4.2）。
   */
  categories?: SceneCategory[]
  /** ★ 契约变更 #17 新增 */
  recommendations?: SceneRecommendation[]
}

/* ───────────────────── POST /scene/{id}/run ───────────────────── */

export type OutputLevel = 'light' | 'standard' | 'strict'

export interface SceneRunRequest {
  requestId: string
  target: string
  content: string
  /** 可选 · 裁剪参与维度（承 `run_when` 机制） */
  dims?: string[]
  /** ★ 只影响输出详略；**轮数完全由服务端 loopPolicy 决定**（004 Q10） */
  outputLevel?: OutputLevel
  /** 仅 `requiresExternal` 场景可带 */
  reservationId?: string
}

/* ──────────────── GET /scene/run/{requestId}（变更 #5） ──────────────── */

export type SceneRunState = 'running' | 'done' | 'failed'

export interface SceneRunResult {
  requestId: string
  scene: string
  state: SceneRunState
  round: number
  verdict: string
  participatedDims: string[]
  skippedDims: string[]
  lamps: Array<{ lamp: string; verdict: string; detail: string; latencyMs?: number }>
  usage: { tokensIn: number; tokensOut: number; credits: number; balanceAfter: number }
  startedAt: string
  endedAt: string
}

/* ─────────────────────── /reservations（P2） ─────────────────────── */

export type ReservationStatus =
  | 'BOOKED'
  | 'CHECKIN_WINDOW'
  | 'CHECKED_IN'
  | 'RUNNING'
  | 'DONE'
  | 'AUTO_CANCELLED'
  | 'CANCELLED'

/** ★ 客户端**不镜像服务端状态机**（004 §五 #4）—— 只渲染 status + actions */
export interface ReservationView {
  reservationId: string
  status: ReservationStatus
  checkin?: {
    opensAt: string
    deadline: string
    /** ★ 服务端给 —— 客户端**不要自己算倒计时基准**（防时间漂移） */
    windowRemainingSec: number
  }
  serverTime: string
  actions: string[]
}

/* ─────────────────────── /capabilities（P2） ─────────────────────── */

export interface CapabilitiesResponse {
  platform: string
  version: string
  can: Array<{ capability: string; detail: string }>
  /** ★ 必须**完整展示**（对外承诺的硬要求） */
  cannot: Array<{ capability: string; detail: string }>
  dataPolicy: {
    owner: string
    /** ★ 契约变更 #14：结构化两项。**绝不写成笼统的"30天"**
     *  —— 那等于自己否掉 R4「报告带签可对外」这个卖点。 */
    retention: { process: string; signedReport: string }
    sharing: string
  }
  billing: { model: string }
}
