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
/* ★ `remoteMethods` 只在运行时入口导出、**类型声明里没有**（tsc 会报 TS2305）。
   ⇒ 走命名空间 + 结构断言取它：host half 不经打包，运行时确实拿得到。 */
import * as dshProtocol from '@deepseek-ai/dsh-typert-protocol'
// ★ 只 import type —— host half 不经打包，契约包是构建期依赖（用户机上没有），
//   类型被 tsc 擦除 ⇒ 不产生运行时依赖（由桥接检查脚本看护）。
import type {
  GrantCodeIssued,
  GrantCreated,
  GrantEvent,
  GrantListPayload,
  GrantRow,
  JoinRequestCreated,
  JoinRequestListPayload,
  JoinRequestRow,
  JoinRequestStatusPayload,
  RemoteResult,
  WorkstationState,
  WorkstationStatusPayload,
} from '@shanhai/kaipu-contract'
import { checkedWorkstationState, summarizeSeats } from './workstation-state.js'
import { KaipuHttpClient, KaipuHttpError, readAnyDeviceCred } from './kai-pu-http.js'

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
  /** ★ 2026-10-24（083-r3）：工位序号 —— 工位页与发布选择器**都只认这个**，
   *  不按数组下标、不自己编号（两处显示不一致就是阿开最在意的那个错）。 */
  seq?: number
  /** ★ 2026-10-24（083-r2）：这个位子上的邀请还挂着（人没来）。
   *  ★ 只有 `holders` 为空时它才有意义 —— 人已到就说明邀请已完成，不该再显示。 */
  invited?: { lamp?: string; invitedName?: string; invitedAt?: string } | null
  /** ★ 2026-10-24（083-r2）：席位上的凭据姿态。present=90 秒内有心跳 /
   *  joined=有凭据没心跳 / invited=邀请发了人还没来。老数据可能没有。 */
  holders?: {
    agentId?: string
    name?: string
    seat?: string
    online?: boolean
    onRoster?: boolean
    hasCred?: boolean
    joinState?: string
  }[]
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
  /** ★ 2026-10-23：这次任务的就交互 ID（前端预生 `task-<uuid>` 后回填，附件才有地方落） */
  interactionId?: string
  /**
   * ★ 2026-10-24（083-r1）：点名通知某个 Agent。传 **id 不传名字**（名字可重，id 不会）。
   *   空/不传 ⇒ 公池，与旧行为完全一致（硬约束：默认必须是不点名）。
   *
   * ★ 字段名为什么是 camelCase 而不是 snake_case：
   *   本接口其余字段都是 snake（node_id / project_id / interaction_id），照抄会写错。
   *   实测 `POST /tasks` 带 `notify_agent` 返回 400 `unknown_field`（`notifyAgent` 当时也返回 unknown_field，
   *   说明服务端这版还没上这个字段 —— 见 notify-copy.isNotifyUnsupported 的降级处理）。
   *   ⇒ 服务端一旦上线，按任务书口径就是 `notifyAgent`，这里已按它发。
   */
  notifyAgent?: string
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

/**
 * `packsInteractions` 的一行 —— 「一次协作有哪几个文件」。
 *
 * ★ 2026-10-23（083 单 G-3）：`title` / `projectName` / `projectId` 是**新补的人话字段**。
 *   服务端没跟上时这三个字段缺席，前端必须走兜底文案，
 *   **绝不允许再回退去显示 `interactionId`**（客户不该看到 `task-<UUID>`）。
 */
export interface PackInteractionRow {
  interactionId: string
  files: number
  seats: number
  lastAt: string
  /** 这次协作对应的任务标题（服务端补） */
  title?: string
  /** 所属项目名（服务端补；未归属项目的协作可以没有） */
  projectName?: string
  /** 所属项目 id（服务端补；用来分组，不显示） */
  projectId?: string
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
/** ★ 2026-10-24（083-r2）：邀码列表一行。**没有明文字段** —— 服务端只存 hash。 */
export interface JoinCodeRow {
  codeHash: string
  note?: string
  seat?: string
  invitedName?: string
  /** pending | used | expired | revoked */
  state: string
  createdAt: string
  expiresAt: string
  usedAt?: string | null
  usedBy?: string
  revokedAt?: string | null
  batchId?: string
}

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
 * ★★ 2026-10-21（0.2.54）· 所有 `@Remote` 方法的统一**错误边界**
 *
 * 为什么不能靠抛异常跨网关：
 *   0.2.53 实测 —— host 抛出的自定义异常被标记成 DSH `RemoteError` 后，
 *   点归档直接得到 `connection: invalid server-response failure`
 *   （网关无法编码它），用户只看到一句笼统失败。
 *   协议里**业务失败的正规载体是返回值**（contract `RemoteErr`），不是异常。
 *
 * 为什么能在这里包：`@Remote` 的 marker 记的是**方法名**（挂在 prototype 的
 *   `@deepseek-ai/dsh-typert-protocol/remote-methods` descriptor 上），
 *   网关按 `service[name](…)` 取名调用 ⇒ 在实例上覆盖同名方法即生效，marker 不受影响。
 *   一次覆盖 47 处调用点，不用逐方法 try/catch。
 *
 * 边界规则：
 *   · `KaipuHttpError`（服务端 4xx/5xx 业务错）⇒ `{ok:false, kind, error, code}` 正常返回
 *     （纯 JSON，一定过 wire；`code` 保住，前端按码分支才有效）
 *   · 其它异常照旧抛 —— 那是真 bug，要让它炸出来，别吞。
 */
type RemoteMethodMarker = { readonly method: string }
type RemoteMethodsFn = (service: object) => ReadonlyArray<RemoteMethodMarker>

/** 运行时取 `remoteMethods`（见上方 import 注释）；取不到返回 empty（边界不装，但不崩） */
function listRemoteMethods(service: object): ReadonlyArray<RemoteMethodMarker> {
  const fn = (dshProtocol as unknown as { remoteMethods?: RemoteMethodsFn }).remoteMethods
  return typeof fn === 'function' ? fn(service) : []
}

export function installErrorBoundary(target: object): void {
  const holder = target as unknown as Record<string, unknown>
  for (const marker of listRemoteMethods(target)) {
    const name = marker.method
    const orig = holder[name]
    if (typeof orig !== 'function') continue
    const callOriginal = orig as (...args: unknown[]) => Promise<unknown>
    holder[name] = async (...args: unknown[]): Promise<unknown> => {
      try {
        return await callOriginal.apply(target, args)
      } catch (e) {
        if (e instanceof KaipuHttpError) {
          /* 4xx = 业务拒绝（denied）；5xx/0 = 故障（error）—— 前端据此决定措辞与去路 */
          const kind = e.status >= 400 && e.status < 500 ? 'denied' : 'error'
          return { ok: false, kind, error: e.message, code: e.code }
        }
        throw e
      }
    }
  }
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
    /* ★ 0.2.54：装统一错误边界 —— 必须**在构造末尾**（此时 @Remote marker 已由
       类字段初始化器写到 prototype 上，方法也都就位）。 */
    installErrorBoundary(this)
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
  /** 本机设备码（「设备码」tab 用）—— 只读本地 ~/.kai-pu/，不发网络请求 */
  @Remote('deviceCred')
  async deviceCred(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<{ deviceId: string; deviceSecret: string } | null>> {
    void query
    void signal
    return { ok: true, data: readAnyDeviceCred() }
  }

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
    if (typeof query.interactionId === 'string' && query.interactionId.length > 0) body.interaction_id = query.interactionId
    /* ★ 2026-10-24：点名通知。**camelCase** —— 本接口字段白名单是硬校验的（多余字段 400 unknown_field），
       实测 snake 的 notify_agent 被拒，报错原文就是「不认识的字段：['notify_agent']」。
       留空不发（不传 = 公池），存量调用零影响。 */
    if (typeof query.notifyAgent === 'string' && query.notifyAgent.length > 0) body.notifyAgent = query.notifyAgent
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

  /** 改项目名（★ 2026-10-23 阿开：「项目名称也改不了」）
      ★ 不支持删除：项目是数据链的锚，删了任务变孤儿。要不看见 → 归档。 */
  @Remote('projectsRename')
  async projectsRename(query: { projectId: string; name: string }, signal?: CancelSignal): Promise<RemoteResult<{ projectId: string; name: string }>> {
    const pid = typeof query.projectId === 'string' ? query.projectId : ''
    const name = (query.name ?? '').trim()
    if (pid.length === 0) throw new KaipuHttpError(400, 'missing_project_id', '改名缺项目 id')
    if (name.length === 0) throw new KaipuHttpError(400, 'empty_name', '项目名不能为空。')
    const data = await this.requireHttp().call<{ projectId: string; name: string }>(
      'PATCH', `/projects/${encodeURIComponent(pid)}`, { name }, signal)
    return { ok: true, data }
  }

  /**
   * 推进项目阶段 · `PATCH /projects/{id}/phase`（2026-10-26 · Agent 版 OA）
   *
   * ★ 为什么不在前端做「跳阶」的宽容处理：
   *   服务端只允许 ±1 与「任意 → archived」，前端如果自己放宽（比如允许直接跳 build），
   *   就会变成「界面能点、服务端 400 phase_skip」—— 那是把后台判据搬到前台重写，
   *   两份规则迟早不一致。前端只负责**只显示合法的下一步**。
   */
  @Remote('projectPhaseSet')
  async projectPhaseSet(
    query: { projectId: string; phase: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<{ projectId: string; phase: string; from?: string; changed: boolean }>> {
    const pid = typeof query.projectId === 'string' ? query.projectId : ''
    const phase = (query.phase ?? '').trim()
    if (pid.length === 0) throw new KaipuHttpError(400, 'missing_project_id', '改阶段缺项目 id')
    if (phase.length === 0) throw new KaipuHttpError(400, 'missing_phase', '改阶段缺目标阶段')
    const data = await this.requireHttp().call<{ projectId: string; phase: string; from?: string; changed: boolean }>(
      'PATCH', `/projects/${encodeURIComponent(pid)}/phase`, { phase }, signal)
    return { ok: true, data }
  }

  /** 读任务依赖（前置 + 后继 + 能不能领）· `GET /tasks/{id}/deps` */
  @Remote('tasksDepsList')
  async tasksDepsList(
    query: { taskId: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<{
    task_id: string
    dependsOn: Array<{ id: string; title: string; status: string }>
    blocks: Array<{ id: string; title: string; status: string }>
    unmet: number
    claimable: boolean
  }>> {
    const tid = typeof query.taskId === 'string' ? query.taskId : ''
    if (tid.length === 0) throw new KaipuHttpError(400, 'missing_task_id', '读依赖缺任务 id')
    const data = await this.requireHttp().call<{
      task_id: string
      dependsOn: Array<{ id: string; title: string; status: string }>
      blocks: Array<{ id: string; title: string; status: string }>
      unmet: number
      claimable: boolean
    }>('GET', `/tasks/${encodeURIComponent(tid)}/deps`, undefined, signal)
    return { ok: true, data }
  }

  /** 撤一条依赖（会立刻放行因它卡住的后继）· `DELETE /tasks/{id}/deps/{dep}` */
  @Remote('tasksDepsDelete')
  async tasksDepsDelete(
    query: { taskId: string; dependsOnTaskId: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<{ task_id: string; depends_on_task_id: string; removed: boolean }>> {
    const tid = typeof query.taskId === 'string' ? query.taskId : ''
    const dep = typeof query.dependsOnTaskId === 'string' ? query.dependsOnTaskId : ''
    if (tid.length === 0 || dep.length === 0) {
      throw new KaipuHttpError(400, 'missing_ids', '撤依赖缺任务 id 或前置 id')
    }
    const data = await this.requireHttp().call<{ task_id: string; depends_on_task_id: string; removed: boolean }>(
      'DELETE', `/tasks/${encodeURIComponent(tid)}/deps/${encodeURIComponent(dep)}`, undefined, signal)
    return { ok: true, data }
  }

  /** 读交付版本（全部稿 + 哪一稿是最终）· `GET /tasks/{id}/deliverables` */
  @Remote('deliverablesList')
  async deliverablesList(
    query: { taskId: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<{
    task_id: string
    versions: number[]
    count: number
    finalVersion: number
    items: Array<{
      id: string; version: number; is_final: number; filename: string
      size: number; sha256: string; interaction_id: string; created_at: string
    }>
  }>> {
    const tid = typeof query.taskId === 'string' ? query.taskId : ''
    if (tid.length === 0) throw new KaipuHttpError(400, 'missing_task_id', '读交付版本缺任务 id')
    const data = await this.requireHttp().call<{
      task_id: string
      versions: number[]
      count: number
      finalVersion: number
      items: Array<{
        id: string; version: number; is_final: number; filename: string
        size: number; sha256: string; interaction_id: string; created_at: string
      }>
    }>('GET', `/tasks/${encodeURIComponent(tid)}/deliverables`, undefined, signal)
    return { ok: true, data }
  }

  /** 指定某一稿为最终稿（回退旧稿用）· `POST /tasks/{id}/deliverables/{did}/promote` */
  @Remote('deliverablePromote')
  async deliverablePromote(
    query: { taskId: string; deliverableId: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<{ task_id: string; deliverable_id: string; version: number; is_final: boolean }>> {
    const tid = typeof query.taskId === 'string' ? query.taskId : ''
    const did = typeof query.deliverableId === 'string' ? query.deliverableId : ''
    if (tid.length === 0 || did.length === 0) {
      throw new KaipuHttpError(400, 'missing_ids', '指定最终稿缺任务 id 或稿 id')
    }
    const data = await this.requireHttp().call<{ task_id: string; deliverable_id: string; version: number; is_final: boolean }>(
      'POST', `/tasks/${encodeURIComponent(tid)}/deliverables/${encodeURIComponent(did)}/promote`, {}, signal)
    return { ok: true, data }
  }

  /** 归档项目：打包全部任务资料 + manifest（只读原件，不删） */
  /** ★ 2026-10-21：取消归档（阿开拍板：归档能回来，像 DeepSeek 会话那样） */
  @Remote('projectUnarchive')
  async projectUnarchive(query: { projectId: string }, signal?: CancelSignal): Promise<RemoteResult<{ projectId: string; status: string }>> {
    const pid = typeof query.projectId === 'string' ? query.projectId : ''
    if (pid.length === 0) throw new KaipuHttpError(400, 'missing_project_id', '取消归档缺项目 id')
    const data = await this.requireHttp().call<{ projectId: string; status: string }>(
      'POST', `/projects/${encodeURIComponent(pid)}/unarchive`, {}, signal)
    return { ok: true, data }
  }

  /** ★ 2026-10-21：下载最近一次归档包（base64 —— @Remote 只走 JSON，拿不了二进制流） */
  @Remote('projectArchiveDownload')
  async projectArchiveDownload(query: { projectId: string }, signal?: CancelSignal): Promise<RemoteResult<{ filename: string; bytes: number; sha256: string; stale?: boolean; staleSince?: string; dataBase64: string }>> {
    const pid = typeof query.projectId === 'string' ? query.projectId : ''
    if (pid.length === 0) throw new KaipuHttpError(400, 'missing_project_id', '下载归档缺项目 id')
    const data = await this.requireHttp().call<{ filename: string; bytes: number; sha256: string; stale?: boolean; staleSince?: string; dataBase64: string }>(
      'GET', `/projects/${encodeURIComponent(pid)}/archive/base64`, undefined, signal)
    return { ok: true, data }
  }

  @Remote('projectArchive')
  async projectArchive(query: { projectId: string; force?: boolean }, signal?: CancelSignal): Promise<RemoteResult<Record<string, unknown>>> {
    const data = await this.requireHttp().call<Record<string, unknown>>(
      'POST',
      `/projects/${encodeURIComponent(query.projectId)}/archive`,
      { force: query.force === true },
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
  /* ★ 2026-10-23（083 单 G-3 · 星月）：每条**必须**带人话名字。
     原来只回 `{interactionId, files, seats, lastAt}` ⇒ 界面只能拿 `task-<UUID>` 截 22 字当标签，
     客户看到一串机器号（验收 A-4：主界面零 `task-` 字样）。
     三个字段都是**可选**：老服务端不返回时前端走兜底文案（不显示 UUID），不报错。 */
  @Remote('packsInteractions')
  async packsInteractions(query: Record<string, never>, signal?: CancelSignal): Promise<RemoteResult<{ interactions: PackInteractionRow[] }>> {
    void query
    const data = await this.requireHttp().call<{ interactions?: PackInteractionRow[] }>(
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

  /* ── ★★ 2026-10-23 · 管理助理授权（承响石 018 号方案 + 阿开 A/B/C/D 拍板）
   *
   *  为什么要有这一组：
   *    管理位可以临时把「代管权」交给一个人（24h / 72h / 1 周），
   *    到期自动失效并转执行位。没有界面，这个能力等于不存在 ——
   *    管理位不可能去手敲 curl 授一个 24 小时的权。
   *
   *  ★ 规则（写死在按钮文案里，别让用户猜）：
   *    · 只有管理位本人能授、能收
   *    · 授权刻起算，不是首次使用才起算（安全窗口与计时起点必须同一时刻）
   *    · 收回即时生效（判定层实时读库，无缓存）
   *    · 到期自动转执行位（不留权、不白占席位）
   * ───────────────────────────────────────────────────────────────── */

  /** 本铺授权台账（谁在代管、还剩多久） */
  @Remote('grantList')
  async grantList(query: { status?: string }, signal?: CancelSignal): Promise<RemoteResult<GrantListPayload>> {
    const qs = query?.status ? `?status=${encodeURIComponent(query.status)}` : ''
    const data = await this.requireHttp().call<{
      grants?: GrantRow[]; ttlOptions?: number[]; accountId?: string
    }>('GET', '/grants' + qs, undefined, signal)
    return {
      ok: true,
      data: {
        grants: Array.isArray(data?.grants) ? data.grants : [],
        ttlOptions: Array.isArray(data?.ttlOptions) ? data.ttlOptions : [24, 72, 168],
        accountId: data?.accountId ?? '',
      },
    }
  }

  /** 授予管理助理权（时长只有 24 / 72 / 168 三档） */
  @Remote('grantCreate')
  async grantCreate(
    query: { granteeId: string; ttlHours: number; name?: string; note?: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<GrantCreated>> {
    const data = await this.requireHttp().call<GrantCreated>('POST', '/grants', {
      granteeId: query.granteeId,
      ttlHours: query.ttlHours,
      ...(query.name ? { name: query.name } : {}),
      ...(query.note ? { note: query.note } : {}),
    }, signal)
    return { ok: true, data }
  }

  /* ── ★ 2026-10-23（083 单 G-1 · 星月）：管理助理改「授权码」───────────────
   *   旧形态：手填「对方的 Agent id」⇒ 管理位得先知道对方内部 ID 才能授权，
   *   而客户根本不知道那串 ID（那条输入框就是 0.2.78 界面上的绊脚石）。
   *   新形态：点「生成授权码」→ 出一串 `SHANHAI-GRANT-XXXX-XXXX` →
   *   复制整段话发给对方 → 对方发给他自己的 Agent → Agent 调 `/grants/redeem` 兑换。
   *
   *   ★ 库内**只存 `SHA256(code)`**，明文只返回这一次（服务端语义）。
   *   ★ 码 7 天有效；**代管计时从兑换那一刻起算**（不是从生成起算）。
   *   ★ `grantCreate`（直传 granteeId）保留 —— 给 Agent 自动化用，界面不再走它。 */

  @Remote('grantGenerate')
  async grantGenerate(
    query: { ttlHours: number; note?: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<GrantCodeIssued>> {
    const data = await this.requireHttp().call<GrantCodeIssued>('POST', '/grants/generate', {
      ttlHours: query.ttlHours,
      ...(query.note ? { note: query.note } : {}),
    }, signal)
    return { ok: true, data }
  }

  /** 收回（即时生效） */
  @Remote('grantRevoke')
  async grantRevoke(
    query: { grantId: string; reason?: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<{ grantId: string; status: string; revokedAt: string }>> {
    const gid = encodeURIComponent(query.grantId)
    const data = await this.requireHttp().call<{ grantId: string; status: string; revokedAt: string }>(
      'POST', `/grants/${gid}/revoke`, query.reason ? { reason: query.reason } : {}, signal)
    return { ok: true, data }
  }

  /** 授权流水（actor + onBehalfOf 双字段） */
  @Remote('grantEvents')
  async grantEvents(
    query: { grantId: string },
    signal?: CancelSignal,
  ): Promise<RemoteResult<{ grantId: string; events: GrantEvent[] }>> {
    const gid = encodeURIComponent(query.grantId)
    const data = await this.requireHttp().call<{ grantId: string; events?: GrantEvent[] }>(
      'GET', `/grants/${gid}/events`, undefined, signal)
    return { ok: true, data: { grantId: data?.grantId ?? query.grantId, events: Array.isArray(data?.events) ? data.events : [] } }
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
  /** ★ 2026-10-22（丙）：本人重置设备码（旧 secret 立即作废，新 secret 写回本地） */
  @Remote('deviceResetSecret')
  async deviceResetSecret(
    query: EmptyQuery, signal?: CancelSignal,
  ): Promise<RemoteResult<{ deviceId: string; deviceSecret: string; expiresAt?: string }>> {
    const data = await this.requireHttp().resetDeviceSecret(signal)
    return { ok: true, data }
  }

  @Remote('deviceJoinCodeCreate')
  async deviceJoinCodeCreate(
    query: { note?: string; ttlHours?: number; count?: number; seat?: string; invitedName?: string }, signal?: CancelSignal,
  ): Promise<RemoteResult<{ code: string; accountId: string; expiresAt: string; ttlHours: number; howTo?: string; codes?: { code: string; codeHash: string; expiresAt: string }[] }>> {
    const body: Record<string, unknown> = {}
    if (typeof query.note === 'string' && query.note.length > 0) body.note = query.note
    if (typeof query.ttlHours === 'number' && Number.isFinite(query.ttlHours)) body.ttlHours = query.ttlHours
    /* ★ 2026-10-24（083-r2）：批量与座位/受邀人。不传 count ⇒ 服务端按 1 张处理（存量零影响）。 */
    if (typeof query.count === 'number' && Number.isFinite(query.count) && query.count > 1) body.count = query.count
    if (typeof query.seat === 'string' && query.seat.length > 0) body.seat = query.seat
    if (typeof query.invitedName === 'string' && query.invitedName.length > 0) body.invitedName = query.invitedName
    const data = await this.requireHttp().call<{
      code: string; accountId: string; expiresAt: string; ttlHours: number; howTo?: string
      codes?: { code: string; codeHash: string; expiresAt: string }[]
    }>('POST', '/device-join-codes', body, signal)
    return { ok: true, data }
  }

  /* ── ★★ 2026-10-24（083-r2）：邀请码列表化三个只读/管理端点 ──
     ★ 列表**永不返回明文**（服务端只存 hash）—— 所以明文只能留在用户本机，
       这也是「切页面回来码还在」只能靠 localStorage 的根本原因。
     ★ 作废/续期都用 `codeHash`（12 位）定位，不是明文。 */
  @Remote('deviceJoinCodes')
  async deviceJoinCodes(
    query: { state?: string }, signal?: CancelSignal,
  ): Promise<RemoteResult<{ codes: JoinCodeRow[]; count?: number }>> {
    const qs = typeof query.state === 'string' && query.state.length > 0
      ? `?state=${encodeURIComponent(query.state)}` : ''
    const data = await this.requireHttp().call<{ codes?: JoinCodeRow[]; count?: number }>(
      'GET', `/device-join-codes${qs}`, undefined, signal)
    const codes = Array.isArray(data.codes) ? data.codes : []
    /* ★ exactOptionalPropertyTypes：`count` 只能**缺席**，不能显式给 undefined */
    return {
      ok: true,
      data: typeof data.count === 'number' ? { codes, count: data.count } : { codes },
    }
  }

  @Remote('deviceJoinCodeRevoke')
  async deviceJoinCodeRevoke(
    query: { codeHash: string }, signal?: CancelSignal,
  ): Promise<RemoteResult<{ codeHash: string; state: string }>> {
    const h = (query.codeHash ?? '').trim()
    const data = await this.requireHttp().call<{ codeHash?: string; state?: string }>(
      'POST', `/device-join-codes/${encodeURIComponent(h)}/revoke`, {}, signal)
    return { ok: true, data: { codeHash: data.codeHash ?? h, state: data.state ?? 'revoked' } }
  }

  @Remote('deviceJoinCodeRenew')
  async deviceJoinCodeRenew(
    query: { codeHash: string; ttlHours?: number }, signal?: CancelSignal,
  ): Promise<RemoteResult<{ codeHash: string; state: string; expiresAt: string }>> {
    const h = (query.codeHash ?? '').trim()
    const body: Record<string, unknown> = {}
    if (typeof query.ttlHours === 'number' && Number.isFinite(query.ttlHours)) body.ttlHours = query.ttlHours
    const data = await this.requireHttp().call<{ codeHash?: string; state?: string; expiresAt?: string }>(
      'POST', `/device-join-codes/${encodeURIComponent(h)}/renew`, body, signal)
    return {
      ok: true,
      data: { codeHash: data.codeHash ?? h, state: data.state ?? 'pending', expiresAt: data.expiresAt ?? '' },
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     ★★ 2026-10-24 · 邀请码补发闭环（083 第一批 · 块 A · 5 个端点）

     契约来源：星月任务书 §二（`需求/017` 为准）。**一个字段都不许自己加** ——
     后端 `gateway.py` 的四个端点按那份契约实现，多传字段会被当未知键忽略，
     少传必填（`accountId`/`applicantKind`/`applicantId`）会 400。

     ★ 为什么 `deviceFp` 在 host 侧自动填：指纹由 host 推导（`deriveFingerprint()`），
       **渲染层拿不到也不需要拿**。申请人「无旧码」时唯一能自证的就是这台机器，
       所以这一项必须由 host 兜底，不能指望前端记得传。
     ★ 为什么 `joinRequestCreate` 允许 `joinCode` 与指纹**都给**：
       契约写的是「与 deviceFp 至少一个」。两个都给 = 最强自证（旧码 + 原机器）。
     ══════════════════════════════════════════════════════════════════ */

  /** 铺主看待审批列表 · `GET /join/requests?status=pending` */
  @Remote('joinRequests')
  async joinRequests(
    query: { status?: string }, signal?: CancelSignal,
  ): Promise<RemoteResult<JoinRequestListPayload>> {
    const status = typeof query.status === 'string' && query.status.length > 0 ? query.status : 'pending'
    const data = await this.requireHttp().call<{ items?: JoinRequestRow[]; count?: number }>(
      'GET', `/join/requests?status=${encodeURIComponent(status)}`, undefined, signal)
    const items = Array.isArray(data?.items) ? data.items : []
    /* ★ `count` 以服务端为准；服务端没给就按 items 长度兜底（**不要**用它算红点以外的东西） */
    const count = typeof data?.count === 'number' && Number.isFinite(data.count) ? data.count : items.length
    return { ok: true, data: { items, count } }
  }

  /** 申请人查自己那张 · `GET /join/request/{id}` */
  @Remote('joinRequestGet')
  async joinRequestGet(
    query: { requestId: string }, signal?: CancelSignal,
  ): Promise<RemoteResult<JoinRequestStatusPayload>> {
    const rid = typeof query.requestId === 'string' ? query.requestId.trim() : ''
    if (rid.length === 0) throw new KaipuHttpError(400, 'missing_request_id', '查申请状态缺申请号')
    const data = await this.requireHttp().call<JoinRequestStatusPayload>(
      'GET', `/join/request/${encodeURIComponent(rid)}`, undefined, signal)
    return { ok: true, data }
  }

  /** 提交补发申请（无鉴权，靠旧码/指纹自证）· `POST /join/request` */
  @Remote('joinRequestCreate')
  async joinRequestCreate(
    query: {
      accountId: string
      applicantKind: string
      applicantId: string
      joinCode?: string
      applicantName?: string
      nodeId?: string
      seat?: string
      reason?: string
    },
    signal?: CancelSignal,
  ): Promise<RemoteResult<JoinRequestCreated>> {
    const accountId = typeof query.accountId === 'string' ? query.accountId.trim() : ''
    const applicantKind = typeof query.applicantKind === 'string' ? query.applicantKind.trim() : ''
    const applicantId = typeof query.applicantId === 'string' ? query.applicantId.trim() : ''
    if (accountId.length === 0) throw new KaipuHttpError(400, 'missing_account_id', '不知道要申请哪个铺子')
    if (applicantKind !== 'agent' && applicantKind !== 'human') {
      throw new KaipuHttpError(400, 'bad_applicant_kind', '申请人类型只能是 agent 或 human')
    }
    if (applicantId.length === 0) throw new KaipuHttpError(400, 'missing_applicant_id', '不知道你是谁')

    const body: Record<string, unknown> = { accountId, applicantKind, applicantId }
    /* ★ 指纹：host 侧兜底 —— 申请人「没旧码」时这是唯一自证物（契约：与 joinCode 至少一个） */
    const fp = this.requireHttp().fingerprintHint().trim()
    if (fp.length > 0) body.deviceFp = fp
    const joinCode = typeof query.joinCode === 'string' ? query.joinCode.trim() : ''
    if (joinCode.length > 0) body.joinCode = joinCode
    for (const [k, v] of [
      ['applicantName', query.applicantName], ['nodeId', query.nodeId],
      ['seat', query.seat], ['reason', query.reason],
    ] as const) {
      if (typeof v === 'string' && v.trim().length > 0) body[k] = v.trim()
    }
    const data = await this.requireHttp().callAnon<JoinRequestCreated>('POST', '/join/request', body, signal)
    return { ok: true, data }
  }

  /**
   * 同意（仅铺主）· `POST /join/request/{id}/approve`
   * ★ 返回里的 `joinCode` 是**新码明文**，只此一次 —— 前端必须当场显示 + 给复制，
   *   不要吞掉、不要落盘（它不是凭据，但泄露等于谁能进铺子）。
   */
  @Remote('joinRequestApprove')
  async joinRequestApprove(
    query: { requestId: string }, signal?: CancelSignal,
  ): Promise<RemoteResult<JoinRequestStatusPayload>> {
    const rid = typeof query.requestId === 'string' ? query.requestId.trim() : ''
    if (rid.length === 0) throw new KaipuHttpError(400, 'missing_request_id', '同意哪一条申请？')
    const data = await this.requireHttp().call<JoinRequestStatusPayload>(
      'POST', `/join/request/${encodeURIComponent(rid)}/approve`, {}, signal)
    return { ok: true, data }
  }

  /** 拒绝（仅铺主）· `POST /join/request/{id}/reject`（理由可空） */
  @Remote('joinRequestReject')
  async joinRequestReject(
    query: { requestId: string; reason?: string }, signal?: CancelSignal,
  ): Promise<RemoteResult<{ requestId: string; status: string }>> {
    const rid = typeof query.requestId === 'string' ? query.requestId.trim() : ''
    if (rid.length === 0) throw new KaipuHttpError(400, 'missing_request_id', '拒绝哪一条申请？')
    const body: Record<string, unknown> = {}
    if (typeof query.reason === 'string' && query.reason.trim().length > 0) body.reason = query.reason.trim()
    const data = await this.requireHttp().call<{ requestId: string; status: string }>(
      'POST', `/join/request/${encodeURIComponent(rid)}/reject`, body, signal)
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
