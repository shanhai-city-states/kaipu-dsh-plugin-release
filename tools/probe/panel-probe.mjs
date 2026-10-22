#!/usr/bin/env node
/**
 * 山海·开铺 · 面板装载探针（Step 2 判据的可复用形态）
 * =====================================================================
 * 断言"插件真的在界面上活了"—— 这是**动态**判据，与两个静态断言互补：
 *
 *   tools/check-decoupling.mjs   静态：两插件互不依赖（A-1/A-2）
 *   tools/check-package.mjs      静态：产物可独立分发
 *   ★ 本脚本                     动态：装进真 DSH 后，界面上**真的有**
 *
 * 用法（需先起 DSH web + 一个开了 CDP 的浏览器，见 --help）：
 *
 *   node tools/probe/panel-probe.mjs --expect=开铺,智囊团
 *   node tools/probe/panel-probe.mjs --expect=开铺 --absent=智囊团     ← INV-17 装卸判据
 *   node tools/probe/panel-probe.mjs --expect=开铺 --shot=dev/shot.png
 *
 * 退出码：0 = 全部断言通过；1 = 有失败
 *
 * ── 为什么用 CDP 而不是 Playwright ────────────────────────────────
 *   Node 22 自带全局 `WebSocket` ⇒ 直连 CDP **零依赖**。
 *   本仓的规矩是"能不带依赖就不带"（少一处版本坑，也少一处 `clean-scan` 风险）。
 *   Playwright 的价值在跨浏览器与复杂交互；本场景只需要「读 DOM + 点一下」。
 *
 * ── 起环境的完整命令（在本仓根执行；<DSH_REPO> 换成 DSH 仓库）──
 *
 *   1) 生成 profile（首建方建链接）：
 *        node tools/setup-dev-profile.mjs
 *   2) 起 DSH web（在 <DSH_REPO> 下）：
 *        DSH_HOME=<本仓>/dev/dsh-home node --expose-internals --import tsx/esm \
 *          apps/cli/src/bin.ts web --no-open --port 3090
 *      ⇒ 从 stdout 抄下带 token 的 URL
 *   3) 起一个开 CDP 的浏览器（Windows 自带 Edge 就够，headless）：
 *        msedge --headless=new --remote-debugging-port=9222 \
 *          --user-data-dir=<本仓>/dev/edge-profile "<URL>"
 *   4) node tools/probe/panel-probe.mjs --expect=开铺,智囊团
 */
const argv = process.argv.slice(2)
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? undefined : hit.slice(name.length + 3)
}
const list = (name) => (flag(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean)

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法：node tools/probe/panel-probe.mjs --expect=开铺,智囊团 [--absent=X] [--shot=path.png] [--port=3090] [--cdp=9222]')
  process.exit(0)
}

const CDP_PORT = flag('cdp') ?? '9222'
const APP_PORT = flag('port') ?? '3090'
const EXPECT = list('expect')
const ABSENT = list('absent')
const SHOT = flag('shot')

if (EXPECT.length === 0 && ABSENT.length === 0) {
  console.error('✗ 至少要给 --expect=<逗号分隔的入口名> 或 --absent=<…>')
  process.exit(2)
}

/* ── 连接 CDP ── */
async function pickTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
      const t = l.find((x) => x.type === 'page' && String(x.url).includes(APP_PORT))
      if (t) return t
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`CDP(:${CDP_PORT}) 里找不到 :${APP_PORT} 的页面 target —— 浏览器起了吗？URL 带 token 了吗？`)
}

const target = await pickTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id
  pending.set(i, res)
  ws.send(JSON.stringify({ id: i, method, params }))
})
const evalIn = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

/* ── 断言 1：侧边栏入口 ── */
const WAIT_APP = `async (ms) => {
  const dl = Date.now() + ms
  while (Date.now() < dl) {
    if (document.querySelectorAll('[aria-label]').length > 8) return true
    await new Promise(r => setTimeout(r, 400))
  }
  return false
}`

/**
 * ★★ 为什么要"渲染不出来就自己重载一次"：
 *   实测过一种情况 —— 浏览器**进程起来了、CDP 也连上了**，但页面是空 DOM
 *   （典型是 profile 目录被上一个实例占着、或首帧导航没落地）。
 *   这时如果直接断言，会得到"所有入口都不存在"的**假阴性**，
 *   然后人去怀疑插件坏了 —— **查错方向被带偏**（这一轮就差点）。
 *   ⇒ 探针自己负责把页面弄到可断言状态：先等，等不到就 `Page.navigate` 重载再等。
 */
async function waitForApp(ms) {
  const r = await evalIn(`(${WAIT_APP})(${ms})`)
  return r === true
}

let appReady = await waitForApp(40000)
let reloaded = false
if (!appReady) {
  reloaded = true
  await send('Page.navigate', { url: target.url })
  appReady = await waitForApp(30000)
}

const A = await evalIn(`(() => {
  const pick = (sel, attr) => [...document.querySelectorAll(sel)].map(e => e.getAttribute(attr)).filter(Boolean)
  return {
    labels: [...new Set(pick('[aria-label]', 'aria-label'))],
    titles: [...new Set(pick('[title]', 'title'))],
    href: location.href,
    title: document.title,
    body: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 200),
  }
})()`)

if (reloaded) console.log(`  ⚠ 首帧空 DOM —— 已自动重载一次（href=${A.href}）`)
if (!appReady) {
  console.log(`  ⚠ 页面仍未渲染出可断言的 DOM：`)
  console.log(`      title   : ${A.title}`)
  console.log(`      location: ${A.href}`)
  console.log(`      body    : ${A.body}`)
  console.log(`    ⇒ 这类"空 DOM"通常是**浏览器/导航**问题，不是插件问题 —— 别往插件方向查。`)
}

const allEntries = [...A.labels, ...A.titles]
const hits = (v) => allEntries.some((x) => String(x).includes(v))

const fails = []
console.log(`── 断言 1 · 侧边栏入口（CDP :${CDP_PORT} → :${APP_PORT}）──`)
for (const v of EXPECT) {
  const ok = hits(v)
  console.log(`  ${ok ? '✓' : '✗'} 存在「${v}」`)
  if (!ok) fails.push(`入口「${v}」不存在`)
}
for (const v of ABSENT) {
  const ok = !hits(v)
  console.log(`  ${ok ? '✓' : '✗'} 已消失「${v}」（装卸判据）`)
  if (!ok) fails.push(`入口「${v}」本该消失却仍在`)
}
console.log(`  当前入口集合：${JSON.stringify([...new Set(allEntries)])}`)

/* ── 断言 2：点第一个 expect 入口 ⇒ 面板渲染 ── */
if (EXPECT.length > 0) {
  const first = EXPECT[0]
  const B = await evalIn(`(async () => {
    const v = ${JSON.stringify(first)}
    const el = [...document.querySelectorAll('*')].find(e => e.getAttribute
      && (e.getAttribute('aria-label') === v || e.getAttribute('title') === v))
    if (!el) return { clicked: false }
    ;(el.closest('button') || el).click()

    // ★★ 等**前提就位**再断言，不靠固定 sleep（2026-10-05 修）。
    //   面板首开要读真服务端（几个网络往返）——固定 1500ms 会**假失败**：
    //   判据报"左栏未渲染"，而实际只是数据还没回来。
    //   （本仓既有教训同源：live-probe 也曾因"异步切数据源"偶发假失败。）
    const settle = async () => {
      for (let i = 0; i < 40; i++) {
        if (document.querySelector('[data-kaipu-left]') && document.querySelector('[data-kaipu-run]')) return i
        await new Promise(r => setTimeout(r, 250))
      }
      return -1
    }
    const waited = await settle()
    return {
      clicked: true,
      waited,
      // ★ 锚在**结构属性**上，不锚文案 —— 文案改了不该让判据爆炸
      //   （旧判据找「场景 / 运行记录」/「运行视图 / 报告」是**上一版面板**的文案，
      //     面板改版后它一直报"未渲染"，看起来像界面坏了，其实是判据过期了。）
      hasLeft: document.querySelector('[data-kaipu-left]') !== null,
      hasRight: document.querySelector('[data-kaipu-run]') !== null,
      text: document.body.innerText,
    }
  })()`)

  console.log(`\n── 断言 2 · 点「${first}」⇒ 主区域面板 ──`)
  console.log(`  ${B.clicked ? '✓' : '✗'} 点击成功`)
  if (!B.clicked) fails.push(`点不到入口「${first}」`)
  if (B.waited !== undefined && B.waited >= 0) console.log(`  · 前提就位耗时 ≈ ${B.waited * 250}ms`)
  console.log(`  ${B.hasLeft ? '✓' : '✗'} 左栏渲染（[data-kaipu-left]）`)
  console.log(`  ${B.hasRight ? '✓' : '✗'} 右栏渲染（[data-kaipu-run]）`)
  if (!B.hasLeft) fails.push('左栏未渲染')
  if (!B.hasRight) fails.push('右栏未渲染')
}

/* ── 截图 ── */
if (SHOT !== undefined) {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.writeFileSync(SHOT, Buffer.from(s.result.data, 'base64'))
  console.log(`\n  截图 → ${SHOT}`)
}

ws.close()
console.log('')
console.log(fails.length === 0 ? '✓ 通过：插件在真实宿主界面上可用' : `✗ 不通过：${fails.join(' / ')}`)
process.exit(fails.length === 0 ? 0 : 1)
