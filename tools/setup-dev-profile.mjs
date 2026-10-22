#!/usr/bin/env node
/**
 * 山海·开铺 · 开发环境一键就位（**薄封装**）
 * =====================================================================
 * ★ 保留这个文件只是为了**既有文档与命令继续可用**。
 *   真正的实现全在 `tools/plugin.mjs` —— 因为**插件状态只能有一个写入方**
 *   （见 plugin.mjs 头部：profile 的 bundles 与 node_modules 链接是同一份 state 的两个投影，
 *    各写一半必然不一致，而不一致的症状是"清单说有、界面没有"，不报错、只诡异）。
 *
 * 用法：
 *   node tools/setup-dev-profile.mjs               = bootstrap + sync（装全部内置插件）
 *   node tools/setup-dev-profile.mjs --drop=wisdom  = 把匹配到的插件**停用**（装卸判据用）
 *   node tools/setup-dev-profile.mjs --print        = 只打印启动命令（不落盘）
 *
 * 完整生命周期（装/卸/启/停/升/回滚）请直接用：
 *   node tools/plugin.mjs --help
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const NODE = process.execPath
const CLI = join(HERE, 'plugin.mjs')

const argv = process.argv.slice(2)
const DROP = (argv.find((a) => a.startsWith('--drop=')) ?? '').replace('--drop=', '')

const run = (args) => {
  const r = spawnSync(NODE, [CLI, ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '' } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// ① 先保证内置插件都已安装（幂等：已存在则保留用户的启停选择）
run(['bootstrap'])

// ② --drop：把匹配到的插件停用（**走真实 disable 路径**，不是从数组里删一行）
if (DROP !== '') {
  const listed = spawnSync(NODE, [CLI, 'list', '--json'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } })
  const ids = JSON.parse(listed.stdout).plugins.map((p) => p.id).filter((id) => id.includes(DROP))
  if (ids.length === 0) {
    console.error(`✗ --drop=${DROP} 没匹配到任何已安装插件`)
    process.exit(2)
  }
  for (const id of ids) run(['disable', id])
  console.log(`\n（--drop=${DROP} ⇒ 已停用：${ids.join(', ')}）`)
}

if (argv.includes('--print')) {
  const DSH_HOME = join(ROOT, 'dev', 'dsh-home')
  console.log(`\nDSH_HOME=${DSH_HOME}`)
  console.log('在 DSH 仓库根目录执行：')
  console.log(`  DSH_HOME="${DSH_HOME}" node --expose-internals --import tsx/esm apps/cli/src/bin.ts web --no-open --port 3090`)
}
