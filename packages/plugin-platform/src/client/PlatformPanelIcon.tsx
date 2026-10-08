/**
 * 山海·开铺 · 场地插件 · 侧边栏图标（骨架）
 * ★ 座位是 list：注册时**必须**给 `id`，否则 apply 抛错 ⇒ 整站白屏。
 */
import { createElement, type ReactElement } from 'react'

export function PlatformPanelIcon(): ReactElement {
  return createElement(
    'span',
    { 'aria-label': '开铺', title: '开铺', style: { display: 'inline-flex' } },
    createElement(
      'svg',
      { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
      // 一盏灯 / 一个铺面的极简记号（后续再定稿视觉）
      createElement('path', {
        d: 'M4 10h16M6 10v9h12v-9M9 19v-5h6v5',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ),
  )
}
