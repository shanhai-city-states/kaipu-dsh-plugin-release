#!/usr/bin/env node
/**
 * 山海·开铺 · 工具语法自检（★ 为一条**反复踩**的坑立的判据）
 * =====================================================================
 * 为什么需要它：
 *   本仓的探针与验收脚本大量使用**模板字符串里嵌一段浏览器侧 JS** 的写法，例如
 *     await ev(`(() => { … window.__kaipuProbe = { async open() { … } } … })()`)
 *   在那种"里层 JS"的注释里写一个**反引号**，就会**提前终止外层模板字符串** ⇒
 *   整个文件 SyntaxError。
 *
 *   ★ 这条坑我 2026-10-05 一天之内**踩了三次**（run-view-probe 两次、copy-probe 一次），
 *     而且每次的症状都是**工具在导入阶段就崩**（`SyntaxError: missing ) after argument list`），
 *     看起来像"探针逻辑坏了"，实际是**文件根本没被解析**。
 *     —— 靠"下次注意"显然不管用，所以立成判据。
 *
 * 判据：对 tools 与 dev 下所有 .mjs 逐个跑 `node --check`，
 *       **任何一个不过就 FAIL**。
 *   ★ 这是"语法"级检查（最便宜、最确定的那一层），不替代行为判据。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 判据二（2026-10-08 加）：**精确指出"模板内的注释里写了反引号"是哪一行**
 * ══════════════════════════════════════════════════════════════════
 * 起因：那条坑**又踩了三次**（2026-10-05 三次、2026-10-08 三次，中间还有若干次）。
 *   每次症状都一样：`node` 报的 `missing ) after argument list` **飘到一两百行之外**，
 *   定位是错的 —— 于是"改一处、跑一次、还报同一行、再猜"来回好几轮。
 *
 * ⇒ 两种能力缺一不可（`--check` 一条都不缺，但**它给的定位是错的**）：
 *   ① `--check` 判"整份文件合不合法"；
 *   ② **本扫描**判"哪一行是元凶" —— 直接给行号与那一行原文。
 *
 * ★★ 为什么它**独立于 `--check` 也要跑**（不是重复劳动）：
 *   "模板被提前终止"**可能恰好还解析得过去**（后面的内容又被当成新代码）
 *   ⇒ 语法全绿、而**语义已经错了**（那段"注释"其实是执行不到的字符串片段）。
 *   这种静默版本比报错版本危险得多 —— 所以扫描与 `--check` 是**两条独立的判据**。
 *
 * ★★ 为什么它**只在"文件语法确实不过"时才跑**（2026-10-08 实测后收窄的口径）：
 *   第一版对**所有**文件扫，结果在**语法全绿**的文件上报出 3 处 —— 全是**误报**
 *   （真身是"正则字面量里的反引号"：`/(?:'|"|`)/` 这种写法，反引号在字符类里是普通字符，
 *     但按"奇偶计数"会被算成模板边界 ⇒ 状态从此错位）。
 *   ⇒ 与其做一个"识别正则字面量"的近似解析器（JS 的经典难点，越修越脆），
 *     不如**收窄触发条件**：**只在 `--check` 已经判它不过时**，才用它来**定位那一行**。
 *     这时它的输出是"嫌疑人清单"（可能 1~3 个候选），人一眼就能认出真凶。
 *   ★★ 代价如实写明：**"模板被提前终止、却恰好还解析得过去"的情形它报不出来**
 *      （那种情况语法全绿、本工具只报全绿）。那一半仍要靠人读代码。
 *      —— 宁可**明确知道哪里没覆盖**，也不要一个会误报的工具（误报多了就会被无视）。
 *
 * ★ 能失败：造一个"模板内注释带反引号"的坏文件 ⇒ 当场报出那一行（工具自带自证，见末尾注释）。
 * ★ 它**查不到**的：块注释里写了「注释结束符」（判据二之外那半）—— 那仍靠 `--check` 兜底。
 *   如实写在这里，不假称"两种都精确覆盖了"。
 *   ⚠️⚠️ **写下这一行的过程本身就是那个坑**：第一版我真把那个两字符序列写进了这段块注释里，
 *     于是**注释当场提前结束**、文件语法不过 —— 而这里正是讲这件事的地方。
 *     ⇒ 所以现在这行只能写「注释结束符」这几个字。
 *
 * ★★ 为什么把 `dev/` 也算进来（2026-10-05 补）：
 *   **出收益数字的量测脚本在 dev/ 里** —— 而它们原先**不被任何判据覆盖**。
 *   于是"注释里写了反引号"这种错，会在**量完、数字都写进报告之后**才被撞见
 *   （原话：那一天同一个错连踩 5 次，其中 1 次就是在改量测脚本时）。
 *   `dev/` 在 `.gitignore` 里（本地临时目录）⇒ 别人克隆的仓可能没有 ⇒ **不存在就跳过**。
 *
 * 用法：node tools/check-tools-syntax.mjs
 * 退出码：0 = 全过；1 = 有文件语法不过 / 有"模板内注释带反引号"
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 递归收集 .mjs（含子目录）。★ 单个条目坏掉只跳它，**不吞掉整个目录** */
function collect(dir) {
  const out = []
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) out.push(...collect(full))
    else if (name.endsWith('.mjs')) out.push(full)
  }
  return out
}

/**
 * 扫描范围。
 *   · `tools/` —— **递归**（判据在 tools/probe/ 等子目录里）
 *   · `dev/`   —— ★ **只扫顶层**
 *
 * ★★ 为什么 dev/ 不递归（2026-10-05 踩出来）：
 *   `dev/` 同时装着**脚本**与**运行时数据**（DSH HOME、浏览器 profile…）。
 *   递归进去不仅慢，而且会**在任何一层坏文件上抛异常** —— 上一层若用 try 包住整次
 *   `collect()`，就会**静默吞掉整个 dev/**：判据照报"全绿"，而它**根本没扫**。
 *   实测症状：tools 23 个 + dev 6 个，报告却写"23 个文件" ⇒ 少了一整个目录**没有任何提示**。
 *   ⇒ 一是只扫顶层，二是**把每个范围的计数打出来**（少扫了要看得见）。
 */
function collectAll() {
  const out = []
  try {
    out.push(...collect(join(ROOT, 'tools')))
  } catch {
    // tools/ 一定在；真出错也不该静默 —— 计数会把异常暴露出来
  }
  try {
    for (const name of readdirSync(join(ROOT, 'dev'))) {
      if (name.endsWith('.mjs')) out.push(join(ROOT, 'dev', name))
    }
  } catch {
    // dev/ 不存在 = 正常（它不进仓）
  }
  return out.sort()
}

const files = collectAll()
const inTools = files.filter((f) => relative(ROOT, f).replace(/\\/g, '/').startsWith('tools/')).length
const inDev = files.length - inTools
const bad = []
for (const f of files) {
  // ★ `process.execPath` = 正在跑本脚本的那个 node（不必假设 node 在 PATH 上）
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) {
    const first = String(r.stderr ?? '').split('\n').find((l) => l.includes('SyntaxError')) ?? '(无 SyntaxError 行)'
    bad.push({ f: relative(ROOT, f).replace(/\\/g, '/'), first: first.trim() })
  }
}

console.log(`工具语法自检 · ${files.length} 个 .mjs 文件（tools ${inTools} + dev ${inDev}）`)

/* ══ 判据二：模板字符串**内部**的注释里有没有反引号（那个真正的元凶在哪一行）════════
 *
 * 做法：逐行扫，用"**未转义反引号的奇偶**"维护一个近似的"是否在模板内"状态；
 *   若某行**在模板内**、**长得像注释**（`//` / `*` / `/*` 开头）、**且含反引号** ⇒ 就是它。
 *
 * ★ 为什么用"奇偶计数"这种近似而不是真解析器：
 *   本仓零依赖（不引 acorn），而这里要的不是"精确的语法树"，是**行级定位给人看**。
 *   近似状态在本仓的写法下够准（外层代码里的反引号总是成对出现在同一行，
 *   或者成对跨行出现 ⇒ 奇偶翻转正确）；而**误报**只会发生在"模板内的注释里真写了反引号"
 *   这件事本身 —— 那正是要报的。
 * ★ 它**能失败**：把任意一处模板内注释里的词加上反引号 ⇒ 行号当场被打印出来。
 */
const tickHits = []
const scanTemplateComments = (text, file) => {
  const lines = text.split(/\r?\n/u)
  let inTemplate = false
  const countTicks = (s) => {
    let n = 0
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\') { i++; continue }   // 跳过被转义的字符（\` 不算边界）
      if (s[i] === '`') n++
    }
    return n
  }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const t = raw.trim()
    const ticks = countTicks(raw)
    const looksComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
    if (inTemplate && looksComment && ticks > 0) {
      tickHits.push({ file: file, line: i + 1, text: t.slice(0, 96) })
    }
    if (ticks % 2 === 1) inTemplate = !inTemplate
  }
}
for (const b of bad) {
  try {
    scanTemplateComments(readFileSync(join(ROOT, b.f), 'utf8'), b.f)
  } catch {
    // 读不到就跳过（判据一那边已经报了）
  }
}

if (bad.length === 0 && tickHits.length === 0) {
  console.log('✓ 全绿')
  process.exit(0)
}
if (bad.length > 0) {
  console.log(`✗ ${bad.length} 个文件语法不过：`)
  for (const b of bad) console.log(`   ${b.f}\n     ${b.first}`)
}
if (tickHits.length > 0) {
  console.log(`\n★ 判据二：上面那个文件里，**最可能是元凶的行**（模板字符串内部的注释里写了反引号）：`)
  for (const h of tickHits) console.log(`   ${h.file}:${h.line}｜${h.text}`)
  console.log('   ⇒ 改法：把那段注释里的反引号去掉（改用「」或直接写词），或把它挪到模板字符串**外面**。')
  console.log('   ★ 它们是**嫌疑人**（按"反引号奇偶"定位的近似结果，可能不止一个）：')
  console.log('     判据一报的那一行**通常不是**元凶 —— 元凶总在它**前面**，这就是本判据存在的理由。')
}
console.log('\n★ 背景（本仓 2026-10-05 / 10-08 各踩三次）—— 都是"注释里的字符提前终止了外层容器"：')
console.log('  ① **模板字符串里嵌 JS 时，那段注释里写了反引号** ⇒ 提前终止模板字符串。')
console.log('     （★ 上面判据二就是为它做的：直接给行号，不必再靠飘出去的 SyntaxError 猜）')
console.log('  ② **块注释/JSDoc 里出现了 `*/`** ⇒ 注释提前结束，后面的字变成代码。')
console.log('     典型：想写 glob 就写了 `tools/**/*.mjs` —— 那个 `**/` 就是注释结束符。')
console.log('     ⚠️ 判据二**不覆盖**这一半，仍靠 `node --check` 兜底（如实写明，不假称都精确覆盖了）。')
process.exit(1)
