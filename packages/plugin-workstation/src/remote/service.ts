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
}
