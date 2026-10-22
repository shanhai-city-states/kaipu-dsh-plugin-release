#!/usr/bin/env node
/**
 * 山海·开铺 · **探针段体检**（`check-probe-sections.mjs`）
 * =====================================================================
 * ★★ 它看护的不是产品，是**判据自己**。
 *
 * 起因（2026-10-08 · 古茶拍板稿 §七 点名沉淀的那一条）：
 *   探针 ⑥ 段原来叫「**窄容器**：左栏折叠」，实际只断过一句
 *   「宽布局下左栏存在（aside × N）」—— 那是**宽屏**读数。
 *   ⇒ 它的段名**承诺了一件它从没验过的事**。而真正该守的东西
 *     （窄屏下还能不能挑场景）**从来没人断过** —— 097 评估是靠**手工实测**
 *     才发现那个缺口的，判据根本没覆盖到。
 *
 *   古茶给的判句：**「探针的段名，必须对应真实验证。名字比事实大，就是假绿。」**
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 为什么"名字比事实大"要靠工具看，不能靠自觉
 * ══════════════════════════════════════════════════════════════════
 *   它和"不会失败的断言"是**同一族**，但更难发现：
 *     · 不会失败的断言 ⇒ 至少还能看到它在那儿（只是永远绿）；
 *     · 段名比事实大   ⇒ **连看都看不到** —— 段名印在日志上，
 *        读日志的人只会以为"这一段验过了"，而里面可能一条断言都没有，
 *        或者断的根本是另一件事。**它冒领的是"已覆盖"三个字。**
 *   ⇒ 自觉是靠不住的（本人就是写它的人，写完读了三遍没看出来）。
 *     能靠的只有：把"段 ↔ 断言"的对应关系**打出来给人看**，并把"空段"直接判红。
 *
 * ══════════════════════════════════════════════════════════════════
 * 判据（三条，都**能失败**）
 * ══════════════════════════════════════════════════════════════════
 *   A **每个段至少有一条 `say()`** —— 零断言的段 = 名字完全落空（最极端的一种）。
 *   B **段名不得含"未做实"的自述词** —— 段名/紧随其后的注释里出现
 *     「待补」「TODO」「暂时」「占位」等，说明这一段**自己承认**还没做实。留着它就得红。
 *   C **段与断言数配对打印** —— 不是判红项，是**给人眼过一遍**的清单：
 *     段名一句话承诺的事，靠段内那几条在守（人一眼能看出"这句承诺对得上吗"）。
 *
 * ★ 本工具**故意不做**的事：不检查断言"内容对不对" —— 那是读判据的人与写判据的人的事，
 *   工具查不了语义。它只查**结构上有没有落空**。这两件事别混：
 *   工具能保证的（每段都有断言）与不能保证的（那些断言是否真的在守段名承诺的事）
 *   必须**分开说**，否则又是一次"拿工具冒充判断"。
 *
 * 用法：node tools/check-probe-sections.mjs [--probe=<相对路径>]
 * 退出码：0 = 全过；1 = 有 FAIL
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const argv = process.argv.slice(2)
const flag = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit === undefined ? d : hit.slice(n.length + 3)
}
const PROBE = join(ROOT, flag('probe', 'tools/probe/run-view-probe.mjs'))

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${msg}`)
  if (!ok) failed++
}

if (!existsSync(PROBE)) {
  console.log(`\u2717 探针文件不在：${PROBE}`)
  process.exit(1)
}
const src = readFileSync(PROBE, 'utf8')
const lines = src.split(/\r?\n/u)

console.log('探针段体检（段名 ↔ 断言）\n')
console.log(`  · 文件：${flag('probe', 'tools/probe/run-view-probe.mjs')}（${lines.length} 行）\n`)

/**
 * 段头识别：`console.log('\n── <段名> ──')` 或 `console.log('\n── <段名>──')`。
 *
 * ★ 为什么不按注释里的 `/* ── N. xxx ── *\/` 识别：
 *   本项目两种写法都在用（有的段只有 console.log 那一行，注释在它下面），
 *   而**真正会被读日志的人看见的**是 `console.log` 打出来的那一行 ——
 *   要治"名字比事实大"，就该盯**读者实际看到的那一行**。
 */
const SECTION_RE = /console\.log\(\s*(?:'|"|`)\\n?──\s*([^─'"]+?)\s*──/

/**
 * `say()` 计数：只算**调用**，不算注释里提到 `say(` 的地方。
 * ★ 用"行内是否出现 say("且该行不是注释开头"来判 —— 简单但够用：
 *   本仓的注释块以 ` * ` / `//` 起，模板字符串里的注释同样如此。
 */
const isSayLine = (l) => {
  const t = l.trim()
  if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false
  return /(^|[^A-Za-z_$.])say\(/u.test(l)
}

/** 各段：[{ name, line, says, nextLine }] */
const sections = []
for (let i = 0; i < lines.length; i++) {
  const m = SECTION_RE.exec(lines[i])
  if (m !== null) sections.push({ name: m[1], line: i + 1, says: 0, firstComment: '' })
}
if (sections.length === 0) {
  say(false, '一个段头都没找到 —— 段头写法变了？（本工具按 `console.log(\'\\n── X ──\')` 识别）')
  process.exit(1)
}
// 段内计数（末段到文件尾）
for (let s = 0; s < sections.length; s++) {
  const from = sections[s].line
  const to = s + 1 < sections.length ? sections[s + 1].line - 1 : lines.length
  let n = 0
  for (let i = from - 1; i < to; i++) if (isSayLine(lines[i])) n++
  sections[s].says = n
  // 段头之后紧邻的注释（用来查"自己承认没做实"的自述词）
  sections[s].firstComment = lines.slice(from - 1, Math.min(from - 1 + 12, to)).join('\n')
}

console.log('  ── 段 ↔ 断言数（人眼过一遍：段名那句承诺，靠这几条在守吗）──')
const pad = Math.max(...sections.map((s) => s.name.length))
for (const s of sections) {
  console.log(`    ${String(s.says).padStart(3)} 条 │ ${s.name.padEnd(pad)}  (L${s.line})`)
}
console.log('')

// ── A：每个段至少一条断言 ──
const empty = sections.filter((s) => s.says === 0)
say(
  empty.length === 0,
  empty.length === 0
    ? `A 每个段至少一条断言（${sections.length} 段，最少 ${Math.min(...sections.map((s) => s.says))} 条）`
    : `A ★ 有 ${empty.length} 个段**一条断言都没有** —— 段名完全落空：${empty.map((s) => `「${s.name}」L${s.line}`).join(' / ')}`,
)

// ── B：段名/段头注释不得带"未做实"的自述词 ──
const WEAK_WORDS = ['待补', 'TODO', '待做', '暂时不', '占位段', '未做实', '以后再', 'FIXME']
const weak = []
for (const s of sections) {
  const hit = WEAK_WORDS.find((w) => s.name.includes(w) || s.firstComment.includes(w))
  if (hit !== undefined) weak.push(`「${s.name}」L${s.line}（含「${hit}」）`)
}
say(
  weak.length === 0,
  weak.length === 0
    ? 'B 段名与段头注释里没有"自己承认还没做实"的自述词'
    : `B ★ 段自己承认没做实：${weak.join(' / ')} —— 要么补上，要么把段名改小到与事实相符`,
)

// ── C（提示项，不判红）：全局断言总数与段均 ──
const total = sections.reduce((a, s) => a + s.says, 0)
console.log(
  `\n  · 本文件 \`say()\` 调用 ${total} 处 · ${sections.length} 段 · 段均 ${(total / sections.length).toFixed(1)} 条`
    + '（★ 只报数，不判好坏：**段均高不代表判得好**，可能只是把一句话拆成了三条）',
)

console.log(
  `\n${failed === 0
    ? '✓ 段体检通过 —— 每一段都真的有断言在守（★ 但"断言内容对不对"本工具查不了，仍要人读）'
    : `✗ ${failed} 项未过`}`,
)
process.exit(failed === 0 ? 0 : 1)
