/**
 * 山海·开铺 · 场地插件 · 右栏 = **运行视图 / 报告**
 * =====================================================================
 * 契约 `sse-events.json` 的 renderRules 就是这一栏的验收标准，逐条落点写在这里：
 *
 *   [R2] 按「**第 N 轮**」**分段**（不合并成一条流水）—— 回炉必须看得见
 *   [R3] 四类判定可区分且可见（实底徽标，见 theme.ts）
 *   [R4] ★ dims 裁剪后，尾部**固定**显示「本次参与审核面 / 未参与审核面 / 裁剪依据」，
 *        且**不得做成可折叠的次要信息**。
 *        ★ 2026-10-05 起本栏**允许折叠**（"一页预览"：折轮次过程），
 *          但**那两块口径永远不进折叠** —— 判据沿它们的**祖先链**断言
 *          "不在任何 details 里"（对准契约原文）。
 *          ⚠️ 原注释写的是"整栏没有折叠控件"，那是**比契约更严**的自我约束，
 *             会把一个正当需求挡在门外 ⇒ 已按原文改写。
 *   [R5] 断开 = 「**已停止接收**」，不写「已取消」
 *
 * ★ 另一条来自契约的"不许做的事"：`usage` 是**唯一可信计费口径**，
 *   这一栏**只显示**它，不做任何二次计算（不"估算"、不"按 token 折算"）。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  ReadShopTextResult,
  SceneCard,
  ShopFileEntry,
  ShopFilesPayload,
  ShopSubdir,
  WriteShopFilesResult,
} from '@shanhai/kaipu-contract'
import { ERROR_CODES, SHOP_SUBDIRS, hasUiText, translateError } from '@shanhai/kaipu-contract'
import { ENDPOINTS, callKaipu } from './bridge.js'
import { CONSTRAINTS } from './copy.js'
import { ErrorSurface } from './ErrorSurface.js'
import { currentConnection } from './live.js'
import { seatChangesOf, errorDetailOf, type SeatChangeRecord } from './mock/data.js'
import {
  DIMS_FOOTER,
  STATUS_TEXT,
  STOPPED_EXPLAIN,
  toneOf,
  type LampView,
  type RoundView,
  type RunErrorView,
  type RunView,
  type SummaryView,
  type UsageView,
} from './run-reducer.js'
import { C, FONT, FS, LH, TONE_BG } from './theme.js'

/** 一次运行的输入（契约 §3.4 的 `target` / `content`） */
export interface RunInput {
  target: string
  content: string
}

export interface RightPaneProps {
  scene: SceneCard | null
  run: RunView
  /** 数据来源标签。mock 时**必须**给（见 mock/data.ts 纪律 3） */
  sourceLabel: string | null
  /**
   * ★ 是否演示数据。**必须与 `sourceLabel` 分开**（2026-10-05 接线时立的）：
   *   接上真服务端后 `sourceLabel` 变成「真服务端」（**也非 null**），
   *   若还拿它判断"是不是演示"，界面会对着真服务端说
   *   「面板尚未接入服务端；下面每条判定都来自本地演示序列」—— **当着真的说假的**。
   */
  isMock: boolean
  onStop: () => void
  /** ★ 发起运行（真服务端路径）。`null` = 当前不可发起（演示模式 / 通道不可用） */
  onStart: ((input: RunInput) => void) | null
  /** 运行是否进行中（用于禁用重复发起） */
  running: boolean
  /** 运行失败时的**原文**（不翻译、不吞） */
  runError: string | null
  /** 报告是否已签名。未接入服务端 ⇒ 恒 false ⇒ 必须显示约束 ① */
  signed: boolean
  /** 当前触发的错误码（演示用；接真服务端后由请求失败驱动） */
  errorCode: string | null
  onFireError: (code: string) => void
  onClearError: () => void
  /**
   * ★ 跳回「铺子资料」页签（真服务端路径下，运行视图里给一个返回入口）。
   *   与顶部页签是**同一动作**的两处入口：页签负责"全局切"，这里负责"填完东西顺手回去取更多"。
   *   为什么必要：从铺子资料「填入待审内容」会把人带**过来**（见 PlatformPanel.placeFill），
   *   那么"带过来之后想再取一份"就该有路回去，否则单程。
   */
  onGoShop: () => void
  /**
   * ★ 空态时**代替**那句通用引导的说明（`null` = 用默认引导）。
   *
   * 为什么要它：`scene === null` 有**三种完全不同的原因**，用户要做的事也不同 ——
   *   · 还没选（给引导）
   *   · 正在读（给"稍候"）
   *   · **读不到**（给原因 + 出路）
   * 用同一句"先从左边挑一场场景"糊过去，是把"读失败"伪装成"你还没操作"。
   */
  lead: string | null
  /**
   * ★ 来自铺子资料的「填入待审内容」信号。
   *   `seq` 递增 ⇒ **每次都算一次新填入**（两次填同一份文件时文本没变，
   *   只认文本就永远不会触发第二次）。
   */
  fill: { text: string; name: string; seq: number } | null
  /**
   * ★ 从铺子资料点「开始运行」过来的一次性信号（`0` = 没有这一趟）。
   *   见 `PlatformPanel.focusSeq`：跨页之后要把**发起区本身**送到视野中间，
   *   不是"切回操作台"就算到了。
   */
  focusSeq: number
  /** 信号已消费（清零）—— 它是**一次性**的，留着会反复把人拖过来 */
  onFocusConsumed: () => void
  /**
   * ★★ 左栏若不可见，**为什么**（`null` = 可见）。见 `PlatformPanel` 的 `leftHidden`。
   *
   * 为什么空态需要知道这件事：挑场景的入口**不在右边**。而"左栏不在"有**两种**
   * 不同的原因，**出路也不一样**：
   *   · `'collapsed'` 用户收起 ⇒ 点顶部「展开场景栏」（那个按钮在）
   *   · `'narrow'`    容器太窄 ⇒ 把窗口拉宽（这时**没有**那个按钮 —— 窄屏不给开关）
   * 原来空态写死"先从左边挑一场「场景」"⇒ **在那一刻它是与事实不符的话**。
   */
  leftHidden: 'collapsed' | 'narrow' | null
}

export function RightPane({
  scene,
  run,
  sourceLabel,
  isMock,
  onStop,
  onStart,
  running,
  runError,
  signed,
  errorCode,
  onFireError,
  onClearError,
  onGoShop,
  lead,
  leftHidden,
  fill,
  focusSeq,
  onFocusConsumed,
}: RightPaneProps): ReactElement {
  // ★ 空态也要能回答"去哪儿挑场景" ⇒ 把原因带下去
  if (scene === null) return <NoScenePicked lead={lead} leftHidden={leftHidden} />

  // ★ 一个执行方都没有 ⇒ 这不是错误，是"场地本来就是空的"这一**正常状态**
  //   （零内置执行方也能把场地跑起来）。措辞要让用户知道接下来做什么，而不是以为坏了。
  const inbound = scene.lamps.filter((l) => l.agentId !== null).length

  return (
    // `overflowWrap` 兜底：面板可能被挂进很窄的挂载点，长 ID / 长英文串要有地方断
    <div style={{ padding: 14, overflowWrap: 'break-word' }}>
      <Header scene={scene} run={run} onStop={onStop} />

      {isMock && sourceLabel !== null && (
        <div style={{ marginTop: 10, fontSize: FS.small, lineHeight: LH.normal }}>
          <Badge bg="#6b7280">{sourceLabel}</Badge>
          <span style={{ color: C.dim }}>
            {' '}
            —— 面板尚未接入服务端；下面每条判定都来自本地演示序列，不是真实运行结果。
          </span>
        </div>
      )}

      {/* ★★ 约束 ①：报告无签名 ⇒ **醒目**提示。这是三条必须显示的约束里最要紧的一条 ——
          "签过名的报告才拿得出去"，那么没签名的报告必须一眼看出来。 */}
      {!signed && <UnsignedBanner />}

      {/* 错误面：把 code 翻译成用户语言；两个"另走一条路"的码不在这里当错误渲染。
          ★ detail 必须一路传下去 —— 那两个码的出路就在 detail 里（见 mock/data.ts）。 */}
      {errorCode !== null && (
        <ErrorSurface code={errorCode} detail={errorDetailOf(errorCode)} onDismiss={onClearError} />
      )}

      {inbound === 0 && <ZeroInbound scene={scene} />}

      {/* ★ R5：措辞就在这里 —— 「已停止接收」，且解释服务端仍在算完 */}
      {run.status === 'stopped' && (
        <div style={{ marginTop: 12, fontSize: FS.base, color: '#b45309', lineHeight: LH.normal }}>
          {STOPPED_EXPLAIN}
        </div>
      )}

      {/* ★ 运行失败：**原文照出**。不翻译、不吞、不换成"加载失败"这种空话 ——
          「服务端说了什么」比「我们概括成什么」更值得让人看到。 */}
      {runError !== null && (
        <div
          data-kaipu-run-error="1"
          style={{
            marginTop: 12,
            padding: '10px 12px',
            border: '1px solid #fca5a5',
            borderLeft: '3px solid #dc2626',
            background: 'rgba(220,38,38,0.05)',
            fontSize: FS.base,
            lineHeight: LH.normal,
          }}
        >
          <div style={{ color: '#dc2626' }}>这次运行没能跑起来。</div>
          <div style={{ fontSize: FS.small, color: C.dim, marginTop: 3 }}>服务端的说明：{runError}</div>
        </div>
      )}

      {/* ★ 空态：**先给"怎么开始"**，再说"尚未运行"。
          ★★ 为什么 `inbound === 0`（全部待接入）**也允许**发起（2026-10-05 实测后改）：
            一开始的判据是"没有执行方就不给跑"，但实测服务端**照样能把这一场跑完**
            （回 `lamp_done.verdict = ⚪未接入` + `summary` + `usage`，19ms 返回）。
            ⇒ 挡住它等于**替用户下了一个"跑不了"的结论**，而事实是跑得了、
              只是结论是"未接入"。**把决定权还给用户**，同时如实提示可能的结局。 */}
      {run.status === 'idle' && (
        onStart !== null && !isMock
          ? (
            <StartRunForm
              onStart={onStart}
              running={running}
              sceneLabel={scene.label}
              noneInbound={inbound === 0}
              onGoShop={onGoShop}
              fill={fill}
              focusSeq={focusSeq}
              onFocusConsumed={onFocusConsumed}
            />
          )
          : <Note>该场景尚未运行。</Note>
      )}

      {/*
        ★★ 流内 `error`（契约 §3.4 · 2026-10-06 补）—— 放在**轮次之前**：
          放在长列表后面会被淹掉，而"这次运行报过错误"是用户该**先**知道的事。
      */}
      {run.errors.length > 0 && <RunErrorsBlock errors={run.errors} />}

      {run.rounds.map((r) => (
        <RoundBlock key={r.round} round={r} />
      ))}

      {run.summary !== null && <SummaryBlock summary={run.summary} finishReason={run.finishReason} />}
      {run.usage !== null && <UsageBlock usage={run.usage} />}

      {/* ★★ 约束 ②：角色位变更必须留痕（记录 + 原因，可追溯） */}
      <SeatChangeBlock records={seatChangesOf(scene.scene)} />

      {/* 演示脚手：把全部错误码走一遍**真实渲染路径**（只在 mock 模式出现） */}
      {isMock && <DemoErrorHarness active={errorCode} onFire={onFireError} />}
    </div>
  )
}

/* ─────────────────── 发起运行（真服务端路径）─────────────────── */

/**
 * 往上找**真正在滚动**的那个容器。
 *
 * ★ 为什么"往上找"而不是拿某个写死的 ref：主滚动容器属于装配层
 *   （`PlatformPanel` 里那块 `overflowY: 'auto'`），发起区自己够不着；
 *   写死 ref 就要把 ref 一路传下来，多一层套管就多一处会断的地方。
 * ★ 判据是"`overflowY` 可滚 **且** scrollHeight 真超出 clientHeight" ——
 *   只看 `overflow` 会挑出一个"样式写着能滚、其实内容没超"的祖先，滚了等于没滚。
 */
function nearestScroller(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement
  while (p !== null) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p
    p = p.parentElement
  }
  return null
}

/** 让 `el` 在容器 `box` 里**居中**所需的 scrollTop */
function centerTop(box: HTMLElement, el: HTMLElement): number {
  const b = box.getBoundingClientRect()
  const e = el.getBoundingClientRect()
  // ★ 元素比容器还高时"居中"没意义（上下沿都在视野外）⇒ 退回到"顶对齐"，至少头在这里
  const delta = e.height >= b.height ? e.top - b.top : e.top - b.top - (b.height - e.height) / 2
  return Math.max(0, Math.min(box.scrollHeight - box.clientHeight, box.scrollTop + delta))
}

/**
 * ★★ 平滑滚到 `want`，并**只在"没起步"时**补一次瞬移 —— 返回兜底定时器句柄。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 为什么兜底判据是"**位置变没变**"，不是"**到没到目标**"
 * ══════════════════════════════════════════════════════════════════
 * 两种判据都写着"400ms 后补一枪"，但语义完全不同：
 *
 *   · 「**没到目标**就补」⇒ 用户在这 400ms 里**自己滚了**，就把他**拽回**目标位置。
 *     它在 `101`（跨页切过来居中）那个场景没问题 —— 刚切页，用户不可能同时在自己滚。
 *   · 「**没起步**就补」⇒ 只有当"滚动位置与发起时**一模一样**"才补。
 *     那说明平滑那一路**压根没起步**（本仓老账：**页面不可见时平滑滚动是空操作，且不报错**）；
 *     只要位置动过一点（无论去的是目标还是用户自己的方向）就不插手。
 *
 * ⇒ 本函数现在也服务于「**点开某一轮**」这种**高频、用户正在读**的场景（`104`）：
 *   那里"抢用户滚动"的代价大得多（他可能正滚着往下看第 2 轮）。
 *   ⇒ 统一用"没起步就补"，两处都受益；`101` 原来的语义**被这条严格覆盖**（它那边同样满足）。
 *
 * ★ `onSettle` 在两种结局后都会回调（"已经到位"与"补完瞬移"）—— 调用方据此消费一次性信号。
 */
function smoothScrollTo(box: HTMLElement, want: number, onSettle?: () => void): number | null {
  const start = box.scrollTop
  if (Math.abs(want - start) <= 1) {
    onSettle?.()
    return null
  }
  box.scrollTo({ top: want, behavior: 'smooth' })
  return window.setTimeout(() => {
    if (Math.abs(box.scrollTop - start) <= 1) box.scrollTop = want
    onSettle?.()
  }, 400)
}

/**
 * ★★ 「展开之后把被展开的东西落到视野中央」的**门控阈值**（`104`）。
 *
 * 语义：**只有当"展开后确有内容在视野外（> 这个像素数）"才滚**；否则一动不动。
 *
 * ★★ 为什么必须有门控（实测反例，不是洁癖）：
 *   同一轮次块，容器 `scrollTop=268` 时它**只差 13px 就全看得见**，
 *   而"居中"要跳 **220px** —— **用户点一下，页面猛挪，什么都没多看到**。
 *   ★ 要害是：**居中要跳的距离与"你还有多少看不见"无关**（另一个样本：差 108px 却跳 315px）。
 *   ★ 它与 `100` 里给"自动收缩"判**不做**的那条代价同族（位置不稳定 ⇒ 想再点第二次得重新找），
 *     只是量级更大（那边 347px，这边最大 817px）。
 *
 * ★ 取值 24px ≈ 半行中文（`FS.base` 14 × 行高 1.8 ≈ 25）——
 *   "差半行以上才算真看不见"，差半行以内不值得动页面。
 */
const EXPAND_CENTER_MIN_HIDDEN = 24

/**
 * 「上一次点击 summary」的**有效期**（毫秒）—— 窗口内到来的 `toggle` 才算"用户点的"。
 *
 * ★ 取值 300ms 的依据：点击与 `toggle` 派发之间是**同一轮任务队列**（浏览器在默认动作
 *   改变 `open` 后排队派发），实测在几十毫秒内 ⇒ 300ms 余量充足。
 * ★ 取太长的代价：把"用户上一下点过的残留"当成这一次（误滚）；
 *   取太短的代价：`toggle` 还没派发到、窗口就过期了（该滚的没滚）。
 *   两头都不好，所以取"远大于实际间隔、远小于人的下一次动作"。
 */
const USER_CLICK_WINDOW_MS = 300

/**
 * ★ 为什么"发起运行"要有输入框，而不是一个按钮直接跑：
 *   契约 §3.4 的 `content` 是**待审内容** —— 没有它，这一场审的就是空。
 *   给一个能填的表单是**诚实**的；给一个直接跑的按钮会把
 *   "我们没内容可审" 伪装成 "场地在正常工作"（**看起来是对的**，最坏的一类）。
 *
 * ★ 按钮的禁用判据：`content` 为空 ⇒ 禁用。**不替用户编一段占位内容**。
 */
function StartRunForm({
  onStart,
  running,
  sceneLabel,
  noneInbound,
  fill,
  onGoShop,
  focusSeq,
  onFocusConsumed,
}: {
  onStart: (input: RunInput) => void
  running: boolean
  sceneLabel: string
  /** ★ 该场景**所有**维度都未接入执行方。不是故障，但要说清跑起来大概会看到什么 */
  noneInbound: boolean
  /** 来自铺子资料的填入信号（见 `RightPaneProps.fill`） */
  fill: { text: string; name: string; seq: number } | null
  /** 跳回「铺子资料」页签（运行视图里的返回入口） */
  onGoShop: () => void
  /** 一次性信号：有人从铺子资料点「开始运行」过来 ⇒ 把自己滚到视野中间 */
  focusSeq: number
  onFocusConsumed: () => void
}): ReactElement {
  const [target, setTarget] = useState('')
  const [content, setContent] = useState('')
  const ready = content.trim() !== '' && !running
  const boxRef = useRef<HTMLElement | null>(null)
  /** 居中滚动的兜底定时器（★ 为什么不放 effect cleanup —— 见下面那段注释） */
  const scrollTimer = useRef<number | null>(null)

  /**
   * ★★ 从铺子资料填入待审内容 —— 依赖的是 `seq`（**事件**），不是 `text`（**值**）。
   *
   * 为什么必须这样：用户可能连着两次用**同一份**文件 —— 文本逐字没变，
   * 若拿文本当依赖，第二次就不会触发，而用户会觉得"点了没反应"。
   *
   * ★ 只写 `content`，**不碰 `target`**：`target` 是"这一场审的是什么"的名字，
   *   由用户自己起；文件名未必等于他想给这一场起的名字，
   *   顺手覆盖它 = 替他做了一个他没做的决定。
   */
  useEffect(() => {
    if (fill === null) return
    setContent(fill.text)
  }, [fill])

  /**
   * ★★ 从铺子资料点「开始运行」过来 ⇒ 把自己滚到**视野正中间**（2026-10-08 · 101）。
   *
   * 为什么必须滚：这一栏上面压着「这场谁来审 / 要过哪几面」那一整块，
   *   发起区常常在第一屏之外 ⇒ 只切页签，人到了却看不见它（"点了没反应"体感）。
   *
   * ★★ 为什么**不是** `scrollIntoView`：它会连带滚动**外层窗口**（宿主页面），
   *   把宿主自己的布局也拽动 —— 这一层不该碰别人的滚动位置。
   *   ⇒ 只动**自己那个**滚动容器的 `scrollTop`（`nearestScroller` 认出来的）。
   *
   * ★★ 延时兜底这条路径**不能用 effect 自己的 cleanup 收** —— 那是个坑：
   *   消费信号会改 `focusSeq` ⇒ effect 重跑 ⇒ cleanup 先执行 ⇒ **把兜底定时器当场掐掉**
   *   （只剩平滑那一路，而它恰恰是可能一动不动的那一路）。
   *   ⇒ 定时器存 ref，只在**本组件真的卸载**时清（下面那个空依赖的 effect）。
   *   ★ 滚动本身走共用的 `smoothScrollTo`（`104` 起两处共用，兜底判据统一为"**没起步**就补"）。
   */
  useEffect(() => {
    if (focusSeq === 0) return
    const el = boxRef.current
    const box = el === null ? null : nearestScroller(el)
    // 没有可滚的容器 ⇒ 它本来就在视野里，没有"目标位"可去；信号照样算已消费
    if (el === null || box === null) {
      onFocusConsumed()
      return
    }
    scrollTimer.current = smoothScrollTo(box, centerTop(box, el), onFocusConsumed)
  }, [focusSeq, onFocusConsumed])

  /** 卸载时把还没落的定时器收掉（★ 只收卸载这一次，不参与上面那条链路） */
  useEffect(
    () => () => {
      if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current)
    },
    [],
  )

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    fontSize: FS.small,
    fontFamily: 'inherit',
    padding: '6px 8px',
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    background: 'transparent',
    color: 'inherit',
    resize: 'vertical' as const,
  }

  return (
    <section ref={boxRef} data-kaipu-start="1" style={{ marginTop: 14 }}>
      <div style={{ fontSize: FS.small, color: C.dim, lineHeight: LH.normal }}>
        该场景尚未运行。填好要审的东西，再发起 —— 跑起来后这里会逐个审核面显示进展。
      </div>

      {/* ★ 来自铺子资料的已填入内容 —— 居中呈现（类似抽屉的"带进来的东西"）。
          下面是它落进的可编辑输入框（契约 §3.4 的 content）：卡片是"你带来了什么"，
          文本框是"还能改"。两处一致，不二选一。 */}
      {fill !== null && (
        <div
          data-kaipu-fill-card="1"
          style={{
            marginTop: 10,
            padding: '10px 12px',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            background: C.soft,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: FS.small, color: C.dim }}>已从铺子资料带入待审内容</div>
          <div style={{ marginTop: 3, fontSize: FS.base, color: C.text, wordBreak: 'break-all' }}>{fill.name}</div>
          <div style={{ marginTop: 4, fontSize: FS.small, color: C.dim, maxHeight: 46, overflow: 'hidden', lineHeight: LH.normal }}>
            {fill.text.length > 120 ? `${fill.text.slice(0, 120)}…` : fill.text}
          </div>
        </div>
      )}

      {/* ★ 如实预告：全部待接入 ≠ 跑不了，但结论大概率是「未接入」。不说清就是让人白等 */}
      {noneInbound && (
        <div style={{ marginTop: 8, fontSize: FS.small, color: '#b45309', lineHeight: LH.normal }}>
          这一场的审核面目前都还没有接入执行方。现在也能发起，但结论大概率是「未接入」（不是故障）。
        </div>
      )}

      <label style={{ display: 'block', marginTop: 10, fontSize: FS.small }}>
        <span style={{ color: C.dim }}>审的是什么（选填）</span>
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="例：XX 方案书 v3"
          style={{ ...inputStyle, marginTop: 4 }}
        />
      </label>

      <label style={{ display: 'block', marginTop: 8, fontSize: FS.small }}>
        <span style={{ color: C.dim }}>待审内容（必填）</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          placeholder={`粘进来就行。这一场会用「${sceneLabel}」的流程来审。`}
          style={{ ...inputStyle, marginTop: 4, lineHeight: LH.normal }}
        />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onStart({ target: target.trim(), content })}
          style={{
            fontSize: FS.small,
            padding: '5px 14px',
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            background: ready ? C.soft : 'transparent',
            color: ready ? 'inherit' : C.dim,
            cursor: ready ? 'pointer' : 'not-allowed',
            font: 'inherit',
          }}
        >
          {running ? '正在跑…' : '开始运行'}
        </button>
        {/* ★ 返回铺子资料：与顶部页签同源的"顺手回去取更多"入口 */}
        <button
          type="button"
          data-kaipu-goshop="1"
          onClick={onGoShop}
          style={{
            fontSize: FS.small,
            padding: '5px 14px',
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            background: 'transparent',
            color: C.dim,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          铺子资料
        </button>
      </div>
    </section>
  )
}

/* ─────────────────────── 还没选场景 ─────────────────────── */

/**
 * ★ 空态**不给一句"从左侧选一个场景"就完事** ——
 *   那时用户还不知道"场景"是什么、选了会怎样。
 *   空态是唯一"用户一定会停在这里想一下"的位置，所以把三句话放在这最划算。
 */
function NoScenePicked({
  lead,
  leftHidden,
}: {
  lead: string | null
  leftHidden: 'collapsed' | 'narrow' | null
}): ReactElement {
  // ★ 有 lead ⇒ 说明"没场景"是**外部原因**（正在读 / 读不到），先如实说清它
  if (lead !== null) {
    return <div style={{ padding: 20, fontSize: FS.base, lineHeight: LH.loose }}>{lead}</div>
  }
  /**
   * ★★ 指引必须**指得着**（2026-10-05 修；2026-10-08 再修一次）。
   *
   * 原来写死"先从左边挑一场「场景」"—— 但左栏可能**被用户收起**、或被窄容器**挤掉**，
   * 那两种情况下左边**什么都没有**：用户照着做只会扑空，
   * 然后怀疑是自己不会用（**界面说了不成立的话，比不说更糟**）。
   * ★ 三种情况**出路不同**，所以必须分开说：
   *   · 可见     ⇒ 指左栏
   *   · 用户收起 ⇒ 指顶部那条分隔线上的把手（它在）
   *   · 容器太窄 ⇒ 指顶部那条「场景」折叠条（它在）
   *
   * ★★ 改的那一条（`'narrow'`）：原文是「把窗口拉宽一些」——
   *   那是把**功能缺失说成用户限制**：窄屏下用户本来就该能干活，
   *   让他去拉窗口 = 承认"这儿你用不了"。
   *   ⇒ 现在窄屏有 `NarrowScenePicker` 兜着，指引就**指得着**了。
   *   ★ 顺带说清一个容易误判的点：这条文案**在窄屏下几乎不会出现** ——
   *     `selected` 会自动选中第一场，`scene !== null` ⇒ 走不到空态。
   *     它是"场景列表为空 / 切数据源的一瞬"的兜底。但**兜底文案也必须是真的**：
   *     写一句"去拉宽窗口"，在真出现的那一次就是**假话**。
   *
   * `data-kaipu-lead` 是判据锚点：让"指引与左栏状态一致"这件事**可被断言**。
   */
  const guide =
    leftHidden === null
      ? '先从左边挑一场「场景」'
      : leftHidden === 'collapsed'
        ? '点顶部的「展开场景栏」，再挑一场「场景」'
        : '窗口太窄放不下场景栏 —— 点顶部的「场景」，再挑一场'
  return (
    <div style={{ padding: 20, fontSize: FS.base, lineHeight: LH.loose }}>
      {/* ★ 定案 · 空态引导一句说清三动作（选场 → 放东西 → 拿报告），不含术语。
          ★ 独立锚点 `data-kaipu-gist`：与 `[data-kaipu-lead]`（去哪儿挑场景）分开断言，
            不打乱那条"能翻转"的判据（见探针 ⑨ 段）。
          ★ 2026-10-08 按定案稿对齐**标点**：原落版是"…审一审，审完…"（一逗到底），
            定案稿是"…审一审。审完…"（**两句**）—— 断句本身在说"三步"：
            前半 = 前两个动作（选场 + 放东西），后半 = 第三个动作（拿报告）。
            ⇒ 一字未增删，只改句读；探针同步为断完整句（见 ⑨ 段）。 */}
      <div data-kaipu-gist="1" style={{ fontSize: FS.heading, lineHeight: LH.normal }}>
        选一场，把你手头的东西放进来审一审。审完给你一份带签的报告。
      </div>
      <div data-kaipu-lead={leftHidden ?? 'visible'} style={{ marginTop: 10, color: C.dim }}>
        {guide}
      </div>
    </div>
  )
}

/* ─────────────────────── 约束 ①：未签名 ───────────────────────
 *
 * ★★ 2026-10-08 改版：**红框 → 暖金提示框**。
 *
 * 旧版是 `border/左边线` 全红 + 红字，形如「报错台」；而"未签名"只是
 * **还没接入签名服务**这一正常态，不是故障。⇒ 视觉改暖金（左侧线 + 米色底），
 * 文案改「预告」语气（见 `copy.ts` 的 `unsignedReport*` 注释）。
 * 约束义务**没丢**：仍醒目显示"当前还不能对外出具"，只是不再像在指责用户。
 * ★ 配色走固定暖金色（不随宿主主题变量）：与旧版红框同策略——
 *   锚点 `data-kaipu-unsigned="1"` 保留，探针可继续认。
 */
function UnsignedBanner(): ReactElement {
  return (
    <div
      data-kaipu-unsigned="1"
      style={{
        marginTop: 12,
        padding: '10px 12px',
        border: '1px solid #d8b863',
        borderLeft: '4px solid #c69a3c',
        background: 'rgba(214,180,92,0.12)',
      }}
    >
      <div style={{ fontSize: FS.base, fontWeight: 600, color: '#9c7a2e' }}>{CONSTRAINTS.unsignedReport}</div>
      <div style={{ fontSize: FS.small, color: C.dim, marginTop: 4, lineHeight: LH.normal }}>
        {CONSTRAINTS.unsignedReportWhy}
      </div>
    </div>
  )
}

/* ─────────────── 流内 error（契约 §3.4 · 2026-10-06 补 · B 组）─────────────── */

/**
 * 流内 `error` 事件。
 *
 * ★★ 它长成这样，是被"**它与请求失败不是一回事**"决定的：
 *   · 请求失败（HTTP 层）⇒ 运行**没跑起来** ⇒ `ErrorSurface`：**可关闭**的提示
 *   · 流内 `error`        ⇒ 运行**跑起来了**   ⇒ **不可关闭**（它不是提示，是记录）
 *   ⇒ 所以这里**没有「知道了」按钮**，也**不打断**下面的轮次与结论 ——
 *     那是 `ErrorSurface` 的职责，不是这条的。
 *
 * ★ 文案来源两条路（**都不直出裸码**）：
 *   ① `code` 在 §8.2 表里 ⇒ 用**契约译法**（口径统一）
 *   ② 未收录 ⇒ 显示**服务端原话** ＋ 标记「未收录」
 *      ★ **不自己补一条文案**：§8.2 由对方维护 —— 缺口**要报，不单方补**。
 *      ★ 裸码只进 `data-kaipu-*` 属性（给判据），**不进可见文本**（同 `ErrorSurface` 的纪律）。
 */
function RunErrorsBlock({ errors }: { errors: readonly RunErrorView[] }): ReactElement {
  return (
    <section
      data-kaipu-run-errors={errors.length}
      style={{
        marginTop: 12,
        padding: '10px 12px',
        border: `1px solid ${C.border}`,
        borderLeft: '3px solid #b45309',
        background: 'rgba(180,83,9,0.05)',
      }}
    >
      <div style={{ fontSize: FS.small, color: '#b45309', lineHeight: LH.normal }}>
        运行中收到服务端的 {errors.length} 条错误。这次运行仍在继续 —— 错误是过程记录，不代表它中断了。
      </div>
      {errors.map((e, i) => {
        const known = hasUiText(e.code)
        const text = known
          ? translateError(e.code)
          : e.message !== ''
            ? e.message
            : '服务端报告了一条错误，但没有给出说明。'
        return (
          <div key={`${e.code}\u0000${i}`} style={{ marginTop: 6, fontSize: FS.base, lineHeight: LH.normal }}>
            <span>{text}</span>
            {!known && (
              <span data-kaipu-unlisted-code={e.code} style={{ fontSize: FS.tag, color: C.dim, marginLeft: 6 }}>
                （这条的说明还没收录，已按服务端原话显示；本仓会报给对方补，不自行代写）
              </span>
            )}
          </div>
        )
      })}
    </section>
  )
}

/* ─────────────────── 约束 ②：角色位变更留痕 ─────────────────── */

function SeatChangeBlock({ records }: { records: readonly SeatChangeRecord[] }): ReactElement {
  return (
    <section data-kaipu-seatlog="1" style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
      <div style={{ fontSize: FS.title }}>{CONSTRAINTS.seatChangeTitle}</div>
      {records.length === 0 ? (
        <div style={{ fontSize: FS.small, color: C.dim, marginTop: 6 }}>{CONSTRAINTS.seatChangeEmpty}</div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {records.map((r) => (
            <div
              key={`${r.seat}|${r.at}`}
              style={{
                fontSize: FS.small,
                lineHeight: LH.normal,
                borderLeft: `1px solid ${C.border}`,
                paddingLeft: 10,
                marginBottom: 6,
              }}
            >
              <div>
                <span style={{ color: C.dim }}>{r.at}</span> · {r.seat}：{r.from} → <strong>{r.to}</strong>
              </div>
              <div style={{ color: C.dim }}>
                原因：{r.reason} · 操作：{r.by}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ─────────────── 演示脚手：错误码全走一遍 ─────────────── */

/**
 * ★ 这是**演示脚手**，不是产品界面 —— 所以它只在 `sourceLabel !== null`（mock 模式）时出现。
 *
 * 为什么需要它：Step 7 要证明的是「14 条码都接到了**真实渲染路径**上」，
 *   而不是"文案表里写了 14 条"。一个能逐个触发、并让判据逐条断言的入口，
 *   比"我读了一遍表"强得多 —— 后者无法被证伪。
 *
 * ★★ 2026-10-05 收进 `<details>`（默认**收起**）：
 *   它自己写着"产品界面里没有这一块"，却在演示态占了 **181px**（实测，全栏第二高）——
 *   一块**非产品**的调试入口比正片还显眼，是"信息量太大"里最不该占位的那个。
 *   收起来以后：想复现错误路径的人点一下就能用，不想看的人**永远不用看见它**。
 *   ★ 判据不受影响：收起时按钮仍在 DOM 里（且 `copy-probe` 的 `fire()` 会**先展开**再点，
 *     见该文件）—— 但"能点到"这件事**必须由探针自己保证**，不能指望巧合约等于可见。
 */
function DemoErrorHarness({ active, onFire }: { active: string | null; onFire: (code: string) => void }): ReactElement {
  return (
    <details
      data-kaipu-harness="1"
      style={{ marginTop: 20, borderTop: `1px dashed ${C.border}`, paddingTop: 10 }}
    >
      {/* ★ 不用 flex：`<summary>` 上写 `display:flex` 会把默认的三角 marker 干掉 */}
      <summary style={{ fontSize: FS.tag, color: C.faint, cursor: 'pointer', lineHeight: LH.normal }}>
        演示脚手 · 错误路径（{ERROR_CODES.length} 条码 · 点开逐个触发；产品界面里没有这一块）
      </summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
        {ERROR_CODES.map((e) => (
          <button
            key={e.code}
            type="button"
            aria-pressed={active === e.code}
            onClick={() => onFire(e.code)}
            style={{
              fontSize: FS.tag,
              fontFamily: FONT.mono,
              padding: '3px 7px',
              border: `1px solid ${C.border}`,
              borderRadius: 3,
              background: active === e.code ? C.soft : 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            {e.code}
          </button>
        ))}
      </div>
    </details>
  )
}

/* ───────────────────────────── 头部 ───────────────────────────── */

function Header({ scene, run, onStop }: { scene: SceneCard; run: RunView; onStop: () => void }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: FS.heading }}>{scene.label}</span>
      <span style={{ fontSize: FS.tag, color: C.faint }}>v{scene.version}</span>
      {/* ★ 请求号：**缩略显示**（2026-10-05）。
            一个 UUID 是 36 字符，在标题行里比场景名还长 —— 而它 99% 的时候
            **只是"这次运行的一个编号"**，需要完整值时是去对照日志/报告，
            那时悬停看全即可。★ 全值挂 `title`，**没有丢**。 */}
      {run.requestId !== null && (
        <span
          data-kaipu-request-id="1"
          title={run.requestId}
          style={{ fontSize: FS.tag, color: C.faint, fontFamily: FONT.mono }}
        >
          {shortId(run.requestId)}
        </span>
      )}
      <span style={{ fontSize: FS.small, color: C.dim }}>{STATUS_TEXT[run.status]}</span>
      {run.summary !== null && <VerdictBadge verdict={run.summary.verdict} />}
      {run.status === 'running' && (
        <button type="button" onClick={onStop} style={ghostButton}>
          停止接收
        </button>
      )}
    </div>
  )
}

/**
 * 长 ID 的缩略显示（请求号 · 审计号）。
 *
 * ★ 只缩**长到影响阅读的**（UUID = 36 字符），短 ID（`req-mock-0001`）原样显示 ——
 *   对所有 ID 一律截断反而会让人认不出它是什么。
 * ★ 全值挂在 `title` 上 ⇒ **信息没丢，只是不在第一眼占位**。
 *   （"缩略显示"与"删掉"的区别就在这里，别滑过去。）
 */
function shortId(id: string): string {
  return id.length <= 20 ? id : `${id.slice(0, 8)}…`
}

/* ─────────────────── 空场（用户可见面）─────────────────── */

function ZeroInbound({ scene }: { scene: SceneCard }): ReactElement {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '11px 13px',
        border: `1px solid ${C.border}`,
        borderLeft: '3px solid #d97706',
        fontSize: FS.base,
        lineHeight: LH.normal,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span>该场景的 {scene.lamps.length} 个审核面全部待接入执行方。</span>
        {/*
          ★★ 2026-10-08 改版：「这不是故障…」的辩解**收进「?」悬停**。
          事实句（上面那行）照常可见；解释句移到 `title`，鼠标悬停才显示——
          页面不再像在自我辩护，需要的人仍能找到答案。
        */}
        <span
          title="这不是故障：场地不内置任何「必须有的」执行方。接入执行方后本场景即可运行；在此之前，场地本身仍然可用（可查看、可配置）。"
          aria-label="为什么不是故障"
          style={{
            fontSize: FS.tag,
            color: C.dim,
            cursor: 'help',
            borderBottom: `1px dotted ${C.dim}`,
          }}
        >
          ?
        </span>
      </div>
    </div>
  )
}

/* ───────── B 组「运行事实」**不在这里**（2026-10-06）─────────
 *
 * 本文件渲染的整块 DOM 就是 `data-kaipu-run` —— 运行视图的**判据边界**
 * （见 `PlatformPanel` 的注释）。而 B 组是**新增的展示内容**。
 *
 * ⇒ 那节口径：「**新增锚点必须在 `data-kaipu-run` 之外**（`data-kaipu-process`）」
 *   ⇒ 它渲染在 `PlatformPanel.tsx` 的 `ProcessFacts`，**物理落在运行视图之外**。
 *
 * ★ 为什么不靠"读文本时排除"（那是早期版本做法，已废弃）：
 *   排除是**减法**，减法只在"探针记得减"时成立 —— 换一个人写判据、或换一个探针，
 *   污染立刻回来。**先隔离，再展示**（复核意见原文）说的就是别把正确性押在判据的自律上。
 */

/* ─────────────────────── 逐轮分段（R2）─────────────────────── */

/**
 * 逐轮分段（R2）。
 *
 * ★★ 折叠的**边界**（为"一页预览"加的，逐条对应契约）：
 *
 *   折进去的：**每个维度的过程内容**（`lamp_delta` 流式文本 + `detail` + 耗时行）
 *   留在外面的：**轮次号 · reason（回炉原因）· 本轮判定 · 各审核面判定缩略**
 *
 *   为什么这样切 —— 契约有两条硬约束，折错了就违约：
 *     · **R2**「回炉**必须看得见**」⇒ 折起来后 `第 2 轮 · ⚡有条件回炉` 仍在标题行上，看得见；
 *     · **R3**「四类判定**可区分且可见**」⇒ 判定徽标与**各审核面判定缩略**都留在标题行，
 *       折起来也一眼看出"谁过了谁没过"。**把判定折进去 = 让人必须点开才知道结论 = 不可见。**
 *
 *   ★ `<details>` **非受控**（不传 `open`）—— 两个原因：
 *     ① 默认折叠（"一页预览"）；
 *     ② React 不管 `open` ⇒ 用户手动展开后，事件继续到达、组件重渲染**不会把它弹回去**。
 *        （若做成受控，每来一个 SSE 事件就会把用户展开的那一节重新折上，那是灾难。
 *         同理，探针里 `d.open = true` 设上去就保持，不会被 React 重置。）
 */
function RoundBlock({ round }: { round: RoundView }): ReactElement {
  /** 各审核面判定的**缩略串** —— 折起来也要能一眼看出这一轮的结论分布 */
  const decided = round.lamps.filter((l) => l.verdict !== null)

  /**
   * ★★ **默认展开，但保持"非受控"**（2026-10-06「A 组默认展开」）
   *
   * 为什么**不能**直接写 `<details open>`：
   *   React 会把 `open` 当**受控属性**、**每次渲染都设回去** ⇒ 用户（或探针）
   *   把它折上之后，**下一个 SSE 事件到达就被重新弹开**。
   *   本组件每 ≈300ms 就随轮询增量重渲染一次 ⇒ 症状会非常明显（折不动）。
   *
   * 用 ref + **空依赖** useEffect ⇒ 只在**挂载那一瞬**设一次，之后交给浏览器管：
   *   · 新出现的轮次 ⇒ 默认可见（这就是 A 组的诉求）
   *   · 用户折上 ⇒ **留得住**（重渲染不弹回）
   *   · 探针 `collapseAll()` 仍能把它折上 ⇒「折叠边界」那组断言照旧成立
   *     （其中「折起来时判定仍可见」是 R3 的关键落点，不能因此失效）
   */
  const ref = useRef<HTMLDetailsElement | null>(null)
  /**
   * ★★ 「这一下是人点的」的时间戳 —— `toggle` 回调据此判断该不该滚（见 `onToggle` 守则 ②）。
   *   `0` = 从没点过 ⇒ 任何程序化开合都不会被当成用户操作。
   */
  const clickedAt = useRef(0)
  /** 展开后居中的兜底定时器（同 `StartRunForm`：存 ref、只在卸载时清） */
  const scrollTimer = useRef<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el !== null) el.open = true
  }, [])

  /**
   * ★★ 「点开这一轮 ⇒ 把它落到视野中间」（2026-10-08 · 104 落地）。
   *
   * ══════════════════════════════════════════════════════════════════
   * 它修的是什么（实测，不是观感）
   * ══════════════════════════════════════════════════════════════════
   *   一轮展开态 315px / 折叠态 43px ⇒ 展开出来 **+272px**。
   *   而用户往往是**在这一轮标题停在容器底部时**点开它
   *   （实测起始 `scrollTop=0` 时块有 **281px 在视野外，全在下边**）
   *   ⇒ **展开出来的内容一个像素都看不见**，且现状 `scrollTop 0 → 0`（一动不动）。
   *
   * ══════════════════════════════════════════════════════════════════
   * ★★ 三条守则（每条都对着一个会出事的场景）
   * ══════════════════════════════════════════════════════════════════
   *   ① **折叠不滚**：折叠是内容变少，不会造成"看不见"；这时滚反而把用户推离他正在读的位置。
   *   ② ★★ **只有"用户点的"才滚** —— 见下面 `clickedAt` 那段的理由（这条最要紧）。
   *   ③ ★★ **门控**：块已经基本在视野里（视野外 ≤ `EXPAND_CENTER_MIN_HIDDEN`）就一动不动。
   *      理由见那个常量的注释（实测反例：只差 13px 却要跳 220px）。
   */
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>): void => {
    const el = e.currentTarget
    if (!el.open) return                                   // ①
    if (Date.now() - clickedAt.current > USER_CLICK_WINDOW_MS) return   // ②
    const box = nearestScroller(el)
    if (box === null) return
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const hidden = Math.max(0, b.top - r.top) + Math.max(0, r.bottom - b.bottom)
    if (hidden <= EXPAND_CENTER_MIN_HIDDEN) return         // ③
    scrollTimer.current = smoothScrollTo(box, centerTop(box, el))
  }
  /** 卸载时把还没落的兜底定时器收掉（与 `StartRunForm` 同款做法） */
  useEffect(
    () => () => {
      if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current)
    },
    [],
  )

  return (
    <details
      ref={ref}
      data-kaipu-round={round.round}
      onToggle={onToggle}
      style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}
    >
      {/* ★ 不用 flex：`<summary>` 上写 `display:flex` 会把默认的三角 marker 干掉 */}
      {/*
        ★★ `onClick` 是**守则 ② 的落点**：只有"这一下是人点的"才允许下面的 `onToggle` 去滚。
        为什么非要区分（挂 `toggle` 事件本身就够了吗）：
          · **挂载时**本组件会 `el.open = true`（保 A 组"默认展开"，见上面）—— 那也派发 `toggle`；
          · **探针**到处 `d.open = true`（`expandIn` / `expandAll`）—— 同样派发 `toggle`。
          ⇒ 不区分的话，**每出现一轮新轮次、每次探针铺前态，页面都会自己滚一下** ——
            用户没点任何东西，视野却被挪走（"页面自己在动"是最难接受的一类行为）。
        ★ 为什么用**时间窗**而不只是一个布尔标志：布尔标志遇到"点了 summary 但 open 没变"
          （极小概率）会**悬挂**成 true，之后第一次程序化开合就被误判成用户点击。
          时间窗（`USER_CLICK_WINDOW_MS`）让悬挂的标志自动过期 —— 一行代价，去掉一整类边缘情况。
        ★ 为什么不用 `event.isTrusted`：`el.open = x` 触发的 `toggle` 是**浏览器内部派发**的，
          `isTrusted` **同样是 true** ⇒ 区分不了（实测过）。
      */}
      <summary
        onClick={() => { clickedAt.current = Date.now() }}
        style={{ cursor: 'pointer', padding: '2px 0', lineHeight: LH.loose }}
      >
        <span style={{ fontSize: FS.title }}>第 {round.round} 轮</span>
        {/* ★ 回炉在这里可见（R2）：第 2 轮的 reason 就是服务端给的「⚡有条件回炉」 */}
        <span style={{ fontSize: FS.small, color: C.dim, marginLeft: 10 }}>{round.reason}</span>
        {round.verdict !== null && <span style={{ marginLeft: 10 }}><VerdictBadge verdict={round.verdict} /></span>}
        {round.degraded && (
          <span style={{ fontSize: FS.tag, color: '#b45309', marginLeft: 10 }}>
            （未收到轮次开始事件，按事件自带 round 兜底分组）
          </span>
        )}
        {/* ★ 折起来也看得见的**判定分布**（R3）—— 这是"判定可见"的落点。
            ★★ 2026-10-05 拉层次：原来是**一整条同色同粗细**的纯文本
              （`主体核验 ⚡有条件 · 权责确认 ✅通过 · …`），四项信息糊成一句，
              眼睛没有落点 —— 这正是"信息量太大"。
              改为：**维度名降一档（faint）+ 判定词提一档（正色 + 加粗）**。
            ★ 为什么判定词**不用实底色**（那才是它在上面徽标里的样子）：
              一行里塞 4 个实底色块会变成"一排色块"，比纯文本更吵；
              而**颜色区分由 emoji 承担**（✅⚡❌⛔ 自带色）——
              R3 要的「四类判定**可区分**」已经满足，且不赌"某个底色在深底上够不够亮"。 */}
        {decided.length > 0 && (
          <span data-kaipu-round-verdicts="1" style={{ fontSize: FS.tag, marginLeft: 10 }}>
            {decided.map((l, i) => (
              <span key={l.lamp}>
                {i > 0 && <span style={{ color: C.faint }}> · </span>}
                <span style={{ color: C.faint }}>{l.lamp}</span>{' '}
                <span style={{ color: C.text, fontWeight: 600 }}>{l.verdict ?? ''}</span>
              </span>
            ))}
          </span>
        )}
      </summary>
      {/*
        ★ A 组的过程内容**留在运行视图内** —— 它不是"新增展示区"：
          这些内容本来就在这块 DOM 里、只是折着；而探针读运行视图文本时
          **本来就会 `expandIn()` 把所有 details 展开**（见 run-view-probe.mjs 顶部）
          ⇒ 展开与否**不改变**它读到什么，因此**不构成新增的污染面**。

        ⇒ 按那节口径「**新增锚点**必须在 `data-kaipu-run` 之外」，
          这里**不再挂** `data-kaipu-process` —— 那个锚点归**新增的展示区**
          （`RunFacts`，已移到运行视图**之外**，见 `PlatformPanel`）。

        ⚠️ 别反过来把这块当"排除区"：② 段的「待接入」那类词就长在灯行里
          （`LampRow`），把过程区排除掉会**误伤真断言**。
      */}
      <div style={{ marginTop: 6, borderLeft: `1px solid ${C.border}`, paddingLeft: 12 }}>
        {round.lamps.map((l) => (
          <LampRow key={`${round.round}\u0000${l.lamp}`} lamp={l} />
        ))}
      </div>
    </details>
  )
}

function LampRow({ lamp }: { lamp: LampView }): ReactElement {
  // ★ `agent === null` ⇒ 该维度尚未接入执行方 ⇒ 必须显「待接入」（一等公民）
  const pending = lamp.agent === null
  return (
    <div style={{ padding: '7px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: FS.base }}>{lamp.lamp}</span>
        <span style={{ fontSize: FS.small, color: pending ? '#d97706' : C.dim }}>{pending ? '待接入' : lamp.agent}</span>
        {lamp.verdict !== null && <VerdictBadge verdict={lamp.verdict} />}
        {lamp.latencyMs !== null && (
          // ★ 耗时是"元信息"⇒ 用最淡一档（faint）：它要能查到，但**不该和维度名抢注意力**
          <span style={{ fontSize: FS.tag, color: C.faint, fontFamily: FONT.mono, marginLeft: 'auto' }}>
            {lamp.latencyMs} ms
          </span>
        )}
      </div>
      {lamp.lines.length > 0 && (
        <div style={{ fontSize: FS.small, color: C.dim, marginTop: 3, lineHeight: LH.normal }}>
          {lamp.lines.join(' ')}
        </div>
      )}
      {lamp.detail !== '' && <div style={{ fontSize: FS.base, marginTop: 3, lineHeight: LH.normal }}>{lamp.detail}</div>}
    </div>
  )
}

/* ───────────── 报告体：审核面口径（R4）+ 用量 ───────────── */

function SummaryBlock({ summary, finishReason }: { summary: SummaryView; finishReason: string | null }): ReactElement {
  return (
    <section style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: FS.title }}>本次结论</span>
        <VerdictBadge verdict={summary.verdict} />
        <span style={{ fontSize: FS.small, color: C.dim }}>
          共 {summary.round} 轮 · {finishReason ?? '—'}
        </span>
      </div>
      {summary.conditions.length > 0 && (
        <div style={{ fontSize: FS.small, color: C.dim, marginTop: 6 }}>附加条件：{summary.conditions.join('；')}</div>
      )}

      {/*
        ★★ R4：**固定显示**，不做折叠。
        理由（契约原文）：报告**不能给出「审全了」的错觉** ——
        把「未参与审核面」收进折叠区，等于让人默认"全审了"。

        ★★ 但"固定显示"的前提是**服务端真的给了**（`dimsReported`）。
          2026-10-05 实测：服务端的 `summary` **没有** `participatedDims` / `skippedDims`
          ⇒ 那时若照旧渲染，两行都会显示「（无）」——
          **那是把"没给"画成了"没有未参与审核面"，正好撞上 R4 要防的错觉。**
          ⇒ 缺字段时改成**如实说不确定**（下面 `dimsReported === false` 那一支）。
      */}
      <div style={{ marginTop: 12, padding: '10px 12px', background: C.soft, fontSize: FS.base, lineHeight: LH.loose }}>
        {summary.dimsReported ? (
          <>
            <DimLine label={DIMS_FOOTER.participated} items={summary.participatedDims} />
            <DimLine label={DIMS_FOOTER.skipped} items={summary.skippedDims} tone="#b45309" />
            <DimLine label={DIMS_FOOTER.basis} items={['dim / run_when 裁剪（请求方指定，客户端不推断）']} />
          </>
        ) : (
          <div data-kaipu-dims-missing="1" style={{ color: '#b45309' }}>
            服务端这次没有给审核面信息，因此「未参与审核面」无从判断。
            这份结论不足以说明「该审的都审了」—— 请以服务端报告为准。
          </div>
        )}
      </div>
    </section>
  )
}

function DimLine({ label, items, tone }: { label: string; items: readonly string[]; tone?: string }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: C.dim, minWidth: 94, flex: '0 0 auto' }}>{label}</span>
      {/* ★ `minWidth: 0` 不能省：flex 子项默认 `min-width: auto` ⇒ 不会收缩到内容
          最小宽度以下 ⇒ 窄容器里最后几个字会被裁掉（实测溢出 8px）。
          中文可逐字断行，但英文/数字串不行 ⇒ 再补 `overflowWrap`。 */}
      <span style={{ color: tone ?? C.text, minWidth: 0, overflowWrap: 'break-word' }}>
        {items.length === 0 ? '（无）' : items.join('、')}
      </span>
    </div>
  )
}

function UsageBlock({ usage }: { usage: UsageView }): ReactElement {
  return (
    <section style={{ marginTop: 14, fontSize: FS.small, color: C.dim, fontFamily: FONT.mono }}>
      {/* ★ 只显示服务端给的数 —— 客户端不自行计算（契约明文） */}
      <div>
        tokens {usage.tokensIn} in / {usage.tokensOut} out · credits {usage.credits} · balance{' '}
        {/* ★ `null` ⇒ **显示"未提供"**，不显示 0：0 会被读成"余额为零"（一件没发生的事） */}
        {usage.balanceAfter === null ? '未提供' : usage.balanceAfter}
      </div>
      {/* ★ 服务端给了口径说明就照出 —— 没有它，"用量 0"会被误读成"这次没花钱" */}
      {usage.note !== null && (
        <div style={{ marginTop: 3, fontFamily: 'inherit', color: C.dim }}>{usage.note}</div>
      )}
    </section>
  )
}

/* ─────────────────────────── 小件 ─────────────────────────── */

function VerdictBadge({ verdict }: { verdict: SummaryView['verdict'] }): ReactElement {
  const tone = toneOf(verdict)
  return <Badge bg={tone === null ? '#6b7280' : TONE_BG[tone]}>{verdict}</Badge>
}

function Badge({ children, bg }: { children: string; bg: string }): ReactElement {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 3,
        background: bg,
        color: '#fff',
        fontSize: FS.tag,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

function Note({ children }: { children: string }): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 160,
        color: C.dim,
        fontSize: FS.base,
      }}
    >
      {children}
    </div>
  )
}

const ghostButton = {
  marginLeft: 'auto',
  fontSize: FS.small,
  padding: '4px 12px',
  border: `1px solid ${C.border}`,
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
} as const
