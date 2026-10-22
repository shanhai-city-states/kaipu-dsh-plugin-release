#!/usr/bin/env node
/**
 * 山海·开铺 · 智囊团面板「真机渲染」验收探针
 * =====================================================================
 * 与 `wisdom-panel-probe.mjs` 的分工（**两层，别混**）：
 *
 *   wisdom-panel-probe.mjs   纯逻辑层：直接 require 编译产物（lib/client.js），
 *                            调纯函数断言归类/汇总/文案 —— **不起浏览器**
 *   ★ 本脚本                真机层：连 CDP，点开面板，读**真 DOM**，
 *                            断言四区真的渲染出来了、且文案真的上了屏
 *
 * ★ 为什么必须有这一层（纯逻辑层过了不代表界面对）：
 *   1. 纯逻辑层测的是**函数返回值**，不测**有没有被渲染** —— 函数对了但组件没接上，
 *      纯逻辑层照样全绿（"测的是我造的东西，不是界面上真有的东西"）；
 *   2. 上屏文本可能被 **markdown 记号污染**（`**…**` 原样显示）—— 这是**渲染层**的事，
 *      纯函数断言不到（场地侧踩过这个坑）；
 *   3. 四态的**互斥呈现**（读不到 ≠ 空态）只有在真 DOM 上才看得出来
 *      —— 两者由不同分支渲染，纯逻辑层只验了数据结构，验不了"屏上长什么样"。
 *
 * 用法（需先起 DSH web + 一个开了 CDP 的浏览器）：
 *   node tools/probe/wisdom-view-probe.mjs --port=3090 --cdp=9223
 *   node tools/probe/wisdom-view-probe.mjs --shot=dev/shot-wisdom.png
 *
 * 退出码：0 = 全部断言通过；1 = 有失败
 */
const argv = process.argv.slice(2)
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? undefined : hit.slice(name.length + 3)
}
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法：node tools/probe/wisdom-view-probe.mjs [--port=3090] [--cdp=9223] [--shot=path.png]')
  process.exit(0)
}

const CDP_PORT = flag('cdp') ?? '9223'
const APP_PORT = flag('port') ?? '3090'
const SHOT = flag('shot')

const fails = []
const pass = (ok, label, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`)
  if (!ok) fails.push(label)
}

/* ── 连 CDP ── */
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

console.log(`── 智囊团面板 · 真机渲染验收（CDP :${CDP_PORT} → :${APP_PORT}）──\n`)

/* ── 步骤 0：就位（等应用渲染出来；空 DOM 就重载一次，理由同 panel-probe）── */
const WAIT_APP = `async (ms) => {
  const dl = Date.now() + ms
  while (Date.now() < dl) {
    if (document.querySelectorAll('[aria-label]').length > 8) return true
    await new Promise(r => setTimeout(r, 400))
  }
  return false
}`
async function waitForApp(ms) { return (await evalIn(`(${WAIT_APP})(${ms})`)) === true }

console.log('── 步骤 0 · 页面就位 ──')
let ready = await waitForApp(40000)
if (!ready) {
  await send('Page.navigate', { url: target.url })
  ready = await waitForApp(30000)
  console.log('  ⚠ 首帧空 DOM —— 已自动重载一次')
}
pass(ready, '宿主界面已渲染出可断言的 DOM')

/* ── 步骤 1：点「智囊团」入口 ⇒ 面板出现 ── */
console.log('\n── 步骤 1 · 打开智囊团面板 ──')
const OPEN = await evalIn(`(async () => {
  const v = '智囊团'
  const el = [...document.querySelectorAll('*')].find(e => e.getAttribute
    && (e.getAttribute('aria-label') === v || e.getAttribute('title') === v))
  if (!el) return { clicked: false }
  ;(el.closest('button') || el).click()
  // 等面板锚点出现（首开要读服务端，不靠固定 sleep）
  for (let i = 0; i < 60; i++) {
    if (document.querySelector('[data-kaipu-wisdom]')) return { clicked: true, waited: i }
    await new Promise(r => setTimeout(r, 250))
  }
  return { clicked: true, waited: -1 }
})()`)
pass(OPEN.clicked, '找到并点击「智囊团」入口')
pass(OPEN.waited >= 0, '面板根锚点 [data-kaipu-wisdom] 已出现', OPEN.waited >= 0 ? `(${OPEN.waited * 250}ms 内)` : '')

/* ── 步骤 1.5：等数据源态**落定**（loading ⇒ live/其他）──
 * ★ 实测教训（2026-10-06）：面板刚打开时快照还在路上，状态带是 loading。
 *   不等落定就断言 ⇒ 撞上 loading ⇒ 断言掉进"读不到"分支 ⇒ 假失败。
 *   与 panel-probe 的 settle() 同一条纪律：等前提就位，不靠固定 sleep。 */
const SETTLE = await evalIn(`(async () => {
  for (let i = 0; i < 40; i++) {
    const b = document.querySelector('[data-kaipu-wisdom-band]')
    const k = b ? b.getAttribute('data-kaipu-wisdom-band') : null
    if (k && k !== 'loading') return { kind: k, waited: i }
    await new Promise(r => setTimeout(r, 250))
  }
  const b = document.querySelector('[data-kaipu-wisdom-band]')
  return { kind: b ? b.getAttribute('data-kaipu-wisdom-band') : null, waited: -1 }
})()`)
pass(SETTLE.kind !== null && SETTLE.kind !== 'loading', '数据源态已落定（非 loading）',
  `kind=${SETTLE.kind}${SETTLE.waited >= 0 ? `（${SETTLE.waited * 250}ms 内）` : '（超时）'}`)

/* ── 步骤 2：读真 DOM 的四区 ── */
console.log('\n── 步骤 2 · 四区结构 ──')
const SNAP = await evalIn(`(() => {
  const root = document.querySelector('[data-kaipu-wisdom]')
  if (!root) return { found: false }
  const q = (s) => root.querySelector(s)
  const qa = (s) => [...root.querySelectorAll(s)]
  const band = q('[data-kaipu-wisdom-band]')
  return {
    found: true,
    bandKind: band ? band.getAttribute('data-kaipu-wisdom-band') : null,
    bandText: band ? band.innerText.trim() : null,
    hasSummary: q('[data-kaipu-wisdom-summary]') !== null,
    summaryText: q('[data-kaipu-wisdom-summary]') ? q('[data-kaipu-wisdom-summary]').innerText.trim() : null,
    lamps: qa('[data-kaipu-wisdom-lamp]').map(el => ({
      lamp: el.getAttribute('data-kaipu-wisdom-lamp'),
      state: el.getAttribute('data-kaipu-wisdom-lamp-state'),
      text: (el.querySelector('[data-kaipu-wisdom-lamp-text]') || {}).innerText || null,
    })),
    hasVacant: q('[data-kaipu-wisdom-vacant]') !== null,
    vacantText: q('[data-kaipu-wisdom-vacant]') ? q('[data-kaipu-wisdom-vacant]').innerText.trim() : null,
    hasHistory: q('[data-kaipu-wisdom-history]') !== null,
    unreadableKind: q('[data-kaipu-wisdom-unreadable]')
      ? q('[data-kaipu-wisdom-unreadable]').getAttribute('data-kaipu-wisdom-unreadable') : null,
    unreadableText: q('[data-kaipu-wisdom-unreadable]') ? q('[data-kaipu-wisdom-unreadable]').innerText.trim() : null,
    zoneText: root.innerText.replace(/\\s+/g, ' ').trim().slice(0, 600),
  }
})()`)

pass(SNAP.found, '面板根节点存在')
const kind = SNAP.bandKind ?? SNAP.unreadableKind
console.log(`  · 数据源态：${kind ?? '(未识别)'}`)

if (kind === 'live') {
  console.log('  · 走 live（通道通）分支 —— 断言灯位区 + 履历占位')
  pass(SNAP.hasSummary, '状态带汇总存在')
  pass(/灯位/.test(SNAP.summaryText ?? ''), '状态带汇总含「灯位」', `「${SNAP.summaryText}」`)
  pass(Array.isArray(SNAP.lamps) && SNAP.lamps.length > 0, '至少渲染 1 个灯位行',
    `共 ${(SNAP.lamps ?? []).length} 行`)
  // ★ 上屏文案不许带 markdown 记号（场地侧踩过：title 不渲染 markdown）
  const mdLeak = /[*_]{2,}/.test(SNAP.zoneText)
  pass(!mdLeak, '上屏文本不含 markdown 记号（** 等）')
  // ★ 行文案：Q1=a ⇒ vacant 与 registered 同形「待接入」
  const rowTexts = new Set((SNAP.lamps ?? []).map((l) => l.text))
  const states = new Set((SNAP.lamps ?? []).map((l) => l.state))
  console.log(`  · 行状态集合：${JSON.stringify([...states])}`)
  console.log(`  · 行文案集合：${JSON.stringify([...rowTexts])}`)
  if (states.has('vacant') && states.has('registered')) {
    const vac = (SNAP.lamps ?? []).find((l) => l.state === 'vacant')
    const reg = (SNAP.lamps ?? []).find((l) => l.state === 'registered')
    pass(vac.text === reg.text, 'Q1=a：vacant 与 registered 行同形（都显「待接入」）',
      `「${vac.text}」/「${reg.text}」`)
  }
  const bad = (SNAP.lamps ?? []).filter((l) => l.state === 'ready' && l.text !== '已就绪')
  pass(bad.length === 0, 'ready 行文案 = 「已就绪」')
  pass(SNAP.hasHistory, '履历区（占位）存在')
  pass(SNAP.unreadableKind === null, 'live 态下**不**显示「读不到」块（两者互斥）')
} else if (kind === 'loading') {
  pass(false, '数据源态落定失败（10s 后仍 loading）—— 首开数据通路存疑')
} else if (kind !== undefined && kind !== null && kind !== 'loading') {
  console.log(`  · 走「读不到」分支（kind=${kind}）—— 断言与空态绝不同形`)
  pass(SNAP.bandKind === kind, `状态带带 kind=${kind}`)
  // ★ 状态带恒渲染（kind + label），但 summary（N 灯位）**只在 live 渲染** ——
  //   没数据就不编数字（连 0 都不编）。⇒ 这里断言 label 在、summary 不在。
  const bandText = (SNAP.bandText ?? '').trim()
  pass(bandText.length > 0, '状态带 label 已渲染（如实说明）', `「${bandText}」`)
  pass(!SNAP.hasSummary, '读不到态**不**渲染灯位汇总数字（没数据不编 0）')
  pass(SNAP.unreadableText !== null, '「读不到」块已渲染')
  // ★★ 核心反面断言：绝不把"我读不到"伪装成"你这里没人"
  const fakeVacant = SNAP.lamps.length > 0
  pass(!fakeVacant, '★ 绝不显成「灯位全待接入」（不得编造不存在的事实）',
    fakeVacant ? `却渲染了 ${SNAP.lamps.length} 个灯位行` : '')
  const saysUnreadable = /读不到|未接入|故障|连不上|未登记|未连上/.test(`${bandText} ${SNAP.zoneText}`)
  pass(saysUnreadable, '上屏如实说明读不到（用词可核）')
}

/* ── 截图（可选）── */
if (SHOT !== undefined) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  if (shot.result?.data) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'))
    console.log(`\n  · 截图已存：${SHOT}`)
  }
}

/* ── 汇总 ── */
console.log(`\n${fails.length === 0 ? '✓ 通过' : '✗ 失败'}：${fails.length === 0 ? '智囊团面板在真机界面上渲染正确' : `${fails.length} 项未过`}`)
if (fails.length > 0) {
  for (const f of fails) console.log(`   ✗ ${f}`)
  process.exit(1)
}
process.exit(0)
