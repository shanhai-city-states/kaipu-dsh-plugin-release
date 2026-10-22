#!/usr/bin/env node
/**
 * 山海·开铺 · **侧边栏位置礼仪**判据（D10）
 * =====================================================================
 * 为什么需要它：`order` 是那种"改错了也不会报错、只有用户看得出来"的值。
 * 而我们已经被打过一次（阿开实测反馈：「一刷新，插件按钮跑到最上面」）。
 *
 * 断言两条：
 *   ① **每个插件的 `sidebar.panellist` 的 `order` 必须 > 20**
 *      理由：宿主内置项的 order 区间是 0 / 10 / 20（实测自
 *      `ui-plugin-manager` / `ui-schedule` / `ui-agent-preset`）。
 *      **第三方插件排在宿主内置项之前 = 替宿主改布局**，会打乱用户的肌肉记忆。
 *   ② **各插件的 order 不能相同**
 *      理由：宿主排序是 `.sort((a,b) => a.order - b.order)`（升序），
 *      **同值时顺序取决于注册顺序** ⇒ 我们自己的两个按钮谁前谁后变成"看运气"。
 *
 * 用法：node tools/check-panel-order.mjs        （退出码 0 = 通过）
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
/* ★ 2026-10-18：清单抽到唯一出处（`panel-plugins.mjs`）——
   本判据与 `check-panel-registry.mjs` 共用，禁止各写一份（加插件时必然漏一处）。 */
import { PLUGINS } from './panel-plugins.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 宿主内置 order 上界（实测：0 / 10 / 20）—— 我们必须在它之后 */
const HOST_MAX_ORDER = 20

console.log('侧边栏位置礼仪判据（D10）\n')

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failed++
}

const rows = []
for (const dir of PLUGINS) {
  const file = join(ROOT, dir, 'src', 'client', 'index.ts')
  if (!existsSync(file)) {
    say(false, `${dir}：找不到 src/client/index.ts`)
    continue
  }
  const src = readFileSync(file, 'utf8')
  // 定位 panellist 注册块：从 `sidebar.panellist` 出现处往后取一段，在其内找 order
  const at = src.indexOf("'sidebar.panellist'")
  if (at === -1) {
    say(false, `${dir}：没有注册 sidebar.panellist`)
    continue
  }
  const block = src.slice(at, at + 1200)
  const m = /order:\s*(\d+)/.exec(block)
  if (m === null) {
    say(false, `${dir}：panellist 注册块里没有显式 order（默认 0 ⇒ 会插到宿主前面）`)
    continue
  }
  rows.push({ dir, order: Number(m[1]) })
}

console.log('── ① 每个插件都必须排在宿主内置项之后 ──')
for (const r of rows) {
  say(
    r.order > HOST_MAX_ORDER,
    `${r.dir}  order=${r.order}  （必须 > ${HOST_MAX_ORDER}；宿主内置区间 0/10/20，我们跟在后面）`,
  )
}

console.log('\n── ② 我们自己的按钮顺序必须确定（不许同值）──')
if (rows.length >= 2) {
  const orders = rows.map((r) => r.order)
  const unique = new Set(orders)
  say(
    unique.size === orders.length,
    `order 互不相同（${rows.map((r) => `${r.dir.replace('packages/', '')}=${r.order}`).join(' / ')}）⇒ 顺序由我们定，不看注册运气`,
  )
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  console.log(`  · 实测排序：${sorted.map((r) => `${r.dir.replace('packages/', '')}(${r.order})`).join(' → ')}`)
} else {
  say(false, `只读到 ${rows.length} 个插件的 order，无法比对`)
}

console.log(`\n${failed === 0 ? '✓ 通过：插件不抢宿主位置，且我们自己的顺序是确定的' : `✗ ${failed} 项未过`}`)
process.exit(failed === 0 ? 0 : 1)
