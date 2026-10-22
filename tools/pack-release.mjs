#!/usr/bin/env node
/**
 * 山海·开铺 · 发版打包（把 tarball 做成**投稿件里那几个资产名**）
 * =============================================================================
 * 为什么要有这个脚本：投稿件里写的是
 *     https://github.com/<owner>/<repo>/releases/latest/download/kaipu-platform.tgz
 * 这个 URL 要能用，**release 资产的 literally 文件名必须是 `kaipu-platform.tgz`**
 * —— 而 `pnpm pack` 默认产出的是 `shanhai-kaipu-platform-0.1.0.tgz`（带 scope 与版本号）。
 * 手改名是最容易出错的一步：改错一个字，市场给用户的安装命令就 404，
 * 而**投稿件看起来完全正常**。所以资产名由 `market-entry.mjs` 的 SPECS 说了算，
 * 本脚本按它改名 —— 单一事实源，改不动。
 *
 * 用法：
 *   node tools/pack-release.mjs
 *   KAIPU_PNPM=<pnpm.cjs 的绝对路径> node tools/pack-release.mjs
 *   node tools/pack-release.mjs --print-gh     只打印 gh release 命令
 *
 * 之后（需已建公开仓库、且 `gh auth login` 过）：
 *   gh release create v0.1.0 dist/kaipu-platform.tgz dist/kaipu-wisdom-team.tgz
 * ★ 用 `latest/download/` 形态时，后续发版**保持资产名不变**（--clobber 覆盖上传），
 *   这样投稿件永远不用改；千万别把版本号塞进资产名。
 */
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPECS } from './market-entry.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT = join(ROOT, 'dist')
const ONLY_PRINT = process.argv.includes('--print-gh')
/** 本机 PATH 上没有 pnpm；给一个显式路径最稳（pnpm@10.18.3 实测最顺） */
const PNPM_CJS = process.env['KAIPU_PNPM'] ?? null

const assetsArg = () => SPECS.map((s) => `dist/${s.asset}`).join(' ')
const ghCreate = () => `gh release create v0.1.0 ${assetsArg()}`
const ghUpload = () => `gh release upload <新 tag> ${assetsArg()} --clobber`

if (ONLY_PRINT) {
  console.log('把这两个资产挂到一个 release 上（资产名不能改）：')
  console.log(`  ${ghCreate()}`)
  console.log('\n★ 之后每次发版用同一批资产名覆盖上传，投稿件永远不用改：')
  console.log(`  ${ghUpload()}`)
  process.exit(0)
}

/** ★ 本机 spawnSync 的 stdin 接 pipe 就 EBUSY ⇒ 一律忽略 stdin */
function packIn(cwd) {
  const before = new Set(readdirSync(OUT))
  const useNode = PNPM_CJS !== null
  const r = spawnSync(
    useNode ? process.execPath : 'pnpm',
    [...(useNode ? [PNPM_CJS] : []), 'pack', '--pack-destination', OUT],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: !useNode },
  )
  if (r.status !== 0) {
    const why = r.error === undefined ? `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(-400) : r.error.message
    throw new Error(why)
  }
  const fresh = readdirSync(OUT).filter((f) => !before.has(f) && f.endsWith('.tgz'))
  if (fresh.length !== 1) throw new Error(`期望恰好产出 1 个 tarball，实际 ${fresh.length} 个：${fresh.join(', ')}`)
  return fresh[0]
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

let failed = 0
for (const spec of SPECS) {
  try {
    const produced = packIn(join(ROOT, 'packages', spec.dir))
    renameSync(join(OUT, produced), join(OUT, spec.asset))
    console.log(`✓ ${produced}  →  ${spec.asset}`)
  } catch (err) {
    console.error(`✗ ${spec.dir} 打包失败：${err.message}`)
    if (/ENOENT/.test(err.message)) console.error('  ⇒ PATH 上没有 pnpm。用 KAIPU_PNPM=<pnpm.cjs 绝对路径> 重跑。')
    failed++
  }
}

if (failed > 0) { console.error(`\n✗ ${failed} 个包没打成功`); process.exit(1) }

console.log(`\n产物在 ${OUT}（资产名与投稿件里的 tarball URL **逐字一致**）`)
console.log('下一步（挂到 release；资产名别改）：')
console.log(`  ${ghCreate()}`)
