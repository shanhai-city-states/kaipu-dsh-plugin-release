/**
 * 山海·开铺 · 场地插件 · 主面板
 * =====================================================================
 * ★ 布局：**顶部四页签 + 下方主区**（2026-10-08 由"左总台 + 右运行视图"升级）。
 *
 *   页签：① 操作台 ② 铺子资料 ③ 管理方 ④ 怎么用 —— 顺序「做 → 我的东西 → 管理 → 帮助」。
 *
 *   ★★ 为什么把「铺子资料」「怎么用」从右栏内容流里提拔成页签：
 *     这两块**本来就在 `data-kaipu-run` 之外**（判据边界的纪律），
 *     只能靠顶部两个跳转按钮 + 滚一屏抵达 ⇒ 想放/取一份文件得先滚一两屏。
 *     页签让"去哪儿"变成**一步**，且跨页不丢上下文（`fill` 信号抬在本层）。
 *     ⇒ 随之作废的零件一并删除：`jumpSeq` / `introSeq` 两个递增信号、
 *       两个滚动 effect（含"页面不可见时平滑滚动不推进"的兜底）、`nearestScroller`、
 *       `shelfRef` / `scrollerRef` —— **删干净，别留一个只在注释里活着的名字**。
 *
 * ★ 操作台内仍是**左右分栏**（插件形态决定，不是审美偏好）：
 *   插件面板**天然是"嵌在宿主里的一个区域"**，不是全屏应用 ——
 *   它可能挂在侧边栏（很窄）/ 主区域（很宽）/ 悬停卡（更窄）。
 *   ⇒ 左右分栏 + 弹性伸缩是唯一天然适配三档的布局。
 *   ★★ 后来补一处（实测所得）：容器 < 640 时左右分栏**根本分不了** ⇒
 *      左栏收掉，改由顶部的 `NarrowScenePicker` 承载"挑一场场景"这个动作。
 *      折掉的是**左栏这个形态**，不是**这个动作**（见 `NARROW_BREAKPOINT` 注释）。
 *
 * ★★ 断点看**容器宽度**，不看窗口宽度。
 *   早先的教训：面板可能被塞进很窄的挂载点，用 `window.innerWidth` 判断必然误判。
 *   ⇒ 用 ResizeObserver 量自己。
 *
 * ── 本文件只做四件事 ──────────────────────────────────────────────
 *   ① 量宽度 → 决定折不折左栏；② 取数据快照（真服务端 / 演示）；
 *   ③ 持有"选哪个场景 / 停在哪个页签 / 是否已停止接收"；④ 组装。
 *
 * ★★ 数据源**必须是显式状态**（2026-10-05 接真接口时立的）——
 *   `live` / `mock`（人工选的）/ `unreachable`（真连不上）三者严格分开。
 *   **绝不在连不上时悄悄回落 mock**：那会让用户以为在看真结果，
 *   其实在看演示数据 —— 这是比"白屏"更坏的一类错（**看起来是对的**）。
 *   连不上就**如实说连不上**，并给一个**显式的**"改用演示数据看看"按钮。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { SceneRunEvent } from '@shanhai/kaipu-contract'
import { Intro, PanelHead } from './Intro.js'
import { LeftPane, SceneCurrent, type LeftPaneProps } from './LeftPane.js'
import { RightPane, type RunInput } from './RightPane.js'
import { ShopShelf } from './ShopShelf.js'
import { SeatLampPanel } from './SeatLampPanel.js'
import { loadLive, mockSnapshot, type Snapshot } from './live.js'
import { MOCK_RUNS, MOCK_SIGNATURE } from './mock/data.js'
import { startRun, type RunSession } from './run.js'
import { reduceRun, type RunView } from './run-reducer.js'
import { C, FS, LH } from './theme.js'

/**
 * 窄于此宽度 ⇒ 折叠左栏（只留右工作区）。
 * ★ 2026-10-05 随字号一起从 560 提到 640：字号放大一档后，240px 的左栏装不下
 *   「主体核验 · 执行 · 核验证照与主体信息是否一致」这类行，会挤成两三行。
 *   左栏同步加宽到 260 ⇒ 折叠阈值必须跟着抬，否则"看起来够宽但左栏已经挤爆"。
 *
 * ★★ 2026-10-08：折了左栏 ≠ 折了"选场景"这件事。
 *
 *   评估**实测**发现的真缺口（不是推演）：容器 < 640 时，
 *   左栏与把手**都不渲染** ⇒ 面板 544px 宽时，用户**一个选场景的入口都没有**。
 *   而 `selected` 会自动回落到第一个场景，界面**看起来一切正常** ——
 *   他只会发现自己**换不了场**，且不知道去哪儿换。
 *   ⇒ 折掉的是"左栏这个形态"，不是"挑一场场景"这个动作。
 *     下面 `NarrowScenePicker` 就是窄屏下承载这个动作的东西。
 *
 *   ★ 为什么不是"把左栏也渲染出来挤一挤"：260px 塞进 544px 的面板里，
 *     右侧只剩 284px —— 报告那种块结构（判定行 + 说明 + 角色位）会被折成
 *     一行几个字，**读不动**。那种"看起来还在"比"明确收起来 + 给个入口"更坏。
 */
const NARROW_BREAKPOINT = 640

/**
 * ★★ 左栏宽度**档位**（2026-10-08 · 评估 → 定案「做 C+D」）。
 *
 * ── 为什么加宽就能拿到"内容不挤"，而不必把内容搬到右栏 ──
 * `109` 实测（真改样式再量，不推算）：
 *   三块内容合计 **840px（左栏 260）→ 673px（左栏 420）＝ −167px**；
 *   而把同样三块**搬到主区 887px** 量出来的也是 **−167px** —— **一模一样**。
 *   原因：内容高度由**文本换行**决定，而换行在 **420px 时就已经不再发生**
 *   （再加宽到 500px，读数仍是 673，**到顶了**）。
 * ⇒ 「同样收益，选代价最低的那条路」（原话）：**加宽能拿到的，不搬内容去拿**。
 *
 * ── 为什么是档位而不是"一个更宽的常量" ──
 * 加宽**不是免费的**：它吃掉的是主区宽度（420 时主区从 887 → 727，−160px）。
 * 而"多宽才合适"取决于用户当下在干什么（挑场景 vs 读报告）——
 * 这是**用户当场就知道、我们猜不出来**的事 ⇒ 给他一个开关，而不是替他定一个数。
 * ★ 也**不做拖拽改宽**：拖拽要挂 pointermove + 落盘宽度，而本仓 client half
 *   不引 CSS 文件、状态不持久化（刷新即回默认）⇒ 拖出来的宽度**一刷新就丢**，
 *   那比"点两下换档"更让人恼火。
 *
 * ── ★★ 与上面 `NARROW_BREAKPOINT` 那段注释的关系（别读成矛盾）──
 * 那一段讲的是**压窄**左栏没用（235px 内容高不变、215px 反而涨）；
 * 这一档讲的是**加宽**左栏 —— **方向相反**，是两件事：
 *   · 想让**右栏**变宽 ⇒ 只有**收起左栏**一条路（0 或 260，没有中间地带）；
 *   · 想让**左栏自己不挤** ⇒ 就是这里的加宽（代价是右栏变窄）。
 * ★ 而"窄窗挤"的真正门槛在**窗高**（`107` 实测：窗高 ≈700 才开始滚），
 *   与左栏宽无关 ⇒ 所以本档位**不是**为解决窄窗而加，是为"内容设计施展不开"加的。
 */
const LEFT_WIDTHS = [260, 340, 420] as const

/**
 * 当前容器宽下，左栏**最多**能加到第几档。
 *
 * ★ 为什么要有这个上限：左栏「加宽」= 主区变窄。容器只有 700px 时给左栏 420
 *   ⇒ 报告区只剩 267px，块结构（判定行 + 说明 + 角色位）会折成一行几个字
 *   —— `NARROW_BREAKPOINT` 那段注释已经判过：那种「看起来还在」**比收起来更坏**。
 * ★ 取**一半**作上限（而不是别的比例）：半个面板给"选"，半个给"看"，
 *   在任何容器宽下都留下**与左栏等宽以上**的阅读区。
 * ★ 容器宽未知（首帧 / 无 `ResizeObserver`）时**不设限** —— 宁可让它加宽，
 *   也不要在拿不到尺寸时把一个用户主动点的动作**静默吃掉**（点不动还不说原因，最恼人）。
 */
const maxWidthIdxFor = (hostW: number): number => {
  if (hostW <= 0) return LEFT_WIDTHS.length - 1
  let i = LEFT_WIDTHS.length - 1
  while (i > 0 && (LEFT_WIDTHS[i] ?? 0) > hostW / 2) i -= 1
  return i
}

/** 默认档 = 260（老行为原样）—— 加宽是**用户主动选**的，不是新的默认 */
const LEFT_WIDTH_DEFAULT_IDX = 0

/**
 * 下一档是哪个（到顶就**回绕**到最窄一档）。
 * ★ 为什么回绕而不是"到顶就不动"：不回绕的话，用户在 420 上再点一下**什么都不会发生**
 *   —— 点了没反应、又没说明，是本项目反复判过的那类最坏交互（"假承诺"和"按不动的按钮"同族）。
 *   回绕至少让"这一点有反馈"，且 260 本来就是他要的那个常见态，绕回去不算绕远。
 * ★ 抽成**模块级纯函数**（不写在 JSX 里）：可以单独断言 —— 见 `tools/probe/run-view-probe.mjs` ⑦.2 段。
 */
const nextWidthIdx = (idx: number, cap: number): number => (idx + 1 > cap ? 0 : idx + 1)

/** 未运行的场景共用这一个空数组 —— 避免每次渲染都新建（否则 useMemo 每次失效） */
const NO_EVENTS: readonly SceneRunEvent[] = []
const NO_SCENES: Snapshot['scenes'] = []

/** 用户选的数据源：`auto` = 先试真服务端；`mock` = 明确要看演示数据 */
type SourcePref = 'auto' | 'mock'

/** 顶部页签的四个视图 —— **数组顺序即渲染顺序**：做 → 我的东西 → 管理 → 帮助 */
type ViewId = 'console' | 'shop' | 'manage' | 'help'

export function PlatformPanel(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [pref, setPref] = useState<SourcePref>('auto')
  /** `null` = 还在读（首帧）—— 这与"读失败"是两件事，界面措辞要分开 */
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  /** ★ 客户端是否已停止接收（R5）。它**不属于事件流**，所以单独一个状态。 */
  const [stopped, setStopped] = useState(false)
  /**
   * 当前触发的错误码。
   * ★ 现在由演示脚手驱动；接真服务端后改由**请求失败**驱动 ——
   *   中间那层（ErrorSurface）不用改，它只认 code。
   */
  const [errorCode, setErrorCode] = useState<string | null>(null)
  /**
   * ★★ 左栏（场景栏）是否展开 —— 为"横向空间还给内容"后加。
   *
   * **为什么值得给（实测，不是感觉）**：收起后右栏宽 432 → **693px（+60%）**、
   * **最长一行 364 → 485px（+33%）** ⇒ 阅读舒适度是真实提升。
   *
   * **但它不是"一屏看完"的灵药（别过度承诺）**：同一次实测里右栏内容高只降 **16%**
   * （849 → 710px，**仍是 1.57 屏**）—— 因为右栏高度的大头是**块结构**
   * （结论 / 角色位 / 未签名 / 逐轮，多为契约"不许折"），**不是"窄列换行"**。
   * ⇒ 它的价值是**把"暂时不看的 34% 横向空间"还给内容**，不是消灭滚动。
   *
   * ★ 顺带否掉了一条"零代价"的替代路：**压窄左栏没用**。实测 235px 时内容高不变（641px），
   *   再往下压到 215px **内容反而涨到 680px**（开始换行挤）—— 净亏。
   *   所以"让右栏变宽"只有**收起**这一条路（0px 或 255px，没有中间地带）。
   *
   * ★ 默认**展开**：选择场景是第一步；一进来就把入口藏起来，等于让人先找门。
   */
  const [leftOpen, setLeftOpen] = useState(true)
  /**
   * ★★ 左栏宽度档位（`LEFT_WIDTHS` 的下标）—— 见那段常量的注释。
   * ★ 默认 `0`（260px）= **老行为原样**；加宽必须由用户主动点。
   * ★ 不持久化：刷新回默认（与 `leftOpen` / `view` 同一口径 —— 都是"当场的选择"）。
   */
  const [widthIdx, setWidthIdx] = useState(LEFT_WIDTH_DEFAULT_IDX)
  /**
   * ★ 容器宽（`hostRef` 量到的）—— **只给"左栏最多能加到第几档"当依据**。
   * ★ 与 `narrow` 同一个 `ResizeObserver` 里更新，不额外挂一个观察者。
   */
  const [hostW, setHostW] = useState(0)

  /**
   * ★★ 顶部「页签」：**操作台 / 铺子资料 / 管理方 / 怎么用**（2026-10-08 定型）。
   *
   * 顺序「做 → 我的东西 → 管理 → 帮助」：
   *   操作台 = 干活看结果的地方 · 铺子资料 = 自己的东西 · 管理方 = 另一类使用者 · 怎么用 = 帮助。
   *
   * ★ 为什么是页签（不是抽屉/不是内联折叠）：这四件事**互不从属** ——
   *   把它们平级，比"塞进一个视图里的可折叠段落"更诚实，
   *   也不会污染 `data-kaipu-run` 的判据边界（见那节）。
   *
   * ★★ 默认停在「操作台」：绝大多数第一眼是来看运行结果的。
   * ★★ 红线：客户端**零管理能力**（契约三条不可破 ③）——
   *   管理方页签是**占位 + 指路**，不承载任何真管理逻辑；
   *   真动作（发起开铺 / 指派执行方）在接入场地服务端后的「管理方界面」做（P2.5）。
   */
  const [view, setView] = useState<ViewId>('console')
  /**
   * ★ 用户**看过**「怎么用」没有 —— 只服务"页签上的小蓝点"（首访可发现保底）。
   * ★ 用 state 不用 ref：它参与渲染（点要消失）。★ **不持久化**：页签是导航，跨挂载记忆无意义。
   */
  const [helpSeen, setHelpSeen] = useState(false)
  /** 切页签 + 记"看过用法"。★ 收在一处，免得漏记 —— 漏了就一直挂个蓝点。 */
  const switchView = (v: ViewId): void => {
    if (v === 'help') setHelpSeen(true)
    setView(v)
  }

  /**
   * ★★ 「从铺子资料填入待审内容」= 一条**单向信号**，不是一个值。
   *
   * 为什么带 `seq`：两次填的可能是**同一份文件、同一段文本** ——
   * 用值本身做依赖，第二次就不会触发（React 认为没变化）。
   * 递增序号让"又一次填入"这件事**每次都成立**。
   *
   * ★★ 为什么状态放在这一层（分页之后这条更关键）：
   *   铺子资料**已经是另一个页签**，而"待审内容"输入框在**操作台页** ——
   *   两者隔着一整页。信号必须抬到**共同祖先**（本层），
   *   并在填入时把页签**切回操作台**（见 `placeFill`），这样"填入"之后
   *   用户立刻看到内容落进了输入框，而不是"填了但不知道填到哪去了"。
   */
  const [fill, setFill] = useState<{ text: string; name: string; seq: number } | null>(null)

  /* ── ★ 真运行的三个状态（2026-10-05 接 SSE 时加）────────────────────
   * 它们**只在真服务端路径下**有意义；演示模式的 events 走 `MOCK_RUNS`。
   * ★ `runEvents` 累积的是**真收到的事件**（按到达顺序）—— reducer 是纯函数，
   *   所以"边到边渲染"就是"数组长一点就重算一次"，没有额外的状态机。
   */
  const [runEvents, setRunEvents] = useState<readonly SceneRunEvent[]>(NO_EVENTS)
  const [running, setRunning] = useState(false)
  /** 运行失败的**原文**（不翻译、不吞）—— 与 `errorCode`（契约错误码→山海语言）是两件事 */
  const [runError, setRunError] = useState<string | null>(null)
  /** 当前这条流的句柄。★ 用 ref 不用 state：它**不参与渲染**，改它不该触发重绘 */
  const sessionRef = useRef<RunSession | null>(null)

  useEffect(() => {
    const el = hostRef.current
    if (el === null) return
    // 拿不到 ResizeObserver（极老壳 / 测试环境）⇒ 保持默认宽布局，不炸。
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) {
        setNarrow(w < NARROW_BREAKPOINT)
        setHostW(w)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ── 取快照（★ 换数据源 = 重新取，不"就地换标签"）────────────────── */
  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    void (async () => {
      const next = pref === 'mock' ? mockSnapshot() : await loadLive(ac.signal)
      if (alive) setSnap(next)
    })()
    return () => {
      alive = false
      ac.abort()
    }
  }, [pref])

  const scenes = snap?.scenes ?? NO_SCENES
  const agents = useMemo(() => snap?.agents ?? [], [snap])
  const categories = useMemo(() => snap?.categories ?? [], [snap])
  const recommendations = useMemo(() => snap?.recommendations ?? [], [snap])
  const isMock = snap?.kind === 'mock'

  /* ── 首帧后自动选中第一个场景（★ 真服务的场景 id 与演示数据不同，不能写死）──
   *
   * ★★ 判据是「选中项**在当前场景列表里找不到**」就重选，**不是** `selected === null`。
   *
   * 为什么必须这样（2026-10-05 被"探针连跑"当场抓到）：
   *   切数据源（演示 ↔ 真服务端）时，两个来源的 scene id **不一样**
   *   （演示是 `opening-audit`，真服务端是 `light-review`）。
   *   只认 `null` 的话，旧的 `selected` 会**悬空**：`scenes.find(...)` 找不到 ⇒
   *   右栏掉进空态，显示「先从左边挑一场场景」——**而用户什么也没做错**，
   *   看起来像"数据没了"。
   *   ⇒ 现在：选中项失效就自动回落到第一个。
   */
  useEffect(() => {
    const exists = selected !== null && scenes.some((s) => s.scene === selected)
    if (!exists && scenes.length > 0) setSelected(scenes[0]?.scene ?? null)
  }, [scenes, selected])

  const scene = useMemo(() => scenes.find((s) => s.scene === selected) ?? null, [scenes, selected])

  /**
   * ★★ 事件从哪来 —— 两条路**显式分开**，绝不"读不到就回落演示"：
   *   · `mock` ⇒ `MOCK_RUNS`（人工选的演示序列）
   *   · 真服务端 ⇒ `runEvents`（**本次运行真收到的事件**）
   *   没跑过就是**空**（界面如实说"该场景尚未运行"并给开始按钮），
   *   而不是摆一串谁也没跑过的判定。
   */
  const events = useMemo(
    () => (isMock ? (selected === null ? NO_EVENTS : (MOCK_RUNS[selected] ?? NO_EVENTS)) : runEvents),
    [isMock, selected, runEvents],
  )
  const run = useMemo(() => reduceRun(events, stopped), [events, stopped])

  const pick = (id: string): void => {
    // 换场景 = 新的一次运行 ⇒ 上一次的流、事件、"已停止接收"与错误**都不该带过来**
    sessionRef.current?.stop()
    sessionRef.current = null
    setRunning(false)
    setRunEvents(NO_EVENTS)
    setSelected(id)
    setStopped(false)
    setErrorCode(null)
    setRunError(null)
  }

  /** ★ 发起一次真运行（契约 §3.4）。只有真服务端路径能发起 —— 演示模式没有可跑的东西 */
  const start = (input: RunInput): void => {
    if (selected === null) return
    // 同一场景重复点：先把上一条停掉，别让两条流抢同一个视图
    sessionRef.current?.stop()
    setRunEvents(NO_EVENTS)
    setStopped(false)
    setRunError(null)
    setRunning(true)
    sessionRef.current = startRun(
      {
        sceneId: selected,
        ...(input.target === '' ? {} : { target: input.target }),
        content: input.content,
      },
      {
        onEvent: (e) => setRunEvents((prev) => [...prev, e]),
        onError: (message) => setRunError(message),
        onEnd: () => {
          setRunning(false)
          sessionRef.current = null
        },
      },
    )
  }

  /**
   * ★ 停止接收（R5）：**只停客户端这一侧**。措辞与解释见 `run-reducer` 的 `STOPPED_EXPLAIN` ——
   *   服务端仍在算完并落 `lamp_runs`，所以**不写"已取消"**。
   */
  const stop = (): void => {
    sessionRef.current?.stop()
    sessionRef.current = null
    setRunning(false)
    setStopped(true)
  }

  /** 面板卸载 ⇒ 停掉还在跑的流（不留下一个没人消费的订阅） */
  useEffect(
    () => () => {
      sessionRef.current?.stop()
      sessionRef.current = null
    },
    [],
  )

  /**
   * ★★ 从铺子资料「填入待审内容」→ **排信号 + 切回操作台**（跨页不丢上下文）。
   *
   * 为什么切回去：待审内容输入框在**操作台页**的右栏 (§运行视图)。
   *   只把信号排上而人还停在铺子资料页 ⇒ 他看见的只有一句"已填入"，
   *   却看不到填到哪儿了（这正是"跨页丢上下文"）。
   *   ⇒ 填入 = 送他去该去的地方（同 `Intro` 那条教训：**导航的意图不该被吃掉**）。
   */
  const placeFill = (text: string, name: string): void => {
    setFill((prev) => ({ text, name, seq: (prev?.seq ?? 0) + 1 }))
    setView('console')
  }

  /**
   * ★★ 「从铺子资料点开始运行」= 切到操作台 **+ 把发起区送到正中间**（2026-10-08 · 101）。
   *
   * ★ 为什么**两件事**都要做、只切页签不够：
   *   操作台那一页，发起区**不在第一屏**（上面压着「这场谁来审 / 要过哪几面」那一整块）。
   *   只 `setView('console')` 的话，人是过去了，但看见的是"上面那一块"，
   *   发起区还在视野外 ⇒ 和"点了没反应"体感一样 —— **导航到了，落点没到**。
   *
   * ★★ 为什么用 `focusSeq`（**事件**）而不是一个 `focused` 布尔：
   *   与 `fill` 同一条理由 —— 用户可能**连着两次**从铺子资料点过来。
   *   布尔值第二次还是 `true`，那一趟就"没换过"（⇒ 不会再滚一次）。
   *   递增序号让"又一次要去发起区"这件事**每次都成立**。
   *
   * ★ 为什么配 `onFocusConsumed`（用完即清零）：它是**一次性**信号，不是状态。
   *   留着不清零 ⇒ 用户只想在两页之间来回切一次，也会被反复拖到发起区
   *   （替他做了一个"你一定想发起"的决定）。
   */
  const [focusSeq, setFocusSeq] = useState(0)
  /**
   * ★ `useCallback` 不是顺手加的 —— 这个回调进了 `StartRunForm` 一条 effect 的**依赖**。
   *   每次渲染换个新身份 ⇒ effect 每次渲染都重跑 ⇒ 滚了又滚。
   */
  const consumeFocus = useCallback((): void => setFocusSeq(0), [])
  const goRun = (): void => {
    setFocusSeq((n) => n + 1)
    setView('console')
  }

  /**
   * ★ 铺子资料那颗「开始运行」什么时候在 —— **它指向的那一屏真的存在才算**。
   *
   * 三个条件缺一不可，各自否决掉一种"给了却跑不了"：
   *   · `isMock`        —— 演示模式没有可跑的服务端（`onStart` 就是 `null`）
   *   · `scene === null`—— 没有选中的场次 ⇒ 操作台那一屏是空态，不是发起区
   *   · `run.status ≠ idle` —— 这一场**已经跑过** ⇒ 操作台给的是报告，不是发起区
   * ⇒ 与 `onFill` 同一条口径：**没有落点就不给按钮**（见 `ShopShelfProps.onGoRun`）。
   */
  const canGoRun = !isMock && scene !== null && run.status === 'idle'

  /**
   * ★★ 主区滚动容器（四页共用那一块）—— 给"换场回顶"用（2026-10-08 · 104）。
   * ★ 为什么这次**重新**挂 ref（当年特意去掉过）：用途不同 ——
   *   当年是给"滚动导航"用（页签化后已废），现在是给"换场回顶"用，读它的只有下面那一条 effect。
   */
  const mainRef = useRef<HTMLElement | null>(null)

  /**
   * ★★ 换场之后，把主区**滚回顶部**（2026-10-08 · 104 实测发现的问题）。
   *
   * ══════════════════════════════════════════════════════════════════
   * 它修的是什么
   * ══════════════════════════════════════════════════════════════════
   *   换场**不会**重置滚动位置。实测（两个**都长**的场景互切）：`scrollTop 500 → 500`
   *   ⇒ 用户看到的是**新报告的中段** —— **既看不到场景名，也看不到报告开头**，
   *   而"换一场"恰恰就是"我要看这一场"的意思。
   *
   * ★★ 这个缺陷**差一点被漏掉**（记在这里，因为它是个方法论样本）：
   *   换到**短**场景时读数是 892 → 76、1055 → 154，**看起来像"自动回顶了"**。
   *   那不是复位 —— 是浏览器把超范围的 `scrollTop` **夹到新内容的上限**。
   *   只有拿**两个都长**的场景各量一次，才看得出位置是**原样带过去**的。
   *   ⇒ 教训：一个读数与预期一致时，先问"它是被什么机制做成的"；
   *     "被夹紧 / 被裁掉 / 被兜底"这类**被动结果**只在当前样本上成立。
   *
   * ══════════════════════════════════════════════════════════════════
   * ★ 目标值为什么是"顶部"而不是"中间"
   * ══════════════════════════════════════════════════════════════════
   *   新报告是一份**新东西**，从头读才成立；"居中"会让**第一屏少看一半**。
   *   定案原话：「换场后置顶合适，等于从换场标题开始往下自然展开」。
   *
   * ★ 依赖里为什么有 `snap` 而不只是 `selected`：切数据源时**若 id 恰好没变**，
   *   内容也是整个换了（本地演示 ↔ 真服务端）⇒ 同样该回顶。
   *   `snap` 只在 `pref` 变化时被替换 ⇒ 它变动 = 数据源换了。
   *   （★ 首次加载时 `snap` 从 `null` 变成对象、`selected` 从 `null` 变成第一场 —— 也会跑一次；
   *     那时 `scrollTop` 本来就是 0，置 0 是空操作。）
   *
   * ★ 为什么**不等 DOM 更新完**就直接置 0：回顶的目标值与内容高度无关（就是 0），
   *   不必像"居中"那样先量布局 ⇒ 不存在"读到旧的几何"的问题。
   */
  useEffect(() => {
    const el = mainRef.current
    if (el !== null) el.scrollTop = 0
  }, [selected, snap])

  const isLoading = snap === null

  /**
   * ★★ 左栏不可见时，**原因**是什么（`null` = 可见）。
   *
   *   · `'narrow'`    —— **容器太窄**塞不下（< `NARROW_BREAKPOINT`）
   *   · `'collapsed'` —— **用户主动收起**
   *
   * ★ 为什么必须分清原因、不能只给一个 `leftVisible` 布尔：
   *   **两者的出路不一样** ——
   *     · 用户收起 ⇒ 出路是「点顶部的展开按钮」（那个按钮**在**）
   *     · 容器太窄 ⇒ 出路是**顶部的「场景」折叠条**（后来才加；在此之前是"把窗口拉宽"——
   *       那等于告诉用户"你没法在这儿干活"，是把缺失说成限制）
   *   ⇒ 用一个布尔就把两种出路说成同一种，会**让人去按一个不存在的按钮**。
   *     （同 `live.ts` 那条纪律：读不到要**如实说原因 + 给出路**，别糊一句通用话。）
   */
  const leftHidden: 'collapsed' | 'narrow' | null = narrow ? 'narrow' : leftOpen ? null : 'collapsed'

  /* ── 左栏宽度档位（`LEFT_WIDTHS`）的落地 ────────────────────────────
   * `cap` 随**容器实时宽**变（窗口改大小 ⇒ 可加的上限跟着变），
   * 所以这里不能缓存 —— 每次渲染重算，它是纯算术，比挂 memo 便宜。
   */
  const widthCap = maxWidthIdxFor(hostW)
  // ★ 用一个**钳过**的下标：窗口变窄后，原来选中的 420 可能已超上限 ⇒ 自动回落，
  //   否则会出现"左栏比允许的更宽"（那条上限就成了摆设）。
  const safeWidthIdx = Math.min(widthIdx, widthCap)
  const leftWidth = LEFT_WIDTHS[safeWidthIdx] ?? 260
  const cycleWidth = (): void => setWidthIdx(nextWidthIdx(safeWidthIdx, widthCap))

  return (
    <div ref={hostRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 常驻标题栏：第一眼先知道"这是什么"。
          ★ 分页之后它**不再挂跳转按钮** —— 「铺子资料 / 怎么用」已成为页签，
            跳转（展开 + 滚动 + 兜底）那套零件随之删除。 */}
      <PanelHead
        source={snap === null ? '正在读取…' : snap.label}
        onUseMock={() => setPref((p) => (p === 'mock' ? 'auto' : 'mock'))}
        mockActive={isMock}
      />

      <SourceBanner snap={snap} onUseMock={() => setPref('mock')} />

      <TabBar view={view} onSwitch={switchView} showHelpNew={isMock && !helpSeen} />

      {/*
        ★★ 窄屏的「选场景」入口（2026-10-08 补评估发现的真缺口）。

        ★ 位置：**页签之下、主区之上**（即滚动区**之外**）。
          为什么不放进主区内容流：长报告滚到一半想换一场，不该先滚回顶部 ——
          "换一场"与"看到哪儿了"无关，不该以滚动为代价（同 `Intro` 那条老教训）。

        ★ 只在「操作台」页 + 窄容器时出现：其余三页没有"挑场景"这件事。

        ★ 宽屏（`narrow === false`）**不渲染**：那时左栏本来就在，
          再摆一条**内容相同**的折叠条 = 两处入口说同一件事，
          用户还得自己判断"这两个是不是一回事"。
          ⇒ 窄屏有、宽屏无 —— 这也是探针 ⑥ 段两个方向断言的落点。
      */}
      {view === 'console' && narrow && (
        <NarrowScenePicker
          agents={agents}
          scenes={scenes}
          categories={categories}
          recommendations={recommendations}
          selected={selected}
          onSelect={pick}
        />
      )}

      <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
        {view === 'console' && leftHidden === null && (
          <aside
            // ★ 宽度档位（109）：`data-kaipu-left-w` 是给判据读的**实读值**，
            //   不是"我们以为自己设了多少" —— 让探针能断"点了真的变宽"。
            data-kaipu-left-w={String(leftWidth)}
            style={{
              width: leftWidth,
              // ★ 160ms 过渡：宽度是**用户点出来的**，一下子跳过去会让人怀疑"是不是点错了"。
              //   用 `width` 而不是 `flex-basis` —— 我们给的是固定宽（`flex:'0 0 auto'`）。
              transition: 'width 160ms ease',
              flex: '0 0 auto',
              // ★ 右边界线**不在这里画** —— 交给下面那个把手承担（见它的注释）
              //   两边都画会变成"双线"（把手自身也有 borderRight）
              overflowY: 'auto',
            }}
          >
            <LeftPane
              agents={agents}
              scenes={scenes}
              categories={categories}
              recommendations={recommendations}
              selected={selected}
              onSelect={pick}
            />
          </aside>
        )}

        {/*
          ★★ 左栏开关 —— 做成**分隔线上的把手**（放标题栏要移鼠标）。

          三条设计决定，逐条有理由：
            1. **位置在左栏与右栏之间**：用户"选完场景往右看"时，鼠标**本来就在这一带**；
               放标题栏得把鼠标甩到顶上，回来还得再找一次。
            2. **它自己承担那条分隔线**（`borderRight`）：视觉上是一个"抽屉边"，
               而不是浮在角落的一个按钮。所以 `aside` 那边**不再画线**（两边都画 = 双线）。
            3. **收起后它留在原地**：左栏让位 ⇒ 把手就贴在右栏的左边缘。
               它**不会跳回标题栏**（那正是原方案最别扭的地方）。

          ★ 窄屏（`narrow`）**不渲染**它：那时左栏本来就塞不下，
            给了就是一个按不动的按钮（假承诺）。窄屏的出路是"把窗口拉宽"，由空态文案说明。

          ★ 只在「操作台」页出现 —— 它是**场景栏的把手**，与其它三页无关。

          ★ 不做 `:hover` 变色：本仓是**全内联样式**（没有 CSS 文件），要 hover 就得挂 state，
            而那会让**整个面板**跟着重渲染（一个悬停换一次全量 render，不划算）。
            ⇒ 改用"始终可见的淡箭头 + `title` 提示"来交代"这里能点"。

          ★★ 2026-10-08（109 · 定案「做 C+D」）：把手**加了第二个按钮 —— 调宽**。
             上面那个管"在不在"，下面这个管"多宽"。
             ★ 为什么两个按钮都挂在这一条 13px 的竖条上、而不是各占一个角：
               它们同属**同一件事**（"这一栏怎么摆"），放在一起，用户调完一个顺手就能调另一个；
               分开放就成了两个都要重新找的东西。
             ★ 为什么调宽那个按钮**占满剩余全高**（`flex:'1 1 auto'`）：
               竖条总高 = 主区高（~900px），只给 44px 的话它就成了一个**几乎点不到的小点**。
             ★ 为什么收起左栏时**不渲染**调宽按钮：没有栏可调宽 ——
               留着它 = 一个按不动的按钮（同 `NARROW_BREAKPOINT` 那条"假承诺"纪律）。
        */}
        {view === 'console' && narrow === false && (
          <div
            style={{
              flex: '0 0 auto',
              width: 13,
              display: 'flex',
              flexDirection: 'column',
              // ★ 那条分隔线由**这一层**承担（原来在那颗按钮上；两个按钮各画一条会断开）
              borderRight: `1px solid ${C.border}`,
            }}
          >
            <button
              type="button"
              data-kaipu-left-toggle="1"
              aria-label={leftOpen ? '收起场景栏' : '展开场景栏'}
              aria-expanded={leftOpen}
              onClick={() => setLeftOpen((v) => !v)}
              title={leftOpen ? '收起场景栏（把横向空间让给右边）' : '展开场景栏'}
              style={{
                flex: '0 0 auto',
                height: 44,
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: C.faint,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: FS.tag,
                lineHeight: 1,
              }}
            >
              {leftOpen ? '‹' : '›'}
            </button>
            {leftOpen && (
              <button
                type="button"
                data-kaipu-left-widen="1"
                data-kaipu-left-width={String(leftWidth)}
                aria-label={`切换场景栏宽度（当前 ${leftWidth}px）`}
                onClick={cycleWidth}
                title={`切换场景栏宽度（当前 ${leftWidth}px → 点一下 ${LEFT_WIDTHS[nextWidthIdx(safeWidthIdx, widthCap)] ?? 260}px）`}
                style={{
                  flex: '1 1 auto',
                  // ★ 顺序有讲究：`border` 简写放**前**、`borderTop` 放**后**
                  //   —— 反过来的话简写会把 borderTop 一起重置成 none（本仓踩过 `font:'inherit'` 那个同款坑）。
                  border: 'none',
                  // ★ 不做 hover 变色（同上）；但给一条淡淡的**上边界**，
                  //   让人看出"上半个和下半个是两个东西"，不必悬停才发现
                  borderTop: `1px solid ${C.border}`,
                  background: 'transparent',
                  color: C.faint,
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: FS.tag,
                  lineHeight: 1,
                }}
              >
                ⇔
              </button>
            )}
          </div>
        )}

        {/*
          ★★ 这是主区（滚动容器）—— 四页共用一块。
          ⚠️ 分页之前它同时是「铺子资料 ↓ / 怎么用 ↑」的滚动落点（`ref={scrollerRef}`）；
             页签落地后**那两条跳转已不存在**；`104` 起它又有了新用途 ——
             **换场之后回到顶部**（见 `mainRef` 那个 effect），所以重新挂上了 ref。
             ★ 与当年那次的区别：当年那个 ref 是给"滚动导航"用的（已废），
               这个是给"换场回顶"用的，读它的只有一处。
        */}
        <section ref={mainRef} style={{ flex: '1 1 auto', minWidth: 0, overflowY: 'auto' }}>
          {view === 'manage' && <ManagePlaceholder />}

          {/* ── 铺子资料页：整页即 `ShopShelf`，折叠态由本页自持 ──
              ★ `onFill` 只在真服务端路径给（演示/通道不可用时没有可填的落点），
                但资料区本身**照常可用** —— 没接入服务端从来不是"自己不能存东西"的理由。 */}
          {view === 'shop' && <ShopPage onFill={isMock ? null : placeFill} onGoRun={canGoRun ? goRun : null} />}

          {/* ── 怎么用页：整页即 `Intro`（去掉「收起」，整页即内容）── */}
          {view === 'help' && <HelpPage />}

          {view === 'console' && (
            <>
              {/*
                ★★ B 组「过程概览」—— 运行视图**之外**的一块（2026-10-06 · 过程可见性口径）。

                ① **位置摆在运行视图之前**：它回答的是"这一场跑了什么"，
                   而这正是"提交等结果"体感的主因 —— 摆在上面才是**一目了然**，
                   摆到长列表末尾要先滚一屏才看得见（那就不叫概览了）。
                ② **锚点是 `data-kaipu-process`、且落在 `data-kaipu-run` 之外**：
                   那节口径的原文要求「**先隔离，再展示**」——
                   概览里的「轮次走向」一行**含判定词**，留在边界内会把
                   R2/R3 的断言喂成假绿。⇒ 物理隔离，不靠判据自己记得排除。
                ③ 它只在**跑过之后**出现（`idle` 时返回 `null`），未运行的面板第一眼仍是运行视图。
              */}
              <ProcessFacts run={run} />

              {/*
                ★★ C 组「这场谁来审 / 要过哪几面」（2026-10-08 · 设计稿的位/灯分画落地）。

                ① **位置摆在运行视图之前**：它回答的是"这场由谁审、要过哪几面" ——
                   属于**发起之前就该看清**的信息；摆到运行结果后面就变成"事后说明"了。
                ② ★★ **必须在 `data-kaipu-run` 之外**（「先隔离，再展示」）：
                   探针有一条 R4 断言，读 `[data-kaipu-run]` **内**的文本来证「仁灯在报告里可见」；
                   而本块**按设计就列出全部审核面**（含仁灯）⇒ 放进运行视图会让那条断言**恒真**。
                   ★ 这不是"判据该改"，是**新内容不该越过判据边界**（与 `Intro` / `ProcessFacts` 同款处理）。
                ③ `scene === null` 时它自己返回 `null`（不占位、不留空壳）。
              */}
              <SeatLampPanel scene={scene} />

              {/* ★★ `data-kaipu-run` = 运行视图的**判据边界**。
                  探针断 R2/R3/R4 时读这一块的文本，而不是整页文本 —— 否则页面上任何
                  一处出现"第 2 轮"都会让断言蒙对（图例、说明、别的区块…）。
                  ★ 反过来：**新增的展示内容一律放在这条线之外** —— 这是那节的口径，
                    不是"想起来才排除"，而是**结构上就够不着**。 */}
              <div data-kaipu-run="1">
                <RightPane
                  scene={scene}
                  run={run}
                  sourceLabel={snap?.label ?? null}
                  isMock={isMock}
                  // ★ 空态要说清"去哪儿挑场景" ⇒ 得知道左栏在不在、以及**为什么不在**
                  //   （"用户收起"与"容器太窄"出路不同，见 leftHidden 注释）
                  leftHidden={leftHidden}
                  onStop={stop}
                  // ★ 演示模式不给"开始运行"（没有可跑的服务端）；真服务端才给
                  onStart={isMock ? null : start}
                  running={running}
                  runError={runError}
                  signed={isMock ? MOCK_SIGNATURE !== null : false}
                  errorCode={errorCode}
                  onFireError={setErrorCode}
                  onClearError={() => setErrorCode(null)}
                  // ★ 运行视图里给一个回铺子资料的入口（与顶部页签同源）
                  onGoShop={() => switchView('shop')}
                  // ★ 从铺子资料填入待审内容的信号（见上面 `fill` 的注释）
                  fill={fill}
                  // ★ 从铺子资料点「开始运行」过来的信号（见 `focusSeq` 的注释）：
                  //   切回来之后把发起区**滚到正中间**，不是"过去了就算到了"
                  focusSeq={focusSeq}
                  onFocusConsumed={consumeFocus}
                  lead={
                    isLoading
                      ? '正在读取…'
                      : scenes.length === 0
                        ? snap?.reason ?? '这个铺子还没有可用的流程。'
                        : null
                  }
                />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * 数据源状态条。
 *
 * ★★ 只在**需要解释**的时候出现（`live` 时不占位置）：
 *   · `unreachable` / `no_channel` ⇒ **必须说清为什么**，并给"改用演示数据"的出路
 *   · `mock` ⇒ 明示"这是演示数据"（纪律 3）
 *
 * ★ 连不上时**保持数据区为空**，不偷偷填 mock —— 见文件头那段。
 */
function SourceBanner({ snap, onUseMock }: { snap: Snapshot | null; onUseMock: () => void }): ReactElement | null {
  if (snap === null || snap.kind === 'live') return null
  const bad = snap.kind === 'unreachable' || snap.kind === 'no_channel'
  return (
    <div
      data-kaipu-source={snap.kind}
      style={{
        padding: '8px 14px',
        borderBottom: `1px solid ${C.border}`,
        background: bad ? 'rgba(220,38,38,0.05)' : 'rgba(107,114,128,0.06)',
        fontSize: FS.small,
        lineHeight: 1.7,
      }}
    >
      <span style={{ color: bad ? '#dc2626' : C.dim }}>{snap.label}</span>
      {snap.reason !== null && <span style={{ color: C.dim }}>　{snap.reason}</span>}
      {bad && (
        <button
          type="button"
          aria-label="改用演示数据"
          onClick={onUseMock}
          style={{
            marginLeft: 10,
            fontSize: FS.tag,
            padding: '2px 9px',
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          改用演示数据看看
        </button>
      )}
    </div>
  )
}

/* ───────────── 过程概览（B 组 · 2026-10-06）───────────── */

/**
 * 本次运行的**事实**：什么场景、本场跑了哪些审核面、轮次怎么走、服务端什么时候跑的。
 *
 * ★★ 为什么单开一块
 *
 *   这几行**全是 `start` / `round_*` 事件里本来就有的东西**，之前**一个都没显示**
 *   ⇒ "这一场到底审了哪几个审核面、回了几次炉"，只能靠往下的灯行一个个去数。
 *
 * ★★ 为什么它**长在**本文件（装配层）、而不是 `RightPane`（运行视图）
 *
 *   ① 它**不是**运行视图的一部分：运行视图是"这一场审到了什么"，
 *      本块是"这一场**跑了些什么**"的概览 —— 两件事。
 *   ② **判据边界**：`RightPane` 渲染出的整块 DOM 就是 `data-kaipu-run`，
 *      而那节口径明写「新增锚点必须在 `data-kaipu-run` **之外**」。
 *      本块的「轮次走向」一行**含判定词**（`第 1 轮 ✅通过`）——
 *      若留在边界内，探针那些"运行视图里出现了 ✅通过"的断言会被**这一行**喂饱，
 *      而它要验的是**判定与口径面**真的在。
 *      ⇒ **物理隔离**（`data-kaipu-process`），而不是让判据自己记得做减法。
 *      ★ 早期版本正是"探针读文本时排除 `[data-kaipu-facts]`" —— 已废弃：
 *        减法只在"读的人记得减"时成立，换个人写判据污染立刻回来。
 *        **先隔离，再展示**（复核意见原文）就是这个意思。
 *
 * ★★ 为什么轮次只给**结构**、不给**时刻**（诚实说明，不是省事）
 *
 *   事件流里**没有到达时刻**（契约 §3.4 的事件不带时间戳，`serverTime` 只在 `start` 那一处），
 *   而 `reduceRun` 是**纯函数** —— 它不能在内部拿 `Date.now()`
 *   （那样同一个事件序列会产出不同结果，判据与单测当场失真）。
 *   ⇒ 这里只排**结构**：第几轮 → 判定 → 下一轮（**回炉因此看得见**）。
 *     **不编**一个本地时刻去冒充"每轮是什么时候跑的"。
 */
function ProcessFacts({ run }: { run: RunView }): ReactElement | null {
  // ★ 没跑过就没有"过程"可概览 —— 不摆一个空壳（空壳会被读成"跑了但什么都没有"）
  if (run.status === 'idle') return null

  const rows: { label: string; value: string }[] = []
  if (run.scene !== null && run.scene !== '') rows.push({ label: '场景', value: run.scene })
  if (run.participated.length > 0) {
    rows.push({ label: '本场审核面', value: run.participated.join('、') })
  }
  if (run.rounds.length > 0) {
    // ★ 只排结构（轮次号 + 判定），**不带时刻** —— 原因见上面那段
    rows.push({
      label: '轮次走向',
      value: run.rounds
        .map((r) => (r.verdict === null ? `第 ${r.round} 轮` : `第 ${r.round} 轮 ${r.verdict}`))
        .join(' → '),
    })
  }
  if (run.serverTime !== null) rows.push({ label: '服务端时刻', value: run.serverTime })
  if (rows.length === 0) return null

  return (
    <section
      // ★★ 独立锚点。★ 判据断的不是"这块钱存在"，而是
      //   "它**不在** `[data-kaipu-run]` 里面"（`closest()` 为 null）——
      //   那才是这条判据要守的东西，也是它**能失败**的地方。
      data-kaipu-process="1"
      style={{
        marginTop: 12,
        padding: '8px 10px',
        background: C.soft,
        fontSize: FS.small,
        lineHeight: LH.loose,
      }}
    >
      <div style={{ fontSize: FS.tag, color: C.dim, marginBottom: 3 }}>本次运行 · 过程概览</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', gap: 10 }}>
          <span style={{ color: C.dim, minWidth: 68, flex: '0 0 auto' }}>{r.label}</span>
          <span style={{ color: C.text, minWidth: 0, overflowWrap: 'break-word' }}>{r.value}</span>
        </div>
      ))}
    </section>
  )
}

/* ───────────── 顶部页签：操作台 / 铺子资料 / 管理方 / 怎么用（2026-10-08）───────────── */

/**
 * ★★ 顶部页签栏 —— 四个页签，**顺序即 `tabs` 数组顺序**（做 → 我的东西 → 管理 → 帮助）。
 *
 * 设计决定（逐条有理由）：
 *   1. **四个并列 tab，不用抽屉**：这四件事互不从属，平级才诚实。
 *   2. **激活态用底部 3px 蓝线**（`C.accent`），不用暖金 —— 暖金是"签名灯/主行动"的语义色，
 *      页签是**导航**性质，避免"看起来像主 CTA"。
 *   3. **不持久化选择**：页签是导航，不该跨挂载记忆（同 `Intro` 不写 localStorage 的纪律）。
 *   4. ★ 锚点 `data-kaipu-tab={id}`（`console` / `shop` / `manage` / `help`）——
 *      **判据切页签靠它，不靠中文文案**（文案会改，锚点不会）。
 *   5. ★ **首访可发现保底**：演示模式下「怎么用」挂一个小蓝点，**看过即消** ——
 *      引导从"右栏顶上一张卡"变成"一个页签"之后，第一眼的人不一定会去点它。
 *      看没看过（`helpSeen`）由装配层持有：**页签是导航，不跨挂载记忆**（同第 3 条）。
 *      非演示模式不挂 —— 那种人手里已有一份别人给的接入凭据，不是"第一次看"。
 */
function TabBar({
  view,
  onSwitch,
  showHelpNew,
}: {
  view: ViewId
  onSwitch: (v: ViewId) => void
  showHelpNew: boolean
}): ReactElement {
  const tabs: { id: ViewId; label: string }[] = [
    { id: 'console', label: '操作台' },
    { id: 'shop', label: '铺子资料' },
    { id: 'manage', label: '管理方' },
    { id: 'help', label: '怎么用' },
  ]
  return (
    <nav
      data-kaipu-tabs="1"
      role="tablist"
      aria-label="视图切换"
      style={{
        flex: '0 0 auto',
        display: 'flex',
        gap: 4,
        padding: '0 12px',
        borderBottom: `1px solid ${C.border}`,
        background: C.soft,
      }}
    >
      {tabs.map((t) => {
        const active = view === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-kaipu-tab={t.id}
            aria-selected={active}
            onClick={() => onSwitch(t.id)}
            style={{
              fontSize: FS.base,
              padding: '9px 14px',
              border: 'none',
              borderBottom: active ? `3px solid ${C.accent}` : '3px solid transparent',
              background: 'transparent',
              color: active ? C.text : C.dim,
              cursor: 'pointer',
              font: 'inherit',
              marginBottom: -1,
            }}
          >
            {t.label}
            {/* ★ 首访可发现保底（见组件头第 5 条）：小圆点，**看过即消**（不持久化） */}
            {t.id === 'help' && showHelpNew && (
              <span
                data-kaipu-tab-new="help"
                aria-label="还没看过"
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  marginLeft: 5,
                  borderRadius: 3,
                  background: C.accent,
                  verticalAlign: 'super',
                }}
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * ★★ 窄屏的「选场景」折叠条（2026-10-08）。
 *
 * ── 它补的是什么（不是"优化"，是补一个缺）────────────────────────────
 *   评估实测：容器 < 640 时左栏与把手**都不渲染** ⇒ 544px 宽的面板里
 *   用户**没有任何选场景的入口**。而 `selected` 会自动选中第一场，
 *   界面看起来一切正常 —— 他只会发现自己**换不了场**，也不知道该去哪儿换。
 *
 * ── 三个设计决定 ───────────────────────────────────────────────────
 *   1. ★ **内容复用 `LeftPane` 本体**（`where="picker"`），不新写一份场景列表。
 *      左栏不只有场景：还有「执行方」（谁被接进这场戏 / 谁待接入）与
 *      「该怎么选」（推荐位）。只给一个场景下拉，等于在窄屏下**把这两块删掉**；
 *      而另写一份窄屏版，两份会各自长歪（少一个「待接入 N」都没人发现）。
 *   2. ★ **默认收起**（`<details>` 不带 `open`）：窄屏本来就矮，
 *      常驻展开会把运行视图挤下去。收起态只占一行，且那一行**写着当前是哪一场** ——
 *      不看也知道自己站在哪儿（`data-kaipu-scene-current`）。
 *   3. ★ **用原生 `<details>`**，不自绘抽屉/浮层：面板挂在宿主容器里，
 *      容器常带 `overflow` 裁剪，自绘浮层会被裁掉还得自己处理定位/键盘/触屏；
 *      原生 `<details>` 零 JS、键盘可用、不会被裁（同左栏分类折叠的取舍）。
 *
 * ── 锚点 ───────────────────────────────────────────────────────────
 *   `data-kaipu-scene-picker` = 折叠条本身（探针断"窄屏有它、宽屏没有它"）
 *   `data-kaipu-scene-picker-body` = 展开后的那份内容（由 `LeftPane` 挂）
 *   ★ 两者与宽屏的 `data-kaipu-left` **严格分开** ——
 *     共用一个名字会让"窄屏下左栏不在"那条反向断言当场失效。理由见 `LeftPaneProps.where`。
 *
 * ★ 展开区给 `maxHeight` + 自己滚：场景多时（真服务端可能十几场）
 *   不让它把整页顶下去 —— 它是个**选择器**，不是页面主体。
 */
function NarrowScenePicker({
  agents,
  scenes,
  categories,
  recommendations,
  selected,
  onSelect,
}: Omit<LeftPaneProps, 'where'>): ReactElement {
  /**
   * ★★ 展开态**由这里持有**（2026-10-08）。
   *
   * 为什么从"原生非受控"改成受控：定案要一条新行为 ——
   *   **选完一场就自动收起**（选场景是这个框唯一的本职，选完就该把屏幕还给运行视图）。
   *   非受控的 `<details>` 做不到"程序化收起"。
   *
   * ★★ 但**必须保住非受控当初要的那条性质**：「数据刷新不会把它弹回去」。
   *   受控写法天然满足 —— `open` 只在**用户动作**里变（下面两处），
   *   数据换代（切数据源 / 快照重取）不碰它。
   *   ⇒ 换句话说：改用受控是**为了加一条新行为**，不是为了放松旧性质。
   */
  const [open, setOpen] = useState(false)

  /**
   * ★ 选一场 = 换场 + **顺手收起**。
   * ★ 不把 `onSelect` 直接透给 `LeftPane`：那样就得改 `LeftPane` 的签名去接一个
   *   "选完之后干什么"的回调 —— 而"选完收起"是**折叠条自己的事**（左栏常驻，无所谓收起）。
   *   在装配层包一层，语义留在它该在的地方。
   */
  const pickAndFold = (scene: string): void => {
    onSelect(scene)
    setOpen(false)
  }

  return (
    <details
      data-kaipu-scene-picker="1"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ flex: '0 0 auto', borderBottom: `1px solid ${C.border}`, background: C.soft }}
    >
      <summary
        style={{
          padding: '7px 14px',
          cursor: 'pointer',
          fontSize: FS.small,
          lineHeight: 1.7,
          // ★ 摘要行不许被长场景名撑破容器（窄屏本来就窄）
          overflowWrap: 'break-word',
        }}
      >
        <span style={{ color: C.dim }}>场景</span>
        {/* ★ 当前哪一场 —— 收起态下这是**唯一**能告诉你"站在哪儿"的东西。
            ★ 与宽屏左栏「场景」标题行**同一个件、同一个锚点**（见 `SceneCurrent` 注释）：
              "选完自动收起之后，当前选中项要留在折叠条上可见，不能选完就消失"（§一）。 */}
        <span style={{ marginLeft: 8 }}>
          <SceneCurrent scenes={scenes} selected={selected} />
        </span>
        <span style={{ marginLeft: 8, color: C.faint }}>{open ? '点收起' : '点开换一场'}</span>
      </summary>
      <div style={{ maxHeight: 320, overflowY: 'auto', borderTop: `1px solid ${C.border}` }}>
        <LeftPane
          agents={agents}
          scenes={scenes}
          categories={categories}
          recommendations={recommendations}
          selected={selected}
          onSelect={pickAndFold}
          where="picker"
          // ★ 场景前置：这个框的本职就是选场景 ——
          //   而实测框高 320 / 场景列表起点 341px，不前置就得先滚过执行方与推荐位（对应章节）。
          sceneFirst
        />
      </div>
    </details>
  )
}

/**
 * 「铺子资料」页 —— 整页即 `ShopShelf`。
 *
 * ★ 折叠态**由本页自持**（`open`）：`ShopShelf` 自身不持有折叠状态
 *   （它当年把状态抬给装配层，是为了让"顶部跳转按钮"和"抽屉自己"说的是同一件事；
 *    现在跳转按钮没了，本页就是那个装配层 ⇒ 状态落在本页最自然）。
 * ★ 默认展开：这是"我自己的东西"放哪儿 —— 藏起来会让人以为这儿根本没这一块。
 */
function ShopPage({
  onFill,
  onGoRun,
}: {
  onFill: ((text: string, name: string) => void) | null
  onGoRun: (() => void) | null
}): ReactElement {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ padding: '4px 0 24px' }}>
      <ShopShelf onFill={onFill} onGoRun={onGoRun} open={open} onToggleOpen={() => setOpen((v) => !v)} />
    </div>
  )
}

/**
 * 「怎么用」页 —— 整页即 `Intro`。
 *
 * ★ 与旧版（右栏顶部一张可展开/收起的卡）的区别：**去掉「收起」按钮，整页即内容** ——
 *   页签本身就是"我来学用法"的意图表达，再让人先"展开"一次是多余的动作。
 * ★ 锚点 `data-kaipu-intro` 保留（判据认它）。
 */
function HelpPage(): ReactElement {
  return (
    <div style={{ padding: '4px 0 24px' }}>
      <Intro />
    </div>
  )
}

/**
 * 管理方页签 · 占位 + 指路（2026-10-08 · 决策人定「发起开铺默认是管理方」）。
 *
 * ★★ 它**不是**管理功能：客户端零管理能力（红线 ③）。这里只做两件事：
 *   ① 把"管理方是谁、他主持什么"讲清楚 —— 对齐「发起开铺默认是管理方」的决策：
 *      主动研究过开铺、知道流程的人主持会商，握手成本最低、流程最顺。
 *   ② 指路到服务端管理方界面（P2.5）—— 真动作（发起开铺 / 指派执行方）在那边做，
 *      本地演示模式不开此入口（如实说"暂不开放"，不伪造 picker）。
 *
 * ★★ 落在 `[data-kaipu-run]` **之外**：整个页签切换走运行视图，结构上够不着判据边界
 *   （「先隔离，再展示」的本意 —— 不是靠判据自己记得排除）。
 */
function ManagePlaceholder(): ReactElement {
  return (
    <section
      data-kaipu-manage="1"
      style={{
        margin: '14px 12px',
        padding: '16px 18px',
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        background: C.soft,
      }}
    >
      <div style={{ fontSize: FS.title }}>🪔 管理方 · 开铺主持</div>
      <p style={{ margin: '10px 0 0', fontSize: FS.base, lineHeight: LH.normal, color: C.text }}>
        默认由<b>发起开铺的人（管理方）</b>主持会商流程。他通常已主动研究过开铺、知道流程，握手成本最低、流程最顺。
      </p>
      <div style={{ marginTop: 12, fontSize: FS.small, color: C.dim, lineHeight: LH.loose }}>
        管理方的动作（均在场地服务端的管理方界面操作，P2.5）：
      </div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: FS.base, color: C.text, lineHeight: LH.normal }}>
        <li>发起开铺（建一场场景 / 会商流程）</li>
        <li>指派执行方（执行位 · 审计位）</li>
        <li>调整角色位（变更留痕，可追溯）</li>
      </ul>
      <div
        style={{
          marginTop: 14,
          padding: '8px 12px',
          border: `1px dashed ${C.border}`,
          borderRadius: 6,
          fontSize: FS.small,
          color: C.dim,
          lineHeight: LH.loose,
        }}
      >
        当前本地演示模式暂不开放此入口 —— 接入场地服务端后，铺主在管理方界面发起开铺、指派执行方。
      </div>
    </section>
  )
}
