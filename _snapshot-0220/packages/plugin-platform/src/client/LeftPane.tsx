/**
 * 山海·开铺 · 场地插件 · 左栏 = **总台**
 * =====================================================================
 * 三段：**执行方**（Agent 卡片）+ **场景**（按分类分组）+ **推荐**。
 *
 * ★ 两条"用户可见面"的硬要求（都在这里落）：
 *   1. `AgentCard.status` ⇒ **三态**（2026-10-05 修：原以为两态）：
 *        · `disabled` **灰显「已停用」且不许点** —— 契约 §3.1 写明要返回全部（含 disabled）
 *          就是为了让人**看见被关掉了**，看不见的话，用户会以为是自己出错。
 *        · `pending`  **显「待接入」、不灰显** —— 契约 v1.3 §23.4 新增：占地未接入（正常态）。
 *          ★ 它**不是** `disabled`：前者"还没人接"、后者"有人关掉了"，
 *          下一步动作完全不同（去接入 vs 去问为什么）。**混了就是编事实。**
 *   2. `SceneLamp.agentId === null` ⇒ 该维度**待接入**。这里在场景卡片上显示
 *      「待接入 N」，让"这场戏缺人"在**进场景之前**就看得见。
 *
 * ★★ 契约变更 #17（本轮新消费）：场景**按分类分组** + 顶部**推荐位**。
 *   目的：**让客户先认出场合，而不是先学术语**。
 *   三条纪律（他给的，逐条落在这里）：
 *     · `when` = 「**适合什么场合**」⇒ 界面上**禁止**出现「热门 / 多数人 /
 *       大家都在用」类措辞（**没有统计依据，写了就是编**）；
 *     · **空分类不出** ⇒ 按响应渲染，不自己判空；
 *     · **未归类不藏** ⇒ 有场景却没归类，**单列「未归类」如实展示**。
 */
import { useEffect, useRef, useState, type ReactNode, type ReactElement } from 'react'
import type { AgentCard, SceneCard, SceneCategory, SceneRecommendation } from '@shanhai/kaipu-contract'
import { C, FS } from './theme.js'

/**
 * ★★ 左栏**卡片语言**（2026-10-18 · 发起人：「这个卡片密度合适…其他的也按照这个思路走」）。
 *
 * 一处定义、四处引用（执行方卡 / 场景卡 / 推荐卡 / 空态卡）——
 * 卡片化最容易翻车的地方不是"每张卡好不好看"，而是**几张卡的圆角/缩进/内边距各差 1px**，
 * 一排下来就是"歪"。所以宽度、缩进、内边距、描边、圆角全部收在这里，一个数都不外泄。
 *
 * ★ `width: calc(100% - 20px)` + `margin: 0 10px` + `boxSizing: border-box`
 *   ⇒ 卡片两侧各留 10px，总宽恒等于栏宽（260px 档不会顶出横向滚动条）。
 * ★ 圆角 10：与参照件的卡片同档；再大就变成"气泡"，在 260px 里显胖。
 */
const CARD = {
  boxSizing: 'border-box',
  width: 'calc(100% - 20px)',
  margin: '6px 10px 0',
  padding: '8px 11px',
  border: `1px solid ${C.border}`,
  borderRadius: 10,
} as const

export interface LeftPaneProps {
  agents: readonly AgentCard[]
  scenes: readonly SceneCard[]
  categories: readonly SceneCategoryRow[]
  recommendations: readonly SceneRecommendation[]
  selected: string | null
  onSelect: (scene: string) => void
  /**
   * ★★ 这一块**渲染在哪儿**（2026-10-08）—— 决定根节点挂哪个判据锚点。
   *
   *   · `'left'`（默认）= 宽屏左栏 ⇒ `data-kaipu-left`
   *   · `'picker'`      = 窄屏顶部的「场景」折叠条 ⇒ `data-kaipu-scene-picker-body`
   *
   * ★★ 为什么**不能共用一个锚点**（这不是洁癖，是判据正确性问题）：
   *   探针要断一条**反向**断言 ——「窄屏下左栏不在（`[data-kaipu-left]` 为 null）」，
   *   它是"窄屏确实折了左栏"的证明。若窄屏那份也挂 `data-kaipu-left`，
   *   这条断言就**永远为假**（恒红）；而如果谁图省事把它改成 `>= 1`，
   *   它就变成**恒真** —— 两种都不再是判据。
   *   ⇒ 位置是**两个不同的东西**，锚点就该是两个不同的名字。
   *
   * ★ 复用同一个组件而不是各写一套：一块内容两处渲染，
   *   免得"窄屏那份"慢慢长歪（少一个推荐位、少一个「待接入 N」都没人发现）。
   */
  where?: 'left' | 'picker'
  /**
   * ★★ 把「场景」这块**提到最前**（2026-10-08 · 拍板 §一）。
   *
   * 只给**窄屏折叠条**用（`NarrowScenePicker` 传 `true`），宽屏**不动**：
   *   · 窄屏那条折叠条的本职就是"选场景"（它为什么存在，见"窄屏入口"那次）。
   *     而实测（100）：框高 320 / 内容高 585，**场景列表起点 341px > 框高**
   *     ⇒ 点开折叠条，"要选的东西整个在第一屏之外" —— 得先滚过执行方与推荐位。
   *   · 宽屏**不改**：那里左栏常驻、内容高 659 < 视口 769（富余 110，本来不用滚），
   *     而「该怎么选」是**选的依据**，移到最后就变成"选完才看到" ——
   *     那是取舍不是优化（100 §六 反方已如实摆给发起人）。
   * ⇒ 同一份内容、**两种顺序**，由这一位开关决定；行为差异写在这里，不靠读的人猜。
   */
  sceneFirst?: boolean
}

/**
 * 「当前是哪一场」—— 收起态下的**唯一**坐标（2026-10-08 · 拍板 §一 加的那条）。
 *
 * ★★ 原文：「选完自动收起之后，当前选中项要留在折叠条上可见。不能选完就消失。」
 *   ⇒ 这件事在**两个地方**都要成立（这正是本条要求"宽屏也一致"的落法）：
 *     · 窄屏 ⇒ 折叠条的 `summary`（收起时只看得到这一行）
 *     · 宽屏 ⇒ 左栏「场景」小节标题行（分类可能被折叠，光靠行高亮不够稳）
 *
 * ★★ 两处**共用同一个锚点** `data-kaipu-scene-current` —— 这次是**对的**，
 *   与 `where` 那两条锚点为什么必须分开并不矛盾：
 *     · `data-kaipu-left` / `data-kaipu-scene-picker-body` 争的是"**左栏在不在**"
 *       （反向断言要断"窄屏下它不在"）⇒ 共用必假。
 *     · 本锚点争的是"**当前所选有没有被显示出来**"，而两处**永远不会同时在页面上**
 *       （窄屏不渲染左栏、宽屏不渲染折叠条）⇒ 任何宽度下它恰好出现**一次**，
 *       判据只需读"那一个"，反而更干净。
 *   ★ 这条区别（"同时存在与否"）才是判断"能不能共用锚点"的依据，
 *     不是"锚点名字看起来像不像"。
 */
export function SceneCurrent({
  scenes,
  selected,
}: {
  scenes: readonly SceneCard[]
  selected: string | null
}): ReactElement {
  const current = scenes.find((s) => s.scene === selected) ?? null
  return (
    <span data-kaipu-scene-current="1" style={{ color: C.text }}>
      {current === null ? '（未选）' : current.label}
    </span>
  )
}

/**
 * 契约 `SceneCategory` + **服务端实测多给的两个字段**（差异单已登记，契约变更由出件方发起）。
 *   · `scenes` —— 该分类下的场景 key 列表（★ 分组**优先用它**，见 `groupScenes`）
 *   · `count`  —— 成员数（与 `scenes.length` 应当一致；不一致时以 `scenes` 为准）
 */
export type SceneCategoryRow = SceneCategory & {
  scenes?: readonly string[]
  count?: number
}

/**
 * 分组（**纯函数** —— 便于判据直接断言分组结果，而不只看渲染出来的样子）。
 *
 * ★★ 权威顺序（2026-10-05 联调实测后定的）：**`categories[].scenes` 优先**，
 *   其次才是单场景自述的 `scene.category`，两者都没有 ⇒ 未归类。
 *
 *   为什么不能只看 `scene.category`（实测反例）：
 *     真服务端 `GET /scenes` 里，`multi-dim-review` **一边被列入
 *     `categories[standard_review].scenes`（count=1），一边自己的 `category` 是空串**。
 *     ⇒ 只看 `scene.category` 的后果：那个场景被塞进「未归类」，而「标准审查」
 *       这一组因为**组内空**被下面的 `filter` 滤掉 ⇒ **整组消失**。
 *   ⇒ 规则：**冗余字段打架时，取信息量大的那个，并保证"内容不丢"**。
 *     （这条已作为差异单提请对方明确权威字段；在那之前，本读法两种形态都成立。）
 */
export function groupScenes(
  scenes: readonly SceneCard[],
  categories: readonly SceneCategoryRow[],
): { groups: { key: string; label: string; intent: string; scenes: SceneCard[] }[]; unclassified: SceneCard[] } {
  // ① 显式成员表：scene → 分类 key（后写覆盖先写，但正常不会有重复）
  const declared = new Map<string, string>()
  for (const c of categories) for (const s of c.scenes ?? []) declared.set(s, c.key)

  const groups = categories.map((c) => ({ key: c.key, label: c.label, intent: c.intent, scenes: [] as SceneCard[] }))
  const byKey = new Map(groups.map((g) => [g.key, g]))
  const unclassified: SceneCard[] = []
  for (const s of scenes) {
    const key = declared.get(s.scene) ?? (s.category ?? '')
    const g = key === '' ? undefined : byKey.get(key)
    if (g === undefined) unclassified.push(s)
    else g.scenes.push(s)
  }
  return { groups: groups.filter((g) => g.scenes.length > 0), unclassified }
}

export function LeftPane({
  agents,
  scenes,
  categories,
  recommendations,
  selected,
  onSelect,
  where = 'left',
  sceneFirst = false,
}: LeftPaneProps): ReactElement {
  const { groups, unclassified } = groupScenes(scenes, categories)
  const pendingAgents = agents.filter((agent) => agent.status === 'pending').length
  const disabledAgents = agents.filter((agent) => agent.status === 'disabled').length

  /**
   * ── 三块各自成块，再按 `sceneFirst` 决定顺序（2026-10-08 · 107「方案 D」）──
   * ★ 为什么拆成变量而不是写三遍 JSX：写三遍就是**三份内容**，改一处必漏另一处。
   *   这里拆的是**顺序与容器**，内容只有一份。
   */
  const agentsBlock = (
    <PaneBlock
      id="agents"
      // ★★ 双向对齐：界面加括注，对齐介绍「Agent 目录」。
      //   显示文案带括注，判据锚点仍用 `sectValue="执行方"`（解耦，探针零改）。
      title="执行方（Agent 目录）"
      sectValue="执行方"
      icon="📂"
      hint="已接入的执行方及其状态。标「待接入」的还没人接，灰掉的是被关掉了。"
      // ★ 收起态也要能一眼看出"有几家"（同收起点写着当前是哪一场的口径）
      aside={
        <span data-kaipu-agent-summary="1" style={{ color: C.dim, overflowWrap: 'anywhere' }}>
          （{agents.length}
          {pendingAgents > 0 && ` · ${pendingAgents} 待接入`}
          {disabledAgents > 0 && ` · ${disabledAgents} 已停用`}
          {agents.length === 0 && ' · 待接入'}）
        </span>
      }
      // 初始收起让位于场景；PaneBlock 的用户展开状态不随数据刷新重置。
      defaultOpen={false}
    >
      {/*
        ★★ 零接入时**明确**显示「待接入」（空态占位）。
        介绍原文是双重承诺 ——「场地自身不带执行方；一个都没接入时显示待接入」。
        只列已有 Agent 是半个承诺；空态给一句如实说明
        （不编事实：场地可用、接入后此处列出各 Agent 及其状态）。
      */}
      {agents.length === 0 ? (
        /**
         * ★★ 空态也走卡片语言（2026-10-18）：**虚线**描边 ——
         *   同样是"一块有边界的东西"，但虚线说的是"这里还空着"，
         *   与实线卡片的"这里坐着一个"形成对照。比一行裸文字更能说明"该往这儿放东西"。
         */
        <div
          data-kaipu-agent-empty="1"
          style={{
            ...CARD,
            border: `1px dashed ${C.border}`,
            background: 'transparent',
            fontSize: FS.tag,
            color: C.dim,
            lineHeight: 1.6,
          }}
        >
          本铺尚未接入任何执行方（待接入）—— 场地照常可用，接入后此处会列出各 Agent 及其状态。
        </div>
      ) : (
        agents.map((a) => <AgentRow key={a.id} agent={a} />)
      )}
    </PaneBlock>
  )

  /* ★ 推荐位：**说「适合什么场合」，不说「热门」** —— 后者需要统计依据 */
  const recommendBlock = recommendations.length > 0 && (
    <PaneBlock
      id="recommend"
      title="该怎么选"
      icon="📂"
      hint="按场合提供选择参考。请根据适用说明，在「场景」中选择；推荐名称不一定与场景同名。"
      aside={<span style={{ color: C.dim }}>（{recommendations.length}）</span>}
      defaultOpen={false}
    >
      {/* ★ `data-kaipu-recommend` 保留在这一层（判据认它；换父级不改锚点名） */}
      <div data-kaipu-recommend="1">
        {/*
          ★★ 每一条推荐 → **一张卡**（2026-10-18 卡片化）。
          ★ 为什么不带 logo 块：执行方卡的色块装的是**名字首字**（身份标识）；
            推荐条目的 `label` 是"场合名"而不是实体，硬塞首字会看着像又一个 Agent。
            ⇒ 统一的只是**外壳**（描边/圆角/内边距/名称加粗 + 元信息小字），不硬搬身份件。
          ★ 推荐**不可点**：`label` 与 `scene` 不一定同名（hint 里已写明），
            做成按钮等于暗示"点了就选好了" —— 那是编交互。
        */}
        {recommendations.map((r) => (
          <div key={r.key} style={CARD}>
            <div style={{ fontSize: FS.title, fontWeight: 600 }}>{r.label}</div>
            <div style={{ marginTop: 2, fontSize: FS.tag, color: C.dim, lineHeight: 1.6 }}>
              适合：{r.when}
            </div>
          </div>
        ))}
      </div>
    </PaneBlock>
  )

  const scenesBlock = (
    <PaneBlock
      id="scenes"
      title="场景"
      icon="📂"
      hint="选一场，右侧看它的运行与结论。"
      /**
       * ★★ 宽屏：在「场景」标题行显示**当前是哪一场**（§一"确保宽屏也一致"）。
       *   ★ 为什么仅 `where === 'left'`：窄屏那份由折叠条 `summary` 显示
       *     （`SceneCurrent` 的注释里写了"两处永远不会同时出现"）——
       *     展开区里再显示一次就是同一句话在同一屏出现两遍。
       */
      aside={where === 'left' ? <SceneCurrent scenes={scenes} selected={selected} /> : undefined}
      /**
       * ★★ **场景块默认展开**（`107` 方案 D）——
       *   它是左栏的本职（"选一场"）；另两块收起是为了**把空间让给它**。
       */
      defaultOpen
    >

      {groups.map((g, gi) => (
        <CategoryGroup
          key={g.key}
          group={g}
          first={gi === 0}
          selected={selected}
          onSelect={onSelect}
        />
      ))}

      {/*
        ★★ 契约「未归类不藏」：如实展示，**不许**藏起来或塞进别的组。
        ★ 而且这一组**不加折叠**（2026-10-05 定）：
          `#17` 的原文是"**未归类不藏**" —— 给它套一个默认折叠的 `<details>`，
          等于"东西还在，但你得先点一下才看得见"，**那就是藏**。
          ⇒ 别处的便利（折叠）不能拿来牺牲这一条。
      */}
      {unclassified.length > 0 && (
        /**
         * ★ 与上面分类**同款组名形态**（2026-10-18 统一）：名称 + 数量 pill。
         *   `borderTop` 保留 —— 它隔的是"分类区 vs 非分类区"（语义边界），不是同类兄弟。
         */
        <div
          data-kaipu-category="__unclassified__"
          style={{ borderTop: `1px solid ${C.border}`, marginTop: 8, paddingTop: 2 }}
        >
          <div style={{ padding: '6px 12px 2px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', columnGap: 6 }}>
              <span style={{ fontSize: FS.tag, fontWeight: 600, color: C.text }}>未归类</span>
              <span
                style={{
                  fontSize: FS.tag,
                  lineHeight: '16px',
                  padding: '0 6px',
                  borderRadius: 999,
                  background: C.soft,
                  color: C.dim,
                  flex: '0 0 auto',
                }}
              >
                {unclassified.length}
              </span>
              {/*
                ★ 那句"如实列出，不藏"**收进悬停提示**（2026-10-05 瘦身）。
                  它是对**契约 #17** 的交代（给评审看的），不是给客户看的信息 ——
                  而"没藏"这件事，**场景列在这里本身就是证明**，不需要再写一句声明。
                  ★ 组名与场景行**一个字没动**（契约 #17 是"未归类不藏"，
                    判据断的也是组名在场 ⇒ 只收声明，不动内容）。
              */}
              <span
                title="契约 #17「未归类不藏」：还没归到某个场合的场景，如实列出，不塞进别的组。"
                aria-hidden="true"
                style={{ marginLeft: 'auto', flex: '0 0 auto', color: C.faint, cursor: 'help' }}
              >
                ⓘ
              </span>
            </div>
          </div>
          {unclassified.map((s) => (
            <SceneRow key={s.scene} scene={s} active={s.scene === selected} onSelect={onSelect} />
          ))}
        </div>
      )}
    </PaneBlock>
  )

  return (
    // ★ `data-kaipu-left` = 左栏的**判据锚点**。
    //   为什么不靠文案断言（2026-10-05 修 `panel-probe` 时立的教训）：
    //   探针原来找的是字符串「场景 / 运行记录」—— 那是**旧版面板的文案**，
    //   面板改版后判据**却一直没人发现**（它只是在报"左栏未渲染"，
    //   看起来像界面坏了，实际是判据自己过期了）。
    //   ⇒ 锚在**结构**上，文案怎么改都不会误报。
    //   ★★ 窄屏那份（`where='picker'`）**不挂这个锚点**，改挂
    //      `data-kaipu-scene-picker-body` —— 理由见 Props 里那一段（判据正确性）。
    <div
      {...(where === 'picker' ? { 'data-kaipu-scene-picker-body': '1' } : { 'data-kaipu-left': '1' })}
      style={{ padding: '12px 0 18px' }}
    >
      {/**
        * ★★ 顺序（`107` 方案 D）：
        *   · 宽屏：**执行方 → 该怎么选 → 场景**（保持原顺序 —— 场景块默认展开，
        *     收起的参考两块在上面，等于"参考在上、主体在下"，读起来是"先看背景、再看要选的"）
        *   · 窄屏：`sceneFirst` ⇒ **场景在最前**（拍板：这个框的本职就是选场景）
        */}
      {sceneFirst ? (
        <>
          {scenesBlock}
          {agentsBlock}
          {recommendBlock}
        </>
      ) : (
        <>
          {agentsBlock}
          {recommendBlock}
          {scenesBlock}
        </>
      )}
    </div>
  )
}

/**
 * ★★ **三块折叠容器**（2026-10-08 · `107` · 方案 D）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 它解决什么（实测支撑，不是观感）
 * ══════════════════════════════════════════════════════════════════
 *   左栏三块 = 执行方(235) + 该怎么选(111) + 场景(299+分类)。
 *   「想看全部场景」（分类全展开）时内容高 **909px**，而常见窗高下可用只有 649~869
 *   ⇒ **任何常见窗口都要滚**（连 1000 高的窗口也要滚 40px）。
 *   把参考两块收成标题行 ⇒ 内容高 **618px** ⇒ 窗高 ≥740 就不用滚。
 *
 * ★★ 为什么"可多开"而不是"互斥单开"（同一批实测）：
 *   · 互斥：点开一块 ⇒ 另一块**被收走**，场景标题还**上移 112px**（想回头看要重新点回来）
 *   · 多开：点开一块 ⇒ 另一块只是**往下挪**，**内容仍在原位**
 *   ⇒ 收益完全相同（都拿到 618px），但互斥多付"位置跳动 + 内容消失"。
 *
 * ★★ 三条实现要点（每条都对着一处会出事的场景）：
 *   ① **顺序：块在前、分类在后** —— 场景块里**还有一层**分类折叠。
 *      若分类默认收起，手风琴下"看场景"要**两次点击**（先点块、再点分类）。
 *      本方案把分类改成**默认展开**（见下面 `CategoryGroup`），首屏 0 次点击就能选场。
 *   ② **`open` 走 state（受控）** ，但**只在用户动作里改**（`onToggle`）——
 *      这样"数据刷新不会把它弹回去"这条性质**仍然成立**（state 不受数据变化影响）。
 *      ★ 与 `103` 窄屏折叠条同款做法。
 *   ③ **`data-kaipu-sect` 锚点不动**：标题仍是 `SectionTitle`，只是被搬进 `<summary>`。
 *      判据认的是这个名字 ⇒ 换父级不改锚点名（本仓纪律：锚点锚结构，不锚层级）。
 */
function PaneBlock({
  id,
  title,
  hint,
  icon,
  aside,
  defaultOpen,
  divider = false,
  sectValue,
  children,
}: {
  id: 'agents' | 'recommend' | 'scenes'
  title: string
  hint: string
  /** ★ `exactOptionalPropertyTypes` 下要显式允许 `undefined`（否则"传了个 undefined"都过不了） */
  icon?: string | undefined
  aside?: ReactNode
  defaultOpen: boolean
  divider?: boolean
  /**
   * ★★ 对齐 ADR：判据锚点值**解耦**自显示文案。
   *   传给 `SectionTitle.sectValue`，使 `data-kaipu-sect` 用这个值（如「执行方」），
   *   而 `title` 可带括注（如「执行方（Agent 目录）」）—— 改界面文案时探针零改。
   */
  sectValue?: string | undefined
  children: ReactNode
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      data-kaipu-block={id}
      open={open}
      // ★ 只在用户动作里改 state（见上面要点 ②）；程序化赋值也会到这里，但值相同 ⇒ 无副作用
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{
        padding: 0,
        ...(divider ? { borderTop: `1px solid ${C.border}` } : {}),
      }}
    >
      {/*
        ★ `listStyle:'none'` 抹掉浏览器默认的三角 —— 我们自绘一个 ▸/▾（在 `SectionTitle` 里），
          因为它能**跟着 open 翻转**（默认 marker 的位置/大小不受我们控制）。
      */}
      {/* ★★ 收起时 hint 不渲染（省高度），但**挂到 title 上**——悬停仍能读到，
          信息不丢。这是「收起=省地方，但别让人不知道这块是什么」的折中。 */}
      <summary style={{ listStyle: 'none', cursor: 'pointer' }} title={open ? undefined : hint}>
        <SectionTitle
          icon={icon}
          hint={hint}
          hintVisible={open}
          aside={aside}
          chevron={open ? '▾' : '▸'}
          sectValue={sectValue}
        >
          {title}
        </SectionTitle>
      </summary>
      {/*
        ★ 块尾留 6px（2026-10-18 卡片化）：卡片自带 `margin-top`、不带下边距，
          最后一张会紧贴下一块的标题行 ⇒ 统一在这里补一格，别在每张卡上加（会叠）。
      */}
      <div style={{ paddingBottom: 6 }}>{children}</div>
    </details>
  )
}

/**
 * **场景分类一组**（2026-10-08 · `107` 从 `LeftPane` 里抽出来 —— 因为要挂 hook）。
 *
 * ★★ 为什么抽组件：它需要 `ref` + 挂载时设一次 `open`（见下），而 hook **不能写在 map 循环里**。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 默认**展开**（`107` 改 · 原来是默认收起）
 * ══════════════════════════════════════════════════════════════════
 *   实测（107）：3 个分类默认收起 ⇒ **5 个场景行里只有 2 个可见**
 *   ⇒ 左栏的本职是"选一场"，而"要选的那些场"**一半藏在折叠里**，要先点分类。
 *   ★ 空间本来就够：场景块可用 618px（`107` 方案 D 下），放得下"分类全展开"的内容。
 *   ⇒ 与 `107` 的三块折叠配合：**外层三块可折（参考收起）＋ 内层分类默认展开**，
 *     首屏 0 次点击就能直接选场。
 *
 * ★★ 为什么用 `ref` + **空依赖** effect 设 `open`（而不是写 `<details open>`）：
 *   写 `open` 属性会被 React 当**受控属性**、**每次渲染都设回去** ⇒
 *   用户手动折上之后，下一个数据刷新就把它弹开（本仓 `RoundBlock` 那条注释记过同款坑）。
 *   空依赖 effect ⇒ 只在**挂载那一瞬**设一次，之后交给浏览器；
 *   `key` 稳定（`g.key`）⇒ 数据刷新复用同一节点 ⇒ **用户折上的状态留得住**。
 *
 * ★ 分类**可折叠**这件事本身保留（它是"一页预览"的能力，不是缺陷）：
 *   折起来仍能看到 分类名 · `intent`（客户视角的一句话）· 数量。
 */
function CategoryGroup({
  group,
  first,
  selected,
  onSelect,
}: {
  group: { key: string; label: string; intent: string; scenes: SceneCard[] }
  first: boolean
  selected: string | null
  onSelect: (scene: string) => void
}): ReactElement {
  const ref = useRef<HTMLDetailsElement | null>(null)
  /**
   * ★★ 只为**画折叠符号**而存在（2026-10-18 卡片化）。
   *   ⚠️ 它**不参与** `open` 属性 —— `<details>` 仍是"浏览器自己管开合"，
   *   这一位只跟着 `onToggle` 记一下当前是开着还是合着，好把 `▾` 画成 `▸`。
   *   若拿它去写 `open={open}`，就退化成受控属性 ⇒ 用户手动折上后，
   *   下一次数据刷新会被 React 设回去（本仓 `RoundBlock` 那条注释记过同款坑）。
   */
  const [open, setOpen] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (el !== null) el.open = true
  }, [])
  return (
    /**
     * ★★ V3（2026-10-07 发起人指出"日常自查与标准审查之间多了一根横线"）：
     *   **撤掉分类之间的分隔线，改用留白。**
     *
     * 为什么撤（实测读数，不是感觉）：
     *   真服务端数据下「场景」区只有 **2 个分类**、每个 1 个场景
     *   ⇒ 这一区里同时存在 **3 条横线**（小节标题那条 + 分类间那条 + 未归类那条），
     *     而横线要隔开的内容总共才 4 行 —— **线比内容还密**。
     *   ⇒ 分隔线是"组多到肉眼分不开"时才需要的工具；这里组少，留白足够。
     *   ★ 只撤**分类之间**那条：`未归类` 上方那条**保留** ——
     *     两者性质不同：前者隔"同类兄弟"，后者隔"分类区 vs 非分类区"（是个语义边界）。
     *
     * ★★★ 2026-10-18 卡片化后**留白加大到 8px**（原 4px）：
     *   场景行变成卡片后，卡片自身有描边 ⇒ 组与组之间若还只有 4px，
     *   上一组的最后一张卡与下一组的组名会"粘"在一起，看着像同一组。
     */
    <details
      ref={ref}
      data-kaipu-category={group.key}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ padding: 0, ...(first ? {} : { marginTop: 8 }) }}
    >
      {/*
        ★★ 分类头 = **分组标签**，不是卡片（2026-10-18 · 刻意不套框）。
        理由：卡片化是为了"每条内容有边界"；若分类也画一圈框，里面再放场景卡，
        260px 里就是**框套框**（两道描边 + 两层缩进，可用宽度只剩 ~210px），
        比原来的行形态更挤。⇒ 分组用**无框标签**（名称加粗 + 数量 pill + 折叠符号），
        视觉上是"一组卡片的上方题头"，层级靠字重与留白，不靠线。
        ★ 折叠符号自绘到最右（`listStyle:'none'` 抹掉默认三角）：与三块外层容器同一个语汇。
      */}
      <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '6px 12px 2px' }}>
        {/*
          ★★ V3：分类名 `C.text` → 近黑半粗。
          实测原状是**倒挂**的：分类名比小节标题更亮、两者又同为 12px
          ⇒ 扫读时"分类"压过"场景"这一区名。
          ★ 2026-10-18 再收一档：分类是**组名**（结构），不是内容 ⇒
            用它做"一组卡片的题头"，字重 600、字号仍 12px，不与场景卡里的名称抢 15px。
        */}
        <div style={{ display: 'flex', alignItems: 'baseline', columnGap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: FS.tag, fontWeight: 600, color: C.text }}>{group.label}</span>
          <span
            style={{
              fontSize: FS.tag,
              lineHeight: '16px',
              padding: '0 6px',
              borderRadius: 999,
              background: C.soft,
              color: C.dim,
              flex: '0 0 auto',
            }}
          >
            {group.scenes.length}
          </span>
          <span
            aria-hidden="true"
            style={{ marginLeft: 'auto', fontSize: 10, color: C.faint, flex: '0 0 auto' }}
          >
            {open ? '▾' : '▸'}
          </span>
        </div>
      </summary>
      {/*
        ★ `intent`（"这个场合是干嘛的"）**始终渲染** —— 折叠由 `<details>` 自己隐藏。
        不改成"展开才渲染"：探针展开分类是**直接设 DOM 的 `open`**，不走 React 状态，
        条件渲染会让它在判据眼里永久消失（假失败）。
      */}
      <div style={{ fontSize: FS.tag, color: C.faint, padding: '0 12px 2px', lineHeight: 1.6 }}>
        {group.intent}
      </div>
      {group.scenes.map((s) => (
        <SceneRow key={s.scene} scene={s} active={s.scene === selected} onSelect={onSelect} />
      ))}
    </details>
  )
}

/**
 * ★ 区块标题带一句人话副标题。
 *   原因：左栏原本只有「执行方」「场景」两个词 ——
 *   对第一次打开面板的人来说，这是两个**没有谓语的标签**，不知道点了会发生什么。
 *
 * ★ `divider`（"左栏不如右栏清晰"反馈后加）：
 *   给**大区之间**画一条上分隔线。右栏是靠每个轮次块的 `borderTop` 分开的，
 *   左栏原来只有 padding —— 字号放大之后，**光靠留白已经分不出"这是新的一区"**。
 *   第一个区（执行方）不画线：面板顶部本来就有留白，再画一条会显脏。
 */
function SectionTitle({
  children,
  hint,
  divider = false,
  icon,
  aside,
  chevron,
  /**
   * ★★ 对齐 ADR「文案改，锚点不改」：锚点值**解耦**自显示文案。
   *   显示 `children` 可带括注（如「执行方（Agent 目录）」），而判据锚点
   *   `data-kaipu-sect` 仍用 `sectValue`（如「执行方」）—— 改界面文案时探针零改。
   *   不传则回退到 `children`（其余两块沿用旧锚点值，行为不变）。
   */
  sectValue,
  hintVisible = true,
}: {
  children: string
  hint: string
  divider?: boolean
  /**
   * ★★ UI-V2（2026-10-07 发起人提议）：标题前的**视觉锚点**。
   *
   * 为什么加：发起人反馈"界面不够清晰"。左栏 260px 里堆了多种标题级元素
   * （执行方 / 该怎么选 / 场景 / 分类名 / 未归类），而它们**字号字色几乎一样**
   * ⇒ 扫读时没有一个"这里是新的一区"的落点。
   *
   * ★ 但要说清它**解决什么、不解决什么**（免得当成万能药）：
   *   · 解决：**标题 vs 正文**的分界（符号是比字重更省空间的锚点）
   *   · **不解决**：标题**彼此之间**的分级 —— 每个标题都挂同一个符号，
   *     它们仍然一样重。分级得靠**字号/字色/缩进**。
   * ★ 用**字符**不用图标组件：面板挂在宿主容器里，不引入字体/图标依赖；
   *   且 `aria-hidden` 掉 —— 屏幕阅读器念"符号 + 场景"是噪音，它只需要"场景"。
   */
  icon?: string | undefined
  /**
   * ★ 标题行**右侧**的附加信息（2026-10-08 · 拍板 §一 加的"当前是哪一场"）。
   *
   * 为什么不并进 `children`：`children` 同时是判据锚点 `data-kaipu-sect` 的**值**
   *   （探针按小节名找块）⇒ 往里塞动态内容会让"场景"这个小节名变成"场景 开铺审计 · 标准"，
   *   锚点当场失效。⇒ 分成两处，值只留在 `children`。
   */
  aside?: ReactNode
  /**
   * ★ 折叠指示符（`107`）：`▾` 展开 / `▸` 收起。
   *   ★ 为什么自绘而不用 `<summary>` 的默认三角：默认 marker 的**大小与位置不受我们控制**，
   *     而自绘的能跟着 `open` **翻转**（受控 state ⇒ 能反映真实开合）。
   *   ★ 放在**最右**（`marginLeft: 'auto'`）：左栏 260px 里标题行还有"当前是哪一场"这类内容，
   *     指示符贴右边才不跟内容抢位置。
   *   ★ `aria-hidden`：屏幕阅读器会念 `<summary>` 自身的展开状态，再念一个符号是噪音。
   */
  chevron?: string
  sectValue?: string | undefined
  /**
   * ★★ 说明文字是否显示（2026-10-18 · 左栏瘦身）。
   * `PaneBlock` 传的是自己的 `open` ⇒ **收起不渲染、展开才渲染**。
   * ★ 默认 `true`：没传的地方（若将来有）行为不变。
   */
  hintVisible?: boolean
}): ReactElement {
  return (
    <div
      // ★ 判据锚点：让"小节标题是否带分隔线"可以被断言到，
      //   而不必靠 `> div > div` 这种**层级选择器**（层级一改锚点就飘，2026-10-05 踩过）。
      //   ★ V2 加符号时**没有动它** —— 锚点是给判据用的，不能跟着样式走。
      data-kaipu-sect={sectValue ?? children}
      style={{
        padding: '12px 14px 6px',
        ...(divider ? { borderTop: `1px solid ${C.border}` } : {}),
      }}
    >
      {/*
        ★★ V3：小节标题**加强**（12px 灰常规 → 13px 近黑半粗），把层级扳正。
        实测原状倒挂：小节标题 12px/rgb(138,138,138) < 分类名 12px/rgb(15,17,21)
        < 场景行 15px/rgb(15,17,21) ⇒ **越往里字越大越黑**，最外面的区名最弱。
        ⇒ 现在三级单调：小节标题(13/600/近黑) > 分类名(12/400/灰) > 场景行(15/400/近黑)。
        ★ 场景行仍比小节标题**字号大** —— 这是**有意**的：它是可点选的内容主体，
          该最醒目；层级由**字重 + 色阶**承担，不由字号单独承担。
      */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          columnGap: 8,
          /**
           * ★★★ 标题行**放不下就换行**（2026-10-17 · 发起人反馈「执行方（Agent 目录）后面换行」）。
           *
           * ── 改前的实测（260px 最窄档）──────────────────────────────────
           *   标题行实测高 **35px**（340px 档只有 19px）——
           *   因为 flex **不换行**，标题被压缩到 138px 宽、**自己内部折成两行**，
           *   而右侧摘要 `（5 · 1 待接入 · 1 已停用）` 还挤在同一行旁边。
           *   ⇒ 一行里同时出现"标题折行"和"摘要并列"两种形态，看着就乱。
           *
           * ── 修法：自适应，不是硬换行 ────────────────────────────────────
           *   加 `flexWrap` + `rowGap`：宽档（340/420）放得下 ⇒ 仍是**一行**（不白占高度）；
           *   窄档（260）放不下 ⇒ **摘要整块落到第二行**，标题不再被压缩折行。
           *   ★ 为什么不做成"永远两行"：那会让 340/420 档白白多占 19px，
           *     而 107 方案 D 的初衷正是**把高度让给场景**。能省就省。
           */
          flexWrap: 'wrap',
          rowGap: 2,
          fontSize: FS.small,
          letterSpacing: 0.8,
          color: C.text,
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        <span style={{ minWidth: 0 }}>
          {icon !== undefined && (
            <span aria-hidden="true" style={{ marginRight: 5, letterSpacing: 0 }}>
              {icon}
            </span>
          )}
          {children}
        </span>
        {/*
          ★ 附加信息走**正文档**（13px/常规/近黑），不带 `letterSpacing`/`uppercase` ——
            它是内容不是标题。★ 长场景名要能断行：`overflowWrap` 兜住（窄屏 260px 也会走到）。
        */}
        {aside !== undefined && (
          <span style={{ minWidth: 0, fontSize: FS.small, fontWeight: 400, letterSpacing: 0, overflowWrap: 'break-word' }}>
            {aside}
          </span>
        )}
        {chevron !== undefined && (
          <span aria-hidden="true" style={{ marginLeft: 'auto', color: C.faint, letterSpacing: 0, flex: '0 0 auto' }}>
            {chevron}
          </span>
        )}
      </div>
      {/*
        ★★★ 说明文字**只在展开时显示**（2026-10-18 · 发起人反馈「操作台看起来有点乱」）。

        ── 改前实测（260px 档）─────────────────────────────────────────
          三块 hint **收起时也占着**：执行方 49px、该怎么选 40px、场景 20px，共约 110px。
          ⇒ 收起状态下用户看到的是「标题 + 一大段解释」，**反而看不到列表**
            —— 解释在看之前就拦住了一切，这是"乱"的第一来源。

        ── 改后 ──────────────────────────────────────────────────────
          收起 ⇒ 不渲染（连 DOM 都没有，`innerText` 也干净）
          展开 ⇒ 照常显示（要看的细节，展开时才需要解释）
          ★ **信息不丢**：收起时把 hint 挂到 `<summary title>` 上，悬停仍可读到
            （见 `PaneBlock` 里 summary 的 `title={...}`）。

        ★ 为什么不反向（默认展开、靠折叠省空间）：107 方案 D 已经定了
          「执行方/推荐默认收起、场景默认展开」，默认态就是收起的，所以这一条省得最多。
      */}
      {hintVisible && (
        <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 2, lineHeight: 1.6 }}>{hint}</div>
      )}
    </div>
  )
}

/**
 * 执行方一行 → **一张卡片**（2026-10-18 · 发起人点名参照外部卡片式工作台：「卡片式最清晰简洁」）。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 参照件：一张外部卡片式工作台的 `expert-card`（参照件来源见内部施工记录 003 期）──
 *   白底（透明，跟随宿主）+ 1px 圆角边框 + 头行（色块 logo + 名称 + 右上角标签）
 *   + 一行元信息。它的「清晰」来自三件事，逐件搬过来：
 *     ① **每条信息有自己的边界**（卡片框）—— 不再是一列无边界的行，扫读有落点；
 *     ② **头行三件套**（logo 块 / 名称 / 状态标签）—— 状态从"行尾小字"变成
 *        右上角**徽标**，一眼可辨；
 *     ③ **信息分层不变**：名称（主体）> role（判断依据，留在外面）> 其余（悬停）。
 *
 * ★★ 判据锚点一个没动（判据全依赖它们）：
 *   `data-kaipu-agent` / `data-kaipu-agent-status` 仍在**外层根节点**上；
 *   `data-kaipu-agent-state` 仍在**那个只装状态文本的节点**上 ——
 *   它必须继续单独占一格：占位条目的**名字本身就是「(待接入)」**，
 *   断"行内含待接入"会被名字蒙对（2026-10-05 写这条判据时当场发现的坑）。
 *
 * ★ 可见文本纪律（探针 ⑧ 段）：卡片可见文本 ≤30 字符、role（灯名）必须可见、
 *   三态状态必须可见 —— 卡片化**只换容器，不换信息量**；skillSummary/能力/版本
 *   仍然全部收进 `title` 悬停（信息不丢，判据照断）。
 */
function AgentRow({ agent }: { agent: AgentCard }): ReactElement {
  /**
   * ★★ 三态，**不是两态**（2026-10-05 真服务端实测后修）。
   *
   *   · `enabled` 已接入可用
   *   · `pending` **占地未接入** —— 契约 v1.3 §23.4 新增的合法值
   *   · `disabled` 被有意关掉
   *
   * ★ 为什么必须分开：`pending` 与 `disabled` 是**两件不同的事实** ——
   *   前者"这个位子还没人接"（正常态、下一步是去接入），
   *   后者"有人把它关掉了"（下一步是去问为什么）。
   *   把 `pending` 显示成「已停用」**不是保守，是编了一个不存在的决定**。
   */
  const off = agent.status === 'disabled'
  const pend = agent.status === 'pending'
  // 悬停提示：把收起来的东西**一字不改**地放进去（不概括、不缩写 —— 概括就等于改内容）
  // ★ 占位条目**没有 `skillSummary`**（实测：`role="综合维度"` · `caps=[]`）
  //   ⇒ 空的时候不要留一个光秃秃的"｜"，那看着像加载失败。
  const desc = agent.skillSummary.trim() === '' ? agent.role : `${agent.role}｜${agent.skillSummary}`
  const tip = [
    desc,
    agent.capabilities.length > 0 ? `能力：${agent.capabilities.join(' · ')}` : '',
    off
      ? `版本 v${agent.version}｜已停用`
      : pend
        ? '占地未接入 —— 这个执行位已备好，但还没有 Agent 接进来'
        : `版本 v${agent.version}`,
  ]
    .filter((x) => x !== '')
    .join('\n')
  const statusText = off ? '已停用' : pend ? '待接入' : `v${agent.version}`
  const ariaText = off
    ? `${agent.name}（已停用）`
    : pend
      ? `${agent.name}（此执行位待接入 Agent）`
      : `${agent.name}，${agent.role}，v${agent.version}`

  return (
    <div
      data-kaipu-agent={agent.id}
      data-kaipu-agent-status={agent.status}
      title={tip}
      // ★ 屏幕阅读器不读 `title` 的时机不确定 ⇒ 再给一份显式描述（内容与 title 同源）
      aria-label={ariaText}
      style={{
        ...CARD,
        // ★ 只有 `disabled` 淡化：`pending` 是**正常态**（等接入），不该看起来像"坏了"
        opacity: off ? 0.55 : 1,
        cursor: 'help',
      }}
    >
      {/*
       * 头行三件套：**logo 块 + 名称 + 状态徽标**（expert-card 的 card-head 形态）。
       * · logo = 名称首字，装进圆角小色块 —— 给每张卡一个视觉锚点（260px 下
       *   五张卡排下来，纯文字行是"糊成一片"的，色块让每张卡有"头"）。
       * · 状态徽标在**右上角**（marginLeft:auto）：从"行尾小字"提为"徽标"，
       *   待接入（琥珀）/ 已停用（灰）/ v3（灰）一眼分层 —— 不再与名称抢同一行基线。
       */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            flex: '0 0 22px',
            width: 22,
            height: 22,
            borderRadius: 7,
            background: C.soft,
            color: off ? C.faint : '#A66A12',
            fontSize: 11,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {agent.name.slice(0, 1)}
        </span>
        <span
          style={{
            fontSize: FS.title,
            fontWeight: 600,
            color: off ? C.dim : C.text,
            // 长名字允许在任意处断（窄档下不撑破），但不许把徽标挤走
            minWidth: 0,
            overflowWrap: 'anywhere',
          }}
        >
          {agent.name}
        </span>
        <span
          data-kaipu-agent-state="1"
          style={{
            marginLeft: 'auto',
            flex: '0 0 auto',
            fontSize: FS.tag,
            lineHeight: '16px',
            padding: '1px 7px',
            borderRadius: 999,
            background: C.soft,
            color: pend ? '#b45309' : C.dim,
          }}
        >
          {statusText}
        </span>
      </div>
      {/*
       * ★ role（灯名）= 判断依据 ⇒ **必须留在外面**（roleSeats 是功能面，藏了就选不了位；
       *   探针 ⑧ 也正面断"灯名仍在卡片可见文本里"）。缩进 30px = logo 22 + gap 8，
       *   与名称对齐 —— 卡片的第二行，不再与头行抢宽度。
       */}
      <div style={{ marginTop: 2, paddingLeft: 30, fontSize: FS.tag, color: C.dim, lineHeight: 1.55 }}>
        {agent.role}
      </div>
    </div>
  )
}

/**
 * 场景一行 → **一张可选卡片**（2026-10-18 · 与执行方卡片同批改造）。
 *
 * ★★ 参照件仍是那张外部卡片式工作台：卡片 = 圆角边框 + 内边距，选中态**整卡高亮**。
 *   改前是"左边 2px 色线 + 浅底"的行形态 —— 行与行之间没有边界，
 *   与执行方区块排在一起时"两列文字墙"分不出谁是谁；卡片化后每场有自己的框。
 *
 * ★ 选中色用**暖金**（#C8881F 系，与「点亮第一盏灯」/ 主行动暖金同一色系），
 *   不用导航蓝 `C.accent` —— 选场是这场合的**核心动作**，不是页签导航；
 *   且灯栏夜话改版已把"品牌暖金=灯火"钉死，选中一张卡 = "点亮这一场"，语义顺的。
 *
 * ★★ 结构纪律（探针 ①.1 换场判据依赖）：仍是 `<button>` + `aria-pressed` +
 *   `aria-label`（场景名）—— 探针靠 `[data-kaipu-left] button[aria-pressed]`
 *   找到所有场景并逐个点击，形态怎么改这三样不能丢。
 */
function SceneRow({
  scene,
  active,
  onSelect,
}: {
  scene: SceneCard
  active: boolean
  onSelect: (id: string) => void
}): ReactElement {
  // ★ 待接入计数 = `agentId === null` 的维度数 —— 进场景**之前**就能看见"这场戏缺人"
  const pending = scene.lamps.filter((l) => l.agentId === null).length
  return (
    <button
      type="button"
      aria-label={scene.label}
      aria-pressed={active}
      onClick={() => onSelect(scene.scene)}
      style={{
        ...CARD,
        // ★ 按钮默认居中：必须显式左对齐（否则卡片里每行文字都会居中）
        display: 'block',
        textAlign: 'left',
        // ★ 选中态：品牌暖金边 + 极浅暖底（与 Agent 卡的灰边中性态区分开）
        border: `1px solid ${active ? '#C8881F' : C.border}`,
        background: active ? 'rgba(200,136,31,0.08)' : 'transparent',
        color: C.text,
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <div style={{ fontSize: FS.title, fontWeight: active ? 600 : 500 }}>{scene.label}</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
        {/*
          ★★ 2026-10-08：文案 `N 维` → `N 个审核面`。
          依据是**已定裁定**「界面文案：维度 → 审核面」—— 这个词在这里**漏改**了
          （发起人 2026-10-08 问「维残留是指什么」，指的就是这一行）。
          ★ 只改**界面文案**：数据侧的 `lamp` 值域、`role:"综合维度"` 那类**真值不动**。
        */}
        <Chip>{scene.lamps.length} 个审核面</Chip>
        {pending > 0 && <Chip tone="#b45309">待接入 {pending}</Chip>}
        {scene.requiresExternal && <Chip tone="#6d28d9">需预约</Chip>}
      </div>
    </button>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: string }): ReactElement {
  return <span style={{ fontSize: FS.tag, color: tone ?? C.dim }}>{children}</span>
}
