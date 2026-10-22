#!/usr/bin/env node
/**
 * 山海·开铺 · 解耦断言（A-1 / A-2 / INV-17 的**静态证据**）
 * =====================================================================
 * 断言四件事：
 *   ① `plugin-platform` **不依赖** `plugin-wisdom` / `plugin-workstation`
 *   ② `plugin-wisdom` **不依赖** `plugin-platform` / `plugin-workstation`
 *   ③ 三包的 client half **互不 import**（只通过契约包通信，A-2）
 *   ④ `plugin-workstation` **不依赖** `plugin-platform` / `plugin-wisdom`（可被独立摘除）
 *
 * ★ 为什么要在**建仓期**就把它做成可执行的断言：
 *   这两条一旦破，是**渐进式破的** —— 某天为了图快 `import` 一下就破了，
 *   而症状要等到"客户只想装场地插件却装不上/白屏"时才暴露。
 *   到那时已经改不回去了。**现在钉死，成本为零。**
 *
 * 依据：001-A A-1 / A-2 / A-3；INV-17；AC-26（停用内置智囊团，场地仍启动）
 *
 * 用法：node tools/check-decoupling.mjs
 * 退出码：0 = 通过；1 = 有违反
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const PLATFORM = 'packages/plugin-platform'
const WISDOM = 'packages/plugin-wisdom'
const WORKSTATION = 'packages/plugin-workstation'
const PLATFORM_PKG = '@shanhai/kaipu-platform'
const WISDOM_PKG = '@shanhai/kaipu-wisdom-team'
const WORKSTATION_PKG = '@shanhai/kaipu-workstation'

const violations = []
const passes = []

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

/* ① / ② package.json 依赖检查 */
for (const [dir, selfName, otherName] of [
  [PLATFORM, PLATFORM_PKG, WISDOM_PKG],
  [WISDOM, WISDOM_PKG, PLATFORM_PKG],
  // ★ 2026-10-10 加：工位包 —— 平台/智囊团都不许依赖它（摘掉它场地仍完整）
  [PLATFORM, PLATFORM_PKG, WORKSTATION_PKG],
  [WISDOM, WISDOM_PKG, WORKSTATION_PKG],
  // ★ 工位包自己也不许依赖平台/智囊团（只走契约）
  [WORKSTATION, WORKSTATION_PKG, PLATFORM_PKG],
  [WORKSTATION, WORKSTATION_PKG, WISDOM_PKG],
]) {
  const pkgPath = join(ROOT, dir, 'package.json')
  if (!existsSync(pkgPath)) {
    violations.push(`缺少 ${dir}/package.json`)
    continue
  }
  const pkg = readJson(pkgPath)
  const buckets = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
  let hit = false
  for (const b of buckets) {
    if (pkg[b] !== undefined && pkg[b][otherName] !== undefined) {
      violations.push(`${dir}/package.json 的 ${b} 依赖了 ${otherName}（违反 A-1/A-2）`)
      hit = true
    }
  }
  if (!hit) passes.push(`${selfName} 未依赖 ${otherName}`)
}

/* ③ client half 源码互相 import 检查 */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'lib') continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const pairs = [
  [PLATFORM, WISDOM_PKG, 'plugin-wisdom'],
  [WISDOM, PLATFORM_PKG, 'plugin-platform'],
  // ★ 2026-10-10 加：工位包（A-2 同族 —— 只走契约，不 import 别的插件）
  [PLATFORM, WORKSTATION_PKG, 'plugin-workstation'],
  [WISDOM, WORKSTATION_PKG, 'plugin-workstation'],
  [WORKSTATION, PLATFORM_PKG, 'plugin-platform'],
  [WORKSTATION, WISDOM_PKG, 'plugin-wisdom'],
]
for (const [dir, otherPkg, otherShort] of pairs) {
  const files = walk(join(ROOT, dir, 'src')).filter((f) => /\.(ts|tsx|mts|cts)$/.test(f))
  let hit = false
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    // 只查真实的 import/require 语句，避免注释里提到就被误判
    const re = new RegExp(`(from\\s+['"]${otherPkg}[^'"]*['"]|require\\(\\s*['"]${otherPkg})`)
    const reRel = new RegExp(`from\\s+['"][^'"]*${otherShort}[^'"]*['"]`)
    if (re.test(text) || reRel.test(text)) {
      violations.push(`${relative(ROOT, f).replace(/\\/g, '/')} import 了 ${otherShort}（违反 A-2）`)
      hit = true
    }
  }
  if (!hit) passes.push(`${relative(ROOT, dir)} 的 client/host 源码未 import ${otherShort}`)
}

/* ④ patch 层独立性：每段 insert 必须在各自文件里、且**只看 YAML 内容**（不看注释） */
const pf = join(ROOT, PLATFORM, 'cordis.patch.yml')
const wf = join(ROOT, WISDOM, 'cordis.patch.yml')
const kf = join(ROOT, WORKSTATION, 'cordis.patch.yml')
if (existsSync(pf) && existsSync(wf) && existsSync(kf)) {
  /**
   * ★★ 2026-10-10 修正 —— **本判据当场假红过一次**，原委写在这里：
   *   原来直接对**整个文件**做 `includes('kaipu-wisdom')` 之类的子串匹配 ⇒
   *   工位 `cordis.patch.yml` **注释里**那句「与开铺(shanhai-kaipu) / 凉亭
   *   (shanhai-kaipu-wisdom) 同前缀」当场被判成「引用了其它插件」⇒ **假红**。
   *   ⇒ 病根：判据把**说明文字**当成了**内容**。
   *   ⇒ 修法：先剥掉 YAML 注释（整行 `#…` 与行内 ` #…`），再对**内容**匹配。
   *   ★ 教训与全仓同族：**"X 必须 0 命中"这类断言，先要问"匹配面里有没有本来就该
   *     出现 X 的合法场合"**（此处 = 注释里讲命名约定）。否则判据会为了"绿"逼人
   *     把注释写残 —— 那是**判据在驱逐信息**，比假红更坏。
   */
  const stripYamlComments = (s) =>
    s
      .split('\n')
      .map((l) => l.replace(/\s+#.*$/, '')) // 行内注释
      .filter((l) => !/^\s*#/.test(l)) // 整行注释
      .join('\n')
  const SELF = {
    [PLATFORM]: 'kaipu-platform',
    [WISDOM]: 'kaipu-wisdom',
    [WORKSTATION]: 'kaipu-workstation',
  }
  // 各自的 patch 段只写自己，不写别人（否则摘一段会牵动另一段）；**三份各判一次**，不短路
  for (const [file, dir] of [
    [pf, PLATFORM],
    [wf, WISDOM],
    [kf, WORKSTATION],
  ]) {
    const body = stripYamlComments(readFileSync(file, 'utf8'))
    const others = Object.values(SELF).filter((tok) => tok !== SELF[dir])
    const hit = others.filter((tok) => body.includes(tok))
    if (hit.length > 0) {
      violations.push(`${dir}/cordis.patch.yml 里出现了其它插件（${hit.join(', ')}）—— 应各自独立`)
    } else {
      passes.push(`${dir}/cordis.patch.yml 只写自己（${SELF[dir]}）`)
    }
  }
} else {
  violations.push('缺少 cordis.patch.yml')
}

const out = []
out.push('解耦断言（A-1 / A-2 / INV-17 静态证据）')
for (const p of passes) out.push(`  ✓ ${p}`)
for (const v of violations) out.push(`  ✗ ${v}`)
out.push('')
out.push(violations.length === 0
  ? '✓ 通过：智囊团/工位均可被独立摘除，三个插件互不依赖'
  : `✗ 不通过：${violations.length} 处违反`)
console.log(out.join('\n'))

process.exit(violations.length === 0 ? 0 : 1)
