#!/usr/bin/env node
/**
 * emit-release-snapshot.mjs — 按工坊 `053 §五` 白名单，把**发布面全集**复制成一个发布快照。
 *
 * ★ 为什么不能直接 `git push` 开发仓：
 *   开发仓有 124 件（含 `contracts/**` 5 · `tools/**` 34 · `docs/**` 17 · `market/**` 3 ·
 *   `apps/**` 1 等**排除面 38 件**），且含 16 个内部 commit message。
 *   直接推 = 把排除面与内部历史一起送上公开面 ⇒ **边界失守**。
 *
 * ★ 本脚本只做「复制 + 自检」，**不做任何 git 操作**（推仓由人确认后单独执行）。
 *
 * 用法：node tools/emit-release-snapshot.mjs <目标目录>
 *   目标目录**必须不存在或为空**（防误删）。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const DEST = process.argv[2]
if (!DEST) {
  console.error('用法：node tools/emit-release-snapshot.mjs <目标目录>')
  process.exit(2)
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })

/**
 * ★★ 发布面件数 —— 这是个**定案数**，不是随手写的期望值。
 *
 * 来历：`053 §五` 白名单初定 **50 件**；同一次裁定还定了一条更要紧的规矩 ——
 *   **「扫描面 = 发布面全集」**（即：凡是会上架的东西，都要进消毒扫描的面）。
 *
 * 2026-10-06 变更 **50 → 52**：新增铺子资料层两个**源文件**
 *   （`packages/plugin-platform/src/remote/shop-files.ts`
 *     `packages/plugin-platform/src/client/ShopShelf.tsx`）。
 *   按上面那条规矩，它们**自动进发布面** ⇒ 52 是**结论**，不是"为了让判据变绿改的数"。
 *
 * ★★ 2026-10-07 变更 **52 → 53**（本次跑快照时当场发现，不是预先改的）：
 *   多了 **1 件** = `packages/plugin-platform/src/client/Brand.tsx`
 *     · 来历：提交 `29b9c28`（宿主品牌位「山海 · 开铺 · 凉亭 · 场地」），对应文书
 *       `065-阿舟-施工记录-宿主品牌位与用法导航-2026-10-07.md`
 *     · 为什么进：它是 **client 模块**，被 `build-client.mjs` 打进 `lib/client.js`
 *       —— 而 `lib/client.js` **就是上架的产物**（DSH 从它加载）
 *       ⇒ 按项目自己那条「**扫描面 = 发布面全集**」，它**自动进发布面**。
 *     · 依据：**与 50→52 同一条规矩**，不是新裁定。
 *   ⚠️ 这件事上一轮（`065`）已经知道（文书里记了"发布面 +1 ⇒ G1 手写清单过期"），
 *     当时选择**不动已投递的 `docs/公开清单-G1-v1.md`**（"已投递件不悄悄改"，留给 v1.2 重算）。
 *     **但 `RELEASE_FILE_COUNT` 不是已投递清单，它是本脚本的期望值** ⇒ 过期了就该改，
 *     否则本脚本会一直报 `✗ 否（53）` —— **一个长期红的判据会被当成噪声，然后被忽略**。
 *
 * ★★ 2026-10-08 变更 **53 → 54**（本次跑快照时当场发现，不是预先改的）：
 *   多了 **1 件** = `packages/plugin-platform/src/client/SeatLampPanel.tsx`
 *     · 来历：`094`「夜话气质改版与五灯灯笼品牌对齐」那一批引入的**位/灯面板**源文件。
 *     · 为什么进：它是 **client 模块**，被 `build-client.mjs` 打进 `lib/client.js` ——
 *       而 `lib/client.js` **就是上架的产物** ⇒ 按「**扫描面 = 发布面全集**」**自动进面**。
 *     · 依据：**与 50→52、52→53 同一条规矩**，不是新裁定。
 *   ⚠️ 同一件被发现时，脚本正在报 `✗ 否（54）` —— 这正是上面那句"过期了就该改"的
 *     反面教材：**它已经红了一阵了**（v4 快照是 53 件，之后 `094` 加了这件）。
 *
 * ⚠️ 改这个数的时候必须同时说清：**多了/少了哪几件、依据哪条裁定**。
 *    只改数字不说理由 = 把判据改成恒真，那就白设了。
 *
 * ★★ 2026-10-10 变更 **54 → 72**（083-C 期1 工位并入发布面 · 双灯 P1-①）：
 *   多了 **18 件** = `packages/plugin-workstation/**`
 *     （`package.json` · `cordis.patch.yml` · `src/` 10 件 ·
 *      `locale/{en,zh}.json` · `icon.svg` · `README.md` ·
 *      `tsconfig.json` · `tsconfig.client.json`）。
 *     · 来历：083-C 期1「工位插件」落地（`baf2029`）；双灯审阅 P1-① 指出
 *       「工位包未并入构建 / 检查 / 发布三链 ⇒ 落 `-release` 不会带上它」。
 *     · 为什么进：它是**上架包**（`publishConfig.access:public` + `repository`
 *       指向 `-release`）⇒ 按「**扫描面 = 发布面全集**」**自动进发布面**。
 *     · 依据：**与 50→52 / 52→53 / 53→54 同一条规矩**，不是新裁定。
 *   ⚠️ 同批改了 `tools/build.mjs` 的 `PLUGIN_DIRS` + 相关 check 脚本覆盖工位包
 *     （一并修 P1-① 的「三链未并入」）。
 *
 * ★★ 2026-10-19 变更 **72 → 74**（083-C 期4 组织层 / 期5 任务层落地）：
 *   多了 **2 件** = `packages/plugin-workstation/src/remote/kai-pu-http.ts`
 *     ＋ `packages/plugin-workstation/src/client/WorkstationPanelIcon.tsx`
 *     · 来历：`255b425`（期4 组织层接入 · 工位从「看图」变成「能用」）
 *       ＋ `db6a212`（侧边栏图标位返还图标而非文字）。
 *     · 为什么进：两者都在 `packages/plugin-workstation/src/` 下，由
 *       `build-client.mjs` 打进 `lib/client.js` —— 而 `lib/client.js` 就是上架产物
 *       ⇒ 按「**扫描面 = 发布面全集**」**自动进面**。
 *     · 依据：**与 50→52 / 52→53 / 53→54 / 54→72 同一条规矩**，不是新裁定。
 *
 * ★★ 2026-10-21 变更 **74 → 77**（工位 0.2.53 发版前对账）：
 *   · 不是本次新增文件 —— 与 `efec36e`（0.2.36）树逐件比对，**新增 0 件**；
 *     与公开仓 0.2.52（`81ce4ba`）发布面逐件 `diff` 也**无新增/无删除**（77 件源码 + mcp/3 件）。
 *   · 原因：`WHITELIST` 里 `walk()` 是**动态**的，期间新增源文件自动进面，
 *     而常量只在 2026-10-19 那次手改成 74 —— 之后没同步 ⇒ 自检从那版起就是红的。
 *   · 依据：以**已发布面**为基准对账（同一把尺子量两次），不是把数字改成恒真；
 *     若将来真新增/删件，仍须逐件说明。
 * ★★ 2026-10-24 变更 **77 → 79**（083 两批：邀请码补发闭环 + 派活点名通知）：
 *   · 新增 2 件，都是**工位 client 源码**，都会被 `build-client.mjs` 打进 `lib/client.js`：
 *       `packages/plugin-workstation/src/client/join-copy.ts`   （083 第一批 · 邀请码补发闭环）
 *       `packages/plugin-workstation/src/client/notify-copy.ts` （083-r1 · 派活点名通知）
 *   · 为什么要把这两块拆成独立文件：把「判断」从「渲染」里分出来，判据才能**直接 import 产物**
 *     跑输入→输出（星月 R-6：对着源码 grep 关键词 = 逻辑必然 0 命中，那不是通过、是没测）。
 *     拆文件是「判据可执行」的前提，不是为了拆而拆。
 *   · 同时补一笔**漏账**：77 这个数从 0.2.81（`join-copy.ts` 加入）起实际已是 78，
 *     上一轮发版没跑本工具 ⇒ 自检红着也没人看见。现按实际件数对齐到 79。
 *   · 依据同前：按「**扫描面 = 发布面全集**」自动进面，不是为了让判据变绿改数字。

 * ★★ 2026-10-24 变更 **79 → 81**（083-r2 邀请码列表化 + 083-r3 派活绑定工位）：
 *   · 新增 2 件，同为**工位 client 源码**（都会被 `build-client.mjs` 打进 `lib/client.js`）：
 *       `packages/plugin-workstation/src/client/invite-code.ts` （083-r2 · 码列表/额度/明文留存判断）
 *       `packages/plugin-workstation/src/client/node-pick.ts`   （083-r3 · 工位图序号/姓名/三态口径）
 *   · 拆成独立文件的理由与上次相同：判断要能被判据 import 后喂输入看输出。
 *     083-r3 还多一层：缩小版工位图与工位页必须**共用同一组取数函数**（seq / holders[].name），
 *     两处各写一份必然慢慢跑偏 —— 而这一条正是阿开最在意的「不需要切换界面去核对」。
 *   · 依据同前：「扫描面 = 发布面全集」，自动进面，不是为了让判据变绿改数字。

 * ★★ 2026-10-24 变更 **81 → 82**（工位两项改造）：
 *   · 新增 1 件 `packages/plugin-workstation/src/client/grant-copy.ts`
 *     （临时代管授权码区的剩余天数/过期/整段复制话术；判据要喂输入看输出，故独立成文件）。
 *   · 依据同前：「扫描面 = 发布面全集」，自动进面，不是为了让判据变绿改数字。
 *
 * ★★ 2026-10-26 变更 **82 → 83**（工位三处可用性改造 · 阿开实报）：
 *   · 新增 1 件 `packages/plugin-workstation/src/client/seat-summary.ts`
 *     （席位数量总览：`countSeatTypes` / `seatSummary` / `seatBadge` / `resolveSeatKey`）。
 *     · 为什么进：它是 `WorkstationPanel.tsx` **import 的运行时依赖**，
 *       被 `build-client.mjs` 打进 `lib/client.js` —— 而 `lib/client.js` 就是上架的产物
 *       ⇒ 按「扫描面 = 发布面全集」**自动进面**。
 *     · 为什么独立成文件：判断要能被判据 import 后喂输入看输出。
 *       本轮 28 条判据里有 20 条是纯输入→输出（含未知席位不改名、occupants 多人去重、
 *       空列表空进空出）；写在 JSX 里就只能靠肉眼看截图，那种「验证」等于没验。
 *     · 实测：两次注入（改错 label / 破坏 unknown 保护）均真变红，还原后回绿。
 *   · 依据同前：**同一条规矩**，不是新裁定，也不是为了让判据变绿改数字。
 *   ⚠️ 本件是被脚本**当场报 `✗ 否（83）`** 才发现的 —— 与 52→53、53→54、81→82 同一情形：
 *     新增 client 模块 ⇒ 自动进面 ⇒ 期望值过期。**过期了就该改**，
 *     否则这个判据会长期红，然后被当成噪声忽略。
 */
const RELEASE_FILE_COUNT = 83


/** 工坊 `053 §五` 白名单（初定 50 件 · 现值见上 `RELEASE_FILE_COUNT` 的变更说明） */
const WHITELIST = [
  'package.json',
  'packages/plugin-platform/package.json',
  'packages/plugin-wisdom/package.json',
  'packages/plugin-workstation/package.json',
  'packages/plugin-platform/cordis.patch.yml',
  'packages/plugin-wisdom/cordis.patch.yml',
  'packages/plugin-workstation/cordis.patch.yml',
  ...walk('packages/plugin-platform/src'),
  ...walk('packages/plugin-wisdom/src'),
  ...walk('packages/plugin-workstation/src'),
  // ★ 2026-10-20：Agent 侧上传 CLI（补界面里「大文件请用 CLI」的空承诺）
  ...walk('packages/plugin-workstation/scripts'),
  'packages/plugin-platform/locale/en.json',
  'packages/plugin-platform/locale/zh.json',
  'packages/plugin-wisdom/locale/en.json',
  'packages/plugin-wisdom/locale/zh.json',
  'packages/plugin-workstation/locale/en.json',
  'packages/plugin-workstation/locale/zh.json',
  'packages/plugin-platform/icon.svg',
  'packages/plugin-wisdom/icon.svg',
  'packages/plugin-workstation/icon.svg',
  'packages/plugin-platform/README.md',
  'packages/plugin-wisdom/README.md',
  'packages/plugin-workstation/README.md',
  'packages/plugin-platform/tsconfig.json',
  'packages/plugin-platform/tsconfig.client.json',
  'packages/plugin-wisdom/tsconfig.json',
  'packages/plugin-wisdom/tsconfig.client.json',
  'packages/plugin-workstation/tsconfig.json',
  'packages/plugin-workstation/tsconfig.client.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'tsconfig.base.json',
  '.gitignore',
  '.gitattributes',
]

// ── 目标目录安全检查
if (existsSync(DEST)) {
  const entries = readdirSync(DEST)
  if (entries.length > 0) {
    console.error(`✗ 目标目录非空，拒绝写入（防误删）：${DEST}`)
    console.error(`  内含 ${entries.length} 项：${entries.slice(0, 8).join(', ')}${entries.length > 8 ? ' …' : ''}`)
    process.exit(2)
  }
} else {
  mkdirSync(DEST, { recursive: true })
}

// ── 复制
const missing = []
let copied = 0
for (const f of WHITELIST) {
  if (!existsSync(f)) {
    missing.push(f)
    continue
  }
  const out = join(DEST, f)
  mkdirSync(join(out, '..'), { recursive: true })
  cpSync(f, out)
  copied++
}

// ── 自检
const written = walk(DEST).map((p) => relative(DEST, p).replace(/\\/g, '/')).sort()
const FORBIDDEN = [
  { re: /^contracts\//, why: '契约全表（排除面）' },
  { re: /^packages\/contract\//, why: '契约包（排除面 · 不发市场）' },
  { re: /^tools\//, why: '判据库脚本（排除面）' },
  { re: /^docs\//, why: '内部文档（排除面）' },
  { re: /^market\//, why: '市场条目（排除面）' },
  { re: /^apps\//, why: '壳（排除面）' },
  { re: /\/(lib|lib-cjs|node_modules)\//, why: '构建产物 / 依赖（不入仓）' },
  { re: /^README\.md$/, why: '仓根 README（工坊另写对外版）' },
]
const violations = []
for (const f of written) {
  for (const r of FORBIDDEN) if (r.re.test(f)) violations.push(`${f}  ← ${r.why}`)
}

/**
 * ★★ 元数据自检：**发布面里的每个 `package.json` 都必须有非空 `license`**（2026-10-07 加）
 *
 * 起因（工坊 2026-10-07 落仓通知）：v3 快照的**根 `package.json` 未含 `license` 字段**，
 * 而公开仓里 `LICENSE` 文件在 ⇒ **元数据自相矛盾**（npm / 仓首页显示"无 license"）。
 *
 * ★★ 为什么这件事必须**做成判据**而不是"记住了"：
 *   工坊已在自己仓内补回该字段（`4a48d7b` 起就有）。而我方**每出一版快照都不带它**
 *   ⇒ **每投一次就把它冲掉一次**。这是**反复发生的回归**，不是一次性疏漏。
 *   靠"记得"必然会再犯 —— 而**一个能被反复触发的坑，就该由判据守着**。
 *
 * ★ 为什么补在**这里**（而不是 `check-market-ready.mjs`）：
 *   那个脚本只扫 `packages/plugin-platform` 与 `packages/plugin-wisdom` **两个上架包**
 *   —— **根 `package.json` 落在它的扫描面之外**。而本脚本恰好是「发布面」的守门人，
 *   这个坑的形态就是"发布面里有个 package.json 缺字段" ⇒ **判据该长在问题的位置上**。
 *
 * ★ 范围与理由**都从发布面自己推**（不另立清单）：
 *   只在 `written`（= 实际进包的件）里找 `package.json` ⇒ 发布面变了它就自动跟。
 *   ⚠️ **不要求** `packages/contract`：它是**排除面**（上面 FORBIDDEN 里就有它），
 *      `private` 且不上市场 ⇒ 按星月 `009 §一#2` 的语境（"投稿件"）**不适用**，
 *      该包刻意不写 license（理由写在该包 `package.json` 的 `//license` 里）。
 *      ⇒ 判据的范围 = **发布面**，与"扫描面 = 发布面全集"同源；**不扩大也不缩小**。
 */
const licenseProblems = []
for (const f of written) {
  if (!/(^|\/)package\.json$/.test(f)) continue
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(DEST, f), 'utf8'))
  } catch (e) {
    licenseProblems.push(`${f}  ← JSON 解析失败：${e.message}`)
    continue
  }
  if (typeof pkg.license !== 'string' || pkg.license.trim() === '') {
    licenseProblems.push(`${f}  ← 缺 license 字段（公开仓会显示"无 license"，且会冲掉对方已补的值）`)
  }
}
/** 抽取器自证：一条都找不到 ⇒ 上面那个循环什么都没查，判据退化成恒真 */
const licenseScanned = written.filter((f) => /(^|\/)package\.json$/.test(f))
if (licenseScanned.length === 0) {
  licenseProblems.push('★ 自证失败：发布面里一个 package.json 都没找到 —— 上面那条检查等于没跑（判据不许变成恒真）')
}

console.log(`目标：${DEST}`)
console.log(`白名单 ${WHITELIST.length} 项 ｜ 实际复制 ${copied} 件 ｜ 目录内 ${written.length} 件`)
if (missing.length) {
  console.log(`\n⚠ 白名单里缺失 ${missing.length} 项：`)
  for (const m of missing) console.log(`  - ${m}`)
}
if (violations.length) {
  console.log(`\n✗ 发现 ${violations.length} 处排除面泄漏：`)
  for (const v of violations) console.log(`  - ${v}`)
} else {
  console.log('\n✓ 无排除面泄漏')
}
if (licenseProblems.length) {
  console.log(`\n✗ 元数据：${licenseProblems.length} 处问题：`)
  for (const p of licenseProblems) console.log(`  - ${p}`)
} else {
  console.log(`\n✓ 元数据：发布面里 ${licenseScanned.length} 个 package.json 都有 license 字段`)
}
console.log(`\n★ 白名单是否恰好 ${String(RELEASE_FILE_COUNT)} 件：${WHITELIST.length === RELEASE_FILE_COUNT ? '✓ 是' : `✗ 否（${String(WHITELIST.length)}）`}`)

// 目录快照（供核对）
writeFileSync(join(DEST, '..', 'kaipu-release-files.txt'), written.join('\n') + '\n', 'utf8')
console.log(`清单已写：${join(DEST, '..', 'kaipu-release-files.txt')}`)

process.exit(
  violations.length || missing.length || licenseProblems.length
    || WHITELIST.length !== RELEASE_FILE_COUNT ? 1 : 0,
)
