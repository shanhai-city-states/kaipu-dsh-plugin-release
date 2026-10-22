#!/usr/bin/env node
/**
 * g2-trace-audit.mjs — 内部痕迹引用 · 独立复算（v2）
 *
 * ★ 本脚本存在的理由（必读）：
 *   星月 `053` §一 指出：我方 `050/051` 的「46 处逐项吻合」**不是可复算的证据**，
 *   恰恰是「**未独立复算**」的信号 —— 与对方数字逐项一致，说明两边用的是同一个（我方）口径。
 *   ⇒ 本脚本**不引用任何清单、不复用我方旧正则**，直接从 repo 实读文件独立扫。
 *
 * ★★ v2 关键改进（本轮独立发现的判据缺陷）：
 *   星月 `053 §三·3.4` 给的正则第 ① 条是 **枚举式**：`(001-A|003|004|005|007|041|042|043)`
 *   —— **硬编码 8 个件号**。实读发现 src 里还有 **第 9 个及以后**的件号（`012` / `030` / `002` / `010` / `021` / `022`）
 *   ⇒ **枚举式判据必然漏**（与"清单条目一改就过期"同族，只是换到了正则层）。
 *   ⇒ 本脚本增 ⑥ **形态式**条（`(?<![0-9A-Za-z])0\d{2}(?![0-9A-Za-z])`）取**全集**，并**并列**星月口径以显差异。
 *
 * 用法：node tools/probe/g2-trace-audit.mjs
 * 输出：out/g2-trace-audit.md
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })

/** 扫描面：src（主体）+ 星月 §五 点名要消毒的非 src 件 */
const SRC_ROOTS = ['packages/plugin-platform/src', 'packages/plugin-wisdom/src']
const EXTRA = [
  'packages/plugin-platform/cordis.patch.yml',
  'packages/plugin-wisdom/cordis.patch.yml',
  'packages/plugin-platform/README.md',
  'packages/plugin-wisdom/README.md',
]

const srcFiles = SRC_ROOTS.flatMap(walk).sort()
const extraFiles = EXTRA.filter(existsSync)
const files = [...srcFiles, ...extraFiles]
const corpus = files.map((f) => ({
  f,
  isSrc: srcFiles.includes(f),
  lines: readFileSync(f, 'utf8').split(/\r?\n/),
}))

/** 星月 053 §三·3.4 的 5 条正则（原样照搬，用于复现其口径） */
const RULES = [
  ['①内部协作件号（枚举式·星月口径）', /(001-A|003|004|005|007|041|042|043)/g],
  ['②件名全称', /[0-9]{3}-[\u4e00-\u9fa5][^\s）)]*/g],
  ['③花名', /(阿开|古茶|阿舟|星月|响石|五人众|师叔)/g],
  ['④内部判据编号', /\b(INV|AC|CN|N|A|OPEN|D)-?[0-9]+/g],
  ['⑤件号+内部路径', /0[0-9]{2}-083[^\s）)]*/g],
]

/** ⑥ ★ 形态式：真·内部件号全集（不枚举） */
const RULE_OPEN = /(?<![0-9A-Za-z])0\d{2}(?![0-9A-Za-z])/g
/** 我方 050/051 旧正则（对比基线） */
const MINE = /\b(003|043|041|004|001-A|042|007|005)\b/g

const hitsOf = (re, text) => {
  re.lastIndex = 0
  return [...text.matchAll(re)].map((m) => m[0])
}

/** 假阳性判定：命中串前一位是字母/数字/连字符 ⇒ 是 id 的一部分（ag-1003 / req-mock-0003） */
const isFalsePositive = (line, m) => {
  const i = line.indexOf(m)
  if (i <= 0) return false
  return /[0-9A-Za-z-]/.test(line[i - 1])
}

const report = []
const push = (s = '') => report.push(s)
const scan = (re) => {
  const rows = []
  for (const { f, isSrc, lines } of corpus) {
    lines.forEach((line, i) => {
      const ms = hitsOf(re, line)
      if (ms.length) rows.push({ f, isSrc, ln: i + 1, ms, line })
    })
  }
  return rows
}

push('# G2 内部痕迹引用 · 独立复算报告 v2')
push('')
push(`- 生成时间：${new Date().toISOString()}`)
push(`- 扫描范围：src **${srcFiles.length} 个** + 非 src 点名件 **${extraFiles.length} 个**（实读，非清单）`)
push(`  - 非 src：${extraFiles.map((f) => '`' + f + '`').join(' · ') || '（无）'}`)
push('- 正则来源：星月 `053 §三·3.4`（5 条，原样照搬）+ **本脚本新增 ⑥ 形态式**')
push('')
push('---')
push('')

for (const [id, re] of RULES) {
  const rows = scan(re)
  const nH = rows.reduce((a, r) => a + r.ms.length, 0)
  const nL = new Set(rows.map((r) => `${r.f}:${r.ln}`)).size
  push(`## ${id}`)
  push('')
  push(`**命中次数 ${nH} ｜ 命中行数 ${nL}**`)
  push('')
  if (id.startsWith('①')) {
    const fp = rows.filter((r) => isFalsePositive(r.line, r.ms[0]))
    push(`> ⚠️ **假阳性 ${fp.length} 处**（mock 里的 agent id / requestId，不是内部件号）：`)
    for (const r of fp) push(`> - \`${r.f}:${r.ln}\` — ${r.line.trim().slice(0, 110)}`)
    push('')
    const real = rows.filter((r) => !isFalsePositive(r.line, r.ms[0]))
    push(`> ⇒ **真命中 ${real.length} 次**`)
    push('')
  }
  for (const r of rows.filter((r) => !isFalsePositive(r.line, r.ms[0]))) {
    push(`- \`${r.f}:${r.ln}\` **${[...new Set(r.ms)].join('`, `')}** — ${r.line.trim().slice(0, 150)}`)
  }
  push('')
}

// ⑥ 开放式全集
const openRows = scan(RULE_OPEN)
const openCount = new Map()
for (const r of openRows) for (const m of r.ms) openCount.set(m, (openCount.get(m) ?? 0) + 1)
const ENUM_KNOWN = new Set(['001', '003', '004', '005', '007', '041', '042', '043'])
push('## ⑥ ★ 形态式：内部件号全集（非枚举）')
push('')
push('**命中次数 ' + openRows.reduce((a, r) => a + r.ms.length, 0) + '**')
push('')
push('| 件号 | 处数 | 在星月 8 枚举内？ |')
push('|:--|:-:|:--|')
for (const [k, v] of [...openCount.entries()].sort((a, b) => b[1] - a[1])) {
  push(`| \`${k}\` | ${v} | ${ENUM_KNOWN.has(k) ? '✅ 在' : '🔴 **不在（星月口径漏）**'} |`)
}
push('')
push('**⇒ 逐处明细：**')
push('')
for (const r of openRows) {
  push(`- \`${r.f}:${r.ln}\` **${[...new Set(r.ms)].join('`, `')}** — ${r.line.trim().slice(0, 150)}`)
}
push('')

// 差异：旧正则漏行
const mineSet = new Set()
for (const { f, lines } of corpus) {
  lines.forEach((line, i) => {
    if (hitsOf(MINE, line).length) mineSet.add(`${f}:${i + 1}`)
  })
}
const openSet = new Set(openRows.map((r) => `${r.f}:${r.ln}`))
const missed = [...openSet].filter((k) => !mineSet.has(k)).sort()
push('---')
push('')
push('## 差异：我方旧正则（46 口径）漏了哪些行')
push('')
push(`我方旧正则命中行 **${mineSet.size}** ｜ 形态式全集命中行 **${openSet.size}** ｜ **漏 ${missed.length} 行**`)
push('')
for (const k of missed) {
  const [f, ...rest] = k.split(':')
  const ln = rest.join(':')
  const line = corpus.find((c) => c.f === f)?.lines[Number(ln) - 1] ?? ''
  push(`- ★ \`${k}\` — ${line.trim().slice(0, 150)}`)
}
push('')

mkdirSync('out/g2', { recursive: true })
writeFileSync('out/g2/trace-audit.md', report.join('\n'), 'utf8')

console.log(`扫描 ${srcFiles.length} src + ${extraFiles.length} 非 src`)
for (const [id, re] of RULES) {
  const rows = scan(re)
  const nH = rows.reduce((a, r) => a + r.ms.length, 0)
  const fp = rows.filter((r) => isFalsePositive(r.line, r.ms[0])).length
  console.log(`  ${id}：次数 ${nH}${fp ? `（假阳性 ${fp}）` : ''}`)
}
console.log(`  ⑥形态式全集：次数 ${openRows.reduce((a, r) => a + r.ms.length, 0)}｜件号种类 ${openCount.size}`)
console.log(`  旧正则漏行：${missed.length}`)
console.log('→ out/g2/trace-audit.md')
