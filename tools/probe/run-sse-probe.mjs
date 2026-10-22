#!/usr/bin/env node
/**
 * 山海·开铺 · **运行链路端到端判据**（接线 SSE 后的真验收）
 * =====================================================================
 * 它断的不是"代码里调了 runScene"，而是**界面上真跑了一场、并真显示了结果**。
 *
 * 用法（需先起 DSH + 开 CDP 的浏览器 + 打开本插件面板）：
 *   node tools/probe/run-sse-probe.mjs --port=3091 --cdp=9222 [--scene=light-review]
 * 退出码：0 = 全过；1 = 有失败
 *
 * ★★ 为什么必须有这个脚本（而不是"我点了一下看到有结果"）：
 *   接线这类活最容易的失败是"**看起来通了**" —— 界面有变化，但变化来自演示数据、
 *   或来自上一次的残留。判据要能把这两者区分开：
 *     · 起始断言：面板处于 `[data-kaipu-start]`（尚未运行）态 —— 排除残留
 *     · 结束断言：出现轮次分段 + 判定 + 结论 + 用量 —— 证明事件真的流过 reducer
 *
 * ★ 判据**锚在结构属性**上（`data-kaipu-*`），不锚文案 —— 文案改版不该让判据爆炸。
 */
const argv = process.argv.slice(2)
const flag = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit === undefined ? d : hit.slice(n.length + 3)
}
const PORT = flag('port', '3091')
const CDP = `http://127.0.0.1:${flag('cdp', '9222')}`
const SCENE = flag('scene', '')

let failed = 0
const say = (ok, label, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra === undefined ? '' : `　${extra}`}`)
  if (!ok) failed++
}

/* ── 连 CDP ── */
const targets = await (await fetch(`${CDP}/json`)).json()
const page = targets.find((t) => t.type === 'page' && String(t.url).includes(PORT))
if (page === undefined) {
  console.error(`✗ 没找到端口 ${PORT} 的页面。当前：`)
  for (const t of targets) console.error('   -', t.type, String(t.url).slice(0, 90))
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id !== undefined && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
await new Promise((r) => { ws.onopen = r })
const send = (method, params) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise,
  })
  if (r.result?.exceptionDetails !== undefined) {
    return { __err: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text }
  }
  return r.result?.result?.value
}
await send('Runtime.enable')

/* ── ⓪ 确保面板已打开 ── */
await evaluate(`(() => {
  if (document.querySelector('[data-kaipu-run]')) return 'already'
  const el = [...document.querySelectorAll('*')].find(e => e.getAttribute
    && (e.getAttribute('aria-label') === '开铺' || e.getAttribute('title') === '开铺'))
  if (!el) return 'no-entry'
  ;(el.closest('button') || el).click()
  return 'clicked'
})()`)
/**
 * ★★ 先确保**不在演示模式**（2026-10-05 加）。
 *
 * 本探针断的是**真服务端**那条路，而演示模式里**没有"开始运行"**
 * —— 那不是 bug，是设计：`onStart` 传 `null`（演示数据没有可跑的服务端，
 * 给一个按不动的按钮才是骗人）。
 * ⇒ 所以判据要**自己把前提摆好**：若面板正停在演示数据上，先切回真服务端。
 *   （不然本探针会一路报"没等到发起表单"，看着像功能坏了。）
 */
const sourceSwitch = await evaluate(`(() => {
  const b = [...document.querySelectorAll('[aria-label]')]
    .find((e) => e.getAttribute('aria-label') === '切换数据源')
  if (!b) return 'no-switch'
  if (b.getAttribute('aria-pressed') === 'true') { b.click(); return 'switched-to-live' }
  return 'already-live'
})()`)
console.log(`数据源：${sourceSwitch}`)

/** 等**本探针真正的前提**就位（数据读完 + 场景已选中 ⇒ 出现发起表单） */
const settled = await evaluate(`(async () => {
  for (let i = 0; i < 80; i++) {
    if (document.querySelector('[data-kaipu-left]')
      && document.querySelector('[data-kaipu-run]')
      && document.querySelector('[data-kaipu-start]')) return i
    await new Promise(r => setTimeout(r, 250))
  }
  return -1
})()`)
console.log(`面板就位（${settled} × 250ms${settled === -1 ? ' —— ★ 没等到发起表单' : ''}）`)

/* ── ① 起始态：必须是"尚未运行"（排除看到的是残留）── */
console.log('\n── ① 起始态 ──')
const pre = await evaluate(`(() => ({
  hasStart: document.querySelector('[data-kaipu-start]') !== null,
  hasRounds: document.querySelectorAll('[data-kaipu-run] section').length,
  text: document.querySelector('[data-kaipu-run]')?.innerText ?? '',
}))()`)
say(pre.hasStart === true, '处于「可发起」态（[data-kaipu-start]）')
say(!/第\s*\d+\s*轮/.test(pre.text), '起始时**没有**轮次分段（排除上一次的残留）')

/* ── ② 选场景（可选）── */
if (SCENE !== '') {
  const picked = await evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-kaipu-left] *')]
    const hit = els.find(e => (e.textContent || '').includes(${JSON.stringify(SCENE)}))
    if (!hit) return false
    ;(hit.closest('button') || hit).click()
    return true
  })()`)
  say(picked === true, `选中场景「${SCENE}」`)
  await evaluate(`new Promise(r => setTimeout(r, 600))`)
}

/* ── ③ 填内容并发起 ── */
console.log('\n── ② 发起运行 ──')
const fired = await evaluate(`(async () => {
  const ta = document.querySelector('[data-kaipu-start] textarea')
  if (!ta) return { ok: false, why: '没有待审内容输入框' }
  // React 受控组件：必须走 native setter + input 事件，直接改 .value 不会触发 onChange
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '端到端判据提交的内容：这是一段用于验收的文本。')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 100))
  const btn = [...document.querySelectorAll('[data-kaipu-start] button')]
    .find(b => (b.textContent || '').includes('开始运行'))
  if (!btn) return { ok: false, why: '没有开始按钮' }
  if (btn.disabled) return { ok: false, why: '按钮仍禁用（内容没被 React 收到？）' }
  btn.click()
  return { ok: true }
})()`)
say(fired.ok === true, '填入内容并点「开始运行」', fired.why)

/* ── ④ 等结果（最多 20s）── */
const result = await evaluate(`(async () => {
  const grab = () => {
    const root = document.querySelector('[data-kaipu-run]')
    return {
      text: root ? root.innerText : '',
      rounds: root ? root.querySelectorAll('section').length : 0,
      dimsMissing: document.querySelector('[data-kaipu-dims-missing]') !== null,
      err: document.querySelector('[data-kaipu-run-error]') !== null,
    }
  }
  for (let i = 0; i < 80; i++) {
    const g = grab()
    // 见到「本次结论」（summary 渲染）就算跑完
    if (g.text.includes('本次结论')) return { ...g, waitedMs: i * 250 }
    if (g.err) return { ...g, waitedMs: i * 250, error: true }
    await new Promise(r => setTimeout(r, 250))
  }
  return { ...grab(), waitedMs: 20000, timeout: true }
})()`)

console.log(`\n── ③ 结果（等 ${result.waitedMs}ms）──`)
say(result.error !== true, '没有渲染出运行错误面板')
say(/第\s*1\s*轮/.test(result.text), '出现轮次分段「第 1 轮」（事件流过 reducer）')
say(/✅通过|⚡有条件|❌驳回|⛔拒收|⚪未接入/.test(result.text), '出现判定（含实测第 5 类 ⚪未接入）')
say(result.text.includes('本次结论'), '出现「本次结论」（summary 已渲染）')
say(/tokens\s+\d+\s+in/.test(result.text), '出现用量行（usage 已渲染）')

/**
 * ★ 请求号：**缩略显示，但全值没丢**（2026-10-05 加的功能 + 判据）。
 *
 * ★ 为什么这条放在**本探针**里断，而不是放演示态那个：
 *   演示数据的请求号是 `req-mock-0001`（13 字符，**够短，本来就不缩**）
 *   ⇒ 缩略逻辑在演示态**根本走不到**，在那儿断它 = 断了个永远为真的空断言。
 *   真运行给的才是长 ID ⇒ **只有这里能真的验证"缩了，且全值还在"**。
 *   （判据要断在**真会发生的那种输入**上。）
 */
const ridReal = await evaluate(`(() => {
  const el = document.querySelector('[data-kaipu-request-id]')
  if (el === null) return { present: false }
  return { present: true, shown: (el.innerText || '').trim(), full: (el.getAttribute('title') || '').trim() }
})()`)
say(ridReal.present === true, '标题行给出请求号')
if (ridReal.present === true) {
  say(ridReal.full.length > 0, '请求号**全值**挂在悬停上（缩了但没丢）')
  const shrunk = ridReal.shown.endsWith('…')
  say(
    ridReal.shown.length <= 20 && (ridReal.full.length <= 20 || shrunk === true),
    `请求号显示长度受控（显示 ${ridReal.shown.length} 字符 / 全值 ${ridReal.full.length} 字符${shrunk ? ' · 已缩略' : ' · 未达缩略阈值'}）`,
  )
}
/**
 * ★ 这一条是**有意的"会失败"的判据**：
 *   2026-10-05 实测服务端 `summary` **不带** `participatedDims`/`skippedDims`
 *   ⇒ 界面必须走"如实说不确定"那一支（`[data-kaipu-dims-missing]`）。
 *   将来服务端补上了，这条会 FAIL —— 那时**应该**FAIL，提醒我们换成
 *   "三行维度口径正常显示"的断言（而不是让它静默地继续过）。
 */
/**
 * ★★ 这条断言**故意做成双向**（2026-10-05 更新）。
 *
 * 背景：20:0x 实测服务端 `summary` **不带** `participatedDims`/`skippedDims`；
 * 21:09 复测**已经补上了**（`{…,participatedDims:["综合维度"],skippedDims:[]}`）。
 * ⇒ 两种都算对，但**必须走对应的那一支**：
 *   · 服务端给了 ⇒ 正常显示「本次参与审核面 / 未参与审核面」三行
 *   · 服务端没给 ⇒ 如实说"没给，因此无法判断是否审全"
 *
 * 为什么写双向而不是改死：**服务端一升级判据就红，红的不是产品、是判据太僵**。
 * （这条原来写成"必须缺失"，就是等着今天来改的 —— 它按设计失败了。）
 */
const dimsState = await evaluate(`(() => {
  const run = document.querySelector('[data-kaipu-run]')
  const t = run === null ? '' : run.innerText
  return {
    missingBanner: document.querySelector('[data-kaipu-dims-missing]') !== null,
    hasIdleRow: /本次参与审核面/.test(t),
    hasSkippedRow: /未参与审核面/.test(t),
  }
})()`)
const dimsNormal = dimsState.hasIdleRow === true && dimsState.hasSkippedRow === true
say(
  dimsState.missingBanner !== dimsNormal,
  `★ 审核面口径二选一且自洽（${dimsState.missingBanner ? '服务端未给 ⇒ 如实提示"无法判断是否审全"' : '服务端已给 ⇒ 正常显示「参与 / 未参与」三行'}）`,
)

console.log('\n── 运行视图文本（前 700 字）──')
console.log(result.text.slice(0, 700))

console.log(`\n${failed === 0 ? '全过 ✓' : `有 ${failed} 条未过 ✗`}`)
ws.close()
process.exit(failed === 0 ? 0 : 1)
