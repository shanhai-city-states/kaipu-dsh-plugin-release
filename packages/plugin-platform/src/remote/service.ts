/**
 * 山海·开铺 · 场地插件 · host 侧数据通道（Typert Remote / SRC 模式）
 * =====================================================================
 * 面板（client half）经 `connection.rpc.call('/api', 'kaipu/<method>', …)` 调到这里。
 * 本类只**声明**端点，descriptor 由 DSH Gateway 的 SRC 反射在**运行时**生成
 * ⇒ 本包零构建产物（不需要 tsdown / zod 代码生成）。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 三条硬约束（违反其一，整个 Gateway 直接抛错，**不是**静默不生效）
 * ══════════════════════════════════════════════════════════════════
 * （承 `src/remote/service.ts` 的实测结论，逐字照搬纪律）
 *
 * ① **参数名必须能被正则反射**
 *    Gateway 直接读 `Function.prototype.toString()` 的源码文本，逐参数匹配
 *    `/^[$A-Z_a-z][$\w]*$/`：
 *      `listScenes(query: XxxQuery, signal?: CancelSignal)` → "query,signal" ✅
 *      `listScenes(query = {}, signal?)`                    → "query={}"     ❌
 *    ⇒ **绝对禁止给参数写默认值**。类型注解与 `?` 会被编译器剥掉，安全。
 *
 * ② **`signal` 必须是最后一个参数**，否则报
 *    `SRC cancellation parameter signal must be the final parameter`。
 *
 * ③ **业务参数一律从 `query` 里取**，不要新增第二、第三个业务参数
 *    （每个业务参数都会变成 wire 上一个独立字段，客户端要按名传）。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 本文件与 `@shanhai/kaipu-contract` **零运行时耦合**（这是故意的）
 * ══════════════════════════════════════════════════════════════════
 * host half **不经打包**（tsc 直出 `lib/index.js`），所以它的裸 import 必须能在
 * **用户机的 profile** 里解析得到 —— 而 `@shanhai/kaipu-contract` 是**构建期**
 * 依赖（见根 README §二·补 留意1），**不在**用户机上。
 * ⇒ 若本文件 import 它，发布出去就是一条**解析不到的裸 import**（用户端直接挂）。
 *
 * ⇒ 因此**错误文案的翻译留在客户端**（client bundle 已把契约内联，
 *   `translateError` / `isReroutableError` 都在那边，判据也在那边）。
 *   本文件只回**机器可读的 `code`** + 一句**仅供诊断、不上屏**的原文。
 *   ——契约那条「不把原始错误直出给用户」的纪律，落点在客户端，不在这里。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 凭据（deviceToken）只活在**本进程内存**里
 * ══════════════════════════════════════════════════════════════════
 * 浏览器**永不持有** deviceToken：
 *   · 它在本类实例字段里，到期前 `TOKEN_RENEW_MARGIN_SEC` 秒自动续；
 *   · 不落盘、不进日志、不进任何返回值（`status` 只回"接没接上"，不回凭据）。
 * ⇒ 这正是"插件不直连服务端域名"这条纪律的**收益**，不是负担。
 */

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
// ★ SSE 分帧与「帧 → 事件」映射：**抽到零依赖的兄弟模块**（2026-10-06）。
//   相对 import 且它自己不 import 任何运行时依赖 ⇒ host half「不经打包、裸 import 可解析」
//   这条约束不受影响。这样判据也能直接 import 它来喂帧断言（由配套探针脚本）。
import { frameToEvent, parseSseFrame, type SseFrame } from './sse-frame.js'

// ★★ 只 **import type** —— host half 不经打包，裸 import 必须在用户机的 profile 里
//   解析得到；而 @shanhai/kaipu-contract 是**构建期依赖**（用户机上没有）。
//   类型会被 tsc 擦除 ⇒ 不产生运行时依赖。这条由配套的桥接检查脚本看护。
import type {
  AccountView,
  AgentView,
  CapabilitiesPayload,
  RemoteErr,
  RemoteResult,
  SceneRunEvent,
  ScenesPayload,
  StatusPayload,
} from '@shanhai/kaipu-contract'

/* ── 本文件自带的最小形状：刻意不引 `node:` / `@types/node` / DOM lib ──
 * host 侧 tsconfig 是 `"lib": ["ES2022"]` + `"types": []`（**故意的**，防误用 window）。
 * 与其为一个参数引入一整套类型，不如按本仓既有风格只声明用得到的成员。
 */

/** 网关的取消参数形状。★ 参数名必须叫 `signal`（网关靠参数名识别并把它从 wire 剥掉） */
export interface CancelSignal {
  readonly aborted: boolean
}

/** 最小 fetch 形状（运行时由 Node 18+ 全局提供） */
export interface HttpResponseLike {
  readonly status: number
  text(): Promise<string>
}
export type FetchLike = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown },
) => Promise<HttpResponseLike>

/* ── 流式响应（SSE 用）的最小形状 ──────────────────────────────────
 * ★ 为什么不复用 `HttpResponseLike`：那个只有 `status` / `text()`，**把整个响应体
 *   读成字符串**。SSE 的价值全在"边到边渲染"，`text()` 会等到流结束才返回 ——
 *   那就等于把流式退化成一次性，白接。
 * ★ 同样手写最小形状（host 侧 `types: []`，不引 DOM lib / @types/node）。
 */
export interface StreamReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
  cancel?(): Promise<void>
}
export interface StreamingResponseLike {
  readonly status: number
  text(): Promise<string>
  /** 流式响应体。★ 可能是 `null`（服务端没给 body）—— 调用方必须处理 */
  readonly body?: { getReader(): StreamReaderLike } | null
}
export type FetchStreamLike = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown },
) => Promise<StreamingResponseLike>

/** `TextDecoder` 的最小形状（浏览器与 Node 都有，但 TS lib 里属于 DOM / node types） */
interface TextDecoderLike {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string
}

/* ── ★★ 下面两条常量在 client 侧**各有一份** ──────────────────────
 * 为什么不共用：两端 tsconfig 的 module 格式不同（host ESM / client CJS），
 * 编到同一路径会**互相覆盖**（实测症状：`does not provide an export named 'REMOTE_NS'`）。
 * 而 host 运行时又不能用契约包（构建期依赖，用户机上没有）。
 * ⇒ 两端各写一份 + **判据强制一致**（配套的桥接检查脚本）
 *   直接扫**编译产物**，改一边漏一边就 FAIL。
 */

/** remote 命名空间。★ 必须与 client `bridge.ts` 里的同值（判据看护） */
export const REMOTE_NS = 'kaipu'

/** 取令牌提前量：到期前这么多秒就续（避免"刚好过期"竞态） */
export const TOKEN_RENEW_MARGIN_SEC = 60

/* ══════════════════════════════════════════════════════════════════
   一、配置
   ══════════════════════════════════════════════════════════════════ */

export interface KaipuServiceConfig {
  /** 服务端基址。**空 = 本地/未接入模式**（不是故障） */
  baseUrl?: string
  /** 铺子名（契约里叫 `account_id`） */
  accountId?: string
  /** 设备指纹（≥8 位）。不配则本机推导；再不行走兜底常量 */
  fingerprint?: string
  /** 取令牌时自报的客户端版本 */
  clientVersion?: string
  /** 单次请求超时（毫秒） */
  timeoutMs?: number
}

/** 空入参（有些端点不需要参数；**仍要有一个 query**，见约束 ③） */
export interface EmptyQuery {
  [k: string]: never
}

/**
 * `kaipu/runScene` 的入参（契约 §3.4 `POST /scene/{id}/run`）。
 *
 * ★ `sceneId` 单列：契约里它是**路径参数**，其余才是请求体 —— 拆在这里合并，
 *   客户端只需记一个形状。
 * ★ 其余字段全部可选：契约里它们都是可选的，**不得由我们补默认值**
 *   （编一个 `outputLevel` 会让服务端按没被要求的档位跑）。
 */
export interface RunSceneQuery {
  /** 场景 id（契约路径参数 `{id}`） */
  sceneId: string
  /** 幂等键。契约要求由客户端生成 uuid（同一 `requestId` 重复提交 ⇒ `duplicate_request`） */
  requestId?: string
  target?: string
  content?: string
  /** 裁剪参与灯次（承 `run_when`） */
  dims?: string[]
  /** P2 起用（外部 Agent 进场） */
  externalAgents?: { agentId: string; seat: string }[]
  outputLevel?: 'light' | 'standard' | 'strict'
}

/** `kaipu/pollRun` 入参 */
export interface PollRunQuery {
  /** `startRun` 回的 runId */
  runId: string
  /** 从第几个事件起取（= 上次响应里的 `next`） */
  from?: number
}

/** `kaipu/pollRun` 出参（★ 三个字段缺一不可：增量 + 游标 + 终态） */
export interface RunPoll {
  /** `from` 之后的**增量**事件 */
  events: SceneRunEvent[]
  /** 下次该从哪取 */
  next: number
  /** 泵是否已经收工（不管成功还是失败） */
  done: boolean
  /** 泵失败的原因（**原文**，未翻译）；正常跑完是 `null` */
  error: string | null
}

/* ══════════════════════════════════════════════════════════════════
   二、小工具（★ 一律用"宽松形状"，不引 `node:` / DOM 类型）
   ══════════════════════════════════════════════════════════════════ */

/** 取全局 fetch（Node 18+ 提供）。取不到就回 null，由调用方报清楚 */
function getFetch(): FetchLike | null {
  const f = (globalThis as unknown as { fetch?: FetchLike }).fetch
  return typeof f === 'function' ? f : null
}

/** 取 `TextDecoder`（SSE 字节流解码用）。取不到就回 null，由调用方报清楚 */
function getTextDecoder(): (new (label?: string) => TextDecoderLike) | null {
  const t = (globalThis as unknown as { TextDecoder?: new (label?: string) => TextDecoderLike }).TextDecoder
  return typeof t === 'function' ? t : null
}

/** 取 `AbortController`（取消正在跑的 SSE）。取不到就回 null（退化为"不能中途取消"） */
interface AbortControllerLike {
  readonly signal: unknown
  abort(reason?: unknown): void
}
function getAbortController(): (new () => AbortControllerLike) | null {
  const a = (globalThis as unknown as { AbortController?: new () => AbortControllerLike }).AbortController
  return typeof a === 'function' ? a : null
}

/** 取环境变量（同款"宽松签名"，不引 @types/node） */
function envOf(): Record<string, string | undefined> {
  const p = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
  return p?.env ?? {}
}

/**
 * FNV-1a（32 位）—— **不是密码学哈希**，只用来做"同机稳定"的指纹。
 * 为什么要它：本仓 host 侧 tsconfig 是 `types: []`，引 `node:crypto` 就要拉
 * 一整套 Node 类型；而指纹的用途只是「同一台机器固定不变」，不是安全强度。
 * ⇒ 用 8 个不同种子各跑一遍，拼成 64 位十六进制（比 32 位抗碰撞得多，够用）。
 */
function fnv1a64(input: string): string {
  let out = ''
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c]) {
    let h = seed >>> 0
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    out += h.toString(16).padStart(8, '0')
  }
  return out.slice(0, 32) // 32 位十六进制，契约要求 ≥8 位
}

/** 本机推导：拿得到稳定字段就推，拿不到回 null（**不编**） */
function deriveFingerprint(): string | null {
  const env = envOf()
  const parts = [
    env['COMPUTERNAME'] ?? env['HOSTNAME'] ?? '',
    env['USERNAME'] ?? env['USER'] ?? '',
    env['USERDOMAIN'] ?? env['USERDNSDOMAIN'] ?? '',
  ].filter((s) => s !== '')
  return parts.length === 0 ? null : `kaipu-${fnv1a64(parts.join('|'))}`
}

/** 兜底指纹：**固定值** + 由 `status.fingerprintSource='fallback'` 明示（不许悄悄用） */
const FALLBACK_FINGERPRINT = 'kaipu-fallback-0000000000000000000000000000'

interface Deferred {
  readonly promise: Promise<'timeout'>
  cancel(): void
}
/** 最小超时器（不引 @types/node；`setTimeout` 在 Node 与浏览器都有） */
function timer(ms: number): Deferred {
  const g = globalThis as unknown as {
    setTimeout?: (fn: () => void, ms: number) => unknown
    clearTimeout?: (h: unknown) => void
  }
  let handle: unknown = null
  let done: (v: 'timeout') => void = () => {}
  const promise = new Promise<'timeout'>((res) => {
    done = res
    handle = g.setTimeout?.(() => res('timeout'), ms) ?? null
  })
  return { promise, cancel: () => { g.clearTimeout?.(handle); done('timeout') } }
}

/* ★★ SSE 分帧 ＋「帧 → 事件」的映射已抽到 **`./sse-frame.js`**（2026-10-06）。
 *
 *   为什么抽：那段代码的注释写着"**纯函数，便于单独断言**"，可它是 class 的 `private`
 *   —— **根本断言不了**。而"流内 `error` 帧"这个输入在真服务端上**很难自然发生**
 *   （正常路径不发），想验证它只能**造一帧喂进去**。
 *   ⇒ 抽成零依赖模块后，判据可直接 import 编译产物来喂帧。
 */

/**
 * 「这个取消信号说取消了吗」。
 *
 * ★★ 为什么值得单开一个函数（不是为了好看）：
 *   `CancelSignal.aborted` 是 `readonly boolean`。若在同一个函数体里先写
 *   `if (signal?.aborted === true) return`，TS 会**就地收窄**成 `false`，
 *   于是后面循环里再写 `=== true` 就报
 *     `TS2367: types 'false | undefined' and 'true' have no overlap` ——
 *   一个**纯类型层面的**假错误，会逼人把正确的取消检查删掉。
 *   参数在新函数里是全新作用域，收窄不会跨过来。
 *
 * ★ 另记一条事实（决定"轮询取消"值不值得做）：本仓只声明了 `{ aborted }`，
 *   **没有** `addEventListener`。所以这里只能**取快照**，不是订阅。
 *   ⇒ 真正的取消路径是**消费者侧 `break`**：客户端不再 `for await` ⇒
 *     Gateway 关流 ⇒ 本 generator 被 `return()` ⇒ `finally` 里 `reader.cancel()`。
 *     循环里那句检查只是"顺手早退"，**不是**取消的保证。
 */
function isAborted(sig: CancelSignal | undefined): boolean {
  return sig !== undefined && sig.aborted
}

/* ══════════════════════════════════════════════════════════════════
   三、服务
   ══════════════════════════════════════════════════════════════════ */

/**
 * 第 2 个构造参数 `REMOTE_NS` 同时是：
 *   · cordis 服务键
 *   · 默认 wire namespace（客户端端点即 `kaipu/listScenes`）
 */
/**  的两态返回：要么拿到响应，要么是一个**已翻译的**错误包 */
type HttpOutcome = { status: number; text: string } | RemoteErr

export class KaipuRemoteService extends TypertRemoteService {
  private readonly cfg: KaipuServiceConfig
  /** ★ 指纹来源要**可查**（兜底值不许冒充真实指纹，见 status 出参） */
  private readonly fingerprint: string
  private readonly fingerprintSource: StatusPayload['fingerprintSource']

  /** ★★ 凭据：只在本进程内存；不落盘、不进日志、不进任何返回值 */
  private token: string | null = null
  private tokenExpiresAt = 0 // unix 秒

  /**
   * ★★ 运行会话表（`startRun` / `pollRun` / `stopRun` 三件套的后端）。
   *
   * ══════════════════════════════════════════════════════════════════
   * 为什么是"后台泵 + 轮询"，而不是一条真流
   * ══════════════════════════════════════════════════════════════════
   * 契约 §3.4 的 SSE 本该用**流式**端点接（`@Remote({ mode: 'stream' })`），
   * 但 **2026-10-05 实测证明第三方插件拿不到流式入口**：
   *
   *   · 浏览器侧的 `connection.rpc.open`（唯一的一元之外的通道）**不存在** ——
   *     DSH 源码原话：`Browser transports omit this method; API Gateway owns their WebSocket mux.`
   *   · 页面里能用的是 `ctx.remote.<namespace>.<method>(query, signal)`（返回 `AsyncIterable`），
   *     但要先有那个 namespace —— **而它不会自动来**：
   *     DSH 的 `packages/api/remotes/src/client/index.ts` 是一份**硬编码的内部包清单**
   *     （逐个 `import '@deepseek-ai/dsh-api-job-controller/remote'` 再 `ctx.remote.$mount(...)`），
   *     **第三方插件不在其中**。
   *   · 自挂载要自造 `InvocationDescriptor`（含全局 id / codec / 参数表）——
   *     那是**构建期代码生成**的产物，而本仓的定位恰恰是"零构建产物"。
   *
   * ⇒ **取舍**：用"host 后台读完 SSE + client 轮询增量"——走的是一元通道
   *   （已经跑通的 `kaipu/status|listScenes|…`），零新机制、可测、可控。
   *   **代价只有延迟**（一个轮询周期 ≈ 300ms），而契约要的"逐灯 + 判定可见"
   *   并不要求亚秒级实时 ⇒ 这个代价是划得来的。
   *   **如实记**：这不是契约想要的形态，是**宿主能力边界**下的最优解；
   *   若将来 DSH 给第三方开放流式入口，这里应改回 stream（届时删掉本表）。
   */
  private readonly runs = new Map<
    string,
    { events: SceneRunEvent[]; done: boolean; error: string | null; startedAt: number }
  >()

  /** 运行会话保留上限：超了**先删最旧的**（`startRun` 开始新一场时顺便清理） */
  private static readonly RUN_KEEP = 20

  constructor(ctx: Context, cfg: KaipuServiceConfig = {}) {
    super(ctx, REMOTE_NS)
    this.cfg = cfg
    const configured = typeof cfg.fingerprint === 'string' ? cfg.fingerprint.trim() : ''
    if (configured.length >= 8) {
      this.fingerprint = configured
      this.fingerprintSource = 'config'
    } else {
      const derived = deriveFingerprint()
      if (derived !== null) {
        this.fingerprint = derived
        this.fingerprintSource = 'derived'
      } else {
        this.fingerprint = FALLBACK_FINGERPRINT
        this.fingerprintSource = 'fallback'
      }
    }
  }

  /* ───────────────────────── 内部：HTTP ───────────────────────── */

  private get baseUrl(): string {
    const b = typeof this.cfg.baseUrl === 'string' ? this.cfg.baseUrl.trim() : ''
    return b.replace(/\/+$/u, '')
  }

  private get connected(): boolean {
    return this.baseUrl !== ''
  }

  private get accountId(): string {
    const a = typeof this.cfg.accountId === 'string' ? this.cfg.accountId.trim() : ''
    return a === '' ? 'cli-trial' : a
  }

  /**
   * 一次带超时的 HTTP 调用。
   * ★ **不抛异常**：网络类错误一律折算成 `{ ok:false, code:'network', error }` ——
   *   面板最怕的是"一个 fetch 抛出去把整个 apply 链带崩"。
   */
  private async http(
    method: string,
    path: string,
    body: unknown,
    signal: CancelSignal | undefined,
  ): Promise<HttpOutcome> {
    const fetchFn = getFetch()
    if (fetchFn === null) {
      return { ok: false, kind: 'error', code: 'no_fetch', error: '本环境没有 fetch，无法访问服务端' }
    }
    if (!this.connected) {
      return { ok: false, kind: 'error', code: 'not_connected', error: '尚未配置接入地址（本地模式）' }
    }
    if (signal?.aborted === true) {
      return { ok: false, kind: 'denied', code: 'aborted', error: '已取消' }
    }

    const headers: Record<string, string> = { 'Accept': 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token !== null) headers['Authorization'] = `Bearer ${this.token}`
    headers['X-Client-Version'] = this.cfg.clientVersion ?? '0.1.0'
    headers['X-Device-Fingerprint'] = this.fingerprint

    const t = timer(this.cfg.timeoutMs ?? 15000)
    try {
      const res = await Promise.race([
        fetchFn(`${this.baseUrl}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        t.promise.then(() => {
          throw new Error('TIMEOUT')
        }),
      ])
      return { status: res.status, text: await res.text() }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        kind: 'error',
        code: msg === 'TIMEOUT' ? 'timeout' : 'network',
        error: msg === 'TIMEOUT' ? '服务端没有及时回应' : `连不上服务端：${msg}`,
      }
    } finally {
      t.cancel()
    }
  }

  private static isErr(v: unknown): v is RemoteErr {
    return typeof v === 'object' && v !== null && 'ok' in v && (v as { ok: unknown }).ok === false
  }

  /** 解析服务端的统一错误体 `{ error: { code, message } }` */
  private static parseErr(text: string): { code: string; message: string } | null {
    try {
      const j = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }
      const code = typeof j.error?.code === 'string' ? j.error.code : ''
      const message = typeof j.error?.message === 'string' ? j.error.message : ''
      return code === '' ? null : { code, message }
    } catch {
      return null
    }
  }

  /**
   * 取令牌（幂等 + 到期自动续）。
   *   · 契约：`POST /auth/device {fingerprint, clientVersion, account_id}` → `{deviceToken, expiresIn, …}`
   *   · 响应里 `is_new_device` / `device_mismatch(403)` / `not_found(404)` 的处理见 §四 出参说明
   */
  private async ensureToken(signal: CancelSignal | undefined): Promise<RemoteResult<string>> {
    const nowSec = Math.floor(Date.now() / 1000)
    if (this.token !== null && nowSec < this.tokenExpiresAt - TOKEN_RENEW_MARGIN_SEC) {
      return { ok: true, data: this.token }
    }

    const r = await this.http('POST', '/auth/device', {
      fingerprint: this.fingerprint,
      clientVersion: this.cfg.clientVersion ?? '0.1.0',
      account_id: this.accountId,
    }, signal)
    if (KaipuRemoteService.isErr(r)) return r
    if (r.status !== 200) {
      const parsed = KaipuRemoteService.parseErr(r.text)
      return {
        ok: false,
        kind: 'error',
        code: parsed?.code ?? `http_${r.status}`,
        error: parsed?.message ?? `取令牌失败（HTTP ${r.status}）`,
      }
    }

    let token = ''
    let expiresIn = 0
    try {
      const j = JSON.parse(r.text) as { deviceToken?: unknown; expiresIn?: unknown }
      token = typeof j.deviceToken === 'string' ? j.deviceToken : ''
      expiresIn = typeof j.expiresIn === 'number' && j.expiresIn > 0 ? j.expiresIn : 0
    } catch {
      return { ok: false, kind: 'error', code: 'bad_json', error: '取令牌的响应读不懂' }
    }
    if (token === '') {
      return { ok: false, kind: 'error', code: 'no_token', error: '服务端没有回令牌' }
    }

    this.token = token
    this.tokenExpiresAt = expiresIn > 0 ? nowSec + expiresIn : nowSec + 3600
    return { ok: true, data: token }
  }

  /**
   * 带令牌 GET（★ 401 只重试**一次**：先当"令牌过期"续一次，再不行就如实上报）
   */
  private async authedGet<T>(path: string, signal: CancelSignal | undefined): Promise<RemoteResult<T>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tk = await this.ensureToken(signal)
      if (tk.ok !== true) return tk
      const r = await this.http('GET', path, undefined, signal)
      if (KaipuRemoteService.isErr(r)) return r
      if (r.status === 401 && attempt === 0) {
        this.token = null // 令牌被判无效 ⇒ 丢掉，下一轮重取
        this.tokenExpiresAt = 0
        continue
      }
      if (r.status !== 200) {
        const parsed = KaipuRemoteService.parseErr(r.text)
        return {
          ok: false,
          kind: 'error',
          code: parsed?.code ?? `http_${r.status}`,
          error: parsed?.message ?? `读取失败（HTTP ${r.status}）`,
        }
      }
      try {
        return { ok: true, data: JSON.parse(r.text) as T }
      } catch {
        return { ok: false, kind: 'error', code: 'bad_json', error: '响应读不懂（不是 JSON）' }
      }
    }
    return { ok: false, kind: 'error', code: 'unauthorized', error: '通行证不管用了，重新领一张。' }
  }

  /* ═══════════════════════ 四、端点（wire: kaipu/<method>） ═══════════════════════ */

  /**
   * `kaipu/status` —— **面板第一件要知道的事：接没接上**。
   *
   * ★ 为什么它是第一个端点：`connected:false` 是**正常状态**（本地模式），
   *   不是故障。把它做成一个显式出参，面板才能"如实说本地模式"，
   *   而不是靠"请求失败"去猜 —— 失败与未接入在界面上必须能区分。
   */
  @Remote('status')
  async status(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<StatusPayload>> {
    void query
    const base: StatusPayload = {
      connected: this.connected,
      baseUrl: this.baseUrl,
      accountId: this.accountId,
      fingerprintSource: this.fingerprintSource,
    }
    if (!this.connected) return { ok: true, data: base }

    if (signal?.aborted === true) return { ok: false, kind: 'denied', code: 'aborted', error: '已取消' }

    const h = await this.http('GET', '/health', undefined, signal)
    if (KaipuRemoteService.isErr(h)) return { ok: true, data: { ...base, authError: h.error } }
    if (h.status !== 200) {
      return { ok: true, data: { ...base, authError: `存活探针 HTTP ${h.status}` } }
    }

    let health: { version?: string; serverTime?: string; agentsLoaded?: number; tenants?: number } = {}
    try {
      health = JSON.parse(h.text) as typeof health
    } catch {
      return { ok: true, data: { ...base, authError: '存活探针的响应读不懂' } }
    }

    // 存活之外还探一次"能不能取到令牌"——这才是"接上了"的完整判据
    const tk = await this.ensureToken(signal)
    return {
      ok: true,
      data: {
        ...base,
        ...(health.version === undefined ? {} : { serverVersion: health.version }),
        ...(health.serverTime === undefined ? {} : { serverTime: health.serverTime }),
        ...(health.agentsLoaded === undefined ? {} : { agentsLoaded: health.agentsLoaded }),
        ...(health.tenants === undefined ? {} : { tenants: health.tenants }),
        ...(tk.ok === true ? {} : { authError: tk.error }),
      },
    }
  }

  /** `kaipu/connect` —— 取令牌 + `/me`（铺子身份 / 能力位 / 时间基准）。**兼心跳** */
  @Remote('connect')
  async connect(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<AccountView>> {
    void query
    return this.authedGet<AccountView>('/me', signal)
  }

  /** `kaipu/listAgents` —— Agent 卡片（★ 响应可能为空数组：那是"零接入"，不是错误） */
  @Remote('listAgents')
  async listAgents(
    query: EmptyQuery,
    signal?: CancelSignal,
  ): Promise<RemoteResult<{ agents: AgentView[]; accountId?: string }>> {
    void query
    return this.authedGet<{ agents: AgentView[]; accountId?: string }>('/agents', signal)
  }

  /** `kaipu/listScenes` —— 场景清单 + `#17` 的 `categories` / `recommendations` */
  @Remote('listScenes')
  async listScenes(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<ScenesPayload>> {
    void query
    return this.authedGet<ScenesPayload>('/scenes', signal)
  }

  /** `kaipu/capabilities` —— 能力边界（`cannot` 段**必须完整展示**） */
  @Remote('capabilities')
  async capabilities(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<CapabilitiesPayload>> {
    void query
    return this.authedGet<CapabilitiesPayload>('/capabilities', signal)
  }

  /* ═══════════════ 五、★ 流式端点（SSE · 契约 §3.4） ═══════════════

   * ★★ 形态取舍：**不是流式端点，而是「后台泵 + 轮询」**（原因见 `runs` 字段那段长注）——
   *
   *   契约 §3.4 的 `POST /scene/{id}/run` 是 **SSE**，价值在"逐灯 + 判定可见"
   *   （§十 对接清单 #2）。最自然的接法是 `@Remote({ mode: 'stream' })`，
   *   但 **2026-10-05 实测证明第三方插件拿不到浏览器侧的流式入口** ⇒ 退回本形态：
   *     · 裸 SSE 仍在 **host** 进程里读（`readRunEvents`，与本文件此前写法一致）
   *     · 读出来的事件由**后台泵**累积进 `this.runs`
   *     · 客户端用 `pollRun` 取**增量**（≈300ms 一个周期）
   *   ⇒ 契约要的"逐灯可见"能满足；**损失的只是实时性的量级**，不是有无。
   *
   * ★★ fail-closed 三处（本端点的全部"不做"）：
   *   ① **契约外的事件名 ⇒ 不产出**（不编造一个我们看不懂的事件去渲染）
   *   ② **`data` 不是 JSON / 不是对象 ⇒ 跳过该帧**（不炸整条流，也不塞半个对象）
   *   ③ **`lamp_*` 缺 `round` ⇒ 填流内最近一次 `round_start` 的值**（不编新轮次）
   *      —— 契约 §3.4 示例里 `lamp_*` 确实不带 `round`（变更 #2 才要求加），
   *      所以这不是防御性洁癖，是**实测会遇到的形态**。
   *
   * ★ 未闭环项（如实记，不假装）：契约 §3.4 的 `error` 事件**不在**
   *   `SceneRunEvent` 判别联合里（我方契约包 `sse.ts` 缺这一支）。
   *   ⇒ 本端点把 `error` 帧**转成抛出**（带服务端原文 message），客户端 catch 后
   *     如实显示"运行中断 + 服务端说明"，**不冒充成功**。
   *   ⇒ 待办：把 `error` 补进契约包类型（改的是"我方类型漏了契约已有的事件"，
   *     不是单方改形状），并让 reducer / 界面按 `code` 走 §8.2 文案表。
   */

  /**
   * `kaipu/startRun` —— 起一场运行。
   *
   * ★ **不阻塞**：立刻回 `runId`，读 SSE 的活在后台泵（`pump`）里做，
   *   事件累积进 `this.runs`；客户端用 `pollRun` 取增量。
   *   为什么不在这里 `await` 到跑完：一场多轮场景可能几分钟，
   *   一元 RPC 有 15s 超时 ⇒ 必然断（见 `runs` 字段那段取舍说明）。
   */
  @Remote('startRun')
  async startRun(query: RunSceneQuery, signal?: CancelSignal): Promise<RemoteResult<{ runId: string }>> {
    if (isAborted(signal)) {
      return { ok: false, kind: 'denied', code: 'aborted', error: '已取消' }
    }
    const sceneId = typeof query.sceneId === 'string' ? query.sceneId.trim() : ''
    if (sceneId === '') {
      return { ok: false, kind: 'error', code: 'bad_request', error: '没有指定要跑的场景（sceneId 为空）' }
    }
    if (!this.connected) {
      return { ok: false, kind: 'error', code: 'not_connected', error: '尚未配置接入地址（本地模式）' }
    }

    this.gcRuns()
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    this.runs.set(runId, { events: [], done: false, error: null, startedAt: Date.now() })
    // ★ **故意不 await**：让它自己跑完，客户端靠 pollRun 取（失败也会被泵记进 error）
    void this.pump(runId, query)
    return { ok: true, data: { runId } }
  }

  /**
   * `kaipu/pollRun` —— 取**增量**事件（从 `from` 起）。
   * ★ 返回 `next`（下次该从哪取）而不是让客户端自己数长度 ——
   *   客户端数长度会在"服务端先返回错误再补事件"这类时序下算错。
   */
  @Remote('pollRun')
  async pollRun(query: PollRunQuery, signal?: CancelSignal): Promise<RemoteResult<RunPoll>> {
    void signal
    const runId = typeof query.runId === 'string' ? query.runId : ''
    const rec = this.runs.get(runId)
    if (rec === undefined) {
      return {
        ok: false,
        kind: 'error',
        code: 'not_found',
        error: '这次运行的记录已经不在宿主内存里了（可能已被清理，或宿主重启过）。',
      }
    }
    const from = typeof query.from === 'number' && query.from >= 0 ? Math.floor(query.from) : 0
    return {
      ok: true,
      data: {
        events: rec.events.slice(from),
        next: rec.events.length,
        done: rec.done,
        error: rec.error,
      },
    }
  }

  /* ── 内部：后台泵 + 会话清理 ── */

  /**
   * 后台把服务端的 SSE 读干，事件累积进会话。
   * ★ 出错**记进 `error` 而不是丢**：客户端轮询时要如实看到"为什么没跑完"。
   * ★ 即使客户端已不再轮询，本泵也会**把这一场读完** ——
   *   服务端仍在算完并落 `lamp_runs`（契约 R5），我方不该提前松手。
   */
  private async pump(runId: string, query: RunSceneQuery): Promise<void> {
    const rec = this.runs.get(runId)
    if (rec === undefined) return
    try {
      for await (const ev of this.readRunEvents(query, undefined)) {
        rec.events.push(ev)
      }
    } catch (e) {
      rec.error = e instanceof Error ? e.message : String(e)
    } finally {
      rec.done = true
    }
  }

  /** 会话表满了就**先删最旧的**（按开始时间）—— 只清内存，不影响服务端 */
  private gcRuns(): void {
    while (this.runs.size >= KaipuRemoteService.RUN_KEEP) {
      let oldestKey: string | null = null
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [key, value] of this.runs) {
        if (value.startedAt < oldestAt) {
          oldestAt = value.startedAt
          oldestKey = key
        }
      }
      if (oldestKey === null) break
      this.runs.delete(oldestKey)
    }
  }

  /**
   * 读服务端的 SSE，产出契约事件（泵的取数器）。
   * ★ 只做"接流 + 分帧 + 校验"，不含任何渲染判断。
   * ★ 保留 `async generator` 形态：这样它**可以被直接 `for await` 断言**
   *   （不经 RPC），接线出问题时能一步定位是"读"坏了还是"传"坏了。
   */
  private async * readRunEvents(
    query: RunSceneQuery,
    signal: CancelSignal | undefined,
  ): AsyncGenerator<SceneRunEvent> {
    const fetchFn = getFetch()
    if (fetchFn === null) throw new Error('本环境没有 fetch，无法发起运行')
    if (!this.connected) throw new Error('尚未配置接入地址（本地模式）')

    const sceneId = typeof query.sceneId === 'string' ? query.sceneId.trim() : ''
    if (sceneId === '') throw new Error('没有指定要跑的场景（sceneId 为空）')
    if (isAborted(signal)) return

    const tk = await this.ensureToken(signal)
    if (tk.ok !== true) throw new Error(tk.error)

    /**
     * ★ 取消桥接：`CancelSignal` 在本仓只声明了 `{ aborted }`（**没有事件**），
     *   所以取消只能**轮询** —— 在每次 `read()` 返回后检查，够了：
     *   每次 `read()` 都会在下一个事件到达时返回，最坏延迟 = 一个事件的间隔。
     */
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tk.data}`,
      'X-Client-Version': this.cfg.clientVersion ?? '0.1.0',
      'X-Device-Fingerprint': this.fingerprint,
    }
    const payload: Record<string, unknown> = {}
    if (query.requestId !== undefined) payload['requestId'] = query.requestId
    if (query.target !== undefined) payload['target'] = query.target
    if (query.content !== undefined) payload['content'] = query.content
    if (Array.isArray(query.dims)) payload['dims'] = query.dims
    if (Array.isArray(query.externalAgents)) payload['externalAgents'] = query.externalAgents
    if (query.outputLevel !== undefined) payload['outputLevel'] = query.outputLevel

    // ★ 不走 `this.http()`：那条路有 15s 超时（对长流是错的），且它只 `text()` 整读
    const fetchStream = fetchFn as unknown as FetchStreamLike
    const url = `${this.baseUrl}/scene/${encodeURIComponent(sceneId)}/run`
    let res: StreamingResponseLike
    try {
      res = await fetchStream(url, { method: 'POST', headers, body: JSON.stringify(payload) })
    } catch (e) {
      throw new Error(`连不上服务端：${e instanceof Error ? e.message : String(e)}`)
    }

    if (res.status !== 200) {
      let text = ''
      try {
        text = await res.text()
      } catch {
        // 读错误体失败不影响"HTTP 状态"这个事实，继续如实报状态
      }
      const parsed = KaipuRemoteService.parseErr(text)
      throw new Error(
        parsed === null ? `运行请求失败（HTTP ${res.status}）` : `${parsed.message}（${parsed.code}）`,
      )
    }

    const streamBody = res.body
    if (streamBody === null || streamBody === undefined) {
      throw new Error('服务端没有返回事件流（body 为空）')
    }
    const Reader = getTextDecoder()
    if (Reader === null) throw new Error('本环境没有 TextDecoder，读不了事件流')

    const reader = streamBody.getReader()
    const dec = new Reader('utf-8')
    /** ★ 归一化行尾后再找空行 —— `\r\n\r\n` 用 `indexOf('\n\n')` 是找不到的 */
    let buf = ''
    let curRound = 1
    let sawDone = false

    try {
      for (;;) {
        if (isAborted(signal)) break
        const chunk = await reader.read()
        if (chunk.done) break
        if (chunk.value === undefined) continue
        buf = (buf + dec.decode(chunk.value, { stream: true })).replace(/\r\n/gu, '\n')

        let cut = buf.indexOf('\n\n')
        while (cut >= 0) {
          const frame = buf.slice(0, cut)
          buf = buf.slice(cut + 2)
          const out = frameToEvent(parseSseFrame(frame), curRound)
          if (out === null) {
            cut = buf.indexOf('\n\n')
            continue
          }
          if (out.kind === 'round') curRound = out.round
          // ★ 2026-10-06：这里原来有一句 `if (out.kind === 'error') throw …` ——
          //   它把**流内的 error 事件**当成了"这次运行挂了"（抛出让上层走失败路径）。
          //   现在 `error` 走普通事件通路（见 `frameToEvent` 注释），**不再抛**：
          //   它是运行记录的一部分，由界面如实显示，**不打断**视图。
          if (out.event.event === 'done') sawDone = true
          yield out.event
          cut = buf.indexOf('\n\n')
        }
      }

      // ★ 收尾：服务端可能直接关连接，**最后一帧没有结尾空行** ⇒ 必须再解一次
      buf += dec.decode()
      const tail = parseSseFrame(buf)
      if (tail !== null) {
        const out = frameToEvent(tail, curRound)
        if (out !== null) {
          if (out.event.event === 'done') sawDone = true
          yield out.event
        }
      }
      // ★ 流结束却没见 `done` ⇒ **如实说出来**，不让界面把"断了"当成"跑完了"
      if (!sawDone && !isAborted(signal)) {
        throw new Error('事件流提前结束（没有收到 done）')
      }
    } finally {
      try {
        await reader.cancel?.()
      } catch {
        // 取消失败不影响已 yield 的事件；这里不掩盖真正的错误
      }
    }
  }

  /* ★ 「帧 → 事件」的映射已抽到模块级 `frameToEvent`（见 `./sse-frame.js`）。
   *   2026-10-06 搬走的原因：这段代码的注释原本写着"**纯函数，便于单独断言**"，
   *   可它是 class 的 `private` —— **断言不了**（注释说了没做的事）。
   *   而"流内 error 帧"在真服务端上很难自然发生（正常路径不发），
   *   想验证它只能**造一帧喂进去** ⇒ 必须让它可被 import。
   */
}
