/**
 * 山海·开铺 · 工位插件 · host 侧数据通道（Typert Remote / SRC 模式 · 期1）
 * =====================================================================
 * 面板（client half）经 `connection.rpc.call('/api', 'kaipu-workstation/<method>', …)` 调到这里。
 * 本类只**声明**端点，descriptor 由 DSH Gateway 的 SRC 反射在**运行时**生成
 * ⇒ 本包零构建产物（不需要 tsdown / zod 代码生成）。
 *
 * ★★ 硬约束（与 plugin-platform 同款，逐字照搬纪律）：
 *   ① 参数不能有默认值（网关靠 `Function.prototype.toString()` 反射参数名）
 *   ② `signal` 必须是最后一个参数
 *   ③ 业务参数一律从 `query` 里取
 *
 * ★ 期1：返回【scaffold 持久化态】（source='scaffold'），诚实标非 live。
 *   待服务端五项（契约 §五）落地后，`state()` 改读真
 *   `kaipu-workstation/state`（source='live'）；本文件只换取数源，不改 wire 形状。
 *
 * ★ 凭据纪律（承 plugin-platform）：工位插件**不持有模型 Key、不直连服务端域名**。
 *   期1 仅渲染持久化态（本地种子），不发起任何对外 HTTP；凭据议题留待服务端接入期。
 */

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// ★ 只 import type —— host half 不经打包，契约包是构建期依赖（用户机上没有），
//   类型被 tsc 擦除 ⇒ 不产生运行时依赖（由桥接检查脚本看护）。
import type {
  RemoteResult,
  WorkstationState,
  WorkstationStatusPayload,
} from '@shanhai/kaipu-contract'
import { checkedWorkstationState, summarizeSeats } from './workstation-state.js'
import { KaipuHttpClient, KaipuHttpError } from './kai-pu-http.js'

/** remote 命名空间。★ 必须与 client `bridge.ts` 里的同值（判据看护） */
export const REMOTE_NS = 'kaipu-workstation'

/** 网关取消参数形状（★ 参数名必须叫 `signal`，网关靠它识别并剥出 wire） */
export interface CancelSignal {
  readonly aborted: boolean
}

/** 空入参（有些端点不需要参数；仍要有一个 query，见约束 ③） */
export interface EmptyQuery {
  [k: string]: never
}

/* ─────────────────────────────────────────────────────────────────────
 * 工位操作入参（期4 组织层）
 * ★ 参数一律从 `query` 取（网关约定），且**不能有默认值**。
 * ★ 键名用 camelCase（wire 层），由本文件翻译成服务端的 snake_case ——
 *   ⇒ 服务端字段口径只在本文件出现一次，不散到 client。
 * ───────────────────────────────────────────────────────────────────── */

/** `orgNodeCreate` 入参 */
export interface OrgNodeCreateQuery {
  name: string
  parentNodeId?: string
  nodeKind?: string
}

/** `orgNodePatch` 入参（改名 / 换上级 / 绑席位 / 解绑，四件事互斥组合） */
export interface OrgNodePatchQuery {
  nodeId: string
  name?: string
  parentNodeId?: string
  bindSeat?: string
  unbindSeat?: string
}

/** `orgNodeDelete` 入参 */
export interface OrgNodeDeleteQuery {
  nodeId: string
}

/** 组织树节点（服务端原样透出，面板只读展示） */
export interface OrgNode {
  node_id: string
  account_id?: string
  name: string
  parent_node_id?: string | null
  node_kind?: string
  capabilities?: string
  org_scope?: string
  cross_scope?: number | string | null
  created_at?: string
  /** ★ 被多少席位绑定 —— >0 即删不掉（服务端 409 referenced） */
  seat_count?: number
  /** ★ 还有多少未归档子节点 —— >0 即删不掉（会断树，409 has_children） */
  child_count?: number
  /** ★ 非空 = 不能删，值就是原因。前端据此隐藏删除按钮。 */
  undeletable?: string | null
}

/** 组织树边 */
export interface OrgEdge {
  edge_id: string
  from_node_id: string
  to_node_id: string
  edge_kind?: string
  created_at?: string
}

/** `orgTree` 返回 */
export interface OrgTreePayload {
  nodes: OrgNode[]
  edges: OrgEdge[]
  org_ready: boolean
}

/* ── 期5 · 任务层入参与回体 ── */

/** `tasksCreate` 入参 */
export interface TaskCreateQuery {
  title: string
  detail?: string
  /** 指派给哪个工位（空 ⇒ 任何工位可领） */
  nodeId?: string
  /** ★ 期6-L2：归到哪个项目（空 ⇒ 未归类） */
  projectId?: string
}

/** `projectsList` 返回的一项 */
export interface ProjectRow {
  projectId: string
  name: string
  status: 'active' | 'archived' | string
  createdAt: string
  archivedAt?: string | null
  /** 该项目下任务数（服务端子查询） */
  taskCount?: number
}

/** `projectsList` 返回 */
export interface ProjectsListPayload {
  projects: ProjectRow[]
}

/** `tasksList` 入参 */
export interface TasksListQuery {
  status?: string
  nodeId?: string
  /** true ⇒ 连已完成一起列（默认只列 open + claimed） */
  all?: boolean
}

/** `tasksClaim` 入参 */
export interface TaskIdQuery {
  taskId: string
}

/** `tasksDone` 入参 */
export interface TaskDoneQuery {
  taskId: string
  result?: string
}

/* ── 期5b-1 · 任务层补齐（12 端点）入参与回体 ──
 * ★ 键名仍是 camelCase（wire 层）；服务端的 snake_case 字段名（`agent_id` /
 *   `depends_on_task_id` / `approver_id`）只出现在本文件的 body 组装处一次。
 * ★ 任务书里写的 `{taskId, agent_id}` 是「wire 键 + 服务端字段」混排 ——
 *   为免面板侧照抄报错，**两种写法都收**（camelCase 优先）。
 */

/** `tasksBlock` 入参（求助原因必填，服务端 ≤500 字，空 ⇒ 400） */
export interface TaskBlockQuery {
  taskId: string
  reason: string
}

/** `tasksUnblock` 入参（只解人工求助 `help:`，`deps` 由系统解 ⇒ 403） */
export type TaskUnblockQuery = TaskIdQuery

/** `tasksAssign` 入参（强行指派：跳标签/WIP，必留痕） */
export interface TaskAssignQuery {
  taskId: string
  agentId?: string
  /** 服务端字段名别名（任务书原文口径） */
  agent_id?: string
}

/** `tasksDeps` 入参（加一条直接依赖 + 维护传递闭包；成环 ⇒ 409 cycle_detected） */
export interface TaskDepsQuery {
  taskId: string
  dependsOnTaskId?: string
  /** 服务端字段名别名（任务书原文口径） */
  depends_on_task_id?: string
}

/** `tasksApprove` 入参（HITL 通过；`comment` 空 ⇒ 不传该键） */
export interface TaskApproveQuery {
  taskId: string
  approverId?: string
  /** 服务端字段名别名（任务书原文口径） */
  approver_id?: string
  comment?: string
}

/** `tasksReject` 入参（HITL 驳回；语义同 approve） */
export type TaskRejectQuery = TaskApproveQuery

/**
 * 期5 九态（服务端 `tasks.status` 全集）。
 * ★ 与上面 `TaskRow.status` 的四态**并存**：期5 最小版的四态是旧库口径，
 *   本轮补齐的端点读到的是九态 —— 不在本文件里强改 `TaskRow`（会惊动既有面板）。
 */
export type TaskStatusNine =
  | 'posted'
  | 'claimed'
  | 'in_progress'
  | 'blocked'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'done'
  | 'cancelled'

/** 看板里的一条任务（= 九态任务行 + 滞留标记） */
export interface TaskBoardItem extends Omit<TaskRow, 'status'> {
  status: TaskStatusNine
  /** 仅 `posted` 且超期成立 */
  stale?: boolean
  /** 滞留天数（服务端算，前端只展示） */
  age_days?: number
}

/** `tasksBoard` 返回（契约 §1.9：`{groups, counts, total}` + `stale_count`） */
export interface TaskBoardPayload {
  groups: Record<string, TaskBoardItem[]>
  counts: Record<string, number>
  total: number
  stale_count?: number
}

/** `whoami` 返回（只回身份，**不回 token** —— 凭据纪律：token 不出 host） */
export interface WhoamiPayload {
  accountId: string
}

/** 一条任务（服务端字段原样） */
export interface TaskRow {
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

/** `tasksList` 返回 */
/* ─────────────────────────────────────────────────────────────────────
 * ★ 期6a-2 · 资料按位（packs）
 *
 * 目录约定：`<packsRoot>/<accountId>/<seat>/<interactionId>/`
 *   accountId 从 token 取（不由客户端传 —— 判据不得取自可写面）；
 *   seat 指「谁的位」（缺省由服务端按签名/铺主身份解析）。
 * ───────────────────────────────────────────────────────────────────── */

/** 定位一次交互 */
export interface PackRefQuery {
  interactionId: string
  /** 缺省 ⇒ 服务端自行解析（签名者看自己的位；铺主看 management 位） */
  seat?: string
}

/** 上传：文件内容以 base64 过 wire（`@Remote` 参数是 JSON） */
export interface PackUploadQuery extends PackRefQuery {
  filename: string
  /** 原始字节的 base64（**不是** data URL） */
  contentBase64: string
}

/** 下载/删除要指名文件 */
export interface PackFileRefQuery extends PackRefQuery {
  filename: string
}

/** 位上的一个文件（服务端列表项） */
export interface PackFileItem {
  filename: string
  seat?: string
  size?: number
  sha256?: string
  createdAt?: string
  [k: string]: unknown
}

export interface PackListPayload {
  count: number
  files: PackFileItem[]
}

export interface PackDownloadPayload {
  filename: string
  contentType: string
  contentBase64: string
  size: number
}

/** 本铺真实席位（`GET /roles/seats`） */
export interface WorkstationContext {
  interactionId: string
  seat: string
  note: string
  project: string
  updatedAt: string
}
export interface WorkstationContextWrite {
  interactionId?: string
  seat?: string
  note?: string
  project?: string
}

export interface RolesSeat {
  seat: string
  label: string
  holder: { type: string; id: string; name: string }
  replaceable: boolean
}

export interface RolesSeatsPayload {
  seats: RolesSeat[]
  accountId: string
}

/** 生成邀请（`POST /invites`） */
export interface InviteCreateQuery {
  /** ★ 必填：哪一盏灯（audit / execution / …） */
  lamp: string
  /** 可选：落到哪个位 */
  seat?: string
  note?: string
  ttlDays?: number
}

export interface InviteCreated {
  code: string
  url?: string
  path?: string
  lamp: string
  expiresAt: string
  ttlDays?: number
  createdAt?: string
}

export interface PackJournalPayload {
  interactionId: string
  seat?: string
  lines: Record<string, unknown>[]
  ok: boolean
  brokenAtSeq: number | null
  anchorOk?: boolean
  appendOnly?: boolean
}

export interface TasksListPayload {
  tasks: TaskRow[]
  counts: { open: number; claimed: number; done: number; cancelled: number }
}

/**
 * 工位数据通道服务。
 * 第 2 个构造参数 `REMOTE_NS` 同时是：cordis 服务键 + 默认 wire namespace
 * （客户端端点即 `kaipu-workstation/status` / `kaipu-workstation/state`）。
 */
export class WorkstationRemoteService extends TypertRemoteService {
  /**
   * ★ 期4 起：可选的 HTTP 通道。
   *   `cfg.baseUrl` 为空 ⇒ 恒 `null`，面板退回 scaffold 只读态（诚实标 source）；
   *   非空 ⇒ 建 `KaipuHttpClient`，`org*` 系列方法走真服务端。
   * ★ 通道建在 host 侧 ⇒ `deviceToken` 永远不进渲染层。
   */
  private readonly http: KaipuHttpClient | null

  constructor(ctx: unknown, _cfg: Record<string, unknown> = {}) {
    super(ctx, REMOTE_NS)
    const baseUrl = typeof _cfg.baseUrl === 'string' ? _cfg.baseUrl.trim() : ''
    if (baseUrl.length > 0) {
      // ★ exactOptionalPropertyTypes: true ⇒ 可选键只能缺席，不能传 undefined
      const opts: { baseUrl: string; fingerprint?: string; clientVersion?: string } = { baseUrl }
      if (typeof _cfg.fingerprint === 'string') opts.fingerprint = _cfg.fingerprint
      if (typeof _cfg.clientVersion === 'string') opts.clientVersion = _cfg.clientVersion
      this.http = new KaipuHttpClient(opts)
    } else {
      this.http = null
    }
  }

  /** 通道是否可选（供面板判断能否操作） */
  private requireHttp(): KaipuHttpClient {
    if (this.http === null) {
      throw new KaipuHttpError(
        0,
        'not_configured',
        '工位还没接服务端 —— 插件配置里缺 baseUrl。装上开铺（kaipu-platform）或手工填接入地址后可操作工位。',
      )
    }
    return this.http
  }

  /**
   * `kaipu-workstation/status` —— 面板第一件要知道的事：接没接上 + 种子概览。
   * ★ 期1 恒 `connected:true`（本地种子模式，非未接入故障），source 明示 `scaffold`。
   * ★ 戒 P2-1（第 9 条）：出数**前**先过不变量（`checkedWorkstationState`）——
   *   座位与成员快照不自洽时抛错（由 `src/index.ts` 的 try/catch 兜住），
   *   绝不把「假一致」的数据端给面板。
   */
  @Remote('status')
  async status(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<WorkstationStatusPayload>> {
    void query
    void signal
    const state = checkedWorkstationState()
    return {
      ok: true,
      data: {
        connected: true,
        projectId: state.projectId,
        source: state.source,
        seats: summarizeSeats(state),
        note: '期1 渲染持久化态（scaffold），服务端五项落地后接真 kaipu-workstation/state',
      },
    }
  }

  /**
   * `kaipu-workstation/state` —— 工位完整持久化态
   * （状态面板多球 / 座位含空位+邀请 / 轮次 B3 / 留痕四字段 / 事件流底座 · 二分口径）。
   * ★ 期1 返回 scaffold 种子（诚实标 source='scaffold'）；不实时流、不悄悄回落 mock。
   * ★ 同 `status`：出数前先过不变量（第 9 条「不变量前置」）。
   */
  @Remote('state')
  async state(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<WorkstationState>> {
    void query
    void signal
    return { ok: true, data: checkedWorkstationState() }
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 期4 · 组织层（真数据 · 真操作）
   * ★ 与上面两个「只读 scaffold」方法的区别：
   *   这两个是**真服务端调用**，没有 baseUrl 就抛 `not_configured`
   *   （面板据此显示「未接入」而不是假装成功）。
   * ───────────────────────────────────────────────────────────────────── */

  /** 组织树（真数据）。空组织返回 `org_ready:false` + 空数组，不是错误。 */
  @Remote('orgTree')
  async orgTree(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<OrgTreePayload>> {
    void query
    const data = await this.requireHttp().call<OrgTreePayload>('GET', '/org/tree', undefined, signal)
    return {
      ok: true,
      data: {
        nodes: Array.isArray(data?.nodes) ? data.nodes : [],
        edges: Array.isArray(data?.edges) ? data.edges : [],
        org_ready: data?.org_ready === true,
      },
    }
  }

  /** 新建工位节点。`parentNodeId` 空 ⇒ 建根节点。 */
  @Remote('orgNodeCreate')
  async orgNodeCreate(query: OrgNodeCreateQuery, signal?: CancelSignal): Promise<RemoteResult<OrgNode>> {
    const body: Record<string, unknown> = { name: query.name }
    if (typeof query.parentNodeId === 'string' && query.parentNodeId.length > 0) {
      body.parent_node_id = query.parentNodeId
    }
    if (typeof query.nodeKind === 'string' && query.nodeKind.length > 0) body.node_kind = query.nodeKind
    const data = await this.requireHttp().call<OrgNode>('POST', '/org/nodes', body, signal)
    return { ok: true, data }
  }

  /** 改工位：改名 / 换上级 / 绑席位 / 解绑（四件事可单发，不可互相矛盾）。 */
  @Remote('orgNodePatch')
  async orgNodePatch(query: OrgNodePatchQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const body: Record<string, unknown> = {}
    if (typeof query.name === 'string') body.name = query.name
    if (typeof query.parentNodeId === 'string') body.parent_node_id = query.parentNodeId
    if (typeof query.bindSeat === 'string') body.bind_seat = query.bindSeat
    if (typeof query.unbindSeat === 'string') body.unbind_seat = query.unbindSeat
    if (Object.keys(body).length === 0) {
      throw new KaipuHttpError(400, 'empty_patch', '没有要改的内容 —— 至少给 name / parentNodeId / bindSeat / unbindSeat 之一。')
    }
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'PATCH',
      `/org/nodes/${encodeURIComponent(query.nodeId)}`,
      body,
      signal,
    )
    return { ok: true, data }
  }

  /** 归档工位（软删）。仍被席位占用的节点会被服务端以 409 `referenced` 拒绝。 */
  @Remote('orgNodeDelete')
  async orgNodeDelete(query: OrgNodeDeleteQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'DELETE',
      `/org/nodes/${encodeURIComponent(query.nodeId)}`,
      undefined,
      signal,
    )
    return { ok: true, data }
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 期5 · 任务层
   * ★ 状态机由服务端把守：open → claimed → done
   *   领取是原子的一条 UPDATE，抢不到就是 409，不会两边都成功。
   * ───────────────────────────────────────────────────────────────────── */

  /** 发布任务 */
  @Remote('tasksCreate')
  async tasksCreate(query: TaskCreateQuery, signal?: CancelSignal): Promise<RemoteResult<TaskRow>> {
    const body: Record<string, unknown> = { title: query.title }
    if (typeof query.detail === 'string') body.detail = query.detail
    if (typeof query.nodeId === 'string' && query.nodeId.length > 0) body.node_id = query.nodeId
    if (typeof query.projectId === 'string' && query.projectId.length > 0) body.project_id = query.projectId
    const data = await this.requireHttp().call<TaskRow>('POST', '/tasks', body, signal)
    return { ok: true, data }
  }

  /** 任务列表（默认只列未完成；`all: true` 列全部） */
  @Remote('tasksList')
  async tasksList(query: TasksListQuery, signal?: CancelSignal): Promise<RemoteResult<TasksListPayload>> {
    const qs: string[] = []
    if (typeof query.status === 'string' && query.status.length > 0) {
      qs.push(`status=${encodeURIComponent(query.status)}`)
    }
    if (typeof query.nodeId === 'string' && query.nodeId.length > 0) {
      qs.push(`node_id=${encodeURIComponent(query.nodeId)}`)
    }
    if (query.all === true) qs.push('all=1')
    const path = qs.length > 0 ? `/tasks?${qs.join('&')}` : '/tasks'
    const data = await this.requireHttp().call<TasksListPayload>('GET', path, undefined, signal)
    return {
      ok: true,
      data: {
        tasks: Array.isArray(data?.tasks) ? data.tasks : [],
        counts: data?.counts ?? { open: 0, claimed: 0, done: 0, cancelled: 0 },
      },
    }
  }

  /** 领取（原子；抢不到 ⇒ 409 already_claimed） */
  @Remote('tasksClaim')
  async tasksClaim(query: TaskIdQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/tasks/${encodeURIComponent(query.taskId)}/claim`,
      {},
      signal,
    )
    return { ok: true, data }
  }

  /* ── 期6-L2 · 项目层（长期实体：项目结束可归档、可复用）── */

  /** 项目清单（带 task_count） */
  @Remote('projectsList')
  /* ★★ 2026-10-21 真根因：参数名原来是 `_query`，**装饰器生成的 descriptor 字段名就是 `_query`**，
     客户端按约定传 `{args:{query:{}}}` ⇒ Gateway 直接拒绝：
       `typert gateway: kaipu-workstation/projectsList: args fields do not match the
        descriptor: unexpected "query"`
     于是项目清单请求**在网关成帧阶段就被打回，连 HTTP 都没发出**（所以 nginx 里 0 条记录）。
     ⇒ 参数名必须与客户端约定一致（`query`），不能带下划线。 */
  async projectsList(query: Record<string, never>, signal?: CancelSignal): Promise<RemoteResult<ProjectsListPayload>> {
    void query
    const data = await this.requireHttp().call<{ projects?: ProjectRow[] }>('GET', '/projects', undefined, signal)
    return { ok: true, data: { projects: Array.isArray(data?.projects) ? data.projects : [] } }
  }

  /** 新建项目 */
  @Remote('projectsCreate')
  async projectsCreate(query: { name: string }, signal?: CancelSignal): Promise<RemoteResult<ProjectRow>> {
    const name = (query.name ?? '').trim()
    if (name.length === 0) {
      throw new KaipuHttpError(400, 'empty_name', '项目名不能为空。')
    }
    const data = await this.requireHttp().call<ProjectRow>('POST', '/projects', { name }, signal)
    return { ok: true, data }
  }

  /** 归档项目：打包全部任务资料 + manifest（只读原件，不删） */
  @Remote('projectArchive')
  async projectArchive(query: { projectId: string }, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/projects/${encodeURIComponent(query.projectId)}/archive`,
      {},
      signal,
    )
    return { ok: true, data }
  }

  /** 完成（只能交自己领的；别人的任务交不了） */
  @Remote('tasksDone')
  async tasksDone(query: TaskDoneQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/tasks/${encodeURIComponent(query.taskId)}/done`,
      { result: query.result ?? '' },
      signal,
    )
    return { ok: true, data }
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 期5b-1 · 任务层补齐（12 端点 · 后端已实现 ⇒ 本轮只接线）
   * ★ 形态逐字照上面 `tasksClaim` / `tasksDone`：
   *   query 取参 → `{id}` 处 `encodeURIComponent(query.taskId)` → `{ ok: true, data }`。
   * ★ 状态机仍由服务端把守：host 侧**不做**乐观状态改写、不吞错 ——
   *   409（invalid_transition / cycle_detected / deps_unmet）、403（not_approver /
   *   deps_managed_by_system）、404 一律原样抛给面板（`KaipuHttpError` 带 status+code）。
   * ★ 直白缺参（如指派没给 agent）在 host 侧先拦，省一次白跑的网络往返。
   * ───────────────────────────────────────────────────────────────────── */

  /** 开工（`claimed`/`rejected` → `in_progress`）· `POST /tasks/{id}/start` */
  @Remote('tasksStart')
  async tasksStart(query: TaskIdQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/tasks/${encodeURIComponent(query.taskId)}/start`,
      {},
      signal,
    )
    return { ok: true, data }
  }

  /** 租约续期（30min；只对本人持有任务有意义）· `POST /tasks/{id}/heartbeat` */
  @Remote('tasksHeartbeat')
  async tasksHeartbeat(query: TaskIdQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/tasks/${encodeURIComponent(query.taskId)}/heartbeat`,
      {},
      signal,
    )
    return { ok: true, data }
  }

  /** 阻塞求助（`claimed`/`in_progress` 才可；`reason` 空 ⇒ 400）· `POST /tasks/{id}/block` */
  @Remote('tasksBlock')
  async tasksBlock(query: TaskBlockQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/tasks/${encodeURIComponent(query.taskId)}/block`,
      { reason: query.reason },
      signal,
    )
    return { ok: true, data }
  }

  /**
   * ★ 2026-10-23（古茶 002「一键挂载」）：把这个项目送去审计。
   *
   * 服务端建单后立刻返回 202，跑审在后台（四灯场景，几分钟）——
   * 所以这里**不等结果**，前端拿 `id` 去轮询 `auditGet`。
   * `reused: true` = 同项目同套餐已有一张在跑的单（防手抖点两下）。
   */
  @Remote('projectAuditRequest')
  async projectAuditRequest(
    query: { projectId: string; package?: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/projects/${encodeURIComponent(query.projectId)}/audit-request`,
      { package: query.package ?? 'standard' },
      signal,
    )
    return { ok: true, data }
  }

  /** 查审计单状态与报告 · `GET /audit/{id}` */
  @Remote('auditGet')
  async auditGet(
    query: { auditId: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'GET',
      `/audit/${encodeURIComponent(query.auditId)}`,
      undefined,
      signal,
    )
    return { ok: true, data }
  }

  /** 解除求助阻塞（`blocked` → `in_progress`；`deps` 类由系统解 ⇒ 403）· `POST /tasks/{id}/unblock` */
  @Remote('tasksUnblock')
  async tasksUnblock(query: TaskUnblockQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/tasks/${encodeURIComponent(query.taskId)}/unblock`,
      {},
      signal,
    )
    return { ok: true, data }
  }

  /** 强行指派（组长；跳标签/WIP，留痕 `task_assign`）· `POST /tasks/{id}/assign` */
  @Remote('tasksAssign')
  async tasksAssign(query: TaskAssignQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const agentId =
      typeof query.agentId === 'string' && query.agentId.length > 0
        ? query.agentId
        : typeof query.agent_id === 'string'
          ? query.agent_id
          : ''
    if (agentId.length === 0) {
      throw new KaipuHttpError(400, 'missing_agent_id', '指派缺 agentId —— 要指给哪个 agent？')
    }
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/tasks/${encodeURIComponent(query.taskId)}/assign`,
      { agent_id: agentId },
      signal,
    )
    return { ok: true, data }
  }

  /** 加依赖（维护传递闭包；自环/成环 ⇒ 409 cycle_detected）· `POST /tasks/{id}/deps` */
  @Remote('tasksDeps')
  async tasksDeps(query: TaskDepsQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const dependsOn =
      typeof query.dependsOnTaskId === 'string' && query.dependsOnTaskId.length > 0
        ? query.dependsOnTaskId
        : typeof query.depends_on_task_id === 'string'
          ? query.depends_on_task_id
          : ''
    if (dependsOn.length === 0) {
      throw new KaipuHttpError(400, 'missing_depends_on', '加依赖缺 dependsOnTaskId —— 要等哪条任务？')
    }
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/tasks/${encodeURIComponent(query.taskId)}/deps`,
      { depends_on_task_id: dependsOn },
      signal,
    )
    return { ok: true, data }
  }

  /** HITL 审批通过（`submitted` → `accepted`）· `POST /tasks/{id}/approve` */
  @Remote('tasksApprove')
  async tasksApprove(query: TaskApproveQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const body: Record<string, unknown> = { approver_id: resolveApproverId(query) }
    if (typeof query.comment === 'string' && query.comment.length > 0) body.comment = query.comment
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/tasks/${encodeURIComponent(query.taskId)}/approve`,
      body,
      signal,
    )
    return { ok: true, data }
  }

  /** HITL 驳回（`submitted` → `rejected`，退回持有者返工或回池）· `POST /tasks/{id}/reject` */
  @Remote('tasksReject')
  async tasksReject(query: TaskRejectQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const body: Record<string, unknown> = { approver_id: resolveApproverId(query) }
    if (typeof query.comment === 'string' && query.comment.length > 0) body.comment = query.comment
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/tasks/${encodeURIComponent(query.taskId)}/reject`,
      body,
      signal,
    )
    return { ok: true, data }
  }

  /** 滞留看板（本铺全量 · 九态分组 + `stale`）· `GET /tasks/board` */
  @Remote('tasksBoard')
  async tasksBoard(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<TaskBoardPayload>> {
    void query
    const data = await this.requireHttp().call<TaskBoardPayload>('GET', '/tasks/board', undefined, signal)
    const payload: TaskBoardPayload = {
      groups: data !== null && typeof data.groups === 'object' && data.groups !== null ? data.groups : {},
      counts: data !== null && typeof data.counts === 'object' && data.counts !== null ? data.counts : {},
      total: typeof data.total === 'number' ? data.total : 0,
    }
    // ★ exactOptionalPropertyTypes: true ⇒ 可选键只能缺席，不能传 undefined
    if (typeof data.stale_count === 'number') payload.stale_count = data.stale_count
    return { ok: true, data: payload }
  }

  /**
   * 阻塞列表 · `GET /tasks/blocked`
   * ★ 外层形状由服务端定（契约只规定「`blocked_reason` 拆成 `{kind, reason}`」）⇒
   *   本方法**原样透出**，不臆造外层键名（面板侧按 305 方案块 C 只读展示）。
   */
  @Remote('tasksBlocked')
  async tasksBlocked(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    void query
    const data = await this.requireHttp().call<Record<string, unknown>>('GET', '/tasks/blocked', undefined, signal)
    return { ok: true, data }
  }

  /**
   * 待审批列表（本铺 `submitted` 全量，`hitl=1` 优先）· `GET /tasks/pending-approvals`
   * ★ 同 `tasksBlocked`：外层形状未在契约明定 ⇒ 原样透出。
   */
  @Remote('tasksPendingApprovals')
  async tasksPendingApprovals(
    query: EmptyQuery,
    signal?: CancelSignal,
  ): Promise<RemoteResult<Record<string, unknown>>> {
    void query
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'GET',
      '/tasks/pending-approvals',
      undefined,
      signal,
    )
    return { ok: true, data }
  }

  /**
   * 本人身份 · `GET /tenant/me` ⇒ `{accountId}`
   * ★ 只回身份，**不回 token**（凭据纪律：token 不出 host）。
   * ★ 心跳判据靠它：只对 `claimed_by` == 本人才发 heartbeat。
   */
  @Remote('whoami')
  async whoami(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<WhoamiPayload>> {
    void query
    const data = await this.requireHttp().call<{ accountId?: string; account_id?: string }>(
      'GET',
      '/tenant/me',
      undefined,
      signal,
    )
    const accountId =
      typeof data?.accountId === 'string'
        ? data.accountId
        : typeof data?.account_id === 'string'
          ? data.account_id
          : ''
    return { ok: true, data: { accountId } }
  }

  /* ─────────────────────────────────────────────────────────────────────
   * ★ 期6a-2 · 资料按位（5 个端点）
   *
   * 与服务端一一对应（`gateway.py` ROUTES）：
   *   GET    /packs/{iid}/files            → packsList
   *   POST   /packs/{iid}/files            → packUpload（raw body）
   *   GET    /packs/{iid}/files/{name}     → packDownload（二进制）
   *   DELETE /packs/{iid}/files/{name}     → packDelete
   *   GET    /packs/{iid}/journal          → packJournal
   *
   * ★ 摘要在这里算，不在服务端算：服务端代算等于「它既能换文件又能换摘要」，
   *   签名就失去保护对象。这里算完放进 `X-Body-Sha256`，服务端按它验签、
   *   并按它比对实际落盘内容。
   * ───────────────────────────────────────────────────────────────────── */

  /** 列出位上的文件（无此交互 ⇒ 服务端回 `{count:0}`，不是 404） */
  @Remote('packsList')
  async packsList(query: PackRefQuery, signal?: CancelSignal): Promise<RemoteResult<PackListPayload>> {
    const path = `${packBase(query)}/files${seatQuery(query)}`
    const data = await this.requireHttp().call<{ count?: number; files?: PackFileItem[] }>(
      'GET',
      path,
      undefined,
      signal,
    )
    const files = Array.isArray(data?.files) ? data.files : []
    return { ok: true, data: { count: typeof data?.count === 'number' ? data.count : files.length, files } }
  }

  /** 上传一个文件（base64 进 ⇒ raw bytes 出） */
  @Remote('packUpload')
  async packUpload(query: PackUploadQuery, signal?: CancelSignal): Promise<RemoteResult<PackFileItem>> {
    const filename = typeof query.filename === 'string' ? query.filename : ''
    if (filename.length === 0) {
      throw new KaipuHttpError(400, 'missing_filename', '上传缺文件名 —— 这个件叫什么？')
    }
    const bytes = base64ToBytes(query.contentBase64)
    if (bytes.length === 0) {
      throw new KaipuHttpError(400, 'empty_file', '文件是空的（0 字节）—— 不传空件。')
    }
    const sha = await sha256Hex(bytes)
    const data = await this.requireHttp().uploadRaw(
      `${packBase(query)}/files${seatQuery(query)}`,
      bytes,
      {
        'X-Filename': encodeURIComponent(filename),
        'X-Body-Sha256': sha,
        'Content-Type': 'application/octet-stream',
      },
      signal,
    )
    return { ok: true, data: (data || {}) as PackFileItem }
  }

  /** 下载（二进制 ⇒ base64 回渲染层） */
  /** ★ 通知：有什么在等我处理 */
  @Remote('notifications')
  async notifications(query: Record<string, never>, signal?: CancelSignal): Promise<RemoteResult<{ items: Array<{ kind: string; taskId: string; title: string; at: string; text: string; unread: boolean; projectId?: string; projectName?: string }>; unread: number; total: number; seenAt: string }>> {
    const d = await this.requireHttp().call<{ items?: Array<Record<string, unknown>>; unread?: number; total?: number; seenAt?: string }>('GET', '/notifications', undefined, signal)
    return { ok: true, data: {
      items: (Array.isArray(d?.items) ? d.items : []).map((r) => ({
        kind: String(r.kind ?? ''), taskId: String(r.taskId ?? ''), title: String(r.title ?? ''),
        at: String(r.at ?? ''), text: String(r.text ?? ''), unread: r.unread === true,
      })),
      unread: Number(d?.unread ?? 0) || 0,
      total: Number(d?.total ?? 0) || 0,
      seenAt: String(d?.seenAt ?? ''),
    } }
  }

  /** ★ 全部标为已看 */
  @Remote('notificationsRead')
  async notificationsRead(query: Record<string, never>, signal?: CancelSignal): Promise<RemoteResult<{ seen: boolean }>> {
    void query
    const d = await this.requireHttp().call<{ seen?: boolean }>('POST', '/notifications/read', {}, signal)
    return { ok: true, data: { seen: d?.seen === true } }
  }

  /** ★ 查服务端的最新插件版本（免鉴权 · 与登录态无关） */
  @Remote('pluginVersion')
  async pluginVersion(query: { current: string }, signal?: CancelSignal): Promise<RemoteResult<{ current: string | null; latest: string | null; updateAvailable: boolean; notes: string }>> {
    const data = await this.requireHttp().call<{ current?: string | null; latest?: string | null; updateAvailable?: boolean; notes?: string }>(
      'GET', `/plugin/version?current=${encodeURIComponent(query.current)}`, undefined, signal)
    return { ok: true, data: {
      current: data?.current ?? null,
      latest: data?.latest ?? null,
      updateAvailable: data?.updateAvailable === true,
      notes: typeof data?.notes === 'string' ? data.notes : '',
    } }
  }

  /** ★ 把一个交互包（所有座位）打包下载成 zip */
  /** ★ 2026-10-21：列出「有资料的交互」—— 打包下载失败，多半是 iid 是历史遗留/从没传过文件 */
  @Remote('packsInteractions')
  async packsInteractions(query: Record<string, never>, signal?: CancelSignal): Promise<RemoteResult<{ interactions: Array<{ interactionId: string; files: number; seats: number; lastAt: string }> }>> {
    void query
    const data = await this.requireHttp().call<{ interactions?: Array<{ interactionId: string; files: number; seats: number; lastAt: string }> }>(
      'GET', '/packs/interactions', undefined, signal)
    return { ok: true, data: { interactions: Array.isArray(data?.interactions) ? data.interactions : [] } }
  }

  @Remote('packExport')
  async packExport(query: { interactionId: string }, signal?: CancelSignal): Promise<RemoteResult<{ filename: string; dataBase64: string; files: number; bytes: number }>> {
    const iid = typeof query.interactionId === 'string' ? query.interactionId : ''
    if (iid.length === 0) {
      throw new KaipuHttpError(400, 'missing_interaction_id', '打包下载缺交互 ID')
    }
    const got = await this.requireHttp().downloadRaw(
      `/packs/${encodeURIComponent(iid)}/export`, signal)
    return {
      ok: true,
      data: {
        filename: got.filename ?? `${iid}-资料.zip`,
        dataBase64: bytesToBase64(got.bytes),
        bytes: got.bytes.length,
        files: 0,
      },
    }
  }

  /** ★ 排定 24 小时后删除一个交互包（可取消） */
  @Remote('packPurge')
  async packPurge(query: { interactionId: string }, signal?: CancelSignal): Promise<RemoteResult<{ interactionId: string; deleteAfter: string }>> {
    const data = await this.requireHttp().call<{ interactionId?: string; deleteAfter?: string }>(
      'POST', `/packs/${encodeURIComponent(query.interactionId)}/purge`, { confirm: 'DELETE' }, signal)
    return { ok: true, data: { interactionId: data?.interactionId ?? query.interactionId, deleteAfter: data?.deleteAfter ?? '' } }
  }

  /** ★ 取消已排定的删除 */
  @Remote('packPurgeCancel')
  async packPurgeCancel(query: { interactionId: string }, signal?: CancelSignal): Promise<RemoteResult<{ interactionId: string; cancelled: boolean }>> {
    const data = await this.requireHttp().call<{ interactionId?: string }>(
      'POST', `/packs/${encodeURIComponent(query.interactionId)}/purge/cancel`, {}, signal)
    return { ok: true, data: { interactionId: data?.interactionId ?? query.interactionId, cancelled: true } }
  }

  /** ★ 查这个包排了删除没有 */
  @Remote('packPurgeStatus')
  async packPurgeStatus(query: { interactionId: string }, signal?: CancelSignal): Promise<RemoteResult<{ interactionId: string; pending: boolean; deleteAfter: string | null }>> {
    const data = await this.requireHttp().call<{ pending?: boolean; deleteAfter?: string | null }>(
      'GET', `/packs/${encodeURIComponent(query.interactionId)}/purge`, undefined, signal)
    return { ok: true, data: { interactionId: query.interactionId, pending: data?.pending === true, deleteAfter: data?.deleteAfter ?? null } }
  }

  @Remote('packDownload')
  async packDownload(query: PackFileRefQuery, signal?: CancelSignal): Promise<RemoteResult<PackDownloadPayload>> {
    const name = typeof query.filename === 'string' ? query.filename : ''
    if (name.length === 0) {
      throw new KaipuHttpError(400, 'missing_filename', '下载缺文件名 —— 取哪个件？')
    }
    const got = await this.requireHttp().downloadRaw(
      `${packBase(query)}/files/${encodeURIComponent(name)}${seatQuery(query)}`,
      signal,
    )
    return {
      ok: true,
      data: {
        filename: got.filename ?? name,
        contentType: got.contentType,
        contentBase64: bytesToBase64(got.bytes),
        size: got.bytes.length,
      },
    }
  }

  /** 删除（物理删成功后才删索引，服务端保证） */
  @Remote('packDelete')
  async packDelete(query: PackFileRefQuery, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const name = typeof query.filename === 'string' ? query.filename : ''
    if (name.length === 0) {
      throw new KaipuHttpError(400, 'missing_filename', '删除缺文件名 —— 删哪个件？')
    }
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'DELETE',
      `${packBase(query)}/files/${encodeURIComponent(name)}${seatQuery(query)}`,
      undefined,
      signal,
    )
    return { ok: true, data: data || {} }
  }

  /* ─────────────────────────────────────────────────────────────────────
   * ★ 座位与邀请（真实数据 —— 2026-10-19 真机反馈「座位邀请无法用」）
   *
   * 之前面板座位区读的是 `scaffold`（演示生成的状态），所以：
   *   · 看到的是「发起人位 / 协作方甲乙丙」假座位
   *   · 邀请只是一行文案，没有可点的动作
   * ⇒ 真正接上 `GET /roles/seats` + `POST /invites` 才谈得上「安排协作」。
   * ───────────────────────────────────────────────────────────────────── */

  /** 本铺真实席位（未开铺 ⇒ `{seats: []}`，不回落模板） */
  @Remote('rolesSeats')
  async rolesSeats(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<RolesSeatsPayload>> {
    void query
    const data = await this.requireHttp().call<{ seats?: RolesSeat[]; accountId?: string }>(
      'GET',
      '/roles/seats',
      undefined,
      signal,
    )
    return {
      ok: true,
      data: { seats: Array.isArray(data?.seats) ? data.seats : [], accountId: data?.accountId ?? '' },
    }
  }

  /* ── ★ 工位当前交互（存服务端 · 阿开 2026-10-19）──
   *   为什么要挪到服务端：交互 ID 是资料目录的键，「我上次在跟谁协作」
   *   不该因为重装插件就没了；换机器也得还在。 */

  /** 读当前交互（空铺返回空串，不报错） */
  @Remote('contextGet')
  async contextGet(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<WorkstationContext>> {
    void query
    const data = await this.requireHttp().call<WorkstationContext>('GET', '/workstation/context', undefined, signal)
    return {
      ok: true,
      data: {
        interactionId: typeof data?.interactionId === 'string' ? data.interactionId : '',
        seat: typeof data?.seat === 'string' ? data.seat : '',
        note: typeof data?.note === 'string' ? data.note : '',
        project: typeof data?.project === 'string' ? data.project : '',
        updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : '',
      },
    }
  }

  /** 写当前交互（覆盖写；改 ID = 换目录，旧资料不跟过来） */
  @Remote('contextPut')
  async contextPut(query: WorkstationContextWrite, signal?: CancelSignal): Promise<RemoteResult<WorkstationContext>> {
    const body: Record<string, string> = {}
    if (typeof query.interactionId === 'string') body.interactionId = query.interactionId
    if (typeof query.seat === 'string') body.seat = query.seat
    if (typeof query.note === 'string') body.note = query.note
    if (typeof query.project === 'string') body.project = query.project
    const data = await this.requireHttp().call<WorkstationContext>('POST', '/workstation/context', body, signal)
    return {
      ok: true,
      data: {
        interactionId: typeof data?.interactionId === 'string' ? data.interactionId : '',
        seat: typeof data?.seat === 'string' ? data.seat : '',
        note: typeof data?.note === 'string' ? data.note : '',
        project: typeof data?.project === 'string' ? data.project : '',
        updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : '',
      },
    }
  }

  /** ★ 请出一个位上的 Agent（只清这一个，不动别的位；多人同坐时必须点名） */
  @Remote('seatEvict')
  async seatEvict(query: { seat: string; agentId?: string }, signal?: CancelSignal): Promise<RemoteResult<{ seat: string; evicted: { agentId: string; name: string } }>> {
    const data = await this.requireHttp().call<{ seat?: string; evicted?: { agentId?: string; name?: string } }>(
      'POST', `/seats/${encodeURIComponent(query.seat)}/evict`,
      query.agentId !== undefined && query.agentId !== '' ? { agentId: query.agentId } : {}, signal)
    return {
      ok: true,
      data: {
        seat: typeof data?.seat === 'string' ? data.seat : query.seat,
        evicted: {
          agentId: typeof data?.evicted?.agentId === 'string' ? data.evicted.agentId : '',
          name: typeof data?.evicted?.name === 'string' ? data.evicted.name : '',
        },
      },
    }
  }

  /** ★ 一键清场：让所有 Agent 离场（清人不移位）—— 必须 `confirm: 'CLEAR'` */
  @Remote('orgClearAgents')
  async orgClearAgents(query: { confirm: string }, signal?: CancelSignal): Promise<RemoteResult<{ cleared: number; agents: Array<{ agentId: string; name: string; seat: string }> }>> {
    const data = await this.requireHttp().call<{ cleared?: number; agents?: Array<{ agentId: string; name: string; seat: string }> }>(
      'POST', '/org/clear-agents', { confirm: query.confirm }, signal)
    return {
      ok: true,
      data: {
        cleared: typeof data?.cleared === 'number' ? data.cleared : 0,
        agents: Array.isArray(data?.agents) ? data.agents : [],
      },
    }
  }

  /** 生成邀请（铺主 Bearer）—— `lamp` 必填（请这位 Agent 进哪一盏灯） */
  /**
   * ★ 2026-10-21（阿开拍板 L3）：铺主给本铺签一次性「设备加入码」。
   *   用途：另一台设备要用本铺 accountId 时，必须持码 —— 否则知道铺名就能进。
   */
  @Remote('deviceJoinCodeCreate')
  async deviceJoinCodeCreate(
    query: { note?: string; ttlHours?: number }, signal?: CancelSignal,
  ): Promise<RemoteResult<{ code: string; accountId: string; expiresAt: string; ttlHours: number; howTo?: string }>> {
    const body: Record<string, unknown> = {}
    if (typeof query.note === 'string' && query.note.length > 0) body.note = query.note
    if (typeof query.ttlHours === 'number' && Number.isFinite(query.ttlHours)) body.ttlHours = query.ttlHours
    const data = await this.requireHttp().call<{
      code: string; accountId: string; expiresAt: string; ttlHours: number; howTo?: string
    }>('POST', '/device-join-codes', body, signal)
    return { ok: true, data }
  }

  /**
   * ★ 2026-10-21（阿里星月建议）：设备台账 —— 本铺在册设备就是「白名单本体」。
   *   入册 = 用码进来过一次；出册 = 撤销（status=revoked），记录保留留痕。
   */
  @Remote('devicesList')
  async devicesList(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<{
    items: Array<{
      deviceId: string; fpHash8: string; fpHash: string; status: string
      clientVersion: string; firstSeen: string | null; lastSeen: string | null; issueCount: number
    }>
    count: number; activeCount: number
  }>> {
    void query
    const data = await this.requireHttp().call<{
      items: Array<{
        deviceId: string; fpHash8: string; fpHash: string; status: string
        clientVersion: string; firstSeen: string | null; lastSeen: string | null; issueCount: number
      }>
      count: number; activeCount: number
    }>('GET', '/devices', undefined, signal)
    return { ok: true, data }
  }

  /** 撤销 / 恢复一台设备（只改状态，不删记录） */
  @Remote('deviceRevoke')
  async deviceRevoke(
    query: { fpHash: string; revoked?: boolean }, signal?: CancelSignal,
  ): Promise<RemoteResult<{ fpHash8: string; status: string }>> {
    const fp = typeof query.fpHash === 'string' ? query.fpHash.trim() : ''
    if (fp.length < 8) throw new KaipuHttpError(400, 'missing_fp', '缺设备指纹')
    const data = await this.requireHttp().call<{ fpHash8: string; status: string }>(
      'POST', `/devices/${encodeURIComponent(fp)}/revoke`,
      { revoked: query.revoked !== false }, signal)
    return { ok: true, data }
  }

  /** 设备进出流水（含被挡下的） */
  @Remote('deviceEvents')
  async deviceEvents(
    query: { limit?: number }, signal?: CancelSignal,
  ): Promise<RemoteResult<{
    items: Array<{ id: number; fpHash8: string; event: string; note: string; at: string }>
    count: number
  }>> {
    const limit = typeof query.limit === 'number' && Number.isFinite(query.limit) ? query.limit : 50
    const data = await this.requireHttp().call<{
      items: Array<{ id: number; fpHash8: string; event: string; note: string; at: string }>
      count: number
    }>('GET', `/devices/events?limit=${limit}`, undefined, signal)
    return { ok: true, data }
  }

  @Remote('inviteCreate')
  async inviteCreate(query: InviteCreateQuery, signal?: CancelSignal): Promise<RemoteResult<InviteCreated>> {
    const lamp = typeof query.lamp === 'string' ? query.lamp.trim() : ''
    if (lamp.length === 0) {
      throw new KaipuHttpError(400, 'missing_lamp', '缺 lamp —— 要请这位 Agent 进哪一盏灯？')
    }
    const body: Record<string, unknown> = { lamp }
    if (typeof query.seat === 'string' && query.seat.trim().length > 0) body.seat = query.seat.trim()
    if (typeof query.note === 'string' && query.note.length > 0) body.note = query.note
    if (typeof query.ttlDays === 'number' && Number.isFinite(query.ttlDays)) body.ttlDays = query.ttlDays
    const data = await this.requireHttp().call<InviteCreated>('POST', '/invites', body, signal)
    return { ok: true, data }
  }

  /** 流水（带锚点对账：`ok=false` 表示链断，`brokenAtSeq` 指出第几行） */
  @Remote('packJournal')
  async packJournal(query: PackRefQuery, signal?: CancelSignal): Promise<RemoteResult<PackJournalPayload>> {
    const data = await this.requireHttp().call<PackJournalPayload>(
      'GET',
      `${packBase(query)}/journal${seatQuery(query)}`,
      undefined,
      signal,
    )
    // ★ exactOptionalPropertyTypes: true ⇒ 可选字段不能显式写 undefined，只能缺席
    const payload: PackJournalPayload = {
      interactionId: data?.interactionId ?? query.interactionId,
      lines: Array.isArray(data?.lines) ? data.lines : [],
      ok: data?.ok === true,
      brokenAtSeq: typeof data?.brokenAtSeq === 'number' ? data.brokenAtSeq : null,
    }
    if (typeof data?.seat === 'string') payload.seat = data.seat
    if (typeof data?.anchorOk === 'boolean') payload.anchorOk = data.anchorOk
    if (typeof data?.appendOnly === 'boolean') payload.appendOnly = data.appendOnly
    return { ok: true, data: payload }
  }
}

/**
 * 从 approve/reject 入参里取审批人（`approverId` 优先，服务端字段名 `approver_id` 兼容）。
 * ★ 缺参在 host 侧直接抛 —— 别让服务端回一个含义更模糊的 403 not_approver。
 */
function resolveApproverId(query: TaskApproveQuery): string {
  const id =
    typeof query.approverId === 'string' && query.approverId.length > 0
      ? query.approverId
      : typeof query.approver_id === 'string'
        ? query.approver_id
        : ''
  if (id.length === 0) {
    throw new KaipuHttpError(400, 'missing_approver_id', '审批缺 approverId —— 谁在批？')
  }
  return id
}

/* ─────────────────────────────────────────────────────────────────────
 * ★ 期6a-2 资料通道的辅助函数（host 侧 · 不引 Node/DOM 类型）
 * ───────────────────────────────────────────────────────────────────── */

/** `/packs/{interactionId}` —— interactionId 必须 encode（可能含非 ASCII） */
function packBase(query: PackRefQuery): string {
  const iid = typeof query.interactionId === 'string' ? query.interactionId : ''
  if (iid.length === 0) {
    throw new KaipuHttpError(400, 'missing_interaction_id', '缺交互 ID —— 资料在谁的位上？')
  }
  return `/packs/${encodeURIComponent(iid)}`
}

/** `?seat=xxx` 或空串（缺省交由服务端解析） */
function seatQuery(query: PackRefQuery): string {
  const seat = typeof query.seat === 'string' ? query.seat.trim() : ''
  return seat.length > 0 ? `?seat=${encodeURIComponent(seat)}` : ''
}

/** base64 → bytes（Node 有 Buffer 时走 Buffer，浏览器走 atob） */
function base64ToBytes(b64: string): Uint8Array {
  const raw = typeof b64 === 'string' ? b64.replace(/^data:[^,]*,/, '') : ''
  const g = globalThis as unknown as {
    Buffer?: { from(s: string, enc: string): Uint8Array }
    atob?: (s: string) => string
  }
  if (g.Buffer) return new Uint8Array(g.Buffer.from(raw, 'base64'))
  // ★ host tsconfig 无 DOM lib，atob 只能从 globalThis 取（浏览器环境才走到这里）
  const bin = g.atob ? g.atob(raw) : ''
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/** bytes → base64 */
function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as unknown as {
    Buffer?: { from(b: Uint8Array): { toString(enc: string): string } }
    btoa?: (s: string) => string
  }
  if (g.Buffer) return g.Buffer.from(bytes).toString('base64')
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return g.btoa ? g.btoa(s) : ''
}

/**
 * 算 sha256 十六进制。
 * ★ 必须**在客户端算**：服务端代算等于它可以同时换文件和摘要，签名归零。
 * ★ 用 WebCrypto（Node 18+ 全局有），不 import `node:crypto`（发布面不引宿主类型）。
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const c = (globalThis as unknown as { crypto?: { subtle?: { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> } } })
    .crypto
  if (!c?.subtle) {
    throw new KaipuHttpError(0, 'no_crypto', '当前宿主没有 WebCrypto（需 Node 18+）—— 算不出摘要，不能上传。')
  }
  const buf = await c.subtle.digest('SHA-256', bytes)
  const arr = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < arr.length; i += 1) out += (arr[i] ?? 0).toString(16).padStart(2, '0')
  return out
}
