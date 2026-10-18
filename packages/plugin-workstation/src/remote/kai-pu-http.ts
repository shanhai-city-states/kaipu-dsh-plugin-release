/**
 * 山海·开铺 · 工位插件 · 服务端 HTTP 通道（host 侧）
 * =====================================================================
 * 为什么工位要自己有一份通道，而不是复用 platform 的：
 *
 *   ★ 工位是**可摘除模块**（cordis.patch.yml 里写死了这条约束）：
 *     摘掉工位，场地必须仍完整可用。
 *     ⇒ 反向依赖就不成立：工位不能「因为装了 platform 才工作」。
 *     所以这里自带一份最小 HTTP 通道 —— 只覆盖工位真正要用的
 *     `/auth/device` 与 `/org/*`，不做 platform 那套场景/文件能力。
 *
 * ★ 凭据纪律（逐字承 platform）：
 *   ① `deviceToken` **只活在本进程内存**，绝不写盘、绝不进日志、绝不传给渲染层；
 *   ② 面板（client half）永远拿不到 token —— 它只调 `kaipu-workstation/*` 方法，
 *      HTTP 由 host 代发；
 *   ③ 本文件里任何日志都不得出现 token 原文（只报长度/前缀）。
 *
 * ★ 类型纪律（同 plugin-platform 的 host 侧）：
 *   本包 host tsconfig 显式 `lib: ["ES2022"]` + `types: []` —— **不含 DOM，也不装
 *   @types/node**（发布面不引宿主环境的类型）。所以 fetch / Response / AbortSignal
 *   一律**自己声明最小形状**，不 import 任何 node 或 DOM 模块。
 *
 * ★ 本文件不 import platform 的任何东西 —— 两包必须能独立安装。
 */

/** 最小 fetch 形状（运行时由 Node 18+ 全局提供） */
interface HttpResponseLike {
  ok: boolean
  status: number
  text(): Promise<string>
}
type FetchLike = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: unknown
  },
) => Promise<HttpResponseLike>

/** 最小 AbortSignal 形状 */
interface AbortSignalLike {
  readonly aborted: boolean
}

/** 最小 process 形状（只读环境变量与平台字段） */
interface ProcessLike {
  env?: Record<string, string | undefined>
  platform?: string
  arch?: string
}

/** 服务端返回的错误形状（与 platform 同源） */
export interface KaipuErrorBody {
  error?: string
  message?: string
  code?: string
  detail?: string
}

/** 取全局 fetch（Node 18+ 提供）。取不到就回 null，由调用方报清楚 */
function getFetch(): FetchLike | null {
  const f = (globalThis as unknown as { fetch?: FetchLike }).fetch
  return typeof f === 'function' ? f : null
}

function getProcess(): ProcessLike | undefined {
  return (globalThis as unknown as { process?: ProcessLike }).process
}

export class KaipuHttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'KaipuHttpError'
    this.status = status
    this.code = code
  }
}

export interface KaipuHttpOptions {
  baseUrl: string
  /** 本机指纹；空 ⇒ 由 host 推导（同机稳定） */
  fingerprint?: string
  /** 客户端版本，服务端用于灰度（可空） */
  clientVersion?: string
}

interface DeviceAuthPayload {
  deviceToken: string
  accountId: string
  expiresAt?: string
}

/**
 * 工位用的最小服务端客户端。
 * 只做四件事：握手、带 token 发请求、把错误翻成可读文案、缓存 token。
 */
export class KaipuHttpClient {
  private readonly baseUrl: string
  private readonly fingerprint: string
  private readonly clientVersion: string
  private token: string | null = null
  private accountId: string | null = null
  private expiresAt = 0

  constructor(opts: KaipuHttpOptions) {
    // 去掉尾部斜杠，避免拼出 `//org/nodes`
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.fingerprint = (opts.fingerprint || '').trim() || deriveFingerprint()
    this.clientVersion = (opts.clientVersion || '').trim()
  }

  /** 供面板显示的连接信息（★ 不含 token） */
  describe(): { baseUrl: string; accountId: string | null; hasToken: boolean } {
    return { baseUrl: this.baseUrl, accountId: this.accountId, hasToken: this.token !== null }
  }

  /** 本机指纹（仅供排查展示，不涉密） */
  fingerprintHint(): string {
    return this.fingerprint
  }

  /** 懒握手：token 缺失或已过期才重新换，换完缓存在内存 */
  private async ensureToken(signal?: AbortSignalLike): Promise<string> {
    const now = Date.now()
    if (this.token !== null && now < this.expiresAt - 60_000) return this.token

    const body: Record<string, string> = { fingerprint: this.fingerprint }
    if (this.clientVersion) body.clientVersion = this.clientVersion

    const res = await this.request('POST', '/auth/device', body, undefined, signal)
    const data = res as DeviceAuthPayload
    if (typeof data.deviceToken !== 'string' || data.deviceToken.length === 0) {
      throw new KaipuHttpError(502, 'bad_device_auth', '服务端没有返回设备令牌 —— 接入地址可能不是开铺服务端。')
    }
    this.token = data.deviceToken
    this.accountId = typeof data.accountId === 'string' ? data.accountId : null
    // expiresAt 是 ISO 字符串；解析失败就按 1 小时兜底，避免每次请求都重新握手
    const parsed = data.expiresAt ? Date.parse(data.expiresAt) : NaN
    this.expiresAt = Number.isFinite(parsed) ? parsed : now + 3_600_000
    return this.token
  }

  /** 带鉴权的业务请求 */
  async call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignalLike,
  ): Promise<T> {
    const token = await this.ensureToken(signal)
    return (await this.request(method, path, body, token, signal)) as T
  }

  /** 裸请求（不自动带 token；握手自己用） */
  private async request(
    method: string,
    path: string,
    body: unknown,
    token: string | undefined,
    signal?: AbortSignalLike,
  ): Promise<unknown> {
    const f = getFetch()
    if (f === null) {
      throw new KaipuHttpError(0, 'no_fetch', '当前宿主没有全局 fetch（需 Node 18+）—— 工位连不上服务端。')
    }

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`

    let res: HttpResponseLike
    try {
      // ★ exactOptionalPropertyTypes: true ⇒ 可选键不能显式传 undefined，只能缺席
      const init: { method: string; headers: Record<string, string>; body?: string; signal?: unknown } = {
        method,
        headers,
      }
      if (body !== undefined) init.body = JSON.stringify(body)
      if (signal !== undefined) init.signal = signal
      res = await f.call(globalThis, `${this.baseUrl}${path}`, init)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new KaipuHttpError(0, 'network_error', `连不上服务端（${this.baseUrl}）：${msg}`)
    }

    const text = await res.text()
    let parsed: unknown = null
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { message: text.slice(0, 200) }
      }
    }

    if (!res.ok) {
      const eb = (parsed || {}) as KaipuErrorBody
      const code =
        typeof eb.error === 'string' ? eb.error : typeof eb.code === 'string' ? eb.code : `http_${res.status}`
      const message =
        (typeof eb.message === 'string' && eb.message) ||
        (typeof eb.detail === 'string' && eb.detail) ||
        `服务端返回 ${res.status}`
      throw new KaipuHttpError(res.status, code, message)
    }

    // 有些端点返回 { ok, data } 信封，有些直接返回对象 —— 两种都认
    if (parsed !== null && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)) {
      const env = parsed as Record<string, unknown>
      if (env.ok === true || env.ok === undefined) return env.data
    }
    return parsed
  }
}

/**
 * 本机指纹：同机稳定、跨机不同。
 * ★ 不读 MAC（容器/云主机上常变）；用 hostname + 用户名 + 平台拼一个稳定串。
 * ★ 不做任何联网上报 —— 它只作为 `/auth/device` 的入参。
 */
function deriveFingerprint(): string {
  const proc = getProcess()
  const env = proc?.env ?? {}
  const parts = [
    env.HOSTNAME || env.COMPUTERNAME || 'unknown-host',
    env.USER || env.USERNAME || 'unknown-user',
    proc?.platform || 'unknown-platform',
    proc?.arch || 'unknown-arch',
  ]
  const s = parts.join('|')
  let h = 0
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return `dsh-${Math.abs(h).toString(16).padStart(12, '0').slice(0, 12)}`
}
