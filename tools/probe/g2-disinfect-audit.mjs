#!/usr/bin/env node
/**
 * g2-disinfect-audit.mjs — 按工坊 `058 §三`（G2 终审 V3）的 v3 五条口径，
 *                          对扫描面逐处列清单。
 *                          （★ 2026-10-10：由 32 件扩到 **42 件** —— 加入 083-C 期1 工位包；
 *                            `--release` 面同步 54 → **72 件**。见下面 `SRC_ROOTS` / `RELEASE_LIST`。）
 *
 * ★ 本脚本双重身份：
 *   ① 消毒**前**：产出逐处待消毒清单（含建议处置口径）
 *   ② 消毒**后**：同一口径复跑，残留应为 0（假阳性 12 处除外 —— 它们不是内部痕迹）
 *
 * ★★ 口径来源：工坊 `058 §三`（v3 · 五条 + 复跑命令）
 *   ① 件号（形态式·非枚举）  (?<![0-9A-Za-z])0\d{2}(?![0-9A-Za-z])
 *   ② 件名全称               [0-9]{3}-[\u4e00-\u9fa5][^\s）)]*
 *   ③ 花名                   (阿开|古茶|阿舟|星月|响石|五人众|师叔)
 *   ④ 判据编号（族全集）      (?<![0-9A-Za-z])(A|CN|N|OPEN|D)-?[0-9]+(?![0-9A-Za-z])
 *   ⑤ 件号+路径             「0\d{2}-\d{4}…」或「\d{3}-…（斜杠）…」的复合形态
 *
 * ★ 处置口径（工坊 `058 §三·3.1` 四条）：
 *   1 件号 → 语义代称（去号、保留技术内容）
 *   2 内部裁定术语 → 中性表述
 *   3 内部路径/件名 → 删句
 *   4 花名 → 中性化（换主语，不删句）
 *
 * 用法：node tools/probe/g2-disinfect-audit.mjs
 * 输出：out/g2/disinfect-list.md
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })

/** 扫描面（工坊 `058 §四` 明示 32 件；★ 2026-10-10 加 083-C 期1 工位包 ⇒ 42 件） */
const SRC_ROOTS = [
  'packages/plugin-platform/src',
  'packages/plugin-wisdom/src',
  // ★ 2026-10-10 加：083-C 期1 工位包 —— 它在发布面里，消毒面就必须跟着（双灯 P1-①）
  'packages/plugin-workstation/src',
]
const EXTRA = [
  'packages/plugin-platform/cordis.patch.yml',
  'packages/plugin-wisdom/cordis.patch.yml',
  'packages/plugin-workstation/cordis.patch.yml',
  'packages/plugin-platform/README.md',
  'packages/plugin-wisdom/README.md',
  'packages/plugin-workstation/README.md',
]
const srcFiles = SRC_ROOTS.flatMap(walk).sort()

/**
 * ★★ 发布面件数（工坊 `053 §五` 白名单；★ 2026-10-10 由 54 → **72**，加 083-C 期1 工位包）
 * —— `--release` 模式扫这个。
 * ★★ 本清单必须与 `tools/emit-release-snapshot.mjs` 的 `WHITELIST` **逐件对齐**：
 *   那个是「发布面的守门人」，这个是「发布面的消毒面」——
 *   **两处各抄一份 ⇒ 必然漂移**（这就是双灯 P1-① 抓到的形态）。
 *   ⚠️ 改一处必须改另一处；将来应把清单抽成共用的单一事实源。
 */
const RELEASE_LIST = [
  'package.json',
  'packages/plugin-platform/package.json',
  'packages/plugin-wisdom/package.json',
  'packages/plugin-workstation/package.json',
  'packages/plugin-platform/cordis.patch.yml',
  'packages/plugin-wisdom/cordis.patch.yml',
  'packages/plugin-workstation/cordis.patch.yml',
  ...walk('packages/plugin-platform/src'),
  ...walk('packages/plugin-wisdom/src'),
  ...walk('packages/plugin-workstation/src'),
  'packages/plugin-platform/locale/en.json',
  'packages/plugin-platform/locale/zh.json',
  'packages/plugin-wisdom/locale/en.json',
  'packages/plugin-wisdom/locale/zh.json',
  'packages/plugin-workstation/locale/en.json',
  'packages/plugin-workstation/locale/zh.json',
  'packages/plugin-platform/icon.svg',
  'packages/plugin-wisdom/icon.svg',
  'packages/plugin-workstation/icon.svg',
  'packages/plugin-platform/README.md',
  'packages/plugin-wisdom/README.md',
  'packages/plugin-workstation/README.md',
  'packages/plugin-platform/tsconfig.json',
  'packages/plugin-platform/tsconfig.client.json',
  'packages/plugin-wisdom/tsconfig.json',
  'packages/plugin-wisdom/tsconfig.client.json',
  'packages/plugin-workstation/tsconfig.json',
  'packages/plugin-workstation/tsconfig.client.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'tsconfig.base.json',
  '.gitignore',
  '.gitattributes',
]

const RELEASE = process.argv.includes('--release')
const files = RELEASE ? RELEASE_LIST.filter((f) => existsSync(f)) : [...srcFiles, ...EXTRA]
const corpus = files.map((f) => ({
  f,
  isSrc: srcFiles.includes(f),
  lines: readFileSync(f, 'utf8').split(/\r?\n/),
}))

/** 工坊 `058 §三` 五条（原样照搬） */
const RULES = [
  ['①件号（形态式·全集）', /(?<![0-9A-Za-z])0\d{2}(?![0-9A-Za-z])/g, '1 去号留技术内容'],
  ['②件名全称', /[0-9]{3}-[\u4e00-\u9fa5][^\s）)]*/g, '3 删句'],
  ['③花名', /(阿开|古茶|阿舟|星月|响石|五人众|师叔)/g, '4 中性化换主语'],
  ['④判据编号（族全集+扩展）', /(?<![0-9A-Za-z])(A|CN|N|OPEN|D|C|INV|AC)-?[0-9]+(?![0-9A-Za-z])/g, '2 中性表述'],
  ['⑤件号+路径', /0[0-9]{2}-[0-9]{4}[^\s）)]*|[0-9]{3}-[^\s）)]*\/[^\s）)]*/g, '3 删句'],
]

const hitsOf = (re, text) => {
  re.lastIndex = 0
  return [...text.matchAll(re)].map((m) => ({ s: m[0], i: m.index }))
}

/**
 * ★ 假阳性排除（逐**匹配**判定，不按整行 —— 粒度必须到匹配，
 *   否则「真假混合行」（如 live.ts:17）会被整行误判）
 *
 * ★★ 判定只认「前一位是**字母或数字**」= 该数字是某个 id 片段的一部分。
 *   **不含连字符** —— `005-083…` 里的 `083` 前一位是 `-`，但它是**真内部件号**（属⑤类），
 *   若把 `-` 也算作 id 的一部分会**误伤真命中**（本脚本 v1 犯过此错）。
 */
const isFalsePositive = (line, i) => {
  if (i <= 0) return false
  // 前一位是字母/数字 ⇒ 是某个 id 的一部分（ag-1003 / req-mock-0003 / 2026-10-05）
  return /[0-9A-Za-z]/.test(line[i - 1])
}

const report = []
const push = (s = '') => report.push(s)
const t0 = new Date().toISOString()

push('# G2 消毒清单 · v3 口径逐处明细（工坊 `058 §三`）' + (RELEASE ? ` · ★ 发布面 ${files.length} 件` : ''))
push('')
push(`- 生成时间：${t0}`)
push(`- 扫描面：**${files.length} 件**（${RELEASE ? '发布面白名单（工坊 `053 §五`）' : `src ${srcFiles.length} + 非 src ${EXTRA.length}`}）· 实读，非清单`)
push(`- 口径来源：工坊 \`058 §三\`（v3 五条${RELEASE ? ' + 我方扩展 C/INV/AC 族' : ''}）`)
push('')

const summary = []
const allRows = []
for (const [id, re, action] of RULES) {
  const rows = []
  for (const { f, isSrc, lines } of corpus) {
    lines.forEach((line, i) => {
      const ms = hitsOf(re, line)
      if (ms.length) rows.push({ f, isSrc, ln: i + 1, ms, line })
    })
  }
  for (const r of rows) allRows.push({ ...r, rule: id, action })
  const nH = rows.reduce((a, r) => a + r.ms.length, 0)
  const nReal = rows.reduce(
    (a, r) => a + r.ms.filter((m) => !isFalsePositive(r.line, m.i)).length,
    0,
  )
  const nFP = nH - nReal
  summary.push({ id, action, nH, nReal, nFP, nL: rows.length })
}

push('## 〇、总览')
push('')
push('| # | 条 | 处置口径 | 命中次数 | **真命中** | 假阳性 | 命中行 |')
push('|:-:|:--|:--|:-:|:-:|:-:|:-:|')
let totReal = 0
for (const s of summary) {
  totReal += s.nReal
  push(`| ${s.id.slice(0, 1)} | ${s.id} | ${s.action} | ${s.nH} | **${s.nReal}** | ${s.nFP} | ${s.nL} |`)
}
push(`| | **合计** | | | **${totReal}** | | |`)
push('')
push('> ⚠️ ⑤ 与 ② 有交集（`083-xxxx/…` 同时满足两条）⇒ **并集去重后的实数在 §六 给出**。')
push('')
push('---')
push('')

push('## 一、逐处明细（按处置口径分组）')
push('')
for (const [id, re] of RULES) {
  const rows = allRows.filter((r) => r.rule === id)
  push(`### ${id} · 处置：${rows[0]?.action ?? '—'}`)
  push('')
  if (!rows.length) {
    push('（无命中）')
    push('')
    continue
  }
  for (const r of rows) {
    const parts = r.ms
      .map((m) => `${isFalsePositive(r.line, m.i) ? '~~' : '**'}${m.s}${isFalsePositive(r.line, m.i) ? '~~' : '**'}`)
      .join(' · ')
    push(`- \`${r.f}:${r.ln}\` ${parts}`)
    push(`  \`${r.line.trim().slice(0, 170)}\``)
  }
  push('')
}

// ── 假阳性清单（不消）
push('---')
push('')
push('## 二、假阳性 · **不消**（不是内部痕迹）')
push('')
const fpRows = []
for (const r of allRows) {
  for (const m of r.ms) {
    if (isFalsePositive(r.line, m.i)) fpRows.push({ ...r, hit: m.s })
  }
}
const fpByHit = new Map()
for (const r of fpRows) fpByHit.set(r.hit, (fpByHit.get(r.hit) ?? 0) + 1)
for (const [k, v] of [...fpByHit.entries()].sort((a, b) => b[1] - a[1])) {
  push(`- \`${k}\` × ${v}`)
}
push('')
push(`合计 **${fpRows.length}** 处 ⇒ 按逐匹配判定（含真假混合行，不整行误判）。`)
push('')

// ── 开放式检验（★ 花名表与判据族本身是否也是枚举）
push('---')
push('')
push('## 三、★ 开放式检验：口径本身是否还有枚举漏项')
push('')
push('### 3.1 花名表（工坊表列 7 个）—— 开放扫「可能的人名/角色名」')
push('')
const NAMES = ['阿开', '古茶', '阿舟', '星月', '响石', '五人众', '师叔']
const nameHits = new Map()
for (const { f, lines } of corpus) {
  lines.forEach((line, i) => {
    const re = /[阿小]?[\u4e00-\u9fa5]{1,3}(?=[，。、：）) ]|$)/g
    for (const m of line.matchAll(re)) {
      const s = m[0]
      if (/^(阿|小)[\u4e00-\u9fa5]{1,2}$/.test(s) || NAMES.includes(s)) {
        nameHits.set(s, (nameHits.get(s) ?? 0) + 1)
      }
    }
  })
}
push('| 候选 | 处数 | 在工坊 7 枚举内？ |')
push('|:--|:-:|:--|')
for (const [k, v] of [...nameHits.entries()].sort((a, b) => b[1] - a[1])) {
  push(`| \`${k}\` | ${v} | ${NAMES.includes(k) ? '✅ 在' : '🔴 **不在**'} |`)
}
push('')

push('### 3.2 判据编号族 —— 开放扫「字母-数字」形态')
push('')
const FAMILY = ['A', 'CN', 'N', 'OPEN', 'D', 'INV', 'AC', 'M']
const famHits = new Map()
for (const { f, lines } of corpus) {
  lines.forEach((line) => {
    for (const m of line.matchAll(/(?<![0-9A-Za-z])[A-Z]{1,4}-[0-9]+(?![0-9A-Za-z])/g)) {
      const fam = m[0].split('-')[0]
      famHits.set(fam, (famHits.get(fam) ?? 0) + 1)
    }
  })
}
push('| 族 | 命中 | 在工坊 v3 口径内？ |')
push('|:--|:-:|:--|')
for (const [k, v] of [...famHits.entries()].sort((a, b) => b[1] - a[1])) {
  push(`| \`${k}-n\` | ${v} | ${FAMILY.slice(0, 5).includes(k) ? '✅ 在' : '🔴 **不在（工坊 v3 漏）**'} |`)
}
push('')

// ── 并集去重（真实待消毒处数）
push('---')
push('')
push('## 四、★ 并集去重后的真实待消毒处数')
push('')
const keyOf = (r, m) => `${r.f}:${r.ln}:${m.i}`
const realKeys = new Set()
for (const r of allRows) {
  for (const m of r.ms) {
    if (!isFalsePositive(r.line, m.i)) realKeys.add(keyOf(r, m))
  }
}
push(`- 四条（②∪⑤ 有交集）各自真命中相加 = **${totReal}**`)
push(`- 逐匹配去重后 = **${realKeys.size}** 处`)
push(`- ⇒ 差额 ${totReal - realKeys.size} 处为 ②∪⑤ 的重复计。`)
push('')

mkdirSync('out/g2', { recursive: true })
const OUTFILE = RELEASE ? 'out/g2/release-scan.md' : 'out/g2/disinfect-list.md'
writeFileSync(OUTFILE, report.join('\n'), 'utf8')

console.log(`${RELEASE ? '★ 发布面' : '扫描面'} ${files.length} 件`)
for (const s of summary) {
  console.log(`  ${s.id}：命中 ${s.nH}｜真 ${s.nReal}｜假阳性 ${s.nFP}`)
}
console.log(`  合计真命中 ${totReal}｜逐匹配去重 ${realKeys.size}`)
console.log('→ ' + OUTFILE)
