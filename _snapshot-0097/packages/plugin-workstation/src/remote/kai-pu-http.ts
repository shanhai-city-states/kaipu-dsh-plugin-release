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

import { PLUGIN_VERSION } from './version.js'

/** 最小 fetch 形状（运行时由 Node 18+ 全局提供） */
interface HttpResponseLike {
  ok: boolean
  status: number
  text(): Promise<string>
  /** ★ 二进制出口（下载用）—— 类型自己声明，不引 DOM/Node */
  arrayBuffer(): Promise<ArrayBuffer>
  /** ★ 取响应头（下载要拿 Content-Disposition / Content-Type） */
  headers?: { get(name: string): string | null }
}
type FetchLike = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    /** ★ 上传要发 raw 二进制；JSON 请求仍走 string */
    body?: string | Uint8Array
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
  /** ★ 契约 §1.2 是**对象** `{code,message}`；旧形态是字符串 —— 两种都要认 */
  error?: string | { code?: string; message?: string; detail?: string }
  message?: string
  code?: string
  detail?: string
}

/**
 * 从错误体里取 `(code, message)` —— 单一取法，避免两处各写一遍再各自漂移。
 *
 * ★★ 2026-10-21 真根因：后端契约明文是 `{"error":{"code":..,"message":..}}`，
 *   而这里原先只认 `typeof error === 'string'`、message 只从**顶层**取
 *   ⇒ 所有业务码（project_incomplete / project_frozen / invalid_transition /
 *   not_approver / deps_unmet …）在客户端统统退化成 `http_400` + 「服务端返回 400」，
 *   前端所有按 code 走的分支（归档两段式「仍要暂存」就是其一）**全部失效**，
 *   最后落进 err.title 缺省文案「任务读不到」。
 * ⇒ 三种形状都认：① error 是对象 ② error 是字符串 ③ 顶层 code。
 */
export function readApiError(res: { status: number }, parsed: unknown): { code: string; message: string } {
  const body: KaipuErrorBody =
    parsed !== null && typeof parsed === 'object' ? (parsed as KaipuErrorBody) : {}
  const nested = typeof body.error === 'object' && body.error !== null ? body.error : null
  const pick = (...vals: Array<string | undefined>): string | undefined =>
    vals.find((v) => typeof v === 'string' && v.length > 0)
  const code =
    pick(nested?.code, typeof body.error === 'string' ? body.error : undefined, body.code) ??
    `http_${res.status}`
  const message =
    pick(nested?.message, nested?.detail, body.message, body.detail) ??
    `服务端返回 ${res.status}`
  return { code, message }
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
  readonly details: Record<string, unknown> | undefined
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'KaipuHttpError'
    this.status = status
    this.code = code
    this.details = details
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
  /** ★ B 案：首次入册/补发时返回，明文只此一次 */
  deviceId?: string
  deviceSecret?: string
}

/**
 * 工位用的最小服务端客户端。
 * 只做四件事：握手、带 token 发请求、把错误翻成可读文案、缓存 token。
 */
export class KaipuHttpClient {
  private readonly baseUrl: string
  private readonly fingerprint: string
  private readonly clientVersion: string
  /** ★ 2026-10-22（丙）：本人主动重置设备码。旧 secret 立刻作废，新 secret 写回本地文件。 */
  async resetDeviceSecret(signal?: unknown): Promise<{ deviceId: string; deviceSecret: string; expiresAt?: string }> {
    const cred = readAnyDeviceCred()
    if (!cred) {
      throw new KaipuHttpError(0, 'no_device_cred',
        '找不到本机设备凭据：先在工位里登录一次，再回来重置。')
    }
    const data = await this.call<{ deviceId: string; deviceSecret: string; expiresAt?: string }>(
      'POST', '/auth/device/reset', cred as unknown as Record<string, unknown>, signal as never)
    updateDeviceCredById(cred.deviceId, { deviceSecret: data.deviceSecret })
    return data
  }

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

  /**
   * ★ 2026-10-23（古茶 002「一键挂载」）：把一个项目送去审计。
   *
   * 服务端建单后**立刻返回**（202），跑审在后台（要调四灯场景，几分钟）；
   * 前端拿 `id` 轮询 `getAudit()` 即可，不要在这里等。
   * `reused: true` = 同项目同套餐已有一张在跑的单（防手抖点两下）。
   */
  async requestProjectAudit(
    projectId: string,
    pkg: 'light' | 'standard' | 'deep' = 'standard',
  ): Promise<{ id: string; status: string; reused?: boolean; project_name?: string }> {
    const token = await this.ensureToken()
    const r = await this.request(
      'POST',
      `/projects/${encodeURIComponent(projectId)}/audit-request`,
      { package: pkg },
      token,
    )
    return r as { id: string; status: string; reused?: boolean; project_name?: string }
  }

  /** 查审计单状态与报告（`status` = queued/running/done/failed） */
  async getAudit(id: string): Promise<{
    id: string
    status: string
    package: string
    project_id: string
    created_at: string
    finished_at: string
    report: AuditReportLike | null
  }> {
    const token = await this.ensureToken()
    const r = await this.request('GET', `/audit/${encodeURIComponent(id)}`, undefined, token)
    return r as {
      id: string
      status: string
      package: string
      project_id: string
      created_at: string
      finished_at: string
      report: AuditReportLike | null
    }
  }

  /**
   * ★ 主动握手并返回本铺 `account_id`（期5b-1 加）。
   * 为什么需要：心跳只能对**本人持有**的任务发（`claimed_by == 本人`），
   * 而面板侧唯一可信的「本人」就是服务端在 `/auth/device` 回的 `accountId`。
   * ★ 只回 accountId，**不回 token**（凭据纪律：token 不出 host）。
   */
  async identify(signal?: AbortSignalLike): Promise<string> {
    await this.ensureToken(signal)
    return this.accountId ?? ''
  }

  /** 懒握手：token 缺失或已过期才重新换，换完缓存在内存 */
  private async ensureToken(signal?: AbortSignalLike): Promise<string> {
    const now = Date.now()
    if (this.token !== null && now < this.expiresAt - 60_000) return this.token

    // ★★ B 案（2026-10-21 阿开拍板）：**先凭据，后指纹**。
    //   指纹是客户端自报的（改 USER/HOSTNAME 或手填 fingerprint 就能冒充已入册设备）；
    //   凭据是服务端签发的随机串，只存本地 600。指纹只用于「第一次入册」。
    const cred = readDeviceCred(this.baseUrl)
    const fpBody = (): Record<string, string> => ({
      fingerprint: this.fingerprint,
      // ★ B 案配套：**总是**报版本。服务端据此判断「这个客户端会不会保存 deviceSecret」——
      //   不报版本 = 旧客户端 = 不强制凭据（否则升级当天旧客户端会被自己的指纹拒绝，全挂）。
      /* ★ 2026-10-21 修：这里原来报 `this.clientVersion`（宿主传的是
         `dsh-plugin-workstation/0.1.0`）⇒ 服务端永远解析不出插件版本，
         B 案的「>= 0.2.35 才强制设备凭据」门槛**一直没生效**，
         而且客服端排查时也查不到用户装的是哪版。⇒ 一律报插件自己的版本。 */
      clientVersion: PLUGIN_VERSION,
    })

    let res: unknown
    if (cred) {
      try {
        res = await this.request('POST', '/auth/device',
          { deviceId: cred.deviceId, deviceSecret: cred.deviceSecret }, undefined, signal)
      } catch (e) {
        // 凭据失效（被铺主重签 / 被撤销 / 服务端库重建）⇒ 清本地，退回指纹重试一次。
        // ★ 只有 401/403 才这样退；网络错误照原样抛 —— 否则会把「网断了」误判成「凭据坏了」。
        if (e instanceof KaipuHttpError && (e.status === 401 || e.status === 403)) {
          clearDeviceCred(this.baseUrl)
          res = await this.request('POST', '/auth/device', fpBody(), undefined, signal)
        } else {
          throw e
        }
      }
    } else {
      res = await this.request('POST', '/auth/device', fpBody(), undefined, signal)
    }

    const data = res as DeviceAuthPayload
    if (typeof data.deviceToken !== 'string' || data.deviceToken.length === 0) {
      throw new KaipuHttpError(502, 'bad_device_auth', '服务端没有返回设备令牌 —— 接入地址可能不是开铺服务端。')
    }
    // ★ 服务端签发/补发了凭据 ⇒ 立刻落盘。明文只在这一次响应里，丢了要重新入册。
    if (typeof data.deviceId === 'string' && data.deviceId.length > 0 &&
        typeof data.deviceSecret === 'string' && data.deviceSecret.length > 0) {
      writeDeviceCred(this.baseUrl, { deviceId: data.deviceId, deviceSecret: data.deviceSecret })
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

  /**
   * ★★ 2026-10-24 · **不带鉴权**的业务请求（只有一个合法用途：`POST /join/request`）
   *
   * 为什么必须有这条独立通道：
   *   补发申请的申请人**恰恰是「没进铺 / 码失效」的那个人** —— 他本机没有
   *   `deviceToken`（`/auth/device` 会直接 401）。走 `call()` 会在**握手阶段**就炸，
   *   永远到不了这个端点，而契约里它明写「无鉴权，靠 joinCode / deviceFp 自证」。
   *
   * ★ 边界要钉死：除了这个端点，**任何**业务请求都必须走 `call()`。
   *   这条通道等于「匿名发请求」，滥用就是绕开白名单 —— 所以名字带 Anon、
   *   并且刻意不做通用重试/凭据回填。
   */
  async callAnon<T>(
    method: 'POST',
    path: string,
    body: unknown,
    signal?: AbortSignalLike,
  ): Promise<T> {
    return (await this.request(method, path, body, undefined, signal)) as T
  }

  /* ─────────────────────────────────────────────────────────────────────
   * ★ 期6a-2 · 资料通道（raw bytes）
   *
   * 为什么不能复用 `call()`：
   *   `call()` 固定 `Content-Type: application/json` + `JSON.stringify`。
   *   资料上传要 **raw body**（服务端边写边算 sha，不解析 JSON）+
   *   三个自定义头（X-Filename / X-Body-Sha256 / Content-Type）。
   *
   * ★ 为什么是 base64 过 wire 而不是直接传二进制：
   *   `@Remote` 的参数走 JSON 序列化 —— 二进制过不去。
   *   所以**渲染层 → host** 用 base64，**host → 服务端** 用 raw bytes。
   *   代价：内存约为文件大小 ×1.4（base64 膨胀 + 解码缓冲），
   *   故 UI 侧对单件设上限（超限提示改用 CLI），不拿它传超大文件。
   * ───────────────────────────────────────────────────────────────────── */

  /** 上传：raw bytes + 自定义头。返回服务端 JSON（含文件名/sha/大小）。 */
  async uploadRaw(
    path: string,
    bytes: Uint8Array,
    headers: Record<string, string>,
    signal?: AbortSignalLike,
  ): Promise<unknown> {
    const token = await this.ensureToken(signal)
    const f = getFetch()
    if (f === null) {
      throw new KaipuHttpError(0, 'no_fetch', '当前宿主没有全局 fetch（需 Node 18+）—— 工位连不上服务端。')
    }
    const h: Record<string, string> = { Accept: 'application/json', ...headers }
    if (token) h.Authorization = `Bearer ${token}`
    if (!h['Content-Type']) h['Content-Type'] = 'application/octet-stream'

    let res: HttpResponseLike
    try {
      const init: { method: string; headers: Record<string, string>; body?: string | Uint8Array; signal?: unknown } = {
        method: 'POST',
        headers: h,
        body: bytes,
      }
      if (signal !== undefined) init.signal = signal
      res = await f.call(globalThis, `${this.baseUrl}${path}`, init)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new KaipuHttpError(0, 'network_error', `上传连不上服务端（${this.baseUrl}）：${msg}`)
    }
    return this.parseJsonResponse(res, await res.text())
  }

  /** 下载：返回二进制 + 服务端给的文件名/类型。 */
  async downloadRaw(
    path: string,
    signal?: AbortSignalLike,
  ): Promise<{ bytes: Uint8Array; contentType: string; filename: string | null }> {
    const token = await this.ensureToken(signal)
    const f = getFetch()
    if (f === null) {
      throw new KaipuHttpError(0, 'no_fetch', '当前宿主没有全局 fetch（需 Node 18+）—— 工位连不上服务端。')
    }
    const h: Record<string, string> = { Accept: '*/*' }
    if (token) h.Authorization = `Bearer ${token}`

    let res: HttpResponseLike
    try {
      const init: { method: string; headers: Record<string, string>; signal?: unknown } = { method: 'GET', headers: h }
      if (signal !== undefined) init.signal = signal
      res = await f.call(globalThis, `${this.baseUrl}${path}`, init)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new KaipuHttpError(0, 'network_error', `下载连不上服务端（${this.baseUrl}）：${msg}`)
    }

    if (!res.ok) {
      // 失败时服务端回 JSON 错误体
      this.parseJsonResponse(res, await res.text()) // 必抛
      throw new KaipuHttpError(res.status, `http_${res.status}`, `下载失败 ${res.status}`)
    }

    const buf = await res.arrayBuffer()
    const cd = res.headers?.get('Content-Disposition') ?? null
    return {
      bytes: new Uint8Array(buf),
      contentType: res.headers?.get('Content-Type') ?? 'application/octet-stream',
      filename: parseRfc6266Filename(cd),
    }
  }

  /** JSON 响应的统一解包（成功/失败两条路都在这里，避免两处口径不一致） */
  private parseJsonResponse(res: HttpResponseLike, text: string): unknown {
    let parsed: unknown = null
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { message: text.slice(0, 200) }
      }
    }
    if (!res.ok) {
      const { code, message } = readApiError(res, parsed)
      throw new KaipuHttpError(res.status, code, message)
    }
    if (parsed !== null && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)) {
      const env = parsed as Record<string, unknown>
      if (env.ok === true || env.ok === undefined) return env.data
    }
    return parsed
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
      const { code, message } = readApiError(res, parsed)
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

/* ══════════════════════════════════════════════════════════════════
 * ★ B 案（2026-10-21 阿开拍板）：设备凭据（本地落盘）
 *
 * 为什么：指纹是**客户端自报**的 —— `deriveFingerprint()` = hash(HOSTNAME|USER|
 * platform|arch)，改环境变量、或在配置里手填 `fingerprint`，就能冒充一台
 * **已入册**设备。凭据是服务端签发的随机串，客户端只存本地（600）。
 *
 * ★ 不 import node 模块：本包 host tsconfig `types: []`，且 client bundle 会内联
 *   本文件 —— 用 `process.getBuiltinModule()` 运行时取，形状手写（同
 *   `plugin-platform/src/remote/shop-files.ts` 的做法）。
 * ★ 取不到就**降级为不存**（仍可用指纹），绝不假装存上了。
 * ══════════════════════════════════════════════════════════════════ */

export interface DeviceCred {
  deviceId: string
  deviceSecret: string
  /** ★ 2026-10-22（丙）：绑定到这台机器的指纹 —— 复制走 deviceSecret 也用不了 */
  fingerprint?: string
}

type ProcLike = { getBuiltinModule?: (id: string) => unknown }

function builtin<T>(id: string): T {
  const p = (globalThis as { process?: ProcLike }).process
  const get = p?.getBuiltinModule
  if (typeof get !== 'function') throw new Error(`运行时未暴露内置模块（${id}）`)
  const mod = get.call(p, id) as T | undefined
  if (mod === undefined || mod === null) throw new Error(`无法载入内置模块（${id}）`)
  return mod
}

function shortHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(16).padStart(8, '0').slice(0, 8)
}

function credFile(baseUrl: string): string {
  const path = builtin<{ join(...p: string[]): string }>('node:path')
  const os = builtin<{ homedir(): string }>('node:os')
  return path.join(os.homedir(), '.kai-pu', `device-${shortHash(baseUrl)}.json`)
}

/** 读本地设备凭据；取不到 / 坏了 ⇒ null（退回指纹，不抛） */

/** ★ 2026-10-23（一键挂载）：审计报告的最小形状（字段全部可选 —— 失败时有 error） */
export interface AuditReportLike {
  verdict?: string
  summary?: string
  precheck?: {
    verdict?: string
    counts?: Record<string, number>
    findings?: Array<{ code?: string; level?: string; detail?: string }>
  }
  review?: {
    scene?: string
    aborted?: boolean
    elapsed_ms?: number
    lights?: Record<string, string>
    error?: string
  }
  files?: Array<{ path?: string; bytes?: number; sha256?: string }>
  error?: string
  message?: string
}

export function readDeviceCred(baseUrl: string): DeviceCred | null {
  try {
    const fs = builtin<{ existsSync(p: string): boolean; readFileSync(p: string, enc: string): string }>('node:fs')
    const f = credFile(baseUrl)
    if (!fs.existsSync(f)) return null
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as Partial<DeviceCred>
    if (typeof j.deviceId === 'string' && j.deviceId.length > 0 &&
        typeof j.deviceSecret === 'string' && j.deviceSecret.length > 0) {
      return { deviceId: j.deviceId, deviceSecret: j.deviceSecret,
        ...(typeof (j as { fingerprint?: string }).fingerprint === 'string'
          ? { fingerprint: (j as { fingerprint?: string }).fingerprint } : {}) }
    }
    return null
  } catch {
    return null
  }
}

/** ★ 2026-10-22（丙）：把新 secret 写回**原来那个** device-*.json（按 deviceId 匹配）。
 *  为什么不直接用 credFile(baseUrl)：readAnyDeviceCred 可能读到别的 baseUrl 的文件，
 *  写错文件会导致「重置成功但 skill 还读旧 secret」。 */
export function updateDeviceCredById(deviceId: string, patch: Partial<DeviceCred>): boolean {
  try {
    const fs = builtin<{
      readdirSync(p: string): string[]
      readFileSync(p: string, enc: string): string
      writeFileSync(p: string, d: string, o?: { mode?: number }): void
    }>('node:fs')
    const os = builtin<{ homedir(): string }>('node:os')
    const path = builtin<{ join(...p: string[]): string }>('node:path')
    const dir = path.join(os.homedir(), '.kai-pu')
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('device-') || !f.endsWith('.json')) continue
      const fp = path.join(dir, f)
      try {
        const j = JSON.parse(fs.readFileSync(fp, 'utf8'))
        if (j.deviceId !== deviceId) continue
        fs.writeFileSync(fp, JSON.stringify({ ...j, ...patch }), { mode: 0o600 })
        return true
      } catch { continue }
    }
    return false
  } catch {
    return false
  }
}

/** 扫 ~/.kai-pu/device-*.json，返回第一份有效凭据（「设备码」页展示用）。
 *  ★ 不依赖 baseUrl：换过服务地址也照样能找到本机登记的设备。 */
export function readAnyDeviceCred(): DeviceCred | null {
  try {
    const fs = builtin<{
      existsSync(p: string): boolean
      readdirSync(p: string): string[]
      readFileSync(p: string, enc: string): string
    }>('node:fs')
    const path = builtin<{ join(...p: string[]): string }>('node:path')
    const os = builtin<{ homedir(): string }>('node:os')
    const dir = path.join(os.homedir(), '.kai-pu')
    if (!fs.existsSync(dir)) return null
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('device-') || !f.endsWith('.json')) continue
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Partial<DeviceCred>
        if (typeof j.deviceId === 'string' && j.deviceId.length > 0 &&
            typeof j.deviceSecret === 'string' && j.deviceSecret.length > 0) {
          return { deviceId: j.deviceId, deviceSecret: j.deviceSecret,
            ...(typeof (j as { fingerprint?: string }).fingerprint === 'string'
              ? { fingerprint: (j as { fingerprint?: string }).fingerprint } : {}) }
        }
      } catch { continue }
    }
    return null
  } catch {
    return null
  }
}

/** 落盘（600）；失败返回 false，由调用方决定要不要提示 */
export function writeDeviceCred(baseUrl: string, c: DeviceCred): boolean {
  try {
    const fs = builtin<{
      mkdirSync(p: string, o?: { recursive?: boolean; mode?: number }): void
      writeFileSync(p: string, d: string, o?: { mode?: number }): void
    }>('node:fs')
    const path = builtin<{ dirname(p: string): string }>('node:path')
    const f = credFile(baseUrl)
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 })
    // ★ 写入时补 fingerprint：这样 Skill 侧（hub_dash.py）能把它带给 kai-pu 做双绑校验
    const out: DeviceCred = { ...c }
    if (!out.fingerprint) {
      try { out.fingerprint = deriveFingerprint() } catch { /* 算不出就不写 */ }
    }
    fs.writeFileSync(f, JSON.stringify(out), { mode: 0o600 })
    return true
  } catch {
    return false
  }
}

export function clearDeviceCred(baseUrl: string): void {
  try {
    const fs = builtin<{ existsSync(p: string): boolean; unlinkSync(p: string): void }>('node:fs')
    const f = credFile(baseUrl)
    if (fs.existsSync(f)) fs.unlinkSync(f)
  } catch {
    /* 清不掉不阻断：服务端已拒绝，下次会再试 */
  }
}

/**
 * 从 `Content-Disposition` 取文件名。
 * ★ 服务端用的是 RFC 6266 双写（`filename*=UTF-8''…` + `filename="…"`），
 *   所以优先取星号形式（中文名只有它能正确还原），再回退普通形式。
 * ★ 取不到就返回 null（UI 用兜底名），**不要**抛错 —— 下载本身已经成功了。
 */
function parseRfc6266Filename(cd: string | null): string | null {
  if (!cd) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  if (star && star[1]) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      return star[1]
    }
  }
  const quoted = /filename="([^"]*)"/i.exec(cd)
  if (quoted && quoted[1]) return quoted[1]
  const plain = /filename=([^;]+)/i.exec(cd)
  return plain && plain[1] ? plain[1].trim() : null
}
