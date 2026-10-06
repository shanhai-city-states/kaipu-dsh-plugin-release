/**
 * 山海·开铺 · 智囊团插件 · 面板（四区会商视图）
 * =====================================================================
 * 定位：**一群谋士（会商量的组织）**，不是"一组专家（能力的集合）"。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 与场地面板的分工（已确认）
 * ══════════════════════════════════════════════════════════════════
 *
 * 我读场地插件 `RightPane.tsx` 时发现：**"会商"这件事，场地插件已经渲染得很完整了**
 * （`RoundBlock` 有第 N 轮 + 回炉理由，`LampRow` 有维度 + 执行方 + 判定 + 耗时）。
 * ⇒ 若本面板把同一份数据再渲染一遍，就是"**两个面板、同一件事**"：
 *   用户会问"我该看哪个"，且两处都要跟着契约改（维护双份）。
 *
 * ⇒ **切法是「同一批数据的两个时间尺度」**：
 *
 *   | 面板 | 问的问题 | 时间尺度 |
 *   |:--|:--|:--|
 *   | 场地 `RightPane` | 「**这一次**会商跑到哪了」 | 一场（面向过程） |
 *   | 智囊团（本文件） | 「**这群谋士**是谁 · 服务哪些场子」 | 跨场（面向组织） |
 *
 * ★ **所以本面板不显示判定 / 耗时 / 轮次** —— 那些是场地面板的活。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 四区（设计稿 · 可开工 4/5 区）
 * ══════════════════════════════════════════════════════════════════
 *   ① 状态带    —— 接没接上 / 几个灯位 / **已登记 vs 未登记**（状态带区分的落点）
 *   ② 灯位一览  —— ★ 核心区：这里的"人"是谁（判定**只认 agentId**）
 *   ③ 场景归属  —— 这几位服务于哪些场景（复用 `scenes[].lamps` 反查）
 *   ④ 会商履历  —— ⏸ **只占位**（数据源未知）
 *
 * ★★ **空态是一等公民**：现在真实数据就是 **5/5 待接入**
 *   ⇒ "空态"**不是边缘情况，而是当前的主要状态**。
 *   它是「场地零内置可跑」的**用户可见面**，措辞要**正向且诚实**：
 *   不是"我们还没装好"（那是我们的问题），而是"**位子给你留着了**"（这是场地的承诺）。
 */
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { getConnection, type ClientCtxLike } from './bridge.js'
import {
  lampText,
  loadLive,
  setConnection,
  summarize,
  summaryText,
  type LampSeat,
  type LampSummary,
  type Snapshot,
  type SourceKind,
} from './live.js'
import { C, FONT, FS, LH, VACANT } from './theme.js'

/** 首帧状态：`null` = 还在读 —— ★ 与"读失败"是**两件事**，措辞必须分开 */
type Loaded = Snapshot | null

export function WisdomPanel(): ReactElement {
  const [snap, setSnap] = useState<Loaded>(null)

  /**
   * ★ 取一次快照。
   *
   * ⚠️ 本插件**不做"改用演示数据"按钮**（场地侧有）。
   *   为什么不做：场地面板那个按钮是为了**设计评审**（便于设计评审看界面）。
   *   智囊团的空态**本身就是当前真实状态**（5/5 待接入）⇒ 不需要编演示数据
   *   来"演示空态"—— 编了反而**掩盖了真实的空态长什么样**。
   *   ★ 若将来评审需要，再加不迟；现在加就是**多一个能说谎的入口**。
   */
  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    void (async () => {
      const next = await loadLive(ac.signal)
      if (alive) setSnap(next)
    })()
    return () => {
      alive = false
      ac.abort()
    }
  }, [])

  const lamps = useMemo(() => snap?.lamps ?? [], [snap])
  const sum = useMemo(() => summarize(lamps), [lamps])

  return (
    <div
      // ★ 面板根锚点：判据从这里读，而不是整页（免得被别处的同名文本蒙对）
      data-kaipu-wisdom="1"
      style={{ padding: 16, overflowWrap: 'break-word', color: C.text }}
    >
      <div style={{ fontSize: FS.heading, fontWeight: 600, marginBottom: 10 }}>智囊团</div>

      <StatusBand snap={snap} sum={sum} />

      {/* ★★ 读不到时**只给原因**，绝不渲染灯位区 ——
          否则会显成"5 个待接入"，把"我读不到"伪装成"你这里没人"（见 live.ts 文件头） */}
      {snap !== null && snap.kind !== 'live' ? (
        <Unreadable kind={snap.kind} reason={snap.reason} />
      ) : (
        <>
          <LampSection lamps={lamps} loading={snap === null} />
          <SceneSection scenes={snap?.scenes ?? []} loading={snap === null} />
        </>
      )}

      <HistorySection />
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   ① 状态带（一行 · 不占高度）
   ══════════════════════════════════════════════════════════════════ */

/**
 * ★★ 「状态带内部区分已登记/未登记」的**唯一落点**。
 *
 * 形态：`已接入 · 5 灯位 · 5 已登记待启用`
 *
 * ★ 为什么把"已登记/未登记"提到**第一行**：
 *   这是「场地零内置可跑」的**用户可见面**，现在实测 5/5 都不是 `ready`
 *   ⇒ 这件事**不该藏在下滑区**，第一眼就要看到。
 *
 * ★ 数据源状态**三态显式**（`live` 外都带原因），**绝不悄悄回落**。
 */
function StatusBand({ snap, sum }: { snap: Loaded; sum: LampSummary }): ReactElement {
  const kind: SourceKind | 'loading' = snap === null ? 'loading' : snap.kind
  const label = snap === null ? '正在读取…' : snap.label

  return (
    <div
      data-kaipu-wisdom-band={kind}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        flexWrap: 'wrap',
        paddingBottom: 10,
        borderBottom: `1px solid ${C.border}`,
        fontSize: FS.small,
        lineHeight: LH.normal,
      }}
    >
      <span style={{ color: kind === 'live' ? C.dim : VACANT }}>{label}</span>
      {snap !== null && snap.kind === 'live' && (
        <>
          <span style={{ color: C.faint }}>·</span>
          {/* ★ 汇总文案是纯函数产物（`summaryText`），判据可直接断言它 */}
          <span data-kaipu-wisdom-summary="1" style={{ color: C.text }}>
            {summaryText(sum)}
          </span>
        </>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   ② 灯位一览（核心区）
   ══════════════════════════════════════════════════════════════════ */

function LampSection({ lamps, loading }: { lamps: readonly LampSeat[]; loading: boolean }): ReactElement {
  return (
    <section style={{ marginTop: 14 }}>
      <SectionTitle>灯位</SectionTitle>

      {loading ? (
        <Hint>正在读取…</Hint>
      ) : lamps.length === 0 ? (
        /* ★ 零灯位 ≠ "5 个待接入"。措辞必须分开：
             - 零灯位 = 这个铺子**还没配灯组**（去配）
             - 全待接入 = 灯组配好了，**人还没来**（去接人） */
        <Hint>这个铺子还没有灯位。灯组由场景定义决定。</Hint>
      ) : (
        <div style={{ marginTop: 6 }}>
          {lamps.map((l) => (
            <LampRow key={l.lamp} seat={l} />
          ))}
        </div>
      )}

      {/* ★★ 空态一等公民：全空时给一句**正向且诚实**的话 —— 见文件头 */}
      {!loading && lamps.length > 0 && lamps.every((l) => l.state !== 'ready') && <VacantNote lamps={lamps} />}
    </section>
  )
}

/**
 * 一个灯位一行。
 *
 * ★★ **判定只认 `agentId`**（契约 §23.3 权威字段）——
 *   这也是既定的关键纪律：即使服务端把 `agentName` 写成 `(待接入)`，
 *   界面也不会"看起来对、其实错"。
 *
 * ★★ 行文案**故意不区分 `vacant` / `registered`**（两者都显「待接入」）：
 *   这是该裁定的保守面（没上线 ≈ 用户拿不到服务，说"待接入"不误导）。
 *   区分发生在**状态带的汇总层**（Q1 裁定的后半句）—— 见 `StatusBand`。
 *   ⇒ ⚠️ 改这里之前先读 `live.ts` 的 `LampState` 注释，那里把边界写死了。
 */
function LampRow({ seat }: { seat: LampSeat }): ReactElement {
  const ready = seat.state === 'ready'
  const tip = lampTip(seat)

  return (
    <div
      // ★ 判据锚点：逐态可断言，不必数 DOM 层级
      data-kaipu-wisdom-lamp={seat.lamp}
      data-kaipu-wisdom-lamp-state={seat.state}
      title={tip}
      aria-label={`${seat.lamp}，${lampAria(seat)}`}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '6px 0 6px 10px',
        borderLeft: `2px solid ${ready ? C.accent : VACANT}`,
        // ★ 只有 `ready` 是满色；`vacant`/`registered` 不淡化（那是**正常态**，不是"坏了"）
        cursor: tip === '' ? 'default' : 'help',
      }}
    >
      <span style={{ fontSize: FS.base, color: C.text }}>{seat.lamp}</span>

      {/* ★ 承担方：`ready` 才显名字（等宽，避免 id 抖动）；否则留白 */}
      {seat.agentId !== null && <span style={{ fontSize: FS.tag, color: C.faint, fontFamily: FONT.mono }}>{seat.agentId}</span>}

      {/* ★★ 状态**共占同一格**：同一时刻只会出现一个取值。
          `data-kaipu-wisdom-lamp-text` 让判据断**这一格**的文本 ——
          不能断整行（`(待接入)` 这类名字本身含关键字，会被蒙对）。 */}
      <span
        data-kaipu-wisdom-lamp-text="1"
        style={{ marginLeft: 'auto', fontSize: FS.tag, color: ready ? C.dim : VACANT }}
      >
        {lampText(seat)}
      </span>
    </div>
  )
}

/**
 * 悬停提示 —— ★ **如实写**，不因为行文案合并了就把事实也合并掉。
 *
 * ★ 为什么这里要写出 `pending` / `disabled` 的区别：
 *   行文案为了保守合并成「待接入」，那是**给"扫一眼"的人看的**；
 *   而悬停是**给"想弄清楚"的人看的** —— 对他**不许说假话**。
 *   ⇒ `registered` 的提示必须说清"**有人了，但还没上线**"，
 *     否则行文案的保守就变成了**信息删失**。
 *
 * ★ 用原生 `title` 而不是自绘浮层（承场地侧理由）：面板挂在宿主容器里，
 *   容器常带 `overflow` 裁剪 ⇒ 自绘浮层会被裁掉；`title` 零 JS、不会被裁、
 *   屏幕阅读器会当 accessible description 读。
 *
 * ⚠️⚠️ **`title` 是纯文本，不渲染 markdown** ⇒ 文案里**不许有 `**` / `_` 之类记号**
 *   —— 它们会被**原样显示**（用户看到一串星号）。
 *   这不是洁癖：场地侧第一版就把 `**…**` 直接印在了界面上，属于同一类错
 *   （"上屏文本不许带 markdown 记号"是 `live.ts` 已立的纪律）。
 *   ⇒ 要强调就用中文标点（「」），不要用星号。
 */
function lampTip(seat: LampSeat): string {
  const parts: string[] = []
  if (seat.state === 'vacant') {
    parts.push('这个位子还没有人接。')
  } else if (seat.state === 'registered') {
    // ★ 不合并：把"有人了"这个事实说出来
    parts.push(
      seat.rawStatus === 'disabled'
        ? '这个位子有人，但当前被停用。'
        : '这个位子已登记，但还没有上线。',
    )
  } else {
    parts.push('这个位子已就绪。')
  }
  if (seat.agentId !== null) parts.push(`执行方：${seat.agentId}`)
  if (seat.scenes.length > 0) parts.push(`服务于：${seat.scenes.join(' · ')}`)
  return parts.join('\n')
}

function lampAria(seat: LampSeat): string {
  if (seat.state === 'ready') return `${seat.agentId ?? ''} 已就绪`.trim()
  if (seat.state === 'registered') return '已登记待启用'
  return '待接入'
}

/**
 * ★★ 空态的正向表达 —— **本面板最重要的一句文案**。
 *
 * 取向：这是「场地零内置可跑」的正向表达 ——
 * **不是"我们还没装好"（那是我们的问题），而是"位子给你留着了"（这是场地的承诺）**。
 * 对齐总体定位：**"场地"是我们做的，"谁来"是客户定的。**
 *
 * ⚠️ **Q4 的纠结已落地**（Q4 归发起人拍，选了"两句分开说"的写法 ——
 *   即下面前两句；因为那既是诚实的、也是正向的）。
 *   ★ 但这里**没有**写第三句"内置谋士（山海智囊团）也在这个位子上，尚未入场"。
 *     为什么不写：**Q2 还没答**（5 条灯是否共享同一 host Agent）。
 *     若 Q2 答"共享" ⇒ 加那句成立；若答"各自独立" ⇒ 那句话是**错的**。
 *     ⇒ 在 Q2 落地前**只写不依赖 Q2 的两句**（这是已承诺的降级行为：
 *       不确定处不编，答了改一处文案，不动结构）。
 */
function VacantNote({ lamps }: { lamps: readonly LampSeat[] }): ReactElement {
  const allVacant = lamps.every((l) => l.state === 'vacant')
  return (
    <div
      data-kaipu-wisdom-vacant={allVacant ? 'all' : 'partial'}
      style={{ marginTop: 10, fontSize: FS.small, color: C.dim, lineHeight: LH.loose }}
    >
      <div>这群谋士还没到位。</div>
      <div>灯位已备好，谁来坐由你定。</div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   ③ 场景归属
   ══════════════════════════════════════════════════════════════════ */

/**
 * ★ 这一区的价值：它回答了"**这群谋士是给哪些场子用的**" ——
 *   场地面板**回答不了**这个问题（它只看一场）。**这就是"纵深"的第一个落点。**
 */
function SceneSection({ scenes, loading }: { scenes: { label: string; lamps: string[] }[]; loading: boolean }): ReactElement {
  return (
    <section style={{ marginTop: 16 }}>
      <SectionTitle>服务于此处的场景</SectionTitle>
      {loading ? (
        <Hint>正在读取…</Hint>
      ) : scenes.length === 0 ? (
        <Hint>还没有可用场景。</Hint>
      ) : (
        <div style={{ marginTop: 6 }}>
          {scenes.map((s) => (
            <div key={s.label} style={{ padding: '4px 0', fontSize: FS.small, lineHeight: LH.normal }}>
              <span style={{ color: C.text }}>· {s.label}</span>
              {s.lamps.length > 0 && (
                <span style={{ color: C.faint }}>　{s.lamps.join(' / ')}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   ④ 会商履历（⏸ 只占位 · 数据源未知）
   ══════════════════════════════════════════════════════════════════ */

/**
 * ★★ **本期只画框**——数据源未知（P1 清单里**找不到**跨场会商记录的读口；
 *   `/roles/changes` 是**席位变更**，`/scene/{id}/run` 是**当次** SSE）。
 *
 * ★ 为什么不偷偷省掉它：若省掉，将来补上时**这一区无位置可插**，
 *   只能重排整个面板（那才是真返工）。**先占位、后填肉**是成本最低的做法。
 *
 * ★ 而且——**"暂无记录"本身是诚实的**：它没说"没有会商发生过"，
 *   只说"**这里还没有记录可看**"。句子里带出下一句，让用户知道不是他的问题。
 */
function HistorySection(): ReactElement {
  return (
    <section data-kaipu-wisdom-history="placeholder" style={{ marginTop: 16 }}>
      <SectionTitle>会商履历</SectionTitle>
      <div style={{ marginTop: 6, fontSize: FS.small, color: C.dim, lineHeight: LH.normal }}>
        <div>暂无记录</div>
        <div style={{ color: C.faint }}>跨场会商记录需要服务端提供，本版本暂未接入。</div>
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   小件
   ══════════════════════════════════════════════════════════════════ */

function SectionTitle({ children }: { children: ReactNode }): ReactElement {
  return (
    <div style={{ fontSize: FS.title, fontWeight: 600, color: C.text }}>{children}</div>
  )
}

function Hint({ children }: { children: ReactNode }): ReactElement {
  return <div style={{ marginTop: 6, fontSize: FS.small, color: C.dim, lineHeight: LH.normal }}>{children}</div>
}

/**
 * ★★ **读不到**时的那一屏 —— 与"空态"**绝不同形**。
 *
 * 为什么必须独立成组件（而不是复用 `VacantNote`）：
 *   两者的**用户下一步动作完全不同** ——
 *     · 空态（`live` + 全 vacant）⇒ "**去接 Agent**"（用户自己的活）
 *     · 读不到（`stale`/`unreachable`/`no_channel`）⇒ "**去查通道/地址/插件**"（环境问题）
 *   用同一屏糊过去 = **把"我读不到"伪装成"你这里没人"** ——
 *   那是**编造了一个不存在的事实**，与"`pending` 被误显成「已停用」"是同一类错。
 *
 * ★ 措辞纪律：`stale`（通道未就绪）与 `unreachable`（连不上）**要分开说**，
 *   因为出路不同（查插件装载 vs 查地址/网络）。
 */
function Unreadable({ kind, reason }: { kind: SourceKind; reason: string | null }): ReactElement {
  return (
    <div style={{ marginTop: 14 }}>
      <SectionTitle>灯位</SectionTitle>
      <div
        data-kaipu-wisdom-unreadable={kind}
        style={{ marginTop: 6, fontSize: FS.small, color: C.dim, lineHeight: LH.loose }}
      >
        <div style={{ color: VACANT }}>读不到灯位数据。</div>
        {reason !== null && <div>{reason}</div>}
        <div style={{ color: C.faint }}>这不代表灯位是空的 —— 只是这一侧没能读到。</div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   入口接线：★ 与场地侧**同款**，但**不 import 它的任何东西**
   ══════════════════════════════════════════════════════════════════

   ⚠️ 本模块在 `apply()` 里被调用一次。为什么把 `setConnection` 放这里
   而不是 `index.ts`：`index.ts` 是**接线层**，它不该知道"数据层怎么存句柄"。
   ⇒ 提供一个 `wireConnection(ctx)` 出口，让接线层只表达意图。
*/
export function wireConnection(ctx: ClientCtxLike): void {
  setConnection(getConnection(ctx))
}
