#!/usr/bin/env node
/**
 * 山海·开铺 · 分发断言（Step 2 判据 · 同时是 008 评审 留意1 的第 3 条）
 * =====================================================================
 * 断言"这个包**可以独自发出去**"—— 不是靠嘴，靠产物的静态事实。
 *
 * ── 为什么必须机器验 ──────────────────────────────────────────────
 *
 *   插件要**上 DSH 插件市场**。市场不会替你解决依赖树 ⇒
 *   产物里只要有任何一个"别人机器上不存在的 require"，客户装了就白屏。
 *   而这类问题的表现是**在客户机器上**、**点开面板才炸** ——
 *   最贵的一类故障。所以要在**自己的构建机上**就把它变成红灯。
 *
 * ── 断言清单 ──────────────────────────────────────────────────────
 *
 *   A1  host 产物存在（`lib/index.js`）
 *   A2  client bundle 存在（`exports["./client"].default` 指向的文件）
 *   A3  ★ **client bundle 里没有 `@shanhai/kaipu-contract`**
 *       ⇒ 契约已被内联 = **构建期依赖，零外部依赖**（根 README §二·补 留意1）
 *   A4  ★ **client bundle 的裸 require 全在宿主白名单内**
 *       ⇒ 运行时只会向宿主要它**一定**有的模块（PLATFORM_MODULES）
 *   A5  client bundle 是 closure-factory 形态（`window.__ModuleLoader__.load` + `id` + `factory`）
 *   A6  产物里**不含密钥形态 / agent_secret / 本机绝对路径**（CN-3 / CN-6）
 *   A7  `files` 字段覆盖 `lib/` 与 `cordis.patch.yml`（否则发出去的包缺件）
 *   A8  ★ **本包不 require 另一个插件**（A-2：两插件互不依赖）
 *
 * 用法：node tools/check-package.mjs
 * 退出码：0 = 通过；1 = 有 FAIL
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const PLUGINS = ['packages/plugin-platform', 'packages/plugin-wisdom', 'packages/plugin-workstation']

/** require 调用（与 `tools/build-client.mjs` 同一张正则 —— 判据与构造器必须同源） */
const REQUIRE_RE = /require\(\s*(['"])([^'"]+)\1\s*\)/g

/** 递归列出目录下的 .js */
function walkJs(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walkJs(p, out)
    else if (p.endsWith('.js')) out.push(p)
  }
  return out
}

/** 宿主一定会提供的模块（PLATFORM_MODULES 子集）—— 白名单之外一律不许 require */
const HOST_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** 不许出现在产物里的东西 */
const FORBIDDEN = [
  { re: /\bagent_secret\s*[:=]/, why: 'agent_secret 字段（CN-6 / 契约 #13）' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: '私钥材料（CN-3）' },
  { re: /\bsk-[A-Za-z0-9]{16,}/, why: '疑似模型 Key（CN-5）' },
  { re: /[A-Za-z]:[\\/](001-开发项目|WorkBuddyData|Users|dev)/, why: '本机绝对路径（换机器就断）' },
]

const fails = []
const passes = []

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

for (const dir of PLUGINS) {
  const abs = join(ROOT, dir)
  const pkgPath = join(abs, 'package.json')
  if (!existsSync(pkgPath)) {
    fails.push(`${dir}: 缺 package.json`)
    continue
  }
  const pkg = readJson(pkgPath)
  const other = PLUGINS.filter((d) => d !== dir).map((d) => readJson(join(ROOT, d, 'package.json')).name)
  const tag = `${pkg.name}`

  /* A1 host */
  const hostRel = typeof pkg.main === 'string' ? pkg.main : './lib/index.js'
  const hostAbs = join(abs, hostRel)
  if (existsSync(hostAbs) && statSync(hostAbs).size > 0) passes.push(`${tag} A1 host 产物存在（${relative(ROOT, hostAbs)}）`)
  else fails.push(`${tag} A1 缺 host 产物 ${hostRel}（先跑 node tools/build.mjs）`)
  const hostSrc = existsSync(hostAbs) ? readFileSync(hostAbs, 'utf8') : ''

  /* A2 client bundle */
  const cExport = pkg.exports?.['./client']
  const clientRel = typeof cExport === 'string' ? cExport : cExport?.default
  const clientAbs = typeof clientRel === 'string' ? join(abs, clientRel) : null
  if (clientAbs !== null && existsSync(clientAbs) && statSync(clientAbs).size > 0) {
    passes.push(`${tag} A2 client bundle 存在（${relative(ROOT, clientAbs)}）`)
  } else {
    fails.push(`${tag} A2 缺 client bundle（exports["./client"] = ${String(clientRel)}）`)
  }
  const clientSrc = clientAbs !== null && existsSync(clientAbs) ? readFileSync(clientAbs, 'utf8') : ''

  /*
   * A3 内部包已内联 —— ★★ 这是一个**正向**断言，不是"看某个字符串在不在"。
   *
   * 为什么改：老版本断言的是「产物里不出现 `@shanhai/kaipu-contract`」。
   * 但 2026-10-05 加了内联之后，产物里**必然**出现这个字符串（模块注释
   * `/* ── @shanhai/kaipu-contract/index.js ── *\/`）⇒ 老断言变成**假阳性**，
   * 把一件做对了的事报成失败。
   * 教训：「没有某个字符串」既可能因为做对了，也可能因为那串字挪了个地方 ——
   * 它证明不了因果关系。正向断言才证明得了。
   *
   * 现在的判据：**插件自身的产物若在运行时引用了内部包，bundle 里就必须含有它的内联模块。**
   * 两者一起看才是完整的：A3 管"内部包进来了"，A4 管"外部只剩宿主白名单"。
   */
  const ownRequiresInternal = new Set()
  for (const f of walkJs(join(abs, 'lib'))) {
    if (clientAbs !== null && f === clientAbs) continue // bundle 自己不算"插件自身产物"
    for (const m of readFileSync(f, 'utf8').matchAll(REQUIRE_RE)) {
      if (m[2].startsWith('@shanhai/')) ownRequiresInternal.add(m[2])
    }
  }
  if (ownRequiresInternal.size === 0) {
    passes.push(`${tag} A3 插件自身不引用内部包（无需内联）`)
  } else {
    const notInlined = [...ownRequiresInternal].filter((p) => !clientSrc.includes(`── ${p}/`))
    if (notInlined.length > 0) {
      fails.push(`${tag} A3 以下内部包被运行时引用却没进 bundle ⇒ 浏览器里会 require 到 undefined：${notInlined.join(', ')}（检查 tools/build-client.mjs §1b）`)
    } else {
      passes.push(`${tag} A3 内部包已内联进 bundle：${[...ownRequiresInternal].join(', ')}`)
    }
  }

  /* A4 裸 require 白名单 */
  const bare = new Set()
  for (const m of clientSrc.matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    const spec = m[2]
    if (!spec.startsWith('.') && !spec.startsWith('/')) bare.add(spec)
  }
  const illegal = [...bare].filter((s) => !HOST_MODULES.has(s))
  if (illegal.length > 0) {
    fails.push(`${tag} A4 产物 require 了宿主不保证提供的模块：${illegal.join(', ')}`)
  } else {
    passes.push(`${tag} A4 裸 require 全在宿主白名单内（${[...bare].join(', ') || '无'}）`)
  }

  /* A5 closure-factory 形态 */
  const ok5 = clientSrc.includes('__ModuleLoader__.load(')
    && clientSrc.includes(`id: ${JSON.stringify(pkg.name)}`)
    && clientSrc.includes('factory:')
  if (ok5) passes.push(`${tag} A5 closure-factory 形态正确（__ModuleLoader__.load + id + factory）`)
  else fails.push(`${tag} A5 不是 DSH 期望的 closure-factory 形态`)

  /* A6 违禁内容 */
  for (const f of FORBIDDEN) {
    if (f.re.test(hostSrc) || f.re.test(clientSrc)) {
      fails.push(`${tag} A6 产物含违禁内容：${f.why}`)
    }
  }

  /* A7 files 覆盖 */
  const files = Array.isArray(pkg.files) ? pkg.files : []
  const coversLib = files.some((f) => f.startsWith('lib'))
  const coversPatch = files.includes('cordis.patch.yml')
  if (coversLib && coversPatch) passes.push(`${tag} A7 files 覆盖 lib/ 与 cordis.patch.yml`)
  else fails.push(`${tag} A7 files 未覆盖产物（lib=${coversLib} patch=${coversPatch}）`)

  /* A8 不引用另一个插件 */
  const cross = other.filter((n) => clientSrc.includes(n) || hostSrc.includes(n))
  if (cross.length === 0) passes.push(`${tag} A8 未引用另一个插件（A-2）`)
  else fails.push(`${tag} A8 产物引用了另一个插件：${cross.join(', ')} ⇒ 破坏 A-2 可独立摘除`)
}

console.log('分发断言（这个包能不能独自发出去）')
console.log('')
for (const p of passes) console.log(`  ✓ ${p}`)
for (const f of fails) console.log(`  ✗ ${f}`)
console.log('')
console.log(fails.length === 0
  ? '✓ 通过：三个插件都可独立分发（零外部依赖 / 只向宿主要它一定有的模块）'
  : `✗ 不通过：${fails.length} 处`)

process.exit(fails.length === 0 ? 0 : 1)
