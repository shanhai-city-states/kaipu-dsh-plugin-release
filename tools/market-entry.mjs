#!/usr/bin/env node
/**
 * 山海·开铺 · DSH 插件市场投稿件（`data/plugins/<slug>.yml`）生成与校验
 * =============================================================================
 * 市场**没有上传入口**：收录靠给 `awesome-dsh-plugin/awesome-dsh-plugin` 提 PR，
 * 而 PR 只加一个文件 —— `data/plugins/<slug>.yml`。所以这个文件写错，PR 就被打回。
 *
 * 本脚本把**官方校验规则**逐条本地复刻（来源：上游 `scripts/lib/entries.mjs` 的
 * `validateEntries` / `slugFor` / `tarballProblem`，以及 `scripts/probe-npm.mjs`
 * 的 npm 归属判定），一条命令查完，不用等 CI 回话。
 *
 * 用法：
 *   node tools/market-entry.mjs              生成 / 刷新 market/*.yml
 *   node tools/market-entry.mjs --check      漂移断言 + 官方规则校验（CI 用这个）
 *
 * 仓库身份（三个变量，一次设好全局生效）：
 *   KAIPU_OWNER=真实GitHub名 KAIPU_REPO=真实仓库名 KAIPU_BRANCH=main
 *
 * ★★ 两个容易踩死的官方规则（都已在下面实现为硬断言）：
 *   1. 条目**只能有 5 个键**（url / name / category / description / tarball）。
 *      多一个键 = 不合法。npm 包名**不在条目里声明** —— 由 `probe-npm.mjs` 先核实
 *      "包自己的 repository 指回被收录的仓库" 才自动填进 data/npm-map.json。
 *   2. `description` 里任何含 `": "` 的值**必须加引号** —— 不加就是 YAML 语法错
 *      （上游为此专门写了报错提示）。本脚本一律加引号，从根上避开。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT_DIR = join(ROOT, 'market')
const CHECK = process.argv.includes('--check')

/**
 * ★ 真实仓库身份（2026-10-05 星月 `009` 定；**2026-10-08 更正为公开仓**）：
 *   owner = shanhai-city-states　repo = **kaipu-dsh-plugin-release**（**Public**，2026-10-06 建）
 *   ★ 开发仓 `shanhai-city-states/kaipu-dsh-plugin`（Private）**不是投稿对象**：
 *     上游 CI 会从条目 `url` 去抓 `package.json` 读 `dsh.bundle`，私有仓公开取不到；
 *     条目 `url` 同时是给用户点的链接，私有 ⇒ 点了 404。
 *     公开面由 `tools/emit-release-snapshot.mjs` 按白名单复制、确认后**单独**推 —— 见 `market/README.md`。
 */
const OWNER = process.env['KAIPU_OWNER'] ?? 'shanhai-city-states'
const REPO = process.env['KAIPU_REPO'] ?? 'kaipu-dsh-plugin-release'
const BRANCH = process.env['KAIPU_BRANCH'] ?? 'main'

/* ───────────────────────── 官方常量（逐字抄自上游 entries.mjs） ───────────────────────── */

/** 类别是**闭集**：顺序即官方 README 的章节顺序，值不能自造。 */
const CAT_IDS = [
  'agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools', 'wsl',
  'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'dev',
  'security', 'remote', 'market', 'fun',
]
/** 条目里**允许出现的键**：多一个就判不合法。 */
const ENTRY_KEYS = new Set(['url', 'name', 'category', 'description', 'tarball'])
/** 站点只渲染这两种语言的 description；写别的语言 = 文字没人看得到。 */
const LOCALE_CODES = ['en', 'zh']
const BASE_LOCALE = 'en'
/** tarball 必须是 GitHub 自家 release 资产 —— 别处的话清单就是在给用户一个它担保不了的下载链接。 */
const TARBALL_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])

/** `https://github.com/o/r` → `o__r`；`.../tree/main/packages/x` → `o__r--packages-x`（官方 slugFor） */
export function slugFor(url) {
  const p = url.replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '')
  const repo = p.split('/').slice(0, 2).join('/')
  const sub = p.includes('/tree/') ? p.split('/tree/')[1].replace(/^[^/]+\//, '') : null
  const base = repo.replaceAll('/', '__')
  return sub ? `${base}--${sub.replaceAll('/', '-')}` : base
}

/* ───────────────────────── 我们的两条条目（唯一事实源） ───────────────────────── */

/**
 * ★ 本模块既是 CLI，也是**唯一事实源**：`dev/market-preview/build-fixture.mjs`
 *   直接 import 这里的 `SPECS` / `buildEntries` —— 预览夹具里的条目与最终投稿件
 *   **不可能分叉**。所以下面必须判断"是不是被当脚本跑的"，不能在 import 时就生成文件。
 */
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

/**
 * ★★ 为什么这里**只有两条**（2026-10-10 显式记下，免得后人以为"漏了工位包"）
 *
 *   083-C 期1 新增了第三个包 `packages/plugin-workstation`，它的 `package.json`
 *   **已按上架口径配好**（`publishConfig.access:"public"` · `repository` 指向
 *   `kaipu-dsh-plugin-release` · `kaipu.descriptionReviewedAt` · icon / locale 齐），
 *   且已并入 **build / check / 发布快照** 三链（双灯 P1-①）。
 *
 *   ★ 但**本清单（= 投稿到上游市场的 PR 内容）没有加它** —— ★ 星月 `083-C-021 §二`
 *     **已裁：加工位 = C，但「挂期 2」改为「触发条件」**。原话：
 *     「**★ 时间不是开关，条件才是。**『挂期 2』不是条件，是等待。」
 *
 *     **三条全过 = 上架条件满足 ⇒ 才提市场 PR：**
 *       ① 工位接真身（`source='live'`）—— 不是演示态
 *       ② 期 1 通过双灯验收 —— 不是「差不多做完」
 *       ③ 消毒跑到 0 —— 承硬前置
 *
 *     ★ 判定权仍在**发起人（阿开）**：星月给了判据，但**不代裁**（`021 §六`）——
 *       「上架 = 对外承诺。条件满足才上，不是『等到期 2』。」
 *
 *     · 加它的**连带后果**（都要一起做才自洽）：`market/*.yml` 多一条 · `pack-release`
 *       多打一个 tgz · 公开仓 release 多挂一个资产 · `check-dist-freshness` 会开始查它。
 *     · 触发条件满足后：照下面 `SPECS` 三条补一条 `{ dir: 'plugin-workstation',
 *       npm: '@shanhai/kaipu-workstation', category: ?, asset: 'kaipu-workstation.tgz',
 *       description: { en, zh } }`（`category` 与描述文案都要**对着代码复核**后定）。
 *
 *   ⇒ 现状是**显式的不一致**，不是遗漏：见 `083-C-021`（星月裁定 ②）与 `083-C-020` 回函。
 */
export const SPECS = [
  {
    dir: 'plugin-platform',
    npm: '@shanhai/kaipu-platform',
    category: 'workflow',
    asset: 'kaipu-platform.tgz',
    description: {
      // ★★ 官方 contributing.md：「描述必须属实……它会被当作对你插件的声明，并与代码核对。
      //    夸大是让一个本来不错的插件被打回的主要原因。」所以这里**只写今天真的做了的事**。
      //    Step 4/6/7 落地后（面板接上真数据、编排/门禁/留痕真的通了）再来把它写完整。
      en: 'Sidebar panel for store-opening audits in DeepSeek Harness: a scene/run list beside a run-view and report surface. Requires the Shanhai backend for audit data.',
      zh: '山海·开铺 场地插件：开铺审计的侧边面板，场景／运行记录与运行视图／报告两栏。审计数据需配合山海服务端使用。',
    },
  },
  {
    dir: 'plugin-wisdom',
    npm: '@shanhai/kaipu-wisdom-team',
    category: 'tools',
    asset: 'kaipu-wisdom-team.tgz',
    description: {
      en: 'Companion sidebar panel for the Kaipu site plugin. Shows the built-in expert team, the scenes they serve, and seat status. Must be installed alongside kaipu-platform; fully removable.',
      zh: '山海·开铺 智囊团插件：配套侧边面板，展示内置谋士、服务场景与席位状态。需配合开铺（kaipu-platform）安装；可单独卸载，卸掉它场地仍完整可用。',
    },
  },
    {
      dir: 'plugin-workstation',
      npm: '@shanhai/kaipu-workstation',
      category: 'workflow',
      asset: 'kaipu-workstation.tgz',
      description: {
        en: "Kaipu Workstation — a cross-cloud, cross-platform console where agents collaborate on one workspace. Any agent runtime that speaks MCP or plain HTTP can take a seat, each with its own credentials: project context is shared, files are kept per seat, and tasks rotate between seats with a trace of who did what. Workstation data lives on the server — this plugin is only the interface, so uninstalling loses no data and reinstalling restores it. Renders the persisted workstation state (no live stream yet).",
        zh: "山海·开铺 · 工位插件 —— 跨云、跨端的 Agent 协作操作台：不同机器、不同平台的 Agent 坐进同一张工位，各自独立凭据；项目上下文共享、资料按位存放、任务在席位间轮转交接，谁做了什么一路留痕。工位数据存在服务端，插件只是界面：卸载不丢数据，重装即回到原样。当前渲染工位持久化态（非实时流）。",
      },
    },
]

export function buildEntries() {
  return SPECS.map((s) => {
    const url = `https://github.com/${OWNER}/${REPO}/tree/${BRANCH}/packages/${s.dir}`
    return {
      url,
      name: `${OWNER}/${REPO}#${s.dir}`,
      category: s.category,
      description: { ...s.description },
      // ★ 资产名**不含版本号**：否则 releases/latest/download/<名字> 会在下次发版后 404。
      tarball: `https://github.com/${OWNER}/${REPO}/releases/latest/download/${s.asset}`,
      file: join(OUT_DIR, `${slugFor(url)}.yml`),
    }
  })
}

/* ───────────────────────── YAML 写出（零依赖，只写这个受控形状） ───────────────────────── */

const quote = (s) => `"${String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

/**
 * 只写官方 dumpEntry 写的那几个键，且**值一律加引号**。
 * 上游文档点名过最常见的坏法：`en: Foo bar: baz` —— 未加引号的标量里出现 `": "`
 * 会被 YAML 当成映射，报错信息还指不到真凶。一律加引号就从根上避开。
 */
function dumpEntry(e) {
  const lines = [
    `url: ${e.url}`,
    `name: ${e.name}`,
    `category: ${e.category}`,
    'description:',
  ]
  for (const loc of LOCALE_CODES) {
    if (typeof e.description[loc] === 'string' && e.description[loc].trim() !== '') {
      lines.push(`  ${loc}: ${quote(e.description[loc])}`)
    }
  }
  if (e.tarball !== undefined) lines.push(`tarball: ${e.tarball}`)
  return `${lines.join('\n')}\n`
}

/* ───────────────────────── YAML 读回（校验**磁盘上的文件**，不是校验内存里的模型） ───────────────────────── */

function unquote(v) {
  const s = String(v).trim()
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\')
  }
  return s
}

/**
 * 未加引号的标量里出现 `": "` 或 `" #"` ⇒ 真 YAML 解析器会把它当映射/注释，直接报错。
 * 本脚本一律加引号，所以这里**只在读回别人的 / 被人手改过的文件时**才可能触发 ——
 * 但必须触发：否则 `--check` 会给出一份"看着过了、实际被官方 CI 打回"的假信心。
 */
function assertPlainSafe(name, rawValue, file) {
  const v = String(rawValue).trim()
  if (v === '' || v.startsWith('"')) return
  if (v.includes(': ') || v.includes(' #') || v.endsWith(':')) {
    throw new Error(`${file}：${name} 的值未加引号却含 YAML 保留序列（": " 或 " #"）—— 真 YAML 解析到这里会报错。应写成：${name}: ${quote(v)}`)
  }
}

/**
 * 只解析我们写出的那种形状（顶层标量 + description 下两行）。
 * ★ 刻意**不复用写出端的模型**：如果解析结果等于模型，才算"写出来的东西是对的"。
 */
function parseEntry(text, file) {
  const out = { description: {} }
  let inDescription = false
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    if (inDescription && /^\s+\S/.test(raw)) {
      const m = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw)
      if (m === null) throw new Error(`${file}：description 下这行读不懂：${raw}`)
      assertPlainSafe(`description.${m[1]}`, m[2], file)
      out.description[m[1]] = unquote(m[2])
      continue
    }
    inDescription = false
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw)
    if (m === null) throw new Error(`${file}：这行读不懂（只允许"键: 值"或 description:）：${raw}`)
    if (m[1] === 'description') { inDescription = true; continue }
    if (m[2] === '') throw new Error(`${file}：${m[1]} 没有值`)
    assertPlainSafe(m[1], m[2], file)
    out[m[1]] = unquote(m[2])
  }
  return out
}

/* ───────────────────────── 官方规则（validateEntries 的本地复刻） ───────────────────────── */

function tarballProblem(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'must be a URL string'
  let u
  try { u = new URL(value) } catch { return `is not a valid URL: ${value}` }
  if (u.protocol !== 'https:') return 'must be https'
  if (!TARBALL_HOSTS.has(u.hostname)) return `must be hosted on GitHub releases (got ${u.hostname})`
  if (u.hostname === 'github.com' && !u.pathname.includes('/releases/')) return 'must point at a GitHub release asset'
  if (!u.pathname.endsWith('.tgz') && !u.pathname.endsWith('.tar.gz')) return 'must point at a .tgz'
  return null
}

/** 返回问题清单（空 = 全过）。规则逐条对应官方 validateEntries。 */
export function validate(entries) {
  const problems = []
  const seen = new Map()
  for (const e of entries) {
    const at = e.file === undefined ? (e.url ?? '(unknown)') : relative(ROOT, e.file)

    // 规则 1：键必须落在闭集里
    const extra = Object.keys(e).filter((k) => !ENTRY_KEYS.has(k) && k !== 'file')
    if (extra.length > 0) {
      problems.push(`${at}: 出现了不允许的键 ${extra.map((k) => `"${k}"`).join(', ')} —— 条目只允许声明 ${[...ENTRY_KEYS].join(', ')}。npm 包名不在这里声明（由 probe-npm 核实 repository 后自动填）。`)
    }
    // 规则 2：url 形态
    if (typeof e.url !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(e.url)) {
      problems.push(`${at}: "url" 必须是 https://github.com/owner/repo 形态`)
      continue
    }
    // 规则 3：同一 url 不能重复收录
    if (seen.has(e.url)) problems.push(`${at}: url 重复，已在 ${seen.get(e.url)} 出现过`)
    seen.set(e.url, at)
    // 规则 4：文件名必须等于 url 的 slug
    const want = slugFor(e.url)
    if (e.file !== undefined && `${want}.yml` !== e.file.split(/[\\/]/).pop()) {
      problems.push(`${at}: 文件名必须与 url 对应 —— 应为 ${want}.yml`)
    }
    // 规则 5：name 必填
    if (typeof e.name !== 'string' || e.name.trim() === '') {
      problems.push(`${at}: "name" 必填`)
    } else if (e.name.split('#')[0].includes('/')) {
      // 规则 6：name 是列表里的链接文字，写成 owner/repo 就是对"链到哪个仓库"的断言
      const named = e.name.split('#')[0].trim().toLowerCase()
      const actual = e.url.replace(/^https:\/\/github\.com\//, '').split('/').slice(0, 2).join('/').toLowerCase()
      if (named !== actual) problems.push(`${at}: "name" 写的是 ${e.name.split('#')[0].trim()}，但 url 指向 ${actual} —— name 是链接文字，必须与实际仓库一致`)
    }
    // 规则 7：category 必须是闭集里的值
    if (!CAT_IDS.includes(e.category)) {
      problems.push(`${at}: "category" 必须是 ${CAT_IDS.join(', ')} 之一（实为 ${JSON.stringify(e.category)}）`)
    }
    // 规则 8：description.en 必填 / 单行 / 语言集受限
    for (const loc of LOCALE_CODES) {
      const d = e.description === undefined ? undefined : e.description[loc]
      if (d === undefined && loc !== BASE_LOCALE) continue
      if (typeof d !== 'string' || d.trim() === '') {
        problems.push(loc === BASE_LOCALE
          ? `${at}: "description.${BASE_LOCALE}" 必填`
          : `${at}: "description.${loc}" 存在但为空 —— 直接不写这个键`)
      } else if (d.includes('\n')) {
        problems.push(`${at}: "description.${loc}" 必须是单行`)
      }
    }
    if (e.description !== undefined && typeof e.description === 'object') {
      const extraLoc = Object.keys(e.description).filter((k) => !LOCALE_CODES.includes(k))
      if (extraLoc.length > 0) {
        problems.push(`${at}: "description" 里有 ${extraLoc.map((k) => `"${k}"`).join(', ')}，但站点只渲染 ${LOCALE_CODES.join(' / ')} —— 去掉这些键`)
      }
    }
    // 规则 9：tarball 形态
    if (e.tarball !== undefined) {
      const bad = tarballProblem(e.tarball)
      if (bad !== null) problems.push(`${at}: "tarball" ${bad}`)
    }
  }
  return problems
}

/** 官方只认"清单里的仓库"：npm 包名靠 probe-npm 核实 repository 是否指回该仓库，所以这条也得自查。 */
function npmLinkProblem(entry, spec) {
  const inRepo = `github.com/${OWNER}/${REPO}`
  const problems = []
  for (const file of ['package.json']) {
    const p = join(ROOT, 'packages', spec.dir, file)
    if (!existsSync(p)) continue
    const pkg = JSON.parse(readFileSync(p, 'utf8'))
    const repo = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '')
    if (!repo.toLowerCase().includes(`${OWNER}/${REPO}`.toLowerCase())) {
      problems.push(`${relative(ROOT, p)}: repository 没指回 ${OWNER}/${REPO} —— probe-npm 会因此**不给 npm 映射**（只会用 github:/tarball 路线安装）`)
    }
    if (pkg.name !== spec.npm) {
      problems.push(`${relative(ROOT, p)}: 包名是 ${pkg.name}，但条目按 ${spec.npm} 记录 —— 对不上`)
    }
    if (pkg.private === true) {
      problems.push(`${relative(ROOT, p)}: 仍是 private:true —— **发不了 npm**（要走 npm 路线必须去掉）`)
    }
  }
  return problems
}

/* ═══════════════════════════════════ 自测（负例） ═══════════════════════════════════ */
/*
 * ★ 一个**不会失败**的校验器等于没校验。这一组负例把"官方会打回"的写法逐条喂进来，
 *   要求每一条都被拒；最后再喂一条**正确**的，要求它**不被拒**（防假阳性）。
 */

function selfTest() {
  const base = () => ({
    url: 'https://github.com/o/r/tree/main/packages/x',
    name: 'o/r#x',
    category: 'workflow',
    description: { en: 'Hello.', zh: '你好。' },
    tarball: 'https://github.com/o/r/releases/latest/download/x.tgz',
    file: join(OUT_DIR, 'o__r--packages-x.yml'),
  })

  const cases = [
    ['条目里多写了一个 npm 键', (e) => { e.npm = '@o/x' }],
    ['url 不是 github 仓库链接', (e) => { e.url = 'https://example.com/o/r' }],
    ['文件名与 url 的 slug 不一致', (e) => { e.file = join(OUT_DIR, 'whatever.yml') }],
    ['name 指向了另一个仓库', (e) => { e.name = 'other/repo#x' }],
    ['category 是自造值', (e) => { e.category = 'kaipu' }],
    ['description 缺英文', (e) => { delete e.description.en }],
    ['description.en 是空串', (e) => { e.description.en = '   ' }],
    ['description 里带了换行', (e) => { e.description.zh = '第一行\n第二行' }],
    ['description 写了站点不渲染的语言', (e) => { e.description.ja = 'こんにちは' }],
    ['tarball 不在 GitHub 主机上', (e) => { e.tarball = 'https://cdn.example.com/x.tgz' }],
    ['tarball 不是 .tgz', (e) => { e.tarball = 'https://github.com/o/r/releases/latest/download/x.zip' }],
    ['tarball 是 http 而非 https', (e) => { e.tarball = 'http://github.com/o/r/releases/latest/download/x.tgz' }],
    ['tarball 指向 github.com 但不是 release 资产', (e) => { e.tarball = 'https://github.com/o/r/raw/main/x.tgz' }],
  ]

  let failed = 0
  const say = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++ }

  console.log('投稿件校验器 · 负例自测\n')
  console.log('── 必须被拒（13 条）──')
  for (const [label, mutate] of cases) {
    const e = base()
    mutate(e)
    const problems = validate([e])
    say(problems.length > 0, `${label}${problems.length === 0 ? '  ← 没被拒！校验器有洞' : ''}`)
  }

  // 重复 url 需要两条才能测
  {
    const a = base()
    const b = base()
    b.file = join(OUT_DIR, 'o__r--packages-y.yml')
    b.name = 'o/r#y'
    say(validate([a, b]).some((p) => p.includes('重复')), '同一 url 收录两条')
  }

  console.log('\n── YAML 层：官方点名的头号坏法（未加引号且含 ": "）──')
  {
    let threw = null
    try {
      parseEntry('url: https://github.com/o/r\nname: o/r\ncategory: workflow\ndescription:\n  en: Foo bar: baz\n', 'x.yml')
    } catch (err) { threw = err.message }
    say(threw !== null, `含 ": " 的未加引号标量被解析层抓住${threw === null ? '  ← 漏了！' : ''}`)
  }

  console.log('\n── 必须通过（防假阳性）──')
  {
    const problems = validate([base()])
    say(problems.length === 0, `一条完全正确的条目不被误拒${problems.length > 0 ? `  ← 假阳性：${problems.join(' / ')}` : ''}`)
  }
  {
    // 我们自己生成的两条，也必须过
    const problems = validate(buildEntries())
    say(problems.length === 0, `本仓实际生成的两条条目通过${problems.length > 0 ? `  ← ${problems.join(' / ')}` : ''}`)
  }
  {
    // 往返：dump → parse 必须等价（否则"写出来的"和"读回来的"是两回事）
    const e = base()
    const back = parseEntry(dumpEntry(e), 'o__r--packages-x.yml')
    const same = back.url === e.url && back.name === e.name && back.category === e.category
      && back.description.en === e.description.en && back.description.zh === e.description.zh
      && back.tarball === e.tarball
    say(same, `dump → parse 往返等价${same ? '' : `（读回：${JSON.stringify(back)}）`}`)
  }
  {
    // 含各种危险字符的值，往返后必须一模一样
    const e = base()
    e.description.zh = '含 "双引号"、\\ 反斜杠、: 冒号、# 井号、以及 emoji 🧱 的一行'
    const back = parseEntry(dumpEntry(e), 'x.yml')
    say(back.description.zh === e.description.zh, `含 " \\ : # emoji 的值往返无损${back.description.zh === e.description.zh ? '' : `（读回：${back.description.zh}）`}`)
  }

  console.log(`\n${failed === 0 ? '✓ 全绿' : `✗ ${failed} 项未过`}`)
  process.exit(failed === 0 ? 0 : 1)
}

/* ═══════════════════════════════════ 开跑 ═══════════════════════════════════ */

if (isMain) {
// ★ 自测放在所有 const 之后（ESM 里 const 有 TDZ，早于声明调用会 ReferenceError）
if (process.argv.includes('--self-test')) selfTest()

const entries = buildEntries()

if (!CHECK) {
  mkdirSync(OUT_DIR, { recursive: true })
  // ★★ 先清掉本目录里**不属于本次生成结果**的 .yml。
  //   陈旧投稿件是最危险的一类残留：仓库身份改了之后，旧文件名（`your-github-name__…`）
  //   **看起来同样像"要提的件"**，谁顺手复制进上游 PR 就出错 —— 而且机械检查全过。
  const expected = new Set(entries.map((e) => e.file.split(/[\\/]/).pop()))
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith('.yml') && !expected.has(f)) {
      rmSync(join(OUT_DIR, f))
      console.log(`  − 清掉陈旧投稿件 ${f}（仓库身份已变，它不该再存在）`)
    }
  }
  for (const e of entries) writeFileSync(e.file, dumpEntry(e), 'utf8')
  console.log(`✓ 已写出 ${entries.length} 份投稿件 → ${relative(ROOT, OUT_DIR)}/`)
  console.log(`  仓库身份：${OWNER}/${REPO} @ ${BRANCH}${OWNER === 'your-github-name' ? '  ← ★ 仍是占位符，建好公开仓库后设 KAIPU_OWNER / KAIPU_REPO 重跑' : ''}`)
  for (const e of entries) console.log(`  · [${e.category}] ${e.file.split(/[\\/]/).pop()}\n      url     ${e.url}\n      tarball ${e.tarball}`)

  const problems = validate(entries)
  if (problems.length > 0) {
    console.error('\n✗ 生成的条目**自己就不合法**（下面这些会被官方 CI 打回）：')
    for (const p of problems) console.error(`    · ${p}`)
    process.exit(1)
  }
  console.log('\n✓ 官方 9 条规则自检全过')
  console.log('')
  console.log('⚠️ 仓库已是 Public（2026-10-08 核实）—— 但**还差一个前置**才能提 PR：')
  console.log('     · 条目里的 `tarball:` 指向 releases/latest/download/<资产名>')
  console.log('     · 那个 Release **尚未创建**（公开仓 releases 为空）⇒ 现在提 PR，市场给用户的安装命令会 404')
  console.log('   ⇒ 先 node tools/pack-release.mjs，再在**公开仓**上 gh release create（资产名不能改）：')
  console.log('     gh release create v0.1.0 dist/kaipu-platform.tgz dist/kaipu-wisdom-team.tgz -R shanhai-city-states/kaipu-dsh-plugin-release')
  console.log('   ⇒ 两个 tarball URL 用 curl -I 验到 200 之后，再把 market/*.yml 复制进上游 PR。')
} else {
  let failed = 0
  const say = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++ }

  console.log(`市场投稿件校验（仓库身份 ${OWNER}/${REPO} @ ${BRANCH}）\n`)
  console.log('── ① 漂移：磁盘上的文件必须等于重新生成的结果 ──')
  for (const e of entries) {
    const name = e.file.split(/[\\/]/).pop()
    if (!existsSync(e.file)) { say(false, `${name} 不存在（先跑 node tools/market-entry.mjs）`); continue }
    const onDisk = readFileSync(e.file, 'utf8')
    say(onDisk === dumpEntry(e), `${name}${onDisk === dumpEntry(e) ? '' : ' 与生成结果不一致（改过？重跑生成）'}`)
  }

  console.log('\n── ② 读回：磁盘上的文件必须是合法 YAML 且与模型一致 ──')
  const parsed = []
  for (const e of entries) {
    const name = e.file.split(/[\\/]/).pop()
    if (!existsSync(e.file)) { say(false, `${name} 无法读回（文件不存在）`); continue }
    try {
      const got = parseEntry(readFileSync(e.file, 'utf8'), name)
      got.file = e.file
      const same = got.url === e.url && got.name === e.name && got.category === e.category
        && got.tarball === e.tarball
        && JSON.stringify(Object.keys(got.description).sort()) === JSON.stringify(Object.keys(e.description).sort())
        && LOCALE_CODES.every((l) => got.description[l] === e.description[l])
      say(same, `${name} 读回一致${same ? '' : `（实际：${JSON.stringify(got).slice(0, 200)}）`}`)
      parsed.push(got)
    } catch (err) {
      say(false, err.message)
    }
  }

  console.log('\n── ③ 官方 9 条规则 ──')
  const problems = validate(parsed)
  if (problems.length === 0) say(true, 'url 形态 / 文件名一致 / name 与 url 一致 / category 闭集 / description 单行且语言合法 / tarball 主机与后缀 —— 全过')
  else for (const p of problems) say(false, p)

  console.log('\n── ④ npm 映射的前置条件（probe-npm 的判定）──')
  const npmProblems = SPECS.flatMap((s) => npmLinkProblem(entries.find((e) => e.name.endsWith(`#${s.dir}`)), s))
  if (npmProblems.length === 0) say(true, '两个包的 repository 都指回本仓库、包名与条目一致、都不是 private')
  else for (const p of npmProblems) say(false, p)

  if (OWNER === 'your-github-name') {
    console.log('\n── ⑤ 占位符提醒（不算失败）──')
    console.log('  ! 仓库身份仍是占位符 your-github-name/kaipu-plugins —— 建好公开仓库后设 KAIPU_OWNER / KAIPU_REPO 重跑')
  }

  console.log(`\n${failed === 0 ? '✓ 全绿' : `✗ ${failed} 项未过`}`)
  process.exit(failed === 0 ? 0 : 1)
}
} // ← 关掉 isMain（被 import 时只导出模型，不生成文件）
