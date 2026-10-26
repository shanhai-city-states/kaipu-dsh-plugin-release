/**
 * 山海·开铺 · 工位插件 · client half —— 数据源层
 * =====================================================================
 * 面板只认这一层，**不关心数据从哪来**。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 数据源是**显式五态**，绝不悄悄回落
 * ══════════════════════════════════════════════════════════════════
 *   · `scaffold`    期1 本地持久化态（host 回 source='scaffold'，诚实标非 live）
 *   · `live`        真服务端读到了（待服务端五项落地后接真 `kaipu-workstation/state`）
 *   · `unreachable` 想连真服务端但没连上（★ 如实说）
 *   · `no_channel`  连通道都没取到（环境问题，与"服务端故障"是两件事）
 *   · `stale`       通道在，但读不到工位数据（常见：host half 未注册端点）
 *
 * ★ 读不到 ⇒ 返回**空 + 原因**，**绝不填演示数据**（与 wisdom `live.ts` 同取向）。
 */
import type { Invite, Member, Seat, SourceKind, WorkstationState } from '@shanhai/kaipu-contract'
import { callKaipu, type BridgeError, type BridgeResult, type BusinessErr, type ConnectionHandle } from './bridge.js'

/**
 * ★ 数据源态类型**只在契约层定义一处**（`@shanhai/kaipu-contract` 的 `SourceKind`）。
 *   本文件只 re-export，**不再写第二份字面量** —— 两份字面量 = 必然漂移
 *   （判据 `tools/check-workstation-parity.mjs` 断言 `SourceKind` 定义全仓仅 1 处）。
 */
export type { SourceKind } from '@shanhai/kaipu-contract'

/* ══════════════════════════════════════════════════════════════════
   一、连接句柄（模块级单例 —— 由 `WorkstationPanel.tsx` 的 wireConnection 注入）
   ══════════════════════════════════════════════════════════════════ */
let connection: ConnectionHandle | null = null

export function setConnection(conn: ConnectionHandle | null): void {
  connection = conn
}

export function hasConnection(): boolean {
  return connection !== null
}

/* ══════════════════════════════════════════════════════════════════
   二、快照
   ══════════════════════════════════════════════════════════════════ */

export interface WorkstationSnapshot {
  kind: SourceKind
  /** 状态带标签（正向诚实） */
  label: string
  /** 读不到时的原因（已翻译，不上屏技术原文） */
  reason: string | null
  /** 工位持久化态（scaffold/live 才有值；其余一律 null，绝不填演示数据） */
  state: WorkstationState | null
  server: { baseUrl: string; accountId: string } | null
}

function offline(kind: SourceKind, label: string, reason: string): WorkstationSnapshot {
  return { kind, label, reason, state: null, server: null }
}

/**
 * 「端点不存在」的**结构化码白名单**。
 * ★ 为什么要有这一层：网关返回的 `code` 是稳定契约，改端口/改文案它都不变；
 *   而按 `detail` 文案嗅探只是一种**兜底**（老宿主、代理层、被网关转译过的错
 *   往往只剩一句话，没有 code）。**能按码判就不猜文案**。
 */
const MISSING_ENDPOINT_CODES = new Set(['not_found', 'endpoint_not_found', 'no_handler', 'unknown_endpoint'])

function looksLikeMissingEndpoint(err: BridgeError): boolean {
  if (err.kind !== 'gateway') return false
  /* ① 结构化优先：code 命中白名单即判，不再看文案 */
  if (MISSING_ENDPOINT_CODES.has(err.code)) return true
  if (/^(?:http_)?404$/.test(err.code)) return true
  /* ② 文案兜底（★ 不可去除）：上游只回一句话时，这是**唯一**可得信号。
     去掉它 = 老宿主上「端点没注册」会被误报成「服务端故障」，用户按错的方向排查。 */
  const s = `${err.code} ${err.detail}`.toLowerCase()
  return (
    s.includes('not_found') ||
    s.includes('notfound') ||
    s.includes('no_handler') ||
    s.includes('no handler') ||
    s.includes('unknown_endpoint') ||
    s.includes('unknown endpoint') ||
    s.includes('endpoint_not_found') ||
    s.includes('路径不存在')
  )
}

/** 读工位持久化态。任何一步失败都如实返回，不回落 mock */
export async function loadWorkstationState(signal?: AbortSignal): Promise<WorkstationSnapshot> {
  if (connection === null) {
    return offline('no_channel', '通道不可用', '没取到宿主的数据通道。这是环境问题，不是服务端故障。')
  }

  const r = await callKaipu<WorkstationState>(connection, 'state', {}, signal)
  if (r.ok !== true) {
    if (!('business' in r) && looksLikeMissingEndpoint(r.error)) {
      const ownBug = /\/api\//.test(r.error.detail) || /路径不存在/.test(r.error.detail)
      return offline(
        'stale',
        '工位数据读不到',
        ownBug
          ? '接入地址不对 —— 数据通道未被正确寻址（路径里混入了内部通道段），请核对接入地址配置。'
          : '数据通道未就绪 —— 工位数据由本插件 host half 提供，它可能未加载成功。',
      )
    }
    return offline('unreachable', '未连上', 'business' in r ? r.business.message : r.error.detail)
  }

  const st = r.data
  return {
    kind: st.source,
    label: st.source === 'scaffold' ? '本地持久化态' : '已接入',
    reason: null,
    state: st,
    server: { baseUrl: '', accountId: st.accountId },
  }
}

/* ══════════════════════════════════════════════════════════════════
   二·五、期4 组织层（真数据 · 真操作）
   ★ 与上面 scaffold 那套的区别：这些走服务端 `/org/*`，没有 baseUrl 就
     返回 `not_configured` 的 business 错误 —— 面板据此显示「未接入」，
     **绝不假装成功**。
   ══════════════════════════════════════════════════════════════════ */

/** 组织节点（服务端原样字段，snake_case） */
export interface OrgNodeView {
  node_id: string
  name: string
  parent_node_id?: string | null
  node_kind?: string
  capabilities?: string
  created_at?: string
  /** 被多少席位绑定 */
  seat_count?: number
  /** 还有多少下级工位 */
  child_count?: number
  /** system = 建场时建的（永久不可删）· user = 用户自己加的 */
  origin?: string
  /** ★ 工位编号（沟通用「几号工位」）—— 服务端按创建顺序分配，删除不回收 */
  seq?: number
  /** ★ 谁坐在这里（服务端按 agents.lamp ↔ role_seats.seat 归位）
   *  ★ 2026-10-24（083-r2）：新增 `joinState` 三态（present/joined/invited）——
   *    原来只有 `online` 一个布尔，分不出「离线」与「压根没来」。 */
  holders?: Array<{
    agentId: string; name: string; seat: string; seatLabel?: string; online?: boolean
    lastSeen?: string | null; joinState?: string; onRoster?: boolean; hasCred?: boolean
  }>
  /** ★ 2026-10-24（083-r2）：邀请发了、人还没来。
   *  只有 `holders` 为空时它才有意义 —— 人已到就不该再显示「已受邀」。 */
  /** ★ 2026-10-26（4️⃣）：`expiresAt` 前端要靠它判「码还有效吗」；
   *  `url` 是给人复制的邀请链接（服务端签发时一并给出）。 */
  invited?: {
    lamp?: string; invitedName?: string; invitedAt?: string
    expiresAt?: string; url?: string
  } | null
  /** 非空 = 不能删，值就是原因（如「被 4 个席位占用」） */
  undeletable?: string | null
  /** ★ false = 不能改名（位被不可替换的席位占用，如平台签名位） */
  renameable?: boolean
  /** ★ 这个节点对应的 seat key（execution / audit / management / signature / strategy） */
  seatKey?: string
}

/** 组织树快照 */
export interface OrgTreeView {
  nodes: OrgNodeView[]
  edges: Array<{ edge_id: string; from_node_id: string; to_node_id: string; edge_kind?: string }>
  org_ready: boolean
}

export type OrgResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

function orgError(r: { business?: BusinessErr; error?: BridgeError }): OrgResult<never> {
  if ('business' in r && r.business) {
    return { ok: false, code: r.business.code, message: r.business.message }
  }
  const detail = r.error?.detail ?? '未知错误'
  return { ok: false, code: r.error?.code ?? 'unknown', message: detail }
}

/** 读组织树 */
export async function loadOrgTree(signal?: AbortSignal): Promise<OrgResult<OrgTreeView>> {
  if (connection === null) {
    return { ok: false, code: 'no_channel', message: '没有数据通道 —— 工位 host 未加载。' }
  }
  const r = await callKaipu<OrgTreeView>(connection, 'orgTree', {}, signal)
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 新建工位节点 */
export async function createOrgNode(
  name: string,
  parentNodeId?: string,
): Promise<OrgResult<OrgNodeView>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const query: Record<string, unknown> = { name }
  if (parentNodeId) query.parentNodeId = parentNodeId
  const r = await callKaipu<OrgNodeView>(connection, 'orgNodeCreate', query)
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★★ 2026-10-26（阿开定 · 钥匙保险箱）：重置一位 Agent 的连接
 *
 *  动作（服务端）：① 当前钥匙进 24h 宽限期 ② 新钥匙放进保险箱 ③ **不**当场换钥匙
 *  ⇒ 与「请出」的根本区别：**人还在，只是换钥匙**；而且不断线（旧钥匙到期前一直可用）。
 *
 *  ★ 返回体里**没有新密钥明文** —— 新钥匙在服务端等 Agent 自取。
 *    所以铺主不需要、也拿不到明文：这条路径的全部意义就是「人不搬钥匙」。
 */
export async function resetAgentKey(agentId: string): Promise<OrgResult<{ agentId: string; pendingSecret: boolean; graceHours: number; message: string }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ agentId: string; pendingSecret: boolean; graceHours: number; message: string }>(
    connection, 'agentResetConnection', { agentId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★ 请出一个位上的 Agent（只清这一个） */
export async function evictSeat(seat: string, agentId?: string): Promise<OrgResult<{ seat: string; evicted: { agentId: string; name: string } }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ seat: string; evicted: { agentId: string; name: string } }>(
    connection, 'seatEvict', agentId !== undefined && agentId !== '' ? { seat, agentId } : { seat })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★ 通知列表 */
export async function loadNotifications(): Promise<OrgResult<{ items: Array<{ kind: string; taskId: string; title: string; at: string; text: string; unread: boolean; projectId?: string; projectName?: string }>; unread: number; total: number; seenAt: string }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ items: Array<{ kind: string; taskId: string; title: string; at: string; text: string; unread: boolean; projectId?: string; projectName?: string }>; unread: number; total: number; seenAt: string }>(
    connection, 'notifications', {})
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★ 通知全部标为已看 */
export async function markNotificationsRead(): Promise<OrgResult<{ seen: boolean }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ seen: boolean }>(connection, 'notificationsRead', {})
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★ 查最新插件版本（有更新时提示卸载重装） */
export async function checkPluginVersion(current: string): Promise<OrgResult<{ current: string | null; latest: string | null; updateAvailable: boolean; notes: string }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ current: string | null; latest: string | null; updateAvailable: boolean; notes: string }>(
    connection, 'pluginVersion', { current })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★ 打包下载一个交互包（所有座位） */
export async function exportPack(interactionId: string): Promise<OrgResult<{ filename: string; dataBase64: string; files: number; bytes: number }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ filename: string; dataBase64: string; files: number; bytes: number }>(
    connection, 'packExport', { interactionId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★ 2026-10-21：本铺**有资料**的交互清单（打包下载前先看这个，别猜 iid） */
export async function loadPackInteractions(): Promise<
  OrgResult<{ interactions: Array<{ interactionId: string; files: number; seats: number; lastAt: string }> }>
> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ interactions: Array<{ interactionId: string; files: number; seats: number; lastAt: string }> }>(
    connection, 'packsInteractions', {})
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★ 排定 24 小时后删除一个交互包 */
export async function purgePack(interactionId: string): Promise<OrgResult<{ interactionId: string; deleteAfter: string }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ interactionId: string; deleteAfter: string }>(connection, 'packPurge', { interactionId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★ 取消排定的删除 */
export async function cancelPurge(interactionId: string): Promise<OrgResult<{ interactionId: string; cancelled: boolean }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ interactionId: string; cancelled: boolean }>(connection, 'packPurgeCancel', { interactionId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★ 查删除状态 */
export async function purgeStatus(interactionId: string): Promise<OrgResult<{ interactionId: string; pending: boolean; deleteAfter: string | null }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ interactionId: string; pending: boolean; deleteAfter: string | null }>(
    connection, 'packPurgeStatus', { interactionId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** ★ 一键清场：让所有 Agent 离场（清人不移位 · 需 confirm='CLEAR'） */
export async function clearAgents(): Promise<OrgResult<{ cleared: number; agents: Array<{ agentId: string; name: string; seat: string }> }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ cleared: number; agents: Array<{ agentId: string; name: string; seat: string }> }>(
    connection, 'orgClearAgents', { confirm: 'CLEAR' })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 改名 */
export async function renameOrgNode(nodeId: string, name: string): Promise<OrgResult<unknown>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<unknown>(connection, 'orgNodePatch', { nodeId, name })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 归档（软删） */
export async function deleteOrgNode(nodeId: string): Promise<OrgResult<unknown>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<unknown>(connection, 'orgNodeDelete', { nodeId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/* ── 期5 · 任务层 ── */

/** 任务（服务端字段原样） */
export interface TaskItem {
  task_id: string
  title: string
  detail?: string
  status: 'open' | 'claimed' | 'done' | 'cancelled'
  created_by: string
  claimed_by?: string | null
  node_id?: string | null
  created_at: string
  claimed_at?: string | null
  done_at?: string | null
  result?: string | null
  /* ★ 期6-L1（2026-10-20）：任务↔资料绑定（服务端返回） */
  interactionId?: string
  fileCount?: number
  projectId?: string | null
  /** ★ 2026-10-21：发布人显示名（工位编号 + 昵称，如「#3 阿里星月」） */
  createdByName?: string
  /** ★ 2026-10-23（阿开定：不上向量上分类标签）—— 任务性质，**互斥单值**。
   *  status 是「流程走到哪」，kind 是「这是什么活」。Agent 靠它先分流再细看。 */
  kind?: 'requirement' | 'delivery' | 'report' | 'test' | 'other'
  /** ★ 2026-10-23 —— 细分关键词，多值。像 skill 的关键词：命中才跳进去看。 */
  tags?: string[]
}

/** 服务端 `groups` 分类分组回体（★ 2026-10-26 补回：此前误删） */
export interface TaskGroups {
  byKind: Record<string, TaskGroupBrief[]>
  byStatus: Record<string, TaskGroupBrief[]>
  kindCounts: Record<string, number>
  statusCounts: Record<string, number>
}

export interface TaskListResult {
  tasks: TaskItem[]
  counts: { open: number; claimed: number; done: number; cancelled: number }
  /** ★ 2026-10-23：`grouped=true` 时服务端给的分类分组（未请求则为 null） */
  groups?: TaskGroups | null
  /** ★ 2026-10-26 台阶⑤（甲案）：过滤后、切片前的全集条数。
   *  `total` 与 `counts` 口径不同，别混：
   *    - `counts` 九态分布，从 SQL 全量 `rows` 算（不含 required_tags/tags 过滤）
   *    - `total` 是本 agent **真正能看到**的条数（Python 侧过滤后）
   *  前端据 `tasks.length < total` 判「还有下一页」。不传 limit 时 total = 本次条数。 */
  total?: number
  limit?: number | null
  offset?: number
}

/** 服务端 `groups` 回体（只装最小字段，不含 detail） */
export interface TaskGroupBrief {
  taskId: string
  title: string
  status: string
  kind?: string
  tags?: string[]
  projectId?: string | null
  createdAt?: string
  createdByName?: string
  fileCount?: number
}

/** 读任务列表
 *  ★ 2026-10-23：`all` 参数**已失去作用面** —— 服务端改为默认全量返回（含 accepted）。
 *     保留形参只为不破坏调用方签名；传什么都一样。
 *  ★ 2026-10-26 台阶⑤（阿开定甲案）：新增 `page` 分页参数。
 *     ★ 默认不传 ⇒ 服务端全量返回，**前端行为零变化**。
 *       这才是甲案的关键：接口先定型，UI 不做没用的翻页（现在全库只有 5 条任务）。
 *     ★ 分页真正要解决的是**传输量**（每条任务带 detail 正文），不是查询次数 ——
 *       服务端 `count_pack_files_by_iids` 本来就是一条 SQL + GROUP BY（无 N+1）。
 */
export async function loadTasks(
  all: boolean,
  page?: { limit?: number; offset?: number },
): Promise<OrgResult<TaskListResult>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const query: Record<string, unknown> = all ? { all: true } : {}
  if (page?.limit !== undefined) query.limit = page.limit
  if (page?.offset !== undefined && page.offset > 0) query.offset = page.offset
  const r = await callKaipu<TaskListResult>(connection, 'tasksList', query)
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 发布任务（`projectId` 可选：归到某个项目；空 ⇒ 未归类） */
export async function createTask(
  title: string,
  detail: string,
  projectId?: string,
  interactionId?: string,
  /** ★ 2026-10-23：任务性质。不传 ⇒ 服务端按标题推断（推断不出来给 other）。 */
  kind?: string,
  /**
   * ★ 2026-10-24（083-r1）：点名通知某个 Agent（传 id）。
   *   不传/空 ⇒ 公池，与旧行为一致 —— 这是硬约束，默认值不许反过来。
   *   签名域不受影响：`POST /agent/tasks` 的签名仍是 agent_id|ts|title|isDestructive，
   *   本字段只走铺主的 `POST /tasks`（Bearer），不进签名。
   */
  notifyAgent?: string,
  /**
   * ★ 2026-10-24（083-r3）：发到哪个工位（`GET /org/tree` 的 `node_id`）。
   *   不传/空 ⇒ 公共池，与旧行为一致。
   *   ★ 必须用 `org/tree` 回的真实 id —— 后端 `tasks.node_id` 与 `role_seats.node_id`
   *     是两套 UUID 空间，自己拼/写死示例值会静默落进公共池（派单书 §二-2.2 的坑）。
   */
  nodeId?: string,
): Promise<OrgResult<TaskItem>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const query: {
    title: string; detail: string; projectId?: string; interactionId?: string
    kind?: string; notifyAgent?: string; nodeId?: string
  } = { title, detail }
  if (typeof projectId === 'string' && projectId.length > 0) query.projectId = projectId
  if (typeof interactionId === 'string' && interactionId.length > 0) query.interactionId = interactionId
  if (typeof kind === 'string' && kind.length > 0) query.kind = kind
  if (typeof notifyAgent === 'string' && notifyAgent.length > 0) query.notifyAgent = notifyAgent
  if (typeof nodeId === 'string' && nodeId.length > 0) query.nodeId = nodeId
  const r = await callKaipu<TaskItem>(connection, 'tasksCreate', query)
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/* ── 期6-L2 · 项目层 ── */

/** 项目（服务端字段：camelCase） */
export interface ProjectItem {
  projectId: string
  name: string
  status: string
  createdAt: string
  archivedAt?: string | null
  /** 该项目下任务数（服务端子查询） */
  taskCount?: number
  /** ★★ 2026-10-26 项目阶段（requirement/plan/assignment/build/review/archived）
   *  —— 「Agent 版 OA」的骨头：项目走到哪一步。
   *  ★ 服务端老版本没有这个字段 ⇒ 可选，缺省按 'requirement' 显示。 */
  phase?: string
  /** 阶段人话名（服务端一并给，前端不再自己维护一份映射） */
  phaseLabel?: string
}

/** 读项目清单 */
export async function loadProjects(): Promise<OrgResult<{ projects: ProjectItem[] }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ projects: ProjectItem[] }>(connection, 'projectsList', {})
  if (r.ok === true) return { ok: true, data: { projects: Array.isArray(r.data?.projects) ? r.data.projects : [] } }
  return orgError(r)
}

/** 新建项目 */
export async function createProject(name: string): Promise<OrgResult<ProjectItem>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<ProjectItem>(connection, 'projectsCreate', { name })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 改项目名（★ 2026-10-23：项目名可改，id 不变 —— 改名不破坏任务归属） */
export async function renameProject(projectId: string, name: string): Promise<OrgResult<{ projectId: string; name: string }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ projectId: string; name: string }>(connection, 'projectsRename', { projectId, name })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/* ══ ★★ 2026-10-26「Agent 版 OA」三件套的前端入口 ══ */

/** 推进 / 退回项目阶段（服务端只允许 ±1 与「任意 → archived」） */
export async function setProjectPhase(
  projectId: string, phase: string,
): Promise<OrgResult<{ projectId: string; phase: string; from?: string; changed: boolean }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ projectId: string; phase: string; from?: string; changed: boolean }>(
    connection, 'projectPhaseSet', { projectId, phase })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

export interface TaskDepItem { id: string; title: string; status: string }
export interface TaskDepsPayload {
  task_id: string
  dependsOn: TaskDepItem[]
  blocks: TaskDepItem[]
  unmet: number
  claimable: boolean
}

/** 读任务依赖（双向：我等谁 / 谁等我 / 现在能不能领） */
export async function loadTaskDeps(taskId: string): Promise<OrgResult<TaskDepsPayload>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<TaskDepsPayload>(connection, 'tasksDepsList', { taskId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 加一条依赖（自环 / 成环由服务端 409 拦） */
export async function addTaskDep(
  taskId: string, dependsOnTaskId: string,
): Promise<OrgResult<Record<string, unknown>>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<Record<string, unknown>>(connection, 'tasksDeps', { taskId, dependsOnTaskId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 撤一条依赖（服务端会立刻放行因它卡住的后继） */
export async function removeTaskDep(
  taskId: string, dependsOnTaskId: string,
): Promise<OrgResult<{ removed: boolean }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ removed: boolean }>(connection, 'tasksDepsDelete', { taskId, dependsOnTaskId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

export interface DeliverableItem {
  id: string; version: number; is_final: number; filename: string
  size: number; sha256: string; interaction_id: string; created_at: string
}
export interface DeliverablesPayload {
  task_id: string
  versions: number[]
  count: number
  finalVersion: number
  items: DeliverableItem[]
}

/** 读交付版本（同一个任务交了几稿、哪一稿是最终） */
export async function loadDeliverables(taskId: string): Promise<OrgResult<DeliverablesPayload>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<DeliverablesPayload>(connection, 'deliverablesList', { taskId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 指定某一稿为最终稿（新交的那稿改坏了，用它回退） */
export async function promoteDeliverable(
  taskId: string, deliverableId: string,
): Promise<OrgResult<{ version: number }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ version: number }>(connection, 'deliverablePromote', { taskId, deliverableId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 归档项目（打包全部任务资料 + manifest；不删原件） */
export async function unarchiveProject(projectId: string): Promise<OrgResult<{ projectId: string; status: string }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ projectId: string; status: string }>(connection, 'projectUnarchive', { projectId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

export async function downloadProjectArchive(projectId: string): Promise<OrgResult<{ filename: string; bytes: number; sha256: string; stale?: boolean; staleSince?: string; dataBase64: string }>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<{ filename: string; bytes: number; sha256: string; stale?: boolean; staleSince?: string; dataBase64: string }>(
    connection, 'projectArchiveDownload', { projectId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

export async function archiveProject(projectId: string, force = false): Promise<OrgResult<Record<string, unknown>>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<Record<string, unknown>>(connection, 'projectArchive', { projectId, force })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 领取任务（原子；抢不到返回 409 文案） */
export async function claimTask(taskId: string): Promise<OrgResult<unknown>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<unknown>(connection, 'tasksClaim', { taskId })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 完成任务 */
export async function finishTask(taskId: string, result: string): Promise<OrgResult<unknown>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<unknown>(connection, 'tasksDone', { taskId, result })
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/* ══════════════════════════════════════════════════════════════════
   三、渲染用纯函数（判据可断言 · 与 host workstation-state.ts 同逻辑、各一半）
   ══════════════════════════════════════════════════════════════════ */

/** ③ 离座≠空缺≠移除：presence='away' 且 membershipActive=true ⇒ 离座·留痕在 */
export function seatText(seat: Seat): string {
  if (seat.status === 'vacant') return '空位 · 可邀请'
  return seat.presence === 'away' ? '离座 · 留痕在' : '在场'
}

/** ② 邀请是否过期 */
export function inviteExpired(invite: Invite, now: string): boolean {
  if (invite.used) return false
  return new Date(invite.expiresAt).getTime() <= new Date(now).getTime()
}

/** ④ 成员按 kind 拆两集合：人类协作方 / Agent 订阅者 */
export function splitMembers(state: WorkstationState): { humans: Member[]; agents: Member[] } {
  const humans: Member[] = []
  const agents: Member[] = []
  for (const m of state.members) {
    if (m.kind === 'agent') agents.push(m)
    else humans.push(m)
  }
  return { humans, agents }
}

/**
 * 座位汇总 —— ★ **四数分账**（与 host `workstation-state.ts` 同逻辑，各一半）：
 *   occupied（**含** away）+ vacant + removed == 座位数；awayButActive ⊆ occupied。
 * ★ 判序不可调换：先判移除（移除后 status 必为 vacant，先判 vacant 会让 removed 恒 0）。
 */
export function summarizeSeats(state: WorkstationState): {
  occupied: number
  vacant: number
  awayButActive: number
  removed: number
} {
  let occupied = 0
  let vacant = 0
  let awayButActive = 0
  let removed = 0
  for (const s of state.seats) {
    if (!s.membershipActive) {
      removed++
      continue
    }
    if (s.status === 'vacant') {
      vacant++
      continue
    }
    occupied++
    if (s.presence === 'away') awayButActive++
  }
  return { occupied, vacant, awayButActive, removed }
}
