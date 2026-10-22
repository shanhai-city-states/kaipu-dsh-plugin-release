#!/usr/bin/env node
/**
 * 山海·开铺 · 场地插件 · **文案与约束判据**（Step 7 · 界面层）
 * =====================================================================
 * 断言的是"**接通了**"，不是"表里写了"：
 *
 *   ① 14 条错误码**各自走一遍真实渲染路径**，逐条比对译后文案
 *      —— 期望值从 `contracts/v1.1/errors.json` 读，本文件不抄第二份（否则测试会悄悄过期）
 *   ② 两个"另走一条路"的码**不许用错误样式**渲染（契约 clientAction）
 *   ③ 裸 code **不许出现在可见文字里**（只允许出现在 data-* 属性里给判据用）
 *   ④ 三条必须显示的约束：无签名醒目提示 / 角色位变更留痕 / 过期不候可重约
 *
 * 用法（需先起 DSH + 一个开了 CDP 的浏览器）：
 *   node tools/probe/copy-probe.mjs --port=3093 --cdp=9226 [--shot=dev/x.png]
 * 退出码：0 = 全过；1 = 有失败
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

const spec = JSON.parse(readFileSync(join(ROOT, 'contracts/v1.1/errors.json'), 'utf8'))
/** ★ 期望值来自契约 JSON —— 本文件里**没有**第二份文案表 */
const EXPECT = Object.fromEntries(spec.codes.map((c) => [c.code, { uiText: c.uiText, reroutable: typeof c.clientAction === 'string' }]))

const argv = process.argv.slice(2)
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? undefined : hit.slice(name.length + 3)
}
const CDP_PORT = flag('cdp') ?? '9222'
const APP_PORT = flag('port') ?? '3093'
const SHOT = flag('shot')

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failed++
}

/* ── CDP ── */
async function pickTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
      const t = list.find((x) => x.type === 'page' && String(x.url).includes(APP_PORT))
      if (t !== undefined) return t
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`CDP(:${CDP_PORT}) 里找不到 :${APP_PORT} 的页面`)
}
const target = await pickTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails !== undefined) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}
await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })

/* 打开面板 + 注入小工具 */
await ev(`(() => {
  // ★ 每次重建（不做"注入过就跳过"）—— 否则改了探针、页面里还是旧对象。
  window.__kaipuCopyProbe = {
      open() {
        const el = [...document.querySelectorAll('*')].find(e => e.getAttribute && (e.getAttribute('aria-label') === '开铺' || e.getAttribute('title') === '开铺'))
        ;(el?.closest('button') || el)?.click()
      },
      /**
       * ★★ 判据要**自己把被测对象摆到位**（2026-10-05 接真接口后加的）：
       *   面板默认是"真服务端"（默认值 auto），而本探针断的是**错误文案与三条约束**，
       *   它们现在由**演示脚手**驱动 ⇒ 必须先显式切到演示数据。
       *   （演示脚手只在 mock 模式出现，不切就找不到 [data-kaipu-harness]。）
       */
      async useMock() {
        const sw = [...document.querySelectorAll('[aria-label]')].find(e => e.getAttribute('aria-label') === '切换数据源')
        if (sw && sw.getAttribute('aria-pressed') !== 'true') {
          sw.click()
        }
        // ★★ 等前提真的就位：**演示脚手**只在 mock 模式出现，而切换是异步的
        //   （经宿主通道往返）⇒ 不等就会拿到"还没切过去"的现场，断言全线假失败。
        const dl = Date.now() + 12000
        while (Date.now() < dl) {
          if (document.querySelector('[data-kaipu-harness]') !== null) {
            await new Promise(r => setTimeout(r, 400))
            return true
          }
          await new Promise(r => setTimeout(r, 300))
        }
        return true
      },
      /** ★ 显式选场景 —— 探针必须能连跑两遍，不能依赖"上一个探针跑完停在哪"。 */
      async pickScene(label) {
        const b = [...document.querySelectorAll('[aria-label]')].find(e => e.getAttribute('aria-label') === label)
        if (!b) return false
        b.click()
        await new Promise(r => setTimeout(r, 500))
        return true
      },
      /** 收起首屏引导，让断言只看产品面（引导卡是说明，不是被测对象） */
      collapseIntro() {
        const b = [...document.querySelectorAll('[aria-label]')].find(e => e.getAttribute('aria-label') === '怎么用')
        if (!b) return false
        if (b.getAttribute('aria-expanded') === 'true') b.click()
        return true
      },
      fire(code) {
        const box = document.querySelector('[data-kaipu-harness]')
        if (!box) return 'no-harness'
        // ★★ 先把脚手**展开**再点（2026-10-05：它改成默认收起的 details 了）。
        //   为什么必须显式展开、而不能指望"display:none 的按钮也能被 .click() 触发"：
        //   那是**巧合**（DOM 事件能冒泡），不是**保证**（部分宿主/浏览器对不可见元素
        //   的合成事件有额外判定）。判据要断的是"用户点得到"，就该走用户走得到的路径。
        //   ⇒ 判据自己把被测对象摆到位 —— 同 useMock() 的纪律。
        if (box.tagName === 'DETAILS' && box.open !== true) box.open = true
        const b = [...box.querySelectorAll('button')].find(e => e.innerText.trim() === code)
        if (!b) return 'no-button'
        b.click()
        return 'ok'
      },
      errorBox() {
        const e = document.querySelector('[data-kaipu-error]')
        return e === null ? null : { code: e.getAttribute('data-kaipu-error'), text: e.innerText.trim() }
      },
      rerouteBox() {
        const e = document.querySelector('[data-kaipu-reroute]')
        return e === null
          ? null
          : {
              code: e.getAttribute('data-kaipu-reroute'),
              text: e.innerText.trim(),
              poll: e.getAttribute('data-kaipu-poll'),
              availableAt: e.getAttribute('data-kaipu-available-at'),
            }
      },
    }
  return 1
})()`)
await ev(`(async () => { window.__kaipuCopyProbe.open(); await new Promise(r => setTimeout(r, 1500)); await window.__kaipuCopyProbe.useMock(); return 1 })()`)
// ★ 收引导 + 选到**有变更记录**的那个场景：
//   变更留痕是全局面板能力，但记录按场景取（只有「开铺审计 · 标准」有 mock 记录）。
//   不显式选 ⇒ 探针连跑第二遍时会停在别的场景上，断言误报。
await ev(`window.__kaipuCopyProbe.collapseIntro()`)
await ev(`window.__kaipuCopyProbe.pickScene('开铺审计 · 标准')`)

console.log(`文案与约束判据（CDP :${CDP_PORT} → 面板 :${APP_PORT}）\n`)

const harness = await ev(`document.querySelector('[data-kaipu-harness]') !== null`)
say(harness === true, '演示脚手（错误路径入口）在场')
if (harness !== true) {
  console.log('\n✗ 面板没打开或脚手缺失 —— 后面的断言没有意义，直接退出。')
  ws.close()
  process.exit(1)
}

/* ── ① 14 条码逐个走真实渲染路径 ── */
console.log(`\n── ① ${spec.codes.length} 条错误码各自走一遍真实渲染路径 ──`)
const mismatch = []
for (const c of spec.codes) {
  const fired = await ev(`window.__kaipuCopyProbe.fire(${JSON.stringify(c.code)})`)
  if (fired !== 'ok') { say(false, `${c.code} 触发失败（${fired}）`); continue }
  await new Promise((r) => setTimeout(r, 120))
  const reroute = await ev(`window.__kaipuCopyProbe.rerouteBox()`)
  const err = await ev(`window.__kaipuCopyProbe.errorBox()`)

  if (c.clientAction !== undefined) {
    // ★ 契约 clientAction：这两条**不许**用错误样式渲染
    const okReroute = reroute !== null && reroute.code === c.code
    const noErr = err === null
    if (!okReroute || !noErr) mismatch.push(c.code)
    say(okReroute && noErr, `${c.code.padEnd(20)} → **不弹错**，走改道样式${noErr ? '' : '（却渲染成了错误框！）'}`)
  } else {
    const okText = err !== null && err.code === c.code && err.text.includes(c.uiText)
    if (!okText) mismatch.push(c.code)
    say(okText, `${c.code.padEnd(20)} → 「${err === null ? '（没有渲染）' : err.text.slice(0, 34)}」`)
  }
}

/* ── ② 裸 code 不许出现在可见文字里 ── */
console.log('\n── ② 裸 code 外泄（可见文字里不许出现）──')
let leakCount = 0
for (const c of spec.codes) {
  await ev(`window.__kaipuCopyProbe.fire(${JSON.stringify(c.code)})`)
  await new Promise((r) => setTimeout(r, 100))
  const box = (c.clientAction !== undefined)
    ? await ev(`window.__kaipuCopyProbe.rerouteBox()`)
    : await ev(`window.__kaipuCopyProbe.errorBox()`)
  if (box !== null && box.text.includes(c.code)) { leakCount++; say(false, `${c.code} 的可见文案里出现了裸码`) }
}
say(leakCount === 0, `14 条译后文案里都没有裸 code（泄漏 ${leakCount} 处）`)

/* ── ③ 两个改道码的后续动作（契约 clientAction 的落地）── */
console.log('\n── ③ 改道码的后续动作（★ 证明 detail 真的被消费了）──')
await ev(`window.__kaipuCopyProbe.fire('duplicate_request')`)
await new Promise((r) => setTimeout(r, 150))
const dup = await ev(`window.__kaipuCopyProbe.rerouteBox()`)
say(dup !== null && dup.text.includes('查看这次运行'), 'duplicate_request → 给出「查看这次运行」（按 detail.poll 切查询接口）')
// ★ 关键：断言 `detail.poll` 被真的用上了 —— 只断言"有个按钮"证明不了它读了 detail
say(
  dup !== null && typeof dup.poll === 'string' && dup.poll.startsWith('/'),
  `duplicate_request → 消费到 detail.poll = ${dup === null ? '（无）' : String(dup.poll)}`,
)
await ev(`window.__kaipuCopyProbe.fire('not_checked_in')`)
await new Promise((r) => setTimeout(r, 150))
const nci = await ev(`window.__kaipuCopyProbe.rerouteBox()`)
say(nci !== null && nci.text.includes('该场景需进场'), 'not_checked_in → 说明「该场景需进场」而不是普通报错')
// ★ 这段说明**只由 `detail.requiresExternal === true` 触发** ⇒ 它出现 = detail 被消费了。
//   断言必须用**实际措辞**（第一版我凭印象写「需预约」，结果把做对的事报成失败）。
say(
  nci !== null && nci.text.includes('有有效预约后才可运行'),
  'not_checked_in → 由 detail.requiresExternal 驱动（渲染出"需进场"说明）',
)
// ★★ P1-4 detail 全表里的第三个键 `availableAt` —— **我原来漏了这个键**
//    （星月 012 §5.2 给了全表，我读完契约两遍都没发现少一个）。它是这条"出路"的**具体时点**。
say(
  nci !== null && nci.text.includes('可进场时点'),
  'not_checked_in → 渲染 detail.availableAt（「可进场时点：…」）',
)
say(
  typeof nci?.availableAt === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(nci.availableAt),
  `availableAt 被格式化为本地可读时点（实测「${nci?.availableAt ?? '（无）'}」· 只断格式，值随本地时区而变）`,
)
// ★ 反向对照：**同一个 Reroute 组件**的另一条改道码（duplicate_request）**不带** availableAt
//   ⇒ 若我误把它写成"恒显示"，这条会失败。**这才证明它是被 detail 驱动的。**
say(
  dup !== null && !dup.text.includes('可进场时点'),
  '对照：duplicate_request 不显示「可进场时点」（证明它由 detail 驱动，不是恒显示）',
)
// 反向：一条**没有** detail 的普通错误，不该出现这段"需进场"说明
await ev(`window.__kaipuCopyProbe.fire('not_found')`)
await new Promise((r) => setTimeout(r, 120))
const nf = await ev(`window.__kaipuCopyProbe.errorBox()`)
say(nf !== null && !nf.text.includes('有有效预约后才可运行'), '对照：无 detail 的错误不会误显示"需进场"说明')

/* ── ④ 三条必须显示的约束 ── */
console.log('\n── ④ 三条必须显示的约束（001 开发包 §6.4）──')

// ① 报告无签名 ⇒ 醒目
const uns = await ev(`(() => {
  const e = document.querySelector('[data-kaipu-unsigned]')
  if (e === null) return null
  const head = e.firstElementChild
  const cs = getComputedStyle(head)
  const m = cs.color.match(/\\d+/g)
  return { text: e.innerText.replace(/\\s+/g, ' ').trim(), weight: cs.fontWeight, color: m === null ? '' : m.join(',') }
})()`)
say(uns !== null, '约束① 未签名提示在场')
if (uns !== null) {
  say(uns.text.includes('此报告未签名，不具备对外效力'), `约束① 文案 = 「此报告未签名，不具备对外效力」`)
  say(Number(uns.weight) >= 600, `约束① 足够**醒目**（font-weight ${uns.weight}）`)
  const [r, g, b] = uns.color.split(',').map(Number)
  say(r > 180 && g < 110 && b < 110, `约束① 用警示色（rgb(${uns.color})）`)
}

// ② 角色位变更留痕
const seats = await ev(`(() => {
  const e = document.querySelector('[data-kaipu-seatlog]')
  return e === null ? null : e.innerText.replace(/\\s+/g, ' ').trim()
})()`)
say(seats !== null, '约束② 角色位变更记录在场')
if (seats !== null) {
  say(seats.includes('角色位变更记录'), '约束② 有标题')
  say(seats.includes('原因：'), '约束② 每条都带**原因**（可追溯的关键）')
  say(seats.includes('→'), '约束② 显示了变更前后（from → to）')
}

// ③ 超时释放 ⇒ 过期不候 · 可重新预约
await ev(`window.__kaipuCopyProbe.fire('reservation_expired')`)
await new Promise((r) => setTimeout(r, 150))
const exp = await ev(`window.__kaipuCopyProbe.errorBox()`)
say(exp !== null && exp.text.includes('过期不候 · 可重新预约'), '约束③ 显示「过期不候 · 可重新预约」')
say(exp !== null && exp.text.includes('不用重新填'), '约束③ 说明"不惩罚首次"（不用重新填）')

/* ── 截图 ── */
if (SHOT !== undefined) {
  const fs = await import('node:fs')
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'))
  console.log(`\n截图 → ${SHOT}`)
}

console.log(`\n${failed === 0 ? '✓ 通过：文案与三条约束都真的接通了' : `✗ ${failed} 项未过`}`)
ws.close()
process.exit(failed === 0 ? 0 : 1)
