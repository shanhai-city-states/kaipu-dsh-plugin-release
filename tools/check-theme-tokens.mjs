#!/usr/bin/env node
/**
 * 山海·开铺 · **主题令牌一致性判据**（`check-theme-tokens.mjs`）
 * =====================================================================
 * ★★ 为什么需要它：智囊团与场地**并排出现在同一个侧边栏**，
 *   配色 / 字号不一致 = 用户以为是两个产品 ⇒ **取值必须逐字相同**。
 *
 *   而 A-2 禁止智囊团 import 场地的 `theme.ts` ⇒ 只能**抄一份**
 *   （`plugin-wisdom/src/client/theme.ts`，文件头写着"临时副本"）。
 *
 *   ★ 抄一份可以，但**必须有机器看护** —— 否则历史必然重演：
 *     本项目已经吃过"注释里承诺、产物里没有"的亏（`check-remote-bridge` 欠账那次）。
 *
 *   这条与"两端各写一份 `REMOTE_NS` + 判据"**完全同源**：
 *     **副本不是问题，"没有判据的副本"才是问题。**
 *
 * ── 判据清单 ────────────────────────────────────────────────────────
 *   A `C` 中性色阶六项同值
 *   B `FS` 字号阶梯五项同值
 *   C `LH` 行高三项同值
 *   D `TONE_BG` 判定色四项同值
 *   E `FONT.mono` 等宽字体同值
 *   F 智囊团侧的 `theme.ts` **必须带"临时副本"标记**（防止有人改了标题就忘了它是什么）
 *
 * ★ 本判据**故意不做**的事：不要求智囊团有 `VACANT`（那是智囊团专属，
 *   场地侧没有"缺人"这个语义）。⇒ 只比对**共用**的令牌，不比对专属的。
 *   ⚠️ 但会**显式打印**"智囊团多出的令牌"供人眼确认 —— 免得有人以为漏比了。
 *
 * 用法：node tools/check-theme-tokens.mjs
 * 退出码：0 = 全过；1 = 有 FAIL
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const PLATFORM_THEME = join(ROOT, 'packages/plugin-platform/src/client/theme.ts')
const WISDOM_THEME = join(ROOT, 'packages/plugin-wisdom/src/client/theme.ts')
const WORKSTATION_THEME = join(ROOT, 'packages/plugin-workstation/src/client/theme.ts')

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${msg}`)
  if (!ok) failed++
}

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)

console.log('主题令牌一致性判据\n')

const plat = read(PLATFORM_THEME)
const wis = read(WISDOM_THEME)
const ws = read(WORKSTATION_THEME)
if (plat === null) {
  console.log(`  \u2717 找不到 ${relative(ROOT, PLATFORM_THEME)}`)
  process.exit(1)
}
if (wis === null) {
  console.log(`  \u2717 找不到 ${relative(ROOT, WISDOM_THEME)}`)
  console.log(`     \u21d2 智囊团 Step 4 起要有自己的一份（A-2 禁止它 import 场地的那份）`)
  process.exit(1)
}
if (ws === null) {
  console.log(`  \u2717 找不到 ${relative(ROOT, WORKSTATION_THEME)}`)
  console.log(`     \u21d2 工位插件要有自己的一份（A-2 禁止它 import 场地的那份）`)
  process.exit(1)
}

/**
 * 从一个 `export const NAME = { … }` 块里解出 `键: 值`。
 *
 * ★★ 2026-10-06 修正（第一版当场抓到两个缺陷，记在这里免得重犯）：
 *
 *   缺陷一：**只认字符串字面量** ⇒ `FS = { tag: 12, … }`、`LH = { tight: 1.6, … }`
 *     全是**数字**，一个也解不出 ⇒ 表为空 ⇒ 循环不跑 ⇒ **报"0 项同值 ✓"**。
 *     那是**假绿** —— 判据在这个字段上等于没跑，却长得像通过了。
 *     ⇒ 教训（与全仓同族）：**"只测该过的能过"是假绿**。
 *       凡是"遍历一个集合然后断言全过"的判据，**必须同时断言集合非空**。
 *
 *   缺陷二：**要求 `} as const` 结尾** ⇒ `TONE_BG` 的写法是
 *     `Record<VerdictTone, string> = { … }`（带类型注解，无 `as const`）⇒ 解不出。
 *     ⇒ 放宽为：`= { … }` + 可选的 `as const`（类型注解在 `=` 之前，不影响）。
 *
 * ★ 也接受数字字面量（含小数、负数）—— 主题令牌既有色值（字符串）也有刻度（数字）。
 */
function literalsOf(src, constName) {
  const re = new RegExp(`export\\s+const\\s+${constName}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\}\\s*(?:as const)?`)
  const m = src.match(re)
  if (m === null) return null
  const out = new Map()
  for (const line of m[1].split('\n')) {
    // 跳过注释行（`// …`）—— 注释里可能带冒号，会污染解析
    const code = line.replace(/\/\/.*$/, '')
    const kv = code.match(/^\s*([A-Za-z0-9_]+)\s*:\s*('([^']*)'|-?[0-9]+(?:\.[0-9]+)?)\s*,?/)
    if (kv !== null) out.set(kv[1], kv[3] !== undefined ? kv[3] : kv[2])
  }
  return out
}

/** 比对一张表（场地为基准，bText 是"临时副本"侧 —— 智囊团或工位）；返回两侧的键集合，供"多出的令牌"提示 */
function compare(label, constName, bText, bLabel) {
  console.log(`── ${label}（\`${constName}\`）──`)
  const a = literalsOf(plat, constName)
  const b = literalsOf(bText, constName)
  if (a === null) {
    say(false, `场地侧找不到 ${constName}（或它不是字面量表）`)
    return
  }
  if (b === null) {
    say(false, `${bLabel}侧找不到 ${constName}（或它不是字面量表）`)
    return
  }
  /* ★★ 非空断言 —— 见 literalsOf 注释"缺陷一"。**没有这一条，本函数会假绿。** */
  if (a.size === 0) {
    say(false, `场地侧 \`${constName}\` 解出 **0 项** \u21d0 解析失败（不是"都一致"）`)
    return
  }
  let diff = 0
  for (const [k, v] of a) {
    if (!b.has(k)) {
      say(false, `${bLabel}缺键 \`${k}\`（场地侧 = '${v}'）`)
      diff++
    } else if (b.get(k) !== v) {
      say(false, `\`${k}\` 不一致：场地='${v}' ${bLabel}='${b.get(k)}'`)
      diff++
    }
  }
  if (diff === 0) {
    say(true, `${a.size} 项逐字同值（${[...a.keys()].join(', ')}）`)
  }
  const extra = [...b.keys()].filter((k) => !a.has(k))
  if (extra.length > 0) {
    console.log(`    （提示：${bLabel}多出 ${extra.length} 项，不参与比对：${extra.join(', ')}）`)
  }
}

console.log('── 智囊团 ↔ 场地 ──')
compare('A. 中性色阶', 'C', wis, '智囊团')
compare('B. 字号阶梯', 'FS', wis, '智囊团')
compare('C. 行高', 'LH', wis, '智囊团')
compare('D. 判定色', 'TONE_BG', wis, '智囊团')

/* ★ 2026-10-10 加：工位 theme 也是平台的"临时副本"（并排同一侧边栏）⇒ 同样逐字比对 */
console.log('\n── 工位 ↔ 场地 ──')
compare('A. 中性色阶', 'C', ws, '工位')
compare('B. 字号阶梯', 'FS', ws, '工位')
compare('C. 行高', 'LH', ws, '工位')
compare('D. 判定色', 'TONE_BG', ws, '工位')

/* ── E. FONT.mono（嵌套一层，单独解） ── */
console.log('── E. 等宽字体（`FONT.mono`）──')
const monoOf = (src) => src.match(/mono\s*:\s*'([^']+)'/)?.[1]
const mA = monoOf(plat)
const mB = monoOf(wis)
const mW = monoOf(ws)
say(mA !== undefined && mB !== undefined && mA === mB, `智囊团 等宽字体同值${mA === mB ? '' : `（场地='${mA}' 智囊团='${mB}'）`}`)
say(mA !== undefined && mW !== undefined && mA === mW, `工位 等宽字体同值${mA === mW ? '' : `（场地='${mA}' 工位='${mW}'）`}`)

/* ── F. 临时副本标记必须在（否则它就不再是"临时"，而是无人认领的第二出处） ── */
console.log('── F. \u2605 智囊团/工位 `theme.ts` 必须标着"临时副本" ──')
/* ★ 2026-10-10 扩：工位 theme 也是"临时副本"，同样要标 + 要写退出条件。
   两侧一视同仁 —— 只盯智囊团会漏掉第二个无人认领的出处。 */
for (const [label, text] of [
  ['智囊团', wis],
  ['工位', ws],
]) {
  const marked = text.includes('临时副本')
  say(marked, marked ? `${label}：已标"临时副本"（含退出条件）` : `${label}：缺少"临时副本"标记 \u21d0 这是无人认领的第二出处`)
  // 退出条件也要在（"临时"没有退出条件 = 永久的另一种说法）
  const hasExit = text.includes('退出条件') || text.includes('选项 3')
  say(hasExit, hasExit ? `${label}：写明了退出条件（Q5 裁定后删除本文件）` : `${label}：缺少退出条件 \u21d0 "临时"会变成"永久"`)
}

/* ══════════════════════════════════════════════════════════════════
   ★★ G. 阴面对照 —— 证明本判据**真的会 FAIL**（自证不是假绿）
   ══════════════════════════════════════════════════════════════════

   为什么要自带这一组：本文件第一版就在 `FS`/`LH` 上**假绿**过
   （解出 0 项却报"0 项同值 ✓"）。那次教训的直接推论是：

   > **凡"遍历集合断言全过"的判据，都要有一条"喂它一个必错的样本"**，
   > 才谈得上"这个判据在跑"。

   ⇒ 这里用**内存里的假样本**（不动磁盘）跑三次比对函数，必须**全部判 FAIL**：

     G1 改一个值（`FS.tag` 12 → 13）⇒ 必须被抓住
     G2 删一个键（智囊团少 `LH.loose`）⇒ 必须被抓住
     G3 空表（解析出 0 项）⇒ 必须被抓住（**这条就是第一版假绿的那个洞**）

   ★ 这三条**不依赖磁盘上的 theme.ts 内容**，所以它们**不会因为将来改了令牌而失效**。
 */
console.log('\n── G. \u2605 阴面对照：本判据真的会 FAIL 吗（自证不是假绿）──')

/** 一次"纯比对"，返回是否**存在问题**（true = 应该 FAIL） */
function diffDetects(aText, bText, constName) {
  const a = literalsOf(aText, constName)
  const b = literalsOf(bText, constName)
  if (a === null || b === null) return true // 解不出 = 问题
  if (a.size === 0) return true // ★ 空表 = 问题（第一版就漏在这里）
  for (const [k, v] of a) {
    if (!b.has(k) || b.get(k) !== v) return true
  }
  return false
}

const FAKE_A = `export const T = {\n  a: 1,\n  b: 'x',\n} as const`
const FAKE_B_OK = `export const T = {\n  a: 1,\n  b: 'x',\n} as const`
const FAKE_B_VAL = `export const T = {\n  a: 2,\n  b: 'x',\n} as const`
const FAKE_B_MISS = `export const T = {\n  a: 1,\n} as const`
const FAKE_B_EMPTY = `export const T = {\n} as const`

// 先证明"对的样本能过"（否则下面的 FAIL 可能是"一律 FAIL"的假象）
say(!diffDetects(FAKE_A, FAKE_B_OK, 'T'), 'G0 对照基准：两表相同 ⇒ 判**过**（证明它不是一个"一律 FAIL"的假判据）')
say(diffDetects(FAKE_A, FAKE_B_VAL, 'T'), 'G1 改一个值 \u21d2 判 **FAIL**（值比对真的在看）')
say(diffDetects(FAKE_A, FAKE_B_MISS, 'T'), 'G2 少一个键 \u21d2 判 **FAIL**（键集合真的在比）')
say(diffDetects(FAKE_A, FAKE_B_EMPTY, 'T'), 'G3 \u2605 表为空 \u21d2 判 **FAIL**（**第一版假绿的那个洞**，已堵）')

console.log(`\n${failed === 0 ? '全过 \u2713' : `有 ${failed} 条 FAIL \u2717`}`)
if (failed === 0) {
  console.log(
    `\n★ 本判据能过 \u2260 临时副本是对的 —— 它只保证**当前一致**。\n` +
      `  正解是把令牌下沉 `+"`@shanhai/kaipu-contract`"+`（041 Q5 选项 3），届时本判据可删。\n`,
  )
} else {
  console.log('')
}
process.exit(failed === 0 ? 0 : 1)
