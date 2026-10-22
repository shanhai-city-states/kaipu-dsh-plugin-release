#!/usr/bin/env node
/**
 * 山海·开铺 · 契约生成器
 * =====================================================================
 * `contracts/v1.1/*.json`（★ 单一事实源）  ──►  `packages/contract/src/generated.ts`
 *
 * 用法：
 *   node tools/gen-contract.mjs          生成 / 覆盖
 *   node tools/gen-contract.mjs --check   只校验（有漂移 ⇒ 非 0 退出）★ Step 1 判据 #3
 *
 * ★ 为什么要有这个脚本（而不是手写 TS）：
 *   契约会随服务端升版（v1.1 → v1.2 → …）。手写两份必然漂移，
 *   而漂移的表现是"联调时字段对不上"，那时已经晚了。
 *   把契约压成机器可读 JSON + 生成，漂移就变成**构建期错误**而不是运行时惊喜。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CONTRACT_DIR = join(ROOT, 'contracts', 'v1.1')
const OUT = join(ROOT, 'packages', 'contract', 'src', 'generated.ts')

const CHECK = process.argv.includes('--check')

const readJson = (name) => JSON.parse(readFileSync(join(CONTRACT_DIR, name), 'utf8'))

const errors = readJson('errors.json')
const sse = readJson('sse-events.json')
const features = readJson('features.json')
const seats = readJson('seats.json')

const banner = `/**
 * ★★★ 机器生成文件 —— 不要手改 ★★★
 *
 * 来源：contracts/v1.1/{errors,sse-events,features,seats}.json
 * 生成：node tools/gen-contract.mjs
 * 校验：node tools/gen-contract.mjs --check   （有漂移即失败）
 *
 * 改契约的正确姿势：改 JSON → 重跑生成 → 提差异单（★ 不单方改契约）。
 */
`

const j = (v) => JSON.stringify(v, null, 2)

const parts = []

parts.push(banner)

parts.push(`
/** 契约版本（对账依据：认版本号，不认"我记得是这样的"） */
export const CONTRACT_VERSION = ${JSON.stringify(errors.contractVersion)} as const

/* ═══════════════ 错误码（errors.json）═══════════════ */

/** 错误码总表。★ 单一事实源，不要在别处再写一份。 */
export const ERROR_CODES = ${j(errors.codes)} as const

export type ErrorCode = (typeof ERROR_CODES)[number]['code']

/** ★ code 不在表内时的兜底文案（客户端纪律：不许把裸 code 印给用户） */
export const ERROR_FALLBACK = ${j(errors.fallback)} as const

export const ERROR_ENVELOPE_NOTE = ${JSON.stringify(errors.envelope.discipline)} as const
`)

parts.push(`
/* ═══════════════ SSE 事件（sse-events.json）═══════════════ */

export const SSE_EVENT_ORDER = ${JSON.stringify(sse.order)} as const

export const SSE_EVENTS = ${j(sse.events)} as const

export const SSE_VERDICTS = ${j(sse.verdicts)} as const

/** 渲染规则（客户端界面纪律，逐条可自查） */
export const SSE_RENDER_RULES = ${j(sse.renderRules)} as const

export const SSE_RECOVERY = ${j(sse.recovery)} as const
`)

parts.push(`
/* ═══════════════ features 六位（features.json）═══════════════ */

export const FEATURE_FLAGS = ${j(features.features)} as const

export type FeatureKey = (typeof FEATURE_FLAGS)[number]['key']

/** ★ 智囊团开关的唯一读法：wisdomTeam ?? expertTeam（契约 #16） */
export const WISDOM_TEAM_READ_RULE = ${JSON.stringify(features.readRule)} as const

export const FEATURE_DISCIPLINE = ${j(features.discipline)} as const
`)

parts.push(`
/* ═══════════════ 角色位（seats.json）═══════════════ */

export const SEATS = ${j(seats.seats)} as const

export type SeatKey = (typeof SEATS)[number]['seat']

export const SEAT_INVARIANTS = ${j(seats.invariants)} as const
`)

const next = parts.join('\n')

if (CHECK) {
  if (!existsSync(OUT)) {
    console.error(`✗ 缺少生成文件 ${relative(ROOT, OUT)} —— 请先跑 node tools/gen-contract.mjs`)
    process.exit(1)
  }
  const cur = readFileSync(OUT, 'utf8')
  if (cur === next) {
    console.log('✓ 契约无漂移：contracts/v1.1/*.json 与 packages/contract/src/generated.ts 一致')
    process.exit(0)
  }
  // 给出可定位的差异（第一处不同行）
  const a = cur.split('\n')
  const b = next.split('\n')
  let i = 0
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
  console.error('✗ 契约漂移：generated.ts 与 contracts/v1.1/*.json 不一致')
  console.error(`  首个差异在第 ${i + 1} 行：`)
  console.error(`    磁盘: ${JSON.stringify(a[i] ?? '<EOF>')}`)
  console.error(`    生成: ${JSON.stringify(b[i] ?? '<EOF>')}`)
  console.error('  ⇒ 修法：node tools/gen-contract.mjs  （并确认是改 JSON 而非改 TS）')
  process.exit(1)
}

writeFileSync(OUT, next, 'utf8')
console.log(`✓ 已生成 ${relative(ROOT, OUT)}（契约 ${errors.contractVersion}）`)
console.log(`  · 错误码 ${errors.codes.length} 条`)
console.log(`  · SSE 事件 ${sse.events.length} 个 / 判定 ${sse.verdicts.length} 类`)
console.log(`  · features ${features.features.length} 位 / 角色位 ${seats.seats.length} 个`)
