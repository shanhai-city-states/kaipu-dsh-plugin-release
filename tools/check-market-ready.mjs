#!/usr/bin/env node
/**
 * 山海·开铺 · 插件包「上架就绪」断言
 * =============================================================================
 * 分工（两个工具各管一侧，别互相抄）：
 *   · tools/market-entry.mjs      管 **条目侧**（data/plugins/*.yml 合不合官方规则）
 *   · tools/check-market-ready.mjs 管 **包侧**（package.json 与包目录够不够上架）
 *
 * 为什么包侧要单独查：市场与宿主会**从包自己的元数据**取信息，缺一项就少一块脸面，
 * 而且多数是**安静失败**（不报错、就是没有）：
 *   · `repository` 没指回仓库 ⇒ probe-npm 不给 npm 映射 ⇒ 用户只能走 tarball/github 路线
 *   · 缺 `locale/*.json`     ⇒ 宿主里插件**显示成裸包名**
 *   · 缺 `icon`              ⇒ 插件列表里没有图标
 *   · `private: true`        ⇒ 发不了 npm（pnpm publish 直接拒）
 *   · 把自造字段塞回 `dsh.*` ⇒ ★ 未来读者会以为官方在读它（今天刚清理过的坑，立此护栏）
 *
 * 用法：
 *   node tools/check-market-ready.mjs
 *   node tools/check-market-ready.mjs --self-test     负例自测（证明它会失败）
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const PLACEHOLDER_OWNER = 'your-github-name'
const PLACEHOLDER_REPO = 'kaipu-plugins'

/** DSH **真的会读**的 `dsh.*` 键（已逐条核实）。其余一律视为自造字段。 */
const DSH_READ_KEYS = new Set(['bundle', 'client'])
/** iconOf() 只认这几种格式；上限 256 KiB。 */
const ICON_TYPES = new Map([[".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"]])
const ICON_MAX_BYTES = 256 * 1024

const pkgs = [
  { dir: 'packages/plugin-platform', requireIcon: true },
  { dir: 'packages/plugin-wisdom', requireIcon: true },
  { dir: 'packages/plugin-workstation', requireIcon: true },
]

/* ───────────────────────── 检查本体（纯函数：自测与实跑共用） ───────────────────────── */

/**
 * 对单个包做「上架就绪」检查。
 * @param pkg  解析后的 package.json
 * @param dir  包目录（绝对路径）
 * @param opts { release: boolean } —— release 模式下占位符算 FAIL，平时只算 WARN
 * @returns { problems: string[], warnings: string[] }
 */
function checkPkg(pkg, dir, opts = {}) {
  const problems = []
  const warnings = []
  const at = relative(ROOT, dir)

  /* ① 身份：不发 npm / 不可识别就不算就绪 */
  if (typeof pkg.name !== 'string' || pkg.name.trim() === '') problems.push(`${at}: 缺 name`)
  if (typeof pkg.version !== 'string' || pkg.version.trim() === '') problems.push(`${at}: 缺 version`)
  if (typeof pkg.description !== 'string' || pkg.description.trim() === '') problems.push(`${at}: 缺 description（市场卡片与宿主都要用）`)
  if (pkg.private === true) problems.push(`${at}: 仍是 "private": true —— **发不了 npm**（pnpm/npm publish 会直接拒绝）`)
  if (typeof pkg.license !== 'string' || pkg.license.trim() === '') {
    problems.push(`${at}: 缺 license`)
  } else if (!existsSync(join(dir, 'LICENSE')) && !existsSync(join(dir, 'LICENSE.md'))) {
    // ★ 刻意只 WARN，不是 FAIL —— 这是**星月 009 §一#2 的明确口径**：
    //   「上架审核看**元数据**，不看有没有 LICENSE 文件；等真有人要用了再补」。
    //   所以我把它从 FAIL 降级，并在理由里留住"为什么有人会想加它"，免得后人反复纠结。
    //   （npm 的自动带上仅在**包目录**里生效；repo 根那份不会进 tarball —— 这是事实，不是建议。）
    // ⚠️ 保留开关：若最终决定**不允许商用**，改 `"license": "UNLICENSED"` + `"private": true`（星月 009 §一#2 保留项）。
    warnings.push(`${at}: 声明了 license=${pkg.license} 但包目录无 LICENSE 文件 —— 按星月 009 口径可接受（审核看元数据）；若最终不许商用则改 UNLICENSED + private:true`)
  }
  if (pkg.publishConfig?.access !== 'public') {
    problems.push(`${at}: 缺 publishConfig.access="public"（scoped 包不带这个，npm 默认当私有发不出去）`)
  }

  /* ② repository：npm 映射的唯一依据（probe-npm 靠 repository.url.includes('owner/repo') 判定） */
  const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '')
  if (repoUrl === '') {
    problems.push(`${at}: 缺 repository —— 市场永远不会给你 npm 映射（probe-npm 核实不了归属）`)
  } else if (repoUrl.includes(PLACEHOLDER_OWNER) || repoUrl.includes(PLACEHOLDER_REPO)) {
    (opts.release === true ? problems : warnings).push(`${at}: repository 仍是占位符（${repoUrl}）—— 建好公开仓库后换真值${opts.release === true ? '' : '（--release 模式下算 FAIL）'}`)
  }

  /* ③ keywords：收录要求仓库带 dsh-plugin topic，npm 关键词保持一致便于检索 */
  const kw = Array.isArray(pkg.keywords) ? pkg.keywords : []
  if (!kw.includes('dsh-plugin')) problems.push(`${at}: keywords 里要有 "dsh-plugin"`)

  /* ③·补 ★ 描述属实性：官方会把描述当**声明**与代码核对，夸大是首要打回原因。
     机器核不了"描述与代码是否一致"，但能强制回答过这个问题 —— 每个改动描述的版本都要更新日期。 */
  const reviewed = pkg.kaipu?.descriptionReviewedAt
  if (typeof reviewed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reviewed)) {
    (opts.release === true ? problems : warnings).push(`${at}: kaipu.descriptionReviewedAt 缺或格式不对（应为 YYYY-MM-DD）—— 描述必须**对着代码复核过**才能提 PR，官方会核对${opts.release === true ? '' : '（--release 模式下算 FAIL）'}`)
  }

  /* ④ ★ 反自造字段护栏：只允许 dsh.bundle / dsh.client */
  const dshKeys = Object.keys(pkg.dsh ?? {})
  const invented = dshKeys.filter((k) => !DSH_READ_KEYS.has(k) && !k.startsWith('//'))
  if (invented.length > 0) {
    problems.push(`${at}: dsh.* 下出现了 DSH **不读**的键 ${invented.map((k) => `"${k}"`).join(', ')} —— DSH 只读 ${[...DSH_READ_KEYS].join(' / ')}。这类"看着权威、其实没人读"的字段会误导审核与后来的维护者，请放到 kaipu.* 下`)
  }

  /* ⑤ 装载面：dsh.bundle.patch / dsh.client.platform —— 缺就是安静失败 */
  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch.trim() === '') {
    problems.push(`${at}: 缺 dsh.bundle.patch（只声明 dsh.client 不算插件）`)
  } else if (!existsSync(resolve(dir, patch))) {
    problems.push(`${at}: dsh.bundle.patch 指向的 ${patch} 不存在`)
  } else {
    const arr = Array.isArray(pkg.files) ? pkg.files : []
    // ★ 两边都要归一化：dsh.bundle.patch 写 `./cordis.patch.yml`，files 里常写 `cordis.patch.yml`
    //   —— 直接比会报出**假警告**，而假警告会让人开始忽略这个工具。
    const norm = (p) => String(p).replace(/^\.\//, '')
    if (!arr.some((f) => norm(f) === norm(patch))) {
      warnings.push(`${at}: files 里没有显式列出 ${patch}（npm 默认会带上，但显式列出更稳）`)
    }
  }
  if (pkg.dsh?.client?.platform === undefined) {
    problems.push(`${at}: 缺 dsh.client.platform —— DSH 会**静默不加载**浏览器侧（不报错、清单正常、界面上就是没入口）`)
  }
  const clientExport = pkg.exports?.['./client']
  if (clientExport === undefined) problems.push(`${at}: 缺 exports["./client"]（DSH 靠它找浏览器 bundle）`)

  /* ⑥ 宿主显示面：locale + icon（都决定"插件长什么样"） */
  const files = Array.isArray(pkg.files) ? pkg.files : []
  for (const loc of ['en', 'zh']) {
    const f = join(dir, 'locale', `${loc}.json`)
    if (!existsSync(f)) {
      problems.push(`${at}: 缺 locale/${loc}.json —— 宿主里会显示成裸包名`)
      continue
    }
    try {
      const dict = JSON.parse(readFileSync(f, 'utf8'))
      for (const k of ['title', 'description']) {
        const v = dict?.meta?.[k]
        if (typeof v !== 'string' || v.trim() === '') problems.push(`${at}: locale/${loc}.json 缺 meta.${k}`)
      }
    } catch (err) {
      problems.push(`${at}: locale/${loc}.json 不是合法 JSON（${err.message}）`)
    }
  }
  if (pkg.exports?.['./locale/*.json'] === undefined) problems.push(`${at}: 缺 exports["./locale/*.json"]（官方插件都带这条）`)
  if (!files.some((f) => f.startsWith('locale/'))) problems.push(`${at}: files 里没有 locale/，locale 不会被打进 tarball`)

  if (pkg.icon === undefined) {
    problems.push(`${at}: 缺 icon（插件列表里没有图标）`)
  } else {
    const icon = String(pkg.icon)
    if (isAbsolute(icon) || win32.isAbsolute(icon) || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon)) {
      problems.push(`${at}: icon 必须是**相对路径**（DSH 会拒绝绝对路径与 URL）`)
    } else if (!ICON_TYPES.has(extname(icon).toLowerCase())) {
      problems.push(`${at}: icon 必须是 SVG / PNG / JPEG / WebP（实为 ${extname(icon)}）`)
    } else {
      const abs = resolve(dir, icon)
      if (relative(dir, abs).startsWith(`..${sep}`) || relative(dir, abs) === '..') {
        problems.push(`${at}: icon 必须留在包目录内`)
      } else if (!existsSync(abs) || !statSync(abs).isFile()) {
        problems.push(`${at}: icon 指向的 ${icon} 不存在`)
      } else if (statSync(abs).size > ICON_MAX_BYTES) {
        problems.push(`${at}: icon 超过 256 KiB（DSH 上限）`)
      }
    }
    if (!files.includes(icon)) problems.push(`${at}: files 里没有 ${icon}，图标不会被打进 tarball`)
  }

  /* ⑦ 分发形态：零运行期依赖是"能上市场"的硬条件 */
  const deps = Object.keys(pkg.dependencies ?? {})
  if (deps.length > 0) problems.push(`${at}: 声明了运行期 dependencies：${deps.join(', ')}（插件要零外部依赖）`)
  if (typeof pkg.main !== 'string' || pkg.main.trim() === '') problems.push(`${at}: 缺 main`)
  if (!files.some((f) => f.startsWith('lib/'))) problems.push(`${at}: files 里没有 lib/，产物不会被打进 tarball`)

  /* ⑧ 仓库需带 README（市场与 npm 都读它） */
  if (!existsSync(join(dir, 'README.md'))) problems.push(`${at}: 缺 README.md`)

  return { problems, warnings }
}

/* ───────────────────────── 负例自测 ───────────────────────── */

function selfTest() {
  const goodDir = join(ROOT, 'packages/plugin-platform')
  const base = () => JSON.parse(readFileSync(join(goodDir, 'package.json'), 'utf8'))

  const cases = [
    ['private 没去掉', (p) => { p.private = true }],
    ['缺 repository', (p) => { delete p.repository }],
    ['缺 license 字段', (p) => { delete p.license }],
    ['license 是空串', (p) => { p.license = '' }],
    ['缺 keywords', (p) => { delete p.keywords }],
    ['keywords 里没有 dsh-plugin', (p) => { p.keywords = ['deepseek'] }],
    ['缺 publishConfig', (p) => { delete p.publishConfig }],
    ['★ 又把 dshRange 塞回 dsh.*（今天刚清理的坑）', (p) => { p.dsh.dshRange = '>=0.2.0-rc.2' }],
    ['★ 又把 permissions 塞回 dsh.*', (p) => { p.dsh.permissions = ['ui.panel'] }],
    // ★ 这条是 --release 才 FAIL 的规则，所以负例必须用 release 模式测
    //   （用默认模式测会"不被拒"—— 那是测试写错，不是校验器有洞）
    ['描述属实性没复核过（缺 descriptionReviewedAt）', (p) => { delete p.kaipu.descriptionReviewedAt }, { release: true }],
    ['缺 dsh.bundle.patch', (p) => { delete p.dsh.bundle }],
    ['缺 dsh.client.platform', (p) => { delete p.dsh.client }],
    ['缺 exports["./client"]', (p) => { delete p.exports['./client'] }],
    ['缺 exports["./locale/*.json"]', (p) => { delete p.exports['./locale/*.json'] }],
    ['files 里没有 locale/', (p) => { p.files = p.files.filter((f) => !f.startsWith('locale/')) }],
    ['files 里没有 icon', (p) => { p.files = p.files.filter((f) => f !== 'icon.svg') }],
    ['icon 用绝对路径', (p) => { p.icon = 'C:/tmp/x.svg' }],
    ['icon 用不支持的格式', (p) => { p.icon = 'icon.gif' }],
    ['icon 指向不存在的文件', (p) => { p.icon = 'nope.svg' }],
    ['声明了运行期依赖', (p) => { p.dependencies = { 'left-pad': '^1.0.0' } }],
    ['main 被删掉', (p) => { delete p.main }],
    ['files 里没有 lib/', (p) => { p.files = p.files.filter((f) => !f.startsWith('lib/')) }],
  ]

  let failed = 0
  const say = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++ }

  console.log('上架就绪断言 · 负例自测\n')
  console.log('── 必须被拒（21 条）──')
  for (const [label, mutate, opts = {}] of cases) {
    const p = base()
    mutate(p)
    const { problems } = checkPkg(p, goodDir, opts)
    say(problems.length > 0, `${label}${problems.length === 0 ? '  ← 没被拒！有洞' : ''}`)
  }
  console.log('\n── 必须通过（防假阳性）──')
  for (const { dir } of pkgs) {
    const d = join(ROOT, dir)
    const { problems } = checkPkg(JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')), d)
    say(problems.length === 0, `${dir} 不被误拒${problems.length > 0 ? `  ← 假阳性：${problems[0]}` : ''}`)
  }
  console.log('\n── 占位符的严重级别（平时 WARN / --release 才 FAIL）──')
  {
    // ★ 用**合成**的占位符来测这条规则 —— 不能拿真包测：
    //   真包现在已是真实仓库身份（shanhai-city-states/kaipu-dsh-plugin-release），
    //   占位符那条根本不触发 ⇒ 拿真包测会变成"永远通过的空断言"（这正是要防的）。
    const p = base()
    p.repository = { type: 'git', url: 'git+https://github.com/your-github-name/kaipu-plugins.git' }
    const a = checkPkg(p, goodDir, { release: false })
    const b = checkPkg(p, goodDir, { release: true })
    const warnOnly = a.problems.length === 0 && a.warnings.some((w) => w.includes('占位符'))
    const failInRelease = b.problems.some((w) => w.includes('占位符'))
    say(warnOnly, '平时：占位符只报 WARN，不挡开发')
    say(failInRelease, '--release：占位符算 FAIL，发布前挡得住')
  }
  {
    // 反向断言：真实仓库身份**不该**触发占位符告警（否则这条规则就是在乱叫）
    const { problems, warnings } = checkPkg(base(), goodDir, { release: true })
    const noisy = [...problems, ...warnings].some((w) => w.includes('占位符'))
    say(!noisy && problems.length === 0, `真实仓库身份不触发占位符告警（当前 ${base().repository.url}）`)
  }

  console.log(`\n${failed === 0 ? '✓ 全绿' : `✗ ${failed} 项未过`}`)
  process.exit(failed === 0 ? 0 : 1)
}

/* ═══════════════════════════════════ 开跑 ═══════════════════════════════════ */

if (process.argv.includes('--self-test')) selfTest()

const RELEASE = process.argv.includes('--release')
let failed = 0
const say = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++ }

console.log(`插件包「上架就绪」检查${RELEASE ? '（--release 模式：占位符算 FAIL）' : ''}\n`)

for (const { dir } of pkgs) {
  const abs = join(ROOT, dir)
  console.log(`── ${dir} ──`)
  if (!existsSync(join(abs, 'package.json'))) { say(false, 'package.json 不存在'); continue }
  const { problems, warnings } = checkPkg(JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8')), abs, { release: RELEASE })
  if (problems.length === 0) {
    say(true, '元数据齐备（身份 / repository / locale / icon / 装载面 / 分发形态）')
  } else {
    for (const p of problems) say(false, p)
  }
  for (const w of warnings) console.log(`  ! ${w}`)
}
console.log(`\n${failed === 0 ? '✓ 全绿' : `✗ ${failed} 项未过`}`)
process.exit(failed === 0 ? 0 : 1)
