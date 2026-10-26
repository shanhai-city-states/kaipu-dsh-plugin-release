#!/usr/bin/env node
/**
 * check-seat-grid-083.mjs —— 卡座 10 格布局判据（2026-10-26 · 阿开最终口径）
 *
 * ★ 期望值直接取自阿开原话，一个字不改：
 *   「工位还是保持原来的 10 个座位要在顶部。
 *    6 个位 · 4 人已坐 · 2 个空
 *    —山海签名位（已占）#1战略位1人 #2管理位1人 #3管理助理位空 #4审计位空 #5执行位2人
 *    这里 2 行一行 5 个座位。然后把上面的 6 个座位按照上面那样先落座显示系统默认工位」
 *
 * ⇒ 判据断言三件事：
 *   ① 恒定 10 格，2 行 × 5 列
 *   ② 前 6 格 = 系统位，顺序与 SEAT_ORDER **逐字同序**
 *   ③ 脏数据（游离 role / team 根）一律不占格
 *
 * ★★ 为什么必须真跑函数：前两版都"看着对"——
 *   第一版 12 张卡（游离 role 混入）、第二版只有 6 张卡（格数不够）。
 *   只 grep 源码「有没有 repeat(5」两种都判绿 ⇒ 假绿。
 *
 * 用法：node tools/build.mjs && node tools/check-seat-grid-083.mjs
  *
 * ★ 2026-10-26 状态：本脚本要求 `seat-grid.ts`（buildSeatGrid）存在，
 *   但该模块在 0.2.96 回滚布局时删除，布局改成内联实现 ⇒ 运行会报「缺编译产物」。
 *   **不是布局功能坏了**：卡座 10 格真值由 `check-seat-summary-083.mjs` 74 条判据在守。
 *   若要恢复本脚本可测性，需把内联逻辑重新抽成 `seat-grid.ts`（技术债，未排期）。
 */
import { readFileSync, existsSync, mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = '/root/work/083-开铺/repo/kaipu-dsh-plugin'
const SRC = `${ROOT}/packages/plugin-workstation/src/client`
const LIB = `${ROOT}/packages/plugin-workstation/lib/client`

let pass = 0
const fails = []
const ck = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fails.push(name); console.log(`  ✗ ${name} ｜ ${String(got).slice(0, 240)}`) }
}

const stage = mkdtempSync(joinPath(tmpdir(), 'grid-'))
for (const name of ['seat-grid', 'seat-summary']) {
  const from = `${LIB}/${name}.js`
  if (!existsSync(from)) {
    console.error(`✗ 缺编译产物 ${from}\n  先跑 node tools/build.mjs`)
    process.exit(1)
  }
  copyFileSync(from, joinPath(stage, `${name}.cjs`))
}
const G = await import(pathToFileURL(joinPath(stage, 'seat-grid.cjs')).href)
const S = await import(pathToFileURL(joinPath(stage, 'seat-summary.cjs')).href)

const panel = readFileSync(`${SRC}/WorkstationPanel.tsx`, 'utf8')

/* ══════════════════════════════════════════════════════════════
   一、恒定 10 格 · 2 行 × 5 列
   ══════════════════════════════════════════════════════════════ */
console.log('\n【一】恒定 10 格')

ck('G-1a 容量常数 = 10（阿开：「还是保持原来的 10 个座位」）',
  G.GRID_CAPACITY === 10, G.GRID_CAPACITY)
ck('G-1b 每行 5 个 ⇒ 2 行',
  G.SEATS_PER_ROW === 5 && G.GRID_CAPACITY / G.SEATS_PER_ROW === 2,
  `${G.SEATS_PER_ROW} × ${G.GRID_CAPACITY / G.SEATS_PER_ROW}`)

/* ══════════════════════════════════════════════════════════════
   二、系统位顺序 = SEAT_ORDER（逐字同序，单一来源）
   ══════════════════════════════════════════════════════════════ */
console.log('\n【二】前 6 格 = 系统位（顺序与顶部表同源）')

const EXPECTED = ['signature', 'strategy', 'management', 'management_assistant', 'audit', 'execution']

ck('G-2a 系统位顺序 = 阿开给的 #1..#6',
  JSON.stringify(G.SYSTEM_SEAT_ORDER) === JSON.stringify(EXPECTED),
  G.SYSTEM_SEAT_ORDER.join(','))

/* ★★ 单一来源：卡座的系统顺序必须 === 顶部席位表的 SEAT_ORDER。
   两处各写一份 ⇒ 迟早漂（上面 #3、下面 #5，人对不上号）。 */
ck('G-2b 系统位顺序与顶部 SEAT_ORDER 逐字相同（单一来源，不各写一份）',
  JSON.stringify(G.SYSTEM_SEAT_ORDER) === JSON.stringify(S.SEAT_ORDER),
  `grid=${G.SYSTEM_SEAT_ORDER.join(',')} | summary=${S.SEAT_ORDER.join(',')}`)

/* ══════════════════════════════════════════════════════════════
   三、真铺子数据：10 格 · 前 6 格落座 · 后 4 格空
   ══════════════════════════════════════════════════════════════ */
console.log('\n【三】真铺子（6 系统位 + 8 游离 role）')

const R = 'r0'
const realNodes = [
  { node_id: R, name: '负责人', node_kind: 'team', parent_node_id: '' },
  { node_id: 's1', name: '执行位', node_kind: 'post', parent_node_id: R },
  { node_id: 's2', name: '管理位', node_kind: 'post', parent_node_id: R },
  { node_id: 's3', name: '审计位', node_kind: 'post', parent_node_id: R },
  { node_id: 's4', name: '签名位', node_kind: 'post', parent_node_id: R },
  { node_id: 's5', name: '战略位', node_kind: 'post', parent_node_id: R },
  { node_id: 's6', name: '管理助理位', node_kind: 'post', parent_node_id: R },
  { node_id: 'u1', name: '2332', node_kind: 'role', parent_node_id: '' },
  { node_id: 'u2', name: '1212', node_kind: 'role', parent_node_id: '' },
  { node_id: 'u3', name: '测试1', node_kind: 'role', parent_node_id: '' },
  { node_id: 'u4', name: '111', node_kind: 'role', parent_node_id: '' },
  { node_id: 'u5', name: '测试2026', node_kind: 'role', parent_node_id: '' },
  { node_id: 'u6', name: '测试2029', node_kind: 'role', parent_node_id: '' },
  { node_id: 'u7', name: 'Codex', node_kind: 'role', parent_node_id: '' },
  { node_id: 'u8', name: '前端位', node_kind: 'role', parent_node_id: '' },
]

const cells = G.buildSeatGrid(realNodes)
ck('G-3a 脏数据下仍是 10 格（不是 12、也不是 6）',
  cells.length === 10, `${cells.length} 格`)
ck('G-3b 前 6 格全是系统位',
  cells.slice(0, 6).every((c) => c.kind === 'system'),
  cells.slice(0, 6).map((c) => c.kind).join(','))
ck('G-3c 前 6 格 seatKey 逐个对得上阿开的表',
  JSON.stringify(cells.slice(0, 6).map((c) => c.seatKey)) === JSON.stringify(EXPECTED),
  cells.slice(0, 6).map((c) => c.seatKey).join(','))
ck('G-3d 6 个系统位全部落座（都有节点）',
  cells.slice(0, 6).every((c) => c.node !== undefined)
  && G.systemSeatedCount(cells) === 6,
  G.systemSeatedCount(cells))
/* ★★ 核心：签名位在第 1 格、执行位在第 6 格 —— 与顶部表 #1/#6 同位置 */
ck('G-3e #1 是签名位、#6 是执行位（与顶部表同位置）',
  cells[0].seatKey === 'signature' && cells[5].seatKey === 'execution',
  `${cells[0].seatKey}/${cells[5].seatKey}`)
ck('G-3f 后 4 格全空（4 个位置等着加人）',
  cells.slice(6).every((c) => c.node === undefined) && G.emptyCount(cells) === 4,
  `空 ${G.emptyCount(cells)} 格`)
/* ★★ 游离 role 一个都不许进卡座 */
ck('G-3g 8 个游离 role 一个都没进卡座',
  cells.every((c) => c.node === undefined || c.node.node_kind === 'post'),
  cells.filter((c) => c.node !== undefined && c.node.node_kind !== 'post').map((c) => c.node.name).join(','))

/* ══════════════════════════════════════════════════════════════
   四、边界形态
   ══════════════════════════════════════════════════════════════ */
console.log('\n【四】边界')

/* 空铺：格数不变，全空 */
const emptyCells = G.buildSeatGrid([])
ck('G-4a 空铺仍 10 格，全空（卡座不塌）',
  emptyCells.length === 10 && G.emptyCount(emptyCells) === 10,
  `${emptyCells.length}/${G.emptyCount(emptyCells)}`)

/* 缺位：只有 4 个系统位 ⇒ 前 6 格里 2 格空着（不臆造假卡片） */
const fourSystem = realNodes.filter((n) => ['s1', 's2', 's4', 's5'].includes(n.node_id))
const c4 = G.buildSeatGrid(fourSystem)
ck('G-4b 只有 4 个系统位 ⇒ 前 6 格中 2 格空（不补假卡片）',
  c4.length === 10
  && c4.slice(0, 6).filter((c) => c.node === undefined).length === 2
  && c4.slice(0, 6).every((c) => c.kind === 'system'),
  `空 ${c4.slice(0, 6).filter((c) => c.node === undefined).length} 格`)

/* 用户自建座位：占第 7 格起（不插队到系统位前面） */
const withExtra = [
  ...realNodes,
  { node_id: 'x1', name: '前端位', node_kind: 'post', parent_node_id: R },
]
const c5 = G.buildSeatGrid(withExtra)
ck('G-4c 自建座位排在第 7 格（不插到系统位前面）',
  c5.length === 10 && c5[6].kind === 'extra' && c5[6].node !== undefined
  && c5[6].node.name === '前端位',
  `#7=${c5[6].kind}:${c5[6].node?.name ?? '空'}`)

/* 超过 10 个座位：截断到 10，不撑破两行 */
const many = [...realNodes]
for (let i = 0; i < 8; i++) {
  many.push({ node_id: `m${i}`, name: `额外位${i}`, node_kind: 'post', parent_node_id: R })
}
const c6 = G.buildSeatGrid(many)
ck('G-4d 座位超过 10 个 ⇒ 仍 10 格（不撑成第三行）',
  c6.length === 10, `${c6.length} 格`)

/* ★ 反向对照：旧「叶子」口径会算出 14 格，证明本判据不是空转 */
const oldLeaves = realNodes.filter((n) => !realNodes.some((m) => (m.parent_node_id ?? '') === n.node_id))
ck('G-4e 反向对照：旧叶子口径会得 14 个（本判据不是空转）',
  oldLeaves.length === 14, `${oldLeaves.length} 个`)

/* ══════════════════════════════════════════════════════════════
   五、接线
   ══════════════════════════════════════════════════════════════ */
console.log('\n【五】接线')

ck('G-5a 面板用了 buildSeatGrid',
  panel.includes("from './seat-grid.js'") && panel.includes('buildSeatGrid(nodes)'),
  '未接线')
ck('G-5b 渲染的是格子数组（gridCells.map），不是节点数组',
  panel.includes('gridCells.map('), '还在用 gridNodes')
ck('G-5c 旧的 gridNodes / emptySeatSlots 已清除',
  !panel.includes('gridNodes') && !panel.includes('emptySeatSlots'),
  '旧代码残留')
ck('G-5d 网格仍 5 列',
  /gridTemplateColumns:\s*'repeat\(5, minmax\(0, 1fr\)\)'/.test(panel), '列数变了')
ck('G-5e 空格可「加位置」（EmptySeat 仍渲染）',
  panel.includes('<EmptySeat'), '空位块丢了')

/* ══ 汇总 ══ */
console.log(`\n${'─'.repeat(50)}`)
if (fails.length === 0) {
  console.log(`✓ 全绿：${pass} 条`)
  process.exit(0)
} else {
  console.log(`✗ ${fails.length} 条红 / 共 ${pass + fails.length} 条`)
  fails.forEach((f) => console.log(`   · ${f}`))
  process.exit(1)
}
