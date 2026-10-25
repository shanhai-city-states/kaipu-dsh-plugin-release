/**
 * 山海·开铺 · 工位插件 · 契约层类型（期1）
 * =====================================================================
 * ★ 本文件是「工位持久化态」wire 形状的唯一出处（host 出参 / client 消费，
 *   两端都从这里 `import type`，不各写一份 —— 否则 host/client 必然漂移）。
 *
 * ★ 设计纪律四点 + 硬边界的落点都标在类型上：
 *   - ① fail-open 代价          → AsyncReviewBasis.notifyFailOpen + notifyCostNote
 *   - ② 邀请带有效期            → Invite.expiresAt（ISO8601，过期不占座）
 *   - ③ 离座≠移除                → Seat.presence × Seat.membershipActive
 *   - ④ 人类协作方/Agent 分开    → Member.kind / Trace.actorKind
 *
 * ★★ 权威源方向（写死，不要反着读）：
 *   **`Seat` 是权威源，`Member` 的 `presence` / `membershipActive` 是快照。**
 *   座面渲染、汇总计数、不变量判定一律以 `Seat` 为准；`Member` 上那两个字段只用于
 *   「按人查」的读路径，**不得**成为第二个可独立写入的权威。
 *   两侧不一致由 host 纯函数 `assertSeatMemberConsistency()` 判出（判据脚本会跑）。
 *
 * ★ 非法态（类型层不禁，靠不变量 + 判据拦）：
 *   · `status:'occupied'` 且 `membershipActive:false` —— 既占着座又说不是成员
 *   · `status:'vacant'` 且 `presence` 非 null    —— 空位却有在场状态
 *   · `membershipActive:false` 且 `status` 非 vacant —— 移除未释放座位
 *   ⇒ 一句话：**移除 = 释放回空位池**（`status:'vacant'` + `presence:null` + `membershipActive:false`）；
 *     「曾有成员被移除」这件事落 trace，不靠座位残留态表达。
 */

/** 在场状态：离座(away)≠ 移除（③ 只翻 presence，不翻 membershipActive） */
export type Presence = 'present' | 'away'
/** ④ 人类协作方(human) 与 Agent 订阅者(agent) 是两个集合 */
export type MemberKind = 'human' | 'agent'
/** 座位占用 / 空位 */
export type SeatStatus = 'occupied' | 'vacant'
/** 留痕类别（human/Agent 分离靠 actorKind，不靠 kind 本身） */
export type TraceKind = 'seat' | 'ball' | 'round' | 'project' | 'formal'
/** 状态面板多球灯次（承 v0.4 多球） */
export type BallLamp = 'red' | 'green' | 'amber' | 'blue'

/** 成员：协作方（人）/ 订阅者（Agent） */
export interface Member {
  id: string
  name: string
  /** ④ 人类协作方 vs Agent 订阅者是两个集合，不混列、不互推 */
  kind: MemberKind
  seatId?: string
  /** ③ 在场状态（离座只翻这个）· ★ 快照字段 —— 权威源是 `Seat.presence` */
  presence: Presence
  /** ③ 在编/移除（移除才翻这个，释放座位回空位池）· ★ 快照字段 —— 权威源是 `Seat.membershipActive` */
  membershipActive: boolean
}

/** 邀请（带有效期 · ②） */
export interface Invite {
  id: string
  seatId: string
  toName: string
  /** ② 邀请只发给人类协作方 */
  toKind: MemberKind
  /** 发出时刻（ISO8601） */
  issuedAt: string
  /** ② 必须有过期时间，过期自动失效、不占座 */
  expiresAt: string
  used: boolean
}

/** 座位（含空位 + 邀请）—— ★ 座位态是**权威源**（Member 上两字段是它的快照） */
export interface Seat {
  id: string
  label: string
  status: SeatStatus
  holderId?: string
  /**
   * ③ 该座位当前在场状态。
   * ★ 可空：`status:'vacant'` ⇒ 必须是 `null`（空位没有「在场」可言）。
   *   这不是「离座」——离座是 `status:'occupied'` + `presence:'away'`。
   */
  presence: Presence | null
  /** ③ 该座位归属在编（移除=false ⇒ 释放回空位池；此时 status 必须是 vacant、presence 必须是 null） */
  membershipActive: boolean
  /** 空位待邀请 / 占用位可再邀 */
  invite?: Invite
}

/** 球（状态面板 · 多球） */
export interface Ball {
  id: string
  label: string
  lamp: BallLamp
  holderSeatId?: string
  roundId?: string
}

/** 轮次（B3） */
export interface Round {
  id: string
  index: number
  title: string
  at: string
  byName: string
  what: string
}

/** 留痕（身份四字段 · 承 M-096） */
export interface Trace {
  id: string
  kind: TraceKind
  actorId: string
  actorName: string
  /** ④ 人留痕 vs Agent 订阅事件——区分来源 */
  actorKind: MemberKind
  /** 何时 */
  at: string
  /** 从哪：桌面端 / 浏览器入口 */
  from: 'desktop' | 'browser'
  /** 是否协作方 */
  isCollaborator: boolean
  summary: string
}

/** 异步审核基础（C 双轨 · ① fail-open 代价） */
export interface AsyncReviewBasis {
  /** C 双轨：events 落库本体 + 外发叫醒旁路 */
  dualTrack: true
  notifyChannel: 'email' | 'feishu' | 'none'
  /** ① 外发失败不影响落库 */
  notifyFailOpen: boolean
  /** ① 代价须明示：未叫醒时人类方靠回座 replay 补阅 */
  notifyCostNote: string
  /** 增量同步端点（承 svc-014 裁定） */
  eventsSinceEndpoint: string
}

/**
 * 数据源态 —— ★ **唯一出处**（client/host/面板一律 import 本类型，不各自再写一份字面量）。
 *
 * ★★ 口径（写死，防「四态/五态」两种说法再次分叉）：
 *   **共五态 = `scaffold` 种子态 + 四态数据源态**。
 *     · `scaffold`     初始版本的演示种子（诚实标非 live）
 *     · `live`         真服务端读到了
 *     · `unreachable`  想连真服务端但没连上（如实说）
 *     · `no_channel`   连通道都没取到（环境问题，与「服务端故障」是两件事）
 *     · `stale`        通道在，但读不到工位数据（常见：host half 未注册端点）
 *   ⇒ 说「四态」时只能指后四项（数据源态）；说「五态」时指全部。
 *
 * ⚠️ 边界（不属本条闭合）：本类型描述的是**数据源**，不是**连接态**。
 *   `client/live.ts` 里 `kind = st.source` 是既有用法；把「数据源态 / 连接态」
 *   彻底分层要改 wire 形状（contract + host + client 三层）⇒ 挂账到接真身轮。
 */
export type SourceKind = 'scaffold' | 'live' | 'unreachable' | 'no_channel' | 'stale'

/** 工位完整持久化态（初始版本渲染对象 · 由 `kaipu-workstation/state` 返回） */
export interface WorkstationState {
  projectId: string
  name: string
  /** 两层隔离：account_id=租户 / project_id=工位空间（不合并） */
  accountId: string
  /** 数据源五态（见 `SourceKind`：scaffold 种子态 + 四态数据源态）· 绝不悄悄回落 mock */
  source: SourceKind
  members: Member[]
  seats: Seat[]
  balls: Ball[]
  rounds: Round[]
  traces: Trace[]
  async: AsyncReviewBasis
  /** 二分口径（svc-014 裁定4）：🔴实时在座才见 / 🟢历史回座 replay */
  channels: {
    live: { visible: 'present_only'; note: string }
    history: { replayable: true; endpoint: string }
  }
}

/** `kaipu-workstation/status` 出参（面板第一件要知道的事：接没接上 + 种子概览） */
export interface WorkstationStatusPayload {
  connected: boolean
  projectId: string
  source: WorkstationState['source']
  /**
   * 座位汇总 —— ★ **四数分账**（不是「正交」，也不是两两互斥）：
   *   · `occupied`       `status==='occupied'`（**含** away）
   *   · `awayButActive`  **⊆ occupied**（占用位里 presence==='away' 的子集）
   *   · `vacant`         `membershipActive===true && status==='vacant'`（在编的空位）
   *   · `removed`        `membershipActive===false`（已移除 · 座位已回空位池）
   *   ⇒ **四数合计 == 座位数**（`awayButActive` 是 `occupied` 的子集，不计入合计）。
   */
  seats: { occupied: number; vacant: number; awayButActive: number; removed: number }
  /** ★ 如实说明初始版本是 scaffold 种子（不是故障、不是 live） */
  note?: string
}

/* ═══════════════════════════════════════════════════════════════════════
 * 管理助理授权（承响石 018 号方案 + A/B/C/D 拍板）
 * ═══════════════════════════════════════════════════════════════════════
 * ★ 三个概念分开，不许混写：
 *   · 座位（seat）      = 这人在哪个位子上（静态归属，如 management_assistant）
 *   · 授权（grant）     = 这份代管权**何时到期**（动态租约，有 ttl）
 *   · 派生权限（tier）  = `effective_authority()` 按授权**实时**算出来的
 *   ⇒ 界面读 `tier/via`（派生），不读 seat 猜权限。
 */

/** 一张授权单 —— 代管权的租约实体 */
export interface GrantRow {
  grantId: string
  /** 被授权人（谁替你管） */
  granteeId: string
  granteeName: string
  /** 授予人（铺主本人） */
  grantedBy: string
  /** 租约时长（小时）· 档位见 `GrantListPayload.ttlOptions` */
  ttlHours: number
  createdAt: string
  expiresAt: string
  /** 剩余秒数（服务端算，客户端不自己减 —— 防时钟漂移各算各的） */
  remainingSeconds: number
  /** 状态：`available`（码已生成·还没人兑换）| `active`（代管中）| `expired` | `revoked`
   *  ★ 2026-10-23（083 单 G-1）：新增 `available` —— 授权码已生成但**还没被兑换**。
   *    这一档 `granteeId/granteeName` 是空的（还不知道会是谁），界面显示「已生成·未兑换」。 */
  status: string
  note?: string
  /** ★ 2026-10-23（G-1）：**码本身**的失效时间（7 天）。
   *  与 `expiresAt`（代管到期）是两件事：码 7 天内可用；代管从兑换那一刻起算 ttl。 */
  codeExpiresAt?: string
  /** ★ 2026-10-23（G-1）：这张单怎么来的 —— `code`（授权码兑换）/ `direct`（直传 granteeId） */
  via?: string
}

/** ★ 2026-10-23（083 单 G-1）：`/grants/generate` 的返回 —— **明文码只出现这一次** */
export interface GrantCodeIssued {
  grantId: string
  /** `SHANHAI-GRANT-XXXX-XXXX` · 库内只存 SHA256(code) */
  code: string
  /** 码的有效期截止（生成 + 7 天） */
  codeExpiresAt: string
  /** 兑换后能代管多久（小时） */
  ttlHours: number
}

/** `grantList` 出参 */
export interface GrantListPayload {
  grants: GrantRow[]
  /** 可选档位（24 / 72 / 168 小时）· 由服务端下发，客户端不硬编码 */
  ttlOptions: number[]
  accountId: string
}

/** `grantCreate` 出参 */
export interface GrantCreated {
  grantId: string
  granteeId: string
  ttlHours: number
  createdAt: string
  expiresAt: string
  remainingSeconds: number
  /** ★ 到期后落到哪个位子（D 案：转执行位 —— 人还在铺子里，权限收回） */
  seatAfterExpiry: string
  note: string
}

/** 授权留痕事件（谁·代谁·何时·做了什么） */
export interface GrantEvent {
  action: string
  actor: string
  onBehalfOf: string
  at: string
  detail?: string
}

/** `grantRevoke` / `grantEvents` 出参 */
export interface GrantEventsPayload {
  grantId: string
  events: GrantEvent[]
}

/* ═══════════════════════════════════════════════════════════════════════
 * ★★ 2026-10-24 · 邀请码补发闭环（083 第一批 · 块 A）
 *
 * 背景（星月任务书 §〇 · ②）：`consume_device_join_code()` 是**消费型**，
 * 拿旧码去校验会把 `used_at` 写死 ⇒ 申请人反而把自己最后一张码烧了。
 * 后端已补 `verify_join_code_no_consume()`；前端只按 §二 的契约对接，不碰服务端。
 *
 * 两种身份、两套视图（同一组件内分）：
 *   · 铺主   —— `GET /join/requests?status=pending`（200）⇒ 审批面板 + 红点数
 *   · 申请人 —— 该接口 403 `not_owner` ⇒ 只看自己那张申请的状态
 * ⇒ 用「列表能不能读」判身份，**不额外要一个 whoami-role 接口**
 *   （服务端契约只有 5 个端点，多要一个就要等一轮）。
 * ═══════════════════════════════════════════════════════════════════════ */

/** 待审批条目（`GET /join/requests?status=pending` 的 items 元素） */
export interface JoinRequestRow {
  requestId: string
  nodeId?: string
  seat?: string
  applicantName?: string
  /** human | agent */
  applicantKind: string
  reason?: string
  createdAt?: string
}

/** `joinRequests` 出参 */
export interface JoinRequestListPayload {
  items: JoinRequestRow[]
  count: number
}

/** `joinRequestGet` / `approve` 出参（`joinCode` 只在 approved 时有值） */
export interface JoinRequestStatusPayload {
  requestId: string
  /** pending | approved | rejected | expired */
  status: string
  joinCode?: string
  decidedAt?: string
}

/** `joinRequestCreate` 出参（201） */
export interface JoinRequestCreated {
  requestId: string
  status: string
  expiresAt?: string
}
