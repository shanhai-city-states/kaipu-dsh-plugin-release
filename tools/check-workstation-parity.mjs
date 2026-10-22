#!/usr/bin/env node
/**
 * 山海·开铺 · 工位插件 · **双份纯函数看护判据**（`check-workstation-parity.mjs`）
 * =====================================================================
 * ★ 为什么需要它（双灯 P2-① / P2-③ / 戒 P2-1、P2-3）：
 *   工位有 **4 个纯函数在 host 与 client 各存一份**（A-2 禁止两包互 import）：
 *     `summarizeSeats` / `seatText` / `inviteExpired` / `splitMembers`
 *   两份实现**没有任何看护** ⇒ 实测已经漂了一次（`splitMembers` 的返回类型注解分号不同）。
 *   更贵的是语义漂移：`summarizeSeats` 若只在一边改了判序，面板数字与 host 出参就不一致，
 *   而**两边都"跑得过"** —— 只会表现成"用户看到的数字和接口给的对不上"。
 *
 * ★ 判据口径（R-17 写死，防误红）：
 *   **只比函数体，不比签名注解排版**。定位法 = 「**参数列表右括号后第一个 `{`**」；
 *   若该 `{…}` 之后紧跟另一个 `{`，则前者是**返回类型注解**、后者才是函数体
 *   （`summarizeSeats` 的返回类型是对象字面量类型，就踩这个坑）。
 *   比对前**去注释 + 去空白**；字符串字面量保留（文案改了必须能被发现）。
 *
 * ── 判据清单 ────────────────────────────────────────────────────────
 *   A 4/4 函数体一致（host `workstation-state.ts` ↔ client `live.ts`）
 *   B `SourceKind` 定义**全仓 1 处**（contract），且 client 是 re-export（对外 import 路径不变）
 *   C 不变量正负例：`assertSeatMemberConsistency` 对 scaffold 种子 ok；
 *     人为造非法态（占座+非成员 / 空位带在场态 / 移除未释放）必须非 ok
 *   D 座位汇总四数分账：occupied + vacant + removed == 座位数；`removed` 不再被记进 vacant
 *   E `seatText` 三档穷举（空位 / 离座 / 在场），且**不存在**「已移除」档（T-1 删死码）
 *   F 产物同源（R-7）：`lib/client.js` 中 `VACANT` 0 命中 · `已移除` 0 命中 · `空位 · 可邀请` ≥1
 *   G 阴面对照：内存假样本证明 A/B 真的会红
 *
 * ★ 依赖产物：C/D/E 直接 import **host 编译产物**（`lib/remote/workstation-state.js`）
 *   ⇒ 必须**先** `node tools/build.mjs`。产物不在 ⇒ 判红并提示（不静默跳过）。
 *   （这正是 R-7 的纪律：禁「只跑 tsc --noEmit 即全绿」。）
 *
 * 用法：node tools/check-workstation-parity.mjs
 * 退出码：0 = 全过；1 = 有 FAIL
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_TS = join(ROOT, 'packages/plugin-workstation/src/remote/workstation-state.ts')
const CLIENT_TS = join(ROOT, 'packages/plugin-workstation/src/client/live.ts')
const CLIENT_BUNDLE = join(ROOT, 'packages/plugin-workstation/lib/client.js')
const HOST_JS = join(ROOT, 'packages/plugin-workstation/lib/remote/workstation-state.js')

const FUNCS = ['summarizeSeats', 'seatText', 'inviteExpired', 'splitMembers']

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failed++
}

/* ══════════════════════════════════════════════════════════════════
   工具：去注释（保字符串）、配平、函数体定位、归一化
   ══════════════════════════════════════════════════════════════════ */

/** 去掉 `//` 与块注释，**保留字符串字面量原文**（文案改动必须能被发现） */
function stripComments(src) {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') j += 2
        else if (src[j] === c) {
          j++
          break
        } else j++
      }
      out += src.slice(i, j)
      i = j - 1
      continue
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 1
      continue
    }
    out += c
  }
  return out
}

/** 从 `open`（必须是 `{`）起配平，返回配对 `}` 的下标（跳过字符串），失败返回 -1 */
function matchBrace(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') j += 2
        else if (src[j] === c) break
        else j++
      }
      i = j
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
      if (depth < 0) return -1
    }
  }
  return -1
}

/**
 * 定位 `export function <name>` 的**函数体**（含花括号）。
 * ★ R-17：从**参数列表右括号**起找第一个 `{`；若该 `{…}` 后面紧跟另一个 `{`，
 *   前者是返回类型注解 ⇒ 取后者。
 */
function functionBody(src, name) {
  const at = src.search(new RegExp(`export\\s+function\\s+${name}\\b`))
  if (at < 0) return null
  let i = src.indexOf('(', at)
  if (i < 0) return null
  let depth = 0
  let paramEnd = -1
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') j += 2
        else if (src[j] === c) break
        else j++
      }
      i = j
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        paramEnd = i + 1
        break
      }
    }
  }
  if (paramEnd < 0) return null

  let open = src.indexOf('{', paramEnd)
  if (open < 0) return null
  const close = matchBrace(src, open)
  if (close < 0) return null
  /* 返回类型注解：`{…}` 之后紧跟（跳过空白）另一个 `{` */
  const next = src.slice(close + 1).search(/\S/)
  if (next >= 0 && close + 1 + next < src.length && src[close + 1 + next] === '{') {
    open = close + 1 + next
  }
  const end = matchBrace(src, open)
  if (end < 0) return null
  return src.slice(open, end + 1)
}

/** 归一化：去注释 → 去所有空白 */
const normalize = (body) => stripComments(body).replace(/\s+/g, '')

/** 递归收集某目录下所有 .ts（跳过 node_modules / lib） */
function collectTs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'lib' || name === 'lib-cjs') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) collectTs(p, out)
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/* ══════════════════════════════════════════════════════════════════
   A · 4/4 函数体一致
   ══════════════════════════════════════════════════════════════════ */
console.log('工位双份纯函数看护判据\n')
console.log('── A. 4 个纯函数：host ↔ client 函数体一致（只比函数体，不比签名排版）──')

const hostSrc = readFileSync(HOST_TS, 'utf8')
const clientSrc = readFileSync(CLIENT_TS, 'utf8')

let same = 0
for (const fn of FUNCS) {
  const a = functionBody(hostSrc, fn)
  const b = functionBody(clientSrc, fn)
  if (a === null || b === null) {
    say(false, `${fn}：${a === null ? 'host' : 'client'} 侧定位失败（函数改名/结构变形 ⇒ 先修本判据）`)
    continue
  }
  const ok = normalize(a) === normalize(b)
  if (ok) same++
  say(ok, `${fn}：函数体${ok ? '一致' : '**不一致** ⟵ 两份实现漂了'}`)
  if (!ok) {
    console.log(`      host  : ${normalize(a).slice(0, 160)}`)
    console.log(`      client: ${normalize(b).slice(0, 160)}`)
  }
}
say(same === FUNCS.length, `${same}/${FUNCS.length} 函数体一致`)

/* ══════════════════════════════════════════════════════════════════
   B · SourceKind 单落点
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── B. `SourceKind` **工位链路内**一处定义（其余只 import / re-export）──')
/* ★ 2026-10-18 修：原实现扫**全仓 packages** ⇒ 把 plugin-platform / plugin-wisdom
 *   各自的 `SourceKind`（同名不同义：各包 client 的连接态类型）也计入 ⇒ 恒为 3、必红。
 *   判据本意是「工位这份定义只有一个出处」⇒ 范围收窄到 contract + plugin-workstation。
 *   （跨包同名不算重复定义：三插件互不 import，各自维护自己的连接态是设计使然。） */
const scopeDirs = ['packages/contract', 'packages/plugin-workstation']
  .map((d) => join(ROOT, d))
  .filter((d) => existsSync(d))
const allTs = scopeDirs.flatMap((d) => collectTs(d))
const defs = []
for (const p of allTs) {
  const text = readFileSync(p, 'utf8')
  if (/export\s+type\s+SourceKind\s*=/.test(text)) defs.push(relative(ROOT, p))
}
say(defs.length === 1, `工位链路内定义处数 = ${defs.length}（期望 1）${defs.length > 0 ? `：${defs.join(' / ')}` : ''}`)
say(defs.length === 1 && defs[0].includes('packages/contract/'), `唯一定义在契约层（实际：${defs[0] ?? '—'}）`)
const reExport = /export\s+type\s*\{\s*SourceKind\s*\}\s*from\s*'@shanhai\/kaipu-contract'/.test(clientSrc)
say(reExport, 'client/live.ts 以 `export type { SourceKind }` **re-export**（对外 import 路径不变）')

/* ══════════════════════════════════════════════════════════════════
   C/D/E · 实跑 host 编译产物（不凭源码猜）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── C/D/E 实跑 host 产物（不变量 / 四数分账 / 座位文案）──')
if (!existsSync(HOST_JS)) {
  say(false, `找不到 host 产物 ${relative(ROOT, HOST_JS)} ⟵ 先跑 \`node tools/build.mjs\`（禁「只 tsc --noEmit 即全绿」）`)
} else {
  const mod = await import(pathToFileURL(HOST_JS).href)
  const { scaffoldState, assertSeatMemberConsistency, summarizeSeats, seatText } = mod
  const clone = (s) => JSON.parse(JSON.stringify(s))

  /* C-1 正例：scaffold 种子必须自洽 */
  const seed = scaffoldState()
  const okSeed = assertSeatMemberConsistency(seed)
  say(okSeed.ok === true, `C-1 正例：scaffold 种子 ok=${okSeed.ok}（问题：${okSeed.issues.map((i) => i.code).join(',') || '无'}）`)

  /* C-2 负例：占座 + 非成员（T-1 明禁） */
  const bad1 = clone(seed)
  bad1.seats[0].membershipActive = false
  const r1 = assertSeatMemberConsistency(bad1)
  say(r1.ok === false && r1.issues.some((i) => i.code === 'occupied_but_removed'), `C-2 负例「占座但非成员」⇒ 非 ok（${r1.issues.map((i) => i.code).join(',')}）`)

  /* C-3 负例：空位带在场态 */
  const bad2 = clone(seed)
  bad2.seats[4].presence = 'away'
  const r2 = assertSeatMemberConsistency(bad2)
  say(r2.ok === false && r2.issues.some((i) => i.code === 'vacant_with_presence'), `C-3 负例「空位带 presence」⇒ 非 ok（${r2.issues.map((i) => i.code).join(',')}）`)

  /* C-4 负例：移除但未释放座位 */
  const bad3 = clone(seed)
  bad3.seats[1].membershipActive = false // 仍是 occupied ⇒ 移除未释放
  const r3 = assertSeatMemberConsistency(bad3)
  say(r3.ok === false && r3.issues.some((i) => i.code === 'removed_not_released'), `C-4 负例「移除未释放座位」⇒ 非 ok（${r3.issues.map((i) => i.code).join(',')}）`)

  /* C-5 负例：座位 ↔ 成员快照漂移（Seat 为权威源） */
  const bad4 = clone(seed)
  bad4.members[3].presence = 'present' // s4 是 away
  const r4 = assertSeatMemberConsistency(bad4)
  say(r4.ok === false && r4.issues.some((i) => i.code === 'presence_drift'), `C-5 负例「成员快照与座位漂移」⇒ 非 ok（${r4.issues.map((i) => i.code).join(',')}）`)

  /* D-1 四数分账：合计 == 座位数，且 awayButActive ⊆ occupied */
  const sum = summarizeSeats(seed)
  say(
    sum.occupied + sum.vacant + sum.removed === seed.seats.length,
    `D-1 四数合计 == 座位数（${sum.occupied}+${sum.vacant}+${sum.removed} = ${seed.seats.length}）`,
  )
  say(sum.awayButActive <= sum.occupied, `D-2 awayButActive ⊆ occupied（${sum.awayButActive} ≤ ${sum.occupied}）`)
  say(sum.occupied === 4 && sum.vacant === 1 && sum.removed === 0, `D-3 种子读数 = 4 占用 / 1 空位 / 0 已移除（实际 ${sum.occupied}/${sum.vacant}/${sum.removed}）`)

  /* D-4 移除项归 removed，不再被记成 vacant（判序回归） */
  const removedSeed = clone(seed)
  removedSeed.seats[4] = { ...removedSeed.seats[4], presence: null, membershipActive: false }
  const sum2 = summarizeSeats(removedSeed)
  say(
    sum2.removed === 1 && sum2.vacant === 0,
    `D-4 移除的座位归 removed 而非 vacant（removed=${sum2.removed} · vacant=${sum2.vacant}）`,
  )

  /* E 座位文案三档穷举 + 无「已移除」档 */
  const [c1, c2, c3] = [
    seatText({ id: 'x', label: 'x', status: 'vacant', presence: null, membershipActive: true }),
    seatText({ id: 'x', label: 'x', status: 'occupied', presence: 'away', membershipActive: true }),
    seatText({ id: 'x', label: 'x', status: 'occupied', presence: 'present', membershipActive: true }),
  ]
  say(c1 === '空位 · 可邀请', `E-1 空位 ⇒ 「${c1}」`)
  say(c2 === '离座 · 留痕在', `E-2 离座（占座）⇒ 「${c2}」`)
  say(c3 === '在场', `E-3 在场 ⇒ 「${c3}」`)
  const hasRemovedBranch = [c1, c2, c3].some((t) => t.includes('已移除'))
  say(!hasRemovedBranch, 'E-4 三档中**没有**「已移除」（T-1：移除即回空位，该分支是死码）')
}

/* ══════════════════════════════════════════════════════════════════
   F · 产物同源（R-7）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── F. 产物同源（`lib/client.js`）──')
if (!existsSync(CLIENT_BUNDLE)) {
  say(false, `找不到 ${relative(ROOT, CLIENT_BUNDLE)} ⟵ 先跑 \`node tools/build.mjs\``)
} else {
  const bundle = readFileSync(CLIENT_BUNDLE, 'utf8')
  const count = (needle) => bundle.split(needle).length - 1
  say(count('VACANT') === 0, `F-1 已删的 ` + '`VACANT`' + ` 导出在产物中 0 命中（实际 ${count('VACANT')}）`)
  /* ★ 2026-10-18 修：原判据查「已移除」三字 = 0 命中 —— 过宽。
   *   面板汇总行 `${sum.removed} 已移除` 是**合法统计标签**（4 占用 / 1 空位 / 0 已移除）。
   *   T-1 要删的是**座位档位文案**「已移除 · 释放回空位池」（不可达死码），
   *   且该档位是否真的不存在，已由 E-4 实跑产物验证。此处只钉死那串旧档文案。 */
  say(count('已移除 · 释放回空位池') === 0, `F-2 旧档文案「已移除 · 释放回空位池」在产物中 0 命中（实际 ${count('已移除 · 释放回空位池')}）`)
  say(count('空位 · 可邀请') >= 1, `F-3 「空位 · 可邀请」在产物中 ≥1（实际 ${count('空位 · 可邀请')}）`)
}

/* ══════════════════════════════════════════════════════════════════
   G · 阴面对照
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── G. 阴面对照：A/B 真的会 FAIL 吗（内存假样本）──')
const FAKE = `export function f(a: number): string {\n  if (a > 0) return 'x'\n  return 'y'\n}`
const FAKE_SAME = `export function f(a: number): string {\n  /* 不同注释 */\n  if (a > 0) return 'x'\n  return 'y'\n}`
const FAKE_DIFF = `export function f(a: number): string {\n  if (a > 0) return 'x'\n  return 'z'\n}`
const FAKE_NORET = `export function g(a: { k: number }): { v: number } {\n  return { v: a.k }\n}`
say(normalize(functionBody(FAKE, 'f')) === normalize(functionBody(FAKE_SAME, 'f')), 'G-1 对照基准：仅注释不同 ⇒ 判**一致**（去注释生效，不会误红）')
say(normalize(functionBody(FAKE, 'f')) !== normalize(functionBody(FAKE_DIFF, 'f')), 'G-2 改一个字符 ⇒ 判**不一致**（真的在逐字比）')
const gBody = functionBody(FAKE_NORET, 'g')
say(gBody !== null && normalize(gBody) === normalize('{return{v:a.k}}'), 'G-3 参数/返回类型都含 `{}` 时仍能定位到**函数体**（R-17 定位法自证）')
const fakeDefs = ['export type SourceKind = 1', 'export type SourceKind = 2'].filter((t) => /export\s+type\s+SourceKind\s*=/.test(t))
say(fakeDefs.length === 2, 'G-4 两份定义 ⇒ 判**红**（单落点断言真的在数）')

console.log(`\n${failed === 0 ? `✓ 全过：${FUNCS.length}/${FUNCS.length} 函数体一致 · SourceKind 1 处定义 · 不变量正负例齐` : `✗ 有 ${failed} 条 FAIL`}`)
process.exit(failed === 0 ? 0 : 1)
