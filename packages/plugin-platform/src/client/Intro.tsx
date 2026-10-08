/**
 * 山海·开铺 · 场地插件 · 首屏引导（常驻标题栏 + 「怎么用」页）
 * =====================================================================
 * ★★ 为什么需要它（不是装饰）：
 *   用户第一眼看到的是「演示数据」「未签名」「第 1 轮 / 第 2 轮」——
 *   这些都是**结论性的信息**，但它们预设了读者已经知道"这块面板是干什么的"。
 *   实测反馈就是一句：「第一眼不知道怎么用」。
 *   ⇒ 缺的不是功能，是**入口处的一层说明**：这是什么 · 我该看哪几处 · 那些词什么意思。
 *
 * ★★ 2026-10-08：「怎么用」从"右栏顶部一张可展开/收起的卡"
 *   **提拔成顶部页签**（`help`）。随之两条变化：
 *     · **去掉「收起」按钮** —— 页签本身就是"我来学用法"的意图表达，
 *       再让人先"展开"一次是多余动作（整页即内容）。
 *     · 标题栏那两个跳转按钮（`data-kaipu-shop-jump` / `data-kaipu-intro-jump`）
 *       一并删除 —— 它们本是为"滚动导航"服务的，页签让滚动导航**整体作废**。
 *
 * ★ 设计上刻意克制（两条）：
 *   1. ★ 四类判定的图例**画在运行视图之外**（见 `PlatformPanel` 的 `[data-kaipu-run]` 边界）。
 *      理由：判据探针断言的是"运行视图里出现了 ⚡有条件"。
 *      如果图例长在运行视图里，那些断言就变成**恒真的空断言** ——
 *      我们反复强调过「一个不会失败的断言等于没有」。
 *   2. 文案里**不出现**契约禁用词（如"已取消"），免得污染 R5 的禁用词断言。
 *
 * ★ 不做持久化（不写 localStorage）：
 *   宿主可能禁存储 / 面板可能在悬停卡里被反复挂载；
 *   引入 try-catch 兜底的存储，收益（少点一次）不抵复杂度。
 *   本组件如今**不持有任何跨挂载状态** —— 页签由装配层（`PlatformPanel`）持有。
 */
import type { ReactElement } from 'react'
import { FS, LH, C, TONE_BG } from './theme.js'

export interface PanelHeadProps {
  /**
   * 数据源显示（★★ 必须是**显式状态**，不许靠"请求失败就换"来推断）。
   * 见 `PlatformPanel` 文件头那段：live / 人工选的 mock / unreachable 三者严格分开。
   */
  source: string
  /** 在"自动（真服务端）"与"演示数据"之间切 */
  onUseMock: () => void
  /** 当前是否停在演示数据上（决定按钮的按压态与措辞） */
  mockActive: boolean
}
/* ★ 2026-10-08：`open` / `onJumpToIntro` / `onJumpToShelf` 三个 prop 与
   `HEAD_BTN` 外观常量**已随两个跳转按钮一并删除** ——
   「铺子资料 / 怎么用」成了页签，标题栏只剩"主标 + 数据源 + 切换数据源"。 */

/**
 * 常驻标题栏：一句话说清这是什么 + 当前数据源 + 切换数据源。
 *
 * ★ 左栏的收起/展开开关**不在这里** —— 它是**分隔线上的把手**（见 PlatformPanel）。
 *   放标题栏的话，用户每次都得把鼠标甩到顶上再甩回来（设计评审指出）。
 */
export function PanelHead({ source, onUseMock, mockActive }: PanelHeadProps): ReactElement {
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
          服务端复核时抓到这处 ——
          它与仅改 `Brand.tsx` 而漏掉这里有关：**同族措辞散在两处，改一处不等于改干净。**
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
    </header>
  )
}

/**
 * 「怎么用」页：三步 + 四个词 + 判定图例。**整页即内容**（2026-10-08）。
 *
 * ★★ 为什么不再有「收起」（定稿）
 *   旧版它是右栏顶部一张**默认展开的卡**，必须给个「收起」免得每次挡路。
 *   现在它独占一个页签：**点页签本身就是"我要看用法"** ——
 *   整页即内容，没有"挡不挡路"的问题，也就不需要开合。
 *   ⇒ `onCollapse` prop 与 `data-kaipu-intro-collapse` 锚点一并删除。
 * ★ 锚点 `data-kaipu-intro` 保留（判据认它）。
 *
 * ★★ 2026-10-08 补丁：三步里的「左栏」「右栏」各加前缀「**在操作台的**」。
 *
 *   为什么必须加（不是措辞润色，是**位置指代失去了参照系**）：
 *     「左栏 / 右栏」是**相对位置** —— 相对的是**操作台那一页**。
 *     分页之前「怎么用」长在操作台右栏里，读者**就站在操作台上**，
 *     "左栏"不言自明。分页之后它成了**独立页签**：读者点进来时，
 *     操作台已经不在屏幕上，此时"左栏"指向**屏幕上不存在的东西**。
 *   ⇒ 一句话补参照系：**在操作台的**左栏 / 右栏。
 *
 *   ★ 只加前缀，**不动句子其余部分** —— 三步的动作、右侧的解释一字未改。
 *   ★★ 2026-10-08 · 同一窗口补齐：**第三步也加**——
 *     「拉到最底看「本次结论」」→「**在操作台**拉到最底看「本次结论」」。
 *     理由同前两条（位置指代要带参照系）；它不指某个"栏"，故前缀直接接在动词前。
 *   ★ 判据同步**升级**（不是放松）：老写法 `includes('左栏选一场')` 是**子串** ——
 *     前缀被删它照样绿（恰好在这次改动上"不会失败"）。现改为三条**完整句**断言，
 *     去掉前缀即变红。三条的理由与取舍写在探针里那三条的注释上。
 */
export function Intro(): ReactElement {
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
      </div>

      <ol style={{ margin: '8px 0 0', paddingLeft: 20, paddingRight: 4 }}>
        <li style={{ overflowWrap: 'break-word' }}>
          <strong>在操作台的左栏选一场「场景」</strong>
          <span style={{ color: C.dim }}>　一场场景 = 一次固定的会商流程（几个审核面一起审）。</span>
        </li>
        <li style={{ overflowWrap: 'break-word' }}>
          <strong>在操作台的右栏从上往下看「第 N 轮」</strong>
          <span style={{ color: C.dim }}>　每轮里每个审核面各给一个判定；被回炉的会另起一轮。</span>
        </li>
        <li style={{ overflowWrap: 'break-word' }}>
          <strong>在操作台拉到最底看「本次结论」</strong>
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
            ① **事实错误** —— 那个位置的真值不是它们。2026-10-07 核验实测：
               真服务端 `start.lamps` = `["智灯","匠灯","戒灯","仁灯"]`（灯名）。
            ② **不分数据源** —— 本卡在**演示模式与真服务端下都显示**
               ⇒ 真服务端下同屏矛盾：列表里写「智灯」，卡片教他"例如「主体核验」"。
            ③ **归错类** —— 这不是"演示数据命名"问题，是**通用术语文案引用了演示数据**。

            ★ 当时为什么先改成"以这一场的配置为准"而不是换个例子：
              那时「该叫维度还是叫灯/灯位」还**没定** ⇒ 本仓**不代拍**，所以 key 位一个字节没动；
              而「举例用了契约外的值」是**事实错误** ⇒ 不许被一个待定的取向无限期押后。
              **两者必须拆开：改事实，不碰取向。**

            ★★ 2026-10-07 补：**取向现已定**——
              key 位由「**维度**」改为「**审核面**」。口径一句话：
              **内部叫灯序号，对外叫审核面。** 完整边界（哪些改、哪些绝不动）
              写在 `run-reducer.ts` 的 `DIMS_FOOTER` 上方，改措辞前先读那一段。

            ★★★ 2026-10-07 再补（本例的**闭环**）：**举例现在放回来了 —— 而且放的是灯名。**
              上一轮我删举例时留了一句条件：等 v1.4 落地 + 演示数据对齐真灯名之后，
              举例就可以放回来，"那时放的会是灯名"。**两个条件今天都满足了**：
                · 契约 **v1.4** 已投（
                  §3.3 `lamps: ["智灯","匠灯","戒灯","仁灯"]`）；
                · 演示数据已对齐（`mock/data.ts` 文件头有映射表与理由）。
              ⇒ 所以这里写「例如「智灯」「匠灯」」**是与真值同源的**，不再是事实错误。
              ★ 判据已同步**显式改写**（`run-view-probe.mjs` ⓪.2 第二版）——
                旧版断"引导卡不引用演示数据的 lamp 值"，而对齐后 mock 值**就是**灯名，
                那条会**假红**。新版的**白名单直接取自契约正本件**（不是本仓常量），
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
