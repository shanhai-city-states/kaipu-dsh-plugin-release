#!/usr/bin/env node
/**
 * 面板块的插件清单 —— **唯一出处**
 * =====================================================================
 * ★ 为什么单独一个文件：`check-panel-order.mjs`（位置礼仪）与
 *   `check-panel-registry.mjs`（注册六字段）都要遍历「我们的插件」。
 *   两份硬编码 = 必然漂移：加第四个插件时只改一处，另一处静默漏检（**假绿**）。
 *
 * ★ 本文件**只导出数据与只读读取函数**，不带任何判据逻辑、不产生副作用
 *   ⇒ 可以被判据脚本 `import`（不会像 `check-panel-order.mjs` 那样一 import 就跑判据并 exit）。
 *
 * 用法（判据脚本内）：
 *   import { PLUGINS, panelDeclOf, panelIdOf } from './panel-plugins.mjs'
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 我们的三个插件（顺序 = 侧边栏 order 升序，与 README 一致） */
export const PLUGINS = [
  'packages/plugin-platform',
  'packages/plugin-wisdom',
  'packages/plugin-workstation',
]

/** 读某个包的 package.json（读不到返回 null，由调用方判红 —— 不在这里吞错） */
export function readPkg(ROOT, dir) {
  const p = join(ROOT, dir, 'package.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** 取 `kaipu.panel` 声明块（没有则 null） */
export function panelDeclOf(ROOT, dir) {
  const pkg = readPkg(ROOT, dir)
  const panel = pkg?.kaipu?.panel
  return panel !== null && typeof panel === 'object' && !Array.isArray(panel) ? panel : null
}

/** 取 `kaipu.panel.panelId`（没有返回 null） */
export function panelIdOf(ROOT, dir) {
  const panel = panelDeclOf(ROOT, dir)
  return typeof panel?.panelId === 'string' ? panel.panelId : null
}
