/**
 * 山海·开铺 · 智囊团插件 · client half —— 宿主通道（data channel）
 * =====================================================================
 * 面板**不直连服务端域名**，而是经**宿主网关**调 host half：
 *
 *   浏览器(client)  --connection.rpc.call('/api','kaipu/listScenes',{args:{query}})-->
 *   DSH 网关（同源 · 已鉴权）  --> 场地插件的 host half（Node）  --fetch--> kai-pu
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★★ 本文件是**架构抉择的落点**，请先读这一段
 * ══════════════════════════════════════════════════════════════════
 *
 * **问题**：智囊团面板要读 `/scenes`，但两包**互不 import**
 * （解耦判据会 FAIL）。那数据从哪来？三条路：
 *
 *   | 选项 | 做法 | 判定 |
 *   |:--|:--|:--|
 *   | ① 智囊团**自己起一份 host remote** | 在自家 `src/index.ts` 里 `new` 一个 service | ❌ **不可行** |
 *   | ② 智囊团 client **调同一个网关端点**（**本文件即此**） | 只经 `connection` 服务发 rpc | ✅ **采用** |
 *   | ③ 等场地插件**暴露一个 cordis 服务**给智囊团用 | 需要场地配合 | ⏸ 过度设计（现在不需要） |
 *
 * **为什么 ① 不可行（技术硬约束，不是偏好）**：
 *   `TypertRemoteService` 的第 2 个构造参数就是**命名空间**（场地侧是 `'kaipu'`）。
 *   DSH 的网关按命名空间挂载 ⇒ **同一个 ns 只能挂一个 service**。
 *   智囊团若也 `super(ctx, 'kaipu')`，要么**覆盖**场地的通道（则场地挂掉），
 *   要么被拒（则智囊团挂掉）—— 两种结果都违反「摘掉智囊团，场地仍完整可用」。
 *
 * **为什么 ② 是正解 —— 关键是把「约束管的是什么」读准**：
 *
 *   > 约束的原文边界是「两包的 **client half 互不 import**」、
 *   > 「只通过**契约**通信」—— 它管的是**源码依赖**与**模块图**，
 *   > **不是"两组前端代码不能访问同一个网关"**。
 *
 *   `REMOTE_NS = 'kaipu'` 是**网关命名空间的字符串**，是**契约面**（wire），
 *   不是包边界。智囊团拼出 `'kaipu/listScenes'` 这个字符串去调，
 *   **既不 import 场地的任何源码，也不进它的模块图** ⇒ 约束完好。
 *
 *   ★ 一个可以自检的类比：两个第三方插件都能调同一个 HTTP API，
 *     这不叫"它们互相依赖"。**依赖 = import，不是 = 调同一个地址。**
 *
 * **★ 这条选择的代价，如实标出来（不许悄悄藏）**：
 *   · 端点名字符串现在**有第三处副本**（场地 host、场地 client、本文件）
 *     ⇒ 靠配套的桥接检查脚本 D 组**扩到三处对账**看护（已改）。
 *   · 智囊团**依赖场地插件在场**（端点由它注册）。这与上面的约束冲突吗？
 *     **不冲突，且这正是设计意图** —— 见下。
 *
 * **★★ 这两条约束为什么不受影响（这一条最要紧，别读错）**：
 *
 *   · 「可摘除」要求的是「**摘掉智囊团** ⇒ 场地仍完整可用」—— 方向是**智囊团→场地**，
 *     **没有**反过来要求"摘掉场地 ⇒ 智囊团仍能用"。
 *     （场地是**基座**，智囊团是**配套面板**，README 原文就写着"配套侧边面板"。）
 *   · 「零内置」要求的是「**场地**零内置可跑」——场地自己不带 Agent 也能起，
 *     这件事**与智囊团读不读得到数据无关**。
 *   · ⇒ 所以"**智囊团需要场地在场**"是**正常且预期**的形态。
 *     但**表现方式必须诚实**：场地不在 / 通道不通时，智囊团面板
 *     必须**如实说"通道不可用"或"读不到"**，**绝不默默显成"5 个灯位全待接入"**
 *     —— 那是把"我没读到"伪装成"你这里没人"，**编造了一个不存在的事实**。
 *     （这条与场地侧 `live.ts` 的"绝不悄悄回落 mock"是同一条价值取向。）
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 调用形态的两个硬细节（从场地侧逐字照搬，不是"参考"）
 * ══════════════════════════════════════════════════════════════════
 *   ① **`payload.args` 必须是对象、不是数组**，且键名 = host 方法的**参数名**：
 *        `{ args: { query: { … } } }`  ✅
 *   ② **`call()` 的返回已经剥过一层信封**：拿到的直接是 `result`。
 *   ★ 两层 `ok` 必须分清（网关层 / 业务层），否则错误会"串层" ——
 *     把 `gateway/bad-request` 当业务错误码去查文案表 ⇒ 查不到 ⇒ 显成"未知错误"。
 *
 * ⚠️ **为什么本文件不 import 场地的 `bridge.ts`**：那是源码 import ⇒ 判据 FAIL。
 *    这里是**同形状的重写**（约 60 行），不是 `import`。两者的**行为必须一致**，
 *    由配套的桥接检查脚本比对两处的 `REMOTE_NS` / `REMOTE_CHANNEL` 常量值。
 */

/* ══════════════════════════════════════════════════════════════════
   ★★ 端点常量：本文件与场地侧 host/client **各有一份**，判据强制三处一致
   ══════════════════════════════════════════════════════════════════
 * 为什么不共用一个文件：两端 tsconfig 的 module 格式不同（host ESM / client CJS），
 * 编到同一路径会**互相覆盖**；而 host 运行时又不能用契约包（构建期依赖，用户机上没有）。
 * ⇒ 按本仓一贯做法：**各写一份 + 机器看护**（不靠记性）。
 *
 * ★ 端点字符串写错 = "点了没反应"（不报错、不白屏、面板就是没数据）
 *   ⇒ 一致性**必须有机器看护**，这正是配套的桥接检查脚本的 D 组。
 */

/**
 * remote 命名空间。
 * ★★ 注意语义：这是**网关逻辑命名空间**（由**场地插件**注册），
 *   **不是**"智囊团在调场地插件"。见文件头那段架构说明。
 */
export const REMOTE_NS = 'kaipu'

/** 调用通道（宿主网关的逻辑通道名）—— ★ 永不进真实 URL */
export const REMOTE_CHANNEL = '/api'

/** 宿主网关服务键（DSH 的 wire root 服务） */
export const CONNECTION_SERVICE = 'connection'

/**
 * ★★ 智囊团**只用这两个端点** —— 这份清单**故意写窄**。
 *
 * 为什么窄：智囊团只做"这群谋士（组织与资历）"，**不看运行过程**
 * （那是场地面板 `RightPane` 的活）。⇒ 它只需要"有哪些场景 / 谁在灯位上"。
 * `startRun` / `pollRun` **不要** —— 智囊团不发起会商（发起在地面板）。
 *
 * ★ 这条窄清单本身就是一条**设计纪律**：若哪天有人想在这里加 `startRun`，
 *   他应该先回答"智囊团为什么要发起会商"—— 大概率答案是"不该"。
 */
export const ENDPOINTS = {
  /** 接没接上（第一件要知道的事）。★ 用它拿 `server.baseUrl` / 数据源状态 */
  status: 'status',
  /** 场景目录（灯位数据的**唯一来源**：`scenes[].lamps`） */
  listScenes: 'listScenes',
  /** 执行方目录（灯位**状态判定**的唯一来源：`agents[].status`） */
  listAgents: 'listAgents',
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
    call(channel: string, endpoint: string, payload: unknown, signal?: unknown): Promise<unknown>
  }
}

/** 依赖取用的最小 ctx 形状（cordis 的两种取法：`ctx.get(name)` / `ctx.name`） */
export interface ClientCtxLike {
  get?: (name: string) => unknown
}

/**
 * 从 cordis ctx 取 `connection`。
 * ★ 两种取法都试（实测不同版本/装配时序表现不一致）⇒ **取到哪个用哪个，不要赌**。
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

   ┌ 第 1 层：**网关层**  `{ ok, value } | { ok:false, error:{code,message} }`
   │   失败 = 端点不存在 / 参数不合规 / host 方法抛异常 / 传输断
   │   ⇒ 客户端**无法**用业务错误码解释它，只能如实说"路没通"
   └ 第 2 层：**业务层**  `RemoteResult<T>`（host 方法的返回值）
       失败 = "路通了，但服务端说不行"（未授权 / 超时 / 404 …）
       ⇒ 这一层才带业务 `code`
*/

interface GatewayResult {
  ok?: boolean
  value?: unknown
  error?: { code?: string; message?: string }
  /** ★ 宿主网关"路径不存在"时用的是这组键（服务端指南 v2 §三 实测形态）——
   *  与上面的 `ok`/`error` **不是同一套**，两种都要认（见下方分支）。 */
  success?: boolean
  message?: string
}

/** 网关层 / 传输层错误（**没有**业务 code） */
export interface BridgeError {
  kind: 'gateway' | 'unreachable'
  /** 机器可读（网关层的码，**不是**业务错误码） */
  code: string
  /** 诊断用原文（★ **不上屏**） */
  detail: string
}

/** host 侧业务错（第 2 层）—— 这一层才带契约的业务 `code` */
export interface BusinessErr {
  code: string
  /** host 已翻译过一次；客户端**仍要按 code 再翻一次**（以契约文案为准） */
  message: string
}

export type BridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: BridgeError }
  | { ok: false; business: BusinessErr }

/**
 * 调一个 host 端点。
 *
 * @param conn   connection 服务
 * @param method host 方法名（**不带**命名空间）
 * @param query  业务参数（host 方法第一个参数的实参）
 * @param signal 取消信号（**可选**）
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
    const detail = e instanceof Error ? e.message : String(e)
    // ★★ HTTP 404 不是「连不上」—— 网关**应答了**，只是说"没有这条路由"。
    //   本项目里 404 有**两个来源**，别混：
    //
    //   ① **网关无此命名空间**（`kaipu` 上没有 service 注册）
    //      —— 典型：场地插件未安装/未加载成功 ⇒ 这里归 gateway/not_found ⇒ `stale`，
    //      出路文案指"查插件装载"。**这是本 catch 块要处理的那一种。**
    //   ② **URL 拼串错**（如报文里出现 `/api/kaipu/status` —— `api` 是通道名、
    //      `kaipu` 是命名空间，**都不该出现在 HTTP URL 里**）⇒ 那是**我方客户端 bug**，
    //      症状同样是 404，但出路是"改 baseUrl/拼串"，**不是查插件**。
    //   ⇒ 分不清就按 ① 报（fail-closed：宁可提示"查装载"，也不谎报"接上了"）；
    //     若发现 detail 里带 `/api/` 段（②的指纹），说明是我方拼串问题，别赖服务端。
    //
    //   真机验收抓到的形状（2026-10-06）：
    //   connection client 把网关 404 抛成 "transport failure for /api/kaipu/status: HTTP 404"。
    if (/\b404\b/.test(detail)) {
      return { ok: false, error: { kind: 'gateway', code: 'not_found', detail } }
    }
    return {
      ok: false,
      error: { kind: 'unreachable', code: 'transport', detail },
    }
  }

  const gw = raw as GatewayResult | undefined
  if (gw === null || typeof gw !== 'object') {
    return { ok: false, error: { kind: 'gateway', code: 'bad_result', detail: '网关返回体为空' } }
  }
  if (gw.ok !== true) {
    // ★★ 网关**另一种** 404 形状（服务端指南 v2 §三「404 有两种」实测形态）：
    //   宿主网关路径不存在时回的是 `{success:false, message:"路径不存在: /api/kaipu/status"}`
    //   —— 注意它用的是 **`success`/`message`**，与上面声明的 `ok`/`error` **不是同一套键**。
    //   若不识别，`gw.error?.code` 取到 undefined ⇒ 归成 `code:'gateway'` ⇒
    //   `looksLikeMissingEndpoint` 匹配不上 ⇒ 落到 `unreachable`「未连上」、
    //   原因只剩泛泛的"网关调用失败"，**出路指错方向**（该查接入地址却让人查网络）。
    //   ⇒ 这里按 v2 的纪律补一条：**先问"这个串是谁拼的"**，认出来就归 not_found。
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

  // 第 2 层：`value` 就是 host 方法的返回值（业务信封）
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
