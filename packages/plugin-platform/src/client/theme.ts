/**
 * 山海·开铺 · 场地插件 · 面板配色、字号与样式小件
 * =====================================================================
 * ★ 判定配色用**实底 + 白字**，不用半透明色块。
 *   理由：面板可能被挂在浅色壳、深色壳或悬停卡里（三种底色）；
 *   半透明色块在深底上会糊，实底徽标在三种底色上都一样清楚。
 *   ⇒ R3「四类判定必须可区分且可见」是**功能要求**，不是审美偏好。
 */
import type { VerdictTone } from '@shanhai/kaipu-contract'

export const TONE_BG: Record<VerdictTone, string> = {
  pass: '#16a34a',
  conditional: '#d97706',
  reject: '#dc2626',
  refuse: '#6d28d9',
}

/** 面板里用到的中性色 —— 一律走 DSH 的 CSS 变量，跟随宿主主题 */
export const C = {
  border: 'var(--dsh-border, #e5e5e5)',
  text: 'var(--dsh-text, inherit)',
  dim: 'var(--dsh-text-secondary, #8a8a8a)',
  /**
   * 第五级：**知道就行、不必读**的信息 —— 版本号 · 耗时 · 单位 · 计数。
   *
   * ★ 为什么还要再淡一档（"信息量太大、不够清晰"反馈）：
   *   原来 `v3` `0 ms` `12 维` 这些都走 `dim`，而 `dim` 同时也是**副标题、说明、
   *   分类 intent** 用的色 ⇒ **五类信息同一个亮度**，眼睛没有落点，
   *   一屏读下来像"每句都同等重要"。
   *   ⇒ 把"元信息"独立成第三档，让**主体（名字）→ 说明（dim）→ 元信息（faint）**
   *     拉开三层，是这次"提高清晰度"的落点。（层级靠\*\*色阶\*\*做，不靠字号 ——
   *     字号一动，中文的行高与折行都会跟着变。）
   * ★ 写法：优先取宿主的第三档变量；宿主没定义时用 `color-mix` 把当前色稀释掉
   *   （Chromium 111+ 支持）。不用写死 rgba —— 面板要同时活在浅底与深底两种壳里。
   */
  faint: 'var(--dsh-text-tertiary, color-mix(in srgb, currentColor 45%, transparent))',
  soft: 'var(--dsh-surface-secondary, rgba(127,127,127,0.08))',
  accent: '#3B6FE0',
} as const

export const FONT = {
  /** 数字/ID 用等宽，避免抖动 */
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const

/**
 * ★★ 字号阶梯（2026-10-05 统一放大一档）。
 *
 * 为什么要收成一个阶梯、而不是各处随手写数字：
 *   1. 面板是**嵌在宿主里的一个区域**，宿主正文本身在 13~14px；面板里再写 10/11px
 *      就成了"脚注"，第一眼读不到重点 —— 这正是"第一眼不知道怎么用"的一半原因。
 *   2. 分散写死 ⇒ 要整体调大时得满文件找数字，**必然漏几处**，改了半大不小更难看。
 *   3. 判据探针断的是**文案字面量**（"第 2 轮"/"未参与审核面"…），与字号无关 ⇒
 *      改阶梯不会打破任何一条断言。
 *
 * 用 px 而不是 rem/em：面板由宿主注入父子结构，`root` 字号不由我们控制，
 * 用相对单位会让同一份代码在两种壳里差出一档（踩过）。
 */
export const FS = {
  /** 标签、时间戳、等宽数字、脚手按钮 */
  tag: 12,
  /** 次要说明、副标题、变更记录明细 */
  small: 13,
  /** 正文：维度行、错误说明、空态说明 */
  base: 14,
  /** 区块标题：轮次、场景名、执行方名 */
  title: 15,
  /** 主标题：面板名、场景大标题 */
  heading: 17,
} as const

/** 行高：中文需要比英文松一点才不挤 */
export const LH = {
  tight: 1.6,
  normal: 1.8,
  loose: 2,
} as const
