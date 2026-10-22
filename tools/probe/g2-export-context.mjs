#!/usr/bin/env node
/**
 * 导出「越线待定行」的上下文原文（供星月独立判读）。
 * =====================================================================
 * ★ 为什么要导出上下文而不是只给行号：
 *   星月明说"不用你说它只是壳" ⇒ 我**不给结论、只给材料**，
 *   但材料必须是**足够的**（只给一行会被断章取义，多给几行才是完整证据）。
 *   ⇒ 每处给 ±12 行上下文，并**原样**保留注释与代码，不做任何删改。
 *
 * 用法：node tools/probe/g2-export-context.mjs > out/xxx.md
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

/** 待导出的行（来自 g2-src-line-audit.mjs 的 CROSSED? 与 note 两类） */
const TARGETS = [
  { file: 'packages/plugin-platform/src/client/mock/data.ts', line: 162, tag: '判据2', why: '座位层与"待接入"同源说明' },
  { file: 'packages/plugin-platform/src/client/mock/data.ts', line: 377, tag: '判据2', why: 'MOCK_SIGNATURE 声明' },
  { file: 'packages/plugin-platform/src/client/mock/data.ts', line: 380, tag: '判据2', why: 'SeatChangeRecord 结构' },
  { file: 'packages/plugin-platform/src/client/mock/data.ts', line: 389, tag: '判据2', why: 'MOCK_SEAT_CHANGES 样本' },
  { file: 'packages/plugin-platform/src/client/mock/data.ts', line: 421, tag: '判据2', why: 'seatChangesOf 函数' },
  { file: 'packages/plugin-platform/src/client/mock/data.ts', line: 293, tag: '判据3', why: 'mock usage 数值' },
  { file: 'packages/plugin-platform/src/client/run-reducer.ts', line: 80, tag: '判据3', why: '计费口径注释' },
  { file: 'packages/plugin-platform/src/client/live.ts', line: 407, tag: '判据3', why: '/me 的 creditsNote 读取' },
]

const PAD = 12
for (const t of TARGETS) {
  const abs = join(ROOT, t.file)
  const lines = readFileSync(abs, 'utf8').split('\n')
  const from = Math.max(1, t.line - PAD)
  const to = Math.min(lines.length, t.line + PAD)
  console.log(`### \`${t.file}\` : ${t.line} — ${t.why}  \`[${t.tag}]\``)
  console.log('')
  console.log('```ts')
  for (let i = from; i <= to; i++) {
    const mark = i === t.line ? '▶' : ' '
    console.log(`${mark} ${String(i).padStart(4)} | ${lines[i - 1]}`)
  }
  console.log('```')
  console.log('')
}
