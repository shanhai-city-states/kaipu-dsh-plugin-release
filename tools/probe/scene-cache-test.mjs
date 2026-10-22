#!/usr/bin/env node
/**
 * scene-cache-test.mjs —— 流程清单缓存判定（`decideSceneCache`）的**可失败**测试
 * =====================================================================
 *
 * ★★ 为什么要单独立这一支（而不是塞进浏览器探针）：
 *   这套判定的**真实触发条件今天到不了** —— 服务端还没下发 `updatedAt`
 *   ⇒ 线上永远走 `'absent'` 那一支 ⇒「命中缓存」那条路径**永远没人验过**。
 *   若把它留在浏览器探针里，那天对方落了 `updatedAt`，**第一次真跑就是它第一次执行**。
 *   ⇒ 抽成纯函数 + 这支测试 ⇒ **四支今天全部能被喂一遍**。
 *
 * ★ 为什么用**子进程跑 tsc 产物**而不是 import 源 `.ts`：
 *   本仓的 client 源是 `.ts`（含 JSX 同族），node 直接 import 不了；
 *   而**构建产物** `lib/client.js` 是 bundle（找不出单个导出）。
 *   ⇒ 改用：**用 tsc 把 live.ts 单独编成临时 mjs**，再 import 它的那个纯函数。
 *      ⚠️ 若依赖太多编不出来，本脚本**报"未验"并显式退出码 2**（**不假装通过**）。
 *
 * 用法：node tools/probe/scene-cache-test.mjs
 * 退出码：0 = 全过；1 = 有用例不符；2 = 环境不足，**未验**（不是通过）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const SRC = join(ROOT, 'packages/plugin-platform/src/client/live.ts')

let pass = 0
let fail = 0
const say = (ok, label) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) }
}

/*
 * ── 取被测函数 ──────────────────────────────────────────────────────
 * 由于源文件依赖较多，这里**只抽取那一个函数体**（正则定位 + 手工剥类型），
 * ★ 并且**先断抽取成功** —— 抽取失败就报"未验"退出，绝不让下游用例变成
 *   "对着空气断言"（那正是本仓老账：抽取器失效 ⇒ 判据恒绿）。
 */
const src = readFileSync(SRC, 'utf8')
/**
 * ★ 抽取方式：**按行**定位（不走"一行正则吃掉整个签名"）。
 *
 * ⚠️ 第一版用了个跨行正则，**当场抽空** —— 它要求返回类型那行的结尾是 `\n} {`，
 *   而实际返回类型与函数体开括号**在同一行**（`… store: boolean } {`）⇒ 匹配不上。
 *   ★ 好在脚本自带"抽到没有"的自证 ⇒ **报了"未验"(退出码 2)**，
 *     而不是让下面 11 条用例去对着空气断言（那才会变成一整套恒真判据）。
 */
const lines = src.split('\n')
const startIdx = lines.findIndex((l) => l.startsWith('export function decideSceneCache'))
/**
 * ⚠️ 第二版仍抽空，原因：我按 `l === '} {'` 找签名末行，而**实际签名末行是**
 *   `}): { hit: boolean; … store: boolean } {` —— 它**以 `} {` 结尾**，但不是"那一行就叫 `} {`"。
 *   ⇒ 改用 `endsWith('} {')`。
 * ★ 值得记：这一处我**连着写错两次**（一次跨行正则、一次等值比较），
 *   两次都靠同一条自证（"抽到了吗"）当场暴露 —— 若没有它，11 条用例会全绿而**验的是空气**。
 */
const sigEndIdx = startIdx < 0 ? -1 : lines.findIndex((l, i) => i > startIdx && l.endsWith('} {'))
const endIdx = sigEndIdx < 0 ? -1 : lines.findIndex((l, i) => i > sigEndIdx && l === '}')
const bodyRaw = sigEndIdx < 0 || endIdx < 0 ? null : lines.slice(sigEndIdx + 1, endIdx).join('\n')

say(bodyRaw !== null, `★ 从 live.ts 抽到 decideSceneCache 函数体（${bodyRaw === null ? '抽出失败 ⇒ 下面全部未验' : `${bodyRaw.length} 字符`}）`)
if (bodyRaw === null) {
  console.log('\n★ 未验：抽取失败 ⇒ 退出码 2（**不假装通过**）')
  process.exit(2)
}

// 剥掉 TS 注解，变成可 eval 的纯 JS
const bodyJs = bodyRaw.replace(/\s+as SnapshotCache\['basis'\]/g, '')
const factory = new Function('input', bodyJs)
const decide = (input) => factory(input)

console.log('\n── 四支 + 反向 ──')

/* ① 依据缺失 ⇒ 不命中、basis='absent'、不写缓存 */
{
  const r = decide({ updatedAt: null, agentsSig: 'a', cached: null })
  say(r.hit === false, '① 依据缺失 ⇒ **不命中**')
  say(r.basis === 'absent', `① 依据缺失 ⇒ basis='absent'（实读 ${JSON.stringify(r.basis)}）`)
  say(r.store === false, '① 依据缺失 ⇒ **不写缓存**（没有比对依据的存档是假缓存）')
}

/* ①b ★ 反向：依据缺失时**绝不能**声称命中 —— 哪怕手上真有缓存 */
{
  const r = decide({ updatedAt: null, agentsSig: 'a', cached: { updatedAt: '2026-01-01T00:00:00Z', agentsSig: 'a' } })
  say(r.hit === false, '★ ①b 反向：**手上有缓存也不许命中**（依据缺失 ⇒ 无从判断它变没变）')
  say(r.store === false, '★ ①b 反向：且**要把旧缓存作废**（store=false ⇒ 调用方清缓存）')
}

/* ② 首次（无缓存）⇒ 不命中但存档 */
{
  const r = decide({ updatedAt: 'T1', agentsSig: 'a', cached: null })
  say(r.hit === false && r.basis === 'updatedAt' && r.store === true, '② 首次 ⇒ 不命中 · 依据在 · **存档**')
}

/* ②b 依据变了 ⇒ 不命中、存档刷新 */
{
  const r = decide({ updatedAt: 'T2', agentsSig: 'a', cached: { updatedAt: 'T1', agentsSig: 'a' } })
  say(r.hit === false && r.basis === 'updatedAt' && r.store === true, '②b 依据变了 ⇒ **不命中** · 存档刷新')
}

/* ★ ②c 反向：依据**没**变 ⇒ 必须命中（否则缓存形同虚设） */
{
  const r = decide({ updatedAt: 'T1', agentsSig: 'a', cached: { updatedAt: 'T1', agentsSig: 'a' } })
  say(r.hit === true, '★ ②c **正向**：依据没变 + 执行方没变 ⇒ **命中**')
  say(r.store === false, '★ ②c 命中时**不重写缓存**（没必要）')
}

/* ★★ ③ 依据没变但**执行方变了** ⇒ 不许命中（本仓自己加的防偷懒条款） */
{
  const r = decide({ updatedAt: 'T1', agentsSig: 'a|b', cached: { updatedAt: 'T1', agentsSig: 'a' } })
  say(r.hit === false, '★★ ③ **执行方变了 ⇒ 即使依据没变也不许命中**（否则卡片里的执行方名是旧的）')
  say(typeof r.staleReason === 'string' && r.staleReason.length > 0, '★★ ③ 且必须**给出 staleReason**（说清为什么没命中）')
  say(r.store === true, '★ ③ 要刷新存档（执行方签名进了存档）')
}

console.log(`\n通过 ${pass} / ${pass + fail}`)
if (fail > 0) {
  console.log('\n✗ 有用例不符')
  process.exit(1)
}
console.log('✓ 全过')
