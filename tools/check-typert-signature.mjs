#!/usr/bin/env node
/**
 * 山海·开铺 · **Typert 签名对齐判据**（`check-typert-signature.mjs`）
 * =====================================================================
 * ★ 为什么需要它（双灯 P1-④：**悬空承诺**）：
 *   `src/remote/dsh-typert.d.ts` 原先写「若上游改签名，配套的桥接检查脚本会当场报错」
 *   —— 而实测**本仓没有任何脚本断言这件事**。悬空承诺比没有承诺更危险：
 *   读代码的人会以为有看护，于是不再人工核。
 *
 * ── 判据三段 ────────────────────────────────────────────────────────
 *   ① **参数表**：每个 `@Remote(...)` 方法 —— **参数不许有默认值** ·
 *      **`signal` 必须在末位**（网关靠 `Function.prototype.toString()` 反射参数名/顺序）
 *   ② **本地自洽**：`d.ts` 声明的形状与 `service.ts` 的用法不打架
 *      （`extends TypertRemoteService` · `super(ctx, REMOTE_NS)` · `@Remote` 装饰器形态）
 *   ③ **上游逐字比对**（**仅在 `KAI_DSH_REPO` 在场时**）：在宿主仓库里找
 *      `@deepseek-ai/dsh-typert-protocol` 的 `.d.ts`，断言关键的类/函数声明行仍在。
 *      不在场 ⇒ 打印 **SKIP**（不算过、也不算红；**绝不假装验过**）。
 *
 * ★ 本判据自带阴面对照（G 组）：内存假样本证明 ① 真的会红。
 *
 * 用法：
 *   node tools/check-typert-signature.mjs
 *   KAI_DSH_REPO=/path/to/dsh-repo node tools/check-typert-signature.mjs   # 追加上游比对
 * 退出码：0 = 全过（含 SKIP 段）；1 = 有 FAIL
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVICE_TS = join(ROOT, 'packages/plugin-workstation/src/remote/service.ts')
const DTS = join(ROOT, 'packages/plugin-workstation/src/remote/dsh-typert.d.ts')

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failed++
}
const info = (msg) => console.log(`  · ${msg}`)

/**
 * 从源码里抽出所有 `@Remote(...)` 方法的参数表。
 * 形态（本仓约定）：`@Remote('name')` 换行 `async name(...)...`
 * 返回 [{ name, decorator, params: string[] }]
 */
function remoteMethods(src) {
  const out = []
  const re = /@Remote\(\s*(?:'([^']+)'|\{[^}]*\})\s*\)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g
  let m
  while ((m = re.exec(src)) !== null) {
    /* 从方法名后的 `(` 起做括号配平，取出参数表原文 */
    let i = src.indexOf('(', re.lastIndex - 1)
    let depth = 0
    let start = i + 1
    let end = -1
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) continue
    const raw = src.slice(start, end)
    /* 按顶层逗号切参数（参数里有 `EmptyQuery` 这类无嵌套泛型，简单切分足够） */
    const params = []
    let buf = ''
    let d = 0
    for (const ch of raw) {
      if ('([{<'.includes(ch)) d++
      if (')]}>'.includes(ch)) d--
      if (ch === ',' && d === 0) {
        params.push(buf.trim())
        buf = ''
      } else buf += ch
    }
    if (buf.trim() !== '') params.push(buf.trim())
    out.push({ decorator: m[1] ?? '(options)', name: m[2], params })
  }
  return out
}

/** 参数名（去掉类型注解 + 可选标记 `?`）
 *  ★ 2026-10-18 修：原实现 `p.split(':')[0].trim()` 对 `signal?: CancelSignal`
 *  得到 `signal?` ≠ `signal` ⇒ 「signal 末位」判据与「带 signal ≥1」自检双双空转（假红/假绿）。
 */
const paramName = (p) => p.split(':')[0].replace(/\?$/, '').trim()

console.log('Typert 签名对齐判据\n')

const src = existsSync(SERVICE_TS) ? readFileSync(SERVICE_TS, 'utf8') : null
const dts = existsSync(DTS) ? readFileSync(DTS, 'utf8') : null

/* ══════════════════════════════════════════════════════════════════
   ① 参数表硬约束
   ══════════════════════════════════════════════════════════════════ */
console.log('── ① `@Remote` 方法参数表（无默认值 · signal 末位）──')
if (src === null) {
  say(false, `找不到 ${relative(ROOT, SERVICE_TS)}`)
} else {
  const methods = remoteMethods(src)
  say(methods.length > 0, `扫到 ${methods.length} 个 @Remote 方法（0 个 ⇒ 正则失配，判据在空转，必须红）`)
  for (const m of methods) {
    const withDefault = m.params.filter((p) => p.includes('='))
    say(withDefault.length === 0, `${m.name}(${m.params.join(', ')})：默认值 ${withDefault.length} 处（必须 0 —— 网关读编译后参数名）`)
    const hasSignal = m.params.some((p) => paramName(p) === 'signal')
    if (hasSignal) {
      const last = paramName(m.params[m.params.length - 1])
      say(last === 'signal', `${m.name}：signal 在末位（实际末位 = ${last}）`)
    } else {
      info(`${m.name}：无 signal 参数（该端点不需取消，合法）`)
    }
  }
  /* 反证：至少有一个方法带 signal 且位于末位 —— 否则①这一条等于没验到 */
  const signalChecked = methods.filter((m) => m.params.some((p) => paramName(p) === 'signal')).length
  say(signalChecked > 0, `带 signal 的方法数 = ${signalChecked}（≥1 ⇒ 「signal 末位」这条真的被验到）`)
}

/* ══════════════════════════════════════════════════════════════════
   ② 本地 d.ts ↔ 用法自洽
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── ② 本地 d.ts 声明 ↔ service.ts 用法自洽 ──')
if (dts === null) {
  say(false, `找不到 ${relative(ROOT, DTS)}`)
} else {
  say(/export\s+abstract\s+class\s+TypertRemoteService/.test(dts), 'd.ts 声明 `abstract class TypertRemoteService`')
  say(/export\s+function\s+Remote\s*\(/.test(dts), 'd.ts 声明 `function Remote(...)`')
  say(/declare\s+module\s+'@deepseek-ai\/dsh-typert-protocol'/.test(dts), "d.ts 是 module 声明形态（declare module '@deepseek-ai/dsh-typert-protocol'）")

  if (src !== null) {
    say(/extends\s+TypertRemoteService/.test(src), 'service.ts `extends TypertRemoteService`')
    say(/super\(\s*ctx\s*,\s*REMOTE_NS\s*\)/.test(src), 'service.ts `super(ctx, REMOTE_NS)`（构造签名与声明一致）')
    const decorators = remoteMethods(src).map((m) => m.decorator)
    say(decorators.every((d) => d !== '(options)'), `@Remote 全部用 **字符串** 形态（本仓不用 stream 模式的 options 对象）：${decorators.join(', ')}`)
    /* 本仓 tsconfig 不能开 experimentalDecorators（开了就变 legacy 语义，签名对不上） */
    const tsconfig = existsSync(join(ROOT, 'packages/plugin-workstation/tsconfig.json'))
      ? readFileSync(join(ROOT, 'packages/plugin-workstation/tsconfig.json'), 'utf8')
      : ''
    say(!/"experimentalDecorators"\s*:\s*true/.test(tsconfig), 'tsconfig **未**开 `experimentalDecorators`（开了就变 legacy 语义，与标准装饰器签名对不上）')
  }
}

/* ══════════════════════════════════════════════════════════════════
   ③ 上游逐字比对（KAI_DSH_REPO 在场才跑）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── ③ 上游 d.ts 逐字比对（需 KAI_DSH_REPO）──')
const dshRepo = process.env['KAI_DSH_REPO']
/** 递归找 @deepseek-ai/dsh-typert-protocol 的 .d.ts */
function findUpstreamDts(base) {
  const hits = []
  const walk = (dir, depth) => {
    if (depth > 8 || !existsSync(dir)) return
    let names
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'packages' || name === 'src' || name === 'dist') walk(p, depth + 1)
        else if (name.startsWith('@deepseek-ai') || name === 'dsh-typert-protocol') walk(p, depth + 1)
      } else if (name.endsWith('.d.ts') && p.includes('dsh-typert-protocol')) {
        hits.push(p)
      }
    }
  }
  walk(base, 0)
  return hits
}

if (dshRepo === undefined || dshRepo === '') {
  console.log('  ⤵ SKIP：KAI_DSH_REPO 不在场 ⇒ **上游逐字比对未执行**。')
  console.log('     这不是"通过"，是"未验"（接真身轮补：KAI_DSH_REPO=<宿主仓库> 重跑本段）。')
} else if (!existsSync(dshRepo)) {
  say(false, `KAI_DSH_REPO=${dshRepo} 路径不存在`)
} else {
  const hits = findUpstreamDts(dshRepo)
  if (hits.length === 0) {
    say(false, `KAI_DSH_REPO 下找不到 dsh-typert-protocol 的 .d.ts ⇒ 无法比对（注意：这是 FAIL，不是 SKIP）`)
  } else {
    info(`找到 ${hits.length} 份上游 d.ts：${hits.map((p) => relative(dshRepo, p)).join(' / ')}`)
    const text = hits.map((p) => readFileSync(p, 'utf8')).join('\n')
    say(/class\s+TypertRemoteService/.test(text), '上游仍有 `class TypertRemoteService`')
    say(/function\s+Remote\s*\(/.test(text), '上游仍有 `function Remote(`')
    /* signal 末位的约定：上游文档/类型里应能见到 signal 参数名 */
    say(/signal/.test(text), '上游 d.ts 里能见到 `signal`（取消参数约定仍在）')
  }
}

/* ══════════════════════════════════════════════════════════════════
   G · 阴面对照
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── G. 阴面对照：① 真的会 FAIL 吗（内存假样本）──')
const GOOD = `class S {\n  @Remote('status')\n  async status(query: EmptyQuery, signal?: CancelSignal): Promise<X> {}\n}`
const BAD_DEFAULT = `class S {\n  @Remote('status')\n  async status(query: EmptyQuery = {} as EmptyQuery, signal?: CancelSignal): Promise<X> {}\n}`
const BAD_ORDER = `class S {\n  @Remote('status')\n  async status(signal?: CancelSignal, query: EmptyQuery): Promise<X> {}\n}`

const checkParams = (text) => {
  const ms = remoteMethods(text)
  const problems = []
  for (const m of ms) {
    if (m.params.some((p) => p.includes('='))) problems.push(`${m.name}:默认值`)
    if (m.params.some((p) => paramName(p) === 'signal') && paramName(m.params[m.params.length - 1]) !== 'signal') {
      problems.push(`${m.name}:signal不在末位`)
    }
  }
  return { count: ms.length, problems }
}
const gGood = checkParams(GOOD)
const gBad1 = checkParams(BAD_DEFAULT)
const gBad2 = checkParams(BAD_ORDER)
say(gGood.count === 1 && gGood.problems.length === 0, `G-1 对照基准：合规样本 ⇒ 判**过**（扫到 ${gGood.count} 个方法）`)
say(gBad1.problems.includes('status:默认值'), `G-2 注入参数默认值 ⇒ 必红（${gBad1.problems.join(',')}）`)
say(gBad2.problems.includes('status:signal不在末位'), `G-3 把 signal 移到前面 ⇒ 必红（${gBad2.problems.join(',')}）`)

console.log(`\n${failed === 0 ? '✓ 全过（上游段若 SKIP 则记"未验"，不记"通过"）' : `✗ 有 ${failed} 条 FAIL`}`)
process.exit(failed === 0 ? 0 : 1)
