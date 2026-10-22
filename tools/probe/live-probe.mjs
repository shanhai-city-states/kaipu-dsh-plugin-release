#!/usr/bin/env node
/**
 * 山海·开铺 · 场地插件 · **数据源通路判据**（真服务端 / 未接入）
 * =====================================================================
 * 与另两个探针的分工（很重要，别混）：
 *   · `run-view-probe.mjs` —— 断**运行视图渲染**（契约 renderRules）⇒ 用**演示数据**摆前提
 *   · `copy-probe.mjs`     —— 断**错误文案与三条约束** ⇒ 用**演示脚手**摆前提
 *   · 本探针               —— 断**数据源本身**：数据真的从服务端来了吗？连不上时**有没有谎**
 *
 * ★★ 本探针存在的理由（2026-10-05 接真接口时立的）：
 *   把 mock 换成真接口，最容易犯的错不是"读不到"，而是**读不到却装成读到了** ——
 *   悄悄回落演示数据、或把"未接入"渲染成正常空态。那是最坏的一类错：
 *   **看起来是对的**。所以判据必须能区分三种状态：
 *     `live`（真读到了）/ `unreachable`（真连不上，且**如实说**）/ `mock`（人工选的）
 *
 * 用法（需先起 DSH + 一个开了 CDP 的浏览器）：
 *   node tools/probe/live-probe.mjs --port=3099 --cdp=9232 [--expect=live|unreachable]
 * 退出码：0 = 全过；1 = 有失败
 */
const argv = process.argv.slice(2)
const flag = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit === undefined ? d : hit.slice(n.length + 3)
}
const PORT = flag('port', '3099')
const CDP = `http://127.0.0.1:${flag('cdp', '9232')}`
const EXPECT = flag('expect', 'live')

let failed = 0
const say = (ok, label) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) failed++
}

/* ── 连 CDP ── */
async function pick() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`${CDP}/json`)).json()
      const t = l.find((x) => x.type === 'page' && String(x.url).includes(PORT))
      if (t) return t
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`CDP 里找不到 ${PORT} 的页面 target`)
}
const target = await pick()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id
  pending.set(i, res)
  ws.send(JSON.stringify({ id: i, method, params }))
})
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}
await send('Runtime.enable')

/* ── 开面板 + 显式切到「真服务端」 ── */
console.log(`\n期望数据源：${EXPECT}\n`)
await ev(`(async () => {
  const el = [...document.querySelectorAll('*')].find(e => e.getAttribute && (e.getAttribute('aria-label') === '开铺' || e.getAttribute('title') === '开铺'))
  ;(el?.closest('button') || el)?.click()
  await new Promise(r => setTimeout(r, 1500))
  // ★ 显式切到"真服务端"（面板默认就是 auto=真服务端；若探针上轮把状态留在 mock 上，这里切回来）
  const sw = [...document.querySelectorAll('[aria-label]')].find(e => e.getAttribute('aria-label') === '切换数据源')
  if (sw && sw.getAttribute('aria-pressed') === 'true') { sw.click(); await new Promise(r => setTimeout(r, 2500)) }
  return 1
})()`)
// 等数据落定：live 要等远端往返，给足时间
await new Promise((r) => setTimeout(r, 3500))

const snap = await ev(`(() => {
  const txt = (e) => e === null ? '' : String(e.innerText || '').replace(/\\s+/g, ' ')
  const aside = document.querySelector('aside')
  const label = document.querySelector('[data-kaipu-source-label]')
  const banner = document.querySelector('[data-kaipu-source]')
  const runBox = document.querySelector('[data-kaipu-run]')
  const sceneButtons = [...document.querySelectorAll('aside button[aria-label]')].map(b => b.getAttribute('aria-label'))
  return {
    sourceLabel: txt(label),
    bannerKind: banner === null ? null : banner.getAttribute('data-kaipu-source'),
    bannerText: txt(banner),
    asideText: txt(aside),
    runText: txt(runBox),
    sceneButtons,
    categories: [...document.querySelectorAll('[data-kaipu-category]')].map(e => e.getAttribute('data-kaipu-category')),
  }
})()`)

console.log('── 现场 ──')
console.log(`  数据源标签 : ${JSON.stringify(snap.sourceLabel)}`)
console.log(`  状态条     : ${snap.bannerKind === null ? '(无 —— live 正常时不显示)' : snap.bannerKind + ' · ' + snap.bannerText.slice(0, 90)}`)
console.log(`  左栏场景   : ${snap.sceneButtons.length} 个 → ${JSON.stringify(snap.sceneButtons)}`)
console.log(`  分类组     : ${JSON.stringify(snap.categories)}`)
console.log('')

if (EXPECT === 'live') {
  console.log('── 断言：真数据确实到位 ──')
  say(snap.sourceLabel === '真服务端', `数据源标签是「真服务端」（实测 ${JSON.stringify(snap.sourceLabel)}）`)
  say(snap.bannerKind === null, '没有异常状态条（live 正常时不该出现）')
  say(snap.sceneButtons.length > 0, `左栏读到真服务端的场景（${snap.sceneButtons.length} 个）`)

  // ★ 证明"不是把演示数据当真相"：演示数据有几个**独有**的场景名，真服务端没有
  const MOCK_ONLY = ['复核演练 · 全场未接入', '开铺审计 · 标准', '资料预检', '预约核验 · 需外部预约', '开铺审计 · 进行中']
  const leaked = MOCK_ONLY.filter((m) => snap.asideText.includes(m))
  say(leaked.length === 0, `左栏**没有**演示数据独有的场景 ${leaked.length === 0 ? '' : `（泄漏：${leaked.join('、')}）`}`)

  // ★★ 分组权威读法的实证：真服务端上 `multi-dim-review` 自称 category 为空串，
  //    但被列入 categories[standard_review].scenes ⇒ 它**必须**出现在「标准审查」组里，
  //    而不是掉进「未归类」。这条是 2026-10-05 抓到的服务端矛盾，判据钉住我的读法。
  const hasStandard = snap.categories.includes('standard_review')
  const hasUnclassified = snap.categories.includes('__unclassified__')
  say(hasStandard, '「标准审查」组存在（分类成员表读法生效）')
  say(!hasUnclassified, '没有场景掉进「未归类」（若掉进去 ⇒ 说明退回了只看 scene.category 的读法）')

  // ★ 运行视图：真服务端这边我们**还没跑过 run** ⇒ 必须是空态，
  //   不能显示「第 1 轮」这类演示序列的内容（那等于把演示当真相）
  say(!snap.runText.includes('第 1 轮'), '运行视图**没有**演示序列内容（真服务端尚未跑过 run）')
} else {
  console.log('── 断言：连不上时**不许假装连上了** ──')
  say(snap.bannerKind === 'unreachable' || snap.bannerKind === 'no_channel', `出现状态条且标明原因类型（实测 ${snap.bannerKind}）`)
  say(snap.bannerText.length > 10, `状态条说清了原因：${JSON.stringify(snap.bannerText.slice(0, 120))}`)
  const MOCK_ONLY = ['开铺审计 · 标准', '复核演练 · 全场未接入']
  const leaked = MOCK_ONLY.filter((m) => snap.asideText.includes(m))
  say(leaked.length === 0, `★ **没有偷偷回落演示数据** ${leaked.length === 0 ? '' : `（泄漏：${leaked.join('、')}）`}`)
}

console.log(`\n${failed === 0 ? '✓ 通过：数据源通路如声明' : `✗ ${failed} 项未过`}`)
ws.close()
process.exit(failed === 0 ? 0 : 1)
