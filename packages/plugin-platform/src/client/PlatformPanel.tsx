/**
 * 山海·开铺 · 场地插件 · 主面板
 * =====================================================================
 * ★ 布局：**左总台 + 右运行视图**（承"内侧竖栏"设计）。
 *
 * 为什么是这个布局（不是审美偏好，是插件形态决定）：
 *   插件面板**天然是"嵌在宿主里的一个区域"**，不是全屏应用 ——
 *   它可能挂在侧边栏（很窄）/ 主区域（很宽）/ 悬停卡（更窄）。
 *   ⇒ 左右分栏 + 弹性伸缩是唯一天然适配三档的布局。
 *
 * ★★ 断点看**容器宽度**，不看窗口宽度。
 *   早先的教训：面板可能被塞进很窄的挂载点，用 `window.innerWidth` 判断必然误判。
 *   ⇒ 用 ResizeObserver 量自己。
 *
 * ── 本文件只做四件事 ──────────────────────────────────────────────
 *   ① 量宽度 → 决定折不折左栏；② 取数据快照（真服务端 / 演示）；
 *   ③ 持有"选了哪个场景 / 是否已停止接收"；④ 组装。
 *
 * ★★ 数据源**必须是显式状态**（2026-10-05 接真接口时立的）——
 *   `live` / `mock`（人工选的）/ `unreachable`（真连不上）三者严格分开。
 *   **绝不在连不上时悄悄回落 mock**：那会让用户以为在看真结果，
 *   其实在看演示数据 —— 这是比"白屏"更坏的一类错（**看起来是对的**）。
 *   连不上就**如实说连不上**，并给一个**显式的**"改用演示数据看看"按钮。
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { SceneRunEvent } from '@shanhai/kaipu-contract'
import { Intro, PanelHead } from './Intro.js'
import { LeftPane } from './LeftPane.js'
import { RightPane, type RunInput } from './RightPane.js'
import { ShopShelf } from './ShopShelf.js'
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
 */
const NARROW_BREAKPOINT = 640

/** 左栏宽度 —— 与上面阈值是一对，改一个必须看另一个 */
const LEFT_WIDTH = 260

/** 未运行的场景共用这一个空数组 —— 避免每次渲染都新建（否则 useMemo 每次失效） */
const NO_EVENTS: readonly SceneRunEvent[] = []
const NO_SCENES: Snapshot['scenes'] = []

/** 用户选的数据源：`auto` = 先试真服务端；`mock` = 明确要看演示数据 */
type SourcePref = 'auto' | 'mock'

/**
 * 最近的**可滚动祖先**（按 `overflow-y` 声明找；都没有就退回文档根）。
 *
 * ★ 只给上面的跳转 effect 的**兜底判据**用：量"资料到底可不可见"。
 *   它按**声明**找、不按"当前能不能滚"找 —— 找错了也不产生副作用
 *   （找不到能滚的那个 ⇒ 说明内容本来就装得下 ⇒ 无需兜底，正是我们要的结论）。
 */
function nearestScroller(el: HTMLElement): HTMLElement {
  let p = el.parentElement
  while (p !== null) {
    const ov = getComputedStyle(p).overflowY
    if (ov === 'auto' || ov === 'scroll') return p
    p = p.parentElement
  }
  return document.documentElement
}

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
   * ★★ 首屏引导（「怎么用」卡）是否展开。
   *
   * ★ 默认值**不是一个常量**，它**跟随数据源**（2026-10-07 · 发起人点题）：
   *   · **演示数据** ⇒ 默认**展开** —— 看演示的人多半是第一次看、或在给别人演，
   *     "三步 + 四个词 + 判定图例"正是他此刻要的；
   *   · **其余（真服务端 / 连不上）** ⇒ 默认**收起** —— 已经接上的人是来干活的，
   *     每次进来先收一次引导＝每次都被挡一下；他真要看，标题栏「怎么用 ↑」就在那儿。
   *
   * ★ 为什么"接没接上真服务端"可以拿来当"熟不熟"的代理：
   *   接了真服务端的人，手里已经有一份**别人给他的接入凭据** ——
   *   至少有人跟他讲过这是什么。而看演示数据的人，多半什么都还不知道。
   *   （这不是铁律，只是**手边唯一不需要额外状态**的强代理。见 ① 的兜底。）
   *
   * ★★ 三条实现纪律（判据会盯这几条）：
   *
   *   ① **用户手动开合过 ⇒ 之后不再自动改**（`introTouched`）。
   *      系统只在"用户没表态"时替他定默认；他一表态，就不替他做决定。
   *      拿不准时**宁可不改** —— 替人"恢复默认"比不恢复更烦人。
   *   ② **读到数据源之前不渲染**（`snap === null`，见下面渲染处）——
   *      否则两种情形都会先闪一下展开态（本机取快照几十毫秒，真服务端几百毫秒），
   *      再当着用户的面收走。**宁可晚一帧出现，也不要闪。**
   *   ③ `PanelHead` 的 `open`（aria-expanded 与按压态）必须跟着**同一个值** ——
   *      否则按钮说"已展开"而卡不在，自相矛盾。
   */
  const [intro, setIntro] = useState(false)
  /**
   * 用户有没有**自己**开合过引导卡。
   * ★ 用 ref 不用 state：它只影响"以后还自不自动改"，**不参与渲染** ——
   *   放 state 会平白多一轮重渲染，而这一层每次重渲染都在跟 ≈300ms 的轮询抢时间。
   */
  const introTouched = useRef(false)
  /** 用户**自己**开合引导卡 ⇒ 记下"他表过态了"，之后不再按数据源自动改（见 ①）。 */
  const setIntroByUser = (v: boolean): void => {
    introTouched.current = true
    setIntro(v)
  }
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
   * ★★ 「从铺子资料填入待审内容」= 一条**单向信号**，不是一个值。
   *
   * 为什么带 `seq`：两次填的可能是**同一份文件、同一段文本** ——
   * 用值本身做依赖，第二次就不会触发（React 认为没变化）。
   * 递增序号让"又一次填入"这件事**每次都成立**。
   *
   * ★ 为什么状态放在这一层：铺子资料区在运行视图**之外**（见下方渲染处），
   *   而"待审内容"输入框在运行视图**之内** —— 两者要对话，信号就得抬到共同祖先。
   */
  const [fill, setFill] = useState<{ text: string; name: string; seq: number } | null>(null)

  /* ── ★★ 铺子资料的折叠与「跳过去」（2026-10-07 加）────────────────────
   * 这三样（`shopOpen` / `jumpSeq` / `shelfRef`）是**同一件事的三个零件**：
   *   顶部按钮说"我要去铺子资料" ⇒ ① 把它展开 ② 滚到它那儿 ③ 得知道"它"是谁。
   * 所以它们放在一起，而不是各自藏在组件里。
   */

  /**
   * 铺子资料的折叠状态 —— **抬到这一层的理由**见 `ShopShelfProps.open`：
   * 顶部按钮与底部抽屉说的是同一件事，状态只能有一个来源。
   * 默认**展开**：那是"我自己的东西"放哪儿，藏起来会让人以为这儿根本没这一块。
   */
  const [shopOpen, setShopOpen] = useState(true)

  /**
   * ★★ 跳转信号 —— 与 `fill` 同族：**单向信号，不是一个值**。
   *
   * 为什么用递增序号而不是布尔：连点两次必须**每次都成立**。
   * 用布尔的话第二次 `true → true` 不产生变化（React 认为没改，effect 不跑），
   * 而用户明明又点了一次 —— 他却什么都没发生。这正是 `fill` 当初带 `seq` 的原因。
   */
  const [jumpSeq, setJumpSeq] = useState(0)

  /** 铺子资料的外壳。滚动要有个**具体落点**，不是"滚到页面最底下"这种谁也说不清的说法 */
  const shelfRef = useRef<HTMLDivElement | null>(null)

  /**
   * ★★ 「怎么用 ↑」的回顶信号 —— `jumpSeq` 的**对称另一半**（2026-10-07 加）。
   *
   * 为什么需要它（实测反馈）：标题栏是常驻的，用户在底部**点得到**「怎么用」，
   * 但卡在**顶上**展开 —— 点了等于没点，"看用法"这件事依然以滚一屏为代价。
   * ⇒ 与「铺子资料 ↓」同构：一个去底、一个回顶，两端各有一个能"动视口"的入口。
   *
   * ★ 同样是**单向递增信号**，不是布尔 —— 连点两次都要有反应（理由同 `jumpSeq`）。
   */
  const [introSeq, setIntroSeq] = useState(0)

  /**
   * 右栏的**滚动容器**（`overflowY: auto` 那层）。
   *
   * ★ 为什么回顶不用 `scrollIntoView`：目标是"0"这个绝对位置，不是某个元素。
   *   标题栏在滚动容器**之外**，`scrollIntoView` 在它身上是空操作
   *   （它本来就在视野里）—— 那样写会**看起来写对了、实际一动不动**。
   */
  const scrollerRef = useRef<HTMLElement | null>(null)

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
      if (w > 0) setNarrow(w < NARROW_BREAKPOINT)
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

  /* ── 引导卡的默认态**跟随数据源**（见 `intro` 那段的三条纪律）────────────
   *
   * ★ 为什么放在 effect 里而不是 `useState(isMock)` 的初值里：
   *   数据源是**异步**到的 —— 首次渲染时 `snap === null`，"是不是演示数据"还不知道。
   *   写在初值里 ⇒ 永远拿到 `false`（`null?.kind` 不是 `'mock'`），
   *   演示数据下引导卡就再也不展开了。**这个错会静默地只影响演示模式**，
   *   而演示模式恰恰是给外人看的那个模式。
   *
   * ★ 依赖 `[isMock]` 而不是 `[snap]`：`live` 与 `unreachable` 两种快照
   *   在"引导该不该默认展开"上是**同一个答案**（都收起）。
   *   依赖 `snap` 会在两种非演示快照之间互相切换时白跑一趟。
   */
  useEffect(() => {
    if (introTouched.current) return
    setIntro(isMock)
  }, [isMock])

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

  /* ── ★★ 顶部「铺子资料 ↓」：一条信号，两个动作（展开 + 滚到底）───────── */

  /** 顶部按钮点下去只做一件事：排两个状态。**滚动不在这里**，理由见下面 effect。 */
  const jumpToShelf = (): void => {
    setShopOpen(true) // 展开（可能本来就是展开的 —— 那也无需特殊处理）
    setJumpSeq((n) => n + 1) // 再发一次信号：连点两次都要有反应
  }

  /**
   * ★★ 「怎么用 ↑」= **把用法带到眼前**：展开（若收着）+ 视口回顶部。
   *
   * ★★ 为什么不是"切换开关"（第一版就是那么写的，跑完真机判据才想明白）：
   *   用法卡**默认展开** ⇒ 用户在页面底部看它时，它其实已经展开、只是**看不见**。
   *   那时按钮若写着「收起用法」，点下去卡就被**收走** ——
   *   他要的是"看用法"，得到的却是"用法消失"。
   *   **导航的意图会被开关的行为吃掉。**
   *   ⇒ 拆开：这里只管"带到眼前"；「收起」挪到**卡自己**的右上角
   *     （想收起的人，视线本来就在卡上）。
   *
   * ★ 滚动不写在 onClick 里（同 `jumpToShelf`）：切换是**排状态**，
   *   这一帧 DOM 还没变；等 effect 跑时才拿到提交后的布局。
   * ★ 即使已经展开也照发信号 —— 用户可能只是"在底部想回去看"。
   *   "已在顶就什么都不做"由 effect 自己判断（那是它的事，不是按钮的事）。
   */
  const jumpToIntro = (): void => {
    // ★ 走 `setIntroByUser`：用户点它 = 表态"我要看用法" ⇒ 之后不再按数据源自动改。
    setIntroByUser(true)
    setIntroSeq((n) => n + 1)
  }

  /**
   * ★★ 为什么滚动放在 effect 里，而**不是**直接在 onClick 里滚一下。
   *
   * 点下去的那一刻，抽屉**还是收起的**（`setShopOpen(true)` 只是排了队，
   * 这一帧的 DOM 里那块只有标题一行）⇒ 此刻算出来的"底部"是**收起态的底部**；
   * 等 React 提交完展开，页面又长高一截，人就落在一个**半路**的位置上。
   *   · effect 在提交**之后**才跑 ⇒ 量到的是展开后的真实布局；
   *   · `scrollIntoView` 自己会强制一次同步布局 ⇒ 不必"再等一帧"碰运气。
   *
   * ★ `block:'end'` = 把这块的**底边**对齐到滚动容器底边 ⇒ 就是"拖到底部"。
   *   这是**唯一**的滚动动作：不再叠一个 `window.scrollTo`（两处各滚一次会互相打架，
   *   而且先滚的那个会先跳一下 —— 看起来像"点了两次"）。
   *
   * ★ 尊重系统的"减少动态效果"：那种设置下**瞬移**（`auto`），不做平滑动画。
   *   （平滑动画对前庭敏感的人是实打实的难受，不是审美问题。）
   *
   * ★★ 平滑 + **目标兜底**（同一次实测逼出来的）：
   *
   *   平滑滚动在**页面不可见时不会推进** —— 这不是推测，是实测：
   *   `document.visibilityState === 'hidden'` 时，**同一个调用**
   *   瞬时版把滚动容器的 `scrollTop` 从 0 推到 3296，
   *   平滑版**一个像素都不动**（判据当场变红才发现）。
   *   而"看不见的页面"在宿主里是会出现的（后台窗口 / 未激活的挂载点）。
   *
   *   ⇒ 兜底量的是**动画有没有起步**（`scrollTop` 有没有变），不是"等了多久"：
   *     起步了就让它滚完（不然会把一段好好的动画**中途掐断**成瞬移）；
   *     没起步就立刻瞬移 —— 要的是**结果**（资料看得见），动效只是过程。
   */
  useEffect(() => {
    if (jumpSeq === 0) return
    const el = shelfRef.current
    if (el === null) return
    const sc = nearestScroller(el)
    const before = sc.scrollTop
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      el.scrollIntoView({ block: 'end' })
      return
    }
    el.scrollIntoView({ block: 'end', behavior: 'smooth' })
    const t = window.setTimeout(() => {
      if (sc.scrollTop === before) el.scrollIntoView({ block: 'end' })
    }, 160)
    return () => {
      window.clearTimeout(t)
    }
  }, [jumpSeq])

  /**
   * ★★ 回顶 effect —— 与上面那个**对称**，连"平滑 + 起步兜底"都同款。
   *
   * 为什么要有兜底（不是抄一遍图省事）：平滑滚动在**页面不可见时不推进**
   * 是本机实测过的（`visibilityState === 'hidden'` ⇒ 瞬时版 0→3296、
   * 平滑版一个像素都不动）。"看不见的页面"在宿主里真会出现 ⇒ 同一套兜底。
   *
   * ★ 已经在顶（`scrollTop === 0`）就**直接返回**：不启动画、不排定时器 ——
   *   那时"滚到顶"本来就已成立，跑了只是白闪一下。
   *   （这也让"点了没反应"与"点了但无需动"能区分开：前者是 bug，后者是正常。）
   *
   * ★ 为什么不用 `scrollIntoView`（同 `scrollerRef` 那条注释）：
   *   目标是 `0` 这个**绝对位置**，不是某个元素。标题栏在滚动容器**之外**，
   *   对它有 `scrollIntoView` 是空操作 —— 会写成"看着对、实际一动不动"。
   */
  useEffect(() => {
    if (introSeq === 0) return
    const sc = scrollerRef.current
    if (sc === null) return
    const before = sc.scrollTop
    if (before === 0) return
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      sc.scrollTo({ top: 0 })
      return
    }
    sc.scrollTo({ top: 0, behavior: 'smooth' })
    const t = window.setTimeout(() => {
      if (sc.scrollTop === before) sc.scrollTo({ top: 0 })
    }, 160)
    return () => {
      window.clearTimeout(t)
    }
  }, [introSeq])

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
   *     · 容器太窄 ⇒ 出路是「把窗口拉宽」（这时**根本没有**那个按钮 ——
   *       窄屏下我特意不给它，见下面把手处的 `narrow === false` 判断）
   *       ［2026-10-07 更正：此处原写"见 PanelHead 的 `leftToggle: null`" ——
   *          PanelHead 从来没有这个 prop，那个判断一直就在本文件里。注释指向不存在的东西
   *          比没有注释更坏（读的人会去找、会以为漏了）。］
   *   ⇒ 用一个布尔就把两种出路说成同一种，会**让人去按一个不存在的按钮**。
   *     （同 `live.ts` 那条纪律：读不到要**如实说原因 + 给出路**，别糊一句通用话。）
   */
  const leftHidden: 'collapsed' | 'narrow' | null = narrow ? 'narrow' : leftOpen ? null : 'collapsed'

  return (
    <div ref={hostRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 常驻标题栏：第一眼先知道"这是什么" */}
      <PanelHead
        // ★ 纪律 ③：与卡片渲染**同一个值** —— 否则按钮说"已展开"而卡不在。
        //   `snap !== null &&` 那半截同卡片：读源之前按钮也报"收起态"。
        open={snap !== null && intro}
        // ★ 「怎么用 ↑」= 展开 + 回顶部（**导航**，不是开关 —— 见 jumpToIntro）。
        //   「收起」在卡自己的右上角（见 `Intro` 的 data-kaipu-intro-collapse）。
        onJumpToIntro={jumpToIntro}
        source={snap === null ? '正在读取…' : snap.label}
        onUseMock={() => setPref((p) => (p === 'mock' ? 'auto' : 'mock'))}
        mockActive={isMock}
        // ★ 顶部「铺子资料 ↓」：展开 + 滚到底（见 jumpToShelf / 下面那个 effect）
        onJumpToShelf={jumpToShelf}
      />

      <SourceBanner snap={snap} onUseMock={() => setPref('mock')} />

      <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
        {leftHidden === null && (
          <aside
            style={{
              width: LEFT_WIDTH,
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

          ★ 不做 `:hover` 变色：本仓是**全内联样式**（没有 CSS 文件），要 hover 就得挂 state，
            而那会让**整个面板**跟着重渲染（一个悬停换一次全量 render，不划算）。
            ⇒ 改用"始终可见的淡箭头 + `title` 提示"来交代"这里能点"。
        */}
        {narrow === false && (
          <button
            type="button"
            data-kaipu-left-toggle="1"
            aria-label={leftOpen ? '收起场景栏' : '展开场景栏'}
            aria-expanded={leftOpen}
            onClick={() => setLeftOpen((v) => !v)}
            title={leftOpen ? '收起场景栏（把横向空间让给右边）' : '展开场景栏'}
            style={{
              flex: '0 0 auto',
              width: 13,
              padding: 0,
              border: 'none',
              borderRight: `1px solid ${C.border}`,
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
        )}

        {/*
          ★★ 这一层是**右栏的滚动容器** —— 顶部「铺子资料 ↓」与「怎么用 ↑」
          一个滚到底、一个滚回顶，落点都在它身上（`ref={scrollerRef}`）。
          ⚠️ 换掉这个 `overflowY: auto` ⇒ 两个跳转同时失效（而且都是**静默**失效：
             滚动调用落在 `documentElement` 上，页面纹丝不动，控制台一声不响）。
        */}
        <section ref={scrollerRef} style={{ flex: '1 1 auto', minWidth: 0, overflowY: 'auto' }}>
          {/* ★ 引导卡在运行视图**之外** —— 它里面有四类判定的图例，
              若长在运行视图里，探针那些"运行视图里出现了 ⚡有条件"的断言就变成恒真的空断言。
              （这条边界**被验证过会失败**：把它挪进去跑探针 ⇒ 精确报"判据边界成立"1 项未过。）
              ★ 「收起」按钮长在卡自己身上（见 `Intro`）—— 标题栏那个位置留给"去用法"导航。
          ★★ `snap !== null &&` 这半截是**默认态跟随数据源**的纪律 ②（见 `intro` 那段）：
             读到数据源之前不渲染，免得演示/真机两种情形都先闪一下展开态再被收走。 */}
          {snap !== null && intro && (
            <Intro
              onCollapse={() => {
                setIntroByUser(false)
              }}
            />
          )}

          {/*
            ★★ B 组「过程概览」—— 也是**运行视图之外**的一块（2026-10-06 · 古茶 013 / 008 D-D3）。

            ① **位置摆在运行视图之前**：它回答的是"这一场跑了什么"，
               而这正是"提交等结果"体感的主因 —— 摆在上面才是**一目了然**，
               摆到长列表末尾要先滚一屏才看得见（那就不叫概览了）。
            ② **锚点是 `data-kaipu-process`、且落在 `data-kaipu-run` 之外**：
               008 §1.2 D-D3 的原文要求「**先隔离，再展示**」——
               概览里的「轮次走向」一行**含判定词**，留在边界内会把
               R2/R3 的断言喂成假绿。⇒ 物理隔离，不靠判据自己记得排除。
            ③ 它只在**跑过之后**出现（`idle` 时返回 `null`），未运行的面板第一眼仍是运行视图。
          */}
          <ProcessFacts run={run} />

          {/* ★★ `data-kaipu-run` = 运行视图的**判据边界**。
              探针断 R2/R3/R4 时读这一块的文本，而不是整页文本 —— 否则页面上任何
              一处出现"第 2 轮"都会让断言蒙对（图例、说明、别的区块…）。
              ★ 反过来：**新增的展示内容一律放在这条线之外**（引导卡、铺子资料、
                过程概览三处都在这条线外）—— 这是 D-D3 的口径，
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
              // ★ 从铺子资料填入待审内容的信号（见上面 `fill` 的注释）
              fill={fill}
              lead={
                isLoading
                  ? '正在读取…'
                  : scenes.length === 0
                    ? snap?.reason ?? '这个铺子还没有可用的流程。'
                    : null
              }
            />
          </div>

          {/*
            ★★ 铺子资料放在运行视图（`data-kaipu-run`）**之外** —— 两个理由，都不是审美：

            ① **判据边界**：`data-kaipu-run` 是探针读文本断言 R2/R3/R4 的那块。
               把「文件列表」并进去，探针那些"运行视图里出现了 X"的断言就可能被
               **旁边不相干的文字**喂成假绿（本仓已有同类教训：Intro 卡同样被移出来）。
            ② **它本来就不属于运行视图**：那是"我自己的东西放哪儿"，
               与"这一场审到了什么"是两件事。混在一块，两边都读不清。
          */}
          {/*
            ★★ 外壳只为一件事：给顶部的「铺子资料 ↓」一个**具体的落点**。

            `paddingBottom` 是落点的手感 —— 滚到底时抽屉底边与容器底边齐平会显得"顶住了"，
            留一点余量才像"到头了"而不是"被切了"。

            ★ 它**不是**判据边界：判据边界是 `data-kaipu-run`（见上一段）。
              本壳只是一个位置标记 —— 无锚点、无语义，判据不认它。
          */}
          <div ref={shelfRef} style={{ paddingBottom: 12 }}>
            <ShopShelf
              // ★ 折叠状态由本层持有（理由见 ShopShelfProps.open 的注释：
              //   顶部按钮与底部抽屉是同一件事的入口，状态只能有一个来源）
              open={shopOpen}
              onToggleOpen={() => setShopOpen((v) => !v)}
              // ★ 演示模式 / 通道不可用时**不给"填入"**（没有可填的落点），
              //   但资料区本身**照常可用** —— 没接入服务端从来不是"自己不能存东西"的理由。
              onFill={
                isMock
                  ? null
                  : (text, name) => {
                      setFill((prev) => ({ text, name, seq: (prev?.seq ?? 0) + 1 }))
                    }
              }
            />
          </div>
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

/* ───────────── 过程概览（B 组 · 2026-10-06 · 古茶 013）───────────── */

/**
 * 本次运行的**事实**：什么场景、本场跑了哪些审核面、轮次怎么走、服务端什么时候跑的。
 *
 * ★★ 为什么单开一块
 *
 *   这几行**全是 `start` / `round_*` 事件里本来就有的东西**，之前**一个都没显示**
 *   ⇒ "这一场到底审了哪几维、回了几次炉"，只能靠往下的灯行一个个去数。
 *
 * ★★ 为什么它**长在**本文件（装配层）、而不是 `RightPane`（运行视图）
 *
 *   ① 它**不是**运行视图的一部分：运行视图是"这一场审到了什么"，
 *      本块是"这一场**跑了些什么**"的概览 —— 两件事。
 *   ② **判据边界**：`RightPane` 渲染出的整块 DOM 就是 `data-kaipu-run`，
 *      而 008 §1.2 D-D3 明写「新增锚点必须在 `data-kaipu-run` **之外**」。
 *      本块的「轮次走向」一行**含判定词**（`第 1 轮 ✅通过`）——
 *      若留在边界内，探针那些"运行视图里出现了 ✅通过"的断言会被**这一行**喂饱，
 *      而它要验的是**判定与口径面**真的在。
 *      ⇒ **物理隔离**（`data-kaipu-process`），而不是让判据自己记得做减法。
 *      ★ 我方第一版正是"探针读文本时排除 `[data-kaipu-facts]`" —— 已废弃：
 *        减法只在"读的人记得减"时成立，换个人写判据污染立刻回来。
 *        **先隔离，再展示**（回函原文）就是这个意思。
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
      // ★★ 独立锚点（008 D-D3）。★ 判据断的不是"这块钱存在"，而是
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
