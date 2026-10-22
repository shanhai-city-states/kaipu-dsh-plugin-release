#!/usr/bin/env node
/**
 * 山海·开铺 · 构建编排
 * =====================================================================
 * 一次跑完：契约层 → 各插件的 host half → 各插件的 client half → client bundle。
 *
 * 用法：node tools/build.mjs
 *
 * ── 顺序为什么不能乱 ──────────────────────────────────────────────
 *   1. **contract 必须最先**：插件的 tsconfig 用 `paths` 把 `@shanhai/kaipu-contract`
 *      指向 `../contract/lib/index.d.ts`（契约的**产物**）—— 没构建就解析不到。
 *      ★ 为什么是 `paths` 而不是 `references`：两包**刻意不把契约包写进 devDependencies**
 *        （它会破坏发布面的 `pnpm install`，见两包 package.json 的 `//contract`）⇒
 *        没有 node_modules 软链可解析 ⇒ 只能靠 `paths` 显式指。
 *      ★ 它要产出**两态**：`lib/`（ESM，给 host）+ `lib-cjs/`（CJS，给 client 内联）。
 *   2. **每个插件内：host 先、client 后**：两者 outDir 都是 `lib/`，
 *      tsbuildinfo 分开（`.tsbuildinfo.host` / `.tsbuildinfo.client`）；
 *      交错跑不会互相覆盖，但分开跑诊断更清楚。
 *   3. **build-client 最后**：它读 tsc 的产物（`lib/client/` 下的 .js）来组装。
 *
 * ── ★ 与 003 的差异 ──────────────────────────────────────────────
 *   003 的手顺是「改 src → tsc(两侧) → build-client」，且**极易漏跑 tsc**
 *   （症状：src 里 grep 不到、产物里却有 —— 打包器读 `lib/` 不读 `src/`）。
 *   这里把四步合成一条命令 ⇒ **漏跑不再可能**。
 *
 * tsc 从哪来：优先本仓 `node_modules/typescript`（pnpm/npm install 后即有）。
 * 可用环境变量 `KAI_TSC` 指定替代（例如复用一个已装好的 tsc）。
 * ★ 故意不写任何本机绝对路径兜底 —— `tools/clean-scan.mjs` 会 FAIL。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const NODE = process.execPath

/* ── tsc 定位 ── */
function findTsc() {
  const fromEnv = process.env['KAI_TSC']
  if (typeof fromEnv === 'string' && fromEnv !== '' && existsSync(fromEnv)) return fromEnv
  const local = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  if (existsSync(local)) return local
  console.error('✗ 找不到 tsc。')
  console.error('  ⇒ 先装依赖：')
  console.error('      unset NODE_OPTIONS   # ★ 本机 NODE_OPTIONS 注入的 shim 会让 pnpm 建软链静默失败')
  console.error('      && PATH="<pnpm10 bin>:$PATH" pnpm install')
  console.error('  ⇒ 或用 KAI_TSC=<path-to-tsc> 指定一个已装好的 tsc。')
  process.exit(2)
}

const TSC = findTsc()

/* ── 插件清单（从 workspaces 里认；顺序 = 契约在前、平台在前） ── */
const PLUGIN_DIRS = [
  'packages/plugin-platform',
  'packages/plugin-wisdom',
  // ★ 2026-10-10 加：083-C 期1 工位插件 —— 修双灯 P1-①「工位包未并入构建链」。
  //   它是上架包（publishConfig.access:public + repository→-release）⇒ 必须进构建/发布面。
  'packages/plugin-workstation',
]

/* ── ★ 版本号注入（2026-10-19 阿开：顶部要显示当前版本）──
   tsc 不会做宏替换 ⇒ 构建前把 package.json 的 version 写成一个 TS 常量，
   源码 import 它。这样「包里的版本」和「package.json」永远一致，不会挂旧号。 */
{
  const wsPkg = JSON.parse(readFileSync(join(HERE, '..', 'packages', 'plugin-workstation', 'package.json'), 'utf8'))
  const vFile = join(HERE, '..', 'packages', 'plugin-workstation', 'src', 'client', 'version.ts')
  writeFileSync(vFile, `/* 由 tools/build.mjs 生成 —— 勿手改 */\nexport const PLUGIN_VERSION = ${JSON.stringify(String(wsPkg.version))}\n`, 'utf8')
  // ★ 2026-10-21（B 案配套）：host 侧也需要版本号 —— 服务端要据它判断
  //   「这个客户端会不会保存 deviceSecret」。不传版本 = 旧客户端 = 不强制凭据
  //   （否则升级当天所有旧客户端会被自己的指纹拒绝，全挂）。
  const rvFile = join(HERE, '..', 'packages', 'plugin-workstation', 'src', 'remote', 'version.ts')
  writeFileSync(rvFile, `/* 由 tools/build.mjs 生成 —— 勿手改 */\nexport const PLUGIN_VERSION = ${JSON.stringify(String(wsPkg.version))}\n`, 'utf8')
}

const results = []

function run(label, cmd, args, cwd) {
  const started = Date.now()
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '' } })
  const ms = Date.now() - started
  const ok = r.status === 0
  results.push({ label, ok, ms })
  if (!ok) {
    console.error(`\n✗ ${label} 失败（exit ${r.status}）`)
    process.exit(1)
  }
  return ms
}

/* ── ① 契约层 ── */
console.log('\n── ① 契约层 ──')
run('contract / tsc -b (ESM→lib)', NODE, [TSC, '-b', 'packages/contract/tsconfig.json'], ROOT)
// ★ 契约的**第二态**：CJS，给 client bundle 内联用。
//   为什么必须有：client 侧产物是 CommonJS（宿主 closure 是 lazy CJS 表），
//   把 ESM 的 `export` 内联进去 = 浏览器 SyntaxError = **整站不渲染**
//   （2026-10-05 实测踩过，症状是 "import failed" 而构建是绿的）。
run('contract / tsc -b (CJS→lib-cjs)', NODE, [TSC, '-b', 'packages/contract/tsconfig.cjs.json'], ROOT)

/* ── ② 各插件 ── */
for (const dir of PLUGIN_DIRS) {
  const pkgPath = join(ROOT, dir, 'package.json')
  if (!existsSync(pkgPath)) {
    console.error(`✗ 缺少 ${dir}/package.json`)
    process.exit(1)
  }
  const name = JSON.parse(readFileSync(pkgPath, 'utf8')).name
  console.log(`\n── ② ${name} ──`)
  run(`${name} / tsc host`, NODE, [TSC, '-b', 'tsconfig.json'], join(ROOT, dir))
  run(`${name} / tsc client`, NODE, [TSC, '-b', 'tsconfig.client.json'], join(ROOT, dir))
  run(`${name} / build-client`, NODE, [join(HERE, 'build-client.mjs'), dir], ROOT)
}

/* ── 汇总 ── */
console.log('\n══ 构建完成 ══')
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(38)} ${(r.ms / 1000).toFixed(1)}s`)
}
console.log('\n产物（DSH 从这里加载）：')
for (const dir of PLUGIN_DIRS) {
  const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'))
  const clientRel = pkg.exports?.['./client']
  console.log(`  ${pkg.name}`)
  console.log(`    host   → ${dir}/lib/index.js`)
  console.log(`    client → ${dir}/${typeof clientRel === 'string' ? clientRel : clientRel?.default}`)
}
