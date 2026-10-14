/**
 * 山海·开铺 · 智囊团插件 · 侧边栏图标（骨架）
 * ★ 座位是 list：注册时**必须**给 `id`，否则 apply 抛错 ⇒ 整站白屏。
 */
import { createElement, type ReactElement } from 'react'

export function WisdomPanelIcon(): ReactElement {
  return createElement(
    'span',
    { 'aria-label': '智囊团', title: '智囊团', style: { display: 'inline-flex' } },
    createElement(
      'svg',
      { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
      // 三盏灯围坐会商（Step 4 再定稿视觉）
      createElement('circle', { cx: 12, cy: 6.5, r: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
      createElement('circle', { cx: 6.5, cy: 16.5, r: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
      createElement('circle', { cx: 17.5, cy: 16.5, r: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
    ),
  )
}
