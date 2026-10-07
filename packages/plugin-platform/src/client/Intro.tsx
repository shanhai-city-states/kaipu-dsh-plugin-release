/**
 * 山海·开铺 · 场地插件 · 首屏引导（标题栏 + 「怎么用」卡）
 * =====================================================================
 * ★★ 为什么需要它（不是装饰）：
 *   用户第一眼看到的是「演示数据」「未签名」「第 1 轮 / 第 2 轮」——
 *   这些都是**结论性的信息**，但它们预设了读者已经知道"这块面板是干什么的"。
 *   实测反馈就是一句：「第一眼不知道怎么用」。
 *   ⇒ 缺的不是功能，是**入口处的一层说明**：这是什么 · 我该看哪几处 · 那些词什么意思。
 *
 * ★ 设计上刻意克制（三条）：
 *   1. 引导卡**默认展开、可一键收起**，收起后不打扰；不用弹窗、不用向导步骤。
 *   2. ★ 四类判定的图例**画在运行视图之外**（见 PlatformPanel 的 `[data-kaipu-run]` 边界）。
 *      理由：判据探针断言的是"运行视图里出现了 ⚡有条件"。
 *      如果图例长在运行视图里，那些断言就变成**恒真的空断言** ——
 *      我们反复强调过「一个不会失败的断言等于没有」。
 *   3. 文案里**不出现**契约禁用词（如"已取消"），免得污染 R5 的禁用词断言。
 *
 * ★ 不做持久化（不写 localStorage）：
 *   宿主可能禁存储 / 面板可能在悬停卡里被反复挂载；
 *   引入 try-catch 兜底的存储，收益（少点一次）不抵复杂度。
 *   收起状态活到面板卸载为止 —— 对一块演示面板是合适的粒度。
 */
import type { ReactElement } from 'react'
import { FS, LH, C, TONE_BG } from './theme.js'

export interface PanelHeadProps {
  open: boolean
  /**
   * ★★ 「怎么用 ↑」= **把用法带到眼前**（2026-10-07 定稿）。
   *
   *   为什么不是"切换开关"（第一版是那么写的，跑完真机判据才想明白）：
   *     用法卡**默认就是展开的** —— 用户滚到底部时，它**已经展开**，只是看不见。
   *     此时他看标题栏，看到的文案是「收起用法」；按一个开关的语义点下去，
   *     卡被**收走**了 —— 他要的是"看用法"，得到的却是"用法消失"。
   *     ⇒ 一个按钮不能同时承担"导航"和"开关"两件事：**导航的意图会被开关的行为吃掉**。
   *
   *   ⇒ 拆开：
   *     · 本按钮（标题栏）= **导航**：展开（若收着）+ 把视口带回顶部。文案**恒定**
   *       「怎么用 ↑」，读到它就知道会发生什么（同「铺子资料 ↓」）。
   *     · 「收起」挪到**卡自己身上**（右上角，见 `Intro` 的 `data-kaipu-intro-collapse`）——
   *       想让它消失的人，视线本来就在卡上，不必回头找标题栏。
   *
   * ★ 动作整体（展开 + 回顶）由**装配层**决定（`PlatformPanel` 的 `jumpToIntro`），
   *   本组件只负责"把这件事报上去"。
   */
  onJumpToIntro: () => void
  /**
   * 数据源显示（★★ 必须是**显式状态**，不许靠"请求失败就换"来推断）。
   * 见 `Panel` 文件头那段：live / 人工选的 mock / unreachable 三者严格分开。
   */
  source: string
  /** 在"自动（真服务端）"与"演示数据"之间切 */
  onUseMock: () => void
  /** 当前是否停在演示数据上（决定按钮的按压态与措辞） */
  mockActive: boolean
  /**
   * 跳到页面底部的「铺子资料」并把三个抽屉展开（2026-10-07 加）。
   *
   * ★ 为什么值得给：铺子资料是**长列表的末尾**（上面还有引导卡、过程概览、
   *   整个运行视图）—— 想放/取一份文件，得先手动滚一到两屏。
   *   而"我要我的资料"这件事**与看没看运行结果无关**，不该以滚动为代价。
   *
   * ★ 为什么放在标题栏：面板是**常驻标题栏 + 可滚内容**的结构
   *   （见 PlatformPanel 的 flex 布局）⇒ 标题栏在滚动全程都在视野里，
   *   入口不需要"先滚回去找"。
   */
  onJumpToShelf: () => void
}

/** 标题栏按钮的统一外观（共用，免得各写一套慢慢长歪） */
const HEAD_BTN = {
  fontSize: FS.small,
  padding: '4px 12px',
  border: `1px solid ${C.border}`,
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
} as const

/**
 * 常驻标题栏：一句话说清这是什么 + 「怎么用」开关。
 *
 * ★ 左栏的收起/展开开关**不在这里** —— 它是**分隔线上的把手**（见 PlatformPanel）。
 *   放标题栏的话，用户每次都得把鼠标甩到顶上再甩回来（设计评审指出）。
 */
export function PanelHead({
  open,
  onJumpToIntro,
  source,
  onUseMock,
  mockActive,
  onJumpToShelf,
}: PanelHeadProps): ReactElement {
  return (
    <header
      data-kaipu-head="1"
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderBottom: `1px solid ${C.border}`,
        flexWrap: 'wrap',
      }}
    >
      {/* ★★ 面板主标：`山海 · 开铺`（2026-10-07 由 `山海 · 开铺 · 场地` 改）
          工坊 `083-reply-071-snapshot-review-and-grayzone-v1-20261007.md` §三 抓到这处 ——
          它与我方只改 `Brand.tsx` 而漏掉这里有关：**同族措辞散在两处，改一处不等于改干净。**
          依据同宿主编题裁定：**场地是基座，不与插件并列**；现在只有开铺上线，
          就不把没上线的东西写进标题（等凉亭/工位上线再升格「山海 · 场地」）。
          ★ 判据见 `run-view-probe.mjs` ⑭ 段（反向：旧名必须 0 命中）。 */}
      <span style={{ fontSize: FS.heading }}>山海 · 开铺</span>
      <span style={{ fontSize: FS.small, color: C.dim }}>开铺审计的运行台</span>
      {/* ★ 数据源：**一直显示**，包括"真服务端"正常的时侯 ——
          用户任何时候都该能回答"我现在看的是真的还是演示的"。
          ★★ `data-kaipu-source-mock` 是给判据的**结构锚点**（值 `1`/`0`）：
          引导卡的默认展开态**跟随数据源**（见 PlatformPanel 那段），
          而判据要能核对"此刻该怎么默认"——**不能靠 `source` 这个中文标签去认**
          （认文案的判据改一次文案就响一次，最后会被改松）。 */}
      <span
        data-kaipu-source-label="1"
        data-kaipu-source-mock={mockActive ? '1' : '0'}
        style={{ fontSize: FS.tag, color: C.dim }}
      >
        {source}
      </span>
      <button
        type="button"
        aria-label="切换数据源"
        aria-pressed={mockActive}
        onClick={onUseMock}
        style={{
          fontSize: FS.tag,
          padding: '3px 10px',
          border: `1px solid ${C.border}`,
          borderRadius: 4,
          background: mockActive ? C.soft : 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        {mockActive ? '用真服务端' : '用演示数据'}
      </button>
      {/*
        ★★ 顶部「铺子资料 ↓」—— 一步到位的两个动作：**展开** + **滚到底**。
        锚点在结构上（`data-kaipu-shop-jump`），不靠文案认。
        `title` 把"底下是哪三个抽屉"说全（用户不必先跳过去才知道）。
        ★ 它拿到 `marginLeft: 'auto'`（右对齐的起点），下面那个「怎么用」仍钉在最右 ——
          两者是同级的快捷入口，右端成组，不各占一头。
      */}
      <button
        type="button"
        data-kaipu-shop-jump="1"
        aria-label="跳到铺子资料"
        onClick={onJumpToShelf}
        title="跳到页面底部，展开三个抽屉：待审材料 / 审校报告 / 草稿"
        style={{ ...HEAD_BTN, marginLeft: 'auto' }}
      >
        铺子资料 ↓
      </button>
      {/*
        ★★ 顶部「怎么用 ↑」—— **导航**，不是开关（与「铺子资料 ↓」同一个姿态）。
        文案**恒定**：收起态、展开态都写「怎么用 ↑」——
        读的人一眼知道会发生什么（"带我去用法那儿"），不必先推理当前是什么状态。
        ★ 「收起」不在这里 —— 它在**卡自己**的右上角（见 `Intro`）。
        ★ 锚点 `data-kaipu-intro-jump` 与 `data-kaipu-shop-jump` 对称命名。
      */}
      <button
        type="button"
        data-kaipu-intro-jump="1"
        aria-label="看用法"
        aria-expanded={open}
        onClick={onJumpToIntro}
        title="展开用法说明，并回到页面顶部"
        style={{ ...HEAD_BTN, background: open ? C.soft : 'transparent' }}
      >
        怎么用 ↑
      </button>
    </header>
  )
}

/**
 * 「怎么用」卡：三步 + 四个词 + 判定图例。
 *
 * ★★ 「收起」为什么长在**这张卡自己身上**（2026-10-07 定稿）
 *   标题栏那个按钮被改成"导航"（展开 + 回顶）之后，「收起」需要一个新家。
 *   放卡右上角有两个理由：
 *     · **想收起的人，视线本来就在卡上** —— 不必回头去标题栏找；
 *     · 标题栏那个位置该留给"带我去用法"这个更常用的动作（在页面底部也够得着）。
 *   锚点 `data-kaipu-intro-collapse`，与标题栏的 `-jump` 各表一事。
 */
export function Intro({ onCollapse }: { onCollapse: () => void }): ReactElement {
  return (
    <section
      data-kaipu-intro="1"
      style={{
        margin: '12px 12px 0',
        padding: '12px 14px',
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.accent}`,
        background: 'rgba(59,111,224,0.05)',
        fontSize: FS.base,
        lineHeight: LH.normal,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: FS.title, flex: '1 1 auto', minWidth: 0 }}>第一次用？看这三步就够</div>
        <button
          type="button"
          data-kaipu-intro-collapse="1"
          aria-label="收起用法说明"
          onClick={onCollapse}
          style={{
            flex: '0 0 auto',
            fontSize: FS.tag,
            padding: '2px 9px',
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            background: 'transparent',
            color: C.dim,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          收起
        </button>
      </div>

      <ol style={{ margin: '8px 0 0', paddingLeft: 20, paddingRight: 4 }}>
        <li style={{ overflowWrap: 'break-word' }}>
          <strong>左栏选一场「场景」</strong>
          <span style={{ color: C.dim }}>　一场场景 = 一次固定的会商流程（几个审核面一起审）。</span>
        </li>
        <li style={{ overflowWrap: 'break-word' }}>
          <strong>右栏从上往下看「第 N 轮」</strong>
          <span style={{ color: C.dim }}>　每轮里每个审核面各给一个判定；被回炉的会另起一轮。</span>
        </li>
        <li style={{ overflowWrap: 'break-word' }}>
          <strong>拉到最底看「本次结论」</strong>
          <span style={{ color: C.dim }}>
            　★「未参与审核面」一定要看 —— 它说明这一趟到底没审哪些，报告不会给你"审全了"的错觉。
          </span>
        </li>
      </ol>

      <div style={{ marginTop: 12, fontSize: FS.title }}>四个词，一眼对上</div>
      <div style={{ marginTop: 6 }}>
        <Term k="执行方" v="被接进这场戏的审方。灰掉的是被有意关掉的，不是坏了。" />
        <Term k="场景" v="一次会商流程的固定配置：审哪几个审核面、最多回炉几轮。" />
        {/* ★★ 2026-10-07 修：这里原来写「一个审查角度，**例如「主体核验」「留痕完整性」**」，
            举例取自**演示数据**的 lamp 值。

            ★ 为什么必须删（三类，缺一不算清楚）：
            ① **事实错误** —— 那个位置的真值不是它们。工坊 2026-10-07 回函 §三 实测：
               真服务端 `start.lamps` = `["智灯","匠灯","戒灯","仁灯"]`（灯名）。
            ② **不分数据源** —— 本卡在**演示模式与真服务端下都显示**
               ⇒ 真服务端下同屏矛盾：列表里写「智灯」，卡片教他"例如「主体核验」"。
            ③ **归错类** —— 这不是"演示数据命名"问题，是**通用术语文案引用了演示数据**。

            ★ 当时为什么先改成"以这一场的配置为准"而不是换个例子：
              那时「该叫维度还是叫灯/灯位」还**没定** ⇒ 我方**不代拍**，所以 key 位一个字节没动；
              而「举例用了契约外的值」是**事实错误** ⇒ 不许被一个待定的取向无限期押后。
              **两者必须拆开：改事实，不碰取向。**

            ★★ 2026-10-07 补：**取向现已定**（古茶 010 §一，发起人采纳）——
              key 位由「**维度**」改为「**审核面**」。口径一句话：
              **内部叫灯次，对外叫审核面。** 完整边界（哪些改、哪些绝不动）
              写在 `run-reducer.ts` 的 `DIMS_FOOTER` 上方，改措辞前先读那一段。

            ★★★ 2026-10-07 再补（本例的**闭环**）：**举例现在放回来了 —— 而且放的是灯名。**
              上一轮我删举例时留了一句条件：等 v1.4 落地 + 演示数据对齐真灯名之后，
              举例就可以放回来，"那时放的会是灯名"。**两个条件今天都满足了**：
                · 契约 **v1.4** 已投（`083-interface-contract-v1.4-20261007.md`，
                  §3.3 `lamps: ["智灯","匠灯","戒灯","仁灯"]`）；
                · 演示数据已对齐（`mock/data.ts` 文件头有映射表与理由）。
              ⇒ 所以这里写「例如「智灯」「匠灯」」**是与真值同源的**，不再是事实错误。
              ★ 判据已同步**显式改写**（`run-view-probe.mjs` ⓪.2 第二版）——
                旧版断"引导卡不引用演示数据的 lamp 值"，而对齐后 mock 值**就是**灯名，
                那条会**假红**。新版的**白名单直接取自契约正本件**（不是我方常量），
                ⇒ 举例与数据同源这件事，由**它们各自都被契约钉住**来保证，
                  而不是靠"两边长得像"。 */}
        <Term k="审核面" v="一个审查角度，例如「智灯」「匠灯」。具体是哪几个，以这一场的配置为准。" />
        <Term k="待接入" v="这个审核面还没有执行方。这不是故障 —— 场地不内置任何「必须有的」执行方。" />
      </div>

      <div style={{ marginTop: 12, fontSize: FS.title }}>判定长什么样</div>
      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
        <Legend tone={TONE_BG.pass} word="✅通过" note="直接过" />
        <Legend tone={TONE_BG.conditional} word="⚡有条件" note="补件后可过，通常会触发回炉" />
        <Legend tone={TONE_BG.reject} word="❌驳回" note="这一轮的结论不通过" />
        <Legend tone={TONE_BG.refuse} word="⛔拒收" note="进件前就退回，不收费" />
      </div>
    </section>
  )
}

function Term({ k, v }: { k: string; v: string }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
      <span style={{ flex: '0 0 auto', width: 62, color: C.text }}>{k}</span>
      <span style={{ color: C.dim }}>{v}</span>
    </div>
  )
}

/** 图例一律**实底徽标**，与运行视图里的判定徽标同色 —— 让人把颜色和词对上。 */
function Legend({ tone, word, note }: { tone: string; word: string; note: string }): ReactElement {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          display: 'inline-block',
          padding: '1px 7px',
          borderRadius: 3,
          background: tone,
          color: '#fff',
          fontSize: FS.tag,
          lineHeight: '18px',
          whiteSpace: 'nowrap',
        }}
      >
        {word}
      </span>
      <span style={{ color: C.dim, fontSize: FS.small }}>{note}</span>
    </span>
  )
}
