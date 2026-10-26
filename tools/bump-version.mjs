#!/usr/bin/env node
/**
 * bump-version.mjs —— 一次改全发版三处版本号
 *
 * ★ 为什么需要这个脚本（2026-10-26 阿开实测踩到）：
 *   0.2.97 的包早就打进发布仓了，但 `data/plugin-version.json` 还停在 0.2.92
 *   ⇒ 客户在 DSH 里点升级，拿到的还是两个版本前的包，观感是"发了但没生效"。
 *
 *   版本号散在三处，各自手改必漏：
 *     ① package.json                          （根，构建脚本读）
 *     ② packages/plugin-workstation/package.json （插件本体，包里读）
 *     ③ <kai-pu>/data/plugin-version.json      （服务端 latest，客户升级时读）
 *
 * 用法：
 *   node tools/bump-version.mjs 0.2.98
 *   node tools/bump-version.mjs 0.2.98 --notes "① … ② …"
 *   node tools/bump-version.mjs --check        # 只核三处是否一致，不一致退出码 1
 *
 * ★ 纪律：改完必须打印三处读回值，不许只说"改了"。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** ③ 服务端版本文件：默认生产路径，可用 KAI_PU_DATA_DIR 覆盖（测试用） */
const SERVER_PLUGIN_VERSION =
  process.env.KAI_PU_PLUGIN_VERSION_FILE ??
  '/opt/shanhai-toolkit-opensource/modules/08-workshop/kai-pu/data/plugin-version.json'

const TARGETS = [
  { name: '根 package.json', path: resolve(REPO, 'package.json'), kind: 'npm' },
  {
    name: 'plugin-workstation/package.json',
    path: resolve(REPO, 'packages/plugin-workstation/package.json'),
    kind: 'npm',
  },
  { name: '服务端 plugin-version.json', path: SERVER_PLUGIN_VERSION, kind: 'server' },
]

function readVersion(t) {
  if (!existsSync(t.path)) return { ok: false, why: '文件不存在' }
  try {
    const d = JSON.parse(readFileSync(t.path, 'utf8'))
    return { ok: true, version: t.kind === 'server' ? d.latest : d.version, raw: d }
  } catch (e) {
    return { ok: false, why: `JSON 解析失败: ${e.message}` }
  }
}

const arg = process.argv[2]
const notesIdx = process.argv.indexOf('--notes')
const notes = notesIdx >= 0 ? process.argv[notesIdx + 1] : null

if (arg === '--check') {
  let bad = 0
  const seen = new Map()
  console.log('=== 三处版本号一致性核验 ===')
  for (const t of TARGETS) {
    const r = readVersion(t)
    if (!r.ok) {
      console.log(`  ✗ ${t.name}: ${r.why}`)
      bad += 1
      continue
    }
    console.log(`  ${t.name}: ${r.version}`)
    seen.set(r.version, (seen.get(r.version) ?? 0) + 1)
  }
  if (seen.size > 1) {
    console.log(`\n✗ 不一致：共 ${seen.size} 个不同版本 —— ${[...seen.keys()].join(' / ')}`)
    console.log('  跑 `node tools/bump-version.mjs <版本>` 收敛。')
    process.exit(1)
  }
  console.log('\n✓ 三处一致')
  process.exit(bad > 0 ? 1 : 0)
}

if (!arg || !/^\d+\.\d+\.\d+$/.test(arg)) {
  console.error('用法: node tools/bump-version.mjs <x.y.z> [--notes "…"]')
  console.error('      node tools/bump-version.mjs --check')
  process.exit(2)
}

console.log(`=== 目标版本 ${arg} ===`)
let changed = 0
for (const t of TARGETS) {
  if (!existsSync(t.path)) {
    console.log(`  ⚠ 跳过 ${t.name}（文件不存在: ${t.path}）`)
    continue
  }
  const r = readVersion(t)
  if (!r.ok) {
    console.log(`  ✗ ${t.name}: ${r.why}`)
    process.exit(1)
  }
  const before = r.version
  if (t.kind === 'server') {
    const d = r.raw
    d.latest = arg
    if (notes !== null) d.notes = notes
    writeFileSync(t.path, `${JSON.stringify(d, null, 2)}\n`, 'utf8')
  } else {
    const d = r.raw
    d.version = arg
    writeFileSync(t.path, `${JSON.stringify(d, null, 2)}\n`, 'utf8')
  }
  console.log(`  ${before === arg ? '=' : '→'} ${t.name}: ${before} → ${arg}`)
  if (before !== arg) changed += 1
}

// ★ 读回验证：不许只看写入返回值
console.log('\n=== 读回核验 ===')
const after = new Set()
for (const t of TARGETS) {
  const r = readVersion(t)
  if (r.ok) {
    console.log(`  ${t.name}: ${r.version}`)
    after.add(r.version)
  }
}
if (after.size !== 1 || !after.has(arg)) {
  console.error(`\n✗ 读回不一致：${[...after].join(' / ')}（期望全是 ${arg}）`)
  process.exit(1)
}
console.log(`\n✓ 三处全部为 ${arg}（本次实际改动 ${changed} 处）`)
