/**
 * 山海·开铺 · 场地插件 · **演示数据**（mock）
 * =====================================================================
 * ★★ 三条纪律（写在最前面，改这个文件前先读）
 *
 *   1) **形状严格按契约** —— 类型一律从 `@shanhai/kaipu-contract` 取，
 *      本地**不另行定义**任何字段名/事件名/判定字符串。契约层存在的唯一理由就是这个。
 *      （契约包的运行时值会被内联进 bundle。）
 *
 *   2) **确定性** —— 不用 `Math.random()`、不用 `Date.now()`。
 *      理由：界面判据要能被探针**断言到具体字面量**（"第 2 轮"/"未参与审核面"…）。
 *      带随机数的 mock 只能证明"界面没崩"，证明不了"它显示了该显示的东西"。
 *
 *   3) ★★ **必须在界面上明示这是演示数据**（`DATA_SOURCE_LABEL`）。
 *      理由与官方 `contributing.md` 同源：「描述必须属实，会被当作声明与代码核对」。
 *      把 mock 混成看起来像真数据，等于自己给自己造了一个"名不副实"的把柄。
 *
 * ── 这组数据刻意覆盖的**全部契约分支**（验收面）──────────────
 *
 *   | 场景 | 覆盖 |
 *   |:--|:--|
 *   | 开铺审计 · 标准 | **round=2 回炉**（⚡有条件 → ✅通过）+ **dims 裁剪**（skippedDims） |
 *   | 复核演练 · 全场未接入 | `agentId === null` ⇒ 界面「待接入」 |
 *   | 预约核验 · 需外部预约 | `requiresExternal` + `seatHolders` |
 *   | 资料预检 | **⛔拒收**（不收费） |
 *   | 开铺审计 · 进行中 | 停在第一轮中段 ⇒ 可演示 **「已停止接收」**（R5） |
 *
 *   四类判定 `✅通过 / ⚡有条件 / ❌驳回 / ⛔拒收` **全部出现**（R3：必须可区分且可见）。
 *
 * ── ★★ 2026-10-07：灯名字段已对齐契约 v1.4（本文件最重要的一次改动）────────
 *
 * **权威来源**：契约 v1.4（sha256 `f1211713…` · 1,448 行）
 *   §3.1 `role: "匠灯"` / `lamp: "匠灯"` · §3.3 `lamps: ["智灯","匠灯","戒灯","仁灯"]`
 *   · §3.4 SSE `start.lamps` / `lamp_start.lamp` / `dims` 同值域。
 *
 * **为什么必须改**（原来填的是「主体核验」这类**自编维度名**）：
 *   ① **事实错误**：`lamps[].lamp` / `agents[].role` 的真值是**灯名**。
 *      2026-10-07 实测 `GET /scenes` / `start.lamps` 均返灯名。
 *   ② **这条本来就在撒谎**：`live.ts:214` 用 `agents.find(x => x.role === raw)`
 *      把 `role` 与 lamp 名精确匹配 —— 而旧 mock 里 `role` 是 `'执行'`/`'审计'`、
 *      `lamp` 是 `'主体核验'`，**根本匹配不上**。旧数据下这条兜底路径**恒不命中**。
 *      改成灯名后它才**真的能工作**：这是**修好**，不只是改名。
 *   ③ 裁定(a) 的原话 = **内容自编 + 形状合契约** —— 而这里错的是**形状**（取值域），
 *      不是内容。
 *
 * **★ 全局映射（一个执行位一盏灯，跨场景必须一致）**
 *   —— 因为同一个 agent 的 `role` 是**固定**的，它在任何场景出现，
 *   `lamp` 都必须与之一致，否则 `role === lamp` 这条匹配又会断。
 *
 *   | agent | 执行方名（**自编**） | 灯（**契约值**） |
 *   |:--|:--|:--|
 *   | `ag-1001` | 主体核验方 | **智灯** |
 *   | `ag-1002` | 权责确认方 | **匠灯** |
 *   | `ag-1003` | 留痕审计方 | **戒灯** |
 *   | `ag-1004` | 利益冲突筛查方 | **仁灯** |
 *   | `ag-1005` | (待接入) | `综合维度` ★ **保留原值**，见该条注释（真服务端实测） |
 *
 *   ★ **只取四灯**，不引入第五个名字：v1.4 §3.3 的**内置**多灯场景
 *     (`multi-dim-review`) 就是 `["智灯","匠灯","戒灯","仁灯"]` 四盏。
 *     **本仓不发明内置场景里没有的取值**（少做比多做好）。
 *
 *   ★ **哪些保持自编**（裁定(a) 的"内容自编"那一半）：
 *     `agentName` / `seatHolders[].holderName` / `MOCK_SEAT_CHANGES` 的 from·to
 *     —— 它们承载的是「**哪个执行方坐这个位子**」（人/机构），**不是灯名**。
 *     契约 §3.1 里 `name` 与 `lamp` 本就是两个字段。
 *
 * ⚠️ **反向判据已配**：构建期本地判据层 ⓪.3 段断「界面不出现旧自编名」——
 *   ★ **先加的反向那条**（旧名必须 0 命中），正向只是它的前提。
 *   理由：只断"新的在"是假绿 —— 改漏一处（比如只改了场景没改事件序列），正向照样全绿。
 */
import type { AgentCard, SceneCard, SceneCategory, SceneRecommendation, SceneRunEvent } from '@shanhai/kaipu-contract'

/** ★ 数据来源标签 —— 面板必须显示它（纪律 3） */
export const DATA_SOURCE_LABEL = '演示数据（mock）'

/* ─────────────────────────── GET /agents ─────────────────────────── */

export const MOCK_AGENTS: AgentCard[] = [
  {
    id: 'ag-1001',
    slug: 'subject-verifier',
    name: '主体核验方',
    // ★ 契约 v1.4 §3.1：`role` 的值域 = **灯名**（示例 `"role": "匠灯", "lamp": "匠灯"`），
    //   不是"执行/审计"这类**本仓自编的角色词**。
    //   ⇒ 它同时是 `live.ts` 老形状兜底（`role === lamp` 匹配）的**唯一依据**，
    //     填错不会报错，只会**静默失配**。
    role: '智灯',
    capabilities: ['证照核验', '主体一致性'],
    skillSummary: '核验证照与主体信息是否一致。',
    status: 'enabled',
    version: 3,
  },
  {
    id: 'ag-1002',
    slug: 'duty-confirmer',
    name: '权责确认方',
    role: '匠灯',
    capabilities: ['权责边界', '签署留痕'],
    skillSummary: '确认权责边界并留存签署痕迹。',
    status: 'enabled',
    version: 2,
  },
  {
    id: 'ag-1003',
    slug: 'trail-auditor',
    name: '留痕审计方',
    role: '戒灯',
    capabilities: ['过程留痕', '完整性检查'],
    skillSummary: '检查过程留痕是否完整、可追溯。',
    status: 'enabled',
    version: 5,
  },
  {
    id: 'ag-1004',
    slug: 'conflict-screener',
    name: '利益冲突筛查方',
    role: '仁灯',
    capabilities: ['关联关系筛查'],
    skillSummary: '筛查关联关系与利益冲突。',
    // ★ `disabled` ⇒ 界面灰显「已停用」且**不许点**。
    //   契约（models.ts）写明：返回全部（含 disabled）是为了让用户看见"被关掉了" ——
    //   看不见的话，用户会以为是自己出错。
    status: 'disabled',
    version: 1,
  },
  {
    /**
     * ★★ `pending`（占地未接入）—— 契约 **v1.3 §23.4** 新增的合法值。
     *
     * 为什么演示数据必须有这一条（2026-10-05 补）：
     *   它是真服务端**空铺的常态**（实测 `GET /agents` 回 `{id:"zhinangtuan",
     *   status:"pending", name:"(待接入)", role:"综合维度", capabilities:[]}`）。
     *   而演示数据原先只有 `enabled` / `disabled` 两态 ⇒ **三态里的那一态在演示态看不到**，
     *   判据也就只能断两态。
     *
     * ★ 字段刻意**照真实占位条目来**：`capabilities: []` · `skillSummary: ''` · `version: 0`
     *   （服务端不给这三个）—— 界面与提示文案**必须能容忍"没有内容"**，
     *   而不是让 `vundefined` 或"｜"露到屏幕上。
     */
    id: 'ag-1005',
    slug: 'pending-slot',
    name: '(待接入)',
    /**
     * ★★ 2026-10-07 灯名对齐时**特意保留**了这一处的 `综合维度` —— 它不是漏改，是真值。
     *
     * 三个来源都指向同一个字面量：
     *   ① **真服务端实测**（2026-10-05）：`GET /agents` 的占位条目
     *      `{id:"zhinangtuan", status:"pending", name:"(待接入)", role:"综合维度", …}`；
     *   ② 契约 **v1.4 §22.1**：`round_start` 样例明写
     *      `data: { "round": 1, "reason": "首轮", "lamps": ["综合维度"] }`
     *      并注明「★ light-review **单灯场景的真实名**（不属四灯内置场景）」；
     *   ③ 同一份契约 §22.3 的 `start.lamps` = `[…]`（实现侧真跑读数）。
     *
     * ★★ 所以「`lamp` 一定是灯名」是**错的归纳**：
     *   多灯内置场景用**灯名**，**单灯场景**用**场景特定的名**。
     *   ⇒ 「把演示数据里所有非灯名一律改成灯名」会**改错**这一处。
     *   这正是"**值以权威件为准，不按我对规律的记忆改**"的一个具体落点。
     */
    role: '综合维度',
    capabilities: [],
    skillSummary: '',
    status: 'pending',
    version: 0,
  },
]

/* ─────────────────────────── GET /scenes ─────────────────────────── */

export const MOCK_SCENES: SceneCard[] = [
  {
    scene: 'opening-audit',
    label: '开铺审计 · 标准',
    version: '1.1',
    lamps: [
      // ★ 四盏灯的顺序与 v1.4 §3.3 内置场景 `["智灯","匠灯","戒灯","仁灯"]` **逐字一致**
      // ★★ 2026-10-08 补 `duty`/`dutyNote` —— **这两个字段是契约 v1.5 §3.3 已有的**
      //    （本仓类型与 mock 此前都没跟上，属"契约有、本仓缺"）。职责值**逐字取契约样例**，
      //    不自己编：契约注明「`duty` 权威源 = 官网 `.t-role`」。
      { lamp: '智灯', agentId: 'ag-1001', agentName: '主体核验方', duty: '拆局推演', dutyNote: '看眼前的路怎么走' },
      { lamp: '匠灯', agentId: 'ag-1002', agentName: '权责确认方', duty: '工程落地与系统维护', dutyNote: '把图纸砌成城墙' },
      { lamp: '戒灯', agentId: 'ag-1003', agentName: '留痕审计方', duty: '风险推演与预警', dutyNote: '先看哪里会塌' },
      // ★★ `agentId: null` ⇒ **该灯尚未接入执行方** ⇒ 界面显「待接入」。
      //    这是「场地零内置可跑」的用户可见面，**当一等公民做**，不是异常态。
      { lamp: '仁灯', agentId: null, agentName: null, duty: '人味校准', dutyNote: '这条路，人走得下去吗' },
    ],
    loopPolicy: { maxLoop: 2, maxGlobalLoops: 4 },
    requiresExternal: false,
    // ★ 形状按契约 v1.3 §23.3（**数组**，每项 {seat, holderType, holderId, holderName}）
    //   —— 原先是「对象 + 三个固定键」的早期推测，契约落纸后改回契约形状。
    // ★★ 2026-10-08 补至 **4 项**：契约 v1.5 §23.3 明写「`seatHolders` **已落地（各场景 4 项）**」
    //    ⇒ 本仓原 2 项**与现状不符**，这里补 management / signature。
    // ★ 同时订正 `holderType` 值域：`builtin` = 平台内建的**备选承担方**（智囊团/第三方审计/管理方）；
    //    `platform` = **平台自身提供的服务位 —— 契约注明"当前仅签名位"**
    //    ⇒ `execution` / `audit` 原写 `platform` **用错档**，改回 `builtin`。
    seatHolders: [
      { seat: 'execution', holderType: 'builtin', holderId: 'ag-1001', holderName: '主体核验方' },
      { seat: 'audit', holderType: 'builtin', holderId: 'ag-1003', holderName: '留痕审计方' },
      // ★ 管理位取**契约 `seats.json` 的默认值**（「山海管理方（候选）」是**默认/示例**，
      //   不是固定值 —— 2026-10-08 明确：管理位可以是项目主持人，也可以是委托方自己）。
      { seat: 'management', holderType: 'builtin', holderId: 'shanhai-mgmt', holderName: '山海管理方（候选）' },
      { seat: 'signature', holderType: 'platform', holderId: 'shanhai-signer', holderName: '山海签名服务' },
    ],
    description: '标准开铺审计：四个审核面会商，最高 2 轮回炉。',
    category: 'standard_review',
  },
  {
    scene: 'dry-run',
    label: '复核演练 · 全场未接入',
    version: '0.9',
    lamps: [
      { lamp: '智灯', agentId: null, agentName: null, duty: '拆局推演', dutyNote: '看眼前的路怎么走' },
      { lamp: '匠灯', agentId: null, agentName: null, duty: '工程落地与系统维护', dutyNote: '把图纸砌成城墙' },
      { lamp: '戒灯', agentId: null, agentName: null, duty: '风险推演与预警', dutyNote: '先看哪里会塌' },
    ],
    loopPolicy: { maxLoop: 1, maxGlobalLoops: 1 },
    requiresExternal: false,
    // ★★ 2026-10-08 补 4 项（契约 v1.5 §23.3「各场景 4 项」）。
    //   ★ 这一场是「场地零内置可跑」的可见面 ⇒ 三个可替换位**全 `none`**（真的没人），
    //     唯独**签名位是平台自身服务**（`platform`）—— 它不依赖任何执行方接入，
    //     这正是"场地本身仍可用"的落点。
    seatHolders: [
      { seat: 'execution', holderType: 'none', holderId: '', holderName: '（未指派）' },
      { seat: 'audit', holderType: 'none', holderId: '', holderName: '（未指派）' },
      { seat: 'management', holderType: 'none', holderId: '', holderName: '（未指派）' },
      { seat: 'signature', holderType: 'platform', holderId: 'shanhai-signer', holderName: '山海签名服务' },
    ],
    description: '★ 场地零内置可跑的用户可见面：一个执行方都没有时，界面全是「待接入」；场地本身仍可用。',
    category: 'daily_selfcheck',
  },
  {
    scene: 'reservation-audit',
    label: '预约核验 · 需外部预约',
    version: '1.0',
    lamps: [
      { lamp: '智灯', agentId: 'ag-1001', agentName: '主体核验方', duty: '拆局推演', dutyNote: '看眼前的路怎么走' },
      { lamp: '戒灯', agentId: 'ag-1003', agentName: '留痕审计方', duty: '风险推演与预警', dutyNote: '先看哪里会塌' },
      { lamp: '仁灯', agentId: null, agentName: null, duty: '人味校准', dutyNote: '这条路，人走得下去吗' },
    ],
    loopPolicy: { maxLoop: 1, maxGlobalLoops: 2 },
    // true ⇒ `run` 需带 `reservationId`；无有效预约 ⇒ 409 not_checked_in
    requiresExternal: true,
    seatHolders: [
      { seat: 'execution', holderType: 'builtin', holderId: 'ag-1001', holderName: '主体核验方' },
      { seat: 'audit', holderType: 'builtin', holderId: 'ag-1003', holderName: '留痕审计方' },
      // ★ `holderType: 'none'` ⇒ **该执行位无人**（契约 §23.3 三值之一）——
      //   与"待接入"同源但落在**执行位**这一层（原先 mock 写的是字符串「（未指派）」，
      //   那是把"没人"编码进了名字里；契约给了它一个**类型值**，就该用它）。
      { seat: 'management', holderType: 'none', holderId: '', holderName: '（未指派）' },
      // ★★ 2026-10-08 补第 4 项（契约 v1.5 §23.3「各场景 4 项」）
      { seat: 'signature', holderType: 'platform', holderId: 'shanhai-signer', holderName: '山海签名服务' },
    ],
    description: '带外部预约的核验场景：运行前须有有效预约。',
    category: 'standard_review',
  },
  {
    scene: 'material-precheck',
    label: '资料预检',
    version: '1.2',
    lamps: [
      // ★ 这一场的执行方是「主体核验方」(ag-1001) 与「留痕审计方」(ag-1003) ——
      //   按全局映射分别是**智灯**与**戒灯**（灯名跟着 agent 走，不跟着场景走）。
      { lamp: '智灯', agentId: 'ag-1001', agentName: '主体核验方', duty: '拆局推演', dutyNote: '看眼前的路怎么走' },
      { lamp: '戒灯', agentId: 'ag-1003', agentName: '留痕审计方', duty: '风险推演与预警', dutyNote: '先看哪里会塌' },
    ],
    loopPolicy: { maxLoop: 1, maxGlobalLoops: 1 },
    requiresExternal: false,
    // ★★ 2026-10-08 补 4 项（契约 v1.5 §23.3「各场景 4 项」）。
    //   ★★ 管理位**刻意用 `external` + 客户方的人** —— 2026-10-08 明确：
    //      「管理位不一定姓山海，可以是项目主持人，也可以是委托方自己」。
    //      ⇒ 演示数据要**把这个形态真的演出来**，否则界面上永远只看得到平台默认值，
    //        那条口径就只落在文档里、落不到屏幕上。
    seatHolders: [
      { seat: 'execution', holderType: 'builtin', holderId: 'ag-1001', holderName: '主体核验方' },
      { seat: 'audit', holderType: 'builtin', holderId: 'ag-1003', holderName: '留痕审计方' },
      { seat: 'management', holderType: 'external', holderId: 'client-pm-1', holderName: '项目主持人' },
      { seat: 'signature', holderType: 'platform', holderId: 'shanhai-signer', holderName: '山海签名服务' },
    ],
    description: '进件前的资料预检：不齐直接拒收，不收费。',
    category: 'daily_selfcheck',
  },
  {
    scene: 'opening-audit-live',
    label: '开铺审计 · 进行中',
    version: '1.1',
    lamps: [
      { lamp: '智灯', agentId: 'ag-1001', agentName: '主体核验方', duty: '拆局推演', dutyNote: '看眼前的路怎么走' },
      { lamp: '匠灯', agentId: 'ag-1002', agentName: '权责确认方', duty: '工程落地与系统维护', dutyNote: '把图纸砌成城墙' },
      { lamp: '戒灯', agentId: 'ag-1003', agentName: '留痕审计方', duty: '风险推演与预警', dutyNote: '先看哪里会塌' },
    ],
    loopPolicy: { maxLoop: 2, maxGlobalLoops: 4 },
    requiresExternal: false,
    // ★★ 2026-10-08 补 4 项（契约 v1.5 §23.3「各场景 4 项」）—— 与 `opening-audit` 同一场景的快照
    seatHolders: [
      { seat: 'execution', holderType: 'builtin', holderId: 'ag-1001', holderName: '主体核验方' },
      { seat: 'audit', holderType: 'builtin', holderId: 'ag-1003', holderName: '留痕审计方' },
      { seat: 'management', holderType: 'builtin', holderId: 'shanhai-mgmt', holderName: '山海管理方（候选）' },
      { seat: 'signature', holderType: 'platform', holderId: 'shanhai-signer', holderName: '山海签名服务' },
    ],
    description: '同一场景的"跑到一半"快照：用于演示客户端断开时的措辞。',
    // ★★ **刻意留空** —— 「未归类不藏」：有场景却没归类 ⇒ 界面必须
    //    **单列「未归类」如实展示**。留空一个就是为了让这条被演示到、被断言到。
    category: '',
  },
]

/* ─────────────── GET /scenes 新增两段（契约变更 #17 · 纯追加）─────────────── */
/*
 * ★★ 这两段是新增消费的（设计答复「**消费**」）。
 *   目的（他的原话）：**让客户先认出场合，而不是先学术语**。
 *
 * ★ 严格遵守他给的三条约束：
 *   1. `when` 是**「对什么场合推荐」**，不是「高频/热门」⇒ 界面上**不许**出现
 *      「热门 / 多数人 / 大家都在用」类措辞（**没有统计依据，写了就是编**）。
 *   2. **空分类不出**：某分类一个场景都没有 ⇒ 响应里就不会有它
 *      ⇒ 客户端**按响应渲染，不自己判空**。所以这份 fixtures 里
 *      `categories` 只列**真有场景的**两个（daily_selfcheck / standard_review）——
 *      刻意不放 `content_creation` / `tech_dev` / `project_eval` / `custom`。
 *   3. **未归类不藏**：`opening-audit-live` 的 `category` 留空 ⇒ 界面必须单列「未归类」。
 */

export const MOCK_SCENE_CATEGORIES: SceneCategory[] = [
  {
    key: 'daily_selfcheck',
    label: '日常自查',
    intent: '东西已经写好了/做好了，想有人先帮我看一眼',
  },
  {
    key: 'standard_review',
    label: '标准审查',
    intent: '要正式过一遍，出个能拿出去的结论',
  },
]

export const MOCK_SCENE_RECOMMENDATIONS: SceneRecommendation[] = [
  {
    key: 'quick_check',
    label: '快速看一眼',
    when: '就一个东西，想快点知道有没有硬伤',
    outputLevel: 'light',
  },
  {
    key: 'full_review',
    label: '完整会商',
    when: '重要的事，想几个审核面一起看',
    outputLevel: 'standard',
  },
]

/* ───────────────── POST /scene/{id}/run 的事件序列 ───────────────── */
/*
 * ★ 顺序严格按契约 sse-events.json：
 *   start → (round_start → lamp_start/lamp_delta×N/lamp_done → round_done)+ → summary → usage → done
 *
 * ★ `start.lamps` = **本次实际参与**的维度（`dims` 裁剪后的结果）——
 *   所以被裁掉的那**一个审核面**不出现在这里，它只会出现在 `summary.skippedDims`。
 */

const AT = '2026-10-05T12:00:00+08:00'

/** ① 开铺审计 · 标准 —— ★ 两轮（第 2 轮是回炉）+ 一个审核面被裁剪 + 一个待接入 */
const RUN_OPENING_AUDIT: SceneRunEvent[] = [
  { event: 'start', requestId: 'req-mock-0001', scene: 'opening-audit', lamps: ['智灯', '匠灯', '戒灯'], serverTime: AT },

  { event: 'round_start', round: 1, reason: '首轮' },
  { event: 'lamp_start', round: 1, lamp: '智灯', agent: '主体核验方' },
  { event: 'lamp_delta', round: 1, lamp: '智灯', text: '比对营业执照与主体信息…' },
  { event: 'lamp_delta', round: 1, lamp: '智灯', text: '经营范围一栏与申请书不一致。' },
  { event: 'lamp_done', round: 1, lamp: '智灯', verdict: '⚡有条件', detail: '证照影像缺一页，需补件后复核。', latencyMs: 1840 },
  { event: 'lamp_start', round: 1, lamp: '匠灯', agent: '权责确认方' },
  { event: 'lamp_delta', round: 1, lamp: '匠灯', text: '核对签署人与权责边界…' },
  { event: 'lamp_done', round: 1, lamp: '匠灯', verdict: '✅通过', detail: '签署人与权责边界一致。', latencyMs: 1210 },
  { event: 'lamp_start', round: 1, lamp: '戒灯', agent: '留痕审计方' },
  { event: 'lamp_delta', round: 1, lamp: '戒灯', text: '逐条核对过程留痕…' },
  { event: 'lamp_done', round: 1, lamp: '戒灯', verdict: '✅通过', detail: '留痕完整、可追溯。', latencyMs: 960 },
  { event: 'round_done', round: 1, verdict: '⚡有条件' },

  // ★★ 回炉（契约变更 #2）：R2 要求界面按「第 N 轮」分段、**不合并成一条流水**
  { event: 'round_start', round: 2, reason: '⚡有条件回炉' },
  { event: 'lamp_start', round: 2, lamp: '智灯', agent: '主体核验方' },
  { event: 'lamp_delta', round: 2, lamp: '智灯', text: '补件已收到，重新核验…' },
  { event: 'lamp_done', round: 2, lamp: '智灯', verdict: '✅通过', detail: '补件核验通过。', latencyMs: 1420 },
  { event: 'lamp_start', round: 2, lamp: '匠灯', agent: '权责确认方' },
  { event: 'lamp_delta', round: 2, lamp: '匠灯', text: '复核权责边界（第 2 轮）…' },
  { event: 'lamp_done', round: 2, lamp: '匠灯', verdict: '✅通过', detail: '复核通过。', latencyMs: 880 },
  { event: 'lamp_start', round: 2, lamp: '戒灯', agent: '留痕审计方' },
  { event: 'lamp_delta', round: 2, lamp: '戒灯', text: '复核留痕（第 2 轮）…' },
  { event: 'lamp_done', round: 2, lamp: '戒灯', verdict: '✅通过', detail: '复核通过。', latencyMs: 740 },
  { event: 'round_done', round: 2, verdict: '✅通过' },

  {
    event: 'summary',
    verdict: '✅通过',
    conditions: ['补件已核验（第 2 轮）'],
    round: 2,
    participatedDims: ['智灯', '匠灯', '戒灯'],
    // ★ 报告**不能**给出"审全了"的错觉 ⇒ 这一项必须在报告里可见
    skippedDims: ['仁灯'],
  },
  { event: 'usage', tokensIn: 12840, tokensOut: 3160, credits: 12, balanceAfter: 488 },
  { event: 'done', finishReason: 'completed' },
]

/** ② 预约核验 · 需外部预约 —— ★ 覆盖 ❌驳回（abort） */
const RUN_RESERVATION: SceneRunEvent[] = [
  { event: 'start', requestId: 'req-mock-0002', scene: 'reservation-audit', lamps: ['智灯', '戒灯'], serverTime: AT },
  { event: 'round_start', round: 1, reason: '首轮' },
  { event: 'lamp_start', round: 1, lamp: '智灯', agent: '主体核验方' },
  { event: 'lamp_delta', round: 1, lamp: '智灯', text: '核验预约单与主体信息…' },
  { event: 'lamp_done', round: 1, lamp: '智灯', verdict: '❌驳回', detail: '预约单主体与申请主体不一致。', latencyMs: 1560 },
  { event: 'lamp_start', round: 1, lamp: '戒灯', agent: '留痕审计方' },
  { event: 'lamp_delta', round: 1, lamp: '戒灯', text: '中止前留痕已封存。' },
  { event: 'lamp_done', round: 1, lamp: '戒灯', verdict: '❌驳回', detail: '随主判定一并中止。', latencyMs: 520 },
  { event: 'round_done', round: 1, verdict: '❌驳回' },
  {
    event: 'summary',
    verdict: '❌驳回',
    conditions: [],
    round: 1,
    participatedDims: ['智灯', '戒灯'],
    skippedDims: ['仁灯'],
  },
  { event: 'usage', tokensIn: 5240, tokensOut: 1180, credits: 5, balanceAfter: 483 },
  { event: 'done', finishReason: 'aborted' },
]

/** ③ 资料预检 —— ★ 覆盖 ⛔拒收（不收费） */
const RUN_PRECHECK: SceneRunEvent[] = [
  { event: 'start', requestId: 'req-mock-0003', scene: 'material-precheck', lamps: ['智灯', '戒灯'], serverTime: AT },
  { event: 'round_start', round: 1, reason: '首轮' },
  { event: 'lamp_start', round: 1, lamp: '智灯', agent: '主体核验方' },
  { event: 'lamp_delta', round: 1, lamp: '智灯', text: '逐项核对进件材料清单…' },
  { event: 'lamp_done', round: 1, lamp: '智灯', verdict: '✅通过', detail: '材料齐备。', latencyMs: 640 },
  { event: 'lamp_start', round: 1, lamp: '戒灯', agent: '留痕审计方' },
  { event: 'lamp_delta', round: 1, lamp: '戒灯', text: '检查留痕链…发现断点。' },
  { event: 'lamp_done', round: 1, lamp: '戒灯', verdict: '⛔拒收', detail: '留痕链存在断点，不予受理。', latencyMs: 700 },
  { event: 'round_done', round: 1, verdict: '⛔拒收' },
  {
    event: 'summary',
    verdict: '⛔拒收',
    conditions: [],
    round: 1,
    participatedDims: ['智灯', '戒灯'],
    skippedDims: [],
  },
  // ★ 契约：「⛔拒收 ⇒ 不收费」⇒ credits = 0，且余额不动。
  { event: 'usage', tokensIn: 3120, tokensOut: 620, credits: 0, balanceAfter: 483 },
  { event: 'done', finishReason: 'refused' },
]

/**
 * ④ 开铺审计 · 进行中 —— **只到第 1 轮中段就断**。
 * 用途：界面处于 `running`，可演示 R5「断开 = 已停止接收（不写已取消）」。
 */
const RUN_LIVE: SceneRunEvent[] = [
  { event: 'start', requestId: 'req-mock-0004', scene: 'opening-audit-live', lamps: ['智灯', '匠灯', '戒灯'], serverTime: AT },
  { event: 'round_start', round: 1, reason: '首轮' },
  { event: 'lamp_start', round: 1, lamp: '智灯', agent: '主体核验方' },
  { event: 'lamp_delta', round: 1, lamp: '智灯', text: '比对营业执照与主体信息…' },
  { event: 'lamp_done', round: 1, lamp: '智灯', verdict: '✅通过', detail: '主体信息一致。', latencyMs: 1320 },
  { event: 'lamp_start', round: 1, lamp: '匠灯', agent: '权责确认方' },
  { event: 'lamp_delta', round: 1, lamp: '匠灯', text: '核对签署人与权责边界…' },
  // ← 事件到此为止：仍在 running
]

/** scene → 事件序列。**没有条目的场景 = 未运行**（不是错误态）。 */
export const MOCK_RUNS: Record<string, SceneRunEvent[]> = {
  'opening-audit': RUN_OPENING_AUDIT,
  'reservation-audit': RUN_RESERVATION,
  'material-precheck': RUN_PRECHECK,
  'opening-audit-live': RUN_LIVE,
}

/* ────────────────── 三条必须显示的约束（对应的数据） ────────────────── */

/**
 * ★ 约束 ①：报告**无签名** ⇒ 界面必须醒目提示。
 *
 * 这里**恒为 `null`（未签名）**，而且是**刻意的**：
 * 签名只能由服务端给出，而演示数据根本不来自服务端 ——
 * 显示"已签名"就是撒谎（官方 `contributing.md`：呈现也不能夸大）。
 * 如实显示未签名，既符合事实，也顺手把"这是演示数据"再说清一遍。
 */
export const MOCK_SIGNATURE: null = null

/** 角色位变更记录（约束 ②：变更必须有记录 + 原因，可追溯） */
export interface SeatChangeRecord {
  seat: string
  from: string
  to: string
  reason: string
  at: string
  by: string
}

export const MOCK_SEAT_CHANGES: Record<string, SeatChangeRecord[]> = {
  'opening-audit': [
    {
      seat: '执行位',
      from: '（空）',
      to: '主体核验方',
      reason: '首次接入',
      at: '2026-10-01 10:12',
      by: '铺主',
    },
    {
      seat: '执行位',
      from: '主体核验方',
      to: '权责确认方',
      reason: '原执行方连续两次超时，改由权责确认方承担',
      at: '2026-10-03 16:40',
      by: '铺主',
    },
  ],
  'reservation-audit': [
    {
      seat: '审计位',
      from: '（空）',
      to: '留痕审计方',
      reason: '首次接入',
      at: '2026-10-02 09:05',
      by: '铺主',
    },
  ],
}

/** 没有变更记录的场景返回空数组（**不是错误态**，界面显「尚无变更记录」） */
export function seatChangesOf(scene: string): SeatChangeRecord[] {
  return MOCK_SEAT_CHANGES[scene] ?? []
}

/**
 * 错误的 `detail`（**只有两个"另走一条路"的码需要**）。
 *
 * ★★ 为什么必须有这张表：契约里那两个码的 `clientAction` 是「**按 `detail.poll` 切到查询接口**」
 *    「按 `detail.requiresExternal` 显示该场景需进场」「带 `availableAt` 就必须一并显示」。
 *    **没有 detail 就没有出路** —— 界面只能干说一句"这一单已经在跑了，别急"，用户仍然什么也做不了。
 *    （这是实测抓到的真实缺口：接线初版漏了 detail。）
 *
 * 形状照抄契约的 `detailShape` 字段：
 *   duplicate_request → { "state": "running", "poll": "/scene/run/{requestId}" }
 *   not_checked_in    → { "requiresExternal": true, "availableAt": "<ISO8601>" }
 *
 * ★ `availableAt` 用**固定值**（确定性纪律）：判据要能断言到具体字面量。
 *   日期取了一个明确的时间点，避免"跑的时候刚好跨天"导致断言飘。
 */
export const MOCK_ERROR_DETAIL: Record<string, Record<string, unknown>> = {
  duplicate_request: { state: 'running', poll: '/scene/run/req-mock-0001' },
  not_checked_in: { requiresExternal: true, availableAt: '2026-10-06T09:30:00+08:00' },
}

export function errorDetailOf(code: string | null): Record<string, unknown> | undefined {
  return code === null ? undefined : MOCK_ERROR_DETAIL[code]
}
