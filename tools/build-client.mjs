#!/usr/bin/env node
/**
 * 山海·开铺 · client bundle 组装器（通用版）
 * =====================================================================
 * 用法：node tools/build-client.mjs packages/plugin-platform
 *
 * ── 它解决什么问题 ────────────────────────────────────────────────
 *
 * DSH 官方给 UI 插件的打包 preset 是 `clientBundle()`，位于 DSH 仓内
 * `packages/client/tsdown.client.ts` —— **不随任何 npm 包发布**。
 * 插件在 monorepo 之外拿不到它，所以这里手工复刻产物格式。
 * 好在格式本身很简单：
 *
 *   window.__ModuleLoader__.load({
 *     id: "<包名>",
 *     factory: (require) => {
 *       var module = { exports: {} }; var exports = module.exports;
 *       Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
 *       <模块体>
 *       exports.apply = apply; exports.inject = inject;
 *       return module.exports;
 *     }
 *   });
 *
 * 为什么是 CJS-in-closure 而不是 ESM：DSH 的 client module 系统是
 * **lazy CJS table**（`packages/client/modules/.../manifest.ts`）——
 * 执行 bundle 只**注册 factory**，首次 require 才 materialize；
 * require 由 loader 注入、从共享模块表取（react 等单例由此保证）。
 *
 * ── ★★ 与 003 那版的**关键差异**（这是本文件最值钱的地方）──────────
 *
 *   003 的做法：tsc 出 **ESM** → 用手写正则把 `import/export` 改写成
 *   「模块工厂 + 注入依赖」（`stripEsm()`，约 200 行）。
 *   代价：正则要同时认单引号/双引号、要处理 `export const` / `export function` /
 *   `export {}` / `import type` 各种形态 —— **每加一种语法都要回来改**，
 *   而且改错了是"构建成功但运行炸"（最难查的一类）。
 *
 *   本文件：让 client tsconfig 直接编译成 **CommonJS**（`module: "CommonJS"`）
 *   ⇒ tsc 自己产出标准 `require()` / `exports.x =` ⇒
 *   **我们只需把「相对路径的 require」改指到同 bundle 内的局部变量**，
 *   **完全不需要任何语法改写**。剩下的是纯字符串替换 + 一个拓扑排序。
 *
 *   ⇒ 另一个附带好处：**模块清单不用手写**。
 *     003 那份要维护 `MODULES` 数组（按依赖序，被依赖的在前），
 *     漏登记 = 浏览器报 `import failed: __xxx_js is not defined` ⇒ **整个插件加载失败**
 *     （003 连踩两次，注释里写着"上面那条警告不是考古"）。
 *     本文件从产物的 `require()` 里**自己推依赖图并拓扑排序** ⇒ 不可漏。
 *
 * ── ★★ 内部包会被**内联**（`@shanhai/*`）─────────────────────────────
 *
 *   宿主 closure 的 `require` 只服务宿主模块表（react 等）。我们的 `@shanhai/*`
 *   不在里面 ⇒ 原样留下就是 require 到 undefined ⇒ 插件加载失败。
 *   而"抄一份常量到客户端"会制造第二个出处（必然漂移）⇒ 正解是整包内联。
 *   见 §1b；`tools/check-package.mjs` 把"裸 require 只剩 react"当硬断言兜底。
 *
 * ── 依赖序为什么必须由我们算 ──────────────────────────────────────
 *
 *   closure 内模块是**顺序求值**的（`var m_a = (function(){...})()`）。
 *   若 A 引用 B 而 B 排在 A 后面 ⇒ 求值时 `m_b` 是 `undefined`
 *   ⇒ 典型症状是 `Cannot access 'm_b' before initialization`（TDZ）
 *   或运行时 undefined（003 踩过）。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const arg = process.argv[2]
if (arg === undefined) {
  console.error('用法：node tools/build-client.mjs <package-dir>')
  process.exit(2)
}
const PKG_DIR = resolve(ROOT, arg)
const PKG_JSON = join(PKG_DIR, 'package.json')
if (!existsSync(PKG_JSON)) {
  console.error(`✗ 找不到 ${relative(ROOT, PKG_JSON)}`)
  process.exit(2)
}
const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'))
const PKG_NAME = pkg.name

/** 输出路径：取 exports['./client'] 的 default（DSH 就是从这里解析 bundle 的） */
const clientExport = pkg.exports?.['./client']
const OUT_REL = typeof clientExport === 'string'
  ? clientExport
  : clientExport?.default
if (typeof OUT_REL !== 'string') {
  console.error(`✗ ${PKG_NAME} 的 package.json 缺 exports["./client"] —— DSH 靠它找 bundle`)
  process.exit(2)
}
const OUT_ABS = join(PKG_DIR, OUT_REL)

/* ─────────────────── 1. 收集编译产物 ─────────────────── */

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.js')) out.push(p)
  }
  return out
}

const LIB = join(PKG_DIR, 'lib')
const ENTRY_ABS = join(LIB, 'client', 'index.js')
if (!existsSync(ENTRY_ABS)) {
  console.error(`✗ 找不到入口 ${relative(ROOT, ENTRY_ABS)}`)
  console.error('  ⇒ 先跑 client 侧 tsc（tsconfig.client.json）。本脚本只组装，不编译。')
  process.exit(2)
}

const files = walk(LIB)
const byRel = new Map() // 键（posix）-> 绝对路径。插件自身：'client/index.js'；内联内部包：'@shanhai/xxx/index.js'
for (const f of files) byRel.set(relative(LIB, f).replace(/\\/g, '/'), f)

/* ─────────── 1b. ★★ 把内部包（`@shanhai/*`）内联进同一张表 ───────────
 *
 * 为什么必须内联（这是一个"不做就一定炸"的点）：
 *   宿主 closure 里的 `require` 由 loader 注入、**只服务宿主模块表**（react 等单例）。
 *   我们的内部包**不在那张表里** ⇒ 若把 `require('@shanhai/kaipu-contract')` 原样留下，
 *   浏览器里拿到的是 undefined ⇒ **插件加载失败**。
 *
 * 为什么不能"抄一份常量到客户端"：
 *   契约包存在的**唯一理由**就是"错误码 / SSE 事件名 / 判定色调只有一个出处"。
 *   抄一份 = 制造第二个出处 = 必然漂移（本仓 README 明令禁止）。
 *   ⇒ 正解是**把它整包内联**，让产物自带那些常量，而不是让运行时去解析它。
 *
 * ⇒ `tools/check-package.mjs` 会把"裸 require 只剩 react"当硬断言 —— 这份内联
 *   若哪天失效，**构建期就会被抓住**，不会等到浏览器里爆。
 */
const internalPkgs = new Map() // '@shanhai/xxx' -> { lib, entry }
for (const dir of readdirSync(join(ROOT, 'packages'))) {
  const pj = join(ROOT, 'packages', dir, 'package.json')
  if (!existsSync(pj)) continue
  const p = JSON.parse(readFileSync(pj, 'utf8'))
  if (typeof p.name !== 'string') continue
  const ex = p.exports?.['.']
  const entry = ((typeof ex === 'string' ? ex : ex?.default) ?? p.main ?? './lib/index.js')
    .replace(/^\.\//, '').replace(/^lib\//, '')
  // ★ 优先取 **CJS 产物**（`lib-cjs`）：client bundle 是 CJS closure，
  //   内联 ESM 会 SyntaxError。没有 lib-cjs 时退回 `lib/`，但下面的
  //   **ESM 残留闸门**会当场抓住 —— 而不是悄悄产出一个坏 bundle。
  const cjsLib = join(ROOT, 'packages', dir, 'lib-cjs')
  const esmLib = join(ROOT, 'packages', dir, 'lib')
  const lib = existsSync(cjsLib) ? cjsLib : (existsSync(esmLib) ? esmLib : null)
  if (lib === null) continue
  internalPkgs.set(p.name, { lib, entry, isCjs: lib === cjsLib })
}
let internalCount = 0
for (const [name, info] of internalPkgs) {
  for (const f of walk(info.lib)) {
    byRel.set(`${name}/${relative(info.lib, f).replace(/\\/g, '/')}`, f)
    internalCount++
  }
}

/* ─────────────────── 2. 推依赖图（从 require 里读） ─────────────────── */

const RE_REQUIRE = /require\(\s*(['"])([^'"]+)\1\s*\)/g

/** 键归属于哪个 lib 根（决定相对 specifier 从哪儿解析） */
function libOfKey(key) {
  const m = /^(@[^/]+\/[^/]+)\//.exec(key)
  return m !== null && internalPkgs.has(m[1]) ? internalPkgs.get(m[1]).lib : LIB
}
/** 键在它自己那个 lib 根内的相对路径（拼回键时要补包名前缀） */
function relInLib(key) {
  const m = /^(@[^/]+\/[^/]+)\/(.+)$/.exec(key)
  return m !== null && internalPkgs.has(m[1]) ? m[2] : key
}
function keyPrefix(key) {
  const m = /^(@[^/]+\/[^/]+)\//.exec(key)
  return m !== null && internalPkgs.has(m[1]) ? `${m[1]}/` : ''
}

/**
 * 解析 specifier → bundle 内的键；`null` = **真外部**（宿主模块表提供，如 react）。
 * 相对路径与内部包都解析得出，所以"是不是外部"由本函数说了算。
 */
function resolveSpec(fromKey, spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const base = dirname(relInLib(fromKey))
    const p = join(base, spec).replace(/\\/g, '/')
    const prefix = keyPrefix(fromKey)
    for (const cand of [p, `${p}.js`, `${p}/index.js`]) {
      if (byRel.has(prefix + cand)) return prefix + cand
    }
    return null
  }
  // 裸 specifier：只可能是「内部包」或「宿主模块」
  const m = /^(@[^/]+\/[^/]+)(?:\/(.*))?$/.exec(spec)
  if (m !== null) {
    const info = internalPkgs.get(m[1])
    if (info !== undefined) {
      const target = m[2] === undefined || m[2] === '' ? info.entry : m[2]
      return byRel.has(`${m[1]}/${target}`) ? `${m[1]}/${target}` : null
    }
  }
  return null
}

const deps = new Map()   // key -> Set<key>
const externals = new Set()
const missing = []

for (const key of byRel.keys()) {
  const src = readFileSync(byRel.get(key), 'utf8')
  const set = new Set()
  for (const m of src.matchAll(RE_REQUIRE)) {
    const spec = m[2]
    const target = resolveSpec(key, spec)
    if (target === null) {
      // 相对路径解析不出来 = 我们的构建错了；裸 specifier = 交给宿主
      if (spec.startsWith('.') || spec.startsWith('/')) missing.push({ rel: key, spec })
      else externals.add(spec)
    } else set.add(target)
  }
  deps.set(key, set)
}

if (missing.length > 0) {
  console.error('✗ 有 require 指向 bundle 内不存在的模块（会让插件在浏览器里加载失败）：')
  for (const m of missing) console.error(`    ${m.rel}  →  ${m.spec}`)
  console.error('  ⇒ 通常是 tsconfig.client.json 的 include 漏了该文件。')
  process.exit(1)
}

/* ─────────────────── 3. 拓扑排序（依赖在前） ─────────────────── */

const ENTRY_REL = relative(LIB, ENTRY_ABS).replace(/\\/g, '/')
const order = []
const state = new Map() // 1=访问中 2=已完成
const cycles = []

function visit(rel, stack) {
  const s = state.get(rel)
  if (s === 2) return
  if (s === 1) {
    const at = stack.indexOf(rel)
    cycles.push([...stack.slice(at), rel])
    return
  }
  state.set(rel, 1)
  stack.push(rel)
  for (const d of deps.get(rel) ?? []) visit(d, stack)
  stack.pop()
  state.set(rel, 2)
  order.push(rel)
}

visit(ENTRY_REL, [])

if (cycles.length > 0) {
  console.error('✗ 检测到循环依赖 —— closure 内是顺序求值，循环必然 TDZ：')
  for (const c of cycles) console.error(`    ${c.join(' → ')}`)
  console.error('  ⇒ 拆出一个被双方共用的第三个模块，或把共享逻辑提到入口。')
  process.exit(1)
}

/* ─────────────────── 4. 局部变量名 ─────────────────── */

const localOf = new Map()
const used = new Set()
for (const rel of order) {
  let name = 'm_' + basename(rel, '.js').replace(/[^A-Za-z0-9_]/g, '_')
  if (/^[0-9]/.test(name.slice(2))) name = `m_${name.slice(2)}`
  let n = name
  let i = 2
  while (used.has(n)) n = `${name}_${i++}`
  used.add(n)
  localOf.set(rel, n)
}

/* ─────────────────── 5. 生成 ─────────────────── */

/* ── ★★ 生成前的**硬闸门**：不许有 ESM 语法残留 ──────────────────────
 *
 * 为什么必须有：2026-10-05 内联契约包时踩过 —— 契约产物是 ESM，
 * 内联进 CJS closure 后浏览器报 `SyntaxError: Unexpected token 'export'`，
 * 而**构建是绿的**（bundle 文件照样生成了）。
 * 症状比"构建失败"难查得多：整站不渲染（DSH 的 client 启动是全或无），
 * 控制台只有一句 "import failed"。
 *
 * ⇒ 让构建**自己**炸，并直接说清怎么修。判据：模块体行首不得出现 `export`/`import` 语句。
 */
const ESM_LEFTOVER = /^[ \t]*(export[ \t]|import[ \t]|export\{)/m
const esmLeaks = []
for (const rel of order) {
  const body = readFileSync(byRel.get(rel), 'utf8')
  const m = ESM_LEFTOVER.exec(body)
  if (m !== null) {
    const ln = body.slice(0, m.index).split('\n').length
    esmLeaks.push(`${rel}:${ln}  ${(body.split('\n')[ln - 1] ?? '').trim().slice(0, 90)}`)
  }
}
if (esmLeaks.length > 0) {
  console.error('✗ bundle 里会出现 ESM 语法 —— 浏览器会 SyntaxError，且**整站不渲染**（client 启动是全或无）：')
  for (const l of esmLeaks.slice(0, 10)) console.error(`    ${l}`)
  if (esmLeaks.length > 10) console.error(`    …还有 ${esmLeaks.length - 10} 处`)
  console.error('  ⇒ 上面这些模块**不是 CommonJS 产物**。常见原因与修法：')
  console.error('     · 内联的内部包只产出 ESM ⇒ 给它加一份 CJS 产物（照 packages/contract/tsconfig.cjs.json 那份写）')
  console.error('     · 插件自身 client 侧 tsconfig 的 module 没设成 CommonJS（见 tsconfig.client.json）')
  process.exit(1)
}

const lines = []
lines.push(`/* 山海·开铺 · client bundle · ${PKG_NAME}`)
lines.push(` * 由 tools/build-client.mjs 生成 —— 请勿手改。`)
lines.push(` * 模块 ${order.length} 个（按依赖序）· 宿主外部模块 ${externals.size} 个：${[...externals].join(', ')}`)
lines.push(` */`)
lines.push(`window.__ModuleLoader__.load({`)
lines.push(`  id: ${JSON.stringify(PKG_NAME)},`)
lines.push(`  factory: function (require) {`)
lines.push(`    'use strict';`)

for (const rel of order) {
  const local = localOf.get(rel)
  let body = readFileSync(byRel.get(rel), 'utf8')

  // ① require → 局部变量。★ 相对路径与**内部包**都改指局部变量；
  //    只有真正由宿主提供的模块（react 等）原样留给宿主 require。
  body = body.replace(RE_REQUIRE, (whole, _q, spec) => {
    const target = resolveSpec(rel, spec)
    if (target === null) return whole
    return localOf.get(target) ?? whole
  })

  lines.push('')
  lines.push(`    /* ── ${rel} ── */`)
  lines.push(`    var ${local} = (function () {`)
  lines.push(`      var module = { exports: {} };`)
  lines.push(`      var exports = module.exports;`)
  lines.push(`      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });`)
  lines.push(body.replace(/^/gm, '      ').trimEnd())
  lines.push(`      return module.exports;`)
  lines.push(`    })();`)
}

lines.push('')
lines.push(`    return ${localOf.get(ENTRY_REL)};`)
lines.push(`  },`)
lines.push(`});`)
lines.push('')

const out = lines.join('\n')
writeFileSync(OUT_ABS, out, 'utf8')

/* ─────────────────── 6. 入口自检（构建期就炸，别等浏览器） ─────────────────── */

const entrySrc = readFileSync(ENTRY_ABS, 'utf8')
const hasApply = /\bexports\.apply\s*=/.test(entrySrc)
const hasInject = /\bexports\.inject\s*=/.test(entrySrc)
if (!hasApply && !hasInject) {
  console.error(`✗ 入口 ${ENTRY_REL} 既没有 exports.apply 也没有 exports.inject`)
  console.error('  ⇒ DSH 的 client module 系统读这两个导出，缺了插件不会生效。')
  process.exit(1)
}

// ★ 只数**真正进了 bundle**的内联模块（`order`），不数"入表的文件" ——
//   两者差很多（表里是全部内部包的全部文件，bundle 只含可达的那些）。
//   数错会让"内联生效了吗"这个问题得到一个乐观的假答案。
const inlinedInBundle = order.filter((k) => k.startsWith('@')).length
console.log(`✓ ${PKG_NAME} → ${relative(ROOT, OUT_ABS)}`)
console.log(`  · 模块 ${order.length} 个（拓扑序，无环）· 其中**内联的内部包模块** ${inlinedInBundle} 个`)
console.log(`  · 宿主外部模块 ${externals.size} 个：${[...externals].join(', ')}`)
console.log(`  · 入口导出：${hasInject ? 'inject ' : ''}${hasApply ? 'apply' : ''}`)
console.log(`  · 体积 ${(Buffer.byteLength(out, 'utf8') / 1024).toFixed(1)} KB`)
