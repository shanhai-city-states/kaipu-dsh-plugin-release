/**
 * 山海·开铺 · 智囊团插件 · 面板配色、字号与样式小件
 * =====================================================================
 * ⚠️⚠️ **本文件是「临时副本」—— 唯一被允许的例外，且有明确的退出条件。**
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * 智囊团面板与场地面板**并排出现在同一个侧边栏里**。两者配色 / 字号
 * 若不一致，用户会以为是两个产品 —— 所以**取值必须一样**。
 *
 * 但 `theme.ts` 原文住在 `@shanhai/kaipu-platform` 包内，而两包
 * **互不 import**（解耦判据会 FAIL）。
 * ⇒ 三条路，只有第三条能走：
 *
 *   | 选项 | 做法 | 评价 |
 *   |:--|:--|:--|
 *   | 1 | 直接把场地的 `theme.ts` import 过来 | ❌ **破坏上述约束**（判据当场 FAIL） |
 *   | 2 | 自己抄一份（**本文件即此**） | ⚠️ 能跑，但两处会各自漂移 |
 *   | 3 | 把主题令牌**下沉到 `@shanhai/kaipu-contract`** | ✅ 正解 —— 契约本来就是"两端共享层" |
 *
 * ── ★★ 选项 3 为什么当前**没做**（如实记代价） ──────────────────────
 *
 * 下沉要**动契约包**，而契约包是**与服务端共管的产物**（有生成链看护）⇒ 这属于**架构调整**，
 * 超出"智囊团前端"的范围 ⇒ 列成 `Q5` 请决策人拍。**我不擅自做。**
 *
 * ── ★★ 临时副本的**退出条件**（写死，免得"临时"变成"永久"） ────────
 *
 *   ① `Q5` 裁定走选项 3 ⇒ **删掉本文件**，改从契约包 import；
 *   ② 或者：任何一次改动了**任一侧**的取值 ⇒ 必须**同时改另一侧**，
 *      并跑配套的主题令牌判据（见下）。
 *
 *   本文件的**取值必须与 `plugin-platform/src/client/theme.ts` 逐字相同** ——
 *   这不是"抄得像"，是**逐字等价**，由配套的主题令牌判据强制。
 *   （该判据的存在理由与"两端各写一份 REMOTE_NS + 判据"完全同源：
 *     抄一份可以，但**必须有机器看护**，否则历史必然重演 ——
 *     本项目已经吃过"注释里承诺、产物里没有"的亏。）
 */
import type { VerdictTone } from '@shanhai/kaipu-contract'

/* ── 判定色：实底 + 白字（理由见场地侧同名注释，此处不重复） ── */
export const TONE_BG: Record<VerdictTone, string> = {
  pass: '#16a34a',
  conditional: '#d97706',
  reject: '#dc2626',
  refuse: '#6d28d9',
}

/**
 * 中性色 —— 三级色阶：主体（text）→ 说明（dim）→ 元信息（faint）。
 * ★ 层级靠**色阶**做、不靠字号：字号一动，中文的行高与折行都会跟着变。
 */
export const C = {
  border: 'var(--dsh-border, #e5e5e5)',
  text: 'var(--dsh-text, inherit)',
  dim: 'var(--dsh-text-secondary, #8a8a8a)',
  faint: 'var(--dsh-text-tertiary, color-mix(in srgb, currentColor 45%, transparent))',
  soft: 'var(--dsh-surface-secondary, rgba(127,127,127,0.08))',
  accent: '#3B6FE0',
} as const

export const FONT = {
  /** 数字 / ID 用等宽，避免抖动 */
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const

/** 字号阶梯（与场地侧同值；用 px 不用 rem —— 根字号不由我们控制） */
export const FS = {
  tag: 12,
  small: 13,
  base: 14,
  title: 15,
  heading: 17,
} as const

/** 行高：中文需要比英文松一点才不挤 */
export const LH = {
  tight: 1.6,
  normal: 1.8,
  loose: 2,
} as const

/**
 * ★ 状态带上「待接入」用的橙 —— **与 `TONE_BG.conditional` 同值**。
 *
 * 为什么要单独起名：它的语义**不是判定**（conditional 是"有条件通过"这个判定档），
 * 而是"**这里还缺人**"。两者恰好同色是**视觉经济**（橙=需要注意），
 * 但**语义不同** ⇒ 起两个名字，将来若要给"缺人"换色，改一处不影响判定体系。
 */
export const VACANT = '#d97706'
