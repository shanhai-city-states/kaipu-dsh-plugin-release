#!/usr/bin/env node
/**
 * 山海·开铺 · 干净版扫描（clean-scan）
 * =====================================================================
 * 目的：**用机器证明"这个仓里没有不该有的东西"**。
 *
 * 为什么需要它：本仓要按"可开源标准"组织（阿开口径），且插件要**分发给客户、
 * 产物可被查看**（004 §C）。⇒ 边界必须是**架构级**的，靠"我记得没写"不算数。
 * 003 的教训：脏东西不是"忘了删"，而是"从来没人查过"。
 *
 * 用法：
 *   node tools/clean-scan.mjs             扫描
 *   node tools/clean-scan.mjs --json      机器可读输出
 *
 * 退出码：0 = 通过（可含 WARN）；1 = 有 FAIL。
 *
 * ── 两级规则（故意这么分）─────────────────────────────────────────────
 *
 *   【FAIL · 所有文件】—— 密钥形态 / 内部绝对路径 / 我方私有包名。
 *        这些**在任何文件里都不该出现**，含文档。
 *
 *   【FAIL · 仅代码文件】—— 003 的业务词（财税 / 客户空间 / 归户 …）。
 *        代码里出现 ⇒ 说明搬了 003 的业务代码进来（违 §〇 的"不搬"清单）。
 *        文档（.md）里出现 ⇒ 只 **WARN**：解释"我们**不搬**什么"时必须能提它，
 *        否则 README 没法把定位讲清楚。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SELF = relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, '/')
const AS_JSON = process.argv.includes('--json')

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'lib',
  // ★ 契约层的 CJS 产物（给 client bundle 内联用）—— 与 lib/ 同理，是生成物
  'lib-cjs',
  'dist',
  'target',
  '.pnpm-store',
  // ★ `dev/` = 本地开发用 DSH_HOME + 浏览器 profile（tools/setup-dev-profile.mjs 生成，
  //   已 gitignore）。它是**生成物不是源**，和 lib/ 同理 ——
  //   而且 profile 的 package.json 里必然带本机绝对路径（file: 链接），
  //   扫它只会得到必然的假阳性。
  'dev',
])
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml'])
const DOC_EXT = new Set(['.md', '.txt'])

/** 硬规则：任何文件命中即 FAIL */
const HARD_RULES = [
  { id: 'secret-openai', re: /\bsk-[A-Za-z0-9]{16,}/, why: '疑似模型 API Key' },
  { id: 'secret-aws', re: /\bAKIA[0-9A-Z]{16}\b/, why: '疑似 AWS 凭据' },
  { id: 'secret-pem', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: '私钥材料（签名私钥绝不能进客户端，CN-3）' },
  { id: 'secret-agent', re: /\bagent_secret\s*[:=]/, why: '★ agent_secret 字段（契约 #13：(A) 下客户端根本不该有这个字段，CN-6）' },
  { id: 'secret-assign', re: /\b(api[_-]?key|modelKey|model_key|client[_-]?secret|access[_-]?token)\s*[:=]\s*['"][^'"]{8,}['"]/i, why: '硬编码凭据赋值' },
  { id: 'path-win-abs', re: /[A-Za-z]:[\\/](001-开发项目|WorkBuddyData|dev|Users|Program Files)/, why: '★ 本机绝对路径（干净版禁止；换机器就断）' },
  { id: 'pkg-private', re: /@caishui\//, why: '003 私有包名（本仓不得依赖）' },
  { id: 'host-private', re: /\bguomaai\b/, why: '003 侧业务域名' },
]

/** 软规则：代码文件命中即 FAIL，文档文件只 WARN */
const CODE_RULES = [
  { id: 'biz-caishui', re: /\bcaishui\b/i, why: '003 业务标识（本仓应零出现）' },
  { id: 'biz-terms', re: /财税|客户空间|归户|专家库|积分账本/, why: '003 业务词（说明可能误搬了业务代码）' },
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(ROOT)
const findings = []

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  if (rel === SELF) continue // 扫描器自身含规则字面量，跳过
  const ext = extname(file).toLowerCase()
  if (!CODE_EXT.has(ext) && !DOC_EXT.has(ext) && ext !== '') continue
  const isCode = CODE_EXT.has(ext)

  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // 二进制 / 不可读
  }
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    for (const r of HARD_RULES) {
      if (r.re.test(line)) {
        findings.push({ level: 'FAIL', file: rel, line: i + 1, rule: r.id, why: r.why, text: line.trim().slice(0, 120) })
      }
    }
    if (isCode) {
      for (const r of CODE_RULES) {
        if (r.re.test(line)) {
          findings.push({ level: 'FAIL', file: rel, line: i + 1, rule: r.id, why: r.why, text: line.trim().slice(0, 120) })
        }
      }
    } else {
      for (const r of CODE_RULES) {
        if (r.re.test(line)) {
          findings.push({ level: 'WARN', file: rel, line: i + 1, rule: r.id, why: r.why + '（文档里说明"不搬什么"属正常）', text: line.trim().slice(0, 120) })
        }
      }
    }
  }
}

const fails = findings.filter((f) => f.level === 'FAIL')
const warns = findings.filter((f) => f.level === 'WARN')

if (AS_JSON) {
  console.log(JSON.stringify({ files: files.length, fails, warns }, null, 2))
} else {
  console.log(`干净版扫描 · ${files.length} 个文件`)
  console.log(`  FAIL ${fails.length} · WARN ${warns.length}`)
  for (const f of [...fails, ...warns]) {
    console.log(`\n  [${f.level}] ${f.file}:${f.line}  (${f.rule})`)
    console.log(`         ${f.why}`)
    console.log(`         > ${f.text}`)
  }
  if (fails.length === 0) console.log('\n✓ 通过：无密钥 / 无本机绝对路径 / 无 003 业务代码残留')
}

process.exit(fails.length === 0 ? 0 : 1)
