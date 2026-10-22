/**
 * 山海·开铺 · 服务端响应形状（wire）—— host 出参 + client 消费
 * =====================================================================
 * ★ 为什么放**契约包**（而不是插件仓自己的 src/shared/）：
 *   这些形状**本来就是这个服务端的响应形状**，契约包正是它们该待的地方。
 *   更要紧的是**工程原因**（2026-10-05 实测踩出来的）：
 *
 *   插件的 host half 与 client half **不能共用同一个源文件** ——
 *   两边 tsconfig 的 module 格式不同（host = ESM，client = CommonJS），
 *   编到同一路径会**互相覆盖**。症状：host 侧报
 *     `The requested module '../shared/wire.js' does not provide an export named 'REMOTE_NS'`
 *   （后写的 CJS 产物把 ESM 产物冲掉了）。
 *
 *   而契约包**恰好已经有现成的双态产物机制**：
 *     · `lib/`     = ESM  → 给 host half
 *     · `lib-cjs/` = CJS  → 给 `tools/build-client.mjs` 内联进 client bundle
 *   ⇒ 复用这套机制，比新造一套正确。
 *
 * ★★ 但有一条**必须守住**（否则发布出去就挂）：
 *   host half **不经打包**（tsc 直出），它的裸 import 必须在**用户机的 profile** 里
 *   解析得到。而 `@shanhai/kaipu-contract` 是**构建期依赖**，用户机上**没有**。
 *   ⇒ 所以 **host half 只能 `import type`**（类型被 tsc 擦除，不产生运行时依赖）。
 *      **一旦有人在 host half 里从这个包 import 一个「值」，发布包就会解析失败。**
 *   ⇒ 这条由 `tools/check-remote-bridge.mjs` 看护（它扫编译产物里的裸 import）。
 *
 * ★ 形状来源：以**实测的服务端响应**为准（2026-10-05），不以后来回忆为准。
 *   已发现与我方 `contracts/v1.1/*.json` 不一致处（`lamps` 是字符串数组、
 *   `categories[]` 多带 `scenes`/`count`、`scenes[].category` 与 `categories[].scenes`
 *   互相矛盾）—— 都按**实测形状**声明，并已登记差异单，**未单方改契约**。
 */

/* ══════════════════════════════════════════════════════════════════
   一、接没接上（本仓自己的第一诊断接口，不是服务端契约）
   ══════════════════════════════════════════════════════════════════ */

/** host 侧 `kaipu/status` 的出参 */
export interface StatusPayload {
  /** false ⇒ 本地/未接入模式（★ **不是故障**） */
  connected: boolean
  baseUrl: string
  accountId: string
  serverVersion?: string
  serverTime?: string
  agentsLoaded?: number
  tenants?: number
  /** 取令牌是否成功（连不上时这里是原因） */
  authError?: string
  /** 指纹来源：部署期给 / 本机推导 / 兜底常量 —— ★ 兜底不许冒充真实指纹 */
  fingerprintSource: 'config' | 'derived' | 'fallback'
}

/* ══════════════════════════════════════════════════════════════════
   一之二、铺子资料（**本机目录**，同样不是服务端契约）
   ══════════════════════════════════════════════════════════════════ */

/**
 * 铺子资料的三个子目录 —— **固定三个，不许用户自建**。
 *
 * ★ 为什么固定：分类一旦自由，同一个人第二次进来就会用另一种分法，
 *   三个月后自己也找不到东西。三个抽屉够用，且每个都有明确的去处。
 * ★ 目录名用**界面语言**（不是 `uploads`/`reports`）：用户会直接在
 *   文件管理器里看到它们，看得懂比"工程上规范"更要紧。
 */
export const SHOP_SUBDIRS = ['待审材料', '审校报告', '草稿'] as const
export type ShopSubdir = (typeof SHOP_SUBDIRS)[number]

/** 铺子资料里的一个文件条目 */
export interface ShopFileEntry {
  name: string
  sub: ShopSubdir
  /** 字节数 */
  size: number
  /** 最后修改时间（毫秒时间戳） */
  mtimeMs: number
  /** 是否属于「可以直接读成文本」的类型（决定界面上给不给"填入待审内容"） */
  readable: boolean
}

/** `kaipu/listShopFiles` 出参 */
export interface ShopFilesPayload {
  /**
   * ★★ 资料根路径 —— **必须回给界面**。
   *   理由：用户有权知道自己的文件存在哪儿（能自己去打开、去备份）。
   *   "我们知道但不说"是这一层最不该有的姿态。
   */
  root: string
  /** 当前铺子对应的目录名（由接入身份派生；换接入地址就是另一个铺子） */
  shopKey: string
  /** 三个固定子目录 */
  subdirs: readonly ShopSubdir[]
  files: ShopFileEntry[]
  /**
   * ★ 本地不可用的**原因**（如运行时不提供文件能力）。
   *   有值 = 这一块用不了，界面**如实说明**，不是"加载失败"这种空话。
   *   没有值 = 正常。**不许用"空列表"冒充"能读但里面没东西"。**
   */
  unavailable?: string
}

/** `kaipu/writeShopFiles` 入参（拖放上传的落点） */
export interface WriteShopFilesQuery {
  sub: ShopSubdir
  /** 文件内容用 base64 传（一元通道只走 JSON，二进制必须编码） */
  files: { name: string; base64: string }[]
}

/** `kaipu/writeShopFiles` 出参 —— ★ 逐文件给结果，不搞"整体成功/失败" */
export interface WriteShopFilesResult {
  written: { name: string; size: number }[]
  failed: { name: string; error: string }[]
}

/** `kaipu/removeShopFile` 入参 */
export interface RemoveShopFileQuery {
  sub: ShopSubdir
  name: string
}

/** `kaipu/readShopTextFile` 入参 */
export interface ReadShopTextQuery {
  sub: ShopSubdir
  name: string
}

/** `kaipu/readShopTextFile` 出参 */
export interface ReadShopTextResult {
  name: string
  text: string
  size: number
  /** ★ 超长被截断时为 true —— 界面必须**说出来**，不许让人以为读全了 */
  truncated: boolean
}

/**
 * `kaipu/openShopDir` 入参 —— 在系统文件管理器里打开铺子资料目录。
 *
 * ★★ **只有 `sub`（可选枚举），没有 `path`** —— 路径由 host 侧自己算。
 *   这是刻意收紧：外面**根本传不进任意路径**，穿越 / 越界在设计上就不存在
 *   （对比先例 003 `openPath`：那边收 `path` 再 `resolve()` 收敛）。
 */
export interface OpenShopDirQuery {
  /** 省略 = 打开铺子资料根；给了就开对应抽屉 */
  sub?: ShopSubdir
}

/** `kaipu/openShopDir` 出参 */
export interface OpenShopDirResult {
  /**
   * ★ 只表示**已发起** —— **不承诺**文件管理器窗口一定弹出。
   *   host 无法确证那件事，所以不编一个"已打开"的确定结论（界面据此如实措辞）。
   */
  opened: boolean
  /** 实际打开的绝对路径（**已规范化** —— Windows explorer 不认正斜杠） */
  path: string
  /** 用哪个命令打开的（win32=explorer / darwin=open / 其他=xdg-open），供排查 */
  opener: string
}

/* ══════════════════════════════════════════════════════════════════
   二、跨两半的统一返回包
   ══════════════════════════════════════════════════════════════════ */

export interface RemoteOk<T> {
  ok: true
  data: T
}
export interface RemoteErr {
  ok: false
  kind: 'denied' | 'error'
  /** ★ 给人看的、**已翻译**的话（不是原始报错 —— 契约纪律：不直出技术报错） */
  error: string
  /** 机器可读分类（供客户端决定是否显示"另走一条路"） */
  code?: string
}
export type RemoteResult<T> = RemoteOk<T> | RemoteErr

/* ══════════════════════════════════════════════════════════════════
   三、服务端响应（实测形状）
   ══════════════════════════════════════════════════════════════════ */

/** `GET /me` —— 铺子身份 + 能力位 + 时间基准 */
export interface AccountView {
  accountId: string
  name: string
  plan: string
  /** ★ 功能可见性开关（**不是权限**）。6 位键名以契约为准。 */
  features: Record<string, boolean>
  /** ★ 计费未接入时**如实为 null**（不许编数字）——界面按"未开通"处理 */
  credits: number | null
  creditsNote?: string
  /** ★ 全系统时间基准 —— 界面显示时间一律用它，**不用本地钟判断** */
  serverTime: string
}

/** `GET /agents` 单条 */
export interface AgentView {
  id: string
  slug?: string
  name: string
  role: string
  capabilities?: string[]
  /** 卡片摘要（**非全文**） */
  skillSummary?: string
  status: string
  version?: number
}

/** `GET /agents` 响应 */
export interface AgentsPayload {
  agents: AgentView[]
  accountId?: string
}

/**
 * `GET /scenes` 单条。
 *
 * ★★ `lamps` **已升格**（2026-10-06 实测 · 对方 `032` 通报）：
 *   服务端按契约 §23.3 改回**对象数组**，并**同时**给 `lampNames`（老形状 · 与升格前**逐字相同**）
 *   ⇒ 对方明说"老读法一字不改仍可读"（比让我方做双兼容更省事）。
 *
 *   ★ 所以我方类型写成**联合**：两种形状都要能吃。
 *     **归一化在 `live.ts` 的 `mapLamps` 里做** —— 把"占位/待接入"收敛成 `agentId: null`，
 *     界面层只认这一种表达（不必知道"占位 id"这回事）。
 *
 *   ⚠️ 旧注释（已失效，留作对照）：~~`lamps` 是字符串数组 ⇒「待接入 N」没有契约依据，
 *     客户端靠 `/agents[].role` 匹配推导~~ —— **现在有权威字段了**（`agentId`），
 *     再用 role 猜就是**放着权威不用**（而且猜错的方向是"误报待接入"）。
 */
export type SceneLampsWire = readonly (string | SceneLampWire)[]

/** 升格后的 lamp 形状（契约 §23.3） */
export interface SceneLampWire {
  lamp: string
  /**
   * ★ 与 `lamp_start.agent` **同源**（实测：占位时回**占位 id**，如 `zhinangtuan`）。
   * ⇒ **不能**用 `agentId === null` 判"待接入"：占位时它**不是 null**。
   *   权威判据 = 该 id 在 `/agents` 里的 `status`（`pending` ⇒ 待接入）。
   */
  agentId: string | null
  agentName: string | null
}

/**
 * ★★ `seatHolders`（2026-10-06 实测新增 · 契约 §23.3 要求）。
 *
 * ⚠️ ~~`holderType` 值域在契约内部有两套词表（待明确）~~ → ✅ **已裁定（对方 `034` §三）**：
 *   **权威值域 = `builtin | external | platform`（`none` 兜底）**。
 *   原 §23.3 **写漏了 `builtin`**（而它是 `role_seats` 种子的默认值，四席中三席即 `builtin`）。
 * ★ **形状各异是有意的**：`/roles/seats` 嵌套、`/scenes[].seatHolders` 扁平（对方明写"非冲突"）。
 */
export interface SeatHolderWire {
  seat: string
  /** 已裁定：`builtin | external | platform`（`none` 兜底）—— 见上方说明 */
  holderType: 'builtin' | 'external' | 'platform' | 'none'
  holderId: string
  holderName: string
}

export interface SceneView {
  scene: string
  label: string
  version: string
  /** ★ 联合：对象数组（新）或字符串数组（老）—— 归一化见 `SceneLampsWire` */
  lamps: SceneLampsWire
  /** ★ 新增（2026-10-06）：老形状的字符串数组（与升格前逐字相同） */
  lampNames?: readonly string[]
  /** ★ 新增（2026-10-06）：本场景各执行位的承担方快照 */
  seatHolders?: readonly SeatHolderWire[]
  loopPolicy: { maxLoop?: number; maxGlobalLoops?: number }
  requiresExternal: boolean
  description?: string
  /** 实测多给：是否用户自定义场景 */
  custom?: boolean
  /**
   * ★ `#17` · 所属分类 key。**空串不是正常态**（契约 §23.3 + 差异单 D 组）：
   *   对方已把 `/scenes` 改成**三处同源回落**（YAML → 归属表 → 兜底），
   *   2026-10-06 实测 **空串已消除** ⇒ 这里保留 `?` 只是**类型容错**，不是预期。
   */
  category?: string
}

/** `#17` 新增段：分类。★ `scenes`/`count` 是**实测多给**的字段（我方契约里没有） */
export interface CategoryView {
  key: string
  label: string
  intent?: string
  hint?: string
  scenes: string[]
  count: number
}

/** `#17` 新增段：推荐组合 —— ★ 语义是「**对什么场合**推荐」，不是「热门」 */
export interface RecommendationView {
  key: string
  label: string
  when?: string
  scenarios: string[]
  available: boolean
  availableScenarios: string[]
  outputLevel?: string
}

/** `GET /scenes` 响应 */
export interface ScenesPayload {
  scenes: SceneView[]
  categories: CategoryView[]
  recommendations: RecommendationView[]
  accountId?: string
}

/** `GET /capabilities` */
export interface CapabilitiesPayload {
  platform?: string
  version?: string
  can?: { capability: string; detail?: string }[]
  /** ★ `cannot` 段**必须完整展示**（对外承诺的硬要求） */
  cannot?: { capability: string; detail?: string }[]
  dataPolicy?: {
    owner?: string
    /** ★ 双值（`#14` 冻结）：过程 30 天 / 签名报告长期 */
    retention?: { process?: string; signedReport?: string } | string
    sharing?: string
  }
  billing?: { model?: string }
}
