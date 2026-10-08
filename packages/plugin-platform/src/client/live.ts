/**
 * 山海·开铺 · 场地插件 · client half —— **数据源层**（真服务端 / 演示数据）
 * =====================================================================
 * 面板只认这一层，**不关心数据从哪来**。两条来源：
 *
 *   · `live`   —— 经宿主通道读真服务端（`kaipu/status|connect|listScenes|listAgents`）
 *   · `mock`   —— 本地演示数据（设计评审用；**界面必须明示**）
 *
 * ★★ 为什么把"来源"做成**显式状态**，而不是"请求失败就回落 mock"：
 *   那是最坏的一种做法 —— **用户以为在看真结果，其实在看演示数据**。
 *   所以三者严格分开：`live` / `mock`（人工选的）/ `unreachable`（真连不上）。
 *   连不上时**如实说连不上**，不悄悄换成 mock。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 与真服务端对账时发现的三处形状差异（都**不改契约**，只做防御读法）
 * ══════════════════════════════════════════════════════════════════
 * 全部实测自 `GET /scenes`（2026-10-05）：
 *
 * ① ★★ **`scenes[].category` 与 `categories[].scenes` 自相矛盾**：
 *      `multi-dim-review` 一边被列入 `categories[standard_review].scenes`（count=1），
 *      一边自己的 `category` 是**空串**。
 *    ⇒ 本文件认同一个读法：**以 `categories[].scenes` 为权威**（它是显式的成员表、
 *      且自带 `count`），`scene.category` 只作**单场景的兜底**，两者都没有 ⇒ 未归类。
 *      理由：**冗余字段打架时，选信息量大的那个，并保证"内容不丢"**——
 *      按 `scene.category` 读会让「标准审查」这一组**直接消失**（组内空 ⇒ 我的
 *      `groupScenes` 会过滤掉空组），而那个场景被塞进「未归类」。
 *
 * ② ★★ **`scenes[].lamps` 已于 2026-10-06 升格为对象数组**（对方按契约 §23.3 落地）。
 *      对方**同时**给 `lampNames`（老形状 · 逐字相同）⇒ 老读法不必改。
 *      **本仓处理**：类型写成**联合**（两种都吃），并在 `mapLamps` 里**归一化** ——
 *      把"占位 / 待接入"一律收敛成 `agentId: null`，界面层只认这一种表达。
 *      ★ 权威字段是 `lamps[].agentId` ＋ `/agents[].status`，
 *        **不再靠 role 猜**（旧实现那样猜，见 `mapLamps` 注释里那段教训）。
 *
 * ③ **`categories[]` 多带 `scenes` / `count`**（本仓契约类型里没有这两个字段）。
 *    ⇒ 宿主侧 `CategoryView` 已按实测形状声明；传到 `LeftPane` 时按可选字段消费。
 */
import type { AgentCard, SceneCard, SceneCategory, SceneLamp, SceneRecommendation } from '@shanhai/kaipu-contract'
// ★ wire 形状现在住在契约包（那里有现成的双态产物机制：lib/ ESM 给 host、
//   lib-cjs/ CJS 给本 bundle 内联）—— 见包内 src/wire.ts 的说明。这里只 **import type**。
import type { AgentView, CategoryView, RecommendationView, SceneLampsWire, SceneView } from '@shanhai/kaipu-contract'
import { callKaipu, type BridgeResult, type ConnectionHandle } from './bridge.js'
import {
  DATA_SOURCE_LABEL,
  MOCK_AGENTS,
  MOCK_SCENE_CATEGORIES,
  MOCK_SCENE_RECOMMENDATIONS,
  MOCK_SCENES,
} from './mock/data.js'

/* ══════════════════════════════════════════════════════════════════
   一、连接句柄（模块级单例 —— 由 `index.ts` 的 apply 注入）
   ══════════════════════════════════════════════════════════════════
 * ★ 为什么放模块级：面板组件在 slot 里渲染，**拿不到插件的 cordis ctx**。
 *   `apply()` 时取到 connection 存这里，面板读这里 —— 同款做法。
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

/**
 * 取当前的通道句柄。
 *
 * ★ 为什么要开这个口子：`run.ts`（发起运行）走的是**同一条一元通道**
 *   （host 后台读 SSE、客户端轮询增量，见其文件头），它需要自己发请求 ——
 *   而连接是 `index.ts` 在 apply 期注入到**本模块**的。
 *   与其把连接再存一份（两个落点必然漂移），不如从唯一的持有者这里取。
 */
export function currentConnection(): ConnectionHandle | null {
  return connection
}

/* ══════════════════════════════════════════════════════════════════
   二、快照（面板一次性要的东西）
   ══════════════════════════════════════════════════════════════════ */

/** 面板能显示的数据源状态（★ 三者严格分开，见文件头） */
export type SourceKind =
  /** 真服务端，读到了 */
  | 'live'
  /** 人工选的演示数据 */
  | 'mock'
  /** 想连真服务端但没连上（★ 如实说，不悄悄换 mock） */
  | 'unreachable'
  /** 连通道都没取到（环境问题） */
  | 'no_channel'

export interface Snapshot {
  kind: SourceKind
  /** 界面顶部挂的来源标签（`null` = 不挂，仅 live 且正常时不挂？—— 挂，见纪律3） */
  label: string
  /** 连不上时的原因（**已翻译**；只在 unreachable/no_channel 时有值） */
  reason: string | null
  /** 服务端自报（live 才有） */
  server: {
    baseUrl: string
    accountId: string
    serverTime: string | null
    serverVersion: string | null
    agentsLoaded: number | null
    tenants: number | null
    fingerprintSource: string
    authError: string | null
  } | null
  agents: AgentCard[]
  scenes: SceneCard[]
  categories: SceneCategory[]
  recommendations: SceneRecommendation[]
  /** 铺子身份（live 才有）：`/me` 的 name / plan / features */
  account: { name: string; plan: string; features: Record<string, boolean>; creditsNote: string | null } | null
  /**
   * ★ 流程清单的**缓存状态**（2026-10-07 新增 · 对应该验收项：缓存策略生效）
   *
   * ★★ 为什么要有它：v2 要求「首次全量拉，之后用响应顶层 `updatedAt` 比对 ——
   *   不同则重拉，相同则用缓存」。**不做/做没做**必须能被看见，
   *   否则"缓存策略生效"就是一句无法核的话。
   *
   * ⚠️ **实测现状（2026-10-07）**：服务端**尚未下发 `updatedAt`** ⇒ `basis === 'absent'`。
   *   此时**退化为每次全量拉取**，且**必须如实标出来** ——
   *   见 `SnapshotCache.basis` 的三值注释。
   */
  cache: SnapshotCache
}

/**
 * 缓存状态。★ **三值分开表达**，因为"没走缓存"有**三种完全不同的原因**：
 *   ① `basis: 'absent'` —— **依据字段都没有**（`updatedAt` 未落）⇒ 机制不生效
 *   ② `basis: 'updatedAt'` + `hit: false` —— 依据在、但**值变了** ⇒ 正在重拉
 *   ③ `basis: 'updatedAt'` + `hit: true` —— 依据在、值没变 ⇒ 走缓存
 *
 * ★ 为什么不用一个 `boolean cacheHit`：那样会把 ① 和 ② 混成一句"没命中"，
 *   而用户/判据要问的是"**为什么**没命中" —— 是"服务端还没给依据"还是"清单真变了"。
 */
export interface SnapshotCache {
  hit: boolean
  /**
   * ★★ **四值**，每一值对应一种不同的处境（别压成 boolean）：
   *   · `'updatedAt'` —— 依据在（走正常比对）
   *   · `'absent'`    —— ★ **服务端还没给依据** ⇒ 退化为全量拉（**这是个待办**，对方落了就变）
   *   · `'n/a'`       —— ★ **本快照不来自己服务端**（演示数据 / 未接入）⇒ 机制**不适用**（不会变）
   *   · `null`        —— 还没取过（初始态）
   * ★ 为什么把 `absent` 与 `n/a` 分开：两者在界面上都是"没走缓存"，
   *   但一个是"**等对方**"、一个是"**本来就没这回事**" ——
   *   混在一起会让后来人**对着演示态去追服务端**（追一个不存在的东西）。
   */
  basis: 'updatedAt' | 'absent' | 'n/a' | null
  /** 本次响应里的 `updatedAt`（`basis === 'absent'` 时为 `null`） */
  updatedAt: string | null
  /**
   * ★★ 依据在、`updatedAt` 也没变，但**仍然没用缓存**的原因（`null` = 没有这回事）。
   *
   * 为什么会有这种情况：场景卡片里嵌着**执行方名**（`lamps[].agentName`），
   * 而执行方是**另一个接口**（`/agents`）来的 ⇒ **场景清单没变、执行方变了**时，
   * 若直接复用旧卡片，会显示**过期的执行方名**。
   * ⇒ 所以命中缓存**还要加一道**：执行方签名也得一致。
   * ★ 这条是我对自己写的"防它偷懒"：**缓存不许拿新鲜度换正确性**。
   */
  staleReason: string | null
}

/** 演示数据快照（面板的"设计评审"模式） */
export function mockSnapshot(): Snapshot {
  return {
    kind: 'mock',
    label: DATA_SOURCE_LABEL,
    reason: null,
    server: null,
    agents: [...MOCK_AGENTS],
    scenes: [...MOCK_SCENES],
    categories: MOCK_SCENE_CATEGORIES.map((c) => ({ ...c })),
    recommendations: MOCK_SCENE_RECOMMENDATIONS.map((r) => ({ ...r })),
    /**
     * ★ 演示数据**不走服务端** ⇒ 缓存机制在此**不适用**。
     * ★ 但**不能**把它标成 `basis: 'absent'` —— 那会把两种东西混为一谈：
     *   · `absent` = **服务端还没给依据**（是个待办，会变）
     *   · 这里的 `null` = **本快照根本不来自己服务端**（是设计如此，不会变）
     * ⇒ 用 `'n/a'` 单独表达第三态，免得将来有人看着演示态的 `absent` 去追服务端。
     */
    cache: { hit: false, basis: 'n/a', updatedAt: null, staleReason: '演示数据不过网，缓存机制不适用' },
    account: null,
  }
}

/* ══════════════════════════════════════════════════════════════════
   三、形状映射（服务端实测形状 → 面板/契约形状）

   ★★ 纪律（2026-10-06 立 · 来源是本仓自己踩的一个 bug · 已被对方采纳为方法论）：

     「**兼容读法能防崩，不能防错** —— 凡提供兼容/兜底路径的字段，
       必须同时给一条『**陌生形状必须报错**』的判据。」

   为什么会有这条：`mapLamps` 曾期望字符串数组、靠 `role` 猜执行方；
   服务端改回对象数组后，它把**对象**当 key 查表，恒 `undefined`
   ⇒ **静默退化成"全部待接入"**。而**那次结果碰巧是对的**（真服务端确实全待接入）
   ⇒ **没有任何判据发现它**。
   ⇒ 「不崩」不等于「对」：**静默吸收陌生形状，等于把错误藏起来**。

   ★ 下方是**本文件的兜底点清单**。
     **每加一处兜底，必须在同一行注明「谁看护它」** —— 没有看护的兜底 = 下一个 mapLamps。

   | 兜底点 | 陌生/缺失输入怎么办 | 谁看护 |
   |:--|:--|:--|
   | `toAgentStatus` | 未知值 → `pending`（静默） | ✅ 漂移探针：`agents[].status 取值都在契约内` |
   | `toOutputLevel` | 未知值 → `null`（**静默丢弃**） | ✅ 漂移探针：`recommendations[].outputLevel 值域` |
   | `toSceneCard.category` | 缺失 → `''` | ✅ 同探针：`每个 scene.category 非空` |
   | `mapLamps` | 形状联合 ＋ 查不到 id ⇒ 待接入 | ✅ **类型收紧（编译期即判据）** ＋ 同源断言 |
   | `loopPolicy ?? 1` / `version ?? 0` | 缺失 → 默认值 | ⚠️ **尚未配判据（已知缺口）** |

   ⚠️ 已知缺口如实记：`loopPolicy` / `version` 的默认值**没有判据看护**。
     风险等级低（缺省不改变语义、界面也不会因此说谎），但**按上面的纪律应当补** ——
     写在这里，免得下次又想不起来。
   ══════════════════════════════════════════════════════════════════ */

/**
 * 维度 → 执行方。★ **归一化的唯一入口**。
 *
 * ★★ 归一化成什么：**"这个执行位没有真人接"一律表达为 `agentId: null`**。
 *   理由：表达只有一种，界面层就不必知道"占位 id"这回事 ——
 *   `LeftPane` 的「待接入 N」就是 `agentId === null` 的计数，**它不需要改**。
 *
 * ★★ 2026-10-06 重写（原实现**方向是错的**，只是碰巧没出事）：
 *
 *   旧签名 `mapLamps(lamps: readonly string[], …)` 期望**字符串数组**，
 *   靠 `/agents[].role` 与 lamp 名精确匹配来**猜**执行方。
 *   而服务端已按契约 §23.3 把 `lamps` 升格成**对象数组** ⇒ 旧代码把**对象**当 key 查表，
 *   恒 `undefined` ⇒ 整个场景退化成"全部待接入"。
 *
 *   ★ 那次的**结果碰巧是对的**（真服务端当前确实每个执行位都待接入），所以没被发现。
 *     但**方向是错的**：一旦有真 Agent 接入，它**仍会报「待接入」** ——
 *     用户看到"这场戏缺人"，而实际不缺。
 *   ⇒ 教训：**"双兼容读法"能防崩，不能防错**。吃到陌生形状时**必须走对分支**，
 *     不能"不崩就算过"。
 *
 *   现在有两个**权威字段**（不必再猜）：
 *     · `lamps[].agentId` —— 与 `lamp_start.agent` 同源
 *     · `/agents[].status` —— `pending` ⇒ 占位条目（占地未接入）
 *
 * ★ `disabled` 在这条里算什么：**不算"待接入"**（那是"有人关掉了"，另一回事）。
 *   但**也不该当成可用执行方**。这里只在"**有没有真人接**"这一个维度上判定，
 *   「已停用」由左栏的三态显示单独表达 —— 两件事分开表达，不互相顶替。
 */
function mapLamps(lamps: SceneLampsWire, agents: readonly AgentView[]): SceneLamp[] {
  const byId = new Map<string, AgentView>()
  for (const a of agents) byId.set(a.id, a)

  return lamps.map((raw) => {
    // ── 新形状（对象 · 契约 §23.3）⇒ `agentId` 是**权威** ──
    if (typeof raw !== 'string') {
      const id = raw.agentId ?? null
      const a = id === null ? undefined : byId.get(id)
      // 查不到该 id ⇒ 按待接入（**fail-closed**：宁可说"还没接入"，
      // 不可说"已接入" —— 后者会让人以为这一个审核面已经审过了）
      const vacant = id === null || a === undefined || a.status === 'pending'
      return {
        lamp: raw.lamp,
        // ★ 占位 id **不往界面传**：收敛成 null（见函数头）
        agentId: vacant ? null : id,
        agentName: vacant ? null : (raw.agentName ?? a?.name ?? null),
      }
    }
    // ── 老形状（字符串）⇒ 只能靠 role 猜（最后兜底；对方给的 `lampNames` 走这条） ──
    const hit = agents.find((x) => x.role === raw)
    if (hit === undefined || hit.status === 'pending') {
      return { lamp: raw, agentId: null, agentName: null }
    }
    return { lamp: raw, agentId: hit.id, agentName: hit.name }
  })
}

function toSceneCard(s: SceneView, agents: readonly AgentView[]): SceneCard {
  return {
    scene: s.scene,
    label: s.label,
    version: s.version,
    lamps: mapLamps(s.lamps, agents),
    loopPolicy: {
      maxLoop: s.loopPolicy.maxLoop ?? 1,
      maxGlobalLoops: s.loopPolicy.maxGlobalLoops ?? 1,
    },
    requiresExternal: s.requiresExternal === true,
    // ★ 2026-10-06 新增字段：执行位承担方快照（服务端按契约 §23.3 开始下发）
    ...(s.seatHolders === undefined ? {} : { seatHolders: s.seatHolders.map((h) => ({ ...h })) }),
    ...(s.description === undefined ? {} : { description: s.description }),
    // ★ 对方已把 `/scenes` 改成**三处同源回落**（YAML → 归属表 → 兜底）
    //   ⇒ 空串**已消除**（2026-10-06 实测）；这里保留 `?? ''` 只是**类型容错**，不是预期。
    category: s.category ?? '',
  }
}

/**
 * `status` 的收敛规则。
 *
 * ★★ 2026-10-05 修订（原为"未知值一律当 `disabled`"的 fail-closed）——
 *   契约 v1.3 §23.4 **新增了 `'pending'`**（占地未接入）⇒ 它**不再"未知"**。
 *   而旧的 fail-closed 会把占位条目报成「已停用」，**这不是保守，是编造事实**：
 *     · `disabled` = 某人把这位子**关掉了**（一个确定的决定）
 *     · `pending`  = 这位子**还没人接**（正常态）
 *   两者给用户的下一步动作完全不同（"去问为什么关掉" vs "去接入"）。
 *   ⇒ 真服务端实测（`status="pending"`）当场抓到过这条，见后续收执件。
 *
 * ★ 三个**契约内**取值各归其位（并集：§3.1 的 enabled/disabled ＋ §23.4 的 pending）。
 *
 * ★ 契约外的未知值怎么办 —— 仍要有个兜底，但**归到哪**要讲理：
 *   不归 `disabled`（那是在断言"有人关掉了它"，而我们并不知道）；
 *   归 `pending`（"这位子有、状态未明"最接近实情，且**不编造一个决定**）。
 *   —— 与"未签名报告必须醒目""读不到就说读不到"同一条价值取向：**宁可说不知道，不可编原因**。
 */
function toAgentStatus(s: string): AgentCard['status'] {
  if (s === 'enabled') return 'enabled'
  if (s === 'disabled') return 'disabled'
  // `pending` ＋ 任何未知取值 ⇒ 都按"未接入"处理（见上：宁可说不知道，不可编原因）
  return 'pending'
}

/** 同理：`outputLevel` 契约只有 light/standard/strict 三个取值，其余**宁可丢掉**也不编 */
const OUTPUT_LEVELS = new Set(['light', 'standard', 'strict'])
function toOutputLevel(s: string): SceneRecommendation['outputLevel'] | null {
  return OUTPUT_LEVELS.has(s) ? (s as SceneRecommendation['outputLevel']) : null
}

function toAgentCard(a: AgentView): AgentCard {
  return {
    id: a.id,
    // 契约里 `slug` 是必填；服务端没给时回落到 `id`（`slug` 不面向用户，界面上用的是 name）
    slug: a.slug ?? a.id,
    name: a.name,
    role: a.role,
    capabilities: a.capabilities ?? [],
    skillSummary: a.skillSummary ?? '',
    status: toAgentStatus(a.status),
    version: a.version ?? 0,
  }
}

/**
 * 分类 → 契约形状。
 * ★ 服务端多给的 `scenes` / `count` **一并带上**（`LeftPane` 会优先用它，见文件头 ①）。
 *   这里不写进契约类型，只作为**运行时附加字段**透传 —— 契约变更由出件方发起。
 */
function toCategories(cats: readonly CategoryView[]): SceneCategory[] {
  return cats.map((c) => ({
    key: c.key,
    label: c.label,
    intent: c.intent ?? '',
    ...(Array.isArray(c.scenes) ? { scenes: [...c.scenes] } : {}),
    ...(typeof c.count === 'number' ? { count: c.count } : {}),
  }))
}

function toRecommendations(recs: readonly RecommendationView[]): SceneRecommendation[] {
  const out: SceneRecommendation[] = []
  for (const r of recs) {
    // ★ 两道过滤都是 **fail-closed**（宁可少显示，也不编）：
    //   ① 服务端标了 `available: false` 的不推荐；
    //   ② `outputLevel` 不在契约三取值内的**整条丢掉** —— 契约里它是必填，
    //      而编一个档位会让用户按错的档位去理解（比不显示更坏）。
    if (r.available === false) continue
    const lv = r.outputLevel === undefined ? null : toOutputLevel(r.outputLevel)
    if (lv === null) continue
    out.push({
      key: r.key,
      label: r.label,
      when: r.when ?? '',
      outputLevel: lv,
      ...(Array.isArray(r.availableScenarios) && r.availableScenarios.length > 0
        ? { scenarios: [...r.availableScenarios] }
        : {}),
    })
  }
  return out
}

/* ══════════════════════════════════════════════════════════════════
   四、加载
   ══════════════════════════════════════════════════════════════════ */

const p = (r: BridgeResult<unknown>): string =>
  r.ok === true ? '' : 'business' in r ? r.business.message : r.error.detail

/**
 * ★★ 流程清单的**上一次成功结果**（缓存本体）· 2026-10-07 新增
 *
 * 存在**模块作用域**：一次会话里面板会反复取快照（切场景、重连、点刷新…），
 *   缓存的寿命应当**跟着会话**，不该跟着某一次调用。
 * ⚠️ 它是**内存态**（刷新页面即空）—— 这正合适：v2 要求的是"同一会话内不重复重建"，
 *   **不是**持久化缓存（持久化会带来"跨版本读到旧形状"的新风险，本仓吃过这类的亏）。
 */
let scenesCache: {
  updatedAt: string
  /** ★ 执行方签名 —— 命中缓存还要求它一致（理由见 `SnapshotCache.staleReason` 注释） */
  agentsSig: string
  scenes: SceneCard[]
  categories: SceneCategory[]
  recommendations: SceneRecommendation[]
} | null = null

/**
 * ★★ 连不上时**返回"空 + 原因"，绝不填演示数据**。
 *
 * 这条是 2026-10-05 被 `live-probe --expect=unreachable` **当场抓到的真缺陷**：
 *   早期实现里，几个失败分支都写成 `{ ...mockSnapshot(), kind: 'unreachable', … }`
 *   —— 于是界面出现最坏的一种组合：
 *     **状态条说「未接入」，左边却摆着 5 个演示场景**。
 *   那正是我这套设计要防的东西：**看起来是对的**。用户会以为那是他铺子里的流程。
 *   ⇒ 现在失败一律返回**空列表**（原因写在状态条里），演示数据只能由用户
 *     **显式点按钮**获得。
 *
 * ★ 另外：这里的文案是**上屏文本**，不许带 markdown 记号（早期版本把 `**…**`
 *   直接印在了界面上 —— 同一批修掉的）。
 */
function offlineSnapshot(
  kind: 'unreachable' | 'no_channel',
  label: string,
  reason: string,
): Snapshot {
  /**
   * ★★ **连不上 ⇒ 把流程缓存作废**（2026-10-07 加 · 与上面那条同源：宁可重拉，不可过期）。
   * 为什么必须在这里清（而不是在调用方）：本函数是**所有失败分支的唯一出口** ——
   *   清在这里，就**不可能漏**；清在调用方，就总有一天漏一处。
   * ★ 这正是"**把纪律放在唯一的必经之道上**"。
   */
  scenesCache = null
  return {
    kind,
    label,
    reason,
    server: null,
    agents: [],
    scenes: [],
    categories: [],
    recommendations: [],
    /**
     * ★ 读不到服务端 ⇒ 缓存状态也是空（`basis: null`）。
     * ★★ 并**顺手清掉流程缓存** —— 这一条**要紧**：
     *   若不清，下次恢复连接时可能拿"断网前的缓存"去比对一个**中间已经变过的清单**
     *   （我们没看见那段变化）⇒ 会**静默显示过期清单**。
     *   ⇒ **连不上时把缓存作废**，是"宁可重拉，不可过期"。
     */
    cache: { hit: false, basis: null, updatedAt: null, staleReason: null },
    account: null,
  }
}

/**
 * ★★ 流程清单缓存的**判定**（纯函数 · 2026-10-07）
 *
 * ★★ 为什么抽成纯函数：这套判定的**真实触发条件今天根本到不了** ——
 *   服务端还没下发 `updatedAt` ⇒ 线上永远走 `basis: 'absent'` 那一支。
 *   ⇒ 若把逻辑埋在 `liveFromServer` 里，**"命中缓存"这条路径将永远没人验过**，
 *     等对方落了 `updatedAt` 那天，第一次真跑就是它在线上第一次执行。
 *   ★ 这违反本仓纪律：**"该判的东西变了"要能被判**，而不能靠"它看起来对"。
 *   ⇒ 抽出来 ⇒ 四支都能被**独立喂入**验一遍（构建期本地判据层）。
 *
 * @param input.updatedAt  本次响应顶层 `updatedAt`（`null` = 服务端没给）
 * @param input.agentsSig  本次执行方清单的签名
 * @param input.cached     上次成功的缓存（`null` = 没有）
 * @returns 决定：`hit` 表示**复用 cached 的三份清单**；`store` 表示**要不要写入缓存**
 */
export function decideSceneCache(input: {
  updatedAt: string | null
  agentsSig: string
  cached: { updatedAt: string; agentsSig: string } | null
}): { hit: boolean; basis: SnapshotCache['basis']; staleReason: string | null; store: boolean } {
  const { updatedAt, agentsSig, cached } = input

  // ── ① 依据缺失 ⇒ 机制不生效 ⇒ 全量重建，且**不写缓存**（写了也无从比对）──
  if (updatedAt === null) {
    return { hit: false, basis: 'absent', staleReason: null, store: false }
  }
  // 首次（没有可比的缓存）⇒ 重建 + 存档
  if (cached === null) {
    return { hit: false, basis: 'updatedAt', staleReason: null, store: true }
  }
  // ── ② 依据变了 ⇒ 重建 + 刷新存档 ──
  if (cached.updatedAt !== updatedAt) {
    return { hit: false, basis: 'updatedAt', staleReason: null, store: true }
  }
  // ── ★ 依据没变，但执行方变了 ⇒ **不许命中**（卡片里的执行方名会过期）──
  if (cached.agentsSig !== agentsSig) {
    return {
      hit: false,
      basis: 'updatedAt',
      staleReason: '流程清单未变，但执行方清单变了 —— 卡片里的执行方名会过期，故重建',
      store: true,
    }
  }
  // ── ③ 依据没变、执行方也没变 ⇒ 命中 ──
  return { hit: true, basis: 'updatedAt', staleReason: null, store: false }
}

/** 读真服务端。**任何一步失败都如实返回，不回落到 mock**（见上） */
export async function loadLive(signal?: AbortSignal): Promise<Snapshot> {
  if (connection === null) {
    return offlineSnapshot(
      'no_channel',
      '通道不可用',
      '没取到宿主的数据通道（connection 服务）。这是环境问题，不是服务端故障。',
    )
  }

  const st = await callKaipu<{
    connected: boolean
    baseUrl: string
    accountId: string
    serverVersion?: string
    serverTime?: string
    agentsLoaded?: number
    tenants?: number
    authError?: string
    fingerprintSource: string
  }>(connection, 'status', {}, signal)
  if (st.ok !== true) {
    return offlineSnapshot('unreachable', '未连上', p(st))
  }
  if (!st.data.connected) {
    return offlineSnapshot(
      'unreachable',
      '未接入（本地模式）',
      '本插件还没配接入地址。填上服务端地址即可接入 —— 未接入不是故障。',
    )
  }
  if (st.data.authError !== undefined) {
    return offlineSnapshot('unreachable', '接入异常', st.data.authError)
  }

  const [sc, ag, me] = await Promise.all([
    callKaipu<{ scenes: SceneView[]; categories?: CategoryView[]; recommendations?: RecommendationView[] }>(
      connection,
      'listScenes',
      {},
      signal,
    ),
    callKaipu<{ agents: AgentView[] }>(connection, 'listAgents', {}, signal),
    callKaipu<{ name?: string; plan?: string; features?: Record<string, boolean>; creditsNote?: string }>(
      connection,
      'connect',
      {},
      signal,
    ),
  ])
  if (sc.ok !== true) return offlineSnapshot('unreachable', '读流程失败', p(sc))
  if (ag.ok !== true) return offlineSnapshot('unreachable', '读执行方失败', p(ag))

  const agents = ag.data.agents ?? []
  /**
   * ★★ 流程清单的缓存判定（2026-10-07 · 对应该验收项）
   *
   * 规则（照 v2 §4.1 的字面）：**首次全量拉**；之后拿响应顶层 `updatedAt` 比对，
   *   **不同则重拉、相同则用缓存**。
   *
   * ⚠️ 一个必须讲清的前提：**没有 `ETag` ⇒ 无法免掉这次请求**
   *   （v2 明确"不做 ETag / Cache-Control，顶层 `updatedAt` 足够"）。
   *   ⇒ 所以这里的"用缓存"= **复用已构造好的卡片**（省掉重建与下游重渲染），
   *     **不是**省掉网络请求 —— 这一点不能含糊，否则会被理解成"离线也能用"。
   */
  const rawUpdatedAt = (sc.data as { updatedAt?: unknown }).updatedAt
  const updatedAt = typeof rawUpdatedAt === 'string' && rawUpdatedAt !== '' ? rawUpdatedAt : null
  const agentsSig = agents.map((a) => `${a.id}|${a.name}|${a.status}`).join(',')

  // ★ 判定交给纯函数（可被独立验；见 decideSceneCache 的注释）
  const decision = decideSceneCache({ updatedAt, agentsSig, cached: scenesCache })

  let scenes: SceneCard[]
  let categories: SceneCategory[]
  let recommendations: SceneRecommendation[]

  if (decision.hit && scenesCache !== null) {
    // ── ③ 命中 ⇒ 复用缓存的三份清单 ──
    scenes = scenesCache.scenes
    categories = scenesCache.categories
    recommendations = scenesCache.recommendations
  } else {
    // ── ①/②/执行方变了 ⇒ 全量重建 ──
    scenes = (sc.data.scenes ?? []).map((s) => toSceneCard(s, agents))
    categories = toCategories(sc.data.categories ?? [])
    recommendations = toRecommendations(sc.data.recommendations ?? [])
    // ★ 依据缺失时**不写缓存**（`store === false`）—— 没有比对依据的存档是**假缓存**
    if (decision.store && updatedAt !== null) {
      scenesCache = { updatedAt, agentsSig, scenes, categories, recommendations }
    } else if (updatedAt === null) {
      // ★ 依据都没了 ⇒ 旧缓存**不可信**（我们无从知道它之后变没变过）⇒ 作废
      scenesCache = null
    }
  }

  const cacheState: SnapshotCache = {
    hit: decision.hit,
    basis: decision.basis,
    updatedAt,
    staleReason: decision.staleReason,
  }

  return {
    kind: 'live',
    label: '真服务端',
    reason: null,
    server: {
      baseUrl: st.data.baseUrl,
      accountId: st.data.accountId,
      serverTime: st.data.serverTime ?? null,
      serverVersion: st.data.serverVersion ?? null,
      agentsLoaded: st.data.agentsLoaded ?? null,
      tenants: st.data.tenants ?? null,
      fingerprintSource: st.data.fingerprintSource,
      authError: null,
    },
    agents: agents.map(toAgentCard),
    scenes,
    categories,
    recommendations,
    cache: cacheState,
    account:
      me.ok === true
        ? {
            name: me.data.name ?? '',
            plan: me.data.plan ?? '',
            features: me.data.features ?? {},
            creditsNote: me.data.creditsNote ?? null,
          }
        : null,
  }
}
