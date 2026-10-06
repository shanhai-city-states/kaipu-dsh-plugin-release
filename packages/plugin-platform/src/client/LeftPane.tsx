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
import type { ReactNode, ReactElement } from 'react'
import type { AgentCard, SceneCard, SceneCategory, SceneRecommendation } from '@shanhai/kaipu-contract'
import { C, FS } from './theme.js'

export interface LeftPaneProps {
  agents: readonly AgentCard[]
  scenes: readonly SceneCard[]
  categories: readonly SceneCategoryRow[]
  recommendations: readonly SceneRecommendation[]
  selected: string | null
  onSelect: (scene: string) => void
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
}: LeftPaneProps): ReactElement {
  const { groups, unclassified } = groupScenes(scenes, categories)

  return (
    // ★ `data-kaipu-left` = 左栏的**判据锚点**。
    //   为什么不靠文案断言（2026-10-05 修 `panel-probe` 时立的教训）：
    //   探针原来找的是字符串「场景 / 运行记录」—— 那是**旧版面板的文案**，
    //   面板改版后判据**却一直没人发现**（它只是在报"左栏未渲染"，
    //   看起来像界面坏了，实际是判据自己过期了）。
    //   ⇒ 锚在**结构**上，文案怎么改都不会误报。
    <div data-kaipu-left="1" style={{ padding: '12px 0 18px' }}>
      {/*
        ★ 这句副标题要**同时说清三态**（2026-10-05 修）：
          原来只说"灰色的表示被有意关掉了"，而契约 v1.3 §23.4 后多了 `pending`（占地未接入）——
          不说清它，用户看到「待接入」会不知道那是不是故障。
      */}
      <SectionTitle hint="被接进这场戏的审方。标「待接入」的还没人接，灰掉的是被关掉了。">执行方</SectionTitle>
      {agents.map((a) => (
        <AgentRow key={a.id} agent={a} />
      ))}

      {/* ★ 推荐位：**说「适合什么场合」，不说「热门」** —— 后者需要统计依据 */}
      {recommendations.length > 0 && (
        <div
          data-kaipu-recommend="1"
          style={{ padding: '12px 14px 2px', borderTop: `1px solid ${C.border}` }}
        >
          <div style={{ fontSize: FS.tag, letterSpacing: 0.8, color: C.dim, textTransform: 'uppercase' }}>
            该怎么选
          </div>
          {recommendations.map((r) => (
            <div key={r.key} style={{ marginTop: 4 }}>
              <div style={{ fontSize: FS.small }}>{r.label}</div>
              <div style={{ fontSize: FS.tag, color: C.dim, lineHeight: 1.6 }}>
                适合：{r.when}
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionTitle hint="选一场，右侧看它的运行与结论。" divider>场景</SectionTitle>

      {groups.map((g, gi) => (
        /**
         * ★ 分类可折叠（为"一页预览"后加），**与右栏逐轮同款**：
         *   折进去的 = 具体场景行；**留在外面的** = 分类名 · `intent`（客户视角的一句话）· 场景数。
         *   ⇒ 折起来仍能一眼看出"有哪些场合、各自是干嘛的"，点开才看具体场景。
         * ★ `<details>` 同样**非受控**：用户展开后，数据刷新不会把它弹回去。
         *
         * ★ `gi > 0` 才画上分隔线（"分组之间加条线"）：
         *   首条分类不画 —— 它紧跟在「场景」小节标题下，那里已经靠留白分开了；
         *   每条都画的话，小节标题底下会多一条**没有意义的线**。
         */
        <details
          key={g.key}
          data-kaipu-category={g.key}
          style={{ padding: 0, ...(gi > 0 ? { borderTop: `1px solid ${C.border}` } : {}) }}
        >
          <summary style={{ padding: '8px 14px 4px', cursor: 'pointer', lineHeight: 1.7 }}>
            <span style={{ fontSize: FS.tag, color: C.text }}>{g.label}</span>
            <span style={{ fontSize: FS.tag, color: C.dim, marginLeft: 8 }}>{g.intent}</span>
            <span style={{ fontSize: FS.tag, color: C.dim, marginLeft: 8 }}>（{g.scenes.length}）</span>
          </summary>
          {g.scenes.map((s) => (
            <SceneRow key={s.scene} scene={s} active={s.scene === selected} onSelect={onSelect} />
          ))}
        </details>
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
              未归类
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
    </div>
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
}: {
  children: string
  hint: string
  divider?: boolean
}): ReactElement {
  return (
    <div
      // ★ 判据锚点：让"小节标题是否带分隔线"可以被断言到，
      //   而不必靠 `> div > div` 这种**层级选择器**（层级一改锚点就飘，2026-10-05 踩过）。
      data-kaipu-sect={children}
      style={{
        padding: '12px 14px 6px',
        ...(divider ? { borderTop: `1px solid ${C.border}` } : {}),
      }}
    >
      <div style={{ fontSize: FS.tag, letterSpacing: 0.8, color: C.dim, textTransform: 'uppercase' }}>
        {children}
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
        <Chip>{scene.lamps.length} 维</Chip>
        {pending > 0 && <Chip tone="#d97706">待接入 {pending}</Chip>}
        {scene.requiresExternal && <Chip tone="#6d28d9">需预约</Chip>}
      </div>
    </button>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: string }): ReactElement {
  return <span style={{ fontSize: FS.tag, color: tone ?? C.dim }}>{children}</span>
}
