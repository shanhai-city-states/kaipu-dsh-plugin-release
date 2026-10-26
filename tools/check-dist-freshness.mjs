#!/usr/bin/env node
/**
 * check-dist-freshness.mjs — 「**待上架的产物**」是否与仓内产物同源
 * =====================================================================
 * ★★ 为什么要有这条判据（2026-10-08 实测踩到）：
 *   `dist/*.tgz` 是**市场安装用的资产**（`market/*.yml` 的 `tarball:` 直指
 *   `<repo>/releases/latest/download/<asset>`，资产名由 `market-entry.mjs` 的 SPECS 定）。
 *   而 `dist/` 是 **.gitignore 的本地产物** ⇒ **没人看、没人管、也没判据看护**。
 *   实测：本仓 `dist/` 停留在 **10-05**（包内 `lib/client.js` 仅 9,659 B），
 *   而仓内产物已到 **10-08**（**342,486 B**）—— **差 35 倍**，
 *   即"如果有人直接把 `dist/` 里的资产传上去，用户装到的是**四天前的骨架版**"。
 *
 * ★ 为什么这个坑**特别值得一条判据**：
 *   · 它**不会报错**（拿旧包上传一切正常，市场条目看起来也对）；
 *   · 它**只在终端用户那边显形**（用户说"功能怎么没有"，而这边的判据全绿）；
 *   · 它与"改完 src 忘记重跑 tsc"**同族**（产物落后于源码），
 *     但那次是**构建链**问题（`build.mjs` 已合并步骤解决），这次是**打包链**问题。
 *
 * ★ 判据内容（逐件比对，不是抽查）：
 *   对 `dist/<asset>` 里的每个 `package/lib/**` 文件，与仓内 `packages/<dir>/lib/**` 比 sha256；
 *   任何一处不一致 / 仓内有而包内没有 ⇒ **FAIL**（提示跑 `node tools/pack-release.mjs`）。
 *
 * ★ 干净前态：`dist/` 不存在或没有 tgz ⇒ **跳过并退出 0**（同 `check-tools-syntax` 对 `dev/` 的处理：
 *   别人克隆的仓本来就没有本地产物 ⇒ 不该因此 FAIL）。
 *   ⚠️ 但"跳过"要**明说跳过**，不能静默 —— 否则读日志的人会以为它查过了。
 *
 * ★ 能失败（自证）：`--dist=<目录>` 可指向替代目录 ⇒ 造一个含过期包的目录即应 FAIL。
 *   自证命令见本仓 `dev/` 下的用法记录；`--self-test` 见下面。
 *
 * 用法：
 *   node tools/check-dist-freshness.mjs                 # 查 dist/
 *   node tools/check-dist-freshness.mjs --dist=<目录>    # 查指定目录（自证用）
 * 退出码：0 = 同源或跳过；1 = 有过期/不一致
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ★★ 为什么必须用 `spawn`（异步）而不是 `spawnSync`
 *   ---------------------------------------------------------------
 *   本机实测：**`spawnSync` 只要给子进程接任何管道就 EBUSY** —— 与代码无关，是这台机器的环境。
 *   症状极隐蔽：`status === null`、`stderr` 空 ⇒ 判据会把**每个文件**都误判成"读不出来"。
 *   （本仓 `MEMORY-ENGINEERING` 里记着这条；本轮第一次写这个脚本时就又踩了一次，
 *     症状是"两个资产都读不出来"，而它们其实是好的。）
 *   ⇒ 纪律：**工具脚本一律用 `spawn` + Promise**。
 */
const run = (cmd, args) =>
  new Promise((res) => {
    const p = spawn(cmd, args)
    const out = []
    const err = []
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => err.push(d))
    p.on('error', (e) => res({ code: -1, out: Buffer.alloc(0), err: Buffer.from(String(e.message)) }))
    p.on('close', (code) => res({ code, out: Buffer.concat(out), err: Buffer.concat(err) }))
  })

/* ── 资产 ↔ 源码目录的映射：单一事实源是 market-entry.mjs 的 SPECS（与 pack-release 同一份） ── */
let SPECS
try {
  ({ SPECS } = await import('./market-entry.mjs'))
} catch (e) {
  console.error(`✗ 读不到 market-entry.mjs 的 SPECS：${e.message}`)
  console.error('  ⇒ 本判据靠它拿「资产名 ↔ 包目录」的映射（不在本脚本里另抄一份，否则必然漂移）。')
  process.exit(1)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/**
 * ★★ 为什么 tar 一定要带 `--force-local`（2026-10-08 实测踩到）
 *   ---------------------------------------------------------------
 *   症状：`tar -tzf D:/…/kaipu-platform.tgz` ⇒
 *     `tar (child): Cannot connect to D: resolve failed`
 *   原因：GNU tar 把 `host:path` 当**远程语法** —— 而 Windows 盘符 `D:` 长得一模一样
 *     ⇒ 它以为要 ssh 到主机 `D`。**相对路径没这个问题**（所以手工验证时看着是好的）。
 *   ⇒ 修法：tar 调用一律加 `--force-local`（明确禁止远程解释）。两个调用点都加。
 *   ★ 与本仓"本机环境三条看着像故障"同族：**又一个"代码没错、是本机环境"的坑**。
 *   ★ 附带一条：本机 **bash 的临时目录 ≠ Node 的临时目录**
 *     （两者对 `/tmp` 的映射落点不同：一个在工作站用户目录下、一个在当前盘符根下）——
 *     用 `--dist=<临时目录>` 做自证时，Node 会去**另一个**目录找 ⇒
 *     **自证本身要先确认"判据看得见那个路径"**，否则会得到"跳过"而不是"报红"，
 *     于是把"没查"误读成"查过没问题"。
 */
/**
 * ★★ 但 `--force-local` 只有 **GNU tar** 认（2026-10-08 二次实测，同一台机器）
 *   ---------------------------------------------------------------
 *   本机 PATH 上的 `tar` 是 **bsdtar 3.8.8**（`C:\WINDOWS\system32\tar.exe`，Windows 自带），
 *   它对上面的 flag 直接报错：
 *     `tar.exe: Option --force-local is not supported`
 *   ⇒ 于是两个资产一律"读不出来（tar 失败）" ⇒ 判据红，**而资产其实是好的**。
 *   （GNU tar 在 Git for Windows 里；从 bash 跑和从 Node 跑，PATH 解析到的 tar 可能不是同一个
 *     —— 与上面 §bash/Node 临时目录那条同族：**同一个脚本，环境不同，判据行为不同**。）
 *   ⇒ 不猜是哪一个：**先探测这个 flag 认不认**，认就用，不认就不带。
 *     · GNU tar：带 `--force-local` ⇒ 不把 `D:` 当远程主机
 *     · bsdtar ：不带 ⇒ 它本来就不做远程解释，绝对路径照收
 */
const TAR_FLAGS = (await run('tar', ['--force-local', '--version'])).code === 0 ? ['--force-local'] : []
const tar = (args) => run('tar', [...TAR_FLAGS, ...args])

/** tar 是否可用（不可用则明说，不假装查过）*/
const tarProbe = await run('tar', ['--version'])
const TAR_OK = tarProbe.code === 0
if (!TAR_OK) {
  console.log('产物新鲜度自检 —— 「待上架的资产」是否与仓内产物同源')
  console.log(`  ⚠️ **跳过**：本机 \`tar\` 不可用（${tarProbe.err.toString().trim().slice(0, 80) || 'ENOENT'}）`)
  console.log('    ⇒ 无法解开 .tgz 比对。**这是「没查」，不是「查过没问题」。**')
  process.exit(0)
}

/** 列出 tar 内 `package/lib/**` 的文件名（相对 `package/`）*/
async function listLibInTgz(tgz) {
  const r = await tar(['-tzf', tgz])
  if (r.code !== 0) return null
  return r.out
    .toString('utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith('package/lib/') && !s.endsWith('/'))
    .map((s) => s.slice('package/'.length))
}

/** 取 tar 内某个文件的内容 */
async function readInTgz(tgz, inner) {
  const r = await tar(['-xzOf', tgz, `package/${inner}`])
  return r.code === 0 ? r.out : null
}

/**
 * ★ 从包内提取 `PLUGIN_VERSION = "x.y.z"` 的实际值
 * ------------------------------------------------------------------
 * 为什么不能只看 `dist/*.tgz` 的文件名或包内 package.json：
 *   两者都可能是人工改对的，而**真正跑在客户机器上的**是编译进
 *   `lib/client.js` / `lib/index.js` 的那个字符串常量。
 *   本判据就是为「package.json 已 0.2.112、代码里还是 0.2.111」这一型而设。
 * ⚠️ **不是每个包都有这个常量**（实测：platform / wisdom-team 没有，
 *   只有 workstation 有）⇒ 返回三态，`absent` 表示「本包不适用」，判据要跳过，
 *   不能当失败。用 null 表示失败会把两个正常的包误报成红的（本判据第一版就栽在这）。
 * 返回：{ state:'ok', ver } | { state:'absent' } | { state:'bad', why }
 */
async function PLUGIN_VERSION_inTgz(tgz) {
  const files = ['lib/client.js', 'lib/index.js']
  const found = new Set()
  let sawAnyFile = false
  for (const f of files) {
    const txt = await readInTgz(tgz, f)
    if (!txt) continue
    sawAnyFile = true
    /* ★ 只认「赋值给字面量」这一种；`PLUGIN_VERSION = void 0`（TS 降级占位）
       与 `import ... PLUGIN_VERSION` 都不计入 —— 见本判据第一版误报的教训。 */
    const re = /PLUGIN_VERSION\s*=\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/g
    let m
    while ((m = re.exec(txt)) !== null) found.add(m[1])
  }
  if (!sawAnyFile) return { state: 'bad', why: '包内 lib/client.js 与 lib/index.js 都读不出来' }
  if (found.size === 0) return { state: 'absent' }
  if (found.size > 1) return { state: 'bad', why: `包内出现多个版本值：${[...found].join(' / ')}` }
  return { state: 'ok', ver: [...found][0] }
}

/** 仓内某目录下 lib/** 的文件名（相对包目录）*/
function listLibInRepo(pkgDir) {
  const base = join(ROOT, 'packages', pkgDir, 'lib')
  if (!existsSync(base)) return null
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.push(p.slice(join(ROOT, 'packages', pkgDir).length + 1).replace(/\\/g, '/'))
    }
  }
  walk(base)
  return out
}

/**
 * ★★ 从包自己的 `files` 字段推出「**它打算打哪些文件**」
 *   ---------------------------------------------------------------
 *   为什么必须这么做（本判据第一版就是在这里报错的）：
 *   第一版拿"仓内 `lib/` 下的**全部**文件"当"应该进包的集合" ⇒ 于是报
 *     `仓内有、包内缺 50 件：lib/.tsbuildinfo.client, lib/client/*.js.map, …`
 *   —— 而 `package.json` 的 `files` 是（原文的 glob 形态见那个文件本身）：
 *     「`lib` 下的 `.js`」「`lib` 下的 `.d.ts`」「`cordis.patch.yml`」「`locale` 下的 `.json`」「`icon.svg`」
 *   ⇒ **`.tsbuildinfo.*` 与 `*.map` 本来就不该进包**。**是我的口径错了，不是包旧了。**
 *   ⇒ 纪律：**判"少了什么"之前，先问"它本来该有什么"** ——
 *     拿"全部"当"应有"是最容易犯的一类假红（同族：必失败的断言 / 恒真的断言）。
 *   ⚠️ 本段注释原先照抄了 glob 原文（含「星号 星号 斜杠」那串）⇒ **它本身就是块注释结束符**，
 *     当场把注释提前终止（`node --check` 抓到 `SyntaxError: Unexpected token '*'`）。
 *     ⇒ 本仓已知坑：**块注释里不要写 glob**（`check-tools-syntax.mjs` 的说明里点名过这一半，
 *       并如实写明"判据二不覆盖它、靠 `--check` 兜底"）。
 *
 * 实现：只取 `files` 里 `lib/` 开头、且以「通配 + 后缀」结尾的项，抽出后缀集合。
 *   本仓两种 `files` 形态抽出来是 → `['.d.ts', '.js']`（顺序无所谓）。
 */
function libSuffixesFromFiles(pkgDir) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(ROOT, 'packages', pkgDir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
  const files = Array.isArray(pkg.files) ? pkg.files : []
  const suffixes = []
  for (const f of files) {
    if (!f.startsWith('lib/')) continue
    const m = /(\*+)(\.[^/*]+)$/.exec(f)
    if (m !== null) suffixes.push(m[2])
  }
  return suffixes.length > 0 ? suffixes : null
}

const distArg = process.argv.find((a) => a.startsWith('--dist='))
const DIST = distArg === undefined ? join(ROOT, 'dist') : distArg.slice('--dist='.length)

console.log('产物新鲜度自检 —— 「待上架的资产」是否与仓内产物同源')

const tgzNames = existsSync(DIST)
  ? readdirSync(DIST).filter((f) => f.endsWith('.tgz'))
  : []

if (tgzNames.length === 0) {
  console.log(`  · ${DIST} 下没有 .tgz ⇒ **跳过**（本地产物目录；别人克隆的仓本来就没有）`)
  console.log('    ⚠️ 这是「跳过」，不是「查过没问题」—— 要查请先跑 node tools/pack-release.mjs')
  process.exit(0)
}

let failed = 0
const say = (ok, label) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) failed++
}

let checked = 0
for (const spec of SPECS) {
  const tgz = join(DIST, spec.asset)
  if (!existsSync(tgz)) {
    say(false, `${spec.asset} 不在 ${DIST}（SPECS 要求这个资产名 ⇒ 投稿件的 tarball 会 404）`)
    continue
  }
  const inTgz = await listLibInTgz(tgz)
  const inRepoAll = listLibInRepo(spec.dir)
  if (inTgz === null) {
    say(false, `${spec.asset} 读不出来（tar 失败）`)
    continue
  }
  if (inRepoAll === null) {
    say(false, `${spec.dir}/lib 不存在 ⇒ 先跑 node tools/build.mjs`)
    continue
  }

  // ★ 按包自己的 files 字段收紧"应有"集合（见 libSuffixesFromFiles 的注释：这是第一版假红的教训）
  const suffixes = libSuffixesFromFiles(spec.dir)
  if (suffixes === null) {
    say(false, `${spec.dir}/package.json 的 files 里推不出 lib/ 的文件形态 ⇒ 本判据口径不明，**拒绝给结论**`)
    continue
  }
  const inRepo = inRepoAll.filter((f) => suffixes.some((s) => f.endsWith(s)))

  const missing = inRepo.filter((f) => !inTgz.includes(f))
  const extra = inTgz.filter((f) => !inRepo.includes(f))

  /* ── ★★ 版本常量核验（2026-10-26 实测踩到，本判据原本抓不到）───────────────
     症状：客户装的是 0.2.112，插件却每次提示「v0.2.111 → v0.2.112 有更新」。
     根因：发版只改了 `package.json` 和 `data/plugin-version.json`，**没重跑 build.mjs**
           ⇒ `src/{client,remote}/version.ts` 仍是旧号 ⇒ 打进 dist 的
           `PLUGIN_VERSION` 是旧值 ⇒ 客户端**自报旧号**，服务端判「有更新」。
     ★ 为什么本脚本原来的判据抓不到：它比对的是「包内 lib/** ↔ 仓内 lib/**」，
       而**仓内 lib/ 自己就是旧的**（build 没重跑）⇒ 两边一致 ⇒ 全绿。
       「同源」不等于「正确」—— 两边一起错，判据看不出。
     ⇒ 所以必须另拿一个**独立的真值**来比：`packages/<dir>/package.json` 的 version。
       它与 `plugin-version.json` 是发版时人工同步的，是唯一不经过 build 的源头。 */
  const pkgJsonPath = join(ROOT, 'packages', spec.dir, 'package.json')
  let declaredVer = null
  try {
    declaredVer = String(JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version ?? '')
  } catch { /* 下面按「取不到」处理 */ }
  const vprobe = await PLUGIN_VERSION_inTgz(tgz)
  const verOk = vprobe.state === 'absent' || (vprobe.state === 'ok' && Boolean(declaredVer) && vprobe.ver === declaredVer)
  const verNote = vprobe.state === 'absent'
    ? `（本包无 PLUGIN_VERSION 常量，跳过版本比对）`
    : (vprobe.state === 'ok' && verOk ? ` · v${vprobe.ver}` : '')

  const diff = []
  for (const f of inRepo.filter((x) => inTgz.includes(x))) {
    const a = await readInTgz(tgz, f)
    const b = readFileSync(join(ROOT, 'packages', spec.dir, f))
    if (a === null || sha256(a) !== sha256(b)) diff.push(f)
  }

  const sizeIn = inTgz.includes('lib/client.js') ? ((await readInTgz(tgz, 'lib/client.js'))?.length ?? 0) : 0
  const sizeRepo = existsSync(join(ROOT, 'packages', spec.dir, 'lib', 'client.js'))
    ? readFileSync(join(ROOT, 'packages', spec.dir, 'lib', 'client.js')).length
    : 0

  const ok = missing.length === 0 && extra.length === 0 && diff.length === 0 && verOk
  say(
    ok,
    `${spec.asset} ↔ packages/${spec.dir}/lib`
      + `${ok ? ` 同源（${inTgz.length} 件 · client.js ${sizeIn} B${verNote}）` : ''}`
      + `${missing.length > 0 ? `\n      ✗ 仓内有、包内缺 ${missing.length} 件：${missing.slice(0, 4).join(', ')}` : ''}`
      + `${extra.length > 0 ? `\n      ✗ 包内有、仓内无 ${extra.length} 件：${extra.slice(0, 4).join(', ')}` : ''}`
      + `${diff.length > 0 ? `\n      ✗ 内容不一致 ${diff.length} 件：${diff.slice(0, 4).join(', ')}` : ''}`
      + `${!verOk ? `\n      ✗ **版本常量对不上**：包内 PLUGIN_VERSION=${vprobe.state === 'ok' ? vprobe.ver : (vprobe.why ?? '取不到')} ｜ packages/${spec.dir}/package.json=${declaredVer ?? '取不到'}`
          + `\n        ⇒ 客户装完后**自报旧号**，服务端每次判「有更新」，无限提示卸载重装。`
          + `\n        修：node tools/build.mjs（把 package.json 的 version 写进 src/*/version.ts）⇒ node tools/pack-release.mjs` : ''}`
      + `${!ok ? `\n      ⇒ 这个包是**旧的**。★ 拿它上架 = 用户装到旧版（且市场条目看起来完全正常）。\n        重打：node tools/pack-release.mjs` : ''}`
      + `${!ok && sizeIn !== sizeRepo ? `\n      · 体量对照：包内 client.js ${sizeIn} B ｜ 仓内 ${sizeRepo} B` : ''}`,
  )
  checked++
}

console.log(`\n  · 比对了 ${checked} 个资产（逐件 lib/**，不是抽查）`)
if (failed > 0) {
  console.log(`\n✗ ${failed} 个资产与仓内产物不同源`)
  process.exit(1)
}
console.log('\n✓ 全部同源')
