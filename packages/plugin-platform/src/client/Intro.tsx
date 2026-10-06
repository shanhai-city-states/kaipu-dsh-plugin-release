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
  onToggle: () => void
  /**
   * 数据源显示（★★ 必须是**显式状态**，不许靠"请求失败就换"来推断）。
   * 见 `Panel` 文件头那段：live / 人工选的 mock / unreachable 三者严格分开。
   */
  source: string
  /** 在"自动（真服务端）"与"演示数据"之间切 */
  onUseMock: () => void
  /** 当前是否停在演示数据上（决定按钮的按压态与措辞） */
  mockActive: boolean
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
export function PanelHead({ open, onToggle, source, onUseMock, mockActive }: PanelHeadProps): ReactElement {
  return (
    <header
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
      <span style={{ fontSize: FS.heading }}>山海 · 开铺 · 场地</span>
      <span style={{ fontSize: FS.small, color: C.dim }}>开铺审计的运行台</span>
      {/* ★ 数据源：**一直显示**，包括"真服务端"正常的时侯 ——
          用户任何时候都该能回答"我现在看的是真的还是演示的"。 */}
      <span data-kaipu-source-label="1" style={{ fontSize: FS.tag, color: C.dim }}>
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
      <button
        type="button"
        aria-label="怎么用"
        aria-expanded={open}
        onClick={onToggle}
        style={{ ...HEAD_BTN, marginLeft: 'auto', background: open ? C.soft : 'transparent' }}
      >
        {open ? '收起用法' : '怎么用'}
      </button>
    </header>
  )
}

/** 「怎么用」卡：三步 + 四个词 + 判定图例。 */
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
      <div style={{ fontSize: FS.title }}>第一次用？看这三步就够</div>

      <ol style={{ margin: '8px 0 0', paddingLeft: 20, paddingRight: 4 }}>
        <li style={{ overflowWrap: 'break-word' }}>
          <strong>左栏选一场「场景」</strong>
          <span style={{ color: C.dim }}>　一场场景 = 一次固定的会商流程（几个维度一起审）。</span>
        </li>
        <li style={{ overflowWrap: 'break-word' }}>
          <strong>右栏从上往下看「第 N 轮」</strong>
          <span style={{ color: C.dim }}>　每轮里每个维度各给一个判定；被回炉的会另起一轮。</span>
        </li>
        <li style={{ overflowWrap: 'break-word' }}>
          <strong>拉到最底看「本次结论」</strong>
          <span style={{ color: C.dim }}>
            　★「未参与维度」一定要看 —— 它说明这一趟到底没审哪些，报告不会给你"审全了"的错觉。
          </span>
        </li>
      </ol>

      <div style={{ marginTop: 12, fontSize: FS.title }}>四个词，一眼对上</div>
      <div style={{ marginTop: 6 }}>
        <Term k="执行方" v="被接进这场戏的审方。灰掉的是被有意关掉的，不是坏了。" />
        <Term k="场景" v="一次会商流程的固定配置：审哪几个维度、最多回炉几轮。" />
        <Term k="维度" v="一个审查角度，例如「主体核验」「留痕完整性」。" />
        <Term k="待接入" v="这个维度还没有执行方。这不是故障 —— 场地不内置任何「必须有的」执行方。" />
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
