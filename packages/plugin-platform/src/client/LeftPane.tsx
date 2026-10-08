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
 * ★★ 契约变更 #17（当前新消费）：场景**按分类分组** + 顶部**推荐位**。
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
   * ★★ 把「场景」这块**提到最前**（2026-10-08）。
   *
   * 只给**窄屏折叠条**用（`NarrowScenePicker` 传 `true`），宽屏**不动**：
   *   · 窄屏那条折叠条的本职就是"选场景"（它为什么存在，见"窄屏入口"那次）。
   *     而实测（100）：框高 320 / 内容高 585，**场景列表起点 341px > 框高**
   *     ⇒ 点开折叠条，"要选的东西整个在第一屏之外" —— 得先滚过执行方与推荐位。
   *   · 宽屏**不改**：那里左栏常驻、内容高 659 < 视口 769（富余 110，本来不用滚），
   *     而「该怎么选」是**选的依据**，移到最后就变成"选完才看到" ——
   *     那是取舍不是优化（对应章节 反方已如实摆给决策人）。
   * ⇒ 同一份内容、**两种顺序**，由这一位开关决定；行为差异写在这里，不靠读的人猜。
   */
  sceneFirst?: boolean
}

/**
 * 「当前是哪一场」—— 收起态下的**唯一**坐标（2026-10-08）。
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

  /**
   * ── 三块各自成块，再按 `sceneFirst` 决定顺序（2026-10-08 · 107「方案 D」）──
   * ★ 为什么拆成变量而不是写三遍 JSX：写三遍就是**三份内容**，改一处必漏另一处。
   *   这里拆的是**顺序与容器**，内容只有一份。
   */
  const agentsBlock = (
    <PaneBlock
      id="agents"
      title="执行方"
      icon="📂"
      hint="被接进这场戏的审方。标「待接入」的还没人接，灰掉的是被关掉了。"
      // ★ 收起态也要能一眼看出"有几家"（同 `103` 的「收起点写着当前是哪一场」）
      aside={<span style={{ color: C.dim }}>（{agents.length}）</span>}
      defaultOpen={false}
    >
      {agents.map((a) => (
        <AgentRow key={a.id} agent={a} />
      ))}
    </PaneBlock>
  )

  /* ★ 推荐位：**说「适合什么场合」，不说「热门」** —— 后者需要统计依据 */
  const recommendBlock = recommendations.length > 0 && (
    <PaneBlock
      id="recommend"
      title="该怎么选"
      icon="📂"
      hint="按场合推荐。选之前看一眼，就不用逐个点开猜。"
      aside={<span style={{ color: C.dim }}>（{recommendations.length}）</span>}
      defaultOpen={false}
    >
      {/* ★ `data-kaipu-recommend` 保留在这一层（判据认它；换父级不改锚点名） */}
      <div data-kaipu-recommend="1" style={{ padding: '0 14px 4px' }}>
        {recommendations.map((r) => (
          <div key={r.key} style={{ marginTop: 4 }}>
            <div style={{ fontSize: FS.small }}>{r.label}</div>
            <div style={{ fontSize: FS.tag, color: C.dim, lineHeight: 1.6 }}>
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
        <div data-kaipu-category="__unclassified__" style={{ borderTop: `1px solid ${C.border}` }}>
          <div style={{ padding: '8px 14px 4px' }}>
            <div style={{ fontSize: FS.tag, color: C.text }}>
              <span aria-hidden="true" style={{ marginRight: 5 }}>
                📂
              </span>
              未归类
              {/*
                ★ 那句"如实列出，不藏"**收进悬停提示**（2026-10-05 瘦身）。
                  它是对**「未归类不藏」约定**的交代（给评审看的），不是给客户看的信息 ——
                  而"没藏"这件事，**场景列在这里本身就是证明**，不需要再写一句声明。
                  ★ 组名与场景行**一个字没动**（约定的「未归类不藏」，
                    判据断的也是组名在场 ⇒ 只收声明，不动内容）。
              */}
              <span
                title="未归类不藏：还没归到某个场合的场景，如实列出，不塞进别的组。"
                aria-hidden="true"
                style={{ marginLeft: 6, color: C.faint, cursor: 'help' }}
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
    //   判据**却一直没人发现**（它只是在报"左栏未渲染"，
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
        *   · 窄屏：`sceneFirst` ⇒ **场景在最前**（定案：这个框的本职就是选场景）
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
      <summary style={{ listStyle: 'none', cursor: 'pointer' }}>
        <SectionTitle icon={icon} hint={hint} aside={aside} chevron={open ? '▾' : '▸'}>
          {title}
        </SectionTitle>
      </summary>
      {children}
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
  useEffect(() => {
    const el = ref.current
    if (el !== null) el.open = true
  }, [])
  return (
    /**
     * ★★ V3（2026-10-07 曾指出"日常自查与标准审查之间多了一根横线"）：
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
     * ★ `first ? 0 : 4` 的 marginTop：首条分类不加上间距（它紧跟「场景」块标题，
     *   那里已有留白），其余分类之间留一格 —— 这就是"撤线改留白"的落点。
     */
    <details
      ref={ref}
      data-kaipu-category={group.key}
      style={{ padding: 0, ...(first ? {} : { marginTop: 4 }) }}
    >
      <summary style={{ padding: '8px 14px 4px', cursor: 'pointer', lineHeight: 1.7 }}>
        {/*
          ★★ V3：分类名 `C.text` → `C.dim`。
          实测原状是**倒挂**的：分类名（rgb(15,17,21) 近黑）比小节标题（rgb(138,138,138) 灰）
          **更亮**，两者又同为 12px ⇒ 扫读时"分类"压过"场景"这一区名。
          ⇒ 分类是**组名**（结构），不是内容 ⇒ 降到与 intent/计数 同一色阶，
            整条 summary 一起"退到背景"，让场景行与小节标题站在前面。
        */}
        <span style={{ fontSize: FS.tag, color: C.dim }}>{group.label}</span>
        <span style={{ fontSize: FS.tag, color: C.dim, marginLeft: 8 }}>{group.intent}</span>
        <span style={{ fontSize: FS.tag, color: C.dim, marginLeft: 8 }}>（{group.scenes.length}）</span>
      </summary>
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
}: {
  children: string
  hint: string
  divider?: boolean
  /**
   * ★★ UI-V2（2026-10-07 曾提议）：标题前的**视觉锚点**。
   *
   * 为什么加：曾反馈"界面不够清晰"。左栏 260px 里堆了多种标题级元素
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
   * ★ 标题行**右侧**的附加信息（2026-10-08 "当前是哪一场"）。
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
}): ReactElement {
  return (
    <div
      // ★ 判据锚点：让"小节标题是否带分隔线"可以被断言到，
      //   而不必靠 `> div > div` 这种**层级选择器**（层级一改锚点就飘，2026-10-05 踩过）。
      //   ★ V2 加符号时**没有动它** —— 锚点是给判据用的，不能跟着样式走。
      data-kaipu-sect={children}
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
          gap: 8,
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
      <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 2, lineHeight: 1.6 }}>{hint}</div>
    </div>
  )
}

/**
 * 执行方一行。`disabled` ⇒ 灰显 + 「已停用」+ **不是按钮**。
 * ★ 刻意不用 `<button disabled>`：停用的 Agent 不是"点不了"，是**这里没有一个可点的东西**。
 *   用 disabled button 会让屏幕阅读器念出一个不可用的按钮 —— 那读起来像故障，
 *   而"被有意关掉了"才是事实。
 *
 * ★★ 2026-10-05 瘦身：**两行 → 一行**，一句话说明收进悬停提示。
 *
 *   改前（每个 ~62px，含两行文字）：
 *     主体核验方                          v3
 *     执行 · 核验证照与主体信息是否一致。
 *   改后（每个 ~34px）：
 *     主体核验方  执行  v3              ⓘ
 *
 *   ★ 切分依据 —— **哪条是判断依据，哪条是细看才需要**：
 *     · `role`（执行 / 审计）= 判断依据 ⇒ **必须留在外面**（roleSeats 是功能面，藏了就选不了位）
 *     · `skillSummary`（"具体审什么"）= 细看才需要 ⇒ 收进 `title`
 *   契约对总台卡片**没有"完整说明必须常驻"的要求**：renderRules R1–R6 全部只管**运行视图**，
 *   §十 对接清单 #1 只要求"Agent 卡片"在场 ⇒ 收窄不违约。
 *
 *   ★ 为什么用**原生 `title`** 而不是自绘悬停浮层：
 *     面板挂在宿主容器里，容器常带 `overflow` 裁剪 ⇒ 自绘浮层会被裁掉，
 *     还要自己处理定位 / 键盘 / 触屏三套逻辑。`title` 零 JS、不会被裁、
 *     屏幕阅读器会把它当 accessible description 读出来。
 *
 *   ★★ 收进 `title` 的东西**判据读不到**（`innerText` 不含 title 属性）
 *     ⇒ **必须另有一条断言证明它还在**（见 `run-view-probe` 的「总台卡片」段）。
 *       否则这次"瘦身"会**悄悄变成删内容** —— 那正是本项目最忌的一类错。
 *
 *   ★ `disabled` ⇒ 灰显 + 「已停用」**必须仍然看得见**
 *     （契约 models.ts：返回全部就是为了让人看见"被关掉了"）
 *     —— 这是本次瘦身**不许动**的一条，且**留在外面**，不收进提示。
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
   *   （实测抓到：旧 `toAgentStatus` 是 fail-closed，未知值一律当 disabled ⇒ 占位条目全被误报。）
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
      // ★ 判据锚点：让"执行方每行多高、悬停提示有没有内容、三态怎么显示"
      //   可以被**量测与断言**，而不必去数 DOM 层级（层级选择器一改就飘）。
      data-kaipu-agent={agent.id}
      // ★ 三态各带一个标记，判据可**逐态**断言（免得"看成一样"蒙混过关）
      data-kaipu-agent-status={agent.status}
      title={tip}
      // ★ 屏幕阅读器不读 `title` 的时机不确定 ⇒ 再给一份显式描述（内容与 title 同源）
      aria-label={ariaText}
      style={{
        padding: '6px 14px',
        // ★ 只有 `disabled` 淡化：`pending` 是**正常态**（等接入），不该看起来像"坏了"
        opacity: off ? 0.55 : 1,
        borderLeft: `2px solid ${off ? 'transparent' : pend ? '#d97706' : C.accent}`,
        cursor: 'help',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: FS.title, color: off ? C.dim : C.text }}>{agent.name}</span>
        <span style={{ fontSize: FS.tag, color: C.faint }}>{agent.role}</span>
        {/* ★ 三态共占同一个位置：`已停用` / `待接入` / `v3`（同一时刻只会出现一个）
            ★★ `data-kaipu-agent-state` 锚点：判据要断**这一格**的文本 ——
              不能断整行的文本，因为占位条目的**名字本身就是「(待接入)」**，
              断"行内含待接入"会被名字蒙对（2026-10-05 写这条判据时当场发现）。 */}
        <span data-kaipu-agent-state="1" style={{ fontSize: FS.tag, color: pend ? '#d97706' : C.dim }}>
          {statusText}
        </span>
        {/* ★ ⓘ = 可发现性：`title` 只有悬停才出来，不标一下没人知道这里有东西 */}
        <span aria-hidden="true" style={{ marginLeft: 'auto', fontSize: FS.tag, color: C.faint }}>
          ⓘ
        </span>
      </div>
    </div>
  )
}

/** 场景一行（可点选）。 */
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
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '9px 14px',
        border: 'none',
        borderLeft: `2px solid ${active ? C.accent : 'transparent'}`,
        background: active ? C.soft : 'transparent',
        color: C.text,
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <div style={{ fontSize: FS.title }}>{scene.label}</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
        {/*
          ★★ 2026-10-08：文案 `N 维` → `N 个审核面`。
          依据是**已定裁定**「界面文案：维度 → 审核面」—— 这个词在这里**漏改**了
          。
          ★ 只改**界面文案**：数据侧的 `lamp` 值域、`role:"综合维度"` 那类**真值不动**。
        */}
        <Chip>{scene.lamps.length} 个审核面</Chip>
        {pending > 0 && <Chip tone="#d97706">待接入 {pending}</Chip>}
        {scene.requiresExternal && <Chip tone="#6d28d9">需预约</Chip>}
      </div>
    </button>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: string }): ReactElement {
  return <span style={{ fontSize: FS.tag, color: tone ?? C.dim }}>{children}</span>
}
