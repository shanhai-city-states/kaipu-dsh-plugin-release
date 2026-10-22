#!/usr/bin/env node
/**
 * 山海·开铺 · 插件生命周期（装 / 卸 / 启 / 停 / 升 / 回滚 / 清单 / 健康 / 同步）
 * =====================================================================
 * 这一个脚本是 **profile 与链接的唯一写入方**（single writer）。
 * 为什么必须唯一：插件状态有两个物理落点 ——
 *   ① `dsh.profile.bundles`（DSH 从哪加载）
 *   ② `node_modules/@scope/*`（名字解析到哪）
 * 两个落点由两个不同命令各改一半 ⇒ 迟早不一致，而不一致的症状是
 * 「清单说有、界面没有」或「名字解析到旧目录」——**都不报错，只行为诡异**。
 * ⇒ 所以：任何状态的改变都走 `sync`，`sync` 是**幂等**的（照 state 重算全部）。
 *
 * 用法：
 *   node tools/plugin.mjs list [--json]
 *   node tools/plugin.mjs bootstrap                    安装仓内「内置」插件（junction 链接）
 *   node tools/plugin.mjs install <dir> [--source=user|enterprise] [--enable]
 *   node tools/plugin.mjs enable  <id>
 *   node tools/plugin.mjs disable <id>
 *   node tools/plugin.mjs uninstall <id> [--purge-data]
 *   node tools/plugin.mjs upgrade <id> --to <dir>      ★ 自动留回滚点
 *   node tools/plugin.mjs rollback <id>
 *   node tools/plugin.mjs health [--json]
 *   node tools/plugin.mjs sync                          依据 state 重算 bundles + 链接（幂等）
 *
 * 环境：
 *   KAI_DSH_VERSION   当前 DSH 版本（默认 0.2.0-rc.2，对齐 083 基线）—— 用于 dshRange 校验
 *
 * ── 设计取舍（都写在对应函数旁，这里总述）────────────────────────────
 *   · **state 是唯一事实源**：`dev/dsh-home/plugins.state.json`。
 *     profile 与 node_modules 都是它的**投影**（可随时重算）。
 *   · **数据与代码分开**：卸载默认只删代码，`plugins-data/<id>/` 保留（AC-C03）。
 *   · **来源三分**（004 §A1）：`builtin` 用 junction 指向仓内包（改代码即时生效）；
 *     `user` / `enterprise` 是**拷贝**（真实的分发形态）。
 *   · **升级必留回滚点**：换包前把旧目录挪到 `_backup/<id>/<version>/`（AC-C07）。
 */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, rmdirSync, unlinkSync,
  readdirSync, statSync, lstatSync, symlinkSync, cpSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const DEV = process.env['KAI_DEV_DIR'] ?? join(ROOT, 'dev')
const DSH_HOME = join(DEV, 'dsh-home')
const PROFILE = join(DSH_HOME, 'profiles', 'web')
const NM_SCOPE = join(PROFILE, 'node_modules', '@shanhai')
const PLUGINS_DIR = join(DSH_HOME, 'plugins')
const DATA_DIR = join(DSH_HOME, 'plugins-data')
const BACKUP_DIR = join(DSH_HOME, 'plugins-backup')
const STATE_PATH = join(DSH_HOME, 'plugins.state.json')

/** 当前 DSH 版本（用于 kaipu.dshRange 校验 —— 本仓自查，非官方闸门） */
const DSH_VERSION = process.env['KAI_DSH_VERSION'] ?? '0.2.0-rc.2'
/** DSH 自带 bundle（由 DSH 自己解析，不进 profile 的 dependencies） */
const HOST_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

const argv = process.argv.slice(2)
const cmd = argv[0]
const rest = argv.slice(1).filter((a) => !a.startsWith('--'))
const flag = (n) => {
  const h = argv.find((a) => a.startsWith(`--${n}=`))
  return h === undefined ? undefined : h.slice(n.length + 3)
}
const has = (n) => argv.includes(`--${n}`)
const AS_JSON = has('json')

/* ═══════════════════════ 极简 semver（零依赖） ═══════════════════════ */

/**
 * 只支持我们实际会声明的形态：`^x.y.z` / `~x.y.z` / `>=x.y.z` / `<x.y.z` / `x.y.z` / `*`，
 * 多个用空格连接（AND）。
 * ★ 为什么自己写而不是装 semver：本仓的规矩是"能不带依赖就不带"（少一处版本坑，
 *   也少一处 clean-scan 风险）。而我们只用得到这一小撮语法。
 * ★ 预发布版本（`0.2.0-rc.2`）按 semver 语义：**比较时预发布 < 正式**，
 *   且 `>=0.2.0-rc.2` 应接受 `0.2.0-rc.2` 本身。
 */
/**
 * 解析版本号。★ 必须容忍**不完整**写法：`1` / `1.0` 都要能解析 ——
 * 人在 `package.json` 里写范围时天然会写 `>=1.0`，而第一次实现只认 `x.y.z`，
 * 结果 `parseVer` 返回 null 直接 TypeError 崩在 `cmp` 里（已踩）。
 * 缺的段补 0（与 npm semver 的宽松行为一致）。
 */
function parseVer(v) {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(String(v))
  if (m === null) return null
  return { major: +m[1], minor: +(m[2] ?? 0), patch: +(m[3] ?? 0), pre: m[4] ?? null }
}

function cmp(a, b) {
  // ★ 兜底：解析不出来就当"不满足"，绝不抛 —— 一个写歪的版本号不该让整个 CLI 崩掉，
  //   而应该变成一条可读的"兼容性不满足"提示。
  if (a === null || b === null) return 0
  for (const k of ['major', 'minor', 'patch']) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1
  }
  if (a.pre === null && b.pre === null) return 0
  if (a.pre === null) return 1 // 正式 > 预发布
  if (b.pre === null) return -1
  const as = a.pre.split('.')
  const bs = b.pre.split('.')
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i]
    const y = bs[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) { if (+x !== +y) return +x < +y ? -1 : 1; continue }
    if (xn !== yn) return xn ? -1 : 1 // 数字标识符优先级低于字母
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function satisfies(version, range) {
  const v = parseVer(version)
  if (v === null) return false
  const r = String(range).trim()
  if (r === '' || r === '*' || r === 'x') return true
  return r.split(/\s+/).every((part) => {
    let m
    /** ★ 拿比较基准；解析不出来 ⇒ **判为不满足**（而不是崩掉、也不是误判通过） */
    const base = (s) => parseVer(s)
    if ((m = /^>=(.+)$/.exec(part)) !== null) { const b = base(m[1]); return b !== null && cmp(v, b) >= 0 }
    if ((m = /^<=(.+)$/.exec(part)) !== null) { const b = base(m[1]); return b !== null && cmp(v, b) <= 0 }
    if ((m = /^>(.+)$/.exec(part)) !== null) { const b = base(m[1]); return b !== null && cmp(v, b) > 0 }
    if ((m = /^<(.+)$/.exec(part)) !== null) { const b = base(m[1]); return b !== null && cmp(v, b) < 0 }
    if ((m = /^\^(.+)$/.exec(part)) !== null) {
      const b = base(m[1])
      if (b === null || cmp(v, b) < 0) return false
      // ^x.y.z ⇒ 同 major（major>0）；major=0 ⇒ 同 minor
      return b.major > 0 ? v.major === b.major : (v.major === 0 && v.minor === b.minor)
    }
    if ((m = /^~(.+)$/.exec(part)) !== null) {
      const b = base(m[1])
      if (b === null) return false
      return cmp(v, b) >= 0 && v.major === b.major && v.minor === b.minor
    }
    const b = base(part)
    return b !== null && cmp(v, b) === 0
  })
}

/* ═══════════════════════ state（唯一事实源） ═══════════════════════ */

function loadState() {
  // ★ state 里只记**一条版本轴**（DSH 版本）—— 原先还记了 hostApiVersion，
  //   但那条轴是虚构的（客户端插槽 API 随 DSH 一起发版），已删除。
  if (!existsSync(STATE_PATH)) return { version: 1, dshVersion: DSH_VERSION, plugins: {} }
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'))
}
function saveState(s) {
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, `${JSON.stringify(s, null, 2)}\n`, 'utf8')
}

/* ═══════════════════════ 插件清单 / 健康 / 兼容 ═══════════════════════ */

/** 读一个包目录的「插件声明」；不是插件（没有 dsh.bundle）⇒ null */
function readManifest(dir) {
  const p = join(dir, 'package.json')
  if (!existsSync(p)) return null
  let pkg
  try { pkg = JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
  const bundle = pkg.dsh?.bundle
  if (bundle === undefined) return null
  const cExport = pkg.exports?.['./client']
  return {
    id: pkg.name,
    version: pkg.version,
    dir,
    patch: bundle.patch ?? null,
    client: typeof cExport === 'string' ? cExport : (cExport?.default ?? null),
    /** ★ DSH 读它判断"这个包有没有浏览器侧" —— 缺了就静默不加载（安静失败） */
    clientPlatform: pkg.dsh?.client?.platform ?? null,
    clientInject: Array.isArray(pkg.dsh?.client?.inject) ? pkg.dsh.client.inject : [],
    host: typeof pkg.main === 'string' ? pkg.main : './lib/index.js',
    // ★ 读 `kaipu.*`，不再读 `dsh.*`：DSH 官方**不读**这几个键（已逐条核实：
    //   DSH 只读 dsh.bundle / dsh.client / dsh.profile）。把它们放在 dsh 命名空间里
    //   会让人以为官方在读 —— 那正是市场目录维护者点名批评过的「看着有权威、其实没人读」。
    dshRange: pkg.kaipu?.dshRange ?? null,
    surfaces: Array.isArray(pkg.kaipu?.declaredSurfaces) ? pkg.kaipu.declaredSurfaces : [],
    peer: Object.keys(pkg.peerDependencies ?? {}),
    deps: Object.keys(pkg.dependencies ?? {}),
  }
}

/**
 * 健康 + 兼容检查。
 * ★ 顺序有意：**先兼容性、再完整性** —— 因为"版本不对"是**该拒绝**，
 *   "文件缺了"是**坏了**，两者给用户的话术不同（AC-C02 要"明确提示"）。
 */
function checkPlugin(m) {
  const problems = []
  const warnings = []

  // ① 兼容性（A3：先拒绝，再运行）
  //   ★ 这是【本仓自己的】闸门（读 kaipu.dshRange），**不是官方闸门**：
  //     官方闸门（evaluatePluginCompatibility）只认 peerDependencies 里名字为
  //     @deepseek-ai/dsh 或 @deepseek-ai/dsh-* 的项。我们目前不 import 任何 dsh-* 包
  //     ⇒ 官方闸门对我们**永远放行**。将来 Step 6 对接服务端会 import dsh-api-*，
  //     那时必须同步补 peer，官方闸门才真正生效。
  if (m.dshRange !== null && !satisfies(DSH_VERSION, m.dshRange)) {
    problems.push(`DSH 版本不满足：要求 ${m.dshRange}，当前 ${DSH_VERSION}`)
  }
  if (m.dshRange === null) warnings.push('未声明 kaipu.dshRange（无法做兼容性校验）')
  // ★ 已删掉 hostApiRange 这条轴：**不存在**独立于 DSH 的"宿主 API 版本"，
  //   客户端插槽 API 随 DSH 一起发版。留着它只会制造假拒绝。

  // ② 零外部依赖（能上市场的前提；见根 README §二·补 留意1）
  if (m.deps.length > 0) {
    problems.push(`声明了运行期 dependencies：${m.deps.join(', ')}（本仓要求零外部依赖）`)
  }

  // ③ 产物完整性
  if (!existsSync(join(m.dir, m.host))) problems.push(`缺 host 产物 ${m.host}`)
  const clientAbs = m.client === null ? null : join(m.dir, m.client)
  if (clientAbs === null) {
    problems.push('package.json 缺 exports["./client"]（DSH 靠它找浏览器 bundle）')
  } else if (!existsSync(clientAbs)) {
    problems.push(`缺 client bundle ${m.client}`)
  } else {
    const src = readFileSync(clientAbs, 'utf8')
    if (!src.includes('__ModuleLoader__.load(')) problems.push('client bundle 不是 closure-factory 形态')
    if (!src.includes(`id: ${JSON.stringify(m.id)}`)) problems.push('client bundle 的 id 与包名不一致')
    if (!src.includes('factory:')) problems.push('client bundle 缺 factory')
    // ★★ 有浏览器侧产物、却没声明 `dsh.client.platform` ⇒ DSH **不会加载它**，
    //    而且**不报错**（安静失败：装了、清单显示正常、界面上什么都没有）。
    //    这一类"安静失败"必须在**安装期**就拦掉 —— 靠人记是记不住的（我这个测试包自己就漏了）。
    if (m.clientPlatform !== 'web') {
      problems.push('有 exports["./client"] 但未声明 dsh.client.platform = "web"（DSH 会静默不加载浏览器侧）')
    }
    if (m.clientInject.length === 0) {
      problems.push('未声明 dsh.client.inject（缺模块图边 ⇒ 可能与宿主其他 UI 插件竞态）')
    }
  }
  if (m.patch === null) problems.push('package.json 缺 dsh.bundle.patch')
  else if (!existsSync(join(m.dir, m.patch))) problems.push(`缺 patch 文件 ${m.patch}`)

  return { ok: problems.length === 0, problems, warnings }
}

/* ═══════════════════════ 落盘/链接（投影） ═══════════════════════ */

/**
 * ★★ 删一个"可能是链接"的路径 —— **顺序是安全关键，不能颠倒**。
 *
 *   `rmSync(p, { recursive: true })` 若作用在 **junction** 上，
 *   在部分 Node/Windows 组合下会**跟进到目标目录**去删 —— 那是灾难性的
 *   （我们把 node_modules 链接指向仓内包，一旦跟进就是删源码）。
 *
 *   所以固定这个顺序：
 *     ① `unlinkSync` —— 对符号链接有效，**只删链接本身**
 *     ② `rmdirSync`  —— 对 junction 有效（**只摘链接，不碰目标**）；
 *                       对非空真目录会抛 ENOTEMPTY，自然落到 ③
 *     ③ `rmSync(recursive)` —— 到这里才确定是**我们自己拥有的真目录**，才敢递归删
 */
function unlinkPath(p) {
  if (!existsSync(p)) return
  try { unlinkSync(p); return } catch { /* 不是符号链接（或 Windows junction） */ }
  try { rmdirSync(p); return } catch { /* 非空目录 */ }
  rmSync(p, { recursive: true, force: true })
}

/** 插件短名（`@scope/name` → `name`），用作目录名 */
const shortOf = (id) => id.replace(/^@[^/]+\//, '')

/**
 * 「安装位置」—— ★ **由 (source, id) 唯一决定，不含版本号、不含源目录名**。
 *
 *   为什么不带版本/源目录名：第一版把安装目录取成 `plugins/<source>/<源目录名>`，
 *   于是 `upgrade --to probe-v2` 会**新开一个 probe-v2 目录**、旧目录留在原地 —
 *   症状是"卸载之后代码目录还在"（AC-C03 不过），根因是**安装位置不稳定**。
 *   改成稳定位置后：install / upgrade / rollback / uninstall 全都作用在同一个路径上，
 *   每一步都是"就地替换"，**不会留残留**。
 */
const installDir = (source, id) => join(PLUGINS_DIR, source, shortOf(id))

/**
 * 把包落到「安装位置」并返回该位置。
 *
 * ★ **内置不做拷贝、不删**：内置插件的「安装位置」**就是仓内包目录本身**
 *   （来源记在 state 里，清单照样看得见）。
 *   ⇒ ★★ 由此有一条**必须遵守的纪律**：**任何删除动作都要先判 `source !== 'builtin'`** ——
 *     否则 `uninstall` 会去删**仓里的源码目录**。见 `cmdUninstall`。
 *   （也曾想过在 `plugins/builtin/<name>` 放 junction 再让 node_modules 链过去，
 *     但 **junction 套 junction 在 Windows 上不稳**，弃。）
 *
 * ⚠️ **拷贝过滤必须按「相对 srcDir 的路径」判断，不能看绝对路径** ——
 *   这一条踩过：过滤函数原本直接测传入的绝对路径含不含 `dev`，
 *   而本仓的沙箱恰好就在 `dev/` 下 ⇒ **整棵树被过滤光**，
 *   拷出个空目录、`install` 却仍然成功退 0（最坏的一类：静默无效）。
 */
function copyTree(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter: (s) => {
      const rel = relative(from, s).replace(/\\/g, '/')
      if (rel === '') return true
      if (/(^|\/)(node_modules|dev)(\/|$)/.test(rel)) return false
      if (rel.endsWith('.tsbuildinfo')) return false
      return true
    },
  })
}

function materialize(id, source, srcDir) {
  if (source === 'builtin') return resolve(srcDir)
  const dst = installDir(source, id)
  mkdirSync(dirname(dst), { recursive: true })
  if (existsSync(dst)) unlinkPath(dst)
  copyTree(srcDir, dst)
  return dst
}

/** 把当前版本拷一份到回滚点。内置不备份（它的版本由仓内代码决定，回滚用 git）。 */
function backupPoint(p, version) {
  if (p.source === 'builtin') return null
  const point = join(BACKUP_DIR, shortOf(p.id), version)
  rmSync(point, { recursive: true, force: true })
  mkdirSync(point, { recursive: true })
  copyTree(p.path, point)
  return point
}

/**
 * ★ 幂等同步：照 state 重算 **profile 的 bundles** 与 **node_modules 链接**。
 *   两者都是 state 的投影 —— 所以任何状态变化后只要调它一次即可，
 *   不需要在每个命令里各写一遍（那是"两个落点各改一半"的根源）。
 */
function sync(state, quiet = false) {
  mkdirSync(NM_SCOPE, { recursive: true })
  mkdirSync(PROFILE, { recursive: true })

  const enabled = Object.values(state.plugins).filter((p) => p.enabled)

  // ① node_modules 链接：只保留 enabled 的（禁用的要**断开解析**，才叫真"停用"）
  for (const name of readdirSync(NM_SCOPE)) {
    const full = join(NM_SCOPE, name)
    const id = `@shanhai/${name}`
    if (!enabled.some((p) => p.id === id)) unlinkPath(full)
  }
  for (const p of enabled) {
    const link = join(NM_SCOPE, p.id.replace(/^@shanhai\//, ''))
    const current = existsSync(link) ? lstatSync(link) : null
    // 链接已指向正确目标就跳过（避免每次 sync 都重建，拖慢且易抖）
    if (current !== null && current.isSymbolicLink()) {
      try { if (readFileSync(join(link, 'package.json'), 'utf8') === readFileSync(join(p.path, 'package.json'), 'utf8')) continue } catch { /* 指向失效 ⇒ 重建 */ }
    }
    unlinkPath(link)
    symlinkSync(p.path, link, 'junction')
  }

  // ② profile package.json（bundles + 插件 dependencies）
  const profilePkgPath = join(PROFILE, 'package.json')
  const existing = existsSync(profilePkgPath) ? JSON.parse(readFileSync(profilePkgPath, 'utf8')) : {}
  const next = {
    ...existing,
    name: 'dsh-profile-web',
    private: true,
    dependencies: Object.fromEntries(enabled.map((p) => [p.id, `file:${p.path}`])),
    dsh: {
      ...(existing.dsh ?? {}),
      profile: { bundles: [...HOST_BUNDLES, ...enabled.map((p) => p.id)] },
    },
  }
  writeFileSync(profilePkgPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')

  // ③ cordis.yml（profile 根空表；树由 bundles 叠加）
  const cordisYml = join(PROFILE, 'cordis.yml')
  if (!existsSync(cordisYml)) {
    writeFileSync(cordisYml, '# 自动生成（tools/plugin.mjs）—— profile 根是空表。\n[]\n', 'utf8')
  }

  // ③b ★★ 本地联调覆盖（**只写在 dev 里，不进发布的包**）
  //
  // 为什么必须分开：
  //   · 包里的 `cordis.patch.yml` 是**随包发布**的 —— 若把联调地址写在那里，
  //     等对方撤掉联调面之后，**真实用户会去连一个死地址**。
  //   · 所以：**发布的包保持中性**（`baseUrl` 空 = 本地/未接入模式），
  //     联调地址只写在 dev profile 的覆盖层里（`dev/` 在 .gitignore 内）。
  //
  // ★ patch 语义（003 实测）：`id + config` 是**整段替换、不是合并**
  //   ⇒ 这里必须把全部配置键写全，否则被替换掉的那些开关会**静默消失**。
  //
  // 想改地址/铺子：设环境变量 `KAIPU_BASE_URL` / `KAIPU_ACCOUNT`；
  // 想验"未接入模式"：`KAIPU_DISCONNECT=1`（写空 baseUrl）。
  const disconnect = process.env['KAIPU_DISCONNECT'] === '1'
  const baseUrl = disconnect ? '' : (process.env['KAIPU_BASE_URL'] ?? 'https://agent.ak2029.com/kai-pu')
  const account = process.env['KAIPU_ACCOUNT'] ?? 'cli-trial'
  const devPatch = join(PROFILE, 'cordis.patch.yml')
  writeFileSync(
    devPatch,
    [
      '# ⚠️ 本文件由 tools/plugin.mjs 自动生成（本地联调覆盖层）· 在 .gitignore 内',
      '#',
      '# 为什么不把接入地址写进包里的 cordis.patch.yml：那份**随包发布**，',
      '# 而联调面是临时的 —— 写在包里 ⇒ 对方撤掉之后，真实用户会去连一个死地址。',
      '# ⇒ 发布的包保持中性（baseUrl 空 = 本地/未接入模式），联调地址只在这里。',
      '#',
      '# ★ patch 语义：`id + config` 是【整段替换，不是合并】⇒ 下面必须写全所有键。',
      '- id: shanhai-kaipu-platform',
      '  config:',
      '    scenesCatalog: true',
      '    runView: true',
      '    capabilityBoundary: true',
      '    roleSeats: true',
      `    baseUrl: '${baseUrl}'`,
      `    accountId: '${account}'`,
      "    clientVersion: '0.1.0'",
      '',
    ].join('\n'),
    'utf8',
  )

  // ③c ★ 可发现性：host half 需要**宿主的 peer** 才能加载（见 tools/link-dsh-peers.mjs）。
  //   缺了它的症状极难定位 —— DSH 只给一句泛泛的 "failed to import"，不给原因。
  //   ⇒ 在这里主动提示一句，把"不知道要做什么"变成"照着这行跑"。
  const peerLink = join(ROOT, 'packages', 'plugin-platform', 'node_modules', '@deepseek-ai', 'dsh-typert-protocol')
  if (!existsSync(peerLink)) {
    console.log('  ⚠ host half 缺宿主 peer 链接 —— 不建的话插件会静默加载失败（DSH 只说 failed to import）')
    console.log('    修：KAI_DSH_REPO=<DSH 仓库路径> node tools/link-dsh-peers.mjs')
  }


  if (!quiet) {
    console.log(`✓ sync 完成 · 启用 ${enabled.length} 个插件`)
    for (const p of enabled) console.log(`    ${p.id}@${p.version}  (${p.source})`)
    console.log(`    接入地址：${baseUrl === '' ? '（空 = 本地/未接入模式）' : baseUrl} · 铺子 ${account}`)
  }
}

/** 记录一个已安装插件到 state（同时建它的数据目录 —— 数据与代码分开） */
function putPlugin(state, info) {
  state.plugins[info.id] = { ...(state.plugins[info.id] ?? {}), ...info }
  mkdirSync(join(DATA_DIR, info.id.replace(/^@shanhai\//, '')), { recursive: true })
}

/* ═══════════════════════ 命令 ═══════════════════════ */

function cmdBootstrap() {
  const state = loadState()
  const pkgsDir = join(ROOT, 'packages')
  const found = []
  for (const name of readdirSync(pkgsDir)) {
    const dir = join(pkgsDir, name)
    if (!statSync(dir).isDirectory()) continue
    const m = readManifest(dir)
    if (m === null) continue // contract 不是插件
    found.push(m)
  }
  if (found.length === 0) { console.error('✗ packages/ 下没找到插件（缺 dsh.bundle）'); process.exit(1) }

  for (const m of found) {
    const chk = checkPlugin(m)
    if (!chk.ok) {
      console.error(`✗ ${m.id} 未通过检查，拒绝安装：`)
      for (const p of chk.problems) console.error(`    · ${p}`)
      process.exit(1)
    }
    const path = materialize(m.id, 'builtin', m.dir)
    const prev = state.plugins[m.id]
    putPlugin(state, {
      id: m.id, version: m.version, source: 'builtin', path,
      enabled: prev?.enabled ?? true, // ★ 已存在则**保留用户选择的启停状态**（幂等）
      dshRange: m.dshRange, surfaces: m.surfaces,
      installedAt: prev?.installedAt ?? new Date().toISOString(),
      previous: prev?.previous ?? null,
    })
  }
  saveState(state)
  console.log(`✓ bootstrap：安装 ${found.length} 个内置插件`)
  sync(state)
}

function cmdInstall(srcDir, source, enable) {
  const m = readManifest(srcDir)
  if (m === null) { console.error(`✗ ${srcDir} 不是插件（package.json 缺 dsh.bundle）`); process.exit(1) }
  const chk = checkPlugin(m)
  if (!chk.ok) {
    console.error(`✗ ${m.id} 未通过检查，拒绝安装（A3：先拒绝，再运行）：`)
    for (const p of chk.problems) console.error(`    · ${p}`)
    process.exit(1)
  }
  const state = loadState()
  const path = materialize(m.id, source, srcDir)
  putPlugin(state, {
    id: m.id, version: m.version, source, path,
    enabled: enable, dshRange: m.dshRange, surfaces: m.surfaces,
    installedAt: new Date().toISOString(), previous: state.plugins[m.id]?.previous ?? null,
  })
  saveState(state)
  console.log(`✓ install ${m.id}@${m.version} ← ${srcDir}（source=${source}${enable ? ' · 已启用' : ' · 未启用'}）`)
  sync(state)
}

function setEnabled(id, on) {
  const state = loadState()
  const p = state.plugins[id]
  if (p === undefined) { console.error(`✗ 没装过 ${id}（先 list 看看）`); process.exit(1) }
  if (on) {
    const m = readManifest(p.path)
    const chk = checkPlugin(m)
    if (!chk.ok) {
      console.error(`✗ ${id} 未通过检查，拒绝启用：`)
      for (const q of chk.problems) console.error(`    · ${q}`)
      process.exit(1)
    }
  }
  p.enabled = on
  saveState(state)
  console.log(`✓ ${on ? 'enable' : 'disable'} ${id}`)
  sync(state)
}

function cmdUninstall(id, purgeData) {
  const state = loadState()
  const p = state.plugins[id]
  if (p === undefined) { console.error(`✗ 没装过 ${id}`); process.exit(1) }
  p.enabled = false
  delete state.plugins[id]
  saveState(state)
  // ★★ 只有**非内置**才删代码目录。
  //   内置插件的 p.path 指向**仓内源码目录**（packages/plugin-*）——
  //   无条件 unlinkPath 会把源码删掉。这条不是"防御式编程"，是**必须**：
  //   项目生命周期里一定会有人对内置插件敲一次 uninstall。
  if (p.source === 'builtin') {
    console.log(`（${id} 是内置插件：只解除挂载，**不动仓内源码**）`)
  } else {
    unlinkPath(p.path)
  }
  rmSync(join(BACKUP_DIR, shortOf(id)), { recursive: true, force: true })
  const dataDir = join(DATA_DIR, shortOf(id))
  if (purgeData) {
    rmSync(dataDir, { recursive: true, force: true })
    console.log(`✓ uninstall ${id}（★ 已按 --purge-data 一并清除数据）`)
  } else {
    console.log(`✓ uninstall ${id}（代码已移除 · ★ 数据**保留**在 plugins-data/ —— AC-C03）`)
  }
  sync(state)
}

function cmdUpgrade(id, toDir) {
  const state = loadState()
  const p = state.plugins[id]
  if (p === undefined) { console.error(`✗ 没装过 ${id}`); process.exit(1) }
  if (p.source === 'builtin') {
    console.error(`✗ ${id} 是**内置**插件，不做文件级升级/回滚 ——`)
    console.error(`    它的版本由仓内代码（packages/…）决定，升级请走 git + node tools/build.mjs。`)
    process.exit(1)
  }
  const m = readManifest(toDir)
  if (m === null || m.id !== id) { console.error(`✗ ${toDir} 不是 ${id} 的包（读到 ${m?.id ?? '无'}）`); process.exit(1) }
  const chk = checkPlugin(m)
  if (!chk.ok) {
    console.error(`✗ ${id} 新版本未通过检查，拒绝升级：`)
    for (const q of chk.problems) console.error(`    · ${q}`)
    process.exit(1)
  }
  // ★ 留回滚点：把**当前安装位置**整体拷到 plugins-backup/<short>/<旧版本>/
  const oldVersion = p.version
  const point = backupPoint(p, oldVersion)

  // 安装位置是稳定的（installDir），所以**就地替换**，不留残留
  materialize(id, p.source, toDir)

  p.previous = { version: oldVersion, path: point }
  p.version = m.version
  p.dshRange = m.dshRange
  p.surfaces = m.surfaces
  p.enabled = true
  saveState(state)
  console.log(`✓ upgrade ${id} ${oldVersion} → ${m.version}（安装位置不变 · 就地替换）`)
  console.log(`    回滚点：${relative(ROOT, point)}`)
  sync(state)
}

function cmdRollback(id) {
  const state = loadState()
  const p = state.plugins[id]
  if (p === undefined) { console.error(`✗ 没装过 ${id}`); process.exit(1) }
  if (p.source === 'builtin') { console.error(`✗ ${id} 是内置插件，没有文件级回滚点（用 git）`); process.exit(1) }
  if (!p.previous) { console.error(`✗ ${id} 没有回滚点（只在 upgrade 之后才有）`); process.exit(1) }

  const curVersion = p.version
  // ★ 回滚本身也可回滚：先把当前版本存成一个新回滚点
  const newPoint = backupPoint(p, curVersion)

  const dst = installDir(p.source, id)
  unlinkPath(dst)
  copyTree(p.previous.path, dst)

  p.version = p.previous.version
  p.path = dst
  p.previous = { version: curVersion, path: newPoint }
  p.enabled = true
  saveState(state)
  console.log(`✓ rollback ${id} ${curVersion} → ${p.version}（就地还原）`)
  sync(state)
}

function cmdList(json) {
  const state = loadState()
  const rows = Object.values(state.plugins).map((p) => {
    const m = readManifest(p.path)
    const chk = m === null ? { ok: false, problems: ['包目录不可读'], warnings: [] } : checkPlugin(m)
    return {
      id: p.id, version: p.version, source: p.source, enabled: p.enabled,
      health: chk.ok ? 'ok' : 'broken', problems: chk.problems, warnings: chk.warnings,
      surfaces: p.surfaces ?? [], path: relative(ROOT, p.path),
      rollbackTo: p.previous ? p.previous.version : null,
    }
  })
  if (json) { console.log(JSON.stringify({ dshVersion: DSH_VERSION, plugins: rows }, null, 2)); return rows }
  console.log(`插件清单（DSH ${DSH_VERSION}）`)
  console.log('')
  console.log(`  ${'ID'.padEnd(32)}${'版本'.padEnd(9)}${'来源'.padEnd(11)}${'状态'.padEnd(7)}${'健康'.padEnd(8)}回滚到`)
  console.log(`  ${'─'.repeat(32)}${'─'.repeat(9)}${'─'.repeat(11)}${'─'.repeat(7)}${'─'.repeat(8)}${'─'.repeat(8)}`)
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(32)}${r.version.padEnd(9)}${r.source.padEnd(11)}${(r.enabled ? '启用' : '停用').padEnd(7)}${r.health.padEnd(8)}${r.rollbackTo ?? '—'}`)
  }
  const bad = rows.filter((r) => r.health !== 'ok')
  if (bad.length > 0) {
    console.log('')
    for (const r of bad) console.log(`  ✗ ${r.id}: ${r.problems.join(' / ')}`)
  }
  const warn = rows.flatMap((r) => r.warnings.map((w) => `${r.id}: ${w}`))
  if (warn.length > 0) {
    console.log('')
    for (const w of warn) console.log(`  ⚠ ${w}`)
  }
  return rows
}

/* ═══════════════════════ 入口 ═══════════════════════ */

switch (cmd) {
  case 'bootstrap': cmdBootstrap(); break
  case 'install': {
    const src = rest[0]
    if (src === undefined) { console.error('✗ install 需要一个目录参数'); process.exit(2) }
    cmdInstall(src, flag('source') ?? 'user', has('enable'))
    break
  }
  case 'enable': case 'disable': {
    const id = rest[0]
    if (id === undefined) { console.error(`✗ ${cmd} 需要一个插件 id`); process.exit(2) }
    setEnabled(id, cmd === 'enable')
    break
  }
  case 'uninstall': {
    const id = rest[0]
    if (id === undefined) { console.error('✗ uninstall 需要一个插件 id'); process.exit(2) }
    cmdUninstall(id, has('purge-data'))
    break
  }
  case 'upgrade': {
    const id = rest[0]
    const to = flag('to')
    if (id === undefined || to === undefined) { console.error('✗ upgrade <id> --to <dir>'); process.exit(2) }
    cmdUpgrade(id, to)
    break
  }
  case 'rollback': {
    const id = rest[0]
    if (id === undefined) { console.error('✗ rollback 需要一个插件 id'); process.exit(2) }
    cmdRollback(id)
    break
  }
  case 'list': cmdList(AS_JSON); break
  case 'health': {
    const rows = cmdList(AS_JSON)
    const bad = rows.filter((r) => r.health !== 'ok')
    process.exit(bad.length === 0 ? 0 : 1)
    break
  }
  case 'preflight': {
    /**
     * ★★ 启动前自检 + **坏插件熔断**（AC-C02 的**唯一可行缓解**）
     *
     *   背景（2026-10-04 实测，见 docs/evidence/step3-03 与 README §五）：
     *   **DSH 的 client 模块启动是「全或无」的** —— 任一个 bundle `import` 失败，
     *   整个 web shell 就不渲染（**真白屏**），而且没有任何插件级错误边界。
     *   实测现场：body 只有一行
     *     `Failed to load plugins … 1 entry did not activate … import failed`
     *   ⇒ 这是**上游限制**，不是我们的 bug（004 §A7 早就预警过「必须补错误边界」）。
     *   ⇒ 但「零宿主改动」是我们的硬纪律（插件要能独立分发）⇒ **不能去改 DSH 的 loader**。
     *   ⇒ 所以缓解只能落在**我们这层**：**在启动之前**把所有启用的插件查一遍，
     *     坏的**自动禁用**（熔断），让宿主至少能起来、其他插件照常。
     *
     *   与 `health` 的区别：`health` 只**报告**；`preflight` 是**启动前闸门**，
     *   带 `--auto-heal` 时会**动手处置**，并保证"处置后一定起得来"。
     */
    const state = loadState()
    const enabled = Object.values(state.plugins).filter((p) => p.enabled)
    const broken = []
    for (const p of enabled) {
      const m = readManifest(p.path)
      const chk = m === null ? { ok: false, problems: ['包目录不可读'] } : checkPlugin(m)
      if (!chk.ok) broken.push({ id: p.id, problems: chk.problems })
    }
    if (broken.length === 0) {
      console.log(`✓ preflight 通过：${enabled.length} 个启用插件全部健康`)
      process.exit(0)
    }
    console.error(`✗ preflight 发现 ${broken.length} 个**坏插件**：`)
    for (const b of broken) {
      console.error(`    ${b.id}`)
      for (const q of b.problems) console.error(`      · ${q}`)
    }
    if (!has('auto-heal')) {
      console.error('')
      console.error('⚠ **不要直接启动** —— DSH 的 client 模块是全或无的，')
      console.error('   带着坏插件启动会**整站白屏**（其他插件也会一起不可用）。')
      console.error('   ⇒ 加 `--auto-heal` 自动把坏的禁用掉再启动。')
      process.exit(1)
    }
    for (const b of broken) {
      state.plugins[b.id].enabled = false
      console.error(`    ⇒ 已自动禁用 ${b.id}（熔断）`)
    }
    saveState(state)
    sync(state)
    console.error('')
    console.error(`✓ auto-heal 完成：${broken.length} 个坏插件已禁用，宿主可以正常启动`)
    process.exit(0)
    break
  }
  case 'sync': sync(loadState()); break
  default:
    console.log(`山海·开铺 · 插件生命周期

  node tools/plugin.mjs list [--json]
  node tools/plugin.mjs bootstrap
  node tools/plugin.mjs install <dir> [--source=user|enterprise] [--enable]
  node tools/plugin.mjs enable|disable <id>
  node tools/plugin.mjs uninstall <id> [--purge-data]
  node tools/plugin.mjs upgrade <id> --to <dir>
  node tools/plugin.mjs rollback <id>
  node tools/plugin.mjs health [--json]
  node tools/plugin.mjs preflight [--auto-heal]      ★ 启动前闸门（坏插件熔断）
  node tools/plugin.mjs sync`)
    process.exit(cmd === undefined ? 0 : 2)
}
