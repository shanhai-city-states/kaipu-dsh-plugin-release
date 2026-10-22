#!/usr/bin/env node
/**
 * 宿主内部细节自检 —— 发布面的**注释里**不得出现「宿主源码路径 / 宿主内部包名」。
 * =====================================================================
 *
 * 起因（工坊 `083-reply-071-snapshot-review-and-grayzone-v1-20261007.md` §二）：
 *
 *   我方在 071 里主动报了一处"两套自动扫描都覆盖不到的灰区"（`Brand.tsx` 注释引用宿主内部），
 *   工坊裁定走「**二 · 要删**」，但只删一类，**理由比我方给的硬一层**：
 *
 *     > 要删的理由不是「消毒口径不区分谁的内部」—— **是「这不是我们的东西」**。
 *     > 我们开源，讲的是**「我们怎么做的」**（`Brand.tsx` 那条「零宿主改动」的论证是对的、要留）；
 *     > 引用**宿主源码路径 / 官方插件的内部包名**，讲的是**「它内部长什么样」**。
 *     > 后者不是我们的资产，**我们也无权替宿主公开它的实现细节**。
 *
 *   ★ 并且工坊**独立发现了我方漏掉的第 4 处**
 *     （`src/remote/dsh-typert.d.ts:11` 的 `deepseek-harness/packages/typert/protocol/src/index.ts`）
 *     ⇒ 并建议：**加一条扫描，别靠人眼。**
 *     我方采纳 —— 这个文件就是那条扫描。**"下次要靠人眼"本身就是缺陷。**
 *
 * ── 三类边界（工坊 §2.2 原表，逐条落成代码）────────────────────────────
 *
 *   | 类 | 例 | 处置 |
 *   |:--|:--|:--|
 *   | **A · 依赖声明** | `package.json` 的 peerDependencies / `import` 语句里的 `@deepseek-ai/dsh-*` | ✅ **保留**（安装契约，删了装不上）|
 *   | **B · 注释里的宿主内部细节** | 注释里写宿主**源码路径** / **官方插件的内部包名** | ❌ **删**（改中性表述）|
 *   | **C · 宿主公开 API / 运行时可见事实** | `sidebar.brand.name`（公开座位 API）· `.brandName` 字号 `18px/600`（DevTools 可见）| ✅ **保留** |
 *
 *   ⇒ 所以本扫描**只扫注释行**（B 类）—— 不扫 import 语句与 package.json（A 类），
 *     也不把"座位名 / 字号"当内部细节（C 类）。
 *
 * ── ★★ warn 级的处置已裁定（2026-10-07 · 工坊 `083-reply-073-…` §四）────────
 *
 *   **本扫描有两个级别**：`fail` = 宿主**源码路径**（铁定要删）；
 *   `warn` = 注释里**未在本包 `package.json` 声明**的 `@deepseek-ai/<包名>`（**请人判**）。
 *
 *   我方把 warn 5 条清单交上去请裁定，工坊**逐条判了**，结论分两种：
 *
 *   | 情形 | 裁定 | 理由（工坊原话的意思） |
 *   |:--|:--|:--|
 *   | 「这几个包是 monorepo 内部包、**不发布到 npm**」 | ✅ **保留** | ① 不讲清就无法解释"为什么手写类型"；② **任何人看 npm 都能量到的公开事实** —— 它是**关于世界的可核事实**，不是"它内部怎么实现" |
 *   | 「**宿主的运行时表里有哪些名字**」 | ⚠️ **收掉** | 那是**"宿主的运行时模块表长什么样"**，与灰区同族（**它的内部结构，不是我们的资产**）。可直接删清单或改述为「另有若干名称由宿主运行时提供」——**论证不弱** |
 *   | 其余 4 条（讲"我方要用哪个宿主服务 / 我方为什么这么做"） | ✅ **保留** | 与我方判断一致 |
 *
 *   ⇒ **已执行**：`client/host-modules.ts` 里那串运行时表清单**已删**（改为中性表述）。
 *     ⑤ 条 warn 因此**仍是 5 条**（删掉的是"清单"，不是包名）——
 *     ★ 别把 warn 数当成待办数：**它们已经判过了，结论是"保留"。**
 *     ★ 一句判别口径（工坊给的）：**「包不在 npm」可留（公开可核）；
 *       「宿主运行时表里有哪些」要收（它的内部结构）。**
 *
 * ★★ 为什么用**形态**而不是**清单**：
 *   如果写死"要抓 `Brand.tsx` 和 `dsh-typert.d.ts`"，那么第 5 处出现时照样漏 ——
 *   这正是本仓"**枚举式判据必然漏**"那条老账（工坊这轮**就是**靠这条抓到我方的）。
 *   ⇒ 这里锚的是**形态**：`以 / 或 _ 分隔的、含 src 的仓库内路径`、`宿主底座目录名`、
 *     `@deepseek-ai/` 前缀的包名（且**出现在注释里**）。
 *   ⚠️ 但"一改就过期"只是从清单层挪到正则层 ⇒ 所以**同时断"扫描面非空、且确实扫到了注释"**，
 *     否则扫描器一旦失效，它就变成一个恒绿的摆设。
 *
 * 用法：node tools/check-host-internals.mjs
 * 退出码：0 = 全绿；1 = 命中（附文件:行号 + 原文，便于直接改）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const asJson = process.argv.includes('--json')

/** 收集发布面源文件 = 三个包的 `src/**`（与 `g2-src-line-audit.mjs` 同口径） */
const collect = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else if (/\.(ts|tsx|d\.ts)$/.test(name)) out.push(p)
  }
  return out
}
const files = [
  ...collect(join(ROOT, 'packages/plugin-platform/src')),
  ...collect(join(ROOT, 'packages/plugin-wisdom/src')),
  ...collect(join(ROOT, 'packages/plugin-workstation/src')),
].sort()

/**
 * 判据分两级 —— 与 `check-wording.mjs` 同款（工坊 071-review §五.3 明确认可这个打法：
 *   「**过宽会误报，误报会逼人把判据改松；过窄会漏。** 两者同族：都没锚准要测的形态」）。
 *
 *   · `fail` —— **宿主源码路径**。这类是硬违规：
 *     它讲的一定是"**它内部长什么样**"，而我们无权替宿主公开实现细节。
 *   · `warn` —— **注释里未在本包 `package.json` 声明的 `@deepseek-ai/<pkg>`**。
 *     为什么降一级而不是直接判错：**"我们依赖哪个宿主服务"属于"我们怎么做的"**，
 *     是正当文档（工坊 A 类要留）。它只是"**可能**越界" ⇒ 列出来给人看，不改退出码。
 *     ★ 而"已声明的依赖"直接不列 —— 那是明确的 A 类。
 *     ★ 本轮（2026-10-07）在这个 warn 里**手工判掉**了 `@deepseek-ai/dsh-client-ui-brand-official`
 *       （工坊点名的"**官方插件的内部包名**"）；其余几条（宿主**服务**）**报工坊确认边界**。
 */
const SRC_PATH_PATTERNS = [
  {
    id: 'host-src-file',
    /**
     * **一条形态，替换掉原先三条**（2026-10-07 两次写窄后重写）：
     *   注释里出现「**含 `/src/` 的代码文件路径、且不属于本仓**」即命中。
     *
     * ★★ 为什么重写成这一条 —— 前两版都是**枚举式的窄式**，连漏两次，都是当场发现：
     *   ① 首版要求 `packages\/<一段>\/src\/` ⇒ 漏掉 `packages/client/ui-slots/src/index.ts`
     *      （`packages/` 与 `src/` 之间有两段）—— 而那**正是工坊点名要删的那一处**；
     *   ② 改宽后仍要求以 `packages|apps` 打头 ⇒ 又漏掉
     *      `dsh-client-connection/src/client/rpc.ts`（`run.ts:15`，压根没有 `packages/` 前缀）。
     *   ⇒ 两次都是"**正则过窄 ⇒ 静默漏报**"（绿着，你以为扫过了）。
     *     本仓老账「**枚举式判据必然漏**」在这里连中两次。
     *
     * ⇒ 现在的写法不再猜"宿主路径长什么样"，而是锚**最根本的共同点**：
     *   **它是一个"文件路径"，且它是别人的**（不在我们自己的仓目录下）。
     *   `host-src-file` = 命中形态；"是不是我们的"由 `OUR_PREFIXES` 判（下面）。
     */
    re: /((?:[A-Za-z0-9_.-]+\/)+src\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g,
    why: '**宿主源码文件路径** —— 讲的是"它内部长什么样"。这不是我们的资产，'
      + '我们无权替宿主公开实现细节（工坊 071-review §2.1）',
  },
  {
    id: 'host-repo-path',
    re: /((?:^|[^A-Za-z0-9_./-])deepseek-harness\/[A-Za-z0-9_./-]+)/g,
    why: '**宿主仓库内路径** —— 同上（含 `/src/` 的会被上一条命中，两条按行去重）',
  },
]

/**
 * **本仓自己的目录前缀** —— 命中这些的路径是「我们怎么做的」，属于正当文档，**不算内部细节**。
 * ★ 这是"是不是我们的东西"那条判据的**可执行形式**（工坊 071-review §2.1 的立意）。
 */
const OUR_PREFIXES = [
  'packages/plugin-platform/',
  'packages/plugin-wisdom/',
  'packages/plugin-workstation/',
  // ★ 2026-10-07 补：行文里常**省掉 `packages/` 前缀**（如 wisdom 的 theme.ts 写
  //   "必须与 `plugin-platform/src/client/theme.ts` 逐字相同"）。
  //   首版只认全前缀 ⇒ 把**我们自己的文件**判成了宿主内部细节（误报一处）。
  //   ⇒ 前缀表要按"人怎么写"来列，不按"路径规范怎么长"来列。
  'plugin-platform/',
  'plugin-wisdom/',
  'plugin-workstation/',
  'tools/',
  'docs/',
  'contracts/',
  'market/',
  'apps/',
  'out/',
  'dev/',
]
const isOurPath = (p) => OUR_PREFIXES.some((pre) => p.startsWith(pre))

/** 注释里的宿主官方包名 —— 只 warn，且排除「已声明的依赖」与「示例占位」 */
const PKG_NAME_RE = /@deepseek-ai\/([A-Za-z0-9_.-]+)/g
/** 明显的占位示例名（`xxx` / `dsh-xxx`）—— 它们不是真包名，属"我们怎么做的"叙述 */
const isPlaceholderPkg = (p) => /(?:^|-)x{2,}$/.test(p)

/** 注释行形态：`//` · `/* … *\/` 内部（以 `*` 开头）· `/**` 开头 */
const isCommentLine = (line) => /^\s*(?:\/\/|\/\*|\*)/.test(line)

/** 收集某个包 `package.json` 里声明的 deepseek 依赖（A 类，保留） */
const declaredDepsOf = (pkgDir) => {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, pkgDir, 'package.json'), 'utf8'))
    return new Set(
      Object.keys({ ...(j.dependencies ?? {}), ...(j.peerDependencies ?? {}), ...(j.devDependencies ?? {}) })
        .filter((k) => k.startsWith('@deepseek-ai/')),
    )
  } catch {
    return new Set()
  }
}

const hitsByLoc = new Map()
const warns = []
let scannedFiles = 0
let scannedCommentLines = 0

for (const abs of files) {
  scannedFiles++
  const rel = relative(ROOT, abs).replace(/\\/g, '/')
  // 文件属于哪个包（`packages/<name>/…`）
  const pkgDir = (rel.match(/^(packages\/[^/]+)\//) ?? [])[1] ?? ''
  const declared = declaredDepsOf(pkgDir)
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (!isCommentLine(line)) return
    scannedCommentLines++
    for (const p of SRC_PATH_PATTERNS) {
      p.re.lastIndex = 0
      let pm
      while ((pm = p.re.exec(line)) !== null) {
        const found = pm[1]
        if (isOurPath(found)) continue // 本仓路径 ⇒ 正当文档，不算内部细节
        // ★ 同一行可能被两条形态同时命中（如 `deepseek-harness/packages/x/src/y.ts` 既像
        //   "仓库路径"又像"源码路径"）⇒ **按 (文件,行) 去重**，否则一处违规被报两次，
        //   数字虚高会让人以为"有 6 处问题"其实只有 4 处 —— 判据的**输出也会写错**。
        const key = `${rel}:${String(i + 1)}`
        const prev = hitsByLoc.get(key)
        if (prev === undefined) {
          hitsByLoc.set(key, { file: rel, line: i + 1, ids: [p.id], found, why: p.why, text: line.trim().slice(0, 110) })
        } else {
          if (!prev.ids.includes(p.id)) prev.ids.push(p.id)
          // 只在"新的命中不是已有命中的子串"时追加（避免同一路径被两条形态重复打印）
          if (!prev.found.includes(found) && !found.includes(prev.found)) prev.found += ` ／ ${found}`
        }
      }
    }
    PKG_NAME_RE.lastIndex = 0
    let m
    while ((m = PKG_NAME_RE.exec(line)) !== null) {
      const name = m[1]
      if (isPlaceholderPkg(name)) continue
      if (declared.has(`@deepseek-ai/${name}`)) continue
      warns.push({
        file: rel, line: i + 1, id: 'host-pkg-name-undeclared',
        found: `@deepseek-ai/${name}`,
        why: '注释里的宿主包名，**未在本包 `package.json` 声明** —— 可能是正当的"我们依赖哪个宿主服务"，'
          + '也可能是在讲"它内部长什么样"（后者属 B 类，要中性化）。**请人判**',
        text: line.trim().slice(0, 110),
      })
    }
  })
}
const hits = [...hitsByLoc.values()]

// ★★ 自检：**扫描器自己也要被证明"在干活"**。
//   否则正则一失效，扫描面为空、命中为空 ⇒ 恒绿（本仓老账：判据说得比事实大）。
const selfChecks = [
  {
    // ★ 这个下限是**诚实的下限**，不是"目标"：实测扫描面 = 31 个源文件。
    //   取 25 是留一点余量（将来若删了源文件也不至于误红），但**远高于 0** ——
    //   它断的是"collect() 有没有真的把源文件收进来"，不是"文件够不够多"。
    //   ⚠️ 首版我随手写了 40 ⇒ 当场红。**判据里的数字要么有依据、要么别写**：
    //     随手写的期望值会让判据长期红，然后被人当噪声忽略（本仓另一条老账）。
    ok: scannedFiles >= 25,
    msg: `扫描面非空：${String(scannedFiles)} 个源文件（实测基线 31）`,
  },
  {
    ok: scannedCommentLines >= 500,
    msg: `确实读到了注释行：${String(scannedCommentLines)} 行（实测基线约 3000）`,
  },
]

if (asJson) {
  console.log(JSON.stringify({ scannedFiles, scannedCommentLines, hits, warns, selfChecks }, null, 2))
  process.exit(hits.length === 0 && selfChecks.every((c) => c.ok) ? 0 : 1)
}

console.log(`宿主内部细节自检 · 扫发布面注释 ${String(scannedFiles)} 个源文件 / ${String(scannedCommentLines)} 行注释`)
console.log(`fail 形态 ${String(SRC_PATH_PATTERNS.length)} 条（宿主源码路径）· warn 1 类（未声明的宿主包名）`)
console.log('边界：A 类依赖声明与 C 类公开 API/运行时可见事实**保留**（工坊 071-review §2.2）\n')

for (const c of selfChecks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.msg}`)
console.log('')

// ★ warn 先打印（**看得见**），再判 fail —— 与 check-wording 同一口径：
//   不能因为"不影响退出码"就把它藏起来。
if (warns.length > 0) {
  console.log(`⚠ warn 级 ${String(warns.length)} 处（**不判错**，列出来请人判是否属"讲它内部长什么样"）：\n`)
  for (const w of warns) {
    console.log(`  ${w.file}:${String(w.line)}`)
    console.log(`      ${w.text}`)
    console.log(`      ⇒ 命中「${w.found}」—— 未在本包 package.json 声明\n`)
  }
}

if (hits.length === 0) {
  console.log('✓ fail 级全绿：发布面的注释里没有宿主源码路径')
  process.exit(selfChecks.every((c) => c.ok) ? 0 : 1)
}

console.log(`✗ fail ${String(hits.length)} 处：\n`)
for (const h of hits) {
  console.log(`  ${h.file}:${String(h.line)}  [${h.ids.join(' + ')}]`)
  console.log(`      ${h.text}`)
  console.log(`      ⇒ 命中「${h.found}」`)
  console.log(`      ⇒ ${h.why}\n`)
}
process.exit(1)
