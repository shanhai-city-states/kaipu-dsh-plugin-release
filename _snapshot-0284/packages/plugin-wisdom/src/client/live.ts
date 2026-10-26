/**
 * 山海·开铺 · 智囊团插件 · client half —— **数据源层**
 * =====================================================================
 * 面板只认这一层，**不关心数据从哪来**。与场地侧 `live.ts` **同构但独立**
 * （不 import）—— 它读的是**同一批数据**，但**问的问题不一样**：
 *
 *   场地面板问：「**这一次**会商跑到哪了」（面向过程 · 时间尺度 = 一场）
 *   智囊团面板问：「**这群谋士**是谁 · 服务哪些场子」（面向组织 · 时间尺度 = 跨场）
 *
 * ★ 所以本文件**只取组织面**的字段：`lamps[].lamp` / `agentId` / `agentName`
 *   ＋ `agents[].status`。**不取** SSE、不取运行结果、不取 usage ——
 *   那些是场地面板的活，取来就是"两个面板管同一件事"（已否掉）。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 数据源是**显式四态**，绝不悄悄回落
 * ══════════════════════════════════════════════════════════════════
 *   · `live`         真服务端，读到了
 *   · `unreachable`  想连真服务端但没连上（★ **如实说**，不换成演示数据）
 *   · `no_channel`   连通道都没取到（**环境问题**，与"服务端故障"是两件事）
 *   · `stale`        ★ **本轮新增** —— 见下
 *
 * **★ 为什么还多一个 `stale`（这是本轮实测挖出来的，不是设计出来凑数的）**：
 *
 *   智囊团面板**依赖场地插件在场**（端点由场地插件注册，见 `bridge.ts` 文件头）。
 *   若场地插件被摘掉 / 未加载，网关上就没有 `kaipu/*` 这些端点 ⇒
 *   rpc 会回"端点不存在"。
 *
 *   ⚠️ **这种情况绝不能显成「5 灯位 · 5 待接入」** ——
 *   那是把「我读不到」伪装成「你这里没人」，**编造了一个不存在的事实**
 *   （与 `pending` 被误显成「已停用」是**同一类错**：都是拿"保守"当借口编事实）。
 *
 *   ⇒ 单独立一态，界面措辞明确区分：
 *      「**读不到**灯位数据（通道未就绪）」≠「灯位**都空着**」。
 *     ★ 自检：把这两句话念一遍 —— 一句是"我这边有问题"，一句是"你这边没人"，
 *       **用户的下一步动作完全不同**（去查插件 vs 去接 Agent）。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 兜底点清单（纪律承场地侧 `live.ts`：**每加一处兜底，必须注明谁看护它**）
 * ══════════════════════════════════════════════════════════════════
 *
 *   那条纪律的原文：**「兼容读法能防崩，不能防错 —— 凡提供兼容/兜底路径的字段，
 *   必须同时给一条『陌生形状必须报错』的判据。」**
 *
 *   | 兜底点 | 陌生/缺失输入怎么办 | 谁看护 |
 *   |:--|:--|:--|
 *   | `normalizeLamp.agentId` | 查不到 id ⇒ 按**未登记** | ✅ 探针：真服务端 5 条 `agentId` 都能在 `/agents` 里找到 |
 *   | `toLampState.status` | 未知值 ⇒ `pending`（**不编 `disabled`**） | ✅ 探针：`agents[].status` 取值都在契约三值内 |
 *   | `sceneOf` 反查 | 场景缺失 ⇒ 该灯位**无归属**（不编场景名） | ✅ 探针：每个灯位至少属于 1 个场景 |
 *
 *   ★ 三者**全部是 fail-closed 方向**：宁可说"还没接入 / 不知道"，
 *     不可说"已接入 / 有人关掉了" —— 后者会**编造一个不存在的决定**。
 */
import type { AgentCard, SceneCard } from '@shanhai/kaipu-contract'
import { callKaipu, type BridgeError, type BridgeResult, type ConnectionHandle } from './bridge.js'

/* ══════════════════════════════════════════════════════════════════
   一、连接句柄（模块级单例 —— 由 `index.ts` 的 apply 注入）
   ══════════════════════════════════════════════════════════════════
 * ★ 为什么放模块级：面板组件在 slot 里渲染，**拿不到插件的 cordis ctx**。
 *   `apply()` 时取到 connection 存这里，面板读这里 —— 与场地侧同款做法。
 * ★ 未注入（取不到 connection 服务）时保持 null：面板显示"通道不可用"，
 *   这是**环境问题**，不是业务错误，措辞要分开。
 */
let connection: ConnectionHandle | null = null

export function setConnection(conn: ConnectionHandle | null): void {
  connection = conn
}

export function hasConnection(): boolean {
  return connection !== null
}

/* ══════════════════════════════════════════════════════════════════
   二、灯位状态 —— ★★ 本插件**唯一的语义核心**
   ══════════════════════════════════════════════════════════════════ */

/**
 * 一个灯位在"**有没有人**"这件事上的状态。
 *
 * ★★ 三值**不是**三态 UI，是**三段不同的事实**（这是裁定的落点）：
 *
 *   | 值 | 含义 | 界面（灯位行） | 界面（状态带汇总） |
 *   |:--|:--|:--|:--|
 *   | `vacant`     | `agentId === null` —— **这个位子空着** | 「—」 | 「N 未登记」 |
 *   | `registered` | `agentId` 有值但该 Agent `status='pending'` —— **有人了，还没上线** | 「待接入」 | 「M 已登记待启用」 |
 *   | `ready`      | `agentId` 有值且 `status='enabled'` | 「已就绪」 | （计入在位） |
 *
 * ★★ **状态带区分的准确读法**（这一条极易读错，我把边界写死在这里）：
 *
 *   裁定原文：「**Q1=a，状态带内部区分已登记/未登记**」。
 *
 *   · 「Q1=a」 ⇒ **灯位行**显示仍用「**待接入**」（保守：没上线 ≈ 用户拿不到服务）
 *     ⇒ 所以 `registered` 与 `vacant` **在灯位行上的文案相同**。
 *   · 「状态带内部区分已登记/未登记」 ⇒ 区分发生在**①状态带的汇总层**
 *     （如「5 灯位 · 5 已登记待启用 · 0 未登记」），
 *     **不在每行文案上区分**（否则就变成 Q1=b 了，与裁定矛盾）。
 *
 *   ⇒ 所以本类型**必须保留三值**（否则状态带的"区分"没有数据来源），
 *     但**灯位行的渲染**要把 `vacant` 与 `registered` **显成同一句「待接入」**。
 *     ★ 这两件事**互不矛盾**，是实现时最容易搞混的一处 —— 写在这里当路标。
 *
 * ★ `disabled` 归哪：**不算"有人可用"**，但也**不是"待接入"**。
 *   它是"有人把它关掉了"（一个确定的决定）。
 *   ⚠️ 契约目前**没有**独立的显示口径给我们（Q1 只裁了 pending）。
 *   ⇒ 本期**不擅自编第五句文案**：归入 `registered`（"有归属、当前不可用"），
 *     但**在悬停提示里如实写出「已停用」**——不藏事实，也不编新词。
 *     ★ 若将来要独立的行文案，那是一次**新的口径裁定**（记进下方 `OPEN`）。
 */
export type LampState = 'vacant' | 'registered' | 'ready'

/** 一个灯位 —— 智囊团面板的全部业务数据就是这个数组 */
export interface LampSeat {
  /** 维度名（如「战略维度」）—— 实测来自 `scenes[].lamps[].lamp` */
  lamp: string
  state: LampState
  /**
   * ★ 权威字段（契约 §23.3）—— 界面**只按它判定**，`agentName` 只做显示。
   *
   * ⚠️ 注意 `null` 的语义：权威字段为 null **或**该 id 在 `/agents` 里查不到
   *   ⇒ 都归 `vacant`（fail-closed：宁可说"还没接入"）。
   *   为什么查不到也算 vacant：说明服务端给的 id 在 `/agents` 里没有对应条目，
   *   我们**无法证明**这个位子有人 ⇒ 不编。
   */
  agentId: string | null
  /** 显示用名字（`vacant` 时为 null） */
  agentName: string | null
  /**
   * ★ 该执行方在 `/agents` 里的原始状态（`vacant` 时为 null）。
   *   为什么留着：悬停提示要**如实**给出 `disabled` 这类实情
   *   （行文案可能同形，但提示里不说假话）。
   */
  rawStatus: AgentCard['status'] | null
  /**
   * ★ 这个灯位服务于**哪些场景**（场景 `label` 数组）—— 见 §四 反查。
   *   空数组 = 反查不到 ⇒ 界面**不编场景名**，如实说"未在场景中使用"。
   */
  scenes: string[]
}

/* ══════════════════════════════════════════════════════════════════
   三、快照
   ══════════════════════════════════════════════════════════════════ */

/** 数据源状态（★ 四态严格分开，见文件头） */
export type SourceKind =
  /** 真服务端，读到了 */
  | 'live'
  /** 想连真服务端但没连上（★ 如实说） */
  | 'unreachable'
  /** 连通道都没取到（环境问题） */
  | 'no_channel'
  /** ★ 通道在，但**读不到灯位数据**（常见原因：场地插件不在场，端点未注册） */
  | 'stale'

export interface Snapshot {
  kind: SourceKind
  /** 状态带上挂的来源标签 */
  label: string
  /** 读不到时的原因（**已翻译**，不上屏技术原文） */
  reason: string | null
  /** 灯位（`live` 时才有值；其余情况**一律空数组**，绝不填演示数据） */
  lamps: LampSeat[]
  /**
   * 场景清单（`label` + 它用到的灯位名）—— §四 反查的原料。
   * `live` 外一律空。
   */
  scenes: { label: string; lamps: string[] }[]
  /** 服务端自报（`live` 才有） */
  server: { baseUrl: string; accountId: string } | null
}

/* ══════════════════════════════════════════════════════════════════
   四、形状映射（服务端实测形状 → 面板形状）
   ══════════════════════════════════════════════════════════════════ */

/** `GET /agents` 单条（**只声明用得到的**，其余忽略 —— 智囊团不关心 capabilities 详情） */
interface AgentWire {
  id: string
  name?: string
  status?: string
}

/** `GET /scenes` 单条（**只声明用得到的**） */
interface SceneWire {
  scene: string
  label?: string
  /** ★ 联合形状（新 = 对象数组 · 老 = 字符串数组）—— 与场地侧 `SceneLampsWire` 同源 */
  lamps?: readonly (string | { lamp?: string; agentId?: string | null; agentName?: string | null })[]
  lampNames?: readonly string[]
}

/**
 * `status` 的收敛规则 —— ★★ **不编 `disabled`**。
 *
 * 与场地侧 `toAgentStatus` **同一条取向**（那是被真服务端实测抓出来修的）：
 *   · `disabled` = 某人把这位子**关掉了**（一个确定的决定）
 *   · `pending`  = 这位子**还没人接**（正常态）
 *   两者给用户的下一步动作完全不同（"去问为什么关掉" vs "去接入"）。
 *
 * ⇒ 契约外的未知值**归 `pending`**（"状态未明"最接近实情），
 *   **不归 `disabled`** —— 那是在断言"有人关掉了它"，而我们并不知道。
 *   一句话：**宁可说不知道，不可编原因。**
 */
function toRawStatus(s: string | undefined): AgentCard['status'] {
  if (s === 'enabled') return 'enabled'
  if (s === 'disabled') return 'disabled'
  return 'pending'
}

/**
 * ★★ 归一化：一个原始灯位 → `LampSeat`。**这是本文件唯一的判定入口。**
 *
 * 判定链（顺序不能颠倒）：
 *   ① 该 lamp 的 `agentId`
 *      · 为 null / undefined ⇒ `vacant`
 *   ② 该 id 在 `/agents` 里查不到 ⇒ `vacant`（**fail-closed**：无法证明有人）
 *   ③ 查到了，看它的 `status`
 *      · `pending`  ⇒ `registered`（有人，未上线）
 *      · `disabled` ⇒ `registered`（有人，被关掉）—— 行文案同期不区分，提示里如实写
 *      · `enabled`  ⇒ `ready`
 *
 * ★ 为什么 `disabled` 不进 `ready`：`ready` 在界面上的意思是"这个位子**能干活**"。
 *   被停用的 Agent 显然不能 ⇒ 绝不进。
 *   为什么也不进 `vacant`：`vacant` 的意思是"**这个位子空着**"，
 *   而被停用的位子是"**有人占着、但被关掉了**" —— 说成"空着"就是**编事实**。
 */
function normalizeLamp(
  lamp: string,
  agentId: string | null,
  agentName: string | null,
  byId: Map<string, AgentCard>,
): LampSeat {
  if (agentId === null) {
    return { lamp, state: 'vacant', agentId: null, agentName: null, rawStatus: null, scenes: [] }
  }
  const a = byId.get(agentId)
  if (a === undefined) {
    // 查不到 ⇒ 无法证明这个位子有人 ⇒ vacant（fail-closed）
    // ★ 但**保留原始 agentId 到调用方日志**是没必要的（不上屏）—— 界面显"待接入"即可
    return { lamp, state: 'vacant', agentId: null, agentName: null, rawStatus: null, scenes: [] }
  }
  const state: LampState = a.status === 'enabled' ? 'ready' : 'registered'
  return {
    lamp,
    state,
    agentId: a.id,
    // ★ 显示名**优先用灯位自己给的**（服务端可能按场景定制），退回 Agent 卡片的 name
    agentName: agentName ?? a.name ?? a.id,
    rawStatus: a.status,
    scenes: [],
  }
}

/**
 * 从一个场景里取出「灯位名 × agentId × agentName」三元组。
 *
 * ★ 为什么要吃**两种形状**（对象数组 / 字符串数组）：
 *   服务端 2026-10-06 已按契约 §23.3 升格为对象数组，并**同时**给 `lampNames`
 *   （老形状 · 逐字相同）⇒ 两种都可能出现。
 *
 * ⚠️ 字符串形状**没有 agentId** ⇒ 只能当"一个纯维度名"处理
 *   （即视作 `agentId: null`）。**不靠 role 猜执行方** ——
 *   场地侧在这条上踩过坑（`mapLamps` 靠 role 猜，服务端改形状后静默退化成"全部待接入"，
 *   而那次的**结果碰巧是对的**，所以没被发现）。
 *   ⇒ 智囊团这边**直接不猜**：字符串形状 = 该场景只是列了维度名，无执行方信息。
 */
function lampTriplesOf(
  s: SceneWire,
): { lamp: string; agentId: string | null; agentName: string | null }[] {
  const out: { lamp: string; agentId: string | null; agentName: string | null }[] = []
  const raw = s.lamps
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        if (item !== '') out.push({ lamp: item, agentId: null, agentName: null })
        continue
      }
      if (item === null || typeof item !== 'object') continue
      const lamp = typeof item.lamp === 'string' ? item.lamp : ''
      if (lamp === '') continue
      out.push({
        lamp,
        agentId: typeof item.agentId === 'string' && item.agentId !== '' ? item.agentId : null,
        agentName: typeof item.agentName === 'string' && item.agentName !== '' ? item.agentName : null,
      })
    }
    return out
  }
  // 老形状：只有维度名
  if (Array.isArray(s.lampNames)) {
    for (const n of s.lampNames) {
      if (typeof n === 'string' && n !== '') out.push({ lamp: n, agentId: null, agentName: null })
    }
  }
  return out
}

/**
 * 把「场景列表 + 执行方列表」归一成**灯位清单**。
 *
 * ★★ 合并策略：**以灯位名去重，跨场景合并**。
 *
 *   为什么按名字合并：**同一个维度名在多场景里出现是常态**
 *   （实测：`战略维度` 出现在 `multi-dim-review`，很可能将来也出现在别的场景）。
 *   而智囊团问的是"**这个位子上是谁**" —— 同名的位子就是同一个位子。
 *
 *   ⚠️ **一个必须说清的边界**：若服务端在不同场景给**同名灯位配了不同 agentId**，
 *   本实现以**最后一个**为准（Map 覆盖），并且**不报错**。
 *   ⇒ 这是有意的吗？**不是** —— 这是"现在拿不到证据"时的**最简处理**。
 *     已登记为待确认（见下方 `OPEN`），并**由探针看护**：
 *     探针会断言"同名灯位在多场景里的 agentId 一致"，一旦不一致就 FAIL。
 *     ★ 那条断言现在**可能因为数据里只有 1 个场景用到该灯位而恒真** ——
 *       所以它标为"**暂不构成证据**"，等真有跨场景同名的样本才升级为硬判据。
 */
function buildLamps(scenes: readonly SceneWire[], agents: readonly AgentCard[]): LampSeat[] {
  const byId = new Map<string, AgentCard>()
  for (const a of agents) byId.set(a.id, a)

  const lamps = new Map<string, LampSeat>()
  const sceneOf = new Map<string, string[]>()

  for (const s of scenes) {
    const label = typeof s.label === 'string' && s.label !== '' ? s.label : s.scene
    for (const t of lampTriplesOf(s)) {
      lamps.set(t.lamp, normalizeLamp(t.lamp, t.agentId, t.agentName, byId))
      const list = sceneOf.get(t.lamp) ?? []
      if (!list.includes(label)) list.push(label)
      sceneOf.set(t.lamp, list)
    }
  }

  // §四 反查：把"服务于哪些场景"贴回每个灯位（★ 空数组 = 反查不到，界面不编场景名）
  for (const [name, l] of lamps) {
    lamps.set(name, { ...l, scenes: sceneOf.get(name) ?? [] })
  }
  return [...lamps.values()]
}

/* ══════════════════════════════════════════════════════════════════
   五、加载
   ══════════════════════════════════════════════════════════════════ */

const p = (r: BridgeResult<unknown>): string =>
  r.ok === true ? '' : 'business' in r ? r.business.message : r.error.detail

/**
 * ★★ 读不到 ⇒ 返回**空 + 原因**，**绝不填演示数据**。
 *
 * 这条是场地侧被 `live-probe --expect=unreachable` **当场抓到的真缺陷**
 * （第一版失败分支写 `{ ...mockSnapshot(), kind:'unreachable' }` ⇒
 *  界面出现最坏组合：**状态条说「未接入」，左边却摆着 5 个演示场景**）。
 * ⇒ 现在一律返回空列表，原因写在状态带里。
 *
 * ★ 另外：这里的文案是**上屏文本**，不许带 markdown 记号
 *   （场地侧第一版把 `**…**` 直接印在了界面上）。
 */
function offlineSnapshot(kind: SourceKind, label: string, reason: string): Snapshot {
  return { kind, label, reason, lamps: [], scenes: [], server: null }
}

/**
 * 判断一个失败**是不是"端点不存在"** —— 这是 `stale` 态的触发条件。
 *
 * ★ 为什么要专门识别它：端点不存在 = **场地插件不在场**（或没加载成功），
 *   这是**环境问题**，与"服务端连不上"是两件不同的事，
 *   用户的下一步动作也不同（去查插件装载 vs 去查网络/地址）。
 *
 * ★ 判据来源：网关层（第 1 层）的 `error.code`。
 *   ⚠️ 具体的码名由 DSH 网关定义，我这里**按"包含/等于"宽容匹配**，
 *   因为**锁死一个精确码名**的风险是把未来网关改名误判成"服务端故障"——
 *   而那个误判方向会让用户去查错的地方。
 *   若匹配不上 ⇒ 退回 `unreachable`（**更宽的那一类**，不会漏报问题）。
 */
function looksLikeMissingEndpoint(err: BridgeError): boolean {
  if (err.kind !== 'gateway') return false
  const s = `${err.code} ${err.detail}`.toLowerCase()
  return (
    s.includes('not_found') ||
    s.includes('notfound') ||
    s.includes('no_handler') ||
    s.includes('no handler') ||
    s.includes('unknown_endpoint') ||
    s.includes('unknown endpoint') ||
    s.includes('endpoint_not_found') ||
    s.includes('路径不存在')
  )
}

/** 读真服务端。**任何一步失败都如实返回，不回落到 mock** */
export async function loadLive(signal?: AbortSignal): Promise<Snapshot> {
  if (connection === null) {
    return offlineSnapshot(
      'no_channel',
      '通道不可用',
      '没取到宿主的数据通道。这是环境问题，不是服务端故障。',
    )
  }

  /* ── ① 先问"接没接上" ── */
  const st = await callKaipu<{ connected: boolean; baseUrl: string; accountId: string }>(
    connection,
    'status',
    {},
    signal,
  )
  if (st.ok !== true) {
    // ★ 这一步失败最常见的原因**不是**服务端挂了，而是**场地插件不在场**（端点未注册）
    if (!('business' in st) && looksLikeMissingEndpoint(st.error)) {
      // ★ 但 404 有两个来源（见 bridge.ts 与**服务端指南 v2 §三「404 有两种」**）：
      //   先看是否带"我方拼串"指纹 —— 报文里出现 `/api/<ns>/…` 段，或宿主网关那句
      //   「路径不存在: …」（`api` 是通道名、`kaipu` 是命名空间，**都不该进 HTTP URL**），
      //   那是我方接入地址/拼串的问题，出路**不是**查插件装载。如实分开说。
      const ownBug = /\/api\//.test(st.error.detail) || /路径不存在/.test(st.error.detail)
      return offlineSnapshot(
        'stale',
        '灯位数据读不到',
        ownBug
          ? '接入地址不对 —— 数据通道没有被正确寻址（路径里混入了内部通道段），请核对「开铺」场地插件的接入地址配置。'
          : '数据通道未就绪 —— 灯位数据由「开铺」场地插件提供，它可能未安装或未加载成功。',
      )
    }
    return offlineSnapshot('unreachable', '未连上', p(st))
  }
  if (!st.data.connected) {
    return offlineSnapshot(
      'unreachable',
      '未接入（本地模式）',
      '还没配接入地址。填上服务端地址即可接入 —— 未接入不是故障。',
    )
  }

  /* ── ② 取灯位原料（场景 + 执行方） ── */
  const [sc, ag] = await Promise.all([
    callKaipu<{ scenes: SceneWire[] }>(connection, 'listScenes', {}, signal),
    callKaipu<{ agents: AgentWire[] }>(connection, 'listAgents', {}, signal),
  ])
  if (sc.ok !== true) {
    if (!('business' in sc) && looksLikeMissingEndpoint(sc.error)) {
      return offlineSnapshot('stale', '灯位数据读不到', '读场景失败：数据通道未就绪。')
    }
    return offlineSnapshot('unreachable', '读场景失败', p(sc))
  }
  if (ag.ok !== true) {
    if (!('business' in ag) && looksLikeMissingEndpoint(ag.error)) {
      return offlineSnapshot('stale', '灯位数据读不到', '读执行方失败：数据通道未就绪。')
    }
    return offlineSnapshot('unreachable', '读执行方失败', p(ag))
  }

  const agents: AgentCard[] = (ag.data.agents ?? []).map((a) => ({
    id: a.id,
    slug: a.id,
    name: a.name ?? a.id,
    role: '',
    capabilities: [],
    skillSummary: '',
    status: toRawStatus(a.status),
    version: 0,
  }))
  const scenes = sc.data.scenes ?? []

  return {
    kind: 'live',
    label: '已接入',
    reason: null,
    lamps: buildLamps(scenes, agents),
    scenes: scenes.map((s) => ({
      label: typeof s.label === 'string' && s.label !== '' ? s.label : s.scene,
      lamps: lampTriplesOf(s).map((t) => t.lamp),
    })),
    server: { baseUrl: st.data.baseUrl, accountId: st.data.accountId },
  }
}

/**
 * ★ 灯位行的**状态文案**。
 *
 * | state | 文案 | 依据 |
 * |:--|:--|:--|
 * | `vacant` | 「待接入」 | 位子空着 |
 * | `registered` | 「待接入」 | ★ **Q1=a** —— 保守，与 vacant 同形 |
 * | `ready` | 「已就绪」 | 在位可用 |
 *
 * ★★ **为什么这个纯函数住在 `live.ts`（数据层）而不是 `WisdomPanel.tsx`（界面层）**：
 *   判据要断言"Q1=a 的两面同时成立"：
 *     · 行文案上 `vacant` 与 `registered` **同形**
 *     · 汇总文案上两者**不同形**
 *   若它住在 tsx 里，判据 import 产物时会**连带 require react**
 *   ⇒ 判据要么起浏览器（慢、样本受限），要么 mock 一个 react（**测的是 mock**）。
 *   ⇒ 放这里，判据能**直接调真函数**。
 *
 *   ★ 这是一条**可推广的分层纪律**：
 *     **"可被断言的纯逻辑"不放在需要框架运行时的文件里。**
 *     它与本项目"判据必须调被测代码本身"那条纪律是配套的 ——
 *     光有"要测真代码"的意愿，若代码住在框架文件里，最后还是只能 mock。
 */
export function lampText(seat: LampSeat): string {
  return seat.state === 'ready' ? '已就绪' : '待接入'
}

/* ══════════════════════════════════════════════════════════════════
   六、★ 状态带汇总 —— 裁定的**唯一落点**
   ══════════════════════════════════════════════════════════════════ */

export interface LampSummary {
  /** 灯位总数 */
  total: number
  /**
   * ★ **未登记** —— `agentId` 为空（或查不到）的灯位数。
   *   语义："这个位子**还没有人**"。
   */
  vacant: number
  /**
   * ★ **已登记待启用** —— 有 `agentId` 且该 Agent `status !== 'enabled'` 的灯位数。
   *   语义："**有人了**，但还没上线"。
   *
   * ★★ 这个数**必须单独出来**，它是「状态带内部区分已登记/未登记」的**全部意义**。
   *   —— 灯位行上两者都显「待接入」（Q1=a 的保守面），
   *      但汇总层要把它们**分开报**，否则"内部区分"就无处落地了。
   */
  registered: number
  /** 已在位可用（`status='enabled'`） */
  ready: number
}

/**
 * 汇总。★ 纯函数，便于单独断言（判据会喂构造样本）。
 *
 * ★ 三条不变式（断言用，写完代码立刻自查一遍）：
 *   · `vacant + registered + ready === total`
 *   · 各值 >= 0
 *   · 空数组 ⇒ 全 0（**不是**"5 个待接入"—— 那要靠 `kind !== 'live'` 区分，见文件头）
 */
export function summarize(lamps: readonly LampSeat[]): LampSummary {
  let vacant = 0
  let registered = 0
  let ready = 0
  for (const l of lamps) {
    if (l.state === 'vacant') vacant++
    else if (l.state === 'registered') registered++
    else ready++
  }
  return { total: lamps.length, vacant, registered, ready }
}

/**
 * ★ 状态带的**文案** —— 独立成纯函数，因为它是该裁定的**可断言面**。
 *
 * 形态：`已接入 · 5 灯位 · 5 已登记待启用`
 *   · 有 `ready` 时加 `N 在位`
 *   · 有 `vacant` 时加 `N 未登记`（**橙** —— 那是真的"还缺人"）
 *   · 全空（total=0 且 live）⇒ `暂无灯位`（★ 与"5 个待接入"**绝不同形**）
 *
 * ★★ 为什么 `registered` 与 `vacant` **都要显**（不能只显一个）：
 *   裁定要求"内部区分"，那就要**两句话都在场**才有"区分"可言。
 *   只显一个 = 没区分。
 */
export function summaryText(s: LampSummary): string {
  if (s.total === 0) return '暂无灯位'
  const parts: string[] = [`${s.total} 灯位`]
  if (s.ready > 0) parts.push(`${s.ready} 在位`)
  if (s.registered > 0) parts.push(`${s.registered} 已登记待启用`)
  if (s.vacant > 0) parts.push(`${s.vacant} 未登记`)
  return parts.join(' · ')
}

/* ══════════════════════════════════════════════════════════════════
   ★ 待确认（OPEN）—— 本轮**不擅自定**的点，记在这里免得忘
   ══════════════════════════════════════════════════════════════════
 *
 * · **`disabled` 的行文案**：本轮只裁了 `pending`。
 *   `disabled` 现在归入 `registered`，行文案同期显「待接入」，
 *   只在悬停提示里如实写「已停用」。
 *   ⇒ 若需要对它独立的行文案（如「已停用」），那是一次**新口径裁定**。
 *   ⚠️ 风险等级：低（当前真服务端 `disabled` 读数为 0）。
 *
 * · **同名灯位跨场景配不同 agentId**：现以**最后出现的**为准。
 *   探针有一条软断言看护（暂不构成证据，见 `buildLamps` 注释）。
 *   ⇒ 若真出现这种数据，需要一次**语义裁定**（同名灯位到底是不是同一个位子）。
 *
 * · **Q2（5 条灯是否共享同一 host Agent）**：★★ 待服务端一句话。
 *   ⇒ 本文件的数据结构**对这个答案不敏感**（`LampSeat` 逐灯位独立表达），
 *     区别只在**界面措辞**："一体五面" vs "五个空位"。
 *     ⇒ 答了之后**改一处文案**，不动结构（这正是已承诺的降级行为）。
 */
