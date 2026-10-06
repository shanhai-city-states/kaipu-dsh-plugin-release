/**
 * 山海·开铺 · 场地插件 · client half —— **运行**（契约 §3.4 接线）
 * =====================================================================
 * 这一层只做一件事：**把一场运行真跑起来，并如实回调它的每个事件**。
 * 它不认识界面，也不认识 reducer —— 拿到什么就交出去什么。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 为什么是「轮询」而不是「流」—— 这是实测逼出来的，不是偷懒
 * ══════════════════════════════════════════════════════════════════
 * 契约 §3.4 是 **SSE**，最自然的接法是 DSH 的流式端点
 * （`@Remote({ mode: 'stream' })` → 客户端 `remote.<ns>.<method>()` 拿 `AsyncIterable`）。
 * **2026-10-05 在真环境里逐条验证，这条路对第三方插件不通**：
 *
 *   ① `connection.rpc.call`（我们一直在用的）是**一元**的 ——
 *      它 POST 一次等一个 `server-response`（源码 `dsh-client-connection/src/client/rpc.ts`），
 *      装不下多帧。
 *   ② 唯一的非一元入口 `connection.rpc.open` **在浏览器端不存在**。源码注释原文：
 *      `Browser transports omit this method; API Gateway owns their WebSocket mux.`
 *   ③ 页面里那条路 `ctx.remote.<ns>.<method>()` **需要 namespace 被装配**，
 *      而做装配的 `packages/api/remotes/src/client/index.ts` 是一份
 *      **硬编码的内部包清单**（逐个 `import '@deepseek-ai/dsh-xxx/remote'` 再 `$mount`）
 *      —— **第三方插件不在其中**。实测印证：`ctx.remote` 拿到了，键是
 *      `[ctx,name,ownerCtx,connection,namespaces,hostFacts,streams,events,mutations]`，
 *      **里面没有 `kaipu`**。
 *   ④ 自己 `ctx.remote.$mount(contribution)` 要自造 `InvocationDescriptor`
 *      （全局 id / codec / 参数表）—— 那是**构建期代码生成**的产物，
 *      与本仓"零构建产物"的定位正面冲突，且无先例可依。
 *
 * ⇒ **取舍**：host 后台把 SSE 读干并累积，客户端**轮询增量**（`startRun` + `pollRun`）。
 *   · 走的是**已经跑通**的一元通道（`kaipu/status|listScenes|…` 同一套），零新机制
 *   · 代价只有一个轮询周期的延迟（`POLL_MS`），而契约要的"逐灯 + 判定可见"
 *     不要求亚秒级实时 ⇒ 划得来
 *   **如实记**：这不是契约想要的形态，是**宿主能力边界**下的最优解。
 *   将来 DSH 若对第三方开放流式入口，这里应改回 stream。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ fail-closed：这里对服务端来的东西**一个字都不编**
 * ══════════════════════════════════════════════════════════════════
 *   · 事件不是对象 / 没有字符串 `event` ⇒ **丢掉**（不塞半个对象进 reducer）
 *   · 出错 ⇒ **如实把 message 交出去**（不吞、不换成"加载失败"这种空话）
 *   · 用户主动停止 ⇒ 走 `onEnd` 而**不是** `onError` ——
 *     停止不是故障（契约 R5：措辞是"已停止接收"，不是"已取消"）
 */
import type { SceneRunEvent } from '@shanhai/kaipu-contract'
import { callKaipu, ENDPOINTS, type BridgeResult } from './bridge.js'
import { currentConnection } from './live.js'

/* ══════════════════════════════════════════════════════════════════
   一、形状
   ══════════════════════════════════════════════════════════════════ */

/** 一次运行的入参（★ 只列契约 §3.4 有的字段，不补默认值） */
export interface RunQuery {
  sceneId: string
  target?: string
  content?: string
  dims?: string[]
  outputLevel?: 'light' | 'standard' | 'strict'
}

export interface RunCallbacks {
  /** 每收到一个**形状合法**的契约事件调一次（顺序 = 服务端产出顺序） */
  onEvent(event: SceneRunEvent): void
  /** 真出错（连不上 / 服务端报错 / 泵失败）—— **message 是给人看的原文** */
  onError(message: string): void
  /** 流结束（正常结束**或**用户主动停止，两者都会走到这里） */
  onEnd(): void
}

/** 运行句柄。`stop()` = **客户端停止接收**（R5：服务端仍在算完并落 `lamp_runs`） */
export interface RunSession {
  stop(): void
}

/** `pollRun` 的返回体（与 host 侧 `RunPoll` 同形；这里不 import 契约包以外的类型） */
interface RunPollPayload {
  events?: unknown[]
  next?: number
  done?: boolean
  error?: string | null
}

/**
 * 轮询周期。
 * ★ 300ms 的取法：够快（"逐灯"读起来是连贯的），又不至于把一元通道打满
 *   （一场运行几十个事件 ⇒ 十几秒里几十次请求，与一次 `listScenes` 同量级）。
 */
const POLL_MS = 300

/* ══════════════════════════════════════════════════════════════════
   二、发起运行
   ══════════════════════════════════════════════════════════════════ */

/**
 * 发起一次运行。
 *
 * ★ 幂等键由**客户端**生成（契约要求）：同一 `requestId` 重复提交 ⇒
 *   服务端回 `duplicate_request`，这是**保护**不是错误。
 */
export function startRun(query: RunQuery, cb: RunCallbacks): RunSession {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 下次该从第几个事件取（由服务端回的 `next` 决定，**不自己数长度**） */
  let cursor = 0

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  const finish = (): void => {
    clearTimer()
    cb.onEnd()
  }
  /** 把两种失败形态（网关层 / 业务层）都收敛成**一句人话** */
  const reasonOf = (r: BridgeResult<unknown>): string =>
    r.ok === true ? '' : ('business' in r ? r.business.message : r.error.detail)

  const poll = async (runId: string): Promise<void> => {
    if (stopped) return
    const conn = currentConnection()
    if (conn === null) {
      cb.onError('运行通道断了（宿主的数据通道不可用）。')
      finish()
      return
    }
    const r = await callKaipu<RunPollPayload>(conn, ENDPOINTS.pollRun, { runId, from: cursor })
    if (stopped) return
    if (r.ok !== true) {
      cb.onError(reasonOf(r))
      finish()
      return
    }
    for (const raw of r.data.events ?? []) {
      const ev = asEvent(raw)
      if (ev !== null) cb.onEvent(ev)
    }
    if (typeof r.data.next === 'number' && r.data.next >= cursor) cursor = r.data.next
    if (r.data.done === true) {
      // ★ 泵失败过 ⇒ 如实说出来（**不把"跑挂了"当"跑完了"**）
      const err = r.data.error
      if (typeof err === 'string' && err !== '') cb.onError(err)
      finish()
      return
    }
    timer = setTimeout(() => {
      void poll(runId)
    }, POLL_MS)
  }

  void (async () => {
    const conn = currentConnection()
    if (conn === null) {
      cb.onError('运行通道不可用：没取到宿主的数据通道（这是环境问题，不是服务端故障）。')
      finish()
      return
    }
    const payload: Record<string, unknown> = { sceneId: query.sceneId, requestId: newRequestId() }
    if (query.target !== undefined) payload['target'] = query.target
    if (query.content !== undefined) payload['content'] = query.content
    if (Array.isArray(query.dims)) payload['dims'] = query.dims
    if (query.outputLevel !== undefined) payload['outputLevel'] = query.outputLevel

    const started = await callKaipu<{ runId: string }>(conn, ENDPOINTS.startRun, payload)
    if (stopped) return
    if (started.ok !== true) {
      cb.onError(reasonOf(started))
      finish()
      return
    }
    const runId = typeof started.data.runId === 'string' ? started.data.runId : ''
    if (runId === '') {
      cb.onError('宿主没有返回 runId，这次运行没法跟踪。')
      finish()
      return
    }
    void poll(runId)
  })()

  return {
    stop: () => {
      // ★ 只停**客户端这一侧**：不再取，也不再回调 ——
      //   服务端与 host 的泵都会把这一场读完（R5：断开 ≠ 取消）。
      stopped = true
      clearTimer()
    },
  }
}

/* ══════════════════════════════════════════════════════════════════
   三、小工具
   ══════════════════════════════════════════════════════════════════ */

/**
 * 把服务端来的一个 item 收敛成契约事件。
 * ★ **形状不对就丢**（返回 `null`）—— 绝不把半个对象交给 reducer 去渲染。
 */
function asEvent(raw: unknown): SceneRunEvent | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  if (typeof rec['event'] !== 'string' || rec['event'] === '') return null
  return raw as SceneRunEvent
}

/**
 * 幂等键。★ 优先 `crypto.randomUUID`；兜底只用**非密码学**随机（它只做幂等键）
 */
function newRequestId(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
