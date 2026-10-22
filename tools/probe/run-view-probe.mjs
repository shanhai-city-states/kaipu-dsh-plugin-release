#!/usr/bin/env node
/**
 * 山海·开铺 · 场地插件 · **运行视图判据探针**（Step 4/6）
 * =====================================================================
 * 断言的不只是"面板渲染出来了"，而是**契约 renderRules 逐条真的落在界面上**：
 *
 *   [R2] 按「第 N 轮」分段，且**回炉可见**（第 2 轮的 reason = ⚡有条件回炉）
 *   [R3] 四类判定**全部**在界面上出现过，且可区分（✅通过 / ⚡有条件 / ❌驳回 / ⛔拒收）
 *   [R4] 报告尾部**固定**显示「本次参与审核面 / 未参与审核面 / 裁剪依据」
 *   [R5] 断开后显示「**已停止接收**」，且**不得**出现「已取消」
 *   [A-3] `agentId === null` ⇒ 显示「待接入」（且零接入场景有专门说明）
 *   另：mock 必须被**明示**为演示数据（否则就是把演示当事实）
 *
 *   [引导] 首屏「怎么用」卡：三步 + 术语 + 判定图例，可收起
 *   [导航] 顶部两个**动视口**的入口：「铺子资料 ↓」（展开 + 滚到底）/「怎么用 ↑」（展开 + 回顶）
 *   [品牌] 宿主侧边栏品牌位上坐着我们的名字（它**不在面板里** —— 见 ⑬）
 *   [#17] 场景**按场合分组** + 推荐 + ★「未归类不藏」+ ★禁用词「热门/多数人」不得出现
 *
 * 用法（需先起 DSH + 一个开了 CDP 的浏览器）：
 *   node tools/probe/run-view-probe.mjs --port=3093 --cdp=9226 [--shot=dev/x.png]
 * 退出码：0 = 全部通过；1 = 有失败
 *
 * ★ 为什么断言"具体字面量"而不是"有没有报错"：
 *   界面不报错 ≠ 界面说了该说的话。契约要求的是**措辞**（比如断开不能写"已取消"），
 *   所以判据必须是字面量级的。
 *
 * ★★ 判据边界（2026-10-05 加）：
 *   R2/R3/R4 一律断言 **`[data-kaipu-run]` 区域内**的文本，不是整页文本。
 *   原因：首屏引导卡里有四类判定的**图例**（它必须在那儿，否则用户对不上词）。
 *   若断言读整页，图例就会让「运行视图里出现了 ⚡有条件」变成**恒真的空断言** ——
 *   我们反复强调过「一个不会失败的断言等于没有」。
 *   ⇒ 边界本身也要被证明：见第 ⓪ 段那条反向断言。
 *
 * ★★ 边界**之外**怎么办：新增展示区一律物理隔离（2026-10-06 · 古茶 013 / 008 D-D3）
 *
 *   008 §1.2 **D-D3**：**新增锚点必须在 `data-kaipu-run` 之外** ——
 *   落点由**组件树**保证，而**不是**靠本探针读文本时做减法。
 *   096（2026-10-08）把「铺子资料 / 怎么用」提拔成**顶部页签**后，
 *   边界外这两块从"渲染在运行视图之外"进一步变成"**根本不与运行视图同页**"（互斥），
 *   判据随之由「在不在边界外」升级为「**切页签之后还在不在 DOM**」：
 *
 *     · 首屏引导（「怎么用」页）`[data-kaipu-intro]` —— 四类判定的**图例**在里面
 *     · 过程概览             `[data-kaipu-process]` —— 「轮次走向」那一行**含判定词**
 *     · 铺子资料（页）        `[data-kaipu-shop]`    —— 与"这一场审到了什么"无关的一块
 *     · 宿主品牌名           `[data-kaipu-brand]`   ★ 更进一步：挂在**宿主侧边栏**上，
 *                                                      连我们的面板都不在（见 ⑬）
 *
 *   ★ 我方第一版正是"减法"（`runText()` 克隆节点、按锚点 `[data-kaipu-facts]` 移除）。
 *     **已废弃**，理由是这类"隔离"的成立条件**依赖读的人记得减**：
 *     换一个人写判据、或换一个探针，污染立刻回来。
 *     ⇒ 「**先隔离，再展示**」（回函原文）＝ 结构上够不着，而非纪律上自律。
 *
 *   ★ 所以本探针现在断的是**隔离本身**（见 ⓪ / ⑪ / ⑫ / ⑬ / ⒂ 段），且每条都**能失败**：
 *     · 正向：`[data-kaipu-process]` / 页签栏 / 品牌锚点 都在场
 *     · ★★ 反向：它们 `closest('[data-kaipu-run]') === null` —— 在边界之外
 *     · ★★ 反向：**切回操作台后** `[data-kaipu-shop]` / `[data-kaipu-intro]` **不在 DOM**（0 个）
 *     · ★★ 反向：`[data-kaipu-run]` **内**搜不到 `[data-kaipu-process]`（0 个）
 *     · 加一条自证：判定在**去掉该块之后**仍成立（隔离没误伤 R3 的真来源）
 *     ⇒ 把它们任何一个挪回边界内，对应断言当场变红。
 */
const argv = process.argv.slice(2)
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? undefined : hit.slice(name.length + 3)
}
const CDP_PORT = flag('cdp') ?? '9222'
const APP_PORT = flag('port') ?? '3093'
const SHOT = flag('shot')

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法：node tools/probe/run-view-probe.mjs [--port=3093] [--cdp=9226] [--shot=dev/x.png]')
  console.log('  --shot=dev/x.png ⇒ 产出三张：x-demo.png（演示态）· x-nondemo.png（非演示态）· x.png（末尾全景）')
  console.log('  ★ 前两张**状态不同、哈希必然不同**，才是"默认态跟随数据源"的取证；哈希会当场打印。')
  process.exit(0)
}

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failed++
}

/* ─────────────────────── CDP 连接 ─────────────────────── */

async function pickTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
      const t = list.find((x) => x.type === 'page' && String(x.url).includes(APP_PORT))
      if (t !== undefined) return t
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`CDP(:${CDP_PORT}) 里找不到 :${APP_PORT} 的页面 —— 浏览器起了吗？URL 带 token 了吗？`)
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

/**
 * ★★★ 把页面**拉到前台**（2026-10-17 补 · ①.2 间歇性超时的真根因）。
 *
 * ── 症状 ────────────────────────────────────────────────────────────────
 *   `①.2 点开轮次：居中 + 门控` 会**间歇性**挂住，进而把后面整轮拖垮
 *   （⑥ 窄容器 12 条连带全红）。同一份探针、同一个页面，有时过有时挂。
 *
 * ── 根因（实测，不是推测）───────────────────────────────────────────────
 *   CDP 探测当时读到：
 *     `document.visibilityState === 'hidden'` · `document.hasFocus() === false`
 *   页面内实测 `setTimeout(900)` 的**真实耗时 = 1581ms**（1.76 倍）。
 *   ⇒ 浏览器对**后台标签页的 timer 节流**：名义 900ms 实际 1.6s，且后台越久越狠
 *      （Chromium 的 intensive throttling 最狠到 1 次/分钟）。
 *   ①.2 段里有 **约 10 个 `sleep()`** ⇒ 名义 4~5s 被放大成几十秒 ⇒ 撞上 `ev` 的 20s 超时。
 *   ★ 所以它不是产品 bug，也不是判据写错 —— 是**探针没保证自己的运行条件**：
 *     它整段都建立在"页面内 setTimeout 按名义时长走"这个前提上，而这个前提**不总成立**。
 *
 * ── 修法 ────────────────────────────────────────────────────────────────
 *   跑之前先 `Page.bringToFront`，把页面拉回前台。
 *   ★ 加固（用脚本/快捷方式起浏览器时建议一起加，见 README 的探针用法）：
 *     `--disable-background-timer-throttling --disable-renderer-backgrounding
 *      --disable-backgrounding-occluded-windows`
 *   ★ 不选"把 20s 超时调大"：那只是让症状更晚出现，后台节流最狠能到分钟级，调多少都不够。
 */
await send('Page.bringToFront')
{
  // 拉前台后再确认一次：仍是 hidden 就**明说**（不静默带着坏条件跑）
  const st = await send('Runtime.evaluate', {
    expression: `({ v: document.visibilityState, f: document.hasFocus() })`,
    returnByValue: true,
  })
  const v = st.result?.result?.value
  if (v?.v !== 'visible') {
    console.log(
      `  ⚠️ 页面仍非前台（visibilityState=${v?.v ?? '?'}）—— 页面内 timer 可能被节流，` +
        `本轮的耗时类断言可能不稳。建议起浏览器时加 --disable-background-timer-throttling`,
    )
  }
}

const ev = async (expr) => {
  /**
   * ★★ 超时保护（2026-10-17 补 · 实测踩到）。
   *
   * 为什么必须有：`Runtime.evaluate` + `awaitPromise: true` 在页面里那段 async
   * **永不 resolve 时没有任何超时** ⇒ 整个探针**无限挂起**。
   * 实测症状：全量跑到 ①.2 段就再没有输出，550s 后被外层 kill，
   *   **既没有"通过"也没有"失败"** —— 这是最坏的形态：
   *     · 判据红，人知道有问题
   *     · 判据挂，人以为"还在跑"，**问题被静默吞掉**
   *
   * ★ 一个会永久挂起的判据，比一个会失败的判据更糟（同"长期红的判据等于没有判据"）。
   * ⇒ 超时就抛明确错误，让它在**该段**显形，而不是把整轮拖死。
   */
  const TIMEOUT_MS = 20000
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `ev 超时 ${TIMEOUT_MS}ms —— 页面里那段表达式没有返回（不是"失败"，是"没跑完"）。` +
                `表达式前 80 字：${String(expr).slice(0, 80).replace(/\s+/g, ' ')}`,
            ),
          ),
        TIMEOUT_MS,
      ),
    ),
  ])
  if (r.result?.exceptionDetails !== undefined) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

/* ─────────────── 截图（★ 2026-10-07：当场算内容哈希） ───────────────
 *
 * ★★ 为什么要算哈希：**一张"每轮都截在同一时刻"的图，sha256 会完全相同，
 *   于是它证明不了"这一轮改动生效了"** —— 哈希相同 = 该图在本轮**零证据力**。
 *   实测（2026-10-07）：本探针原来只在**末尾**截一张，而末尾那一刻页面状态是确定的
 *   ⇒ `shot-v12 / v13 / v13b / v13c` 四张图（跨两轮、四次跑）**sha256 完全一致**
 *   （`f5ed46c0…`）—— 四张"证据图"其实是同一张。
 *   图本身没坏，坏的是**它被当成了"状态变了"的证据**。
 *
 * ⇒ 处置有三条，缺一不可：
 *   ① 分状态各截一张（演示态 / 非演示态）—— 状态不同，哈希必然不同；
 *   ② 截图**当场算哈希并打印** —— 让"这张图和上一轮的图一样"看得见；
 *   ③ 末尾**断言两张哈希不同** —— 把这件事本身交给判据看护，
 *      将来谁把截图挪回同一个时刻，这条**当场变红**（而不是静默退化成零证据力）。
 */
const shotDigests = new Map()
/**
 * ★★★ 2026-10-07 实测：**这张截图的证据力是一条一条的，不是"什么都能证"**。
 *
 * 缘起：`shot-v15-*` 与改动前的 `shot-v14-*` **逐字节相同**，而当时页面里
 *   已经是新文案（DOM 实测 present=true / 350 字 / display=block）。
 * 于是做了一次**对照实验**（把引导卡那条 Term 的举例改回旧写法，其余不动）：
 *
 *   | 引导卡文本 | 截图 sha256 |
 *   |:--|:--|
 *   | 349 字（旧举例） | `408b40222e12…` |
 *   | 350 字（新写法） | `408b40222e12…` ← **一模一样** |
 *
 * ⇒ **引导卡内的文案变化，这张图捕捉不到。** 而同时，往卡里 prepend 一个块
 *   （改变布局高度）**会让哈希变** —— 说明不是"图整体失效"，
 *   而是**它看不见这一处**。具体成因（合成层 / 视口裁剪 / captureScreenshot 的取值方式）
 *   本次**没有查明，也不编一个解释**。
 *
 * ★★ 由此立一条纪律（跨项目）：
 *   **截图的证据力是"逐处"的，不是全局的。**
 *   一张图能证明 A 处的变化，**不代表**能证明 B 处的变化。
 *   ⇒ 谁敢拿某张图当某处改动的证据，**就要先做一次"改那一处 ⇒ 图变不变"的对照实验**。
 *   不做对照就说"有截图为证"，和"一个不会失败的断言"是同一族的假绿。
 *
 * ★ 所以下面的状态自述**只能说明 DOM 状态，不能反推图里拍到了它** ——
 *   `引导卡 在(350字)` 与"图里有这段文字"是两件事。自述与图**不一致**时，
 *   要如实报"不一致"，而不是挑一个顺眼的说。
 */
async function shoot(file) {
  const fs = await import('node:fs')
  const { createHash } = await import('node:crypto')
  // ★★ 2026-10-07 加：**让截图自证它拍到了什么**。
  //   起因：`shot-v15-*` 与改动前的 `shot-v14-*` **逐字节相同**，而当时页面里
  //   明明已经是新文案（DOM 实测 present=true / 350 字 / display=block）。
  //   ⇒ 只报一个哈希，**看不出"这张图到底拍的是哪一刻"** —— 于是人只能猜。
  //   这一行把"拍的那一刻的状态"与图一起落下来：数据源、引导卡在不在/多少字、
  //   滚动位置。将来再出"两张图相同"，一眼能看出**是因为那一刻没有它**，
  //   而不是又要花一轮去复现。（同族：截图要能当证据，就得说清它拍的是什么。）
  const st = await ev(`(() => {
    const el = document.querySelector('[data-kaipu-intro]')
    const src = document.querySelector('[data-kaipu-source-label]')
    const sc = document.querySelector('[data-kaipu-scroller]')
    return {
      mock: src === null ? null : src.getAttribute('data-kaipu-source-mock'),
      intro: el !== null,
      introLen: el === null ? -1 : String(el.innerText || '').length,
      introDisplay: el === null ? null : getComputedStyle(el).display,
      scrollTop: sc === null ? null : Math.round(sc.scrollTop),
    }
  })()`)
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const buf = Buffer.from(s.result.data, 'base64')
  fs.writeFileSync(file, buf)
  const h = createHash('sha256').update(buf).digest('hex')
  shotDigests.set(file, h)
  console.log(
    `  · 截图 → ${file}（sha256 ${h.slice(0, 12)}…）`
      + `｜ 此刻：数据源 mock=${st?.mock} · 引导卡 ${st?.intro === true ? `在(${st?.introLen}字, display=${st?.introDisplay})` : '不在'}`
      + ` · 滚动 ${st?.scrollTop}`,
  )
  return h
}

/* ★★ 先**刷新一次页面** —— 这是"默认态"三个字能成立的前提（2026-10-07 加）。
 *
 * 起因：本探针 ⓪.0 要断"引导卡的默认态**跟随数据源**"，
 *   而产品侧有一条**故意**的纪律：**用户自己开合过引导卡之后，就不再自动改**
 *   （见 `PlatformPanel` 的 `introTouched`）。它存在组件的 ref 里 ⇒ **活到组件卸载为止**。
 *
 * ⇒ 于是出现"一跑绿、二跑红"：
 *     第一跑把默认态读干净了（它自己接着就会去点「收起」/「怎么用 ↑」），
 *     第二跑进来时**面板还是同一个组件实例** ⇒ "用户已表态"的标记还在 ⇒
 *     自动跟随被**正确地**关掉 ⇒ ⓪.0 的反向断言**假红**。
 *
 * ★★ 这不是产品 bug，是**判据没有把前态摆干净**（本仓反复栽在这上面 ——
 *   "可复跑的关键：不能假定进来的前态"，见 `switchTab` 那段）。
 *   而且它**只在第二跑才出现**：一直红会逼你去看，一跑绿二跑红会让人当成偶发。
 *
 * ⇒ 处置：刷新，拿一个**没人动过**的页面。这本来就是"默认态"的定义 ——
 *   对刚加载完的页面问"默认是什么"，才是问对了问题。
 *   ⚠️ `?token=` 实测可复用、且首次加载已换到 30 天 cookie ⇒ 刷新不会掉登录。
 *   ⚠️⚠️ 顺序不能挪：**必须在注入 `window.__kaipuProbe` 之前**。
 *     刷新会清掉页面侧的一切（注入的探针对象一起没）——
 *     放注入之后 ⇒ `Cannot read properties of undefined (reading 'open')`，
 *     探针开跑即崩。（这个错我当场犯过一次，日志留痕。）
 */
await send('Page.reload')
{
  const dl = Date.now() + 25000
  let ready = false
  while (Date.now() < dl) {
    await new Promise((r) => setTimeout(r, 400))
    const ok = await ev(`document.readyState === 'complete' && document.body !== null && (document.body.innerText || '').length > 0`)
    if (ok === true) {
      ready = true
      break
    }
  }
  say(ready, '刷新后页面重新加载完成（判据自带"干净前态"，不依赖上一跑留下的状态）')
}

/* ─────────────────── 页面侧的小工具（注入一次） ─────────────────── */

await ev(`(() => {
  // ★ **每次重建**，不做"注入过一次就跳过"的守卫。
  //   踩过：守卫一旦生效，改了探针代码但页面里还是上一版对象 ⇒
  //   window.__kaipuProbe.switchTab is not a function（旧对象缺新方法）。
  //   探针对象本身无状态 ⇒ 重建是安全且幂等的。
  const wait = async (fn, ms) => { const dl = Date.now() + ms; while (Date.now() < dl) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 300)) } return null }
  const byLabel = (v) => [...document.querySelectorAll('[aria-label]')].find(e => e.getAttribute('aria-label') === v)
  /**
   * ★★ 读前先展开（2026-10-05 加，随"轮次/分类可折叠"一起）。
   *
   * 为什么必须：轮次与分类现在是 details 元素（默认折），而
   * **浏览器不把折叠内容的文本算进 innerText** ⇒ 不展开就断言，
   * 会把"折着"读成"不见了" —— **那不叫判据通过，那叫判据失真。**
   *
   * ⇒ 本探针凡是读文本，一律**先展开**：它要断的是"内容**在不在**"，不是"折没折"。
   *   「折起来时判定是否仍可见」由专门的**折叠边界**断言负责 —— 那一条**故意不展开**。
   *
   * ⚠️ 本段在模板字符串内部：**这里的注释不能出现反引号**（会提前终止字符串）。
   *    本仓为此立过判据（tools/check-tools-syntax.mjs），我这轮就是没先跑它才踩的。
   */
  const expandIn = (root) => { root.querySelectorAll('details').forEach((d) => { d.open = true }) }
  /** 整页文本（只用于"禁用词全页不得出现"这类全局断言） */
  const text = () => { expandIn(document); return document.body.innerText }
  /**
   * ★★ 运行视图文本 —— 判据边界。
   *   契约 renderRules 说的是"**报告/运行视图里**必须怎样"，
   *   所以 R2/R3/R4 必须读这一块，不能读整页（否则引导卡里的图例会污染断言）。
   */
  const runText = () => {
    const el = document.querySelector('[data-kaipu-run]')
    if (el === null) return ''
    expandIn(el)
    // ★ 直接读本块文本 —— **不做任何排除**（2026-10-06 改）。
    //   上一版这里克隆节点、按锚点移掉新增的概览块（当时锚点叫 data-kaipu-facts）
    //   才敢读。现在不需要了：按 008 D-D3，新增展示区已**物理落在**本块之外
    //   （见 PlatformPanel 的 ProcessFacts）⇒ 这个选择器**根本够不着**它。
    //   ★★ 少一层减法 = 少一个失效点。而且减法的失效是**静默**的：
    //      锚点改个名，排除就变成空操作，判据照旧全绿（只是断言变松）。
    //      物理隔离的失效则是**响亮**的 —— ⓪ 段的反向断言当场变红。
    //   ★ 用 innerText（不是 textContent）：读的是"看得见的文本"，
    //     与本文件"先展开再读"的纪律同一口径 —— textContent 连 display:none 的
    //     也读，会让"内容在不在"这个问题的答案变松。
    return el.innerText
  }
  /** 左栏文本（#17 分类断言只看左栏 —— 判据边界） */
  const leftText = () => {
    const el = document.querySelector('[data-kaipu-left]')
    if (el === null) return ''
    expandIn(el)
    return el.innerText
  }
  window.__kaipuProbe = {
    wait, byLabel, text, runText, leftText,
    async open() {
      /**
       * ★★ 先把**宿主自己的**引导层关掉（2026-10-08 加）。
       *
       * 现象：页面 reload 后，DSH 常弹出「添加一个 API Key 开始使用」对话框，
       *   它带一层遮罩（元素 class 带 CSS-module 哈希，形如「下划线 mask 下划线…」）
       *   **盖住整页** ⇒ 探针点「开铺」点不到
       *   ⇒ 报告「面板没打开」并直接退出，**看着像产品坏了**。
       *   （本机两次踩到：一次挡了眼检截图，一次挡了探针 —— 见 MEMORY-ENGINEERING 那条。）
       *
       * ★ 为什么做进判据、而不是"每次手动点掉"：
       *   与下面"先切演示数据"**同一条纪律** —— **判据要自己把前提摆好**，
       *   不能假定"进来的前态是干净的"。手动点掉的东西，换个窗口/换个人跑就没了。
       *
       * ★ 只点**现成的关闭出路**（稍后配置 / 关闭 / 跳过…），**不删 DOM**：
       *   删掉遮罩只是骗过这一次，弹窗本身还在，下一个人照样撞上。
       */
      const dismissHostDialog = () => {
        const roots = [...document.querySelectorAll('div[class*="_root_"]')]
          .filter((r) => r.querySelector('[class*="_mask_"]') !== null)
        for (const r of roots) {
          const b = [...r.querySelectorAll('button')]
            .find((x) => /稍后配置|稍后|关闭|知道了|跳过|以后再说/u.test(x.innerText || ''))
          if (b !== undefined) {
            b.click()
            return true
          }
        }
        return false
      }
      dismissHostDialog()
      await new Promise(r => setTimeout(r, 600))
      const el = [...document.querySelectorAll('*')].find(e => e.getAttribute && (e.getAttribute('aria-label') === '开铺' || e.getAttribute('title') === '开铺'))
      ;(el?.closest('button') || el)?.click()
      await new Promise(r => setTimeout(r, 1200))
      // ★★ 判据要**自己把被测对象摆到位**（2026-10-05 接真接口后加的）：
      //   面板默认是"真服务端"（默认值 auto），而本探针断的是**运行视图渲染**，
      //   它目前由**演示序列**驱动 ⇒ 必须先显式切到演示数据。
      //   不切的话本探针会因"真服务端的场景 id 与演示数据不同"而全线失败 ——
      //   那不是产品坏了，是**判据没有把前提摆好**。
      const sw = [...document.querySelectorAll('[aria-label]')].find(e => e.getAttribute('aria-label') === '切换数据源')
      if (sw && sw.getAttribute('aria-pressed') !== 'true') {
        sw.click()
      }
      // ★★ 而且要**等前提真的就位**再往下走 —— 数据源切换是**异步**的
      //   （要经宿主通道往返），不等就会出现"这两次读数之间数据变了"的假失败。
      //   实测症状：「收起引导不动主内容」偶发未过 —— 收起引导前后各读一次运行视图，
      //   而 mock 数据恰好在两次读数之间落地 ⇒ 文本当然变了。
      //   ⇒ 等一个**只在演示数据里出现**的场景名出现，才算摆好。
      // ★★ 左栏分类现在是 details 元素（默认折）⇒ **等之前先把它们展开**。
      //   否则 aside.innerText 永远读不到场景名 ⇒ 白等满 12 秒（假超时，看着像数据没来）。
      //   在等的过程里每轮补一次：数据落地时会重渲染，新出来的分类又是折的。
      /**
       * ★★ 只展开**内层分类**这一层，**绝不碰三块外层容器**（2026-10-08 · 107 改）。
       *
       * 改这里的原因（一条**判据自己污染被测对象**的实证）：
       *   原版是「aside.querySelectorAll('details').forEach(d => d.open = true)」——
       *   它把左栏**所有**折叠无条件打开。107 给左栏加了三块折叠容器后，这一句会
       *   **在 open() 里就把"参考两块默认收起"这个产品默认态抹掉**
       *   ⇒ 后面任何断"默认态"的判据都读不到真值（实测：⑦.1 段读到的是
       *     「执行方 open=true」，于是"默认收起"那条**假红**）。
       *
       * ★★ 为什么"只展开分类"不算污染：**产品的分类默认就是展开的**（107 起）——
       *   这个 helper 做的是"确保内层分类展开"，与产品默认**同向**，不会伪造出一个
       *   界面上不存在的状态。
       * ⚠️ **耦合提醒**：若哪天把分类默认改回收起，这个 helper 就会开始污染默认态 ——
       *   那时要么同步改这里，要么给"分类默认态"补一条**在 open() 之前**读不到的判据
       *   （本仓办法：像 ⑦.1 那样，把判据紧贴 open() 之后、任何 expand 之前）。
       *
       * ★ 它的本职（等待条件能用）不受影响：等的是"场景名出现在 aside 文本里"，
       *   而场景行现在**默认就可见**（分类默认展开）⇒ 照样等得到。
       */
      const expandAside = () => {
        document.querySelector('aside')
          ?.querySelectorAll('details[data-kaipu-category]')
          .forEach((d) => { d.open = true })
      }
      expandAside()
      // ★ 等待期间每轮也补一次"关宿主弹窗"：数据落地时会重渲染，
      //   弹出的层可能不是一开始那一个（同 expandAside 每轮补的道理）。
      //   ⚠️ 注意：本行与邻近几行在**模板字符串内部** ⇒ 注释里**不许出现反引号**，
      //      否则模板提前终止，报错点会飘到几百行之外（本仓踩过多次，我今天又踩一次）。
      dismissHostDialog()
      const dl = Date.now() + 12000
      while (Date.now() < dl) {
        const aside = document.querySelector('aside')
        const run = document.querySelector('[data-kaipu-run]')
        const leftOk = aside !== null && String(aside.innerText).includes('开铺审计 · 标准')
        // ★★ 还要等**运行视图**也就位（演示数据的默认场景有 2 轮）——
        //   冷启动（刚 reload 完就跑）时实测抖出 5 条假失败：
        //   open() 一返回下面就立刻读数，而 mock 的**运行序列**还在落地。
        //   （"第 1 轮"在 summary 元素上，折叠也读得到 ⇒ 这个等待条件不会被折叠影响。）
        const runOk = run !== null && /第\s*1\s*轮/.test(run.innerText)
        if (leftOk && runOk) {
          await new Promise(r => setTimeout(r, 400))
          return true
        }
        expandAside()
        dismissHostDialog()
        await new Promise(r => setTimeout(r, 300))
      }
      return true
    },
    /**
     * ★★ 展开页面上所有折叠块（2026-10-05 加，随"轮次/分类可折叠"一起）。
     *
     * 为什么判据**必须**先展开：轮次与分类现在是 details 元素，而
     * **浏览器读不到折叠内容的 innerText** ⇒ 不展开就断言，
     * 会把"折着"误判成"不见了"。**那不叫判据通过，那叫判据失真。**
     *
     * ★ 配套的 collapseAll 同样有用：它让判据能断
     *   「**折起来时判定仍可见**」—— 那是新折叠设计最该被看住的边界（R3）。
     *   ⚠️ 本段在模板字符串里：**注释不得出现反引号**（会提前终止字符串）。
     */
    async expandAll() {
      document.querySelectorAll('details').forEach((d) => { d.open = true })
      await new Promise(r => setTimeout(r, 350))
      return document.querySelectorAll('details[open]').length
    },
    async collapseAll() {
      document.querySelectorAll('details').forEach((d) => { d.open = false })
      await new Promise(r => setTimeout(r, 350))
      return document.querySelectorAll('details:not([open])').length
    },
    async pickScene(label) {
      const b = window.__kaipuProbe.byLabel(label)
      if (!b) return false
      b.click()
      await new Promise(r => setTimeout(r, 500))
      return true
    },
    async clickStop() {
      const b = [...document.querySelectorAll('button')].find(e => e.innerText.trim() === '停止接收')
      if (!b) return false
      b.click()
      await new Promise(r => setTimeout(r, 400))
      return true
    },
    /**
     * 切到某个顶部页签（**幂等**）。★ 2026-10-08 · 096 取代旧 setIntro。
     *
     * ★★ 为什么必须把它做成一等公民：096 之后「怎么用」「铺子资料」
     *   不再是右栏内容流里的两块，而是**独立页签** —— 不切过去，它们的 DOM
     *   根本不在页面上（introText() 会返回空串 ⇒ 任何 includes 都恒 false）。
     *   这正是本仓反复栽过的"前置条件没有显式摆"，所以**切页签必须显式、且要等**。
     *
     * ★ 幂等：已在该页签就不点（连跑两遍时前态可能是任意一页）。
     * ★ 锚结构属性 [data-kaipu-tab="<id>"]，不锚文案（文案会改）。
     * ⚠️ 本段在模板字符串里：**不得出现反引号**（会提前终止字符串）——
     *   所以选择器用单引号拼接，不用模板串。
     */
    async switchTab(id) {
      const sel = '[data-kaipu-tab="' + id + '"]'
      const b = document.querySelector(sel)
      if (b === null) return null
      if (b.getAttribute('aria-selected') !== 'true') {
        b.click()
        await new Promise(r => setTimeout(r, 400))
      }
      const now = document.querySelector(sel)
      return now !== null && now.getAttribute('aria-selected') === 'true'
    },
    /**
     * ★★ ⓪.1 分状态取证（2026-10-07 加）—— **只读**，一个字节都不改产品状态。
     *
     * 起因：本探针原来只在**末尾**截一张图，而末尾那一刻页面状态是确定的
     *   ⇒ 跨两轮、四次跑出来的 PNG **sha256 完全相同**（见顶部截图段的注释）。
     *   一张"每轮都一样"的图，当不了"这一轮改动生效了"的证据。
     *   ⇒ 把"读默认态"由**一次 ev 走完**拆成三步（读 / 切 / 等），
     *     让 Node 侧能在**演示态**与**非演示态**各截一张 —— 状态不同，哈希必然不同。
     *
     * ★ 为什么拆开是安全的：这三步**只读**，不碰引导、不碰折叠，
     *   所以 ⓪.0 那段"唯一能读到默认态的窗口"没有被破坏 ——
     *   拆出来的多个 await 之间，产品状态一个字节都没变。
     * ⚠️ 本段在模板字符串里：注释不得出现反引号。
     */
    readSource() {
      const src = document.querySelector('[data-kaipu-source-label]')
      return {
        mock: src === null ? null : src.getAttribute('data-kaipu-source-mock'),
        sourceText: src === null ? null : String(src.innerText || '').trim(),
        // ★ 2026-10-08 · 096：原来这里还读 [data-kaipu-intro]（引导卡在不在），
        //   用于断"引导默认态跟随数据源"。页签化后该行为不存在 ⇒ 字段已删
        //   （留着一个**恒为 false** 的读数，比没有更坏：下一个人会拿它写断言）。
      }
    },
    /**
     * ★★ ⓪.2 引导卡**自己**的文本（2026-10-07 加）—— 判据边界，只读。
     *
     * 为什么不能用 text() / full0：那是**整页**文本，含运行视图里的灯名，
     *   拿它跟演示数据的灯名比 ⇒ **必然重合** ⇒ 判据恒红（或被迫写松）。
     *   本探针反复讲"判据边界"（见 runText / leftText 的注释），这是同一件事。
     * ⇒ 断"术语文案有没有引用演示数据"，就得只读**引导卡这一块**。
     * ⚠️ 本段在模板字符串里：注释不得出现反引号。
     */
    introText() {
      const el = document.querySelector('[data-kaipu-intro]')
      return el === null ? '' : String(el.innerText || '')
    },
    /** 点一次「切换数据源」（幂等性由调用方按 mock 锚点自己判） */
    async toggleSource() {
      const sw = [...document.querySelectorAll('[aria-label]')]
        .find(e => e.getAttribute('aria-label') === '切换数据源')
      if (!sw) return null
      sw.click()
      await new Promise(r => setTimeout(r, 300))
      return true
    },
    /** 等数据源锚点落到指定值 —— 切换是**异步**的（要经宿主通道往返），不等就是假失败 */
    async waitSourceMock(want, ms) {
      const dl = Date.now() + (ms || 12000)
      while (Date.now() < dl) {
        const src = document.querySelector('[data-kaipu-source-label]')
        if (src !== null && src.getAttribute('data-kaipu-source-mock') === want) {
          await new Promise(r => setTimeout(r, 700)) // 再给一拍让它落定（不猜固定时长）
          return true
        }
        await new Promise(r => setTimeout(r, 250))
      }
      return false
    },
  }
  return 1
})()`)

console.log(`运行视图判据探针（CDP :${CDP_PORT} → 面板 :${APP_PORT}）\n`)

/* ── 0. 打开面板 ── */
// ★★ 必须 **await open()**（2026-10-05 修，我引入的坑）：
//   open() 在等数据落地期间会**每 300ms 展开一次左栏**，
//   而这里原来写的是 `open(); …`（**没有 await**）⇒ 它会在**后台继续跑**，
//   与后面的断言**抢同一个 DOM 状态**。
//   实测症状：左栏怎么折都会弹开 —— 连 `summary.click()`（真实用户路径）
//   都"折不动"，看起来像产品有 bug，其实是**判据在自己污染被测对象**。
//   ⇒ 教训：判据里凡是有副作用的异步动作，**一律 await 到它收工**。
await ev(`(async () => { await window.__kaipuProbe.open(); return 1 })()`)
/* ★★ 107：默认态判据必须落在**这里**（open() 之后、任何 text()/expandIn 之前）——
 *   下一行的 text() 会 expandIn(document)，**它本身就是污染源**：
 *   实测第一版把本段放在别处时，读到的是「执行方 open=true」⇒ 假红。
 *   ⇒ 凡断「产品默认折叠态」的断言，只能插在这两行之间。（⑦.1 段）*/
const leftReadyBeforeExpand = await ev(`document.querySelector('[data-kaipu-left]') !== null`)
if (leftReadyBeforeExpand === true) {
  console.log('\n── ⑦.1 左栏三块折叠（107 · 方案 D）──')
  /**
   * ★★ 这一段守的是 `107` 的四条行为，每条都能失败：
   *
   *   ① **默认态**：场景块**展开**、参考两块**收起** —— 这是"省空间"的落点；
   *   ② ★★ **可多开**（不互斥）：点开「执行方」后，**场景块仍然展开**
   *      —— 若谁改回手风琴式互斥，这条当场红；
   *   ③ ★★ **分类默认展开**：首屏能直接看到**全部**场景行（107 改前只可见 2/5）
   *      —— 这条防的是"选场景要点两次"；
   *   ④ **收起态仍给出信息**：三块标题行分别写着数量/当前场 —— 不能收起来就什么都不知道。
   *
   * ⚠️ ⚠️ **本段有一个必须交代的判据位置问题**（不写下来下一个人会踩）：
   *   它读的是**默认态** ⇒ 必须在**任何 `expandAll()` 之前**跑。
   *   实测跑序：本段在 ⓪.1 之后、① 之前 —— 而 ⓪ 折叠边界那段（L1043 附近）会
   *   `collapseAll()` + `expandAll()`。本段位于它**之后**，所以**必须自己把默认态摆回来**：
   *   先 reload 式地重置（下面用显式 close 再开），不能假定"刚打开就是默认态"。
   *   ⇒ 做法：把三块**先全部关掉、再只按"产品默认"期望的状态断言**，
   *     但**不自己设 open** —— 而是用"读到的初始值"与期望比对（读，不写）。
   *     ★ 这就是"断默认态"的正确姿势：**观测，不布置**。
   */
  const blocks = await ev(`(() => {
    const left = document.querySelector('[data-kaipu-left]')
    if (left === null) return null
    const blk = (id) => left.querySelector('[data-kaipu-block="' + id + '"]')
    const info = (id) => {
      const d = blk(id)
      if (d === null) return null
      const s = d.querySelector('summary')
      return {
        open: d.open,
        summary: (s === null ? '' : s.innerText).replace(/\\s+/g, ' ').trim().slice(0, 40),
        h: Math.round(d.getBoundingClientRect().height),
      }
    }
    const cats = [...left.querySelectorAll('details[data-kaipu-category]')]
    const rows = [...left.querySelectorAll('button[aria-pressed]')]
    const txt = left.innerText || ''
    return {
      agents: info('agents'),
      recommend: info('recommend'),
      scenes: info('scenes'),
      ids: [...left.querySelectorAll('[data-kaipu-block]')].map((d) => d.getAttribute('data-kaipu-block')),
      blockCount: left.querySelectorAll('[data-kaipu-block]').length,
      cats: cats.length,
      catsOpen: cats.filter((d) => d.open).length,
      rowsTotal: rows.length,
      rowsInText: rows.filter((b) => txt.includes(b.getAttribute('aria-label') || '@@')).length,
      sects: [...left.querySelectorAll('[data-kaipu-sect]')].map((e) => e.getAttribute('data-kaipu-sect')),
    }
  })()`)
  say(blocks !== null && blocks.blockCount === 3, `左栏三块各有折叠容器（实读 ${blocks?.blockCount ?? 0} 个：${(blocks?.ids ?? []).join(' / ')}）`)
  /**
   * ★★★ 说明文字的判据**换口径**（2026-10-18 · 左栏瘦身）。
   *
   * ── 原判据为什么不再适用 ────────────────────────────────────────
   *   原来断："推荐块的 `summary.innerText` 里含那句完整说明"。
   *   但发起人要求左栏瘦身 ⇒ 改成 **hint 只在展开时渲染**（收起时挂 `title`，悬停可读）。
   *   而 recommend 块**默认收起** ⇒ 原判据必然红。**这不是产品坏了，是形态变了。**
   *
   * ── 但**不能只把断言删掉或放宽**（那正是本项目最忌的"判据退化"）──
   *   一条换成三条，把"藏起来"和"删掉了"分开守：
   *     ① 收起时**不占位**（省高度真的生效）—— 反向断言，能抓到"又改回常驻"
   *     ② 收起时**仍在悬停里**（信息没丢）—— 能抓到"顺手删了"
   *     ③ 展开时**照常显示，且仍是那句定稿**（不承诺同名）—— 保住原语义
   *   ★ 这三条合起来比原来那条**更强**：原来只证"在"，证明不了"收起后省了空间"。
   */
  const hintProbe = await ev(`(async () => {
    const d = document.querySelector('[data-kaipu-left] [data-kaipu-block="recommend"]')
    if (d === null) return { err: 'no block' }
    const KEY = '推荐名称不一定与场景同名'
    const sum = () => d.querySelector('summary')
    const whenClosed = (sum()?.innerText || '').includes(KEY)
    const titleWhenClosed = (sum()?.getAttribute('title') || '').includes(KEY)
    const wasOpen = d.open
    d.open = true
    await new Promise((r) => setTimeout(r, 220))
    const whenOpen = (sum()?.innerText || '').includes(KEY)
    d.open = wasOpen
    await new Promise((r) => setTimeout(r, 220))
    return { whenClosed, titleWhenClosed, whenOpen, restored: d.open === wasOpen }
  })()`)
  say(hintProbe?.whenClosed === false, '★ 收起时说明文字**不占位**（左栏瘦身生效）')
  say(hintProbe?.titleWhenClosed === true, '★ 收起时说明文字**仍在悬停提示里**（藏着，但没删）')
  say(
    hintProbe?.whenOpen === true,
    '★★ 展开时说明**照常显示**，且仍是「推荐名称不一定与场景同名」（删除限定或恢复找同名文案即失败）',
  )
  say(
    blocks?.scenes?.open === true,
    `★★ 默认**场景块展开**（它是左栏本职）—— 实读 open=${blocks?.scenes?.open}，标题行「${blocks?.scenes?.summary ?? '?'}」`,
  )
  say(
    blocks?.agents?.open === false && blocks?.recommend?.open === false,
    `★★ 执行方与推荐默认收起，场景保持可见：执行方 open=${blocks?.agents?.open} · 推荐 open=${blocks?.recommend?.open}`,
  )
  const agentSummary = await ev(`(() => {
    const left = document.querySelector('[data-kaipu-left]')
    const text = left?.querySelector('[data-kaipu-agent-summary]')?.innerText ?? ''
    const cards = [...(left?.querySelectorAll('[data-kaipu-agent]') ?? [])]
    const pending = cards.filter(c => c.getAttribute('data-kaipu-agent-status') === 'pending').length
    const disabled = cards.filter(c => c.getAttribute('data-kaipu-agent-status') === 'disabled').length
    return { text, total: cards.length, pending, disabled }
  })()`)
  say(agentSummary !== null
    && agentSummary.text.includes('（' + agentSummary.total)
    && (agentSummary.pending === 0 || agentSummary.text.includes(agentSummary.pending + ' 待接入'))
    && (agentSummary.disabled === 0 || agentSummary.text.includes(agentSummary.disabled + ' 已停用')),
    '收起态计数及待接入、已停用摘要与目录实际状态一致（删除摘要或计数漂移即失败）')
  say(
    blocks?.agents?.summary?.includes('执行方') === true
      && blocks?.recommend?.summary?.includes('该怎么选') === true
      && blocks?.scenes?.summary?.includes('场景') === true,
    `★ 收起态仍给出信息：三块标题行分别写着「${blocks?.agents?.summary ?? '?'}」「${blocks?.recommend?.summary ?? '?'}」「${blocks?.scenes?.summary ?? '?'}」`
      + ' —— 收起来不等于看不见（数量/当前场都在标题行上）',
  )
  say(
    blocks?.cats === blocks?.catsOpen && (blocks?.cats ?? 0) > 0,
    `★★ **分类默认展开**（${blocks?.catsOpen ?? '?'}/${blocks?.cats ?? '?'}）—— 107 改前是"3 个分类收起 2 个 ⇒ 5 个场景行只可见 2 个"，`
      + '手风琴下"看场景"要两次点击；现在首屏 0 次点击',
  )
  say(
    blocks?.rowsInText === blocks?.rowsTotal && (blocks?.rowsTotal ?? 0) > 0,
    `★★ 默认态就能看到**全部**场景行（${blocks?.rowsInText ?? '?'}/${blocks?.rowsTotal ?? '?'} 在可见文本里）—— 这就是"直接可选场"`,
  )
  // ★★ ② 可多开：点「执行方」⇒ 场景块**仍展开**（互斥版在这里会红）
  // 记录初始态，验证切换可逆且不会收走场景。
  const multiOpen = await ev(`(async () => {
    const left = document.querySelector('[data-kaipu-left]')
    const blk = (id) => left.querySelector('[data-kaipu-block="' + id + '"]')
    const s = blk('agents').querySelector('summary')
    const before = blk('agents').open
    s.click()
    await new Promise((r) => setTimeout(r, 500))
    const afterOpen = blk('agents').open
    const scenesOpen = blk('scenes').open
    s.click()   // 复原
    await new Promise((r) => setTimeout(r, 400))
    const restored = blk('agents').open
    return { before, afterOpen, scenesOpen, restored }
  })()`)
  say(
    multiOpen?.afterOpen === !multiOpen?.before && multiOpen?.scenesOpen === true,
    `★★ **可多开**（不互斥）：点「执行方」⇒ 状态翻转（${multiOpen?.before}→${multiOpen?.afterOpen}）而**场景块仍展开**（${multiOpen?.scenesOpen}）—— 若改手风琴互斥，这条红（106 §二 代价：跳动 112px + 内容被收走）`,
  )
  say(multiOpen?.restored === multiOpen?.before, '★ 再点一下能复原（状态可逆，非单向开关）')

  /* ── ⑦.2 左栏宽度档位（2026-10-08 · 109 评估 → 古茶拍板「做 C+D」）────────────
   *
   * 依据：`109` 实测 —— 把三块内容搬到主区（887px）与**把左栏加宽到 420px**，
   *   量出来的内容高**完全一样**（都是 −167px），因为高度由文本换行决定、
   *   而换行在 420px 已不再发生。古茶判句：「同样收益，选代价最低的那条路」。
   *   ⇒ 做 C（加宽档位）+ D（三块折叠，⑦.1 已验）。
   *
   * ★★ 本段要守的两件事，都不是"按钮在不在"：
   *   ① **加宽是真的**（实读宽变了）**且主区真的让了位**（量主区宽）——
   *      只断"属性变成 340"会漏掉一种坏法：属性改了但布局没跟上（本仓踩过
   *      `font:'inherit'` 吞掉字重那种"写了但没生效"）。
   *   ② **能点回去**（回绕到最窄档）—— 否则用户加宽之后没有回头路，
   *      那就把"给用户一个开关"做成了"给用户一个单向阀门"。
   *
   * ★ 反向断言（同族纪律：能翻转才算判据）：**左栏收起时这颗按钮必须不在** ——
   *   没有栏可调宽，留着它就是一个按不动的按钮（`NARROW_BREAKPOINT` 那条"假承诺"）。
   */
  console.log('\n── ⑦.2 左栏宽度档位（109 · 加宽）──')
  const widen = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const leftEl = document.querySelector('[data-kaipu-left]')
    const aside = leftEl === null ? null : leftEl.parentElement
    const btn = document.querySelector('[data-kaipu-left-widen]')
    const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('[data-kaipu-run]') !== null)
    const W = (el) => (el === null || el === undefined ? null : Math.round(el.getBoundingClientRect().width))
    if (btn === null || aside === null || sec === undefined) return { btn: false }
    const read = () => ({ attr: aside.getAttribute('data-kaipu-left-w'), actual: W(aside), main: W(sec) })

    const seq = [read()]
    let back = false
    for (let i = 0; i < 4; i++) {
      btn.click()
      await sleep(430)
      const r = read()
      seq.push(r)
      if (r.attr === '260') { back = true; break }
    }

    // ★ 反向断言的前置：收起左栏 ⇒ 调宽按钮应当消失
    const toggle = document.querySelector('[data-kaipu-left-toggle]')
    let widenWhenFolded = null
    if (toggle !== null) {
      toggle.click()
      await sleep(420)
      widenWhenFolded = document.querySelector('[data-kaipu-left-widen]') !== null
      toggle.click()
      await sleep(420)
    }
    return { btn: true, seq: seq, back: back, widenWhenFolded: widenWhenFolded }
  })()`)

  say(widen?.btn === true, '★ 宽屏下把手第二颗按钮在（[data-kaipu-left-widen]，调宽）')
  say(widen?.seq?.[0]?.attr === '260', `★ 默认档 = 260（不主动加宽；实读 ${widen?.seq?.[0]?.attr ?? '（无）'}）`)
  say(
    (widen?.seq?.[1]?.actual ?? 0) > (widen?.seq?.[0]?.actual ?? 0),
    `★★ 点一下**真的变宽**：实读 ${widen?.seq?.[0]?.actual ?? '?'}px → ${widen?.seq?.[1]?.actual ?? '?'}px`
      + `（量的是布局宽，不是属性值）`,
  )
  say(
    (widen?.seq?.[1]?.main ?? 1e9) < (widen?.seq?.[0]?.main ?? 0),
    `★★ 主区**确实让了位**：${widen?.seq?.[0]?.main ?? '?'}px → ${widen?.seq?.[1]?.main ?? '?'}px`
      + `（加宽的代价落在这里 —— 也正因如此它不该是默认）`,
  )
  say(widen?.back === true, '★ 能点回来（到顶回绕到最窄档 —— 有回头路，不是单向阀门）')
  say(
    widen?.widenWhenFolded === false,
    `★ 反向：左栏收起时调宽按钮**不在**（实读 ${String(widen?.widenWhenFolded)} —— 没有栏可调宽就不给按钮）`,
  )

  /**
   * ★★ 小节标题在最窄档**不许被压折行**（2026-10-17 · 发起人要求「执行方后面换行」）。
   *
   * ── 守的是什么 ──────────────────────────────────────────────────────
   *   左栏 260px 下，标题行原来是 `flex` 不换行 ⇒ 标题被压缩到 138px、
   *   **自己内部折成两行**（实测 h 从 18px 变 35px），而右侧摘要还挤在同一行。
   *   现在给标题行加了 `flexWrap`：放不下时**摘要整块落到第二行**，标题保持一行。
   *
   * ── 为什么断"标题高度"而不是"有没有换行" ──────────────────────────
   *   "摘要换到第二行"是**期望形态**，但它本身也可能顺手把标题压折（两者同时发生）。
   *   真正要守的是：**标题不被压缩折行** —— 这是"换行"能好看的前提。
   *   ⇒ 断 `titleH <= 24`（单行 18px；两行 35px）。
   *
   * ★ 它能失败：把 `flexWrap: 'wrap'` 去掉 ⇒ 标题立刻被压缩折行 ⇒ h=35 ⇒ 红。
   * ★ 这段执行时左栏正好在**最窄档**（上面 `widen` 流程最后回到 260），所以量到的是窄档。
   */
  const titleWrap = await ev(`(() => {
    const left = document.querySelector('[data-kaipu-left]')
    if (left === null) return { err: 'no left' }
    const sect = [...left.querySelectorAll('[data-kaipu-sect]')].find((e) => (e.innerText || '').includes('执行方'))
    if (sect === undefined) return { err: 'no sect' }
    const row = sect.firstElementChild
    const kids = [...row.children].filter((e) => e.nodeType === 1)
    const titleEl = kids[0]
    const tops = [...new Set(kids.map((e) => Math.round(e.getBoundingClientRect().top)))]
    return {
      leftW: Math.round(left.getBoundingClientRect().width),
      titleH: titleEl === undefined ? -1 : Math.round(titleEl.getBoundingClientRect().height),
      lines: tops.length,
    }
  })()`)
  say(
    titleWrap?.titleH !== undefined && titleWrap.titleH > 0 && titleWrap.titleH <= 24,
    `★ 最窄档下小节标题**不被压折行**（实读 h=${titleWrap?.titleH ?? '?'}px ≤ 24；左栏 ${titleWrap?.leftW ?? '?'}px，`
      + `标题行 ${titleWrap?.lines ?? '?'} 排）—— 去掉 flexWrap 它会当场变 35px`,
  )

}


const opened = await ev(`window.__kaipuProbe.text().includes('开铺审计')`)
say(opened === true, '面板打开，默认场景已选中')
if (opened !== true) {
  console.log('\n✗ 面板没打开 —— 后面的断言没有意义，直接退出。')
  ws.close()
  process.exit(1)
}

/* ── 0. 过程可见性（A 组默认展开 + B 组过程概览 · 2026-10-06 古茶 013）──
 *
 * ★★ 为什么这几条必须**排在别处动手之前**：
 *   要断的是「**默认态**就看得见」—— 而本探针后面到处都会 `expandIn()` / `expandAll()`
 *   （那是为了断"内容在不在"，见顶部注释）。一旦有人展开过，"默认态"就没了。
 *   ⇒ 紧跟 `open()` 之后跑：此刻面板刚渲染完，**没人动过**它里面的折叠。
 *
 * ★★ 本段同时就是 **D-D3 的验收**（008 §1.2「新增锚点必须在 data-kaipu-run 之外」）。
 *   给的是一组**能失败的反向断言**：把 ProcessFacts 挪回 data-kaipu-run 内，
 *   下面 procInsideRun / procInRunCount 两条会**当场变红** ——
 *   而不是像"减法式隔离"那样（锚点改名 ⇒ 静默失效 ⇒ 判据照旧全绿）。
 */
console.log('\n── ⓪ 过程可见性：A 组默认展开 + B 组过程概览 ──')
const proc = await ev(`(async () => {
  const run = document.querySelector('[data-kaipu-run]')
  const procEl = document.querySelector('[data-kaipu-process]')
  if (run === null) return null
  // A 组：过程内容长在**轮次块里**（details 的第二个子节点 —— summary 之后那块）。
  //   ★ 用 textContent 量"有没有内容"：本段**故意不展开**，
  //     而 innerText 对"自己没被渲染的元素"会回落到 textContent（同一份），
  //     所以长度这一项量的是"内容在不在"。**"看不看得见"由 roundOpen 与 runDefaultLen 两条管**。
  const bodies = [...run.querySelectorAll('[data-kaipu-round]')].map((d) => {
    const body = [...d.children].find((c) => c.tagName !== 'SUMMARY')
    return body === undefined ? 0 : (body.textContent || '').length
  })
  return {
    procPresent: procEl !== null,
    // ★★ 反向断言核心：它在不在运行视图**里面**
    procInsideRun: procEl !== null && procEl.closest('[data-kaipu-run]') !== null,
    // ★★ 反向断言之二：从运行视图**里**搜，搜不搜得到这个锚点
    procInRunCount: run.querySelectorAll('[data-kaipu-process]').length,
    // ★ 旧的"减法锚点"应已退役 —— 还在说明迁移只做了一半
    legacyFacts: document.querySelectorAll('[data-kaipu-facts]').length,
    procText: procEl === null ? '' : (procEl.innerText || ''),
    // ★ 只数**轮次块**的折叠态：运行视图里还有一个演示脚手 details 是"默认该折"的
    //   （DemoErrorHarness），把它算进来会让"全部展开"这条断言**永远红**。
    roundTotal: run.querySelectorAll('[data-kaipu-round]').length,
    roundOpen: run.querySelectorAll('[data-kaipu-round][open]').length,
    bodyTextLen: bodies.reduce((a, b) => a + b, 0),
    // ★★ 默认态下**从运行视图读到的文本**：折叠内容不进祖先的 innerText
    //   ⇒ 若轮次是折着的，这个长度会明显小于过程正文之和。
    runDefaultLen: (run.innerText || '').length,
  }
})()`)
say(proc?.procPresent === true, '★ B 组：过程概览有独立锚点（[data-kaipu-process]）')
say(
  proc?.procPresent === true && proc?.procInsideRun === false,
  '★★ D-D3：该锚点在运行视图**之外**（closest([data-kaipu-run]) === null）—— 先隔离，再展示',
)
say(
  proc !== null && proc.procInRunCount === 0,
  `★★ D-D3 反向：运行视图**内**搜不到该锚点（${proc?.procInRunCount ?? 0} 个）—— 边界靠结构，不靠减法`,
)

/* ★★★ 行动带的判据边界（2026-10-17 · Codex 验收 P2 订正后**补上**）
 *
 * ── 为什么这一条必须存在（这是本轮最该记住的一条）──────────────────────────
 *   `ActionBar` 第一版写在 `RightPane` 内部，而 `<div data-kaipu-run>` 包住整个
 *   `RightPane` ⇒ 它**实际在判据边界之内**；但当时**注释写着"三者都在 run 之外"**。
 *   注释与事实相反，而当时**没有任何断言在守这件事** —— 属于典型的「没人守，就会漂」。
 *   ⇒ 光把它挪出去不够，必须有断言**真的量祖先关系**（Codex 验收原话：
 *     「应……并补上真实祖先关系断言」）。
 *
 * ★ 两条互为正反，都能失败：
 *   · 正向：锚点在场（挪走/改名 ⇒ 红）
 *   · 反向：`closest('[data-kaipu-run]') === null` 且 run 内计数为 0
 *     （**挪回边界内 ⇒ 立刻红**，正是第一版犯的错）
 */
const abBar = await ev(`(() => {
  const ab = document.querySelector('[data-kaipu-actionbar]')
  if (ab === null) return { present: false, insideRun: null, inRunCount: -1 }
  return {
    present: true,
    insideRun: ab.closest('[data-kaipu-run]') !== null,
    inRunCount: document.querySelectorAll('[data-kaipu-run] [data-kaipu-actionbar]').length,
  }
})()`)
say(abBar?.present === true, '★ 行动带有独立锚点（[data-kaipu-actionbar]）')
say(
  abBar?.present === true && abBar?.insideRun === false,
  '★★★ 行动带在运行视图**之外**（closest([data-kaipu-run]) === null）—— 第一版误放在边界内且注释声称在外，此条专防复发',
)
say(
  abBar !== null && abBar.inRunCount === 0,
  `★★ D-D3 反向：运行视图**内**搜不到行动带（${abBar?.inRunCount ?? 0} 个）—— 边界靠结构，不靠注释自律`,
)
say(
  proc !== null && proc.legacyFacts === 0,
  `★ 旧锚点（[data-kaipu-facts]）已退役（全页 ${proc?.legacyFacts ?? 0} 个）—— 迁移没留双锚点`,
)
say(
  proc !== null && proc.roundTotal > 0 && proc.roundOpen === proc.roundTotal,
  `★★ A 组：轮次块**默认就是展开的**（${proc?.roundOpen ?? 0}/${proc?.roundTotal ?? 0}）—— 不用点开也看得见`,
)
say(
  proc !== null && proc.bodyTextLen > 0,
  `★★ A 组：默认态下轮次过程**真有内容**（${proc?.bodyTextLen ?? 0} 字）—— 不是"展开了但空的"`,
)
say(
  proc !== null && proc.runDefaultLen > proc.bodyTextLen,
  `★★ A 组：这些内容**默认就进了运行视图的可见文本**（${proc?.runDefaultLen ?? 0} > ${proc?.bodyTextLen ?? 0} 字；折着的话不会进）`,
)
say((proc?.procText ?? '').includes('本场审核面'), '★ B 组：显示「本场审核面」（这一场跑了哪些审核面）')
say((proc?.procText ?? '').includes('轮次走向'), '★ B 组：显示「轮次走向」（回炉结构可见；不伪造每轮时刻）')

/* ── ⓪.1 C 组「这场谁来审 / 要过哪几面」（2026-10-08 · 设计稿 086 §二 落地）──
 *
 * ★★ 这一段是 **D-D3 的第二个验收**：新锚点 `[data-kaipu-seatlamp]` 必须落在
 *    `[data-kaipu-run]` **之外**。
 *
 * ★★ 为什么这条必须有（不是形式主义）：
 *    本探针下面 R4 那条断的是「被裁剪的审核面（`仁灯`）在报告里可见」，
 *    它读的是 `[data-kaipu-run]` **内**的文本。而位/灯面板**按设计就列出全部审核面**
 *    （含仁灯）⇒ **一旦有人把面板挪进运行视图，R4 会恒真** ——
 *    不管报告里有没有仁灯，"仁灯"两个字都能在灯栏里被找到。
 *    下面两条反向断言就是这个动作的**当场报警器**。
 *
 * ★ 跑在这一段是因为：此刻场景**已经选中**（上一段 ⓪ 的 `roundTotal > 0` 已证明），
 *   而 `SeatLampPanel` 只在选中场景时渲染（`scene === null` ⇒ `null`）。
 */
console.log('\n── ⓪.1 C 组：这场谁来审 / 要过哪几面（位栏 + 灯栏）──')
const sl = await ev(`(() => {
  const el = document.querySelector('[data-kaipu-seatlamp]')
  const run = document.querySelector('[data-kaipu-run]')
  if (el === null) return { hasEl: false, hasRun: run !== null }
  const seats = [...el.querySelectorAll('[data-kaipu-seats] > div')].map((d) => (d.innerText || '').trim())
  // ★ 夜话改版：灯栏画成灯阵，每盏是一个 [data-kaipu-lamp] 列（圆点 + 名字 + 状态）；
  //   duty 短名收进列的 hover \`title\`，不再进可见文本。⇒ 判据分两路：
  //   ① 名字/状态走 innerText；② duty 走 title（"duty 被消费"这条断言改验 hover）。
  const lampCols = [...el.querySelectorAll('[data-kaipu-lamps] [data-kaipu-lamp]')]
  const lampText = lampCols.map((d) => (d.innerText || '').trim()).join(' | ')
  const lampTitles = lampCols.map((d) => (d.getAttribute('title') || '')).join(' | ')
  return {
    hasEl: true,
    hasRun: run !== null,
    insideRun: el.closest('[data-kaipu-run]') !== null,
    inRunCount: run === null ? -1 : run.querySelectorAll('[data-kaipu-seatlamp]').length,
    seatCount: seats.length,
    seatText: seats.join(' | '),
    lampCount: lampCols.length,
    lampText,
    lampTitles,
    hasLightFirst: el.querySelector('[data-kaipu-light-first]') !== null,
  }
})()`)
say(sl?.hasEl === true, '★ C 组：位/灯面板在场（[data-kaipu-seatlamp]）')
say(sl?.insideRun === false, '★★ D-D3：该锚点在运行视图**之外**（closest([data-kaipu-run]) === null）')
say(sl !== null && sl.inRunCount === 0, `★★ D-D3 反向：运行视图**内**搜不到该锚点（${sl?.inRunCount ?? 0} 个）`)
say(sl !== null && sl.seatCount === 4, `★ 位栏按契约四席渲染（实测 ${sl?.seatCount ?? 0} 行）`)
say(sl?.seatText?.includes('执行位') === true, `★ 位栏显示位名 · 且承担方取 holderName（${sl?.seatText ?? ''}）`)
say(sl !== null && sl.lampCount > 0, `★ 灯栏按场景渲染（实测 ${sl?.lampCount ?? 0} 盏灯）`)
say(sl?.lampText?.includes('智灯') === true, `★ 灯栏显示审核面名（${sl?.lampText ?? ''}）`)
say(
  sl?.lampTitles?.includes('·') === true,
  '★ 灯栏 hover 显示契约 v1.5 的 duty 职责短名（收进 title，不铺页面）',
)
say(sl?.hasLightFirst === true, '★ 灯栏下方有「🪔 点亮第一盏灯」出口按钮（把待接入从状态变成动作）')

/* ── 0. 首屏引导（第一眼"知道这是什么、该看哪几处"） ── */
console.log('\n── ⓪ 首屏引导 —— 第一眼就知道怎么用 ──')

/* ══ ⓪.0 数据源的**两态锚点** + 两态截图（2026-10-07 加 · 096 显式改写）════════
 *
 * ★★ 2026-10-08 · 096 **显式改写**（改对象，不是放松断言）：
 *   本条原断的是「引导卡**默认态跟随数据源**」（演示 ⇒ 展开 / 非演示 ⇒ 收起）。
 *   096 把「怎么用」提拔成**独立页签**后，引导不再有"默认展开 / 收起"这回事
 *   （整页即内容）⇒ **那个产品行为不存在了**，原来那三条断言失去对象。
 *   ⇒ 保留这段的**另一半价值**：
 *     ① 数据源有结构锚点（[data-kaipu-source-mock]）、且两态可往返；
 *     ② **两态截图**（demo / nondemo）—— 它是末尾"截图有证据力"那条自检的必要输入。
 *   **不为了让它变绿而把断言改松**：原来的对象没了，就换成现在真实存在的对象。
 *   （与 ⓪.2 灯名白名单那次改写同一条纪律。）
 *
 * ★★ 它仍**依赖本探针开头那一次页面刷新**：那段注释讲了为什么
 *   （不刷新 ⇒ 上一跑留下的状态还在 ⇒ 反向断言**假红**）。
 *   两段是一件事的两半，改一段要回头看另一段。
 *
 * ★ 为什么拿数据源的**结构锚点**（[data-kaipu-source-mock]）而不是中文标签：
 *   认文案的判据改一次文案就响一次，逼人去改判据 —— 改着改着就改松了。
 */
/* ★★ ⓪.1 分状态截图（2026-10-07 加）
 *   下面三个来回（读 / 切 / 等）**全是只读**，所以"没人动过引导"这个前提没被破坏 ——
 *   拆成多次 ev 往返只是多了几拍 await，产品状态一个字节都没变。
 *   截图本身也不改页面（captureScreenshot 只抓帧）。
 *   ⇒ 于是能在**演示态**与**非演示态**各留一张，两张状态不同、哈希必然不同。 */
const shotBase = SHOT === undefined ? undefined : SHOT.replace(/\.png$/i, '')
const shootIf = async (suffix) => {
  if (shotBase === undefined) return
  await shoot(shotBase + suffix + '.png')
}

// ① 演示态：此刻 open() 刚把数据源切到演示数据，且**没人动过引导**
const demoDefault = await ev(`window.__kaipuProbe.readSource()`)
await shootIf('-demo')
// ② 切到非演示（真服务端 / 连不上 —— 两者对"引导该不该展开"是同一个答案）
const srcToggled = await ev(`window.__kaipuProbe.toggleSource()`)
const nonReady = await ev(`window.__kaipuProbe.waitSourceMock('0')`)
const nonDemoDefault = await ev(`window.__kaipuProbe.readSource()`)
await shootIf('-nondemo')
// ③ 切回演示 —— 默认态应当**自己回来**
await ev(`window.__kaipuProbe.toggleSource()`)
const backReady = await ev(`window.__kaipuProbe.waitSourceMock('1')`)
const backDefault = await ev(`window.__kaipuProbe.readSource()`)
say(
  srcToggled === true && nonReady === true && backReady === true,
  '★ 数据源切到非演示后，再切回演示（往返成功）',
)
say(
  demoDefault?.mock === '1' || demoDefault?.mock === '0',
  `★★ 数据源有**结构锚点**（[data-kaipu-source-mock]）—— 判据不靠中文标签认模式（实读「${demoDefault?.sourceText ?? ''}」）`,
)
say(
  demoDefault?.mock === '1',
  '★★ 数据源**结构锚点**落在演示态（[data-kaipu-source-mock]=1）',
)
say(
  nonDemoDefault?.mock === '0',
  `★★ 切到**非演示**后锚点翻到 0（实读「${nonDemoDefault?.sourceText ?? '?'}」）`
    + ' —— 两态截图因此状态不同、哈希必然不同',
)
say(
  backDefault?.mock === '1',
  '★★ 往返：切回演示 ⇒ 锚点回到 1（数据源切换可逆）',
)


// ★★ 096：「怎么用」现在是独立页签 ⇒ **先切过去**，引导内容才在 DOM 里。
//   不切就读 ⇒ introText() 返回空串 ⇒ 下面所有 includes 恒 false（本仓反复栽过的假绿）。
const toHelp = await ev(`window.__kaipuProbe.switchTab('help')`)
say(toHelp === true, '★ 可切到「怎么用」页签（[data-kaipu-tab="help"]）')
const full0 = await ev(`window.__kaipuProbe.text()`)
// ★ 2026-10-07：面板主标由「山海 · 开铺 · 场地」改为「山海 · 开铺」（工坊措辞/标题裁定 §三）。
//   本条**有意锚文案** —— 见 ⑬ 段品牌名那条注释里对"什么时候该锚文案"的判别：
//   这条要回答的问题就是"标题栏写的是哪几个字"，**文本内容即交付物本身** ⇒ 只能锚文案。
//   ⚠️ 它随标题改名而红是**预期**，不是回归。反向见 ⑭ 段（旧名必须 0 命中）。
say(full0.includes('山海 · 开铺'), '标题栏写清这是什么（「山海 · 开铺」）')
// ★ 措辞更正（2026-10-08 · 096）：这里原来写"引导卡**默认**展开"，
//   后改成"默认态跟随数据源"，现在**页签化** —— 不存在"默认展不展开"这回事了
//   （点了「怎么用」页签，整页即内容）。本条语义随之收窄为：
//   **切到「怎么用」页签后，三步上手的文案确实在**（不再谈默认态）。
//   判据的话说得比事实大一点，就是**夸大的判据** —— 与"不会失败的断言"同族。
say(full0.includes('第一次用？看这三步就够'), '「怎么用」页签里有三步上手（默认态一说不存在了）')

/* ══ ⓪.2 灯名一致性：契约正本 ↔ 演示数据 ↔ 界面文案（2026-10-07 **第二版**）════
 *
 * ★★ 这是一次**按预告执行的显式改写**，不是"判据红了就改松"。
 *
 *   第一版（同日早）断的是「引导卡不引用**演示数据的** lamp 值」，自变量取自 **mock 源码**。
 *   当时的注释里就写下了失效条件，原文如下 ——
 *
 *     > 一旦演示数据的 lamp 值与平台真值同源（v1.4 落地后据其对齐演示数据），
 *     > 这条的前提就变了：那时引导卡**若举例真灯名反而是对的**，本判据会**假红**。
 *     > ⇒ 届时应**显式改写**为「引导卡举例必须来自平台灯名白名单」，
 *     >   **不要**因为一次假红就把它改松或删掉。
 *
 *   ★ **今天就是"届时"**：契约 v1.4 已投、演示数据已对齐 ⇒ 旧自变量（mock 值）
 *     与"对错"**不再相关**（两边都成了灯名，比出来必然相等 ⇒ 判它无意义）。
 *     ⇒ **换自变量，不放松断言。** 这条界线值得说清：
 *       "该判的东西变了 ⇒ 改判据" ≠ "断言不过了 ⇒ 放松判据"。
 *
 * ★★ 新版自变量**不取自 mock、也不取自我方常量清单**，而取自**契约正本件**：
 *     从 `channel-inbox/083-interface-contract-v<最新>.md` 形态式抽 `"X灯"`。
 *     理由：**"该叫什么"的权威在契约，不在我方的记忆或清单里。**
 *     契约升版（v1.5…）⇒ 白名单自动跟上，**不必改这个文件**。
 *
 * 四条断言（互相不可替代，少一条就有一类故障静默漏过）：
 *   ① **白名单抽到了** —— 否则②④恒真（"不会失败的断言等于没有断言"）。
 *   ② **mock 的 lamp 值 ⊆ 白名单** ← 这是 **裁定(a)「内容自编 · 形状合契约」的落地判据**：
 *      内容可以自编（`agentName` 那些），但**取值域必须合契约**，越界 ⇒ 红。
 *   ③ **引导卡不含旧自编名**（反向）。★ 为什么必须有：② 只查 mock，而
 *      **引导卡的举例是硬编码文案**，与 mock 无关 ⇒ mock 干净时它照样可能写错值。
 *   ④ **引导卡里的 `X灯` 形态名 ⊆ 白名单**（正向）。★ 与 ③ 互补：
 *      ③ 管"已被证伪的旧名不许回来"，④ 管"不许冒出**别的**乱编的 `X灯`"。
 *
 * ★ 硬编码那 5 个旧名的**边界说明**（免得又落进"枚举式判据必然漏"）：
 *   那是**历史确定集合**（我方确实用过这 5 个），**不是"未来会新增的集合"**。
 *   第 N+1 个**新**名字由 ④（形态式）兜 —— 两条合起来才完整。
 *
 * ⚠️ 本段**依赖仓外文件**（契约件在项目仓 `channel-inbox/`）。
 *   找不到它时**判红，不静默跳过** —— 与"读不到就说读不到"同一条价值取向。
 *   探针本身在**排除面**（不入发布面），所以这个依赖不影响发布物。
 */
const mockFs = await import('node:fs')
const pathMod = await import('node:path')
const urlMod = await import('node:url')

/* ── ① 白名单：从**契约正本件**形态式抽取（不写死名字） ── */
const inboxPath = urlMod.fileURLToPath(new URL('../../../channel-inbox/', import.meta.url))
let contractPick = null
try {
  contractPick = mockFs.readdirSync(inboxPath)
    .map((f) => {
      /**
       * ★★ 文件名形态：`<前缀>-interface-contract-v<主>.<次>-<YYYYMMDD>.md`
       *
       * ⚠️ **首版这里写窄了，而且是当场被自己的判据抓到的**（2026-10-07）：
       *   初版写 `…v(\d+)\.(\d+)\.md$` —— 要求**以 `.md` 紧接版本号**，
       *   而实际投递件的版本号后面还有**日期后缀** ⇒ **一个都匹配不上**
       *   ⇒ `contractPick = null` ⇒ 白名单空 ⇒ ②④ 全红。
       *   ★ 它**没静默**，是因为下面那条"契约正本件在位"把它顶出来了 ——
       *     这正是"**给抽取器配一条自证**"的价值（否则会变成两条恒真的判据）。
       *   ★ 形态：本仓老账「正则过窄 ⇒ **静默**漏报」的又一次实例。
       *     过窄与过宽同族，但**过窄更阴**：过宽会误报被人看见，过窄是绿着看不见。
       *
       * ★★ 前缀**已放开为任意值**（2026-10-07 傍晚，同日内第二次修这里）：
       *   工坊第 33 次交付把契约**改名前缀**为 `kaipu-interface-contract-v1.4-20261007.md`
       *   （旧名 `083-` 那份**同时还在**，且 `cmp` 逐字节相同 ⇒ 纯改名）。
       *   ⇒ 若这里只认 `083-`，**这批新命名一落地、旧件一撤，白名单又会空**。
       *   ★ **这是同一个"写窄"的第二次**：上次窄在**尾部**（漏日期后缀），这次在**头部**（写死前缀）。
       *   ⇒ 所以这里**不再写死前缀**（`[0-9a-z]+-`），只认**中间那段稳定的形态**
       *     （`interface-contract-v<主>.<次>`）—— **稳定的是语义，不是命名习惯**。
       *   ⚠️ 但"开放"不等于"随便"：仍**要求以 `-interface-contract-v` 起头识别**，
       *     避免把 `…reply-073…` 之类的件误当契约（那是本判据唯一的真风险）。
       */
      const m = /^(?:[0-9A-Za-z]+-)?interface-contract-v(\d+)\.(\d+)(?:-\d+)?\.md$/.exec(f)
      return m === null ? null : { file: f, maj: Number(m[1]), min: Number(m[2]) }
    })
    .filter((x) => x !== null)
    /**
     * ★ 同名不同前缀时**确定性择一**（否则并列取 [0] 的结果依赖目录枚举顺序，不可复算）：
     *   先按版本降序；版本相同 ⇒ 按**文件名**升序（稳定、可复现）。
     *   ⇒ 现在 `083-…` 与 `kaipu-…` 并存（内容逐字节相同）也不会让结果飘。
     */
    .sort((a, b) => (b.maj - a.maj) || (b.min - a.min) || a.file.localeCompare(b.file))[0] ?? null
} catch {
  contractPick = null
}
say(
  contractPick !== null,
  '★★ 契约正本件**在位**（⓪.2 白名单的唯一来源）'
    + (contractPick === null
      ? '：★ 找不到 `channel-inbox/*-interface-contract-v*.md`（任何前缀都算）⇒ **红，不是跳过**'
        + '（先跑 `node tools/channel.mjs get <件名>` 取件再跑本探针）'
      : `：取最新版 \`${contractPick.file}\``),
)
const contractSrc = contractPick === null
  ? ''
  : mockFs.readFileSync(pathMod.join(inboxPath, contractPick.file), 'utf8')
const LAMP_WHITELIST = new Set(
  [...contractSrc.matchAll(/"([\u4e00-\u9fa5]{1,2}灯)"/g)].map((m) => m[1]),
)
say(
  LAMP_WHITELIST.size > 0,
  `★★ 白名单**真抽到了**灯名（${LAMP_WHITELIST.size} 个：${[...LAMP_WHITELIST].join(' / ')}）`
    + ' —— 否则下面②④两条恒真',
)

/* ── ② 演示数据的 lamp 值必须全在白名单内（裁定(a) 的落地判据） ── */
const mockPath = new URL('../../packages/plugin-platform/src/client/mock/data.ts', import.meta.url)
const mockSrc = mockFs.readFileSync(mockPath, 'utf8')
const uniqMockLamps = [...new Set([
  // ① 对象形式 `lamp: 'X'` —— 覆盖 `MOCK_SCENES[].lamps[].lamp` 与 SSE 事件里的灯字段
  ...[...mockSrc.matchAll(/\blamp:\s*'([^']+)'/g)].map((m) => m[1]),
  /**
   * ② 字符串数组形式 `lamps: ['X', 'Y']`（契约 v1.4 §3.3 的形状）
   *
   * ★★ 这里**必须只认"整段就是一个引号串"** —— 首版写的是"数组内容里所有单引号串"，
   *    于是 `{ lamp: '智灯', agentId: 'ag-1001', agentName: '主体核验方' }`
   *    里的 `'ag-1001'` / `'主体核验方'` **全被当成灯名抽了进来**
   *    ⇒ 实测抽出 10 个值，其中 6 个不是灯 ⇒ ② 那条**误红**（报"越界 6 个"）。
   *
   * ★★ 第二版又错了一次（**同一处、两种错法，一天内**）：
   *    改成 `/(?:^|[,\s\[])'([^']+)'/` 后**仍然误抽** —— 因为 `\s` **包含空格**，
   *    而 `agentId: 'ag-1001'` 的引号串前面正好是那个空格 ⇒ 再次命中。
   *    ⇒ 第三次改为**按逗号切段 + trim 后整段必须形如 `'X'`**：
   *      对象元素（`{ lamp: '智灯'`）与字段值（`agentId: 'ag-1001'`）都不是纯引号串 ⇒ 排除；
   *      字符串数组元素（`'智灯'`）正是纯引号串 ⇒ 收下。
   *
   * ★ 三次全在"**想用一个正则同时认两种形状**"上栽 ——
   *   教训：**形态不同就分开认**（① 认 `key: '值'`，② 认"整段是个值"），
   *   别写一个"看起来都能覆盖"的宽松式 —— 宽松式的每一个多余分支都是**误报**的来源。
   */
  ...[...mockSrc.matchAll(/\blamps:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => m[1].split(',')
      .map((seg) => seg.trim())
      .map((seg) => /^'([^']+)'$/.exec(seg))
      .filter((x) => x !== null)
      .map((x) => x[1])),
])]
const mockOffWhite = uniqMockLamps.filter((v) => !LAMP_WHITELIST.has(v))
say(
  uniqMockLamps.length > 0 && LAMP_WHITELIST.size > 0 && mockOffWhite.length === 0,
  `★★ 演示数据的 lamp 值**全在契约白名单内**（已核 ${uniqMockLamps.length} 个`
    + `${mockOffWhite.length === 0 ? '' : `，★ 越界 ${mockOffWhite.length} 个：${mockOffWhite.join(' / ')}`}）`
    + ' —— 这是裁定(a)「内容自编 · 形状合契约」的落地判据',
)

/* ── 因变量：引导卡自己的文本 ──
 * ★ 用 `introText()` 而**不是**整页文本 —— 整页含运行视图的灯名，拿它比必然重合，
 *   那是**判据边界没划对**（会让③④变成恒真的摆设）。
 * ★★ 并且**先断"因变量非空"**（阈值 80）—— 这一条是本仓真踩出来的假绿：
 *   `introText()` 在引导卡**不在 DOM** 时返回 `''` ⇒ 任何 `includes` 都恒 false
 *   ⇒ 把"卡根本没渲染"读成"文案很干净"。**前置条件必须显式断**，不能靠"它应该在那儿"。 */
const introOnlyText = await ev(`window.__kaipuProbe.introText()`)
const introOnlyLen = String(introOnlyText).length
say(
  introOnlyLen > 80,
  `★ 因变量**真的非空**（引导卡文本 ${introOnlyLen} 字）`
    + ' —— 否则下面两条在"卡不在/没渲染"时**恒绿**',
)

/* ── ③ 反向：引导卡不含旧自编名 ── */
const STALE_LAMP_NAMES = [
  // ★ 历史确定集合（我方确曾用过这 5 个），不是"未来会新增的集合"——
  //   新增名字由 ④ 的形态式白名单兜。**枚举的边界要写清，否则又成"必然漏"的那类。**
  '主体核验', '权责确认', '留痕完整性', '利益冲突筛查', '材料齐备性',
]
const hitStaleInIntro = STALE_LAMP_NAMES.filter((n) => String(introOnlyText).includes(n))
say(
  introOnlyLen > 80 && hitStaleInIntro.length === 0,
  `★★ 引导卡**不含旧自编名**（已核 ${STALE_LAMP_NAMES.length} 个`
    + `${hitStaleInIntro.length === 0 ? '' : `，★ 命中：${hitStaleInIntro.join(' / ')}`}）`
    + ' —— 那些是已被证伪的值（真值是灯名）',
)

/* ── ④ 正向：引导卡里出现的 `X灯` 形态名必须都在白名单内 ── */
/*
 * ★★ 一条**有意为之**的严格：`introLampMentions.length > 0` 也是判据的一部分 ——
 *   即"引导卡里**一个灯名都没有**"同样**判红**。
 *   为什么不算误伤：**举例本身是裁定要求的一部分**（工坊 25 次交付 §一 给的改后文案
 *   就带「例如…」，发起人已采纳；我方在 `071` 里也承诺过"v1.4 到位后把举例放回来"）。
 *   ⇒ 所以"举例不见了"是**回归**，不是一种设计选择。红得对。
 *   ★ 但把话说清楚：本条的完整语义是「**给出了举例、且举例都是对的灯名**」，
 *     不是"恰好没出现灯名就算过"。红时的输出会显示"（一个都没有）"以便区分两种成因。
 */
const introLampMentions = [...new Set(
  [...String(introOnlyText).matchAll(/[\u4e00-\u9fa5]{1,3}灯/g)].map((m) => m[0]),
)]
const introLampOffWhite = introLampMentions.filter((n) => !LAMP_WHITELIST.has(n))
say(
  introLampMentions.length > 0 && LAMP_WHITELIST.size > 0 && introLampOffWhite.length === 0,
  `★★ 引导卡**给出了举例且灯名都对**（提到 ${introLampMentions.length} 个：`
    + `${introLampMentions.join(' / ') || '（一个都没有 ⇒ 举例被删了，那是回归）'}`
    + `${introLampOffWhite.length === 0 ? '' : `，★ 越界：${introLampOffWhite.join(' / ')}`}）`,
)
/* ★★ 096 补丁（2026-10-08）：三步（左栏 / 右栏 / 拉到最底）**都必须带参照系「在操作台的」**。
 *
 * 为什么值得单独立一条（不是措辞洁癖）：
 *   「左栏 / 右栏」是**相对位置**，参照系是**操作台那一页**。096 把「怎么用」
 *   提拔成独立页签后，读者点进来时操作台**已不在屏幕上** ——
 *   此时"左栏"指向屏幕上不存在的东西。⇒ 一句话补参照系，这是**内容正确性**。
 *
 * ⚠️ 诚实记一条取舍：本断言**锚的是文案**（去掉前缀即变红）—— 违反了
 *   「判据锚结构不锚文案」那条老规矩。之所以接受：这里没有可锚的结构
 *   （补的是自然语言里的参照系，没有对应 DOM 属性）；而老写法
 *   includes('左栏选一场') 在前缀被删掉时**根本不会红**（它是子串）——
 *   一个恰好在这次改动上"不会失败"的断言。两害相权，取其能失败。
 */
say(
  full0.includes('在操作台的左栏选一场'),
  '★ 三步第 1 步：「左栏」**带参照系**「在操作台的」'
    + '（去掉前缀即红 —— 页签化后读者不在操作台上，光说"左栏"指向屏幕外）',
)
say(
  full0.includes('在操作台的右栏从上往下看'),
  '★ 三步第 2 步：「右栏」同样带参照系',
)
say(
  full0.includes('在操作台拉到最底看'),
  '★ 三步第 3 步：「拉到最底」也带参照系（它不指某个"栏"，前缀直接接在动词前）',
)
/* ★ 2026-10-08：这里原来还有一条 `includes('拉到最底看')` 的**子串**断言 ——
   已被上面「三步第 3 步」那条**完整句**断言覆盖，故删除。
   两弱不如一强：弱断言会给人"这里也被守着"的错觉，而它连前缀被删都抓不到。 */
say(full0.includes('四个词'), '有术语小节（执行方 / 场景 / 审核面 / 待接入）')
say(full0.includes('已接入的执行方及其状态。灰掉的是被有意关掉的，不是坏了。'), '执行方术语使用定稿完整句（删除状态解释即失败）')
say(!full0.includes('这场戏'), '帮助页不使用「这场戏」比喻（旧文案回归即失败）')
say(full0.includes('判定长什么样'), '有判定图例小节（让人把颜色和词对上）')

/* ── ④.5 术语口径：对外文本**不许出现「维」字**（2026-10-08 · 古茶拍板 §五）────
 *
 * ★★ 为什么单开一条：古茶拍板把这条从"提请工坊确认"改判为「**已定裁定要执行**」——
 *   口径已定：**内部叫灯次，对外叫审核面**。而服务端下发的场景名是**对外可见数据**。
 *   拍板稿 §五 表格第三行写得很直接：「**前端渲染：不加「维」字**」。
 *
 * ★ 为什么扫**四个页签全扫**，而不是只扫当前这一页：
 *   要守的是"**用户看不到这个字**"，那就按**能看到的最大范围**守。只盯渲染出来的那一处，
 *   等于默认"别处不会有"，而别处恰恰是这种字爱冒出来的地方 ——
 *   本项目**已经漏改过两次**（`N 维` 那行、以及若干注释里的"这一维"），
 *   两条都是在别的页签/别的块里被发现的。
 *
 * ★★ 它能失败，而且**两处都覆盖**：演示数据被我方写脏 ⇒ 红；
 *   **服务端下发含「维」 ⇒ 本节红**。这正是把"服务端那侧没改"变成**看得见的红**，
 *   而不是我方在件里写一句"已上报"就完事。
 */
/**
 * 已知含「维」的**数据真值**（不是我方文案）—— 待服务端改，我方每次跑**如实打印**。
 *
 * ★★ 每一条都要有出处（不许凭空开白名单）：
 *   ① `综合维度` —— 真服务端 `GET /agents[].role` 的实测值；我方 `mock/data.ts` **照着真值写**
 *      （有意为之：演示数据与真机一致，演示里才照得出真问题）。见 `mock/data.ts` 那条注释。
 *   ② `双灯审（技术维 + 安全维会商）` —— 真服务端 `GET /scenes` 下发的**场景名**。
 *      ★ 2026-10-08 实测：服务端 4 个场景名里**3 个已改成「审核面」**
 *        （轻量审（单审核面快速）/ 五灯会商审校（五审核面并行 + 汇总）/ 多审核面会商审校（四审核面并行 + 汇总）），
 *        **只剩这一个还带「维」** ⇒ 判据把漏网的那一个精确指了出来。
 *
 * ★ 为什么开白名单而不是把判据删掉/放松：这两处**都不是我方渲染出来的字**，
 *   是别人给我们、我们如实转显的值。改它们要么改服务端配置、要么我方"洗数据"——
 *   后者违反本层一贯纪律（**不就地换标签**，见 `PlatformPanel` 那条"换数据源 = 重新取"）。
 *   ⇒ 白名单 + **不得新增**才是诚实的形态：既说清"这两处还没改"，
 *     又保证**新冒出来的「维」当场红**（新增 = 没被注意到的漏改）。
 */
const KNOWN_WEI = ['综合维度', '双灯审（技术维 + 安全维会商）']
/**
 * 扫四个页签的可见文本，返回含「维」的句子（去重）。
 *
 * ★ 返回**两组**：
 *   · `fresh` —— 剔掉已知真值后**仍然**含「维」的句子 ⇒ **该红的**（我方文案或新漏改）
 *   · `known` —— 只剩已知真值的句子 ⇒ **每次打印**（"还没改完"这件事不许静默）
 * ★ 收尾**切回进入时的页签**（调用方不必记得它原来在哪 —— 免得给后面几段留一个意外的前态）。
 */
const scanWeiAcrossTabs = async (returnTo = 'console') => {
  const fresh = []
  const known = []
  for (const t of ['console', 'shop', 'manage', 'help']) {
    await ev(`window.__kaipuProbe.switchTab('${t}')`)
    await ev(`new Promise((r) => setTimeout(r, 300))`)
    const tx = await ev(`window.__kaipuProbe.text()`)
    for (const seg of String(tx ?? '').split(/[\n。；;]/u)) {
      const s = seg.trim()
      if (s === '' || !s.includes('维')) continue
      const stripped = KNOWN_WEI.reduce((acc, k) => acc.split(k).join(''), s)
      if (stripped.includes('维')) fresh.push(`[${t}] ${s}`)
      else known.push(`[${t}] ${s}`)
    }
  }
  await ev(`window.__kaipuProbe.switchTab('${returnTo}')`)
  await ev(`new Promise((r) => setTimeout(r, 250))`)
  return { fresh: [...new Set(fresh)], known: [...new Set(known)] }
}
const weiHits = await scanWeiAcrossTabs('console')
console.log('\n── ④.5 术语口径：对外文本不含「维」字 ──')
say(
  weiHits.fresh.length === 0,
  `★★ 我方渲染的文本**不含「维」字**（口径：内部叫灯次，对外叫审核面；四页签全扫）`
    + `${weiHits.fresh.length === 0 ? '' : ` —— ★ 命中 ${weiHits.fresh.length} 处：${weiHits.fresh.slice(0, 3).join(' ｜ ')}`}`,
)
console.log(
  `  · 已知**数据真值**含「维」（不是我方文案，**待服务端改**，共 ${weiHits.known.length} 处）：`
    + `${weiHits.known.slice(0, 3).join(' ｜ ') || '（本次未出现）'}\n`
    + `    ⇒ 白名单 = ${KNOWN_WEI.join(' / ')}；**清单之外新增任何「维」当场红**（本节上面的断言就是那条）`,
)

/* ★★ 096：「运行视图」在**操作台页** —— 读之前必须切回去（见 switchTab 的注释）。
   顺带在这一步验**页签互斥**：切回操作台 ⇒ 引导内容不在 DOM、运行视图回来。 */
const backToConsole = await ev(`(async () => {
  await window.__kaipuProbe.switchTab('console')
  return {
    introGone: document.querySelector('[data-kaipu-intro]') === null,
    runPresent: document.querySelector('[data-kaipu-run]') !== null,
  }
})()`)
say(backToConsole?.introGone === true, '★★ 页签互斥：切回操作台 ⇒ 引导内容不在 DOM（不是"藏起来"，是没渲染）')
say(backToConsole?.runPresent === true, '★ 切回操作台 ⇒ 运行视图回来（主内容照旧）')
const run0 = await ev(`window.__kaipuProbe.runText()`)
// ★★ 这条是**判据边界的自证**：引导卡的图例若落进运行视图，
//   下面 R3 那几条（"运行视图里出现了 ⚡有条件"）就成了恒真空断言。
say(!run0.includes('第一次用？'), '★ 判据边界成立：运行视图文本里**不含**引导内容（图例不污染 R3）')
say(run0.length > 0, `运行视图区域可被独立取到（${run0.length} 字）`)

/* ★★ 096 删除：原这里验「卡右上角有『收起』+ 收起后卡从 DOM 消失 + 可再展开」。
   「收起」按钮已随页签化删除（「怎么用」整页即内容）⇒ 该组**失去对象**，
   容器与互斥的验证改由 ⑫ 段的「怎么用」页签断言接管（见那里）。
   留此一行，免得下一个人以为判据被误删。 */

/* ── 1. 默认场景：回炉 + 裁剪（契约 R2 / R4） ── */
/* ── 0' 折叠边界（2026-10-05 加：轮次/分类改可折叠后，最该被看住的地方）──
 * ★ 为什么这几条重要：折叠最容易犯的错是**把判定一起折进去** ——
 *   那样界面"能跑"，但 R3「判定可区分**且可见**」就名存实亡了
 *   （必须点开才知道结论 = 不可见）。所以这里**故意先全部收起再读**。
 */
console.log('\n── ⓪ 折叠边界：折内容、不折判定 ──')
const fold = await ev(`(async () => {
  const P = window.__kaipuProbe
  await P.collapseAll()
  const run = document.querySelector('[data-kaipu-run]')
  const left = document.querySelector('[data-kaipu-left]')
  const scope = [run, left].filter((el) => el !== null)
  const collapsedText = run === null ? '' : run.innerText      // 故意不展开
  // 只数**面板内**（运行视图 + 左栏）的折叠，不数全页：
  // ★ 宿主自己也有 details（侧边栏分组 / 预览版说明）。数全页的话，
  //   collapseAll 折完它们、宿主随后又按自己的状态展开 ⇒ open 数不为 0
  //   ⇒ 断言红，而运行视图其实全折上了。**判据的范围错了，不是产品错了。**
  // ★ 只数**运行视图**内的折叠：本组断言的关注点是 R2/R3（运行视图里的轮次），
  //   左栏分类不属这里。
  //   ⚠️ 另记（诚实，不猜）：实测 collapseAll 之后，**左栏那两个分类仍呈 open**
  //      （原因**未查明**，疑与宿主/React 在该窗口内重渲染有关）。
  //      所以这里**不**对左栏做批量折叠断言 —— 左栏的折叠能力由下面一条
  //      **单折断言**单独验证（手动折一个、确认真折上了）。
  const openCount = run === null ? 0 : run.querySelectorAll('details[open]').length
  const total = run === null ? 0 : run.querySelectorAll('details').length
  const openOutside = [...document.querySelectorAll('details[open]')]
    .filter((d) => d.closest('[data-kaipu-run]') === null && d.closest('[data-kaipu-left]') === null).length
  // 诊断：收起后**仍有 open** 的是哪些（带上摘要，好定位是哪一块没收）
  const stillOpen = [...document.querySelectorAll('[data-kaipu-run] details[open], [data-kaipu-left] details[open]')]
    .map((d) => { const s = d.querySelector('summary'); return s === null ? '(无摘要)' : s.innerText.replace(/\\s+/g, ' ').slice(0, 26) })
  await P.expandAll()
  const expandedText = run === null ? '' : run.innerText
  return {
    openCount, total, openOutside, stillOpen,
    collapsedLen: collapsedText.length, expandedLen: expandedText.length,
    collapsedHasRound: /第\\s*1\\s*轮/.test(collapsedText),
    collapsedHasVerdict: /✅通过|⚡有条件|❌驳回|⛔拒收|⚪未接入/.test(collapsedText),
    expandedLonger: expandedText.length > collapsedText.length,
  }
})()`)
say(fold.total > 0, `面板内有可折叠块（${fold.total} 个）`)
say(fold.openCount === 0, `全部收起后确实都折上了（面板内 open 数 = 0${fold.stillOpen.length > 0 ? ` · ✗ 未折上的：${JSON.stringify(fold.stillOpen)}` : ''}；页面别处另有 ${fold.openOutside} 个属宿主，不计）`)
say(fold.collapsedHasRound === true, '★ 折起来时「第 N 轮」仍可见（R2 回炉看得见）')
say(fold.collapsedHasVerdict === true, '★★ 折起来时判定仍可见（R3 —— 折内容、不折判定）')
say(fold.expandedLonger === true, `展开后内容更多（${fold.collapsedLen} → ${fold.expandedLen} 字：证明折的是内容，不是没渲染）`)

/**
 * ★★ 左栏折叠能力**单独验证** —— 用**真实点击**（用户交互路径），不是程序化设 open。
 *
 * ★★ 为什么要用 click：实测**程序化** `el.open = false` 之后它会被弹回来
 *   （原因未查明）。程序化赋值**不代表用户路径** ——
 *   真用户是点 summary。这两条路必须分开看，否则会把
 *   "判据的操作方式不对"误判成"产品坏了"。
 *
 * ★★ 2026-10-08（107）**改了取谁**：原来是 `[data-kaipu-left] details`（**第一个** details）。
 *   107 加了三块折叠容器后，**第一个 details 变成了「执行方」块** ⇒ 那条断言会"悄悄换对象"：
 *   它仍在断"左栏有一个 details 能折"，但**不再是分类**，而段名说的是"分类可折"。
 *   ⇒ 改成**显式取分类**（`details[data-kaipu-category]`）—— 让判据的对象与段名一致。
 *   （★ 这是"判据换对象而不自知"的一个实例：它不会红，只会**答非所问**。）
 */
const leftFold = await ev(`(async () => {
  const c = document.querySelector('[data-kaipu-left] details[data-kaipu-category]')
  if (c === null) return { ok: false, why: '左栏没有可折的分类' }
  const s = c.querySelector('summary')
  if (s === null) return { ok: false, why: '分类没有 summary' }
  const before = c.open
  s.click()
  await new Promise(r => setTimeout(r, 400))
  const afterClick = c.open
  s.click()
  await new Promise(r => setTimeout(r, 300))
  return { ok: afterClick !== before, before, afterClick, restored: c.open === before }
})()`)
say(leftFold.ok === true, '左栏分类可折（真实点击路径）：' + JSON.stringify(leftFold))

console.log('\n── ① 场景「开铺审计 · 标准」：两轮 + 裁剪 ──')
// ★ 必须**显式选回**这个场景，不能假定"刚打开就是它"。
//   踩过：探针连跑第二遍时，面板还停在上一次结束时选中的场景，
//   于是这一段读到的是别的场景 ⇒ 7 条断言误报。
//   **判据必须可复跑** —— 不可复跑的判据等于不可信。
const picked1 = await ev(`window.__kaipuProbe.pickScene('开铺审计 · 标准')`)
say(picked1 === true, '选中默认场景')
const t1 = await ev(`window.__kaipuProbe.runText()`)
say(t1.includes('第 1 轮'), 'R2 出现「第 1 轮」分段')
say(t1.includes('第 2 轮'), 'R2 出现「第 2 轮」分段（回炉可见，没有被合并成一条流水）')
say(t1.includes('⚡有条件回炉'), 'R2 第 2 轮的 reason 就是服务端给的「⚡有条件回炉」')
say(t1.includes('本次参与审核面'), 'R4 报告尾部有「本次参与审核面」')
say(t1.includes('未参与审核面'), 'R4 报告尾部有「未参与审核面」')
say(t1.includes('裁剪依据'), 'R4 报告尾部有「裁剪依据」')
// ★ 2026-10-07 随演示数据对齐而改：被裁剪的那一维原名「利益冲突筛查」（自编维度名），
//   现为契约灯名 **仁灯**。★ 这条断言锚的是**数据值**（能锚住是因为它来自受控的演示数据），
//   与"判据不许锚文案"不冲突 —— 那条纪律管的是**界面措辞**（会随产品迭代改），
//   而这里的值由 mock 与契约两侧钉住，改它必然是有意的。
say(t1.includes('仁灯'), 'R4 被裁剪的审核面（仁灯）在报告里可见')
/**
 * ★★★ **反向断言必须落在"目标文本确实在页面上"的那一刻**（2026-10-07 真踩到）。
 *
 * 事由：措辞统一（界面「维度」⇒「审核面」）后，我加了一条"旧措辞必须 0 命中"的反向断言，
 *   但它被放在探针**末尾**（⑭ 段，品牌位后面）。实测把 `skipped` 改回旧值后：
 *     正向那条（`t1.includes('未参与审核面')`）**当场变红** ✓
 *     反向那条**仍然全绿** ✗ —— 它报"命中 0"，而页面上明明写着「未参与维度」。
 *   **原因**：跑到 ⑭ 段时探针早已换过好几个场景，那一刻 R4 那两行**根本不在页面上**
 *     ⇒ 在一个"目标不存在"的时刻去断言"它不存在"，**必然恒绿**。
 *
 * ★★ 这与本仓两条旧教训同族，但更隐蔽：
 *     · 「一跑绿二跑红」—— 那个至少会红一次，逼你看；
 *     · 这条**每次都绿**，而且它还会**掩盖真实回归**
 *       （它绿着，等于告诉你"旧措辞没了"，而实际上只是"这一刻没渲染"）。
 *   ⇒ **判据的位置和判据的内容一样重要。** 断"某文本不在"之前，先确认
 *     "如果它在，这一刻能被读到" —— 否则这条断言与"不会失败的断言"等价。
 *   ⇒ 处置：把它挪到这里（`t1` 刚读、R4 两行确实在），与正向断言**共用同一个自变量**。
 */
const staleCopyInRun = ['本次参与维度', '未参与维度'].filter((s) => String(t1).includes(s))
say(
  staleCopyInRun.length === 0,
  `★★ 反向：运行视图里**不含**旧措辞（已核 2 条旧串，命中 ${staleCopyInRun.length}`
    + `${staleCopyInRun.length === 0 ? '' : `：${staleCopyInRun.join(' / ')}`}）`
    + ' —— 正向只证明"新的来了"，这一条才证明"旧的走了"',
)
say(t1.includes('✅通过'), 'R3 判定「✅通过」可见')
say(t1.includes('⚡有条件'), 'R3 判定「⚡有条件」可见')
say(t1.includes('演示数据'), 'mock 被明示为「演示数据」（不把演示当事实）')
// ★ 禁用词查**整页**：这类词在任何位置出现都不行（引导卡也不能写）
const full1 = await ev(`window.__kaipuProbe.text()`)
say(!full1.includes('已取消'), 'R5 全文**没有**「已取消」（禁用词）')

/*
 * ★★ 隔离自证（2026-10-06 · 古茶 013 B 组；口径随 D-D3 改过一次）。
 *
 * 上面那些 R2/R3/R4 断言读的是**运行视图本体**的文本 —— 新增的概览块已**物理落在**
 * 边界之外（见 ⓪ 段），所以那个选择器**本来就够不着它**，不需要任何减法。
 *
 * ⇒ 但"够不着"这件事**本身也要被证**。否则哪天有人把 ProcessFacts 挪回运行视图里，
 *   R3 会**悄悄变松**（被「轮次走向」那一行喂饱）而判据全绿 —— 那正是本段要守的。
 *   两道：
 *     ① ⓪ 段已正面断"锚点在边界之外"（能失败）；
 *     ② 这里再断"判定的真来源另有其人" —— 它必须出现在
 *        **轮次摘要行**（[data-kaipu-round-verdicts]）里，不是靠新块蒙对。
 *   ★ 并把那块**含判定词的原文**印出来（读数，不是断言）：
 *     它是"为什么必须隔离"的实物 —— 边界一破，这一段就是污染源。
 */
const r3Source = await ev(`(() => {
  const run = document.querySelector('[data-kaipu-run]')
  if (run === null) return null
  const text = run.innerText || ''
  const row = [...run.querySelectorAll('[data-kaipu-round-verdicts]')]
    .map((el) => (el.textContent || '')).join(' | ')
  // ★ 取边界外那块里「轮次走向」那一行的原文。
  //   ⚠️ 本段在**模板字符串内部**：注释与代码里**不得出现反引号**，
  //      也不要写换行转义（会先被外层模板吃掉）—— 用 indexOf 切片，不 split。
  const p = document.querySelector('[data-kaipu-process]')
  let trail = ''
  if (p !== null) {
    const i = (p.innerText || '').indexOf('轮次走向')
    if (i >= 0) trail = (p.innerText || '').slice(i, i + 90)
  }
  return {
    verdictStillThere: /✅通过|⚡有条件|❌驳回|⛔拒收|⚪未接入/.test(text),
    verdictRow: row,
    // ★ 边界内**不该**有概览锚点（与 ⓪ 段同一条，这里是在"读判定面"的语境下再确认一次）
    procAnchorsInRun: run.querySelectorAll('[data-kaipu-process]').length,
    roundTrail: trail,
  }
})()`)
say(
  r3Source !== null && r3Source.procAnchorsInRun === 0,
  `★★ 隔离自证：运行视图内**一个**过程概览锚点都没有（${r3Source?.procAnchorsInRun ?? '?'} 个）⇒ 判定面没被新块掺进来`,
)
say(
  r3Source?.verdictStillThere === true,
  '★★ 隔离自证：判定仍在**运行视图本体**里 ⇒ 隔离没误伤 R3 的真来源',
)
say(
  (r3Source?.verdictRow ?? '').length > 0,
  '★★ 判定确实出自**轮次摘要行**（[data-kaipu-round-verdicts] 非空）—— 不是靠新增块蒙对',
)
// ★ 读数（**不是**断言）：把边界外那行原文印出来。它含判定词 —— 这就是隔离的理由。
console.log(`  · 边界外的「轮次走向」原文：${(r3Source?.roundTrail ?? '').slice(0, 120) || '（未取到）'}`)
/**
 * ★★ R4 的**契约原文**（`contracts/v1.1/sse-events.json`）：
 *   「dims 裁剪后，尾部固定显示『参与维度 / 未参与维度』，**不做成可折叠的次要信息**」
 *
 * ⚠️⚠️ **上面这句是照抄契约，别改**（2026-10-07 加这条提醒）——
 *   界面上那两块现在写的是「本次参与**审核面** / 未参与**审核面**」
 *   （古茶 `010` §一 + 发起人采纳：**内部叫灯次，对外叫审核面**；边界见
 *    `run-reducer.ts` 的 `DIMS_FOOTER` 上方）。
 *   ⇒ 于是**契约措辞与界面措辞不同**，这是**有意**的：
 *     契约是**内部/接口词汇**，界面是**给客户看的词**，两者受众不同。
 *   ⇒ 但看到两个词不一致时**不要**"顺手统一"到任何一边：
 *     改这里的引文 = **错引契约**；改界面 = **越过"对外措辞"的裁定**。
 *     真要让契约也跟着改，得走**契约变更单**（本仓纪律：不单方改契约）。
 *   ★ 这条差异已作为**一处待对账**报给工坊（见 `072`）。
 *
 * ⇒ 它管的是**那两块口径的位置与可见性**，**不是**"整栏一个折叠控件都不能有"。
 *   原来的判据写的是"面板内没有 details" —— 那是**比契约更严**的自我约束，
 *   而它会把一个正当需求（一页预览）挡在门外。
 *
 * ★ 2026-10-05 阿开要"一页预览"，我们给**轮次过程**加了折叠（判定与回炉原因留在外面）
 *   ⇒ 判据**对准契约原文**重写：不再数整栏的 details 个数，
 *     而是**沿那两块口径的祖先链**看它有没有被折进去。
 *   **该处收紧、其余放开** —— "判据不许比契约严，也不许比契约松"。
 */
const r4 = await ev(`(() => {
  const run = document.querySelector('[data-kaipu-run]')
  if (run === null) return null
  const all = [...run.querySelectorAll('*')]
  const hit = all.filter((e) => /本次参与审核面|未参与审核面/.test(e.textContent || '')).pop()
  if (hit === undefined) return { found: false }
  let p = hit
  let inDetails = false
  while (p !== null && p !== run) {
    if (p.tagName === 'DETAILS') { inDetails = true; break }
    p = p.parentElement
  }
  return { found: true, inDetails, detailsInRun: run.querySelectorAll('details').length }
})()`)
say(r4?.found === true, 'R4 尾部那两块口径在运行视图里')
say(
  r4?.inDetails === false,
  `★★ R4 契约原文：那两块口径**不在任何折叠里**（运行视图另有 ${r4?.detailsInRun ?? 0} 个折叠 = 轮次过程，判定与回炉原因已留在外面）`,
)

/* ══ ①.1 换场之后**回到顶部**（2026-10-08 · 104）══════════════════════════════
 *
 * ★★ 它修的是什么（实测发现，不是观感）：
 *   换场**不会**重置主区滚动位置。两个**都长**的场景互切实测 `scrollTop 500 → 500`
 *   ⇒ 用户看到的是**新报告的中段**（既无场景名、也无报告开头）。
 *   ★ 这个缺陷**差一点被漏掉**：换到**短**场景时读数是 892→76、1055→154，
 *     看起来像"自动回顶"，其实是浏览器把超范围的值**夹到新内容上限**。
 *     ⇒ 所以本段的**自证**很关键：必须证明"换之前确实滚下去了"，
 *       否则"换之后是 0"可能只是因为**它本来就没滚下去**（恒绿的典型形态）。
 *
 * ★★ 三条断言分工（少一条就有一种毛病能蒙过去）：
 *   ① **可滚**：这一场本身有可滚空间（没有的话下面两条都是空话）
 *   ② **前置摆好**：滚下去之后 `scrollTop` 确实 > 0（否则"换后 = 0"不能证明任何事）
 *   ③ **换后 = 0**：真的回顶了
 *   ④ ★ 目标场景也要**够长**：否则"换后是 0"可能又只是被夹紧（就是上面那个坑）
 */
console.log('\n── ①.1 换场之后回到顶部（104）──')
const scrollBack = await ev(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const boxOf = (el) => { let p = el === null ? null : el.parentElement
    while (p !== null) { const oy = getComputedStyle(p).overflowY
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p
      p = p.parentElement } return null }
  const rows = () => [...document.querySelectorAll('[data-kaipu-left] button[aria-pressed]')]
  const box = () => boxOf(document.querySelector('[data-kaipu-run]'))

  // ① 选一场**有可滚空间**的：逐个点过去、量它的 maxScroll
  const profiles = []
  for (const r of rows()) {
    const name = r.getAttribute('aria-label')
    r.click()
    await sleep(700)
    const b = box()
    profiles.push({ name: name, max: b === null ? 0 : Math.round(b.scrollHeight - b.clientHeight) })
  }
  const longs = profiles.filter((p) => p.max > 300).sort((a, b) => b.max - a.max)
  if (longs.length < 2) return { profiles: profiles, longs: longs, ok: false, why: '可滚 > 300px 的场景不足两个' }
  const from = rows().find((r) => r.getAttribute('aria-label') === longs[0].name)
  const to = rows().find((r) => r.getAttribute('aria-label') === longs[1].name)
  if (from === undefined || to === undefined) return { profiles: profiles, longs: longs, ok: false, why: '没找到那两个场景行' }

  // ② 到"起点场景"，滚下去（摆前态 —— **不假定进来的前态是干净的**）
  from.click()
  await sleep(800)
  const b1 = box()
  if (b1 === null) return { profiles: profiles, longs: longs, ok: false, why: '起点场景不可滚' }
  b1.scrollTop = 500
  await sleep(300)
  const before = Math.round(b1.scrollTop)

  // ③ 换场 ⇒ 读新的 scrollTop
  to.click()
  await sleep(900)
  const b2 = box()
  const after = b2 === null ? null : Math.round(b2.scrollTop)
  const afterMax = b2 === null ? 0 : Math.round(b2.scrollHeight - b2.clientHeight)

  // 收尾：切回起点场景、回顶（别把状态留给后面几段）
  const back = rows().find((r) => r.getAttribute('aria-label') === longs[0].name)
  if (back !== undefined) { back.click(); await sleep(800) }
  const b3 = box()
  if (b3 !== null) b3.scrollTop = 0
  return {
    profiles: profiles, longs: longs, ok: true,
    from: longs[0].name, to: longs[1].name, toMax: longs[1].max,
    before: before, after: after, afterMax: afterMax,
  }
})()`)
say(
  scrollBack?.ok === true && (scrollBack?.longs?.length ?? 0) >= 2,
  `★ 前置：有两个**都够长**的场景可用来做对照（${(scrollBack?.longs ?? []).map((p) => `${p.name}(${p.max})`).join(' / ') || '（不足）'}）`
    + ' —— 只拿一个长场景测会被"夹紧"掩盖（见本段注释那条教训）',
)
say(
  (scrollBack?.before ?? 0) > 100,
  `★ 前置：换场**之前**确实滚下去了（scrollTop = ${scrollBack?.before ?? '?'}px）—— 否则"换后是 0"证明不了任何事`,
)
say(
  scrollBack?.after === 0,
  `★★ 换场之后主区**回到顶部**（scrollTop = ${scrollBack?.after ?? '?'}）`
    + ` —— 目标场景可滚 ${scrollBack?.toMax ?? '?'}px`
    + `${(scrollBack?.toMax ?? 0) > 300 ? '（够长 ⇒ 0 **不是**被夹紧的结果，是真回顶）' : '（★ 目标场景偏短，这条证据力弱，如实记）'}`,
)

/* ══ ①.2 点开某一轮 ⇒ 落到视野中央；**但"已经看得见"就不许动**（2026-10-08 · 104）════
 *
 * ★★ 这是本轮最需要认真对待的一段：它守的**不只是"会不会居中"**，更是"**该不动时动不动**"。
 *   104 实测反例：同一轮次块，容器 scrollTop=268 时它**只差 13px 就全看见**，
 *   而"一律居中"要跳 **220px** ⇒ 用户点一下、页面猛挪、什么都没多看到。
 *
 * ★★ 四条断言，每条对着一个能单独出事的场景：
 *   ① **有真收益的那一档会滚**：块大段在视野外时，点开 ⇒ 它落到容器中部。
 *   ② ★★ **门控生效**：把块先摆成"几乎全可见"⇒ 点开 ⇒ **一动不动**。
 *      这条是**反例的判据** —— 去掉门控它当场红（那正是"一律居中"的形态）。
 *   ③ ★★ **折叠不滚**：点 summary 折叠 ⇒ 位置不动（折叠是内容变少，滚了只会把人推离）。
 *   ④ ★★ **程序化开合不滚**：直接设 open（探针铺前态的做法、也是产品"挂载时默认展开"的做法）
 *      ⇒ 也**不许**滚 —— 否则"页面自己在动"，而用户没点任何东西。
 *      ★ 这条最容易被漏：`toggle` 事件对**脚本设置**同样派发（且 `isTrusted` 也是 true，
 *        分不出来）⇒ 产品侧必须另有"这一下是不是人点的"判据（见 `RoundBlock.clickedAt`）。
 *
 * ★ 为什么用 `summary.click()` 而不是直接设 open：前者才走**真实用户路径**
 *   （click ⇒ 默认动作改 open ⇒ 派发 toggle），后者正是第 ④ 条要抓的那种。
 */
console.log('\n── ①.2 点开轮次：居中 + 门控（104）──')
/** ★ 超时兜底用（见下方 catch 的说明）：段内挂住时记 null + 原因，后续 say 照常报红 */
let roundCenter = null
let roundCenterErr = null
try {
roundCenter = await ev(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const boxOf = (el) => { let p = el === null ? null : el.parentElement
    while (p !== null) { const oy = getComputedStyle(p).overflowY
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p
      p = p.parentElement } return null }
  const box = boxOf(document.querySelector('[data-kaipu-run]'))
  if (box === null) return { ok: false, why: '主区不可滚' }
  const rounds = () => [...document.querySelectorAll('[data-kaipu-round]')]
  const geo = (el) => { const b = box.getBoundingClientRect(); const r = el.getBoundingClientRect()
    return { top: Math.round(r.top - b.top), h: Math.round(r.height),
      midGap: Math.round(Math.abs((r.top + r.bottom) / 2 - (b.top + b.bottom) / 2)),
      quarter: Math.round(b.height / 4),
      hidden: Math.round(Math.max(0, b.top - r.top) + Math.max(0, r.bottom - b.bottom)) } }
  const reset = async () => { box.scrollTop = 0; await sleep(250)
    rounds().forEach((d) => { if (!d.open) d.open = true }); await sleep(250); box.scrollTop = 0; await sleep(300) }
  const clientH = Math.round(box.clientHeight)
  /**
   * ★★ 「**若不滚，会有多少内容看不见**」—— 本段的**前置量**，必须是它而不是别的。
   *
   * 为什么不能用"展开**之后**量到的视野外"：滚动与展开是**同一瞬间**发生的
   *   ⇒ 展开后再量，读到的已经是"滚完的结果"（= 0），**恒为 0** ⇒ 前置断言恒假/恒真。
   *   （★ 我第一版就是这么写的，第一跑就红在"0px 在视野外"上 —— 判据自己把自己抓出来了。）
   *
   * 为什么它才是对的口径：门控用的就是**展开后那一刻**的几何（见 onToggle 里读的两条边）；
   *   ⇒ 用"折叠态的块顶 + 展开后的块高 − 容器高"推算，
   *     等价于问"**假如这一下不滚，用户会漏看多少**" —— 这正是"该不该滚"的判据。
   */
  const wouldHide = (foldedTop, expandedH) => Math.max(0, Math.round(foldedTop + expandedH - clientH))

  const out = {}

  // ① 有真收益那一档：从顶部开始（第 1 轮大段在视野外）先折叠、再点开
  await reset()
  const r1 = rounds()[0]
  const s1 = r1.querySelector('summary')
  s1.click(); await sleep(400)
  const foldedScroll = Math.round(box.scrollTop)
  const foldedGeo = geo(r1)                 // ★ 折叠态（= 展开前那一刻）的几何
  s1.click(); await sleep(900)
  const afterGeo = geo(r1)
  out.centerCase = { foldedGeo: foldedGeo, foldedScroll: foldedScroll, after: afterGeo,
    wouldHide: wouldHide(foldedGeo.top, afterGeo.h),
    clientH: clientH,
    scroll: Math.round(box.scrollTop),
    max: Math.round(box.scrollHeight - box.clientHeight),
    hitTop: Math.round(box.scrollTop) >= Math.round(box.scrollHeight - box.clientHeight) - 1,
    elMid: Math.round((r1.getBoundingClientRect().top + r1.getBoundingClientRect().bottom) / 2),
    boxMid: Math.round((box.getBoundingClientRect().top + box.getBoundingClientRect().bottom) / 2) }

  // ② 门控：把块摆成"几乎全可见"，再点开 ⇒ 必须一动不动
  await reset()
  const r2 = rounds()[0]
  const s2 = r2.querySelector('summary')
  const wantTop = Math.max(0, Math.round(box.scrollTop + r2.getBoundingClientRect().top - box.getBoundingClientRect().top - (clientH - r2.offsetHeight) / 2))
  box.scrollTop = Math.max(0, wantTop - 40)
  await sleep(400)
  s2.click(); await sleep(400)
  const gateBefore = Math.round(box.scrollTop)
  const gateGeo = geo(r2)
  const gateFoldedTop = gateGeo.top
  s2.click(); await sleep(900)
  const gateAfter = geo(r2)
  out.gateCase = { before: gateGeo, scrollBefore: gateBefore, scrollAfter: Math.round(box.scrollTop),
    after: gateAfter, wouldHide: wouldHide(gateFoldedTop, gateAfter.h) }

  // ③ 折叠不滚
  await reset()
  const r3 = rounds()[0]
  const s3 = r3.querySelector('summary')
  box.scrollTop = 300
  await sleep(300)
  const foldBefore = Math.round(box.scrollTop)
  s3.click(); await sleep(800)
  out.foldCase = { open: r3.open, scrollBefore: foldBefore, scrollAfter: Math.round(box.scrollTop) }

  // ④ 程序化开合不滚
  await reset()
  const r4 = rounds()[0]
  box.scrollTop = 0
  await sleep(300)
  const progBefore = Math.round(box.scrollTop)
  r4.open = false; await sleep(450)
  r4.open = true; await sleep(900)
  out.progCase = { scrollBefore: progBefore, scrollAfter: Math.round(box.scrollTop), open: r4.open }

  await reset()
  out.ok = true
  return out
})()`)
} catch (err) {
  /**
   * ★★ ①.2 段**实测会挂住**（2026-10-17）：表达式里的 async 不返回 ⇒ 20s 后由 `ev` 抛超时。
   * ⇒ 这里**捕获并如实记为"未验证"**，让探针能继续跑后面的段 ——
   *   否则整轮被一段拖死，后面 ⑥/⑬/⒂ 那些段**永远拿不到结果**（正是本轮踩到的坑）。
   *
   * ★ 这不是"让判据变宽松"：下面每一条 say 都会因为 `roundCenter === null` 而**报红**，
   *   并明确写"未验证（超时）"。**红就是红，只是不再让整轮静默挂死。**
   */
  roundCenterErr = String(err?.message ?? err)
}
say(roundCenter?.ok === true, `（前置）主区可滚、轮次在位${roundCenter?.ok === true ? '' : ` —— ${roundCenter?.why ?? (roundCenterErr !== null ? `★ 段内挂住：${roundCenterErr.slice(0, 120)}` : '?')}`}`)
const cc = roundCenter?.centerCase
say(
  cc !== undefined && cc.wouldHide > 100,
  `★ 前置：这一档"**若不滚会漏看 ${cc?.wouldHide ?? '?'}px**"（折叠态块顶 ${cc?.foldedGeo?.top ?? '?'} + 展开后高 ${cc?.after?.h ?? '?'} − 容器高 ${cc?.clientH ?? '?'}）`
    + ' —— ★ 必须用它、不能用"展开后量到的视野外"：滚动与展开同一瞬间发生，展开后读到的是**滚完的结果**（恒 0）',
)
say(
  cc !== undefined && cc.after.hidden === 0,
  `★★ 点开 ⇒ 视野外 **${cc?.after?.hidden ?? '?'}px**（展开出来的内容**看得见**了）`,
)
say(
  cc !== undefined && (cc.hitTop === true || cc.after.midGap <= cc.after.quarter),
  `★★ 落点到位（中心差 ${cc?.after?.midGap ?? '?'}px ≤ 容器四分之一高 ${cc?.after?.quarter ?? '?'}px`
    + `${cc?.hitTop === true ? '；★ 已到滚动上限，走"尽可能居中"那一路（本轮块比容器矮，实测可达中部）' : ''}）`,
)
say(
  cc !== undefined && cc.scroll > cc.foldedScroll,
  `★ 滚动**真的发生了**（折叠时 ${cc?.foldedScroll ?? '?'} → 点开后 ${cc?.scroll ?? '?'}px）—— 不是"发起了就算到了"`,
)
const gc = roundCenter?.gateCase
say(
  gc !== undefined && gc.wouldHide <= 24,
  `★ 前置：构造"几乎全可见"的一档（**若不滚只会漏看 ${gc?.wouldHide ?? '?'}px** ≤ 门控阈值 24px）`
    + ' —— ★ 同用"若不滚会漏看多少"，与产品门控同一口径（它在 `onToggle` 里读的正是展开后那一刻的几何）',
)
say(
  gc !== undefined && gc.scrollBefore === gc.scrollAfter,
  `★★ **门控生效**：这一档点开后**一动不动**（scrollTop ${gc?.scrollBefore ?? '?'} → ${gc?.scrollAfter ?? '?'}）`
    + ' —— 去掉门控它当场红（那正是"一律居中"的形态：只差十几像素却要跳两百多）',
)
const fc = roundCenter?.foldCase
say(
  fc !== undefined && fc.open === false && fc.scrollBefore === fc.scrollAfter,
  `★★ **折叠不滚**：点一下折起来，位置不动（${fc?.scrollBefore ?? '?'} → ${fc?.scrollAfter ?? '?'}）`
    + ' —— 折叠是内容变少，滚了只会把用户推离他正在读的位置',
)
const pc = roundCenter?.progCase
say(
  pc !== undefined && pc.scrollBefore === pc.scrollAfter,
  `★★ **程序化开合不滚**：直接设 open（挂载补齐 / 探针铺前态的做法）⇒ 位置不动（${pc?.scrollBefore ?? '?'} → ${pc?.scrollAfter ?? '?'}）`
    + ' —— 否则"页面自己在动"，而用户没点任何东西；★ 这条最难，因为 toggle 对脚本设置同样派发',
)

/* ── 2. 零接入场景（A-3） ── */
console.log('\n── ② 场景「复核演练 · 全场未接入」：A-3 待接入 ──')
const picked2 = await ev(`window.__kaipuProbe.pickScene('复核演练 · 全场未接入')`)
say(picked2 === true, '选中该场景')
const t2 = await ev(`window.__kaipuProbe.runText()`)
say(t2.includes('待接入'), '显示「待接入」')
say(t2.includes('全部待接入执行方'), '给出"全部待接入"的明确说明（不是沉默的空态）')
/* ★ 2026-10-08 夜话改版：「这不是故障…」由**铺在页面上的辩解**收进「?」悬停。
   ⇒ 判据跟着改：不再断它在可见文本里（那是**旧形态**），改为断它在**运行视图内某个
   元素的 `title`（hover）里仍解释得到** —— 这样"空场是正常状态"这句没被删掉，只是换了地方，
   且这条断言**仍能失败**（把「?」删了 / 把解释删了，它当场变红）。 */
const t2tip = await ev(`(() => {
  const run = document.querySelector('[data-kaipu-run]')
  if (run === null) return ''
  return [...run.querySelectorAll('[title]')].map((e) => e.getAttribute('title') || '').join(' ｜ ')
})()`)
say(t2tip.includes('这不是故障'), '说明"这不是故障"（收进「?」悬停，A-3：空场是正常状态）')

/* ── 3. ⛔拒收 + 不收费 ── */
console.log('\n── ③ 场景「资料预检」：⛔拒收 ──')
await ev(`window.__kaipuProbe.pickScene('资料预检')`)
const t3 = await ev(`window.__kaipuProbe.runText()`)
say(t3.includes('⛔拒收'), 'R3 判定「⛔拒收」可见')
say(t3.includes('credits 0'), '「拒收不收费」可见（usage credits = 0）')

/* ── 4. ❌驳回 ── */
console.log('\n── ④ 场景「预约核验 · 需外部预约」：❌驳回 ──')
await ev(`window.__kaipuProbe.pickScene('预约核验 · 需外部预约')`)
const t4 = await ev(`window.__kaipuProbe.runText()`)
say(t4.includes('❌驳回'), 'R3 判定「❌驳回」可见')
say(t4.includes('aborted'), '中止原因（finishReason = aborted）可见')

/* ── 5. 断开 ⇒ 「已停止接收」（R5） ── */
console.log('\n── ⑤ 场景「开铺审计 · 进行中」：断开措辞 ──')
await ev(`window.__kaipuProbe.pickScene('开铺审计 · 进行中')`)
const t5a = await ev(`window.__kaipuProbe.runText()`)
say(t5a.includes('运行中'), '初始状态为「运行中」')
const clicked = await ev(`window.__kaipuProbe.clickStop()`)
say(clicked === true, '点到「停止接收」按钮')
const t5b = await ev(`window.__kaipuProbe.runText()`)
say(t5b.includes('已停止接收'), 'R5 断开后显示「已停止接收」')
say(t5b.includes('服务端仍在算完'), 'R5 附带说明"服务端仍在算完并落 lamp_runs"')
const full5 = await ev(`window.__kaipuProbe.text()`)
say(!full5.includes('已取消'), 'R5 全文**没有**「已取消」（这是契约明文禁止的措辞）')

/* ── 6. 窄容器：左栏折叠 + 窄屏的选场景入口（003 容器宽度纪律 · 098 做实） ── */
console.log('\n── ⑥ 窄容器：左栏折叠 + 窄屏「选场景」入口 ──')
/*
 * ★★ 2026-10-08（098）：本段**做实**了 —— 在此之前它名不副实。
 *
 *   改前它只断了一句「宽布局下左栏存在（aside × N）」。
 *   那是**宽屏**的读数，而段名写的是「窄容器：左栏折叠」。
 *   一条名字比事实大的判据 = **夸大的判据**（与"不会失败的断言"同族）：
 *   真正该守的东西（**窄屏下还能不能挑场景**）从来没人断过 ——
 *   097 评估是靠**手工实测**才发现那个缺口的，判据根本没覆盖到。
 *   ⇒ 判据不覆盖的地方，"看起来全绿"是假象。
 *
 * ★★ 为什么必须**两个方向各断一次**（否则这条是假绿）：
 *   · 只断"窄屏下左栏不在" ⇒ 把左栏整个删掉也全绿；
 *   · 只断"宽屏下左栏在"   ⇒ 窄屏挤爆成一条缝也全绿。
 *   ⇒ 先宽、再窄、最后切回宽，三次读数合起来才叫"断点在看容器宽度"。
 *
 * ★ 视口怎么压：`Emulation.setDeviceMetricsOverride`（开头设的 1440×900，
 *   这里临时改 600×900）。★ 段末**必须还原** —— 否则后面每一段都在窄屏下跑，
 *   它们会以"左栏找不到""aside 数不对"之类的方式集体变红，而**看着像产品坏了**。
 *   ★ 换算依据（097 实测）：视口 600 ⇒ 面板宽 544 ⇒ 稳低于 640 断点。
 */

// ① 宽屏前置（此刻视口还是 1440）
const wideLayout = await ev(`(() => ({
  left: document.querySelector('[data-kaipu-left]') !== null,
  toggle: document.querySelector('[data-kaipu-left-toggle]') !== null,
  picker: document.querySelector('[data-kaipu-scene-picker]') !== null,
}))()`)
say(wideLayout.left === true && wideLayout.toggle === true, '宽屏：左栏与分隔线上的把手都在')
say(
  wideLayout.picker === false,
  '★★ 反向：宽屏**没有**那条窄屏「场景」折叠条（有的话就是两处入口说同一件事，让人自己判断它们是不是一回事）',
)

// ② 压到 600，等 ResizeObserver 落地
await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 900, deviceScaleFactor: 1, mobile: false })
await ev(`new Promise((r) => setTimeout(r, 900))`)
const narrowLayout = await ev(`(() => {
  const p = document.querySelector('[data-kaipu-scene-picker]')
  const cur = p === null ? null : p.querySelector('[data-kaipu-scene-current]')
  return {
    panelW: Math.round(document.querySelector('[data-kaipu-tabs]').getBoundingClientRect().width),
    left: document.querySelector('[data-kaipu-left]') !== null,
    toggle: document.querySelector('[data-kaipu-left-toggle]') !== null,
    picker: p !== null,
    pickerOpen: p !== null && p.open === true,
    pickerCurrent: cur === null ? null : (cur.innerText || '').trim(),
  }
})()`)
say(narrowLayout.left === false, `★★ 窄屏（视口 600 ⇒ 面板 ${narrowLayout.panelW}px）：左栏**不渲染**（断点看容器宽度，不看窗口）`)
say(narrowLayout.toggle === false, '★ 窄屏下把手也不渲染 —— 给了它就是一个按不动的按钮（假承诺）')

// ③ 缺口的修补本身：窄屏**有**选场景的入口
say(narrowLayout.picker === true, '★★★ 窄屏有「场景」入口（[data-kaipu-scene-picker]）—— 097 实测那个"没有任何入口"的缺口已补')
say(
  typeof narrowLayout.pickerCurrent === 'string' && narrowLayout.pickerCurrent.length > 0 && narrowLayout.pickerCurrent !== '（未选）',
  `★ 收起态就写着**当前是哪一场**（「${narrowLayout.pickerCurrent}」）—— 不看也知道自己站在哪儿`,
)
say(narrowLayout.pickerOpen === false, '★ 默认**收起**（窄屏本来就矮，常驻展开会把运行视图挤下去）')

/* ★ 窄屏侧的同一条"恰好一处"（宽屏侧那条在 ⑥' 段收尾）—— 与古茶 §一 那条要求同源 */
const curNarrow = await ev(`(() => {
  const all = [...document.querySelectorAll('[data-kaipu-scene-current]')]
  return {
    total: all.length,
    inPicker: all.filter((e) => e.closest('[data-kaipu-scene-picker]') !== null).length,
    inLeft: all.filter((e) => e.closest('[data-kaipu-left]') !== null).length,
  }
})()`)
say(
  curNarrow?.total === 1 && curNarrow?.inPicker === 1 && curNarrow?.inLeft === 0,
  `★★ 窄屏：当前是哪一场**恰好一处，且在折叠条里**（总数 ${curNarrow?.total ?? '?'} / 折叠条 ${curNarrow?.inPicker ?? '?'} / 左栏 ${curNarrow?.inLeft ?? '?'}）`
    + ' —— 0 = 选完就消失，2 = 同一句话说两遍，两种都排掉',
)

// ④ 展开 ⇒ 场景真的可点，点了真的换场（右栏跟着变）、**顺手自动收起**，且切得回来
const byPicker = await ev(`(async () => {
  const p = document.querySelector('[data-kaipu-scene-picker]')
  if (p === null) return null
  const s = p.querySelector('summary')
  if (s === null) return null
  s.click()
  await new Promise((r) => setTimeout(r, 450))
  const bodyNow = () => document.querySelector('[data-kaipu-scene-picker-body]')
  const rowsNow = () => [...(bodyNow() === null ? [] : bodyNow().querySelectorAll('button[aria-pressed]'))]
  const body = bodyNow()
  const bodyText = body === null ? '' : body.innerText
  // ★ 顺序：古茶拍板要求窄屏把「场景」**提到最前**（这个框的本职就是选场景）
  const sectOf = (name) => (body === null ? null : body.querySelector('[data-kaipu-sect="' + name + '"]'))
  const sc = sectOf('场景')
  const ag = sectOf('执行方')
  const sceneFirst = sc !== null && ag !== null && (sc.compareDocumentPosition(ag) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  const rows = rowsNow()
  const activeLabel = rows.find((b) => b.getAttribute('aria-pressed') === 'true')?.getAttribute('aria-label') || null
  const head = () => (document.querySelector('[data-kaipu-run]')?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40)
  const beforeHead = head()
  const other = rows.find((b) => b.getAttribute('aria-pressed') !== 'true')
  if (other === undefined) {
    return { opened: p.open, rowCount: rows.length, bodyText, activeLabel, otherLabel: null, sceneFirst: sceneFirst }
  }
  const otherLabel = other.getAttribute('aria-label')
  other.click()
  await new Promise((r) => setTimeout(r, 600))
  const afterHead = head()
  const switched = afterHead !== beforeHead && afterHead.length > 0
  // ★★ 选完**自动收起**（古茶拍板 §一）：这一条要在"点完之后"读，且**读的是 details 的 open**
  const foldedAfterPick = p.open === false
  // ★ 收起态仍要写着当前是哪一场（不能选完就消失）
  const curAfterPick = (p.querySelector('[data-kaipu-scene-current]')?.innerText || '').trim()
  // ★ 切回原来那一场：后面还有页签/铺子/品牌几段，别把状态留给它们
  //   （此刻折叠条是收起的，但按钮仍在 DOM 里 ⇒ 点得到；这正是"收起 ≠ 卸载"的用法确认）
  const backBtn = rowsNow().find((b) => b.getAttribute('aria-label') === activeLabel)
  if (backBtn !== undefined) { backBtn.click(); await new Promise((r) => setTimeout(r, 500)) }
  return {
    opened: p.open, rowCount: rows.length, bodyText, activeLabel, otherLabel, switched,
    sceneFirst: sceneFirst, foldedAfterPick: foldedAfterPick, curAfterPick: curAfterPick,
  }
})()`)
say(byPicker !== null && byPicker.opened === false, '★ 折叠条可展开、点完自动收回（原生 details，键盘也能开）')
say(
  byPicker !== null && byPicker.rowCount >= 2,
  `★ 展开后场景**可点**（按钮 × ${byPicker?.rowCount ?? 0}）`,
)
say(
  byPicker?.sceneFirst === true,
  '★★ 窄屏「场景」**提到最前**（在「执行方」之前）—— 这个框的本职就是选场景，'
    + '而实测框高 320 / 场景列表起点 341px，不前置得先滚过执行方与推荐位（100 §六）',
)
say(
  byPicker?.switched === true,
  `★ 从窄屏入口换一场 ⇒ 运行视图**真的跟着变**（${byPicker?.activeLabel ?? '?'} → ${byPicker?.otherLabel ?? '?'}）；已切回原场`,
)
say(
  byPicker?.foldedAfterPick === true,
  '★★ 选完一场**自动收起**（古茶拍板 §一）—— 选场景是它唯一的本职，选完就把屏幕还给运行视图',
)
say(
  typeof byPicker?.curAfterPick === 'string' && byPicker.curAfterPick.length > 0 && byPicker.curAfterPick !== '（未选）',
  `★★ 收起之后**当前是哪一场仍在**（实读「${byPicker?.curAfterPick ?? '?'}」）—— 不能选完就消失`,
)
// ★★ 防"窄屏版慢慢长歪"：两份必须是同一份内容（复用 LeftPane，不养第二套 UI）
say(
  typeof byPicker?.bodyText === 'string'
    && byPicker.bodyText.includes('执行方')
    && byPicker.bodyText.includes('该怎么选')
    && byPicker.bodyText.includes('场景'),
  '★★ 窄屏那份内容**没有缩水**：执行方 / 该怎么选 / 场景 三段都在（同一组件两处渲染，不是第二套 UI）',
)

// ⑤ 还原宽视口 —— 后面每一段都依赖它
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await ev(`new Promise((r) => setTimeout(r, 900))`)
const backWide = await ev(`(() => ({
  left: document.querySelector('[data-kaipu-left]') !== null,
  toggle: document.querySelector('[data-kaipu-left-toggle]') !== null,
  picker: document.querySelector('[data-kaipu-scene-picker]') !== null,
}))()`)
say(
  backWide.left === true && backWide.toggle === true && backWide.picker === false,
  '★ 视口还原 ⇒ 左栏与把手回来、折叠条消失（可逆，不是单向开关）',
)

/* ★★ ⑥' 「当前是哪一场」在**两种宽度下都可见，且恰好一处**（2026-10-08 · 古茶拍板 §一）
 *
 * 古茶那条要求的原文：「选完自动收起之后，当前选中项要留在折叠条上可见。不能选完就消失。
 *   ……她其实已经在窄屏顶部折叠条里做了，确保**宽屏也一致**就行。」
 *
 * ★★ 判据为什么这么写（三条合起来才叫"一致"，少一条都是假的）：
 *   ① 窄屏 ⇒ 在折叠条里读得到；
 *   ② 宽屏 ⇒ 在左栏里读得到；
 *   ③ ★★ **任何宽度下恰好一个** —— 这条是最要紧的：只断①②的话，
 *      "两处都渲染"（同一句话在一屏出现两遍）与"都没渲染"（选完就消失）
 *      **两种毛病都照样全绿**。恰好一个才同时排掉这两种。
 *   ★ 顺带说明：这两处**共用同一个锚点**是对的（它们永远不会同时在页面上），
 *     与 `data-kaipu-left` / `data-kaipu-scene-picker-body` 必须分开的理由不同 ——
 *     判据是"**同时存在与否**"，不是"名字像不像"。
 */
const curWide = await ev(`(() => {
  const all = [...document.querySelectorAll('[data-kaipu-scene-current]')]
  const inLeft = all.filter((e) => e.closest('[data-kaipu-left]') !== null)
  return {
    total: all.length,
    inLeft: inLeft.length,
    text: (inLeft[0]?.innerText || '').trim(),
  }
})()`)
say(curWide?.total === 1, `★★ 宽屏：当前是哪一场**恰好一处**（实读 ${curWide?.total ?? '?'} 处 —— 0 = 选完就消失，2 = 同一句话说两遍）`)
say(
  curWide?.inLeft === 1 && typeof curWide.text === 'string' && curWide.text.length > 0 && curWide.text !== '（未选）',
  `★★ 宽屏也在左栏显示**当前是哪一场**（实读「${curWide?.text ?? '?'}」）—— 与窄屏折叠条**同一个件、同一个锚点**`,
)

/* ── 7. 契约变更 #17：场景按场合分组 + 推荐（本轮新消费） ── */
console.log('\n── ⑦ 契约 #17：按场合分组 + 推荐 + 未归类不藏 ──')
// ★ 用 `leftText()`（内部**先展开** `<details>`）——
//   否则分类是折着的，读不到场景名，会假失败。判据断的是"内容在不在"，不是"折没折"。
const left = await ev(`window.__kaipuProbe.leftText()`)
const fullAll = await ev(`window.__kaipuProbe.text()`)
say(typeof left === 'string' && left.length > 0, '左栏文本可独立取到（判据边界：分类断言只看左栏）')
say(left.includes('日常自查'), '#17 按分类分组：出现「日常自查」')
say(left.includes('标准审查'), '#17 出现「标准审查」')
say(left.includes('想有人先帮我看一眼'), '#17 分类带「客户视角一句话」（intent），不是只给术语')
say(left.includes('未归类'), '★ #17「未归类不藏」：出现「未归类」组')
say(left.includes('开铺审计 · 进行中'), '★ 未归类的那个场景**真的列在里面**（不是空标题）')
say(
  !left.includes('内容创作') && !left.includes('技术开发') && !left.includes('项目评估'),
  '★ #17「空分类不出」：响应里没有的分类，界面**绝不自己造**',
)
say(left.includes('该怎么选'), '#17 有推荐区')
say(/适合[:：]/.test(left), '★ 推荐用「适合：…」口径（「对什么场合」），不是「热门/高频」')
// ★★ 禁用词：星月 012 §4.1 点名 —— 「热门/多数人」需要统计依据，现在没有，写了就是编
say(
  !/热门|多数人|大家都在用|最多人选/.test(fullAll),
  '★★ 禁用词判据：界面全文不含「热门 / 多数人 / 大家都在用」（无统计依据 ⇒ 写了就是编）',
)
const catNodes = await ev(`document.querySelectorAll('[data-kaipu-category]').length`)
say(catNodes >= 3, `#17 分组结构落成 DOM 标记（data-kaipu-category × ${catNodes}）`)

/* ── 8. 总台卡片（执行方）：★ 瘦身**不许变成删内容** ── */
/*
 * 这一段是 2026-10-05「降低信息密度」改造的**回门判据**。
 *
 * 为什么单独立一段：那次改造把执行方的**一句话说明收进了 `title`** ——
 * 而 `title` **不在 `innerText` 里** ⇒ 本项目所有读文本的断言**都看不见它**。
 * 于是"瘦身成功"和"内容被删"在既有判据下**长得一模一样**。
 * ⇒ 必须专门断一次：**收起来的东西原文还在**。
 *   （同一条纪律：一个不会失败的断言等于没有。）
 */
console.log('\n── ⑧ 总台卡片（执行方）：瘦身 vs 删内容 ──')
/**
 * ★★ 2026-10-08（107）：**量之前必须先把「执行方」块展开**。
 *
 * 为什么（这是一条**判据自身会退化**的坑）：
 *   107 把「执行方」改成**默认收起**。而块收起时，里面每张卡片的
 *   `getBoundingClientRect().height` **都是 0** ⇒ 下面那条
 *   `maxH <= 44` 会**恒真**（0 当然 ≤ 44）。
 *   ⇒ 断言不再守"卡片是否瘦身"，而变成"**这里没有卡片**"——它绿着，却什么都没验
 *     （本仓老账："一个不会失败的断言等于没有"）。
 *   ⇒ 处置：**显式展开 + 断言展开成功**（先证明"量得到"，再量）。
 */
const expandedForCards = await ev(`(async () => {
  const left = document.querySelector('[data-kaipu-left]')
  if (left === null) return null
  left.querySelectorAll('details').forEach((d) => { d.open = true })
  await new Promise((r) => setTimeout(r, 450))
  const blk = left.querySelector('[data-kaipu-block="agents"]')
  const cards = [...left.querySelectorAll('[data-kaipu-agent]')]
  return {
    agentsOpen: blk === null ? null : blk.open,
    cardCount: cards.length,
    maxCardH: cards.length === 0 ? 0 : Math.max(...cards.map((c) => Math.round(c.getBoundingClientRect().height))),
  }
})()`)
say(
  expandedForCards?.agentsOpen === true && (expandedForCards?.maxCardH ?? 0) > 0,
  `★ 前置：卡片量得到（「执行方」块已展开，最高卡片 ${expandedForCards?.maxCardH ?? '?'}px > 0）`
    + ' —— ★ 必须显式做这一步：107 起该块默认收起，而"收起时卡片高 0"会让下面那条 `maxH <= 52` **恒真**（判据退化）',
)

const agents = await ev(`(() => {
  return [...document.querySelectorAll('[data-kaipu-agent]')].map((el) => ({
    id: el.getAttribute('data-kaipu-agent'),
    h: Math.round(el.getBoundingClientRect().height),
    tip: el.getAttribute('title') || '',
    aria: el.getAttribute('aria-label') || '',
    text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
  }))
})()`)
say(Array.isArray(agents) && agents.length > 0, `执行方卡片在场（${agents?.length ?? 0} 张）`)

if (Array.isArray(agents) && agents.length > 0) {
  /**
   * ★★★ 判据**换口径**（2026-10-17 · 发起人要求执行方内容换行）。
   *
   * ── 为什么必须换，而不是调阈值 ──────────────────────────────────
   *   原判据：`maxH <= 44` —— 守的是 107 方案 D 的"**瘦身成一行**"
   *     （改前 62~83px 两行文字，压到一行把高度让给场景）。
   *   现在发起人明确要求「背后的内容全部换行，更整体好看」⇒ 两行分层排版
   *     ⇒ 卡片**必然** 49px ⇒ 原阈值 44 与**新需求直接冲突**。
   *   ★ 这不是"判据错了"，是**产品意图变了**：愿意用一点高度换整齐。
   *     所以判据要跟着需求走 —— 但**不能只是把 44 改成 52**：
   *     那叫放宽（谁都能往上堆内容），不叫换口径。
   *
   * ── 现在守什么（两条，各守一件不同的事）──────────────────────
   *   ① **不许更胖**：`maxH <= 68` —— 卡片形态的上限（2026-10-18 再换口径）。
   *   ② ★★ **必须一样高**：`maxH === minH` —— 这才是"整齐"的**真判据**。
   *      原判据只能证明"都不高"，证明不了"看着齐"；
   *      而发起人这次的原话是「更整体好看」= 齐。
   *      ⇒ 只要有一张卡片因为名字太长折成第三行，这条当场变红。
   *      ★ 这条比原来的强：原来对"高矮不一"完全无感（只要都 ≤44 就绿）。
   *
   * ★ 前置（上面那条 say）仍在守"卡片量得到"：收起时 h=0 会让 ① 恒真，
   *   所以必须先证明块是展开的 —— 那个退化陷阱没变。
   */
  const maxH = Math.max(...agents.map((a) => a.h))
  const minH = Math.min(...agents.map((a) => a.h))
  /**
   * ★★ 2026-10-18 第二次换口径：**行 → 卡片**（发起人点名「像财税专家那样的卡片式」）。
   *   卡片 = 圆角边框 + 内边距(8×2) + 头行(logo 22px) + 角色行 —— 实测 60px。
   *   52 是"裸行"的上限，对带框卡片必然红；上限随形态走，但**只换口径不放宽**：
   *   68 = 60px 实测 + 半行余量（防"边框卡片"变成"随便堆内容的胖卡"）。
   *   真正守"整齐"的仍是下面那条 `maxH === minH`。
   */
  say(maxH <= 68, `★ 每张卡片不胖过形态上限（最高 ${maxH}px ≤ 68 —— 卡片=边框+头行+角色行的上限）`)
  say(
    maxH === minH,
    `★★ 每张卡片**一样高**（${minH}px === ${maxH}px）—— 这才是"整齐"；有一张折成三行就会红`,
  )

  // ② ★★ 内容没丢：那句话的**原文**在悬停说明里（这条才是本段的重点）
  const withTip = agents.filter((a) => a.tip.length > 0)
  say(withTip.length === agents.length, `★ 每张卡片都有悬停说明（${withTip.length}/${agents.length}）`)
  /*
   * ★ 这里原来断的是"说明以句号收尾（完整句子）"——**2026-10-05 换成下面那条**。
   *   为什么换：契约 v1.3 §23.4 之后多了 `pending` 占位条目，它**本来就没有描述句**
   *   （实测 `/agents` 回 `capabilities: []`、无 `skillSummary`）⇒ 旧断言会**误伤一个合法形态**。
   *   而这里真正要防的风险其实更具体：**字段缺失时把 `undefined` 印到屏幕上**
   *   （占位条目不带 `version` / `skillSummary` —— 实测差一点就出现 `vundefined`）。
   */
  say(
    withTip.every((a) => !/undefined|NaN|\[object/.test(a.tip)),
    '★ 悬停说明里**没有 undefined / NaN / [object…]**（字段缺失时不露馅）',
  )
  say(
    withTip.every((a) => a.tip.trim().length >= 2),
    '★ 悬停说明不是空白（至少说了点什么）',
  )
  // ★★ 两条"能失败"的硬判据（2026-10-05 补）——
  //   上面那条"完整句子"其实**偏弱**：它只证明"第一行以句号收尾"，
  //   而"把说明也留在外面、只把 tip 当摆设"同样能通过。
  //   ⇒ 这里正面断**两头**：里面**多给了**、外面**确实没有**。
  say(
    withTip.every((a) => a.tip.length > a.text.length),
    '★ 悬停说明**比卡片上显示的更多**（真的多给了东西，不是把可见文本复制一份）',
  )
  const maxVisible = Math.max(...agents.map((a) => a.text.length))
  say(
    maxVisible <= 30,
    `★ 卡片可见文本很短（最长 ${maxVisible} 字符）⇒ 说明**确实从外面收走了**，不是两处各放一份`,
  )
  // ③ 判断依据**不许收**：role 必须留在外面；停用状态必须看得见
  /*
   * ★★ 2026-10-07 显式改写（原写法是 `/执行|审计|管理|综合维度/`）。它有两处不对：
   *   ① **值域错了**：契约 v1.4 §3.1 里 `role` 的值是**灯名**（`"role": "匠灯"`）——
   *      「执行 / 审计」是我方早期自编的角色词，演示数据对齐后卡片上已不再出现它们。
   *      ⇒ 旧正则**全不匹配** ⇒ 这条红。红得对：它锚的是**我方旧自编值的枚举**。
   *   ② 就算值域对，它也是**枚举式**：灯名换一盏、多一盏就漏（本仓老账）。
   *   ⇒ 改为**形态式**，且白名单**复用 ⓪.2 从契约正本抽到的那一份**（不是我方常量）：
   *      卡片可见文本里必须出现**白名单里的灯名**。
   *   ★ 待接入条目单列放行：它的 `role` 是 `综合维度` ——
   *     那是契约 v1.4 §22.1 明写的真值（light-review 单灯场景的真实名），**不是灯名**。
   */
  say(
    agents.every((a) => [...LAMP_WHITELIST].some((lamp) => a.text.includes(lamp))
      || a.text.includes('综合维度')),
    '★ 角色（灯名）仍留在卡片外面 —— 判断依据不许收进提示',
  )
  const offCards = agents.filter((a) => a.text.includes('已停用'))
  say(offCards.length >= 1, `★ 停用的执行方仍显示「已停用」（${offCards.length} 张）—— 瘦身不许动这一条`)
}

// ③ 请求号：缩略显示，但**全值没丢**（挂悬停）
const rid = await ev(`(() => {
  const el = document.querySelector('[data-kaipu-request-id]')
  return el === null ? null : { shown: (el.innerText || '').trim(), full: el.getAttribute('title') || '' }
})()`)
if (rid !== null) {
  say(rid.full.length >= rid.shown.length, `请求号：全值挂在悬停上（显示 ${rid.shown.length} 字符 / 全值 ${rid.full.length} 字符）`)
}

// ④ 层次真的拉开了：**靠色阶**，不是靠字号 ⇒ 同一行内至少有 2 种不同颜色
const tiers = await ev(`(() => {
  const el = document.querySelector('[data-kaipu-agent]')
  if (el === null) return null
  const spans = [...el.querySelectorAll('span')].filter((s) => (s.innerText || '').trim() !== '')
  return spans.map((s) => getComputedStyle(s).color)
})()`)
if (Array.isArray(tiers) && tiers.length > 0) {
  say(new Set(tiers).size >= 2, `★ 同一张卡片内存在 ≥2 种色阶（实测 ${new Set(tiers).size} 种）⇒ 名字/元信息分层`)
}

// ⑤ ★★ 三态显示 —— 2026-10-05 加（契约 v1.3 §23.4 新增 `pending`）
/*
 * 这一段是**回门判据**：真服务端实测抓到过一条真 bug ——
 *   `toAgentStatus` 当时是 fail-closed（未知值一律当 `disabled`），
 *   而 §23.4 把 `pending` 定成了合法值 ⇒ **占位条目被显示成「已停用」**。
 * 那不是"保守"，是**编了一个不存在的决定**（"有人关掉了它"）：
 *   · `pending`  = 这位子还没人接（正常态）→ 下一步是**去接入**
 *   · `disabled` = 有人把它关掉了          → 下一步是**去问为什么**
 * ⇒ 断在**演示态**即可稳定复现（mock 现在刻意覆盖三态，含一条照真实占位条目来的 pending）。
 */
// ★★ 断**状态那一格**的文本（`[data-kaipu-agent-state]`），而不是整行 ——
//   因为占位条目的**名字本身就是「(待接入)」**，断"行内含待接入"会被名字蒙对。
const states = await ev(`(() => {
  const out = {}
  for (const el of document.querySelectorAll('[data-kaipu-agent]')) {
    const badge = el.querySelector('[data-kaipu-agent-state]')
    out[el.getAttribute('data-kaipu-agent-status')] = badge === null ? null : (badge.innerText || '').trim()
  }
  return out
})()`)
say(typeof states.enabled === 'string' && /^v\d/.test(states.enabled), `enabled 状态格 = 版本号（${states.enabled}）`)
say(states.pending === '待接入', `★ pending 状态格 = 「待接入」（实测：${states.pending}）`)
say(states.disabled === '已停用', `disabled 状态格 = 「已停用」（实测：${states.disabled}）`)

const byStatus = await ev(`(() => {
  const out = {}
  for (const el of document.querySelectorAll('[data-kaipu-agent]')) {
    const st = el.getAttribute('data-kaipu-agent-status')
    out[st] = (el.innerText || '').replace(/\\s+/g, ' ').trim()
  }
  return out
})()`)
say(byStatus.enabled !== undefined, '演示数据覆盖 enabled 态')
say(byStatus.pending !== undefined, '演示数据覆盖 pending 态（契约 v1.3 §23.4 新增）')
say(byStatus.disabled !== undefined, '演示数据覆盖 disabled 态')

/* ── 9. 左栏收起开关（横向空间还给内容）── */
/*
 * 这一段的两条支撑，来自**实测**（`dev/measure-tabs.mjs`，2026-10-05）：
 *   · 收起后右栏宽 432 → 693px、**最长一行 364 → 485px**（阅读舒适度）
 *   · 但内容高只降 16%（849 → 710px，**仍 1.57 屏**）
 * ⇒ 它是"边际改善"，不是"一屏看完"的灵药。判据照实断它的**真实行为**，不夸大。
 *
 * ★ 顺带说明：本段只断**开关行为**，不断空态那句指引（`[data-kaipu-lead]`）。
 *   为什么：那句是**过渡态**文案（`scene === null` 且 `scenes.length > 0`，
 *   只在"切数据源、选中项悬空"那一瞬出现，随后被自动选中补上）。
 *   抓它要卡几百毫秒的时序 ⇒ 断成时序断言会**随机假红**。
 *   ⇒ 改为：**抓到就硬断、抓不到就如实报未触发**（绝不因为它没出现就算"通过"）。
 */
console.log('\n── ⑨ 左栏收起开关（分隔线上的把手）──')
// ★ 可连跑：先确保处于"展开"态（上一个探针/人工操作可能留成收起）
const ensureOpen = await ev(`(async () => {
  const b = document.querySelector('[data-kaipu-left-toggle]')
  if (b === null) return 'no-toggle'
  if (b.getAttribute('aria-expanded') === 'true') return 'already-open'
  b.click()
  await new Promise(r => setTimeout(r, 800))
  return 'reopened'
})()`)
if (ensureOpen === 'no-toggle') {
  say(false, '分隔线上有左栏把手（[data-kaipu-left-toggle]）')
} else {
  say(true, `分隔线上有左栏把手（${ensureOpen}）`)
  const snapState = `(() => {
    const left = document.querySelector('[data-kaipu-left]')
    const run = document.querySelector('[data-kaipu-run]')
    const t = document.querySelector('[data-kaipu-left-toggle]')
    const tr = t.getBoundingClientRect()
    const lr = left === null ? null : left.getBoundingClientRect()
    return {
      leftGone: left === null,
      leftW: left === null ? 0 : Math.round(lr.width),
      runW: Math.round(run.getBoundingClientRect().width),
      runTextHead: (run.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
      glyph: (t.textContent || '').trim(),
      aria: t.getAttribute('aria-label'),
      expanded: t.getAttribute('aria-expanded'),
      handleTop: Math.round(tr.top),
      // ★ 断言"它夹在两栏中间"（用**左右两个邻居**夹逼，不用差值）——
      //   差值法会被左栏的滚动条宽度（实测 5px）干扰，而那个宽度并不稳定。
      inBetween: lr === null ? null : (tr.left >= lr.right - 1 && tr.right <= run.getBoundingClientRect().left + 1),
    }
  })()`
  const before = await ev(snapState)
  // ★★ 位置断言：把手必须**夹在左栏与右栏之间**（= 就在那条分隔线上），而不是跑回标题栏。
  //    阿开 2026-10-05 点名要的就是这一点（"不用移鼠标"）。
  say(before.inBetween === true, '★ 把手夹在左栏与右栏之间 —— 就在分隔线上，不用把鼠标甩到顶部')
  say(before.glyph === '‹' && before.aria === '收起场景栏', `展开态：箭头朝左、aria-label「${before.aria}」`)
  // 收起
  const after = await ev(`(async () => {
    document.querySelector('[data-kaipu-left-toggle]').click()
    await new Promise(r => setTimeout(r, 800))
    return ${snapState}
  })()`)
  say(after.leftGone === true, '收起后左栏确实不在了')
  const gained = after.runW - before.runW
  say(gained >= 200, `收起后右栏变宽（${before.runW} → ${after.runW}px，+${gained}px）`)
  say(
    after.glyph === '›' && after.aria === '展开场景栏' && after.expanded === 'false',
    `收起态：箭头朝右、aria-label「${after.aria}」、aria-expanded=${after.expanded}`,
  )
  say(
    Math.abs(after.handleTop - before.handleTop) <= 2,
    `★ 收起后把手的**垂直位置不变**（${before.handleTop} → ${after.handleTop}px）—— 没有跳回标题栏`,
  )
  // ★★ 因果不丢：收起的是"挑选入口"，**不是"我在看哪一场"** —— 右栏顶部仍须显示着它
  say(
    after.runTextHead === before.runTextHead && after.runTextHead.length > 0,
    '★ 收起后右栏顶部内容不变（仍是同一场、同一份结果）—— 因果没丢',
  )
  // 再展开
  const back = await ev(`(async () => {
    document.querySelector('[data-kaipu-left-toggle]').click()
    await new Promise(r => setTimeout(r, 800))
    return ${snapState}
  })()`)
  say(back.leftGone === false, '再点一次左栏回来（可逆）')
  say(
    Math.abs(back.runW - before.runW) <= 4 && back.glyph === '‹',
    `展开后恢复原状（右栏 ${back.runW}px vs 原 ${before.runW}px）`,
  )
}

// ★ 条件断言：抓到空态指引就硬断"指引与左栏状态一致"，抓不到**如实报未触发**
const leadProbe = await ev(`(() => {
  const lead = document.querySelector('[data-kaipu-lead]')
  if (lead === null) return null
  return {
    key: lead.getAttribute('data-kaipu-lead'),
    text: (lead.innerText || '').trim(),
    leftVisible: document.querySelector('[data-kaipu-left]') !== null,
  }
})()`)
if (leadProbe === null) {
  console.log('  · 空态指引本次未触发（过渡态；见本段注释）—— 未验证，不计通过')
} else {
  const ok =
    (leadProbe.key === 'visible') === leadProbe.leftVisible &&
    (leadProbe.leftVisible ? leadProbe.text.includes('左边') : !leadProbe.text.includes('先从左边'))
  say(ok, `★ 空态指引与左栏状态一致（${leadProbe.key}：${leadProbe.text.slice(0, 24)}…）`)
}

// ★ 古茶拍板 · 空态引导一句说清三动作（选场 → 放东西 → 拿报告），且不含术语。
//   与上面 `[data-kaipu-lead]` 同处空态，但**独立锚点**：那条守"指引与左栏状态一致"，
//   这条守"说清三动作 + 不含术语"—— 两条反向断言互不干扰（见 古茶 008 拍板稿 第七节）。
const gistEl = await ev(`(() => {
  const g = document.querySelector('[data-kaipu-gist]')
  if (g === null) return null
  return (g.innerText || '').trim()
})()`)
if (gistEl === null) {
  console.log('  · 空态引导（古茶一句）未触发 —— 未验证，不计通过')
} else {
  const covers = gistEl.includes('选一场') && gistEl.includes('带签的报告')
  /**
   * ★★ 断**断句**（2026-10-08 · 古茶拍板稿对齐）：`审一审。` 而不是 `审一审，`。
   *
   * 为什么这也值得一条断言：这一句的断句**本身在编码"三步"** ——
   *   前半句 = 前两个动作（选场 + 放东西），后半句 = 第三个动作（拿报告）。
   *   一逗到底（原来那版）读起来是"一件事的三个分句"，两句号才是"做完前两步、拿第三步的东西"。
   * ★ 它能失败：把句号改回逗号当场红（`includes('审一审。')` 不再成立）。
   */
  const punctuated = gistEl.includes('审一审。') && gistEl.includes('报告。')
  const noTerms = !/审核面|维度|编排|灯次/.test(gistEl)
  say(covers, `★ 空态引导说清三动作（选场 / 放东西 / 拿报告）：${gistEl.slice(0, 18)}…`)
  say(punctuated, '★ 断句按拍板稿（「审一审。」「报告。」两处句号 —— 句读本身在说三步）')
  say(noTerms, '★ 空态引导不含术语（审核面 / 维度 / 编排 / 灯次 均未出现）')
}

/* ── 10. 铺子资料：路径条的两个出路（「打开目录」+「复制」）──────────────
 *
 * ★ 为什么这一段在本文件里（而不是另起一个铺子 UI 探针）：
 *   铺子资料层与运行视图**无关** —— 它自取数据、服务端挂了也照常工作
 *   （见 ShopShelf 的文件头）。但本仓**没有**独立的铺子 UI 探针，
 *   而本文件已经有完整的 CDP 管道与"打开面板 / 等数据落地"的前提摆法
 *   ⇒ 落在这儿，用 `[data-kaipu-shop]` 把作用域划清。
 *   （★ 不新开文件还有一个实际理由：新增件会牵动公开面 G1 清单的件数核对。）
 *
 * ★★ 它同时守一条**边界**：铺子资料必须长在 `[data-kaipu-run]` **之外**。
 *   这条边界有来历 —— 它当初就是从运行视图里被移出去的（见 PlatformPanel 注释）。
 *
 * ★★ 真点一下「打开目录」会**真的弹出一个资源管理器窗口**
 *   ⇒ 所以它是**开关**（`--open-dir`），默认不点。
 *   可重复跑的判据不该骚扰用它的人；而"点了到底成不成"这件事**必须**有人验过一次，
 *   带开关就是为那一次。（"打不开"时的降级出路也在这段被看着：别把备选做成独木桥。）
 */
console.log('\n── ⑩ 铺子资料：路径条的两个出路 ──')
/* ★★ 096：铺子资料已是**独立页签** ⇒ 先切过去（否则 [data-kaipu-shop] 根本不在 DOM）。 */
const toShop = await ev(`window.__kaipuProbe.switchTab('shop')`)
say(toShop === true, '★ 可切到「铺子资料」页签（[data-kaipu-tab="shop"]）')
const shopEl = await ev(`(() => {
  const shop = document.querySelector('[data-kaipu-shop]')
  if (shop === null) return null
  const open = shop.querySelector('[data-kaipu-shop-opendir]')
  const btns = [...shop.querySelectorAll('button')].map((b) => (b.innerText || '').trim())
  return {
    inRun: shop.closest('[data-kaipu-run]') !== null,
    openBtn: open !== null,
    openLabel: open === null ? '' : (open.innerText || '').trim(),
    hasCopy: btns.indexOf('复制') >= 0,
    pathShown: /存在本机[:：]/.test(shop.innerText || ''),
  }
})()`)
say(shopEl !== null, '铺子资料区在场（[data-kaipu-shop]）')
say(shopEl !== null && shopEl.inRun === false, '★ 铺子资料在运行视图**之外**（同一条判据边界）')
say(shopEl?.pathShown === true, '路径条仍在（「存在本机：…」—— 用户有权知道自己的东西存在哪）')
say(shopEl?.openBtn === true && shopEl?.openLabel === '打开目录', '★ 路径条上有「打开目录」按钮')
say(shopEl?.hasCopy === true, '★ 「复制」照旧在（打不开时的出路 —— 备选出路不能被做成独木桥）')
if (argv.includes('--open-dir')) {
  const od = await ev(`(async () => {
    const b = document.querySelector('[data-kaipu-shop-opendir]')
    if (b === null) return null
    b.click()
    await new Promise(r => setTimeout(r, 1500))
    const shop = document.querySelector('[data-kaipu-shop]')
    return { text: (shop.innerText || '').replace(/\\s+/g, ' ').trim() }
  })()`)
  say(
    /已请系统打开[:：]/.test(od?.text ?? ''),
    '★★ 真机点一次：「打开目录」走到了 host，并回「已请系统打开：<路径>」',
  )
  const hit = /已请系统打开[:：]\s*(\S+)/.exec(od?.text ?? '')
  console.log(`  · host 回报的路径：${hit === null ? '（未取到）' : hit[1]}`)
} else {
  console.log('  · 「打开目录」真机点测未开启（加 --open-dir 才真点 —— 它会弹一个资源管理器窗口）：未验证，不计通过')
}

/* ── 11. 「铺子资料」页签：互斥 + 三个抽屉（★ 2026-10-08 · 096 显式改写）──────
 *
 * ★★ 改写说明（**改对象，不是放松断言**）：
 *   原 ⑪ 组验的是「顶部『铺子资料 ↓』= 展开 + 滚到底」这条**跳转**行为
 *   （含"制造反态：先收起、再回顶"那套铺垫）。096 把它提拔成**页签**后，
 *   跳转按钮与那套"展开 + 滚动 + 兜底"整体作废（`jumpSeq` / `scrollIntoView`
 *   两个 effect 已从产品删除）⇒ 原断言**失去对象**。
 *   ⇒ 换验现在真实存在的对象：**页签互斥 + 三个抽屉都在 + 在运行视图之外**。
 *   ★ 它仍然**能失败**：若 `[data-kaipu-shop]` 被挪回操作台（或常驻挂载），
 *     下面的 `goneOnConsole` 当场变红 —— 这正是 D-D3 要守的东西。
 */
console.log('\n── ⑪ 「铺子资料」页签：互斥 + 三个抽屉 ──')
const shopTab = await ev(`(async () => {
  await window.__kaipuProbe.switchTab('shop')
  const shop = document.querySelector('[data-kaipu-shop]')
  const drawEls = [...document.querySelectorAll('[data-kaipu-shop-drawers]')]
  const drawers = drawEls.map((d) => d.getAttribute('data-kaipu-shop-drawers'))
  const inRun = shop === null ? null : shop.closest('[data-kaipu-run]') !== null
  await window.__kaipuProbe.switchTab('console')
  return {
    onShop: shop !== null,
    drawerCount: drawEls.length,
    drawerNames: drawers.join(','),
    inRun: inRun,
    goneOnConsole: document.querySelector('[data-kaipu-shop]') === null,
  }
})()`)
say(shopTab?.onShop === true, '★ 切到「铺子资料」⇒ 资料区在场（[data-kaipu-shop]）')
say(shopTab?.drawerCount === 3, `★ 三个抽屉都在（实读 ${shopTab?.drawerCount} 个）`)
say(
  shopTab?.drawerNames === '待审材料,审校报告,草稿',
  `★ 展开的正是那三个抽屉（读到：${shopTab?.drawerNames ?? '（无）'}）`,
)
say(shopTab?.inRun === false, '★★ 资料区在运行视图**之外**（同一条判据边界 D-D3）')
say(shopTab?.goneOnConsole === true, '★★ 页签互斥：切回操作台 ⇒ 资料区不在 DOM（不是"藏起来"，是没渲染）')

/* ── 12. 「怎么用」页签：内容完整 + 互斥（★ 2026-10-08 · 096 显式改写）──────
 *
 * ★★ 改写说明：原 ⑫ 组验的是「顶部『怎么用 ↑』= 展开 + 回顶部」。
 *   同 ⑪ —— 页签化后该**跳转**行为作废。改验现在真实存在的对象。
 *   ⚠️ 与 ⓪ 段的**分工**：⓪ 段读的是**文案与灯名白名单**（内容对不对）；
 *      本组验的是**结构**（在不在 DOM / 跟谁互斥 / 旧锚点是否已清干净）—— 两件事。
 *   ★ 它能失败：若引导被挪回操作台，`goneOnConsole` 变红；
 *     若旧跳转按钮被留了一颗，`gotoGone` / `shopJumpGone` 变红。
 */
console.log('\n── ⑫ 「怎么用」页签：内容 + 互斥 ──')
const helpTab = await ev(`(async () => {
  await window.__kaipuProbe.switchTab('help')
  const el = document.querySelector('[data-kaipu-intro]')
  const len = el === null ? 0 : String(el.innerText || '').length
  const inRun = el === null ? null : el.closest('[data-kaipu-run]') !== null
  const collapseGone = document.querySelector('[data-kaipu-intro-collapse]') === null
  const gotoGone = document.querySelector('[data-kaipu-intro-jump]') === null
  const shopJumpGone = document.querySelector('[data-kaipu-shop-jump]') === null
  await window.__kaipuProbe.switchTab('console')
  return {
    present: el !== null,
    len: len,
    inRun: inRun,
    collapseGone: collapseGone,
    gotoGone: gotoGone,
    shopJumpGone: shopJumpGone,
    goneOnConsole: document.querySelector('[data-kaipu-intro]') === null,
  }
})()`)
say(
  helpTab?.present === true && (helpTab?.len ?? 0) > 80,
  `★ 切到「怎么用」⇒ 引导内容在场且非空（${helpTab?.len ?? 0} 字）`,
)
say(helpTab?.inRun === false, '★★ 引导内容在运行视图**之外**（D-D3：图例不污染 R3）')
say(helpTab?.goneOnConsole === true, '★★ 页签互斥：切回操作台 ⇒ 引导内容不在 DOM')
say(helpTab?.collapseGone === true, '★★ 「收起」按钮已随页签化删除（整页即内容）')
say(
  helpTab?.gotoGone === true && helpTab?.shopJumpGone === true,
  '★★ 旧的两个顶部跳转按钮（[data-kaipu-intro-jump] / [data-kaipu-shop-jump]）已不在页面上'
    + ' —— 页签取代了滚动导航',
)

/* ── 13. 宿主侧边栏的品牌位：坐的是我们 ────────────────────────────
 *
 * ★ 这条判据要守的是**改到位了**：品牌名不是我们面板里的一块内容，
 *   它挂在**宿主自己的侧边栏品牌区**（座位 `sidebar.brand.name`）。
 *   ⇒ 两条都要成立："锚点找得到" + "它在宿主 chrome 里、不在我们面板里"。
 *   ★ 光断"文本对"不够 —— 要是哪天把它塞进面板，文本一样对，但**位置错了**
 *     （用户看的是侧边栏，不是面板里多出来的一行字）。
 *
 * ★ 只断**锚点 + 文案 + 不在我们面板里**；位置另打印**类名链与几何**供人核，
 *   不把"类名里有没有 sidebar"写成硬断言 —— 宿主换一版 CSS Modules 命名就会假红，
 *   而它要守的东西（坐在品牌位上）其实没坏。
 */
console.log('\n── ⑬ 宿主品牌位：侧边栏坐的是我们 ──')
const brand = await ev(`(() => {
  const el = document.querySelector('[data-kaipu-brand]')
  if (el === null) return { present: false }
  const chain = []
  let p = el
  while (p !== null && chain.length < 12) {
    const cn = typeof p.className === 'string' ? p.className : ''
    const parts = cn === '' ? [] : cn.split(/\\s+/).filter((c) => c !== '')
    chain.push(p.tagName.toLowerCase() + (parts.length === 0 ? '' : '.' + parts.join('.')))
    p = p.parentElement
  }
  const r = el.getBoundingClientRect()
  return {
    present: true,
    text: (el.textContent || '').trim(),
    inOurRun: el.closest('[data-kaipu-run]') !== null,
    inOurShop: el.closest('[data-kaipu-shop]') !== null,
    left: Math.round(r.left),
    top: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
    chain: chain.join(' < '),
  }
})()`)
say(brand?.present === true, '★ 宿主品牌位上有我们的占用者（[data-kaipu-brand]）')
/* ★★ 这一条**有意锚中文文案** —— 与本仓"判据锚结构、不锚文案"的纪律看似冲突，
 *   但两者要分清（2026-10-07 改名时顺手把它写清楚，免得日后有人"照纪律"把它改成结构断言）：
 *
 *   · 锚文案**是坏事**，当那段文案是**次要的** —— 例：按钮写「收起」还是「折叠」，
 *     改一次文案就响一次，逼人去改判据，改着改着就改松了（本仓真踩过，见 setIntro 注释）。
 *   · 锚文案**是对的**，当那段文案**就是交付物本身** —— 品牌名就是这一类：
 *     "侧边栏上写的到底是哪几个字"**正是**这条判据要回答的问题，换成结构断言就答不出。
 *     ⇒ 这时它变红不是噪声，是**在正确报告"名字变了"**。
 *
 *   ★ 判别的问法：**这条断言要回答的问题，能不能用"文本内容"以外的东西回答？**
 *     能 ⇒ 锚结构；不能 ⇒ 锚文案，并把"改名要同步改这里"写进源码注释。
 *     （Brand.tsx 那边的注释已写明这一条。）
 *
 * ★ 2026-10-07 由「山海 · 开铺 · 凉亭 · 场地」改为「山海 · 开铺」——
 *   古茶 010 §二：场地是**基座**，不与开铺/凉亭并列（发起人采纳）。
 *   ⚠️ 本行会随该名字变红 —— 那是**预期**，不是回归。
 */
say(
  brand?.text === '山海 · 开铺',
  `★★ 品牌名 = 山海 · 开铺（实读「${brand?.text ?? ''}」）`,
)
say(
  brand?.inOurRun === false && brand?.inOurShop === false,
  '★ 它**不在我们面板的任何一块里** —— 是宿主 chrome（侧边栏），不是面板内容',
)
if (brand?.present === true) {
  console.log(`  · 位置：left=${brand.left} top=${brand.top} 尺寸=${brand.width}×${brand.height}（侧边栏品牌区在左上角）`)
  console.log(`  · 祖先链：${brand.chain}`)
}

/* ══ ⑭ 旧品牌名必须已从界面上消失（2026-10-07 加）══════════════════════════
 *
 * 依据：工坊 `083-reply-069-cuoci-biaoti-ruling-v1-20261007.md` §三（委托方已拍）——
 *   宿主标题先「山海 · 开铺」，凉亭/工位上线后再升格「山海 · 场地」。
 *   原拟的「山海 · 开铺 · 凉亭 · 场地」**架构上是错的**（场地是基座，不与插件并列）。
 *
 * ★ 为什么这一条可以放在末尾（而 R4 那条不行）：
 *   **品牌位是宿主的常驻 chrome，它一直在页面上** ⇒ 末尾读也读得到。
 *   ⇒ 判据放哪儿，取决于**被测对象在那一刻在不在**，不是"统一放末尾好维护"。
 *     （R4 那两行只在选中带裁剪的场景时才渲染 ⇒ 必须贴着 `t1` 读，见该处注释。）
 *
 * ⚠️ 与正向那条的分工：⑬ 段的 `brand?.text === '山海 · 开铺'` 是**正面**断"名字对"；
 *   这条是**反面**断"旧名字不在了"。两条都必要 —— 正面那条在"品牌位被别的插件占了、
 *   显示它自己的名字"时也会红，但红的原因不同；分开报，才知道该去修哪。
 *
 * ★★ **这一条第一次写的时候漏了**（2026-10-07，被工坊当场抓出）：
 *   我只放了四段式 `山海 · 开铺 · 凉亭 · 场地`（那是 `Brand.tsx` 侧边栏品牌位的旧名），
 *   而**面板主标**是另一处、写的是三段式 `山海 · 开铺 · 场地`（`Intro.tsx`）——
 *   ⇒ 判据绿着，界面里旧名**还在**。
 *   ★★★ 教训：**"旧名字"可能不止一种写法。** 反查旧值时要问
 *     "**同一件事在几处以几种形态出现过**"，而不是"我改的那处长什么样"。
 *     这与本仓"枚举式判据必然漏"同族 —— 我枚举了**一处**，就漏了**另一处**。
 *   ★ 顺带：工坊是从**发布快照**里读出来的（他们核 53 件时顺手发现），
 *     说明"交出去的东西会被逐件读一遍"这件事本身是一条有效的判据。
 *
 * ⚠️ 写这段时我还犯了第二个错（被 `check-tools-syntax.mjs` 当场拦下）：
 *   我把这些注释行**追加在了上面那个块的块注释结束符之后** ⇒ 它们不再是注释，
 *   首行以星号开头 ⇒ 被解析成裸运算符 ⇒ **SyntaxError**。
 *   ⇒ 教训：**在已有块注释后面补话，要补到块注释结束符之前**，
 *     不是"在它下面另起一段"。
 *   ★ 而修正这段说明时，我又**第三次**踩了同一个坑：为了讲清"别写块注释结束符"，
 *     我把那两个字符**原样写进了这条注释里** ⇒ 又提前闭合了一次。
 *     ⇒ 所以这条注释**通篇不敢出现那两个字符**（写"块注释结束符"）。
 *     **说明一个坑的时候，最容易掉进那个坑。**
 */
const staleBrandName = ['山海 · 开铺 · 凉亭 · 场地', '山海 · 开铺 · 场地']
const pageTextForBrand = await ev(`window.__kaipuProbe.text()`)
const hitStaleBrand = staleBrandName.filter((s) => String(pageTextForBrand).includes(s))
say(
  hitStaleBrand.length === 0,
  `★★ 界面上**不再出现**旧品牌名（已核 ${String(staleBrandName.length)} 种旧写法，`
    + `命中 ${String(hitStaleBrand.length)}${hitStaleBrand.length === 0 ? '' : `：${hitStaleBrand.join(' / ')}`}）`
    + ' —— 旧名把场地与插件并列，架构上错的（工坊 069-cuoci-biaoti-ruling §三）',
)

/* ══ ⒂ 四页签：[操作台 | 铺子资料 | 管理方 | 怎么用]（2026-10-08 · 096 定型）════════
 *
 * ★★ 2026-10-08 补了一个**段头**（`console.log`）—— 这段注释本来就在，
 *   但**没有对应的段头行** ⇒ 它下面 7 条断言**默默并进了 ⑬ 段**（品牌位）里。
 *   症状与古茶点名的"名字比事实大"**同族、方向相反**：这里是**名字比事实小** ——
 *   覆盖做了、日志上看不出来（读者会以为"四页签/管理方没人验"）。
 *   ⇒ 是 `tools/check-probe-sections.mjs` 把段↔断言配对打出来时**当场看出来的**：
 *     ⑬ 段名下挂着 13 条，而其中一半在讲页签。
 *   ★ 结论：**两种方向都要治** —— 判句"段名必须对应真实验证"是等号，不是大于等于。
 *
 * 依据：本仓 `095` 落件 + 发起人拍板顺序「做 → 我的东西 → 管理 → 帮助」。
 * 客户端零管理能力（红线 ③）⇒ 管理方页签是**占位 + 指路**，不承载真管理逻辑。
 *
 * 守护三条：
 *   ① 页签栏在场、**四个** tab 都在、**顺序**正确，且默认停在「操作台」；
 *   ② ★ 切到管理方后，`[data-kaipu-run]` **不在 DOM 里** —— 管理占位与运行视图
 *      是**互斥的两块**，结构上够不着 D-D3 边界（不是靠判据自己排除）；
 *   ③ 切回操作台可逆（状态不留痕）。
 *   （②是反向断言：它只在「manage 激活」这一刻才成立。）
 *   ★ 顺序为什么值得断：它是**发起人拍板的交付物本身**（"做→我的东西→管理→帮助"），
 *     与 ⑬ 段品牌名同族 —— 内容即交付物时**只能锚顺序/文案**，不能只断"有四个按钮"。
 */
console.log('\n── ⒂ 四页签：操作台 | 铺子资料 | 管理方 | 怎么用 ──')
const mt = await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const nav = document.querySelector('[data-kaipu-tabs]')
  const tabEls = nav ? [...nav.querySelectorAll('[role=tab]')] : []
  const tabs = nav ? tabEls.map(t => ({ id: t.getAttribute('data-kaipu-tab'), selected: t.getAttribute('aria-selected') })) : null
  const order = nav ? tabEls.map(t => t.getAttribute('data-kaipu-tab')).join(',') : null
  const defaultConsole = tabs ? tabs.find(t => t.id === 'console')?.selected === 'true' : false
  document.querySelector('[data-kaipu-tab="manage"]').click()
  await sleep(300)
  const m = document.querySelector('[data-kaipu-manage]')
  const manageText = m ? m.innerText : null
  const runGoneOnManage = document.querySelector('[data-kaipu-run]') === null
  document.querySelector('[data-kaipu-tab="console"]').click()
  await sleep(200)
  const backToConsole = document.querySelector('[data-kaipu-run]') !== null && document.querySelector('[data-kaipu-manage]') === null
  return { tabs, order, defaultConsole, hasManage: m !== null, manageText, runGoneOnManage, backToConsole }
})()`)
say(mt?.tabs !== null, '★ 顶部页签栏在场（[data-kaipu-tabs]）')
say(
  Array.isArray(mt?.tabs) && mt.tabs.length === 4,
  `★★ **四个** tab 都在（实读 ${Array.isArray(mt?.tabs) ? mt.tabs.length : '?'} 个）`,
)
say(
  mt?.order === 'console,shop,manage,help',
  `★★ 顺序即「做 → 我的东西 → 管理 → 帮助」（实读 ${mt?.order ?? '（无）'}）`,
)
say(mt?.defaultConsole === true, '★★ 默认停在「操作台」（绝大多数第一眼是看运行结果）')
say(mt?.hasManage === true, '★ 切到「管理方」⇒ 占位卡出现（[data-kaipu-manage]）')
say(mt?.runGoneOnManage === true, '★★ 管理视图激活时运行视图不在 DOM（占位与运行视图互斥，D-D3 边界够不着）')
say(
  mt?.manageText?.includes('发起开铺') === true && mt?.manageText?.includes('管理方') === true,
  '★ 占位卡讲清「管理方主持开铺」（命中「管理方」「发起开铺」）',
)
/**
 * ★★ 2026-10-17 改判（承 Codex 验收 E5 / P2「管理方口径」）——**不是放宽，是改准 + 加反向**。
 *
 * 旧断言断的是「如实说『本地演示暂不开放』」。但实测：这一页 **`view === 'manage'` 时
 * 无论 isMock 与否都照常渲染** ⇒ 真服务端用户看到「本地演示模式暂不开放」
 * 会以为是自己没切对模式 —— **那是把限制归错了因**。
 *   · 真边界是**门禁 068 未落地**（P2.5），与本机在不在演示模式**无关**。
 * ⇒ 文案已改「管理方功能尚未开放 —— 待门禁 068 接入后落地（P2.5）」。
 *
 * ★ 本条这样改，三个条件缺一不可（换成"只把字面量换掉"就是放宽）：
 *   ① 仍要**指路 P2.5**（真实边界不能丢）
 *   ② 仍要**说不开放**（`尚未开放` 与 `暂不开放` 都算 —— 这是同义的如实表述）
 *   ③ ★★ **新增反向断言**：不得出现「本地演示」/「演示模式」这类**归因错误**的说法
 *      —— 防的就是这次修掉的病复发。它**能失败**：把旧文案加回去，这条当场变红。
 */
const mgmtText = mt?.manageText ?? ''
const saysP25 = mgmtText.includes('P2.5')
const saysClosed = mgmtText.includes('尚未开放') || mgmtText.includes('暂不开放')
const blamesDemo = mgmtText.includes('本地演示') || mgmtText.includes('演示模式')
say(
  saysP25 && saysClosed,
  `★ 占位卡指路到服务端管理方界面（P2.5）且如实说「尚未开放」（不伪造 picker）`,
)
say(
  !blamesDemo,
  `★★ 占位卡**不把限制归因于演示模式**（实读${blamesDemo ? '命中' : '未命中'}「本地演示/演示模式」）—— 该页在真服务端也渲染，归错因会误导`,
)
say(mt?.backToConsole === true, '★ 切回「操作台」⇒ 运行视图恢复、管理占位消失（状态可逆）')

/* ══ ⒃ 真服务端路径（live）下的四页签（2026-10-08 · 098 补 096 §四 的已知缺口）════════
 *
 * ★★ 为什么单开一段：096 落件如实记了一条 ——
 *   「四页签只在**演示数据**下验过，**真服务端路径未测**」。
 *   前面每一段都跑在演示数据上（那是**设计**：判定/轮次那几条要的是可复现的演示序列）。
 *   ⇒ 缺口不是"漏写了一条断言"，而是**那些断言从来没有在 live 数据上跑过**。
 *     数据换了（场景 id、分类、agent 数全不一样），界面是不是还成立 —— 没人看过。
 *
 * ★★ 所以**先读清"非演示"到底是哪一种**，再决定断什么：
 *   `live` / `unreachable` / `no_channel` 对"页签该不该在"是同一个答案，
 *   但**读数意义完全不同** —— 把 unreachable 当成 live 来报，
 *   等于拿"连不上"冒充"验过了"（同 `live.ts` 那条纪律）。
 *   ⇒ 不是 live ⇒ **如实报未验证、不计通过**：既不假绿，也不假红。
 *   ★ 判 live 的判据是两条合取：锚点翻到 0 **且** SourceBanner 不在
 *     （banner 只在 mock / unreachable / no_channel 时渲染 ⇒ 它不在 = live）。
 *
 * ★ 断的与 ⒂ 段同源，但**换了数据路径**，且互斥**逐个验**（⒂ 只验了 manage）：
 *   live 下万一哪个页签的锚点依赖了演示数据（比如 shop 的抽屉数量），
 *   只验一个是抓不到的。
 */
console.log('\n── ⒃ 真服务端路径：四页签与互斥（非 live 则如实报未验证）──')
const srcBefore = await ev(`window.__kaipuProbe.readSource()`)
const toNon = await ev(`window.__kaipuProbe.toggleSource()`)
const nonReady2 = await ev(`window.__kaipuProbe.waitSourceMock('0')`)
const liveSrc = await ev(`window.__kaipuProbe.readSource()`)
const liveBanner = await ev(
  `(() => { const b = document.querySelector('[data-kaipu-source]'); return b === null ? null : b.getAttribute('data-kaipu-source') })()`,
)
const isLive = liveSrc?.mock === '0' && liveBanner === null
if (toNon !== true || nonReady2 !== true) {
  console.log('  · 数据源切到非演示**失败**（没切换成功）—— 本条**未验证，不计通过**')
} else if (!isLive) {
  console.log(`  · 非演示态是「${liveSrc?.sourceText ?? '?'}」（banner=${liveBanner ?? 'null'}）—— **不是 live**`)
  console.log('    本条**未验证，不计通过**（拿"连不上"冒充"验过了"是更坏的错；见本段注释）')
} else {
  console.log(`  · 非演示态是 **live**（界面自报「${liveSrc?.sourceText ?? ''}」）—— 开始断四页签`)
  const liveTabs = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const ANCH = { console: 'data-kaipu-run', shop: 'data-kaipu-shop', manage: 'data-kaipu-manage', help: 'data-kaipu-intro' }
    document.querySelector('[data-kaipu-tab="console"]').click()
    await sleep(350)
    const nav = document.querySelector('[data-kaipu-tabs]')
    const order = nav === null ? null : [...nav.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('data-kaipu-tab')).join(',')
    const per = {}
    for (const k of Object.keys(ANCH)) {
      document.querySelector('[data-kaipu-tab="' + k + '"]').click()
      await sleep(350)
      const present = {}
      for (const j of Object.keys(ANCH)) present[j] = document.querySelector('[' + ANCH[j] + ']') !== null
      per[k] = { own: present[k], othersGone: Object.keys(ANCH).filter((j) => j !== k).every((j) => present[j] === false) }
    }
    document.querySelector('[data-kaipu-tab="console"]').click()
    await sleep(350)
    const scenes = document.querySelectorAll('[data-kaipu-left] button[aria-pressed]').length
    const agents = document.querySelectorAll('[data-kaipu-agent]').length
    return { order, per, scenes, agents }
  })()`)
  say(
    liveTabs?.order === 'console,shop,manage,help',
    `★★ live 态：四页签与顺序不变（实读 ${liveTabs?.order ?? '（无）'}）—— 页签是**导航**，与数据路径无关`,
  )
  const allOwn = ['console', 'shop', 'manage', 'help'].every((k) => liveTabs?.per?.[k]?.own === true)
  const allGone = ['console', 'shop', 'manage', 'help'].every((k) => liveTabs?.per?.[k]?.othersGone === true)
  say(allOwn, '★★ live 态：**四个**页签逐个切过去，对应锚点都真的出现')
  say(allGone, '★★ live 态：每个页签**互斥**成立（其余三个的锚点都不在 DOM）—— 逐个验，不是只验 manage')
  console.log(`  · live 态数据面（供对照）：场景 ${liveTabs?.scenes ?? '?'} · 执行方 ${liveTabs?.agents ?? '?'}`)

  /**
   * ★★ live 态的「维」检查（2026-10-08 · 古茶拍板 §五）—— **本节才是正主**。
   *
   * 为什么演示态那条不够：古茶点名的对象是「**服务端下发的场景名**」。
   *   演示数据的场景名是我方自编的（「开铺审计 · 标准」…），它干净**证明不了**服务端干净。
   *   ⇒ 同一条断言必须在 **live 数据**上再跑一次；而 live 要切数据源才拿得到
   *     （同 ⒃ 段其余各条的口径：不是 live 就如实报未验证，不假绿也不假红）。
   *
   * ★ 它**现在就是绿的**，但这条绿是有意义的绿：它证明"**这一刻**服务端下发的可见数据里
   *   没有「维」"。★ 而它的价值主要在**将来**：服务端哪天把「维」加回来（或换成别的口径词），
   *   这一条当场红 —— 我方不必靠"记得去看一眼"。
   *   ⚠️ 如实记一条**它没覆盖**的东西：口径要求是「对外叫**审核面**」，
   *     而"没有「维」"只是**必要条件**。若服务端改用一个同样不对的词（比如现在实测到的是「堆」），
   *     这一条**照样绿**。⇒ 那半个问题（该叫什么）不是客户端能定的，已如实上报（见 `101 §三`）。
   *     本仓纪律：**做不到的那半，写清楚做不到**，不拿"我加了判据"冒充"我给全了"。
   */
  const liveWei = await scanWeiAcrossTabs('console')
  say(
    liveWei.fresh.length === 0,
    `★★ live 态：**我方渲染**的文本不含「维」`
      + `${liveWei.fresh.length === 0 ? '（口径一致）' : ` —— ★ 命中 ${liveWei.fresh.length} 处：${liveWei.fresh.slice(0, 3).join(' ｜ ')}`}`,
  )
  console.log(
    `  · live 已知**服务端真值**含「维」（待工坊改，共 ${liveWei.known.length} 处）：`
      + `${liveWei.known.slice(0, 2).join(' ｜ ') || '（本次未出现 —— ★ 若工坊已全改完，此行为空）'}`,
  )
  const liveSceneLabels = await ev(`(() => [...document.querySelectorAll('[data-kaipu-left] button[aria-pressed]')].map((b) => (b.getAttribute('aria-label') || '').trim()))()`)
  console.log(`  · live 态场景名（供对照，口径词由服务端定）：${(liveSceneLabels ?? []).join(' ｜ ') || '（未取到）'}`)
}
// ★ 收尾：把数据源**切回**去 —— 不给末尾那张全景截图、也不给下一次跑留一个 live 页面
if (srcBefore?.mock === '1') {
  await ev(`window.__kaipuProbe.toggleSource()`)
  await ev(`window.__kaipuProbe.waitSourceMock('1')`)
  const backSrc = await ev(`window.__kaipuProbe.readSource()`)
  say(backSrc?.mock === '1', '★ 切回演示态（不留一个 live 页面给截图与下一跑）')
}

/* ══ ⒄ 跨页回路：铺子资料「开始运行」→ 操作台的发起区（2026-10-08 · 101）════════
 *
 * ★★ 为什么要单独开水这一段：前面 ⑩ / ⑪ 验的是"资料能不能取"，
 *   ⒃ 验的是"页签切得对" —— **没有一条**覆盖"资料页能不能**出发**"。
 *   而这条链路上最容易退化的恰恰是它：切页签是一行 `setView`，
 *   把发起区送到视野中间是另一件事 —— 少了后者，用户点完看见的还是"上面那一块"，
 *   **体感与"点了没反应"无从区分**。
 *
 * ★★ 两条 Assert 的**可证伪性**是这一段唯一要认真对待的事：
 *   ① 演示态下**不应该有**这颗按钮 ⇒ 若将来谁把它无条件渲染出来，当场变红
 *      （★ 反向断言要挑**它若在就能被读到**的时刻：此刻资料页是渲染出来的，
 *        只有按钮是条件的 —— 不是"目标不在页面上"那种假绿）；
 *   ② 点完要**真的动了位置** ⇒ 先把"改动前"的位置量出来摆在日志里，
 *      若它本来就在视野中间，这一趟就没有证据力，得如实说（不算通过）。
 *
 * ★ 为什么 banClick 走 live：这颗按钮只在"有东西可跑"时存在（演示模式没有）
 *   ⇒ 与 ⒃ 同一条纪律：不是 live ⇒ **如实报未验证，不计通过**。
 */
console.log('\n── ⒄ 跨页回路：铺子资料「开始运行」→ 操作台发起区 ──')
const mockNoRun = await ev(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await window.__kaipuProbe.switchTab('shop')
  await sleep(300)
  const shop = document.querySelector('[data-kaipu-shop]')
  const btn = document.querySelector('[data-kaipu-shop-run]')
  const out = {
    shopHere: shop !== null,
    btnHere: btn !== null,
    drawers: document.querySelectorAll('[data-kaipu-shop-drawers]').length,
  }
  await window.__kaipuProbe.switchTab('console')
  await sleep(300)
  return out
})()`)
say(
  mockNoRun?.shopHere === true && mockNoRun?.drawers === 3,
  '演示态：资料页**在场**（判据有对象 —— 不是"目标压根不在页面上"的假绿）',
)
say(
  mockNoRun?.btnHere === false,
  '★★ 演示态**没有**「开始运行」按钮 —— 没有可跑的服务端 ⇒ 没有落点 ⇒ 不给入口',
)

/* ── 同一段，换到 live 数据路径上再走一遍（不是 live 则如实报未验证）── */
const loopSrcBefore = await ev(`window.__kaipuProbe.readSource()`)
const loopToNon = await ev(`window.__kaipuProbe.toggleSource()`)
const loopNonReady = await ev(`window.__kaipuProbe.waitSourceMock('0')`)
const loopSrc = await ev(`window.__kaipuProbe.readSource()`)
const loopBanner = await ev(
  `(() => { const b = document.querySelector('[data-kaipu-source]'); return b === null ? null : b.getAttribute('data-kaipu-source') })()`,
)
const loopIsLive = loopSrc?.mock === '0' && loopBanner === null
if (loopToNon !== true || loopNonReady !== true) {
  console.log('  · 数据源切到非演示**失败** —— ⒄ 的 live 部分**未验证，不计通过**')
} else if (!loopIsLive) {
  console.log(`  · 非演示态是「${loopSrc?.sourceText ?? '?'}」—— **不是 live**；⒄ 的 live 部分**未验证，不计通过**`)
} else {
  console.log(`  · 非演示态是 **live** —— 走一遍跨页回路`)
  const loop = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const measure = (el) => {
      if (el === null) return null
      let p = el.parentElement, box = null
      while (p !== null) {
        const oy = getComputedStyle(p).overflowY
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) { box = p; break }
        p = p.parentElement
      }
      if (box === null) return { hasBox: false, scrollTop: -1, midGap: -1, topGap: -1, quarter: -1, taller: false, visible: true }
      const b = box.getBoundingClientRect()
      const e = el.getBoundingClientRect()
      return {
        hasBox: true,
        scrollTop: Math.round(box.scrollTop),
        midGap: Math.round(Math.abs((e.top + e.bottom) / 2 - (b.top + b.bottom) / 2)),
        quarter: Math.round(b.height / 4),
        topGap: Math.round(Math.abs(e.top - b.top)),
        taller: e.height >= b.height,
        visible: e.bottom > b.top && e.top < b.bottom,
      }
    }
    await window.__kaipuProbe.switchTab('console')
    await sleep(350)
    const before = measure(document.querySelector('[data-kaipu-start]'))
    await window.__kaipuProbe.switchTab('shop')
    await sleep(350)
    const btn = document.querySelector('[data-kaipu-shop-run]')
    const btnLabel = btn === null ? '' : (btn.innerText || '').trim()
    const btnInRun = btn === null ? null : btn.closest('[data-kaipu-run]') !== null
    if (btn !== null) btn.click()
    await sleep(900)
    const after = measure(document.querySelector('[data-kaipu-start]'))
    return {
      btnHere: btn !== null,
      btnLabel: btnLabel,
      btnInRun: btnInRun,
      before: before,
      after: after,
      shopGone: document.querySelector('[data-kaipu-shop]') === null,
      runHere: document.querySelector('[data-kaipu-run]') !== null,
      backBtn: document.querySelector('[data-kaipu-goshop]') !== null,
    }
  })()`)
  const ab = loop?.after ?? null
  const be = loop?.before ?? null
  say(loop?.btnHere === true, '★★ live 态：铺子资料页有「开始运行」按钮（[data-kaipu-shop-run]）')
  /**
   * ★★ 断的是「**字**对不对」，不是「整串长什么样」—— 101 补 2 给按钮加了 `▸` 前缀与暖金描边，
   *   若仍按整串比，改一次长得像样一点就要改判据（判据会退化成"记录当前长相"）。
   *   ⇒ 剥掉前置的非字母符号再比；「开始运行」四个字必须逐字在，
   *     图标/装饰**可有可无**都不影响这条 —— 但它**仍能失败**：把动词换成"发起"/"运行"照样红。
   */
  const labelCore = (loop?.btnLabel ?? '').replace(/^[^\p{L}]+/u, '').trim()
  say(
    labelCore === '开始运行',
    `★ 按钮用词与操作台那颗**同一个**（实读「${loop?.btnLabel ?? '（无）'}」⇒ 取字「${labelCore}」）`,
  )
  say(loop?.btnInRun === false, '★★ 入口长在运行视图**之外**（D-D3 同一条边界）')
  say(
    loop?.shopGone === true && loop?.runHere === true,
    '★★ 点一下 ⇒ 页签真的回到操作台（资料区不在 DOM + 运行视图在场）',
  )
  say(ab !== null && ab.visible === true, '★ 落点的发起区**在视野里**（[data-kaipu-start] 与滚动容器相交）')
  // ★ 居中判据：表单比容器还高时"居中"不成立 ⇒ 退一条"顶对齐"的路，两条都能量、也都可能红
  const centered = ab === null ? false : ab.taller === true ? ab.topGap <= 8 : ab.midGap <= ab.quarter
  say(
    centered,
    ab === null
      ? '★ 发起区落在容器中部（没读到发起区 ⇒ 不成立）'
      : ab.taller === true
        ? `★ 发起区比容器还高 ⇒ 走"顶对齐"那条路（上沿差 ${ab.topGap}px ≤ 8）`
        : `★ 发起区落在容器中部（中心差 ${ab.midGap}px ≤ 容器四分之一高 ${ab.quarter}px）`,
  )
  const moved = be !== null && ab !== null && be.hasBox === true && ab.hasBox === true && be.scrollTop !== ab.scrollTop
  say(moved, `★ 滚动位置**真的变了**（${be?.scrollTop ?? '?'} → ${ab?.scrollTop ?? '?'}px）—— 不是"发起了就算到了"`)
  console.log(
    `  · 证据力自检：改动前发起区可见=${String(be?.visible ?? '?')} / 与容器中心差 ${be?.midGap ?? '?'}px`
      + ` —— ${be?.visible === false ? '本来**不在**视野里 ⇒ 这一条有牙' : '本来就在视野里 ⇒ 这一条**证据力弱**，如实记在这里'}`,
  )
  say(loop?.backBtn === true, '★ 落点上就有回去的路（[data-kaipu-goshop]）—— 回路不是单程')
}
if (loopSrcBefore?.mock === '1') {
  await ev(`window.__kaipuProbe.toggleSource()`)
  await ev(`window.__kaipuProbe.waitSourceMock('1')`)
  const loopBack = await ev(`window.__kaipuProbe.readSource()`)
  say(loopBack?.mock === '1', '★ 切回演示态（不给截图与下一跑留一个 live 页面）')
}

/* ── ⒃ R2 术语对齐（097 · ADR 双向对齐六处）──
 *
 * 介绍六项能力 vs 界面六块，逐条对齐：
 *   场景目录→场景（介绍侧，客户端不动）、Agent目录→执行方（Agent目录）、
 *   运行视图→运行视图、角色位→角色位、能力边界→能力边界、会商面板→会商脉络。
 * ★ 不改变数据侧真值（role/lamp 值域不动），只界面文案；
 *   锚点值保持（执行方用 sectValue 解耦，探针零改 —— 见 LeftPane SectionTitle）。
 */
console.log('\n── ⒃ R2 术语对齐（六处逐条对应）──')
// ★ 先切回操作台，确保左栏（`[data-kaipu-left]`）在 DOM —— 前面页签段可能把视图切走
await ev(`(async () => {
  const t = document.querySelector('[data-kaipu-tab="console"]')
  if (t) { t.click(); await new Promise((r) => setTimeout(r, 400)) }
  return true
})()`)
const term = await ev(`(() => {
  const left = document.querySelector('[data-kaipu-left]')
  const sl = document.querySelector('[data-kaipu-seatlamp]')
  const proc = document.querySelector('[data-kaipu-process]')
  const run = document.querySelector('[data-kaipu-run]')
  const agentsBlock = document.querySelector('[data-kaipu-block="agents"]')
  const emptyEl = agentsBlock ? agentsBlock.querySelector('[data-kaipu-agent-empty]') : null
  return {
    // ★ leftText 用 textContent（非 innerText）：section 标题有 CSS text-transform:uppercase，
    //   innerText 会把源码「Agent」渲染成大写「AGENT」⇒ 与源码文案断言对不上（假红）。
    //   textContent 返回作者态原文，断言只认源码文案，不被呈现层 CSS 改写。
    leftText: left === null ? '' : (left.textContent || '').replace(/\\s+/g, ' ').trim(),
    seatText: sl === null ? '' : (sl.textContent || '').replace(/\\s+/g, ' ').trim(),
    procText: proc === null ? '' : (proc.textContent || '').replace(/\\s+/g, ' ').trim(),
    runText: run === null ? '' : (run.textContent || '').replace(/\\s+/g, ' ').trim(),
    // ★ 运行视图块在场（界面对应「介绍·运行视图」的**结构物**，ADR 裁决「不动」：
    //   界面不给「运行视图」字面标题，对应靠锚点 data-kaipu-run，不靠文案）。
    runExists: run !== null,
    // ★ 古茶第5处：执行方块不空白 —— 有 Agent 卡片 或 明确「待接入」占位
    agentsHasCard: agentsBlock !== null && agentsBlock.querySelector('[data-kaipu-agent]') !== null,
    agentsHasEmpty: emptyEl !== null && (emptyEl.innerText || '').includes('待接入'),
  }
})()`)
say(term?.leftText?.includes('执行方（Agent 目录）') === true, '★ R2·D4：界面「执行方（Agent 目录）」对齐介绍「Agent 目录」')
say(term?.seatText?.includes('角色位') === true, '★ R2·D4：界面「角色位」对齐介绍「角色位」')
say(term?.seatText?.includes('能力边界') === true, '★ R2·D4：界面「能力边界」对齐介绍「能力边界」')
say(term?.procText?.includes('会商脉络') === true, '★ R2·D4：界面「多 Agent 会商脉络」对齐介绍「会商脉络」（古茶拍：介绍侧一处「会商面板」→「会商脉络」）')
say(
  term?.leftText?.includes('场景') === true && term?.runExists === true,
  '★ 场景目录→场景 / 运行视图→运行视图 已对齐（左栏有「场景」块 · 运行视图块 [data-kaipu-run] 在场；ADR 裁决运行视图「不动」，对应靠锚点不靠字面标题）',
)
say(
  term?.agentsHasCard === true || term?.agentsHasEmpty === true,
  '★ 古茶第5处：执行方块不空白 —— 有 Agent 卡片 或 明确「待接入」占位（零接入也明示状态）',
)

/* ── 末尾全景截图（保留）＋ ★ 截图取证力自检 ──
 *
 * ★★ 最后这条断言看护的不是产品，是**判据自己**：
 *   本探针原来只在末尾截一张，那一张跨两轮四次跑 sha256 完全相同 ⇒ 零证据力。
 *   现在分了两张（演示 / 非演示），这条就断"两张**真的不一样**"。
 *   将来谁把截图挪回同一时刻，它**当场变红** —— 而不是静默退化成一张废图。
 *   「判据过期而不自知，比判据缺失更坏」，说的就是这种。
 */
if (SHOT !== undefined) {
  await shoot(SHOT)
}
if (shotBase !== undefined) {
  const demoDigest = shotDigests.get(`${shotBase}-demo.png`)
  const nonDemoDigest = shotDigests.get(`${shotBase}-nondemo.png`)
  say(
    typeof demoDigest === 'string' && typeof nonDemoDigest === 'string' && demoDigest !== nonDemoDigest,
    '★★ 两张取证截图**内容不同**（演示 '
      + `${(demoDigest ?? '(缺)').slice(0, 12)}… / 非演示 ${(nonDemoDigest ?? '(缺)').slice(0, 12)}…）`
      + '—— 截图这才当得了"状态变了"的证据（哈希相同 = 零证据力）',
  )
  console.log(`  · 全景图 sha256 ${(shotDigests.get(SHOT) ?? '(缺)').slice(0, 12)}…`)
}

console.log(`\n${failed === 0 ? '✓ 通过：契约 renderRules 逐条落在界面上' : `✗ ${failed} 项未过`}`)
ws.close()
process.exit(failed === 0 ? 0 : 1)
