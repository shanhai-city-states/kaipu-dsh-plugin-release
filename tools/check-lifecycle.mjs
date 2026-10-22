#!/usr/bin/env node
/**
 * 山海·开铺 · 插件生命周期验收（Step 3a + 3b）
 * =====================================================================
 * 把「装 / 卸 / 启 / 停 / 升 / 回滚 / 兼容性拒绝」全部真实跑一遍并断言。
 *
 * 用法：node tools/check-lifecycle.mjs
 * 退出码：0 = 全绿；1 = 有失败
 *
 * ── 为什么要在**临时沙箱**里跑（`KAI_DEV_DIR`）───────────────────────
 *   这个脚本会**真的删目录、真的换包、真的回滚**。跑在真 `dev/` 上会污染现场，
 *   也会因为残留状态而"时而过时而不过"。所以：
 *   全部操作落在 `<repo>/dev/.lifecycle-sandbox/`（跑完即清），
 *   且用 `KAI_DEV_DIR` 让 `tools/plugin.mjs` 把沙箱当 DSH_HOME。
 *   ⇒ **可重复跑**，且不影响真实 dev 环境。
 *
 * ── 覆盖的验收点（对应 004-客户端插件化 §八）────────────────────────
 *   AC-C01  停用任一插件 ⇒ 清单/链接同步摘除（其余插件不受影响）
 *   AC-C02' 坏产物 ⇒ **拒绝安装/启用**（真实"白屏隔离"在 3c 用真 DSH 验）
 *   AC-C03  卸载 ⇒ 代码移除、**数据保留**；`--purge-data` 才清
 *   AC-C07  单独升级 ⇒ 留回滚点；`rollback` 一键回到上一版（且回滚本身可回滚）
 *   A3      兼容性：kaipu.dshRange 不满足 ⇒ **先拒绝，再运行**
 *   A6      零外部依赖：声明运行期 dependencies ⇒ 拒绝
 */
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const NODE = process.execPath
const CLI = join(HERE, 'plugin.mjs')
const SANDBOX = join(ROOT, 'dev', '.lifecycle-sandbox')
/**
 * ★ 注意层级：`KAI_DEV_DIR` 是「dev 目录」，DSH_HOME 是它下面的 `dsh-home/`。
 *   第一次写这个脚本时按 `<KAI_DEV_DIR>/profiles/...` 找文件，**少了一层**，
 *   症状是"install 明明成功、却找不到落盘"（差点误判成 plugin.mjs 的 bug）。
 */
const HOME = join(SANDBOX, 'dsh-home')
const PACKS = join(HOME, '_packs')

let pass = 0
const fails = []
const checkFail = []

function ok(msg) { pass++; console.log(`  ✓ ${msg}`) }
function bad(msg) { fails.push(msg); console.log(`  ✗ ${msg}`) }

/**
 * ★★ 容忍失败的删除。
 *   宿主的**批量删除保护**在 >50 项时要确认（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），
 *   而沙箱跑到一半就已经有几十个文件 —— 第二次运行时"清沙箱"会直接抛。
 *   ⇒ 清不掉就沿用（`bootstrap` 是幂等的，install 会先卸旧的，不影响断言）。
 */
function safeRm(p) {
  try { rmSync(p, { recursive: true, force: true }) } catch { /* 批量保护 ⇒ 留着 */ }
}

/** 跑 plugin.mjs（沙箱 DSH_HOME），返回 {status, stdout, stderr} */function cli(...args) {
  const r = spawnSync(NODE, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    // ★★ `stdin: 'ignore'` 是**本机必需**，不是随手写的：
    //   这台机器上 `spawnSync` 只要 stdin 接 pipe 就报 **EBUSY**
    //   （宿主经 NODE_OPTIONS 注入 node-language-shim.cjs 所致；
    //    表现为子进程根本没起来，stdout/stderr 全空 —— 只看 status 会误判成"插件被拒绝"）。
    //   异步 spawn 不受影响；同步的话把 stdin 设成 ignore 即可，**无需引任何绝对路径补丁**。
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '', KAI_DEV_DIR: SANDBOX },
  })
  // ★ 把 spawn 自身的失败也带出来（否则空输出会伪装成"业务拒绝"）
  const why = r.error ? `\n[spawn error] ${r.error.message}` : (r.signal ? `\n[signal] ${r.signal}` : '')
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}${why}` }
}
const listJson = () => JSON.parse(cli('list', '--json').out)
const find = (id) => listJson().plugins.find((p) => p.id === id)

/* ── 造测试包 ── */
const TEST_ID = '@shanhai/test-probe'
const SHORT = 'test-probe'

function makePack(name, { version, dshRange, deps, badClient, omitClientDecl }) {
  const dir = join(PACKS, name)
  safeRm(dir)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  const pkg = {
    name: TEST_ID, version, private: true, type: 'module',
    main: 'lib/index.js', types: 'lib/index.d.ts',
    exports: {
      '.': { types: './lib/index.d.ts', default: './lib/index.js' },
      './client': { types: './lib/client/index.d.ts', default: './lib/client.js' },
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    files: ['lib/**/*.js', 'lib/**/*.d.ts', 'cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }
  if (omitClientDecl !== true) {
    // ★ 必须声明（否则 DSH **静默不加载**浏览器侧 —— 见 plugin.mjs 的对应检查）
    pkg.dsh.client = {
      platform: 'web',
      inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-layout'],
    }
  }
  // ★ 兼容/能力声明放 `kaipu.*`（我们自己的命名空间）——
  //   DSH 官方不读这几个键，塞进 `dsh.*` 会让人以为官方在读。
  pkg.kaipu = { dshRange, declaredSurfaces: ['ui.panel'] }
  if (deps !== undefined) pkg.dependencies = deps
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, 'cordis.patch.yml'), `- insert:\n    - id: test-probe\n      name: '${TEST_ID}'\n`, 'utf8')
  writeFileSync(join(dir, 'lib/index.js'), `export const name = 'test-probe'\nexport function apply() {}\n`, 'utf8')
  writeFileSync(
    join(dir, 'lib/client.js'),
    badClient === true
      ? '/* 不是 closure-factory 形态 */\nconsole.log("oops")\n'
      : `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(TEST_ID)},\n  factory: function (require) { return {} },\n});\n`,
    'utf8',
  )
  return dir
}

const GOOD = { dshRange: '>=0.2.0-rc.2 <0.3.0' }

/* ═══════════════ 开跑 ═══════════════ */

safeRm(SANDBOX)
mkdirSync(PACKS, { recursive: true })
console.log(`插件生命周期验收（沙箱：${SANDBOX.replace(ROOT, '.')}）`)

const packV1 = makePack('probe-v1', { version: '0.1.0', ...GOOD })
const packV2 = makePack('probe-v2', { version: '0.2.0', ...GOOD })

/* ── ① 安装（user 来源 = 真拷贝）── */
console.log('\n── ① 安装 ──')
{
  const r = cli('install', packV1, '--source=user', '--enable')
  r.status === 0 ? ok('install 成功') : bad(`install 失败：${r.all.trim()}`)
  const p = find(TEST_ID)
  p ? ok('清单里出现该插件') : bad('清单里没有该插件')
  if (p) {
    p.source === 'user' ? ok('source = user') : bad(`source 应为 user，实为 ${p.source}`)
    p.enabled ? ok('enabled = true') : bad('enabled 应为 true')
    p.health === 'ok' ? ok('健康检查 = ok') : bad(`健康应为 ok，实为 ${p.health}：${p.problems.join(' / ')}`)
  }
  // ★ 真拷贝：安装位置不是源目录，且**目录名是稳定短名**（不带版本、不带源目录名）
  const installed = join(HOME, 'plugins', 'user', SHORT)
  existsSync(join(installed, 'package.json'))
    ? ok('已**拷贝**到 plugins/user/test-probe/（稳定位置 · 不是链接）')
    : bad('未拷贝到 plugins/user/test-probe/')
}

/* ── ② 停用 / 启用（AC-C01）── */
console.log('\n── ② 停用 / 启用（AC-C01）──')
{
  cli('disable', TEST_ID)
  const profile = JSON.parse(readFileSync(join(HOME, 'profiles', 'web', 'package.json'), 'utf8'))
  profile.dsh.profile.bundles.includes(TEST_ID) ? bad('停用后 bundles 里仍有它') : ok('停用 ⇒ 从 bundles 摘除')
  existsSync(join(HOME, 'profiles', 'web', 'node_modules', '@shanhai', SHORT))
    ? bad('停用后 node_modules 链接仍在（那只是"列表隐藏"，不是真停用）')
    : ok('停用 ⇒ node_modules 链接**断开**（真停用）')
  find(TEST_ID).enabled === false ? ok('state.enabled = false') : bad('state.enabled 未置 false')

  cli('enable', TEST_ID)
  JSON.parse(readFileSync(join(HOME, 'profiles', 'web', 'package.json'), 'utf8')).dsh.profile.bundles.includes(TEST_ID)
    ? ok('启用 ⇒ 回到 bundles') : bad('启用后 bundles 里没有它')
}

/* ── ③ 升级 + 回滚（AC-C07）── */
console.log('\n── ③ 升级 + 回滚（AC-C07）──')
{
  const r = cli('upgrade', TEST_ID, `--to=${packV2}`)
  r.status === 0 ? ok('upgrade 成功') : bad(`upgrade 失败：${r.all.trim()}`)
  const p = find(TEST_ID)
  p.version === '0.2.0' ? ok('版本 → 0.2.0') : bad(`版本应为 0.2.0，实为 ${p.version}`)
  p.rollbackTo === '0.1.0' ? ok('已留回滚点 0.1.0') : bad(`回滚点应为 0.1.0，实为 ${p.rollbackTo}`)
  existsSync(join(HOME, 'plugins-backup', SHORT, '0.1.0', 'package.json'))
    ? ok('旧版本已备份到 plugins-backup/') : bad('旧版本未备份')
  p.enabled ? ok('升级后处于启用态') : bad('升级后应启用')

  const rb = cli('rollback', TEST_ID)
  rb.status === 0 ? ok('rollback 成功') : bad(`rollback 失败：${rb.all.trim()}`)
  const q = find(TEST_ID)
  q.version === '0.1.0' ? ok('版本回到 0.1.0') : bad(`回滚后版本应为 0.1.0，实为 ${q.version}`)
  q.rollbackTo === '0.2.0' ? ok('回滚本身也可回滚（回滚点 → 0.2.0）') : bad('回滚点未反转')
}

/* ── ④ 卸载：代码走、数据留（AC-C03）── */
console.log('\n── ④ 卸载（AC-C03）──')
{
  const dataDir = join(HOME, 'plugins-data', SHORT)
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'customer-note.json'), '{"keep":"me"}\n', 'utf8')

  cli('uninstall', TEST_ID)
  find(TEST_ID) === undefined ? ok('清单里已移除') : bad('清单里还有它')
  existsSync(join(HOME, 'plugins', 'user', SHORT))
    ? bad('代码目录未移除') : ok('代码目录已移除（稳定位置 ⇒ 卸载后无残留）')
  existsSync(join(dataDir, 'customer-note.json'))
    ? ok('★ 数据**保留**（默认不删）') : bad('数据被误删 —— 违反 AC-C03')

  // 再装一次，然后 --purge-data
  cli('install', packV1, '--source=user', '--enable')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'customer-note.json'), '{"keep":"me"}\n', 'utf8')
  cli('uninstall', TEST_ID, '--purge-data')
  existsSync(dataDir) ? bad('--purge-data 后数据目录仍在') : ok('`--purge-data` ⇒ 数据一并清除（需显式要求）')

  // ★★ 内置插件卸载**绝不能删仓内源码**（p.path 指向 packages/plugin-*）
  const srcPkg = join(ROOT, 'packages', 'plugin-platform', 'package.json')
  cli('bootstrap')
  const un = cli('uninstall', '@shanhai/kaipu-platform')
  existsSync(srcPkg)
    ? ok('★★ 卸载**内置**插件不碰仓内源码（只解除挂载）')
    : bad('内置插件卸载把仓内源码删了 —— 灾难级')
  un.all.includes('不动仓内源码') ? ok('  且明确告知了这一点') : bad('  未告知"不动仓内源码"')
}

/* ── ⑤ 兼容性：先拒绝，再运行（A3）── */
console.log('\n── ⑤ 兼容性拒绝（A3）──')
{
  const cases = [
    ['DSH 版本不满足', makePack('bad-dsh', { version: '0.1.0', dshRange: '>=9.0.0' }), /DSH 版本不满足/],
    ['client bundle 形态错', makePack('bad-client', { version: '0.1.0', ...GOOD, badClient: true }), /closure-factory/],
    ['声明了运行期依赖', makePack('bad-deps', { version: '0.1.0', ...GOOD, deps: { 'left-pad': '^1.0.0' } }), /零外部依赖/],
    // ★ 这类是"安静失败"：装得上、清单正常、界面上什么都没有 —— 必须装前拦掉
    ['有 client 但没声明 dsh.client.platform', makePack('bad-no-client-decl', { version: '0.1.0', ...GOOD, omitClientDecl: true }), /dsh\.client\.platform/],
  ]
  for (const [label, dir, re] of cases) {
    const r = cli('install', dir, '--source=user', '--enable')
    const refused = r.status !== 0
    refused ? ok(`拒绝安装：${label}`) : bad(`本该拒绝却装上了：${label}`)
    if (refused) {
      re.test(r.all) ? ok(`  拒绝理由可读（${re.source}）`) : bad(`  拒绝理由没提到关键点：${r.all.trim().split('\n').slice(-2).join(' ')}`)
      find(TEST_ID) === undefined ? ok('  未留下半个安装（拒绝是干净的）') : bad('  被拒后 state 里仍有残留')
    }
  }
}

/* ── ⑥ sync 幂等 ── */
console.log('\n── ⑥ sync 幂等 ──')
{
  cli('install', packV1, '--source=user', '--enable')
  const a = readFileSync(join(HOME, 'profiles', 'web', 'package.json'), 'utf8')
  cli('sync')
  const b = readFileSync(join(HOME, 'profiles', 'web', 'package.json'), 'utf8')
  a === b ? ok('sync 两次结果一致（幂等）') : bad('sync 不幂等 —— profile 被改动了')
  const r = cli('health')
  r.status === 0 ? ok('health 全绿（exit 0）') : bad(`health 非 0：${r.all.trim()}`)
}

/* ── 收尾 ── */
cli('uninstall', TEST_ID)
safeRm(SANDBOX)

console.log('')
console.log('═'.repeat(56))
console.log(fails.length === 0
  ? `✓ 全绿：${pass} 项断言通过（Step 3a 动词 + 3b 兼容性拒绝）`
  : `✗ 失败 ${fails.length} 项 / 通过 ${pass} 项`)
for (const f of fails) console.log(`   · ${f}`)
process.exit(fails.length === 0 ? 0 : 1)
