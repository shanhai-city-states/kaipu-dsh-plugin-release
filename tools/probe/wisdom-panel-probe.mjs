#!/usr/bin/env node
/**
 * 山海·开铺 · 智囊团插件 · **面板语义判据**（`wisdom-panel-probe.mjs`）
 * =====================================================================
 * ★★ 本探针与另几个的分工（别混）：
 *   · `live-probe.mjs`       —— 场地面板的**数据源通路**（真/未接入）
 *   · `run-view-probe.mjs`   —— 场地面板的**运行视图渲染**（契约 renderRules）
 *   · `copy-probe.mjs`       —— 场地面板的**错误文案**
 *   · **本探针**             —— 智囊团面板的**语义层**：灯位状态归类 + 状态带区分 + 空态
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★★ 为什么本探针**不用 CDP / 不起浏览器**（这是一个刻意的选择）
 * ─────────────────────────────────────────────────────────────────────
 *
 * 本探针要断的三件事 —— `LampState` 归类 / `summarize` 汇总 / `summaryText` 文案 ——
 * **全是纯函数**。纯函数用浏览器去断，会得到一个**弱得多**的判据：
 *   · 慢（要起 DSH + 浏览器 + 等 3.5s）
 *   · 样本受限（只能断"当前真实数据恰好长成的那一种"，构造不出边界样本）
 *   · **且不能证伪**：真实数据现在 5/5 全是 `pending` ⇒ 你断不出
 *     `vacant` / `disabled` / 混合 这几种情形**到底会不会分对类**。
 *
 * ⇒ 所以本探针**直接 require 被测模块的编译产物**（`lib/client/live.js`），
 *   喂**构造样本**，断言**真返回值**。
 *
 * ★★ 关键纪律：**判据调的是被测代码本身，不是抄来的一份副本。**
 *   若在这里手抄一份 `summarize` 的实现来测，那测的是"我抄得对不对"，
 *   与真代码是否漂移**完全无关** —— 那正是本项目反复吃亏的那类假判据。
 *   （所以上面那句"直接 require 产物"不是实现细节，**是本判据成立的前提**。）
 *
 * ⚠️ 由此带来的一条**依赖**：本探针读的是**编译产物**（`lib/`），**不是 `src/`**。
 *    ⇒ 改了 `src` 没跑 tsc ⇒ 本探针测的是**旧代码**。
 *    ⇒ 这条由下面 §0 的**新鲜度断言**看护（比"改完记得跑 tsc"可靠）。
 *
 * 用法：node tools/probe/wisdom-panel-probe.mjs
 * 退出码：0 = 全过；1 = 有失败
 */
import { readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const LIB_DIR = join(ROOT, 'packages/plugin-wisdom/lib/client')

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failed++
}

/* ══════════════════════════════════════════════════════════════════
   §-1 加载被测模块（★ 加载的是产物本身，见文件头那段纪律）
   ══════════════════════════════════════════════════════════════════

   为什么用 `new Function` 而不是 `import()` / `require()`：
     本仓 `package.json` 是 `"type": "module"` ⇒ 产物里的 `.js` 是 **CommonJS 文本**，
     但 Node 会按 ESM 解析它 ⇒ `require is not defined` / `Cannot find module`。
     ⇒ 自己给一个最小 CJS 环境执行它。**这不是 hack，是"产物是 CJS"这个事实**。
     （`tools/build-client.mjs` 的注释解释了为什么产物必须是 CJS：
       宿主 closure 是 lazy CJS 表。）
*/
function loadCjs(absPath, seen = new Map()) {
  const key = absPath.replace(/\\/g, '/')
  if (seen.has(key)) return seen.get(key)
  if (!existsSync(absPath)) {
    console.log(`  ✗ 找不到产物 ${relative(ROOT, absPath)} ⇒ 先跑 node tools/build.mjs`)
    process.exit(1)
  }
  const mod = { exports: {} }
  seen.set(key, mod.exports)
  const req = (spec) => {
    if (!spec.startsWith('.')) return {} // 外部模块（react 等）—— 纯函数层用不到
    const p = join(dirname(absPath), spec)
    return loadCjs(existsSync(p) ? p : `${p}.js`, seen)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', readFileSync(absPath, 'utf8'))(mod, mod.exports, req)
  seen.set(key, mod.exports)
  return mod.exports
}

const LIB = loadCjs(join(LIB_DIR, 'live.js'))

/* ══════════════════════════════════════════════════════════════════
   §0 ★★ 产物新鲜度（改了 src 没跑 tsc ⇒ 测的是旧代码）
   ══════════════════════════════════════════════════════════════════

   ★★ 这条为什么必须存在：本探针测**产物**，所以"改 src 没跑 tsc"会让我
      **测旧代码却报全绿** —— 那是最坏的一种假绿（判据在跑，但跑的不是我改的东西）。
      全仓已有同族教训：`check-remote-bridge` 因按印象猜产物路径而发出假警报。

   ★★★ 两条判据缺一不可（这是**第二轮才补上的**，第一版只有第一条）：

     ① **时间戳**：产物不早于源码。
     ② **导出一致**：产物真的导出了本探针要调的每个符号。

     为什么单靠①会漏 —— 我第一次跑阴面对照时**实测到了**：
       注入一个类型错误的缺陷 ⇒ `tsc` **构建失败** ⇒ `lib/` 停在**上一版**；
       而失败那次的写入时间**晚于**我在别的文件里的改动 ⇒ ① 照样判"新鲜"。
       ⇒ 探针于是对着**半旧的产物**跑，报出**一个与缺陷无关的失败**（1 项未过），
         而那个失败**指向了错误的方向**（我自己都愣了一下）。
       ⇒ 这就是"判据自己会误导人"——比没有判据更坏。

     ★ 所以②是必需的：它断的是"**产物里有没有我以为在那儿的东西**"。
       构建失败时产物停在旧版 ⇒ 若我新加的导出不在里面，②当场 FAIL
       并**明确说"先跑 build"**，而不是让①的假绿把它放过去。
*/
console.log('\n── §0 ★★ 产物新鲜度（改了 src 没跑 tsc ⇒ 测的是旧代码）──')

/* ── ② 导出一致：产物里真的有本探针要调的每个符号 ──
 *
 * ★ 这条是**时间戳之外**的必需项（见上面 §0 的"两条判据缺一不可"）。
 */
{
  const NEEDED = ['loadLive', 'setConnection', 'summarize', 'summaryText', 'lampText']
  const missingExports = NEEDED.filter((k) => typeof LIB[k] !== 'function')
  if (missingExports.length > 0) {
    say(false, `产物缺少导出：${missingExports.join(', ')}`)
    console.log(`     ⇒ 先跑 \`node tools/build.mjs\`。**构建失败时 lib/ 会停在上一版**，`)
    console.log(`        此时时间戳可能仍判"新鲜" —— 本检查就是兜住那种情况的那一道。`)
    process.exit(1) // ★ 硬中断：**绝不能**拿着不确定的产物继续跑语义断言
  }
  say(true, `产物导出齐备（${NEEDED.join(', ')}）`)
}

const PAIRS = [
  ['src/client/live.ts', 'lib/client/live.js'],
  ['src/client/bridge.ts', 'lib/client/bridge.js'],
  ['src/client/theme.ts', 'lib/client/theme.js'],
]
let stale = 0
for (const [s, l] of PAIRS) {
  const sp = join(ROOT, 'packages/plugin-wisdom', s)
  const lp = join(ROOT, 'packages/plugin-wisdom', l)
  if (!existsSync(sp) || !existsSync(lp)) {
    say(false, `${s} 或 ${l} 不存在`)
    stale++
    continue
  }
  const st = statSync(sp).mtimeMs
  const lt = statSync(lp).mtimeMs
  // 允许 1s 容差（同一秒内的 tsc 写入不该被判 stale）
  const ok = lt >= st - 1000
  say(ok, `${l} ${ok ? '不早于' : '**早于**'} ${s}${ok ? '' : ' ⇒ 漏跑 tsc'}`)
  if (!ok) stale++
}

/* ★★ 硬中断：产物不新鲜时，**后面所有语义断言的结论都不可信**
 *   （它们断的是旧代码）。继续跑只会产出一堆"看起来在验证"的输出，
 *   而真结论是"什么都没验证到" ⇒ 那正是本探针最想避免的那类假绿。
 *   ⇒ 在这里停，并**说清怎么办**。 */
if (stale > 0) {
  console.log(`\n✗ 产物不新鲜（${stale} 项）—— 停在这里，不跑语义断言`)
  console.log('  ⇒ 语义断言读的是产物；产物不新鲜时它们的结论**全部不可信**。')
  console.log('  ⇒ 先跑 `node tools/build.mjs`（构建失败时 lib/ 会停在上一版，')
  console.log('     此时时间戳检查正是唯一能发现它的那道）。')
  process.exit(1)
}

/* ══════════════════════════════════════════════════════════════════
   §1 ★★ 灯位归类：`loadLive` 的判定链（唯一语义核心）
   ══════════════════════════════════════════════════════════════════

   判定链（承 `live.ts` 的 `normalizeLamp`）：
     ① `agentId` 为空 ⇒ `vacant`
     ② `agentId` 查不到 ⇒ `vacant`（fail-closed：无法证明有人）
     ③ 查到：`enabled` ⇒ `ready`；其余（`pending`/`disabled`/未知）⇒ `registered`

   ★ 怎么喂样本：`loadLive` 走的是真 rpc。这里用一个**假 connection** 注入，
     让它走完整链路 —— 这样测的是**真判定链**，不是某个内部小函数。
     （`setConnection` 是导出的，正是给这个用的。）
*/
console.log('\n── §1 灯位归类（喂构造样本给真判定链）──')

/** 造一个假 connection，按方法名回不同的 payload */
function fakeConn(scenes, agents, opts = {}) {
  const calls = []
  const conn = {
    rpc: {
      async call(_channel, endpoint, payload) {
        calls.push({ endpoint, payload })
        if (opts.fail === endpoint) {
          return { ok: false, error: { code: opts.failCode ?? 'x', message: opts.failMsg ?? '模拟失败' } }
        }
        const method = String(endpoint).split('/')[1]
        if (method === 'status') {
          return {
            ok: true,
            value: { ok: true, data: { connected: true, baseUrl: 'https://example.test/kai-pu', accountId: 'probe' } },
          }
        }
        if (method === 'listScenes') return { ok: true, value: { ok: true, data: { scenes } } }
        if (method === 'listAgents') return { ok: true, value: { ok: true, data: { agents } } }
        return { ok: false, error: { code: 'unknown_endpoint', message: `没这个端点：${endpoint}` } }
      },
    },
  }
  return { conn, calls }
}

/** 真样本（实测自 2026-10-06 服务端：5 条灯全指向 zhinangtuan，status=pending） */
const REAL_SCENES = [
  {
    scene: 'light-review',
    label: '轻量审（单维度快速）',
    lamps: [{ lamp: '综合维度', agentId: 'zhinangtuan', agentName: '(待接入)' }],
  },
  {
    scene: 'multi-dim-review',
    label: '多维度会商审校',
    lamps: [
      { lamp: '战略维度', agentId: 'zhinangtuan', agentName: '(待接入)' },
      { lamp: '技术维度', agentId: 'zhinangtuan', agentName: '(待接入)' },
      { lamp: '安全维度', agentId: 'zhinangtuan', agentName: '(待接入)' },
      { lamp: '人文维度', agentId: 'zhinangtuan', agentName: '(待接入)' },
    ],
  },
]
const REAL_AGENTS = [{ id: 'zhinangtuan', name: '(待接入)', role: '综合维度', status: 'pending' }]

/* ── 1.1 真样本：5 条灯全 pending ⇒ 5 条 registered（**不是 vacant**）── */
{
  const { conn } = fakeConn(REAL_SCENES, REAL_AGENTS)
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.kind === 'live', `真样本 ⇒ kind='live'（实测 '${snap.kind}'）`)
  say(snap.lamps.length === 5, `5 条灯位（实测 ${snap.lamps.length}）`)
  const allReg = snap.lamps.every((l) => l.state === 'registered')
  say(allReg, `5 条全判为 registered${allReg ? '' : `（实际：${snap.lamps.map((l) => l.state).join(', ')}）`}`)
  say(
    snap.lamps.every((l) => l.agentId === 'zhinangtuan'),
    '5 条都保留了 agentId（**没有**因为 pending 就抹成 null）',
  )
  // ★ 这条最要紧：`(待接入)` 是**显示名**，不许被当成判定依据
  say(
    snap.lamps.every((l) => l.rawStatus === 'pending'),
    'rawStatus 如实保留 pending（悬停提示要用它说真话）',
  )
}

/* ── 1.2 ★ `agentId: null` ⇒ vacant（与 registered **必须不同类**）── */
{
  const { conn } = fakeConn([{ scene: 's', label: 'S', lamps: [{ lamp: '空位维度', agentId: null, agentName: null }] }], [])
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.lamps[0]?.state === 'vacant', `agentId=null ⇒ vacant（实测 '${snap.lamps[0]?.state}'）`)
  // ★★ 关键：vacant 与 registered **不能同形** —— 否则"内部区分"就无从谈起
  const { conn: c2 } = fakeConn(
    [{ scene: 's', label: 'S', lamps: [{ lamp: '空位维度', agentId: 'a1', agentName: 'A' }] }],
    [{ id: 'a1', name: 'A', status: 'pending' }],
  )
  LIB.setConnection(c2)
  const snap2 = await LIB.loadLive()
  say(
    snap.lamps[0]?.state !== snap2.lamps[0]?.state,
    `空位(null) 与 已登记(pending) **判成不同类**（'${snap.lamps[0]?.state}' vs '${snap2.lamps[0]?.state}'）`,
  )
}

/* ── 1.3 ★ fail-closed：id 查不到 ⇒ vacant（不编"有人"）── */
{
  const { conn } = fakeConn(
    [{ scene: 's', label: 'S', lamps: [{ lamp: '幽灵维度', agentId: 'ghost-id', agentName: 'X' }] }],
    [], // ← /agents 里没有这个 id
  )
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.lamps[0]?.state === 'vacant', `id 在 /agents 查不到 ⇒ vacant（fail-closed，实测 '${snap.lamps[0]?.state}'）`)
  say(snap.lamps[0]?.agentId === null, '查不到 ⇒ agentId 收敛成 null（不把幽灵 id 传给界面）')
}

/* ── 1.4 ★ `disabled` ⇒ registered（**不编成 vacant**，也不进 ready）── */
{
  const { conn } = fakeConn(
    [{ scene: 's', label: 'S', lamps: [{ lamp: '停用维度', agentId: 'a1', agentName: 'A' }] }],
    [{ id: 'a1', name: 'A', status: 'disabled' }],
  )
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  const st = snap.lamps[0]?.state
  say(st === 'registered', `status='disabled' ⇒ registered（实测 '${st}'）`)
  say(
    snap.lamps[0]?.rawStatus === 'disabled',
    'rawStatus 如实保留 disabled ⇒ 悬停能说"被停用"（行文案同形但提示不说谎）',
  )
  // ★ 反面：**绝不许**进 ready（"能干活"是 ready 的语义）
  say(st !== 'ready', '★ disabled **不**进 ready（被停用的位子不能说"已就绪"）')
}

/* ── 1.5 ★ enabled ⇒ ready ── */
{
  const { conn } = fakeConn(
    [{ scene: 's', label: 'S', lamps: [{ lamp: '在岗维度', agentId: 'a1', agentName: '甲谋士' }] }],
    [{ id: 'a1', name: '甲谋士', status: 'enabled' }],
  )
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.lamps[0]?.state === 'ready', `status='enabled' ⇒ ready（实测 '${snap.lamps[0]?.state}'）`)
  say(snap.lamps[0]?.agentName === '甲谋士', 'ready 时保留显示名')
}

/* ── 1.6 ★ 未知 status ⇒ registered（**不编 disabled**，承场地侧教训）── */
{
  const { conn } = fakeConn(
    [{ scene: 's', label: 'S', lamps: [{ lamp: '未知维度', agentId: 'a1', agentName: 'A' }] }],
    [{ id: 'a1', name: 'A', status: 'weird-value-from-future' }],
  )
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(
    snap.lamps[0]?.rawStatus === 'pending',
    `未知 status ⇒ 收敛成 pending（**不编 disabled**，实测 '${snap.lamps[0]?.rawStatus}'）`,
  )
}

/* ── 1.7 ★ 场景归属反查 ── */
{
  const { conn } = fakeConn(REAL_SCENES, REAL_AGENTS)
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  const zh = snap.lamps.find((l) => l.lamp === '综合维度')
  const zhan = snap.lamps.find((l) => l.lamp === '战略维度')
  say(
    zh?.scenes.length === 1 && zh.scenes[0].includes('轻量审'),
    `综合维度 只归属「轻量审」（实测 ${JSON.stringify(zh?.scenes)}）`,
  )
  say(
    zhan?.scenes.length === 1 && zhan.scenes[0].includes('多维度'),
    `战略维度 归属「多维度会商审校」（实测 ${JSON.stringify(zhan?.scenes)}）`,
  )
}

/* ── 1.8 ★ 老形状（字符串数组 / lampNames）也要能吃 ── */
{
  const { conn } = fakeConn(
    [{ scene: 's', label: 'S', lampNames: ['甲维度', '乙维度'] }],
    [{ id: 'a1', name: 'A', status: 'enabled' }],
  )
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.lamps.length === 2, `老形状 lampNames ⇒ 解出 2 条灯位（实测 ${snap.lamps.length}）`)
  // ★ 字符串形状**没有 agentId** ⇒ 一律 vacant（**不靠 role 猜** —— 场地侧在这条上吃过亏）
  say(
    snap.lamps.every((l) => l.state === 'vacant'),
    '★ 老形状**不靠 role 猜**执行方 ⇒ 一律 vacant（承场地侧 mapLamps 的教训）',
  )
}

/* ══════════════════════════════════════════════════════════════════
   §2 ★★ 状态带汇总 —— 043 裁定「内部区分已登记/未登记」的落点
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── §2 ★ 状态带汇总（043 Q1 裁定的可断言面）──')

const mk = (n, state) =>
  Array.from({ length: n }, (_, i) => ({
    lamp: `L${i}`,
    state,
    agentId: state === 'vacant' ? null : 'a',
    agentName: state === 'vacant' ? null : 'A',
    rawStatus: state === 'vacant' ? null : state === 'ready' ? 'enabled' : 'pending',
    scenes: [],
  }))

{
  // ★ 真样本形态：5 条 registered ⇒ 汇总必须报「5 已登记待启用」，**不是**「5 未登记」
  const s = LIB.summarize(mk(5, 'registered'))
  say(s.total === 5 && s.registered === 5 && s.vacant === 0, `5×registered ⇒ ${JSON.stringify(s)}`)
  const t = LIB.summaryText(s)
  say(t.includes('5 已登记待启用'), `★ 文案含「5 已登记待启用」（实测 ${JSON.stringify(t)}）`)
  say(!t.includes('未登记'), '★ 文案**不含**「未登记」（那会把"有人了"说成"没人"）')
}

{
  // ★★ 混合样本：这才是"区分"真正被检验的地方
  const s = LIB.summarize([...mk(2, 'ready'), ...mk(3, 'registered'), ...mk(4, 'vacant')])
  say(
    s.total === 9 && s.ready === 2 && s.registered === 3 && s.vacant === 4,
    `混合样本 ⇒ ${JSON.stringify(s)}`,
  )
  const t = LIB.summaryText(s)
  say(
    t.includes('2 在位') && t.includes('3 已登记待启用') && t.includes('4 未登记'),
    `★ 三类**同时在场**（实测 ${JSON.stringify(t)}）`,
  )
}

{
  // ★ 不变式：vacant + registered + ready === total（用随机样本压一遍）
  let bad = 0
  for (let i = 0; i < 200; i++) {
    const pool = ['vacant', 'registered', 'ready']
    const arr = []
    const n = Math.floor(Math.random() * 12)
    for (let j = 0; j < n; j++) arr.push(...mk(1, pool[Math.floor(Math.random() * 3)]))
    const s = LIB.summarize(arr)
    if (s.vacant + s.registered + s.ready !== s.total) bad++
    if (s.vacant < 0 || s.registered < 0 || s.ready < 0) bad++
  }
  say(bad === 0, `200 组随机样本：vacant+registered+ready === total 恒成立${bad === 0 ? '' : `（${bad} 组破坏）`}`)
}

{
  // ★★ 空数组 ⇒ 全 0，且文案**必须**是「暂无灯位」而不是「0 灯位 · 0 未登记」
  const s = LIB.summarize([])
  say(s.total === 0 && s.vacant === 0 && s.registered === 0, `空数组 ⇒ ${JSON.stringify(s)}`)
  const t = LIB.summaryText(s)
  say(t === '暂无灯位', `★ 空灯位文案 = 「暂无灯位」（实测 ${JSON.stringify(t)}）`)
  // ★ 反面：绝不许显成"全待接入"那种形态
  say(!t.includes('待接入') && !t.includes('未登记'), '★ 空灯位**不**显成「待接入/未登记」（那是"你没人"，实为"没灯组"）')
}

/* ══════════════════════════════════════════════════════════════════
   §3 ★★ 灯位行文案 —— Q1=a 的**保守面**（行不区分，汇总才区分）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── §3 ★ 灯位行文案（Q1=a：行不区分 vacant/registered）──')

{
  const { lampText } = LIB
  if (typeof lampText !== 'function') {
    say(false, '`live.ts` 产物里没有导出 lampText ⇒ 行文案判据没法跑（见 live.ts 里"为什么它住数据层"）')
  } else {
    const row = (state) =>
      lampText({ lamp: 'X', state, agentId: state === 'vacant' ? null : 'a', agentName: 'A', rawStatus: null, scenes: [] })

    say(row('vacant') === '待接入', `vacant ⇒ 「待接入」（实测 ${JSON.stringify(row('vacant'))}）`)
    say(row('registered') === '待接入', `★ registered ⇒ 也显「待接入」（Q1=a 的保守面，实测 ${JSON.stringify(row('registered'))}）`)
    say(row('ready') === '已就绪', `ready ⇒ 「已就绪」（实测 ${JSON.stringify(row('ready'))}）`)

    // ★★ 这两条是**同一个裁定的两面**，必须同时成立 —— 并排断言，防将来只改一边
    say(
      row('vacant') === row('registered'),
      '★ 行文案上 vacant 与 registered **同形**（裁定 Q1=a 的第一面）',
    )
    const s1 = LIB.summaryText(LIB.summarize(mk(3, 'registered')))
    const s2 = LIB.summaryText(LIB.summarize(mk(3, 'vacant')))
    say(s1 !== s2, `★ 但汇总上两者**不同形**（裁定 Q1=a 的第二面：'${s1}' ≠ '${s2}'）`)
  }
}

/* ══════════════════════════════════════════════════════════════════
   §4 ★★ 读不到时**绝不显成"全待接入"**（本插件最容易犯的错）
   ══════════════════════════════════════════════════════════════════

   ★ 这条为什么最重要：智囊团**依赖场地插件在场**（端点由它注册）。
     场地不在场时，若界面显成「5 灯位 · 5 未登记」，用户会以为
     **"我这里没人"**，而实情是**"我读不到"** —— 下一步动作完全不同。
     ⇒ 那是**编造了一个不存在的事实**（与 `pending` 被误显成「已停用」同类）。
*/
console.log('\n── §4 ★ 读不到时的语义（绝不伪装成"全待接入"）──')

{
  /* 4.1 通道都没有 ⇒ no_channel */
  LIB.setConnection(null)
  const snap = await LIB.loadLive()
  say(snap.kind === 'no_channel', `无 connection ⇒ kind='no_channel'（实测 '${snap.kind}'）`)
  say(snap.lamps.length === 0, `★ 灯位为空数组（**不填**演示/伪造数据，实测 ${snap.lamps.length} 条）`)
  const t = LIB.summaryText(LIB.summarize(snap.lamps))
  say(t === '暂无灯位', `汇总文案 = 「暂无灯位」（实测 ${JSON.stringify(t)}）`)
  // ★★ 核心反面断言
  say(
    !t.includes('未登记') && !t.includes('待接入'),
    '★★ **绝不许**显成「N 未登记 / N 待接入」（那会把"读不到"说成"你没人"）',
  )
}

{
  /* 4.2 ★ 场地插件不在场（端点不存在）⇒ stale（**与"服务端故障"分开**）*/
  const { conn } = fakeConn([], [], {
    fail: 'kaipu/status',
    failCode: 'not_found',
    failMsg: '端点不存在',
  })
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.kind === 'stale', `端点不存在 ⇒ kind='stale'（**不是** unreachable，实测 '${snap.kind}'）`)
  say(snap.reason !== null && snap.reason.includes('场地'), `原因点出"场地插件"（实测 ${JSON.stringify(snap.reason)}）`)
  say(snap.lamps.length === 0, '灯位为空（不伪造）')
}

{
  /* 4.2b ★★ 真网关的实际形状（2026-10-06 真机验收抓到）：
     connection client 把 HTTP 404 **抛成异常**，message 形如
     "transport failure for /api/kaipu/status: HTTP 404"。
     ★ 404 = 网关应答了、只是没有这条路由（服务未注册）—— 不是"连不上"。
     bridge 据此把它归为 gateway/not_found ⇒ stale。若哪天有人把这条
     归类改回 transport，这条用例就会红 —— 那是真机上场地缺席的主路径。*/
  const conn = {
    rpc: {
      async call() {
        throw new Error('transport failure for /api/kaipu/status: HTTP 404')
      },
    },
  }
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.kind === 'stale', `HTTP 404 抛错（真形状）⇒ kind='stale'（实测 '${snap.kind}'）`)
  say(snap.lamps.length === 0, '灯位为空（不伪造）')
}

{
  /* 4.2c ★★ 同为 404，但带"我方拼串"指纹（detail 里出现 /api/ 段）⇒
     原因文案必须**分开说**（出路是查接入地址，不是查插件装载）。
     出处：本项目既有判定 `status-404-verdict.mjs` ——
     `/api/kaipu/status` 里的 `api` 是通道名、`kaipu` 是命名空间，
     **都不该出现在 HTTP URL 里**；那是客户端拼串问题，不是场地插件的球。*/
  const conn = {
    rpc: {
      async call() {
        throw new Error('transport failure for /api/kaipu/status: HTTP 404')
      },
    },
  }
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.kind === 'stale', `带 /api/ 指纹的 404 ⇒ 仍 kind='stale'（实测 '${snap.kind}'）`)
  say(
    snap.reason !== null && snap.reason.includes('接入地址'),
    `★ 原因指向"接入地址"（**不是**"插件未安装"）—— 实测 ${JSON.stringify(snap.reason)}`,
  )
  say(
    snap.reason !== null && !snap.reason.includes('未安装'),
    '★ 不得把这一个也归成"插件未安装"（那是另一回事，出路不同）',
  )
}

{
  /* 4.2d ★★ 网关 404 的**第二种投递形状**（服务端指南 v2 §三 实测形态）：
     宿主网关**不抛错**，直接回 `{success:false, message:"路径不存在: /api/kaipu/status"}`
     —— 用的是 `success`/`message` 键，与 `ok`/`error` 不是同一套。
     ★ 实测教训（2026-10-06）：不识别这组键 ⇒ code 取到 undefined ⇒ 归 `gateway` ⇒
     `looksLikeMissingEndpoint` 匹配不上 ⇒ 落到 `unreachable`「未连上」+ 泛泛的
     "网关调用失败"，**出路指错**（该查接入地址却让人查网络）。
     出处：指南 v2 判读纪律 3「报错里出现的路径未必是真实路径 —— 先问这个串是谁拼的」。*/
  const conn = {
    rpc: {
      async call() {
        return { success: false, message: '路径不存在: /api/kaipu/status' }
      },
    },
  }
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.kind === 'stale', `网关 success:false 体 ⇒ kind='stale'（实测 '${snap.kind}'）`)
  say(
    snap.reason !== null && snap.reason.includes('接入地址'),
    `★ 原因指向"接入地址"—— 实测 ${JSON.stringify(snap.reason)}`,
  )
  say(snap.lamps.length === 0, '灯位为空（不伪造）')
}

{
  /* 4.3 传输断（服务端连不上）⇒ unreachable */
  const conn = { rpc: { async call() { throw new Error('ECONNREFUSED') } } }
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.kind === 'unreachable', `传输失败 ⇒ kind='unreachable'（实测 '${snap.kind}'）`)
  say(snap.lamps.length === 0, '灯位为空（**绝不悄悄回落 mock**）')
}

{
  /* 4.4 未配地址（connected:false）⇒ unreachable 且措辞是"未接入"不是"故障" */
  const conn = {
    rpc: {
      async call() {
        return {
          ok: true,
          value: { ok: true, data: { connected: false, baseUrl: '', accountId: '' } },
        }
      },
    },
  }
  LIB.setConnection(conn)
  const snap = await LIB.loadLive()
  say(snap.kind === 'unreachable', `connected:false ⇒ unreachable（实测 '${snap.kind}'）`)
  say(
    snap.label.includes('未接入') && !snap.label.includes('故障'),
    `★ 措辞是「未接入」不是「故障」（实测 ${JSON.stringify(snap.label)}）`,
  )
}

console.log(`\n${failed === 0 ? '✓ 通过：智囊团面板语义如声明' : `✗ ${failed} 项未过`}`)
process.exit(failed === 0 ? 0 : 1)

/* ══════════════════════════════════════════════════════════════════
   留痕：一个**没走通**的取数思路（写在 `process.exit` 之后，永不执行）
   ══════════════════════════════════════════════════════════════════

   第一版里，`lampText` 住在 `WisdomPanel.tsx`（界面层）。为了断"行文案"，我写了
   一个 `importLibPanel()`：用上面那个 `loadCjs` 去 require `WisdomPanel.js`，
   对非相对 specifier（`react`）返回 `{}` 当桩 —— 因为 `lampText` 是纯函数、
   不碰 react，所以"应该能跑"。

   ★ **那个思路能跑，但它是错的**，理由比"能跑"重要：

     判据要通过"给 react 打桩"才能调到一个函数 —— 这说明**这个函数住错了地方**。
     正确做法不是把桩写得更精巧，而是**把它搬到不需要框架的地方**。
     ⇒ 已搬到 `live.ts`（数据层），本探针现在直接 `LIB.lampText`。

   ★★ 这条可推广成一条分层纪律（已写进 `live.ts` 的 `lampText` 注释）：

     > **可被断言的纯逻辑，不放在需要框架运行时的文件里。**

     它与本项目"判据必须调被测代码本身"那条纪律是**配套的** ——
     光有"要测真代码"的意愿不够；若代码住在框架文件里，最后还是要 mock，
     而 **mock 测的是 mock**。

   ★ 为什么把这段"没走通的路"留在这里而不是删掉：
     下一个要写同类判据的人，很可能**正巧会想到同一个办法**（它看起来很自然）。
     留一段话的成本，比让他重走一遍再自己发现低。
     —— 与 `bridge.ts` 里"加 inject 拿 remote 是一条看起来最自然、实际走不通的路"
       那段留痕同款。
 */
