/**
 * 山海·开铺 · 场地插件 · client half —— 宿主通道（data channel）
 * =====================================================================
 * 面板**不直连服务端域名**，而是经**宿主网关**调本插件的 host half：
 *
 *   浏览器(client)  --connection.rpc.call('/api','kaipu/<m>',{args:{query}})-->
 *   DSH 网关（同源 · 已鉴权）  --> host half（Node）  --fetch--> kai-pu 服务端
 *
 * ★★ 为什么必须这样（两条，缺一都不成立）：
 *   ① **技术上**：`kai-pu` 不发任何 `access-control-*` 头、预检 `OPTIONS` 回 **501**
 *      （2026-10-05 实测）⇒ 浏览器跨源直连必被拦，带 `Authorization` 还会触发预检。
 *   ② **纪律上**：仓 README §四「插件不直连模型/服务端域名（一切走宿主适配层）」。
 *   ★ 附带收益：**`deviceToken` 只活在 host 进程内存里，浏览器永不持有凭据**。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 调用形态的两个硬细节（实测踩出来的，逐字照搬）
 * ══════════════════════════════════════════════════════════════════
 *   ① **`payload.args` 必须是对象、不是数组**，且键名 = host 方法的**参数名**。
 *      我们的 host 签名是 `listScenes(query, signal?)`，`signal` 被识别为取消参数
 *      并**从 wire 上剥掉** ⇒ 业务参数只剩 `query`：
 *        `{ args: { query: { … } } }`  ✅
 *        `{ args: [ … ] }`             ❌ 数组
 *        `{ args: { q: { … } } }`      ❌ 键名不对
 *      （`type` / `rpcId` 由 `rpc.call` 自己包，这里不要写。）
 *   ② **`call()` 的返回已经剥过一层信封**：拿到的直接是 `result`，不是
 *      `{type,rpcId,result}`。见下 §二 的两层 `ok` 说明。
 */

/* ══════════════════════════════════════════════════════════════════
   ★★ 端点常量：**本文件与 host 侧各有一份，判据强制一致**
   ══════════════════════════════════════════════════════════════════
 * 为什么不共用一个文件：两端 tsconfig 的 module 格式不同（host ESM / client CJS），
 * 编到同一路径会**互相覆盖** —— 2026-10-05 实测踩到，症状是 host 侧报
 *   `The requested module '../shared/*.js' does not provide an export named 'REMOTE_NS'`
 * （后写的 CJS 产物把 ESM 产物冲掉了，而 DSH 只给一句泛泛的 "failed to import"）。
 * 而让 host 运行时依赖契约包也不行（契约是**构建期**依赖，用户机上没有）。
 *
 * ⇒ 按本仓一贯做法：**两端各写一份 + 判据**（不靠记性）——
 *   配套的桥接检查脚本直接扫**编译产物**，比对命名空间与端点名，
 *   改一边漏一边就 FAIL。
 *
 * ★ 端点字符串是 `'<命名空间>/<方法名>'`，写错就是"点了没反应"（不报错、
 *   不白屏、面板就是没数据）—— 所以这个一致性**必须有机器看护**。
 */

/** remote 命名空间。★ 必须与 host 侧 `service.ts` 的 `REMOTE_NS` 同值（判据看护） */
export const REMOTE_NS = 'kaipu'

/** 调用通道（宿主网关的逻辑通道名） */
export const REMOTE_CHANNEL = '/api'

/** 宿主网关服务键（DSH 的 wire root 服务） */
export const CONNECTION_SERVICE = 'connection'

/** 端点方法名 —— ★ 必须与 host 侧 `@Remote('<name>')` 逐字一致（判据看护） */
export const ENDPOINTS = {
  /** 接没接上（第一件要知道的事） */
  status: 'status',
  /** 取令牌 + `/me`（兼心跳） */
  connect: 'connect',
  listAgents: 'listAgents',
  listScenes: 'listScenes',
  capabilities: 'capabilities',
  /**
   * 契约 §3.4 的运行 —— **两个一元端点**（不是流式）。
   * ★★ 为什么不是 `@Remote({ mode: 'stream' })`（2026-10-05 实测后定的）：
   *   浏览器侧唯一的非一元通道 `connection.rpc.open` **不存在**
   *   （DSH 源码：`Browser transports omit this method; API Gateway owns their WebSocket mux.`），
   *   而 `ctx.remote.<ns>.<method>()` 需要 namespace 被装配 ——
   *   那由 DSH 的 `api/remotes` client 用**硬编码内部包清单**完成，**第三方插件不在内**。
   *   ⇒ 改走"host 后台读 SSE + 客户端轮询增量"：
   *     `startRun` 立刻回 `runId`，`pollRun` 取增量（≈300ms 一轮）。
   *   详细取舍见 host 侧 `service.ts` 的 `runs` 字段长注。
   */
  startRun: 'startRun',
  pollRun: 'pollRun',
} as const

export type EndpointName = (typeof ENDPOINTS)[keyof typeof ENDPOINTS]

/** 拼出客户端要调的完整端点：`kaipu/listScenes` */
export function endpointOf(method: EndpointName): string {
  return `${REMOTE_NS}/${method}`
}

/* ══════════════════════════════════════════════════════════════════
   一、取 connection 服务（★ 宽松取法：两种形态都试）
   ══════════════════════════════════════════════════════════════════ */

/** DSH 客户端 connection 服务的最小形状 */
export interface ConnectionHandle {
  rpc?: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: unknown,
    ): Promise<unknown>
  }
}

/** 依赖取用的最小 ctx 形状（cordis 的两种取法：`ctx.get(name)` / `ctx.name`） */
export interface ClientCtxLike {
  get?: (name: string) => unknown
}

/**
 * 从 cordis ctx 取 `connection`。
 *
 * ★ 为什么两种取法都试：实测过 `ctx.get('connection')` 与 `ctx.connection`
 *   在不同版本/不同装配时序下表现不一致 —— **取到哪个用哪个**，不要赌。
 * ★ 取不到**不抛**：返回 null，由调用方显示"未接入"，而不是让面板炸掉。
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
   二、两层 `ok` —— 这个必须分清，否则错误会"串层"
   ══════════════════════════════════════════════════════════════════

   ┌ 第 1 层：**网关层**  `{ ok, value } | { ok:false, error:{code,message} }`
   │   这里失败 = 端点不存在 / 参数不合规 / host 方法抛异常 / 传输断
   │   ⇒ 客户端**无法**用业务错误码解释它，只能如实说"路没通"
   └ 第 2 层：**业务层**  `RemoteResult<T>`（host 方法的返回值）
       这里失败 = "路通了，但服务端说不行"（未授权 / 超时 / 404 …）
       ⇒ 这一层才带业务 `code`，才谈得上翻译成人话

   ★ 把两层混为一谈的典型症状：把 `gateway/bad-request` 当成业务错误码
     去查文案表 ⇒ 查不到 ⇒ 显示成"未知错误"。所以这里分开命名。
*/

interface GatewayResult {
  ok?: boolean
  value?: unknown
  error?: { code?: string; message?: string }
}

/** 业务信封（与 host 侧 `RemoteResult<T>` 同形；这里**不 import**，只按形状收敛） */
export interface BridgeError {
  kind: 'gateway' | 'unreachable'
  /** 机器可读（网关层的码，**不是**业务错误码） */
  code: string
  /** 诊断用原文（★ **不上屏**） */
  detail: string
}

export type BridgeResult<T> = { ok: true; data: T } | { ok: false; error: BridgeError } | { ok: false; business: BusinessErr }

/** host 侧业务错（第 2 层）—— 这一层才带契约的业务 `code` */
export interface BusinessErr {
  code: string
  /** host 已翻译过一次；客户端**仍要按 code 再翻一次**（以契约文案为准） */
  message: string
}

/**
 * 调一个 host 端点。
 *
 * @param conn  connection 服务
 * @param method host 方法名（**不带**命名空间）
 * @param query 业务参数（host 方法第一个参数的实参）
 * @param signal 取消信号（**可选**；host 侧已被剥掉，这里只是本地取消）
 */
export async function callKaipu<T>(
  conn: ConnectionHandle,
  method: EndpointName,
  query: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<BridgeResult<T>> {
  const payload = { args: { query } } // ★ 见文件头 ①
  let raw: unknown
  try {
    raw = await conn.rpc!.call(REMOTE_CHANNEL, endpointOf(method), payload as never, signal as never)
  } catch (e) {
    return {
      ok: false,
      error: { kind: 'unreachable', code: 'transport', detail: e instanceof Error ? e.message : String(e) },
    }
  }

  const gw = raw as GatewayResult | undefined
  if (gw === null || typeof gw !== 'object') {
    return { ok: false, error: { kind: 'gateway', code: 'bad_result', detail: '网关返回体为空' } }
  }
  if (gw.ok !== true) {
    return {
      ok: false,
      error: {
        kind: 'gateway',
        code: gw.error?.code ?? 'gateway',
        detail: gw.error?.message ?? '网关调用失败',
      },
    }
  }

  // 第 2 层：`value` 就是 host 方法的返回值（业务信封）
  const v = gw.value as
    | { ok?: boolean; data?: unknown; error?: string; code?: string }
    | undefined
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
