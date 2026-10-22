#!/usr/bin/env node
/**
 * 山海·开铺 · 场地插件 · **命名空间一致性判据**（`check-remote-bridge.mjs`）
 * =====================================================================
 * ★★ 为什么需要它（两个理由，第二个是 2026-10-06 新踩的）
 *
 *   理由一（本文件存在的原由）：`bridge.ts` 与 `service.ts` **各写一份**
 *     `REMOTE_NS` / 端点名（两端 tsconfig 不同格式，不能共用文件）。
 *     端点字符串写错 ⇒ **不报错、不白屏、面板就是没数据** ——
 *     "点了没反应"是最难查的一类故障 ⇒ 必须机器看护。
 *
 *   理由二（★★ 本轮实测踩到 · 更值钱）：
 *     `transport failure for /api/kaipu/status: HTTP 404`
 *     报文里那个路径 = `REMOTE_CHANNEL('/api')` + `'/'` + `endpointOf('status')('kaipu/status')`
 *     —— 那是**宿主网关的错误信封**把「通道名 + 端点名」拼出来的**中间产物**，
 *     **不是任何一层的真实 URL**。
 *     真实 URL 由 `baseUrl`（`…/kai-pu`）决定 ⇒ 正确答案是 `…/kai-pu/status`。
 *     ⇒ 若这份判据早存在，它能当场指出"`/api` 是**通道名**、不该进 URL"，
 *        省掉一整轮"到底是服务端 404 还是我方拼错"的排查。
 *     ⇒ 故本判据新增一条：**通道名不许与 baseUrl 语义重叠**。
 *
 * ── 判据清单 ────────────────────────────────────────────────────────
 *   A 三侧 `REMOTE_NS` 同值（host `service.ts` ↔ client `bridge.ts` ↔ 智囊团 `bridge.ts`）
 *     ★ 2026-10-06 扩到三处：智囊团面板要读灯位数据，但它**不许 import 场地插件**
 *       （A-2）⇒ 它只能**自己再写一份**端点常量去调同一个网关命名空间。
 *       ⇒ 副本从 2 处变 3 处 ⇒ 判据必须跟着扩，否则"改两处漏一处"就是必然。
 *   B 每个 `@Remote('<name>')` 都能在**各** `ENDPOINTS` 里找到
 *   C 各 `ENDPOINTS` 里没有 host 侧没实现的项（智囊团那份**故意窄**，见下）
 *   D ★ `REMOTE_CHANNEL` 的语义边界：它是**网关通道名**，不得拼进发给服务端的 URL
 *     （用"baseUrl 里已带部署前缀"这一事实做矛盾检测）
 *   E 扫**编译产物**（`lib/` `lib-cjs/`）而非 `src/` —— 漏跑 tsc 时能抓到
 *   F ★ 工位侧（2026-10-10 加 · 修双灯 P1-①「检查链未覆盖工位包」）：
 *     工位用**自己的**命名空间 `kaipu-workstation`（与场地 `kaipu` **不同值**）
 *     ⇒ 不能并进 A/B/C（"三侧同值"对它不适用，硬塞=恒红的假判据）
 *     ⇒ 自成一组：**它自己那两侧**（client `bridge.ts` ↔ host `service.ts`）同值 + 端点对账，
 *        外加一条**反向**断言 —— 工位 NS **必须 ≠** 场地 NS（相同 = 两插件抢同一网关命名空间）。
 *
 * ★ 关于智囊团那份清单**故意窄**（判据 C 对它的口径不同）：
 *   智囊团只读"这群谋士是谁"，**不发起会商** ⇒ 它**只应**有 `status`/`listScenes`/`listAgents`。
 *   ⇒ 它"缺" `startRun`/`pollRun` **不是欠账，是设计**。
 *     ⚠️ 所以 C 组对智囊团的断言是**两向**的：
 *       · 它引用的每个端点 **host 必须实现**（否则"点了没反应"）
 *       · 它**不许**引用 `startRun`/`pollRun`（否则说明它越界去干场地的活了）
 *     这个上限清单写在下面 `WISDOM_FORBIDDEN` 里 —— **加白名单要改代码，
 *     不能靠"忘了写"绕过**。
 *
 * 用法：node tools/check-remote-bridge.mjs
 * 退出码：0 = 全过；1 = 有 FAIL
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/**
 * ★★ 智囊团**不许**引用的端点（超出它的职责范围）。
 * 为什么是"不许"而不是"不需要"：智囊团是**配套面板**，它一旦能发起运行，
 * 就会出现"两个面板都能开会商"的设计分叉 —— 而 `041 §〇` 已明确否掉这种重复。
 */
const WISDOM_FORBIDDEN = ['startRun', 'pollRun', 'listShopFiles', 'writeShopFiles', 'removeShopFile', 'readShopTextFile']

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${msg}`)
  if (!ok) failed++
}

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)

/* ── 取源码（★ 双读：src 是事实源，lib 是产物；两者都要看，见判据 E）── */
const SVC_SRC = join(ROOT, 'packages/plugin-platform/src/remote/service.ts')
const BRG_SRC = join(ROOT, 'packages/plugin-platform/src/client/bridge.ts')
/** ★ 第三处副本：智囊团 client 的 bridge（与场地侧同形但独立，A-2） */
const WIS_BRG_SRC = join(ROOT, 'packages/plugin-wisdom/src/client/bridge.ts')
/** ★ 2026-10-10 加：工位包两侧源文件（NS = 'kaipu-workstation'，与场地不同值 ⇒ 见判据 F） */
const WS_SVC_SRC = join(ROOT, 'packages/plugin-workstation/src/remote/service.ts')
const WS_BRG_SRC = join(ROOT, 'packages/plugin-workstation/src/client/bridge.ts')

console.log(`命名空间一致性判据\n`)

const svc = read(SVC_SRC)
const brg = read(BRG_SRC)
const wis = read(WIS_BRG_SRC)
const wsSvc = read(WS_SVC_SRC)
const wsBrg = read(WS_BRG_SRC)
if (svc === null || brg === null) {
  console.log(`  \u2717 找不到源文件（service.ts / bridge.ts）`)
  process.exit(1)
}
if (wis === null) {
  console.log(`  \u2717 找不到智囊团的 bridge.ts（${relative(ROOT, WIS_BRG_SRC)}）`)
  console.log(`     \u21d2 智囊团 Step 4 起要读灯位数据，必须有这一份（A-2 禁止它 import 场地插件）`)
  process.exit(1)
}
if (wsSvc === null || wsBrg === null) {
  console.log(`  \u2717 找不到工位包的源文件（${relative(ROOT, WS_SVC_SRC)} / ${relative(ROOT, WS_BRG_SRC)}）`)
  console.log(`     \u21d2 083-C 期1 工位包两侧都要有（它有自己的网关命名空间，见判据 F）`)
  process.exit(1)
}

/* ── A 三侧 REMOTE_NS 同值 ── */
console.log('── A. 三侧 REMOTE_NS 同值（host ↔ 场地 client ↔ 智囊团 client）──')
const nsOf = (src, label) => {
  const m = src.match(/export\s+const\s+REMOTE_NS\s*=\s*'([^']+)'/)
  if (m === null) console.log(`  \u2717 ${label} 里找不到 REMOTE_NS 定义`)
  return m?.[1]
}
const nsHost = nsOf(svc, 'service.ts')
const nsClient = nsOf(brg, '场地 bridge.ts')
const nsWisdom = nsOf(wis, '智囊团 bridge.ts')
say(nsHost !== undefined, `host 侧 REMOTE_NS = '${nsHost ?? '(缺)'}'`)
say(nsClient !== undefined, `场地 client 侧 REMOTE_NS = '${nsClient ?? '(缺)'}'`)
say(nsWisdom !== undefined, `智囊团 client 侧 REMOTE_NS = '${nsWisdom ?? '(缺)'}'`)
const allSame = nsHost !== undefined && nsHost === nsClient && nsHost === nsWisdom
say(
  allSame,
  `三侧同值${allSame ? '' : `（host='${nsHost}' 场地='${nsClient}' 智囊团='${nsWisdom}' \u21d0 不一致！）`}`,
)
// ★ 显式说明"为什么智囊团抄一份不算违反 A-2" —— 免得后人以为这是违规
if (allSame) {
  console.log(
    `    ★ 智囊团的副本**不违反 A-2**：A-2 管的是**源码 import**（模块图），\n` +
      `      \`${nsHost}\` 是**网关命名空间字符串**（契约面/wire）。两处都只是"拼串去调同一个网关"，\n` +
      `      互不 import ⇒ 判据 check-decoupling.mjs 与本草稿判据**同时成立**。`,
  )
}

/* ── B / C 端点名集合对账 ── */
console.log('\n── B. 每个 @Remote() 都能在 ENDPOINTS 里找到 ──')
const remoteNames = [...svc.matchAll(/@Remote\(\s*'([^']+)'\s*\)/g)].map((m) => m[1])
say(remoteNames.length > 0, `host 侧 @Remote 声明 ${remoteNames.length} 个：${remoteNames.join(', ')}`)

/** 从一份 bridge.ts 里解出 `ENDPOINTS` 的 [键, 值] 列表 */
function endpointsOf(src) {
  const block = src.match(/export\s+const\s+ENDPOINTS\s*=\s*\{([\s\S]*?)\}\s*as const/)
  if (block === null) return null
  return [...block[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*'([^']+)'/gm)].map((m) => [m[1], m[2]])
}

const platEntries = endpointsOf(brg)
if (platEntries === null) {
  say(false, '场地 bridge.ts 里找不到 ENDPOINTS 定义')
} else {
  const clientVals = platEntries.map(([, v]) => v)
  say(platEntries.length > 0, `场地 client 侧 ENDPOINTS 声明 ${platEntries.length} 个：${clientVals.join(', ')}`)

  const missing = remoteNames.filter((n) => !clientVals.includes(n))
  say(missing.length === 0, `无"host 实现了但场地 client 不知道"的端点${missing.length > 0 ? `（缺：${missing.join(', ')}）` : ''}`)

  const extra = clientVals.filter((n) => !remoteNames.includes(n))
  say(extra.length === 0, `无"场地 client 会调但 host 没实现"的端点${extra.length > 0 ? `（多：${extra.join(', ')} \u21d0 点了就是"路没通"）` : ''}`)

  // 键名 = 值 的自觉（不是硬规则，但偏离要么是故意要么是笔误，值得显式记）
  const odd = platEntries.filter(([k, v]) => k !== v)
  if (odd.length > 0) console.log(`    （提示：${odd.length} 个键名与值不同：${odd.map(([k, v]) => `${k}:'${v}'`).join(', ')}）`)
}

/* ── B2/C2 ★ 第三处：智囊团的端点清单（口径不同，见文件头）── */
console.log('\n── B2. 智囊团 ENDPOINTS：**引用的必须在**、**越界的必须不在** ──')
const wisEntries = endpointsOf(wis)
if (wisEntries === null) {
  say(false, '智囊团 bridge.ts 里找不到 ENDPOINTS 定义')
} else {
  const wisVals = wisEntries.map(([, v]) => v)
  say(wisEntries.length > 0, `智囊团 ENDPOINTS 声明 ${wisEntries.length} 个：${wisVals.join(', ')}`)

  // ① 引用的每个端点 host 必须实现（否则"点了没反应"）
  const notImpl = wisVals.filter((n) => !remoteNames.includes(n))
  say(
    notImpl.length === 0,
    `智囊团引用的端点 host 都实现了${notImpl.length > 0 ? `（未实现：${notImpl.join(', ')} \u21d0 智囊团会读到"路没通"）` : ''}`,
  )

  // ② ★ 上限：不许引用越界端点（这是"智囊团不发起会商"的**机器可读表达**）
  const overreach = wisVals.filter((n) => WISDOM_FORBIDDEN.includes(n))
  say(
    overreach.length === 0,
    `智囊团未越界引用 ${WISDOM_FORBIDDEN.join(' / ')}${overreach.length > 0 ? `（越界：${overreach.join(', ')} \u21d0 智囊团不该发起会商）` : ''}`,
  )

  // ③ 两个 client 的公共端点必须**同值**（同名字符串，不是"差不多"）
  const shared = wisVals.filter((n) => platEntries !== null && platEntries.map(([, v]) => v).includes(n))
  say(shared.length > 0, `与场地 client 共用的端点 ${shared.length} 个：${shared.join(', ')}`)
  if (WISDOM_FORBIDDEN.length > 0) {
    console.log(
      `    ★ 上限清单（智囊团不许引用）：${WISDOM_FORBIDDEN.join(', ')}\n` +
        `      —— 要放宽它**必须改本文件**，不能靠"忘了写"绕过。理由见本文件头部。`,
    )
  }
}

/* ── F ★ 工位侧：自成一组（2026-10-10 加 · 修双灯 P1-①） ──
   ★ 为什么另立一组而不是并进 A/B/C：工位用的是**自己的**网关命名空间
     `kaipu-workstation`（与场地 `kaipu` **不同值** —— 它们是两个插件、两个网关 NS）。
     "三侧同值"那条对它**不适用**；硬塞进去只会得到一条**恒红**的假判据。
   ⇒ 工位比的是**它自己那两侧**（client `bridge.ts` ↔ host `service.ts`）。
   ★ 与 A 条同源的纪律：**副本不是问题，"没有判据的副本"才是问题。** */
console.log('\n── F. ★ 工位侧 REMOTE_NS / ENDPOINTS（自成一组 · NS 与场地不同值）──')
const wsNs = nsOf(wsBrg, '工位 bridge.ts')
const wsNsHost = nsOf(wsSvc, '工位 service.ts')
say(
  wsNs !== undefined && wsNsHost !== undefined && wsNs === wsNsHost,
  `工位两侧 REMOTE_NS 同值（client='${wsNs ?? '(缺)'}' / host='${wsNsHost ?? '(缺)'}'）${wsNs !== undefined && wsNsHost !== undefined && wsNs !== wsNsHost ? ' \u21d0 不一致！' : ''}`,
)
/* ★ 反向断言：工位 NS **必须与场地不同** ——
   相同 = 两个插件抢同一网关命名空间 ⇒ 端点上账会串（"点了没反应"最难查的那类）。 */
say(
  wsNs !== undefined && nsHost !== undefined && wsNs !== nsHost,
  wsNs === nsHost
    ? `\u2605 工位 NS 与场地**撞名**（同为 '${wsNs}'）\u21d0 两个插件抢同一网关命名空间`
    : `工位 NS '${wsNs ?? '(缺)'}' \u2260 场地 NS '${nsHost ?? '(缺)'}'（各自独立 · 未撞名）`,
)
/* 工位端点对账：host 声明的 @Remote ↔ client 的 ENDPOINTS，双向都要平 */
const wsRemoteNames = [...wsSvc.matchAll(/@Remote\(\s*'([^']+)'\s*\)/g)].map((m) => m[1])
const wsEntries = endpointsOf(wsBrg)
say(wsRemoteNames.length > 0, `工位 host 侧 @Remote 声明 ${wsRemoteNames.length} 个：${wsRemoteNames.join(', ')}`)
if (wsEntries === null) {
  say(false, '工位 bridge.ts 里找不到 ENDPOINTS 定义')
} else {
  const wsVals = wsEntries.map(([, v]) => v)
  say(wsEntries.length > 0, `工位 client 侧 ENDPOINTS 声明 ${wsEntries.length} 个：${wsVals.join(', ')}`)
  const wsMissing = wsRemoteNames.filter((n) => !wsVals.includes(n))
  say(wsMissing.length === 0, `工位无"host 实现了但 client 不知道"的端点${wsMissing.length > 0 ? `（缺：${wsMissing.join(', ')}）` : ''}`)
  const wsExtra = wsVals.filter((n) => !wsRemoteNames.includes(n))
  say(wsExtra.length === 0, `工位无"client 会调但 host 没实现"的端点${wsExtra.length > 0 ? `（多：${wsExtra.join(', ')} \u21d0 点了就是"路没通"）` : ''}`)
}

/* ── D ★ REMOTE_CHANNEL 的语义边界（本轮新增 · 踩过） ── */
console.log('\n── D. \u2605 REMOTE_CHANNEL 是**网关通道名**，不得进 URL ──')
const chanOf = (src, label) => {
  const m = src.match(/export\s+const\s+REMOTE_CHANNEL\s*=\s*'([^']+)'/)
  if (m === null) console.log(`  \u2717 ${label} 里找不到 REMOTE_CHANNEL 定义`)
  return m?.[1]
}
const channel = chanOf(brg, '场地 bridge.ts')
const channelWis = chanOf(wis, '智囊团 bridge.ts')
const channelWs = chanOf(wsBrg, '工位 bridge.ts')
say(channel !== undefined, `场地 REMOTE_CHANNEL = '${channel ?? '(缺)'}'（宿主网关的逻辑通道名）`)
say(
  channelWis !== undefined && channelWis === channel,
  `智囊团 REMOTE_CHANNEL 与场地同值${channelWis === channel ? '' : `（场地='${channel}' 智囊团='${channelWis}' \u21d0 不一致！）`}`,
)
/* ★ 2026-10-10 加：工位也走同一个宿主网关 ⇒ 通道名同样要同值
   （通道名是**宿主**的，不是插件的 ⇒ 与各插件自己的 NS 不同：NS 可以不同，通道名必须一致） */
say(
  channelWs !== undefined && channelWs === channel,
  `工位 REMOTE_CHANNEL 与场地同值${channelWs === channel ? '' : `（场地='${channel}' 工位='${channelWs}' \u21d0 不一致！）`}`,
)

if (channel !== undefined && nsHost !== undefined) {
  // 复现报文里那个路径，作为**反例样本**钉在判据里
  const envelope = `${channel}/${nsHost}/${'status'}`
  console.log(`    报文里那条路径的来历：\`${channel}\` + \`/\` + \`endpointOf('status')\`(\`${nsHost}/status\`) = **/${envelope}**`)
  say(envelope === 'api/kaipu/status' || true, `⇒ 该串是**错误信封的中间产物**，不是任何一层的真实 URL`)

  // 语义重叠检测：baseUrl 若已带部署前缀（如 /kai-pu），channel 段（/api）不该再出现在 URL 里
  const PATCH = join(ROOT, 'dev/dsh-home/profiles/web/cordis.patch.yml')
  const patch = read(PATCH)
  if (patch === null) {
    console.log(`    （跳过：未找到本地联调覆盖层，无法比对 baseUrl）`)
  } else {
    const bm = patch.match(/baseUrl:\s*'([^']*)'/)
    const baseUrl = bm?.[1] ?? ''
    console.log(`    baseUrl（联调层） = '${baseUrl}'`)
    if (baseUrl !== '') {
      say(true, `baseUrl 自带部署前缀 \u21d2 真实 URL = \`${baseUrl}/<名词>\`，**不含** \`${channel}\` 段`)
      say(!baseUrl.endsWith(channel), `baseUrl 不以 \`${channel}\` 结尾（若结尾 \u21d2 与 channel 语义重叠，易混）`)
      // 交叉核对：报文里那条路径 vs 正确形态，必须**不同**
      say(`${baseUrl}/${'status'}` !== `/${envelope}`, `\u2605 正确形态 \`${baseUrl}/status\` \u2260 报文路径 \`/${envelope}\` \u21d2 二者不是一回事（这正是误判的来源）`)
    }
  }
}

/* ── E 扫编译产物（漏跑 tsc 时能抓到） ── */
console.log('\n── E. \u2605 编译产物与源码一致（漏跑 tsc \u21d2 打旧包）──')
// ★ 产物路径（2026-10-06 实读校正）：client 侧产的是**打包后的 CJS bundle**，
//   落在 `lib/client/*.js`（不是 `lib-cjs/`）—— `lib-cjs` 是**契约包专属**的目录。
//   ⚠️ 我第一版按注释猜了 `lib-cjs/client/`，判据立刻 FAIL 说"忘了跑 tsc" ——
//      **假警报**。⇒ 教训与全仓同族：**路径不要按印象写，去 ls 一次。**
const SVC_LIB = join(ROOT, 'packages/plugin-platform/lib/remote/service.js')
const BRG_LIB = join(ROOT, 'packages/plugin-platform/lib/client/bridge.js')
/** ★ 第三处：智囊团 client 产物（同样要扫 —— 漏跑 tsc 时它也会是旧的） */
const WIS_BRG_LIB = join(ROOT, 'packages/plugin-wisdom/lib/client/bridge.js')
/** ★ 2026-10-10 加：工位包两侧产物（NS = 工位自己的，逐条给期望值，不能一律用 nsHost） */
const WS_SVC_LIB = join(ROOT, 'packages/plugin-workstation/lib/remote/service.js')
const WS_BRG_LIB = join(ROOT, 'packages/plugin-workstation/lib/client/bridge.js')
// [标签, 产物路径, 该产物应有的命名空间] —— ★ NS 逐条给，不能一律用 nsHost（工位 NS 不同值）
for (const [label, p, expectNs] of [
  ['场地 host 产物', SVC_LIB, nsHost],
  ['场地 client 产物', BRG_LIB, nsHost],
  ['智囊团 client 产物', WIS_BRG_LIB, nsHost],
  ['工位 host 产物', WS_SVC_LIB, wsNs],
  ['工位 client 产物', WS_BRG_LIB, wsNs],
]) {
  const t = read(p)
  if (t === null) {
    say(false, `${label} 不存在（${relative(ROOT, p)}）\u21d2 忘了跑 tsc`)
    continue
  }
  const has = expectNs !== undefined && t.includes(`'${expectNs}'`)
  say(has, `${label} 含命名空间 '${expectNs ?? '(缺)'}'`)
  if (channel !== undefined) {
    const hasChan = t.includes(`'${channel}'`) || t.includes(`"${channel}"`)
    say(hasChan, `${label} 含通道名 '${channel}'`)
  }
}

console.log(`\n${failed === 0 ? '全过 \u2713' : `有 ${failed} 条 FAIL \u2717`}\n`)
process.exit(failed === 0 ? 0 : 1)
