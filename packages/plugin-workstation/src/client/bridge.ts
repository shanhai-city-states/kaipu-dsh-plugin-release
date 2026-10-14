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

/** ★ 工位插件**只用这两个端点**（期1） */
export const ENDPOINTS = {
  /** 接没接上 + 种子概览（第一件要知道的事） */
  status: 'status',
  /** 工位完整持久化态（座位/球/轮次/留痕/事件流底座） */
  state: 'state',
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
    if (anyGw.success === false || /路径不存在/.test(gwMsg)) {
      return { ok: false, error: { kind: 'gateway', code: 'not_found', detail: gwMsg || '路径不存在' } }
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
