/**
 * 山海·开铺 · 工位插件 · 面板配色、字号与样式小件
 * =====================================================================
 * ⚠️⚠️ **本文件是「临时副本」—— 唯一被允许的例外，且有明确的退出条件。**
 *
 * 工位面板与场地/智囊团面板**并排出现在同一侧边栏**。配色/字号不一致会让用户以为
 * 是多个产品 ⇒ 取值必须一样。但 `theme.ts` 原文住在 `@shanhai/kaipu-platform` 包内，
 * 而两包**互不 import**（解耦判据会 FAIL）。
 *
 * ★★ 退出条件（与 plugin-wisdom 同款临时副本纪律）：
 *   ① 若 `Q5` 裁定把主题令牌下沉到 `@shanhai/kaipu-contract` ⇒ 删掉本文件改 import；
 *   ② 任何一次改动任一侧取值 ⇒ 必须同时改**另两侧**（场地 + 智囊团），并跑
 *      `tools/check-theme-tokens.mjs` —— 它逐字比对 **场地 ↔ 工位** 与 **场地 ↔ 智囊团** 两组。
 *
 * ★ 本文件取值必须与 `plugin-platform/src/client/theme.ts` **逐字相同**（由上面那支判据看护）。
 */
import type { VerdictTone } from '@shanhai/kaipu-contract'

/* ── 判定色：实底 + 白字 ── */
export const TONE_BG: Record<VerdictTone, string> = {
  pass: '#16a34a',
  conditional: '#d97706',
  reject: '#dc2626',
  refuse: '#6d28d9',
}

export const C = {
  border: 'var(--dsh-border, #e5e5e5)',
  text: 'var(--dsh-text, inherit)',
  dim: 'var(--dsh-text-secondary, #8a8a8a)',
  faint: 'var(--dsh-text-tertiary, color-mix(in srgb, currentColor 45%, transparent))',
  soft: 'var(--dsh-surface-secondary, rgba(127,127,127,0.08))',
  accent: '#3B6FE0',
} as const

export const FONT = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const

export const FS = {
  tag: 12,
  small: 13,
  base: 14,
  title: 15,
  heading: 17,
} as const

export const LH = {
  tight: 1.6,
  normal: 1.8,
  loose: 2,
} as const
