/**
 * 山海·开铺 · 工位插件 · client half —— 宿主通道（data channel）
 * =====================================================================
 * 面板**不直连服务端域名**，而是经**宿主网关**调本插件的 host half：
 *
 *   浏览器(client)  --connection.rpc.call('/api','kaipu-workstation/state',{args:{query}})-->
 *   DSH 网关（同源 · 已鉴权）  --> 工位插件的 host half（Node） --> scaffold 持久化态
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 与 plugin-wisdom 的 bridge.ts **同构但独立**（三包互不 import）。
 *   端点常量 REMOTE_NS / ENDPOINTS 各写一份，由 `tools/check-remote-bridge.mjs`
 *   的 **F 组**看护一致 —— 本包是**两处**（client `bridge.ts` ↔ host `service.ts`）。
 *   ⚠️ 与场地那组不同：场地三处共用 NS `kaipu`（判据 A「三侧同值」）；本包有**自己的**
 *      NS `kaipu-workstation` ⇒ F 组同时断言「本包两处同值」+「与场地**不撞名**」。
 *   （★ 2026-10-10 订正：原写"共三处"，是照抄场地注释时带过来的不准确表述。）
 *
 * ★ 调用形态两个硬细节（从场地侧逐字照搬）：
 *   ① `payload.args` 必须是对象、键名 = host 方法的参数名：`{ args: { query } }`
 *   ② `call()` 返回已剥过一层信封：拿到的是 `result`。两层 `ok` 必须分清。
 * ══════════════════════════════════════════════════════════════════
 */

export const REMOTE_NS = 'kaipu-workstation'

/** 调用通道（宿主网关的逻辑通道名）—— ★ 永不进真实 URL */
export const REMOTE_CHANNEL = '/api'

/** 宿主网关服务键（DSH 的 wire root 服务） */
export const CONNECTION_SERVICE = 'connection'

/** ★ 工位插件端点清单。前两个是期1 只读态，后四个是期4 组织层真操作。 */
export const ENDPOINTS = {
  /** 接没接上 + 种子概览（第一件要知道的事） */
  status: 'status',
  /** 工位完整持久化态（座位/球/轮次/留痕/事件流底座） */
  state: 'state',
  /** ★ 组织树（真数据）：工位节点 + 协作边 */
  orgTree: 'orgTree',
  /** ★ 新建工位节点 */
  orgNodeCreate: 'orgNodeCreate',
  /** ★ 改工位：改名 / 换上级 / 绑席位 / 解绑 */
  orgNodePatch: 'orgNodePatch',
  /** ★ 归档工位（软删） */
  orgNodeDelete: 'orgNodeDelete',
  /** ★ 期5 任务层：发布 */
  tasksCreate: 'tasksCreate',
  /** ★ 期5 任务层：列表 */
  tasksList: 'tasksList',
  /** ★ 期5 任务层：领取 */
  tasksClaim: 'tasksClaim',
  /** ★ 期5 任务层：完成 */
  tasksDone: 'tasksDone',
  /** ★ 期6-L2 项目层：清单 */
  projectsList: 'projectsList',
  /** ★ 期6-L2 项目层：新建 */
  projectsCreate: 'projectsCreate',
  /** ★ 期6-L2 项目层：归档（打包 + manifest） */
  projectArchive: 'projectArchive',

  /* ── ★ 期5b-1 任务层补齐（后端已实现 · 本轮接线）──
     ★ 值是**网关方法名**（host `service.ts` 的 `@Remote`），**不是** HTTP 路径。
       HTTP 路径由 host 侧拼（`{id}` 处一律 `encodeURIComponent(query.taskId)`），
       `${id}` 不进 wire —— 与 `tasksClaim` 的写法完全一致。
       对应后端路由见每条注释。 */
  /** 开工（claimed/rejected → in_progress）· `POST /tasks/{id}/start` */
  tasksStart: 'tasksStart',
  /** 租约续期 · `POST /tasks/{id}/heartbeat` */
  tasksHeartbeat: 'tasksHeartbeat',
  /** 阻塞求助（必带 reason）· `POST /tasks/{id}/block` */
  tasksBlock: 'tasksBlock',
  /** 解除求助阻塞 · `POST /tasks/{id}/unblock` */
  tasksUnblock: 'tasksUnblock',
  /** 强行指派（期5b-2 接 UI，本轮只开通道）· `POST /tasks/{id}/assign` */
  tasksAssign: 'tasksAssign',
  /** 加依赖（期5b-2 接 UI，本轮只开通道）· `POST /tasks/{id}/deps` */
  tasksDeps: 'tasksDeps',
  /** HITL 审批通过 · `POST /tasks/{id}/approve` */
  tasksApprove: 'tasksApprove',
  /** HITL 驳回 · `POST /tasks/{id}/reject` */
  tasksReject: 'tasksReject',
  /** 看板分组（期5b-2 接 UI，本轮只开通道）· `GET /tasks/board` */
  tasksBoard: 'tasksBoard',
  /** 阻塞列表 · `GET /tasks/blocked` */
  tasksBlocked: 'tasksBlocked',
  /** 待审批列表 · `GET /tasks/pending-approvals` */
  tasksPendingApprovals: 'tasksPendingApprovals',
  /** ★ 本人身份（服务端 `account_id`）—— 心跳判据：只对 `claimed_by == 本人` 发 */
  whoami: 'whoami',

  /* ── ★ 期6a-2 资料按位（5 个端点 · 与服务端 ROUTES 一一对应）── */
  /** 列位上的文件 · `GET /packs/{iid}/files` */
  packsList: 'packsList',
  /** 上传（raw body + X-Filename + X-Body-Sha256）· `POST /packs/{iid}/files` */
  packUpload: 'packUpload',
  /** 下载（二进制）· `GET /packs/{iid}/files/{name}` */
  packDownload: 'packDownload',
  /** 删除 · `DELETE /packs/{iid}/files/{name}` */
  packDelete: 'packDelete',
  /** 流水（hash 链 + 锚点对账）· `GET /packs/{iid}/journal` */
  packJournal: 'packJournal',

  /* ── ★ 座位与邀请（真实数据）── */
  /** 本铺真实席位 · `GET /roles/seats` */
  rolesSeats: 'rolesSeats',
  /** 生成邀请 · `POST /invites` */
  inviteCreate: 'inviteCreate',

  /* ── 工位当前交互（存服务端）── */
  contextGet: 'contextGet',
  contextPut: 'contextPut',
  /** 一键清场（清人不移位） */
  orgClearAgents: 'orgClearAgents',
  /** 请出单个位上的 Agent */
  seatEvict: 'seatEvict',
  /** 通知列表 */
  notifications: 'notifications',
  /** 通知全部已读 */
  notificationsRead: 'notificationsRead',
  /** 查最新插件版本 */
  pluginVersion: 'pluginVersion',
  /** 交互包打包下载 */
  packExport: 'packExport',
  /** 交互包排定删除（24h） */
  packPurge: 'packPurge',
  /** 取消排定删除 */
  packPurgeCancel: 'packPurgeCancel',
  /** 查排定删除状态 */
  packPurgeStatus: 'packPurgeStatus',
} as const

export type EndpointName = (typeof ENDPOINTS)[keyof typeof ENDPOINTS]

/** 拼出客户端要调的完整端点：`kaipu-workstation/state` */
export function endpointOf(method: EndpointName): string {
  return `${REMOTE_NS}/${method}`
}

/* ══════════════════════════════════════════════════════════════════
   一、取 connection 服务（★ 宽松取法：两种形态都试）
   ══════════════════════════════════════════════════════════════════ */

/** DSH 客户端 connection 服务的最小形状 */
export interface ConnectionHandle {
  rpc?: {
    call(channel: string, endpoint: string, payload: unknown, signal?: unknown): Promise<unknown>
  }
}

/** 依赖取用的最小 ctx 形状（cordis 的两种取法：`ctx.get(name)` / `ctx.name`） */
export interface ClientCtxLike {
  get?: (name: string) => unknown
}

/**
 * 从 cordis ctx 取 `connection`。
 * ★ 两种取法都试（实测不同版本/装配时序表现不一致）⇒ 取到哪个用哪个，不要赌。
 * ★ 取不到**不抛**：返回 null，由面板显示"通道不可用"，而不是让面板炸掉。
 */
export function getConnection(ctx: ClientCtxLike): ConnectionHandle | null {
  let got: unknown
  try {
    got = ctx.get?.(CONNECTION_SERVICE)
  } catch {
    got = undefined
  }
  if (got === undefined) {
    got = (ctx as unknown as Record<string, unknown>)[CONNECTION_SERVICE]
  }
  if (got === null || typeof got !== 'object') return null
  const conn = got as ConnectionHandle
  return typeof conn.rpc?.call === 'function' ? conn : null
}

/* ══════════════════════════════════════════════════════════════════
   二、两层 `ok` —— 分不清就会"串层"
   ══════════════════════════════════════════════════════════════════
   · 第 1 层 网关层 `{ ok, value } | { ok:false, error }` —— 路没通
   · 第 2 层 业务层 `RemoteResult<T>`（host 方法返回值）—— 路通了但服务端说不行
*/

interface GatewayResult {
  ok?: boolean
  value?: unknown
  error?: { code?: string; message?: string }
  success?: boolean
  message?: string
}

/** 网关层 / 传输层错误（**没有**业务 code） */
export interface BridgeError {
  kind: 'gateway' | 'unreachable'
  code: string
  detail: string
}

/** host 侧业务错（第 2 层）—— 这一层才带契约的业务 `code` */
export interface BusinessErr {
  code: string
  message: string
}

export type BridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: BridgeError }
  | { ok: false; business: BusinessErr }

export async function callKaipu<T>(
  conn: ConnectionHandle,
  method: EndpointName,
  query: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<BridgeResult<T>> {
  const payload = { args: { query } }
  let raw: unknown
  try {
    raw = await conn.rpc!.call(REMOTE_CHANNEL, endpointOf(method), payload as never, signal as never)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    /* ★ 匠 P2-⑥ / 戒 P2-4 同族（上游第 1 处）：传输层**唯一可得信号**就是异常文本。
       这里**没有** `code` 字段可用（异常在网关成帧之前就抛了）⇒ 文案嗅探属**不可收敛项**，
       已登记在案（不假装它被"结构化"了）。上游若改成结构化错误对象，此处应同步收窄。 */
    if (/\b404\b/.test(detail)) {
      return { ok: false, error: { kind: 'gateway', code: 'not_found', detail } }
    }
    return { ok: false, error: { kind: 'unreachable', code: 'transport', detail } }
  }

  const gw = raw as GatewayResult | undefined
  if (gw === null || typeof gw !== 'object') {
    return { ok: false, error: { kind: 'gateway', code: 'bad_result', detail: '网关返回体为空' } }
  }
  if (gw.ok !== true) {
    const anyGw = gw as { success?: boolean; message?: string; error?: { message?: string } }
    const gwMsg = anyGw.message ?? anyGw.error?.message ?? ''
    /* ① **结构化优先**：网关显式说 `success === false` 是稳定契约（改端口/改文案它不变）
       ⇒ 直接判「端点不存在」，不再看文案。 */
    if (anyGw.success === false) {
      return { ok: false, error: { kind: 'gateway', code: 'not_found', detail: gwMsg || '端点不存在' } }
    }
    /* ② 文案兜底（★ **不可去除**）：老宿主 / 代理层 / 被网关转译过的错往往只剩一句话，
       没有 `success` 也没有 `code`。去掉它 = 这些环境上「端点没注册」会被误报成
       「网关调用失败」，用户按错的方向排查。 */
    if (/路径不存在/.test(gwMsg)) {
      return { ok: false, error: { kind: 'gateway', code: 'not_found', detail: gwMsg } }
    }
    return {
      ok: false,
      error: {
        kind: 'gateway',
        code: gw.error?.code ?? 'gateway',
        detail: gw.error?.message ?? '网关调用失败',
      },
    }
  }

  const v = gw.value as { ok?: boolean; data?: unknown; error?: string; code?: string } | undefined
  if (v === null || typeof v !== 'object') {
    return { ok: false, error: { kind: 'gateway', code: 'empty_value', detail: 'host 方法没有返回值' } }
  }
  if (v.ok !== true) {
    return {
      ok: false,
      business: {
        code: typeof v.code === 'string' ? v.code : 'unknown',
        message: typeof v.error === 'string' ? v.error : '服务端没有说明原因',
      },
    }
  }
  return { ok: true, data: v.data as T }
}
