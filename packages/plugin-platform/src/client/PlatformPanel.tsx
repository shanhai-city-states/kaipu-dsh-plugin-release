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
import { loadLive, mockSnapshot, type Snapshot } from './live.js'
import { MOCK_RUNS, MOCK_SIGNATURE } from './mock/data.js'
import { startRun, type RunSession } from './run.js'
import { reduceRun } from './run-reducer.js'
import { C, FS } from './theme.js'

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
  /** ★ 首屏引导是否展开。默认**展开** —— 没有它，第一眼是一屏结论性信息却无从下手。 */
  const [intro, setIntro] = useState(true)
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
   *       窄屏下我特意不给它，见 PanelHead 的 `leftToggle: null`）
   *   ⇒ 用一个布尔就把两种出路说成同一种，会**让人去按一个不存在的按钮**。
   *     （同 `live.ts` 那条纪律：读不到要**如实说原因 + 给出路**，别糊一句通用话。）
   */
  const leftHidden: 'collapsed' | 'narrow' | null = narrow ? 'narrow' : leftOpen ? null : 'collapsed'

  return (
    <div ref={hostRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 常驻标题栏：第一眼先知道"这是什么" */}
      <PanelHead
        open={intro}
        onToggle={() => setIntro((v) => !v)}
        source={snap === null ? '正在读取…' : snap.label}
        onUseMock={() => setPref((p) => (p === 'mock' ? 'auto' : 'mock'))}
        mockActive={isMock}
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

        <section style={{ flex: '1 1 auto', minWidth: 0, overflowY: 'auto' }}>
          {/* ★ 引导卡在运行视图**之外** —— 它里面有四类判定的图例，
              若长在运行视图里，探针那些"运行视图里出现了 ⚡有条件"的断言就变成恒真的空断言。
              （这条边界**被验证过会失败**：把它挪进去跑探针 ⇒ 精确报"判据边界成立"1 项未过。） */}
          {intro && <Intro />}

          {/* ★★ `data-kaipu-run` = 运行视图的**判据边界**。
              探针断 R2/R3/R4 时读这一块的文本，而不是整页文本 —— 否则页面上任何
              一处出现"第 2 轮"都会让断言蒙对（图例、说明、别的区块…）。 */}
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
              lead={
                isLoading
                  ? '正在读取…'
                  : scenes.length === 0
                    ? snap?.reason ?? '这个铺子还没有可用的流程。'
                    : null
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
