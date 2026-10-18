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
  /** 非空 = 不能删，值就是原因（如「被 4 个席位占用」） */
  undeletable?: string | null
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
}

export interface TaskListResult {
  tasks: TaskItem[]
  counts: { open: number; claimed: number; done: number; cancelled: number }
}

/** 读任务列表（默认只列未完成） */
export async function loadTasks(all: boolean): Promise<OrgResult<TaskListResult>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const query: Record<string, unknown> = all ? { all: true } : {}
  const r = await callKaipu<TaskListResult>(connection, 'tasksList', query)
  if (r.ok === true) return { ok: true, data: r.data }
  return orgError(r)
}

/** 发布任务 */
export async function createTask(title: string, detail: string): Promise<OrgResult<TaskItem>> {
  if (connection === null) return { ok: false, code: 'no_channel', message: '没有数据通道。' }
  const r = await callKaipu<TaskItem>(connection, 'tasksCreate', { title, detail })
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
