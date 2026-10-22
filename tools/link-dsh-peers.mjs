#!/usr/bin/env node
/**
 * 山海·开铺 · 开发环境：把**宿主 peer**链接进插件的 node_modules
 * =====================================================================
 * 为什么需要它（2026-10-05 实测踩到）：
 *   host half 要 `import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'`
 *   —— 这是**宿主提供的 peer**（发布形态下由 DSH 的 profile 包路由解析，见
 *   `app-boot/src/profile-resolution/resolver.ts`：「missing peers (cordis and friends)
 *   use the runtime resolution」）。
 *
 *   但**本仓不是 DSH monorepo**，`node_modules/@deepseek-ai/*` 不存在 ⇒
 *   TypeScript 能靠 `src/remote/dsh-typert.d.ts` 的最小声明过编译，
 *   **运行时却会 `ERR_MODULE_NOT_FOUND`** ⇒ 插件 `failed to import`（DSH 只给一句
 *   泛泛的 "failed to import"，不给原因 —— 所以这一步不做，症状极难定位）。
 *
 *   ★ 参考实现（003 的插件仓）也是这么做的：它的 node_modules/@deepseek-ai/* 全是
 *     指向 `deepseek-harness/vendor|cordis`、`packages/typert/protocol` 的**符号链接**。
 *
 * ★★ 这只影响**本地开发**：
 *   · `node_modules/` 在 .gitignore 内 ⇒ 不会进仓、不会影响"干净版"
 *   · 发布出去的包里**没有**这些链接；真机上由 DSH 自己解析 peer
 *   · 所以它是**开发便利**，不是运行依赖 —— 但**必须有**，否则本地跑不起来
 *
 * 用法：
 *   KAI_DSH_REPO=<DSH 仓库路径> node tools/link-dsh-peers.mjs
 *   node tools/link-dsh-peers.mjs --dsh=<DSH 仓库路径>
 *   node tools/link-dsh-peers.mjs --check            # 只检查（不写）
 */
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argDsh = (argv.find((a) => a.startsWith('--dsh=')) ?? '').replace('--dsh=', '')
// ★ 刻意**不给默认值**：写死本机路径会随包出门、换机器就断（本仓 clean-scan 明令禁止）。
const DSH = argDsh !== '' ? argDsh : (process.env['KAI_DSH_REPO'] ?? '')

const argv = process.argv.slice(2)
const CHECK_ONLY = argv.includes('--check')

/** 要把哪些宿主包链进来 —— 只列**我们真的 import 的**（窄优于全） */
const PEERS = ['dsh-typert-protocol']

if (DSH === '') {
  console.error('✗ 没给 DSH 仓库路径。用法：')
  console.error('    KAI_DSH_REPO=<DSH 仓库路径> node tools/link-dsh-peers.mjs')
  console.error('    node tools/link-dsh-peers.mjs --dsh=<DSH 仓库路径>')
  process.exit(1)
}
if (!existsSync(join(DSH, 'node_modules', '@deepseek-ai'))) {
  console.error(`✗ 在 ${DSH} 下找不到 node_modules/@deepseek-ai —— 用 KAI_DSH_REPO=<DSH 仓库路径> 指定`)
  process.exit(1)
}

let made = 0
let ok = 0
for (const pkg of readdirSync(join(ROOT, 'packages'))) {
  const dir = join(ROOT, 'packages', pkg)
  if (!statSync(dir).isDirectory()) continue
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) continue
  const peers = JSON.parse((await import('node:fs')).readFileSync(manifest, 'utf8')).peerDependencies ?? {}

  for (const peer of PEERS) {
    const full = `@deepseek-ai/${peer}`
    if (!(full in peers)) continue // 该包没声明，就不建

    const scope = join(dir, 'node_modules', '@deepseek-ai')
    const link = join(scope, peer)
    const target = join(DSH, 'node_modules', '@deepseek-ai', peer)
    const tag = `${pkg}/node_modules/${full}`

    if (!existsSync(target)) {
      console.error(`✗ ${tag}：目标不存在 ${target}`)
      continue
    }
    if (existsSync(link)) {
      const st = lstatSync(link)
      if (st.isSymbolicLink()) { console.log(`  = ${tag}（已是链接）`); ok++; continue }
      // 实体目录：**不覆盖**（不猜用户意图），报出来让人处理
      console.error(`  ! ${tag} 是实体目录，未动。要重建请先自行删除。`)
      continue
    }
    if (CHECK_ONLY) { console.error(`  ✗ ${tag} 缺失（--check 不写）`); continue }
    mkdirSync(scope, { recursive: true })
    // Windows 上 junction 不需要管理员权限（与 setup-dev-profile 同款做法）
    symlinkSync(target, link, 'junction')
    console.log(`  + ${tag} → ${target}`)
    made++
  }
}

console.log(`\n${CHECK_ONLY ? '（只检查）' : ''}新建 ${made} 个 · 已存在 ${ok} 个`)
console.log('★ node_modules/ 在 .gitignore 内 —— 这一步不影响仓库干净度，但它**是本机可见的**：')
console.log('  换机器（或删了 node_modules）后需要重跑。')
process.exit(0)
