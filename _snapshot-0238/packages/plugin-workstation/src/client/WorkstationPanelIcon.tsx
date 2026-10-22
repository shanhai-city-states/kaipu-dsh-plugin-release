import { createElement, type ReactElement } from 'react'

/**
 * 工位 · 侧边栏图标
 * =====================================================================
 * ★ 为什么必须有这个文件（2026-10-19 实测抓到的 bug）：
 *
 *   侧边栏 `sidebar.panellist` 座位里有两处会显示内容 ——
 *     ① `label`（列表项文字）
 *     ② slot render（图标位）
 *
 *   本插件原来两处都返回字符串 '工位' ⇒ 侧边栏渲染成 **「工位 工位」**（重复一次）。
 *   platform 包没这个问题，是因为它的 slot render 返回的是 `PlatformPanelIcon`。
 *
 *   ⇒ 口径：**label 管文字，slot render 管图标，两处不许返回同一份内容。**
 *
 * ★ 图形取「一桌一椅」的极简线稿，与 platform 的铺面记号同源（18px / currentColor / 圆头线）。
 */
export function WorkstationPanelIcon(): ReactElement {
  return createElement(
    'span',
    { 'aria-label': '工位', title: '工位', style: { display: 'inline-flex' } },
    createElement(
      'svg',
      { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
      // 桌面 + 桌腿 + 椅背：一眼是「一个位子」，不是又一个铺面
      createElement('path', {
        d: 'M3 10h13M5 10v9M14 10v9M17 13h4v6',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ),
  )
}
