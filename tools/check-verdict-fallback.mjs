#!/usr/bin/env node
/**
 * 山海·开铺 · 判定取值兜底判据（★ 第三道闸门的客户端落点）
 * =====================================================================
 * 背景（2026-10-05 联调实测抓到的真洞）：
 *   服务端在 `agents` 表为空时，会发出**契约里没有的第五类判定 `⚪未接入`**：
 *     event: lamp_done
 *     data: {"lamp":"综合维度","verdict":"⚪未接入", ...}
 *   而契约 `contracts/v1.1/sse-events.json` 只定义了四类。
 *
 *   我方原实现是 `VERDICT_TONE[verdict]`：
 *     · 类型上 `Record<Verdict, VerdictTone>` 让 TS 以为**永远有值** —— 类型在说谎；
 *     · 运行时未知键得 `undefined` ⇒ 渲染面 `tone === null ? 灰 : TONE_BG[undefined]`
 *       走的是**后者** ⇒ `background: undefined` ⇒ 徽标没有底色。
 *   ⇒ **「兜底那行」写了但永远到不了**。这不是笔误，是一类通病：
 *     **兜底条件与错误值不匹配 ⇒ 兜底不可达 ⇒ 等于没有兜底。**
 *
 * 本判据要证的就是「兜底**可达**」，而不是"代码里有一行看起来像兜底的"。
 *   · 正向：契约四类 ⇒ 四个非空档位
 *   · ★ 反向：**未知取值 ⇒ 回 `null`（不是 `undefined`）**
 *   · 对照：直接索引契约表 ⇒ `undefined`（证"没有 `?? null` 就会破"）
 *   · 登记：`⚪未接入` 是**实测已发、契约未收**的取值 ⇒ 只打印为待提差异单，不 FAIL
 *     （契约变更须由出件方发起，本仓纪律：不单方扩契约）
 *
 * 用法：node tools/check-verdict-fallback.mjs
 * 退出码：0 = 全过；1 = 有失败
 */
import { readFileSync, copyFileSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(ROOT, 'packages', 'plugin-platform')

let failed = 0
const say = (ok, label) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) failed++
}

/* ── 0. 判据自己要能读契约（期望值不手抄） ── */
const sse = JSON.parse(readFileSync(join(ROOT, 'contracts', 'v1.1', 'sse-events.json'), 'utf8'))
const contractVerdicts = (sse.verdicts ?? []).map((v) => v.value)
console.log(`契约判定枚举（读自 contracts/v1.1/sse-events.json）：${contractVerdicts.join(' / ')}`)
console.log(`条数：${contractVerdicts.length}\n`)

/* ── 1. 真跑编译产物（CLI 不另写一份逻辑，只验产物行为） ── */
if (!existsSync(join(PLUGIN, 'lib', 'client', 'run-reducer.js'))) {
  console.error('✗ 找不到 packages/plugin-platform/lib/client/run-reducer.js —— 先 `node tools/build.mjs`')
  process.exit(1)
}
const TMP = join(PLUGIN, '.tmp-verdict-judge')
const req = createRequire(join(TMP, 'x.cjs'))
let toneOf
let VERDICT_TONE
try {
  // ★ plugin-platform 是 `"type":"module"` ⇒ 产物 `.js` 会被 Node 当 ESM 解析，
  //   而它是 CJS 语法 ⇒ 必须**改名 .cjs** 才能 require（与 003 的 lib-cjs 同一个坑）。
  mkdirSync(TMP, { recursive: true })
  writeFileSync(join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8')
  /**
   * ★★ 判据自备「契约包解析桥」（2026-10-08 加）
   *
   * 为什么需要：本包**刻意不把 `@shanhai/kaipu-contract` 写进 devDependencies**
   *   （理由见 `packages/plugin-platform/package.json` 的 `//contract`）⇒
   *   `node_modules/@shanhai/kaipu-contract` 这条软链**不再存在**。
   *   而**这条判据恰恰走的是"直接 require tsc 产物"这条路** ——
   *   产物里的 `require('@shanhai/kaipu-contract')` **没有被 bundle 内联**
   *   （内联只发生在 `tools/build-client.mjs` 产出的 `lib/client.js` 里）⇒
   *   Node 解析不到 ⇒ `MODULE_NOT_FOUND`。
   *   ⚠️ 这不是"依赖丢了"，是**这条路本来就需要契约包在场**（用户机上不需要 —— 用户机跑的是 bundle）。
   *
   * 为什么在**这里**建：判据的纪律是「**自己把前态摆干净**」，而不是要求
   *   开发者先手工 `pnpm install` 出一个软链。桥只建在**本判据的临时目录**里
   *   （`TMP/node_modules`）、**跑完随 TMP 一起删** ⇒ 不留痕、不影响别的判据。
   *   ★ 它**不代表**本包依赖契约包：产物（bundle）与用户机都不需要它。
   */
  const bridge = join(TMP, 'node_modules', '@shanhai')
  mkdirSync(bridge, { recursive: true })
  symlinkSync(join(ROOT, 'packages', 'contract'), join(bridge, 'kaipu-contract'), 'junction')
  copyFileSync(join(PLUGIN, 'lib', 'client', 'run-reducer.js'), join(TMP, 'run-reducer.cjs'))
  toneOf = req('./run-reducer.cjs').toneOf
  VERDICT_TONE = req('@shanhai/kaipu-contract').VERDICT_TONE
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

console.log('── ① 契约四类 ⇒ 四个非空档位 ──')
for (const v of contractVerdicts) {
  const tone = toneOf(v)
  say(typeof tone === 'string' && tone.length > 0, `${v} ⇒ ${JSON.stringify(tone)}`)
}

console.log('\n── ② ★ 未知取值 ⇒ null（不是 undefined）──')
// `⚪未接入` = 服务端实测已发；`🆕未来判定` = 合成值（防"只对这一个特例打补丁"）
for (const v of ['⚪未接入', '🆕未来判定']) {
  const tone = toneOf(v)
  say(tone === null, `${v} ⇒ ${JSON.stringify(tone)}${tone === null ? '（中性灰，兜底可达）' : '  ← 不是 null！兜底不可达'}`)
}

console.log('\n── ③ 对照：没有 `?? null` 就会破 ──')
say(
  VERDICT_TONE['⚪未接入'] === undefined,
  '直接索引契约表得 undefined ⇒ 若 toneOf 原样返回它，渲染面 `tone === null ? 灰 : …` 的两条路都接不住',
)

console.log('\n── ④ 边界 ──')
say(toneOf(null) === null, 'null ⇒ null（尚未判定/待接入语义）')

console.log('\n── ⑤ 登记（不 FAIL）──')
const missing = ['⚪未接入'].filter((v) => !contractVerdicts.includes(v))
if (missing.length === 0) {
  console.log('  · 无：契约已收全（若契约补了第五类，本条会自行消失）')
} else {
  console.log(`  ! 以下取值**服务端已在发、契约未收录**：${missing.join(', ')}`)
  console.log('    ⇒ 已登记为**待提差异单**（契约变更须由出件方发起，本仓不单方扩契约）')
  console.log('    ⇒ 在契约补上之前，客户端靠 `toneOf ⇒ null`（中性灰）兜底渲染 —— 不崩、不编色')
}

console.log(`\n${failed === 0 ? '✓ 全绿' : `✗ ${failed} 项未过`}`)
process.exit(failed === 0 ? 0 : 1)
