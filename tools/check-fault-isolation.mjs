#!/usr/bin/env node
/**
 * 山海·开铺 · 故障隔离验收（Step 3c · AC-C02）
 * =====================================================================
 * 断言：**一个插件坏掉，不等于整站白屏**（在零宿主改动的前提下）。
 *
 * ── 为什么要**真的把插件搞坏**再验 ──────────────────────────────
 *   「加载失败只影响自己」这句话靠读代码推不出来 —— DSH 的 client module 是
 *   lazy CJS table，一个 bundle 抛错会怎样取决于 loader 的错误处理路径。
 *   003 的教训就在眼前：**list 座位漏一个 `id`，apply 抛错 ⇒ 整站白屏**。
 *   ⇒ 只有"造一个真坏的插件、真重启一次"才算验过。实测结论（见阶段 B 取证）：
 *     ★ **DSH 的 client 启动是「全或无」的，没有插件级错误边界。**
 *
 * ── ★★ 三个阶段的 DSH_HOME **必须彼此独立**（这是本脚本踩过两次的地方）──
 *   第一版三段复用同一个 DSH_HOME，于是：被强杀的实例留下
 *   `<DSH_HOME>/.credentials.yaml.lock`，下一段启动就永远卡在
 *   `atomic-write: timed out waiting for the writer lock`（**不是插件问题，是残留**）。
 *   清 lock 只是治标 —— 只要还复用，就还有别的残留（半写状态、进程未死透、端口）。
 *   ⇒ 改成**每段一个全新 DSH_HOME**（各自 `KAI_DEV_DIR`），段间零共享：
 *     每个 home 只被使用一次，**结构上就不存在跨段争用**。
 *
 * 前置：`KAI_DSH_REPO` 指向 DSH 仓库根（**不写进源码** —— 那是本机路径）。
 * 用法：  KAI_DSH_REPO=<DSH 仓库> node tools/check-fault-isolation.mjs
 * 退出码：0 = 全绿；1 = 有失败
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const NODE = process.execPath
const PLUGIN_CLI = join(HERE, 'plugin.mjs')

const DSH_REPO = process.env['KAI_DSH_REPO']
if (DSH_REPO === undefined || DSH_REPO === '' || !existsSync(DSH_REPO)) {
  console.error('✗ 需要 KAI_DSH_REPO=<DSH 仓库根>（本仓不存本机绝对路径）')
  process.exit(2)
}

const SANDBOX = join(ROOT, 'dev', '.fault-sandbox')
const PACK = join(SANDBOX, '_pack-fault-probe')
const APP_PORT = '3091'
const CDP_PORT = '9223'
const PROBE_ID = '@shanhai/fault-probe'
const PROBE_LABEL = '故障探针'
const EVIDENCE = join(ROOT, 'docs', 'evidence')

/**
 * 找浏览器（要支持 CDP）。
 * ★ 不写死本机路径 —— 干净版扫描会把**硬编码的 Program Files 路径**判为 FAIL
 *   （那类路径换机器就断）。用环境变量拼；也可 `KAI_EDGE=<path>` 指定。
 */
function findBrowser() {
  const fromEnv = process.env['KAI_EDGE']
  if (fromEnv !== undefined && fromEnv !== '' && existsSync(fromEnv)) return fromEnv
  const roots = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles'], process.env['LOCALAPPDATA']]
  const rels = ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe']
  for (const r of roots) {
    if (r === undefined || r === '') continue
    for (const rel of rels) {
      const p = join(r, rel)
      if (existsSync(p)) return p
    }
  }
  return null
}
const BROWSER = findBrowser()
if (BROWSER === null) {
  console.error('✗ 找不到 Edge/Chrome。用 KAI_EDGE=<可执行文件路径> 指定一个。')
  process.exit(2)
}

let pass = 0
const fails = []
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fails.push(m); console.log(`  ✗ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** ★ 本机 spawnSync 只要 stdin 接 pipe 就 EBUSY ⇒ 一律 stdin: 'ignore' */
function run(cmd, args, env) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '', ...(env ?? {}) },
  })
  const why = r.error ? `\n[spawn error] ${r.error.message}` : ''
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}${why}` }
}

async function portPid(port) {
  const r = run('netstat', ['-ano'])
  const line = r.out.split('\n').find((l) => l.includes('LISTENING') && l.includes(`:${port} `))
  if (line === undefined) return null
  const pid = line.trim().split(/\s+/).pop()
  return /^\d+$/.test(pid) ? pid : null
}
async function freePort(port) {
  for (let i = 0; i < 10; i++) {
    const pid = await portPid(port)
    if (pid === null) return
    run('taskkill', ['/PID', pid, '/T', '/F']) // ★ 必须 /T：不清子树会留残留
    await sleep(500)
  }
}

/* ═══════════════ 造「故障探针」包 ═══════════════ */

function makeProbePack() {
  rmSync(PACK, { recursive: true, force: true })
  mkdirSync(join(PACK, 'lib'), { recursive: true })
  const panelId = 'shanhai-fault-probe'
  writeFileSync(join(PACK, 'package.json'), `${JSON.stringify({
    name: PROBE_ID, version: '0.1.0', private: true, type: 'module',
    main: 'lib/index.js', types: 'lib/index.d.ts',
    exports: {
      '.': { types: './lib/index.d.ts', default: './lib/index.js' },
      './client': { types: './lib/client/index.d.ts', default: './lib/client.js' },
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    files: ['lib/**/*.js', 'lib/**/*.d.ts', 'cordis.patch.yml'],
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      // ★★ 必须有：DSH 靠它判断"这包有没有浏览器侧"，缺了**静默不加载**
      //    （不报错、不白屏、清单正常、界面上就是没入口）。
      //    第一版这个测试包就漏了 —— 于是顺带在 plugin.mjs 里加了这条**安装期检查**。
      client: {
        platform: 'web',
        inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'],
      },
    },
    // ★ 兼容/能力声明放 `kaipu.*`（我们自己的命名空间），不塞进 dsh.*
    kaipu: { dshRange: '>=0.2.0-rc.2 <0.3.0', declaredSurfaces: ['ui.panel', 'ui.slot'] },
  }, null, 2)}\n`, 'utf8')
  writeFileSync(join(PACK, 'cordis.patch.yml'), `- insert:\n    - id: fault-probe\n      name: '${PROBE_ID}'\n`, 'utf8')
  writeFileSync(join(PACK, 'lib/index.js'), `export const name = 'fault-probe'\nexport function apply() {}\n`, 'utf8')
  writeFileSync(join(PACK, 'lib/client.js'), `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PROBE_ID)},
  factory: function (require) {
    'use strict';
    var react = require('react');
    var PANEL_ID = ${JSON.stringify(panelId)};
    var Panel = function () { return react.createElement('div', null, '故障探针面板') };
    var Icon = function () { return react.createElement('span', { 'aria-label': ${JSON.stringify(PROBE_LABEL)} }, 'F') };
    var exports = {};
    exports.inject = ['slots'];
    exports.apply = function (ctx) {
      ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel);
      });
      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 99,
          label: function () { return ${JSON.stringify(PROBE_LABEL)}; },
        }, Icon);
      });
    };
    return exports;
  },
});
`, 'utf8')
}

/* ═══════════════ 每段一个独立 DSH_HOME ═══════════════ */

function prepareHome(name, { corrupt }) {
  const devDir = join(SANDBOX, name)
  const home = join(devDir, 'dsh-home')
  const cli = (...args) => run(NODE, [PLUGIN_CLI, ...args], { KAI_DEV_DIR: devDir })
  const b = cli('bootstrap')
  if (b.status !== 0) throw new Error(`bootstrap 失败：${b.all.trim()}`)
  const i = cli('install', PACK, '--source=user', '--enable')
  if (i.status !== 0) throw new Error(`安装故障探针失败：${i.all.trim()}`)
  if (corrupt === true) {
    const target = join(home, 'plugins', 'user', 'fault-probe', 'lib', 'client.js')
    if (!existsSync(target)) throw new Error('找不到已安装副本的 client bundle')
    writeFileSync(target, '/* 损坏：不是 closure-factory，执行即抛 */\nthrow new Error("boom");\n', 'utf8')
  }
  return { devDir, home, cli }
}

async function startDsh(home) {
  await freePort(APP_PORT)
  let log = ''
  const child = spawn(NODE, ['--expose-internals', '--import', 'tsx/esm', 'apps/cli/src/bin.ts',
    'web', '--no-open', '--port', APP_PORT], {
    cwd: DSH_REPO, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_HOME: home },
  })
  child.stdout.on('data', (d) => { log += d.toString() })
  child.stderr.on('data', (d) => { log += d.toString() })
  for (let i = 0; i < 90; i++) {
    if (/dsh web: http/.test(log)) {
      const token = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/.exec(log)?.[1]
      return { child, token }
    }
    await sleep(1000)
  }
  throw new Error(`DSH 未在 90s 内就绪。日志尾部：\n${log.slice(-900)}`)
}

let browser = null
async function startBrowser(url, phase) {
  await freePort(CDP_PORT)
  // ★ 每阶段一个全新 profile 目录 —— 复用会因占用而"CDP 连上但页面空 DOM"，极易误读成插件问题
  const profile = join(SANDBOX, `edge-${phase}-${Date.now()}`)
  browser = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', url],
  { stdio: ['ignore', 'pipe', 'pipe'] })
  await sleep(3000)
}
function stopBrowser() { if (browser !== null) { try { browser.kill() } catch { /* 已退 */ } browser = null } }
function stopDsh(c) { if (c !== null) { try { c.kill() } catch { /* 已退 */ } } }

const probe = (...args) => run(NODE, [join(HERE, 'probe', 'panel-probe.mjs'),
  `--cdp=${CDP_PORT}`, `--port=${APP_PORT}`, ...args])

/* ═══════════════════════ 开跑 ═══════════════════════ */

console.log(`故障隔离验收（AC-C02）· 沙箱 ${relative(ROOT, SANDBOX)}`)
mkdirSync(SANDBOX, { recursive: true })
makeProbePack()
console.log('  （已造好「故障探针」测试包）')

/* ── 阶段 A：三个插件都健康 ── */
console.log('\n── 阶段 A：三个插件都健康（独立 DSH_HOME A）──')
let dsh = null
try {
  const a = prepareHome('a', { corrupt: false })
  ok('A 环境就位（两个内置 + 故障探针）')
  dsh = await startDsh(a.home)
  ok('DSH 起来')
  await startBrowser(dsh.token, 'a')
  const r = probe(`--expect=开铺,智囊团,${PROBE_LABEL}`)
  r.status === 0 ? ok('三个入口都在（开铺 / 智囊团 / 故障探针）') : bad(`阶段 A 探针失败：\n${r.out}${r.err}`)
} catch (e) {
  bad(`阶段 A 异常：${e.message}`)
}
stopBrowser(); stopDsh(dsh); dsh = null; await freePort(APP_PORT)

/* ── 阶段 B（取证）：带坏插件直接启动 ── */
console.log('\n── 阶段 B（取证）：带坏插件**直接启动**（独立 DSH_HOME B）──')
try {
  const b = prepareHome('b', { corrupt: true })
  const h = b.cli('health')
  h.status !== 0 ? ok('清单 health 已报出 broken（exit≠0）') : bad('清单没报出 broken')
  b.cli('list').out.includes('broken') ? ok('list 里显示 broken（+ 原因）') : bad('list 未显示 broken')

  dsh = await startDsh(b.home)
  ok('DSH 进程起来了（服务端没崩）')
  await startBrowser(dsh.token, 'b')
  const r = probe('--expect=开铺')
  // ★ 这里**预期失败** —— 要取的是"失败的样子"，不是"通过"。
  r.status !== 0 ? ok('（预期内）界面上**没有**「开铺」—— 宿主没渲染出来')
    : bad('意外：带坏插件居然还能渲染（那上游行为变了，本脚本结论要更新）')
  const said = `${r.out}${r.err}`
  said.includes('import failed') || said.includes('did not activate')
    ? ok('★ 上游**有明确提示**：页面直接写了 "import failed … did not activate"')
    : bad(`没抓到上游失败提示 —— 现场：\n${said.slice(-700)}`)
  console.log('')
  console.log('   ⟹ 取证结论：**DSH 的 client 模块启动是「全或无」的** ——')
  console.log('      任一个 bundle import 失败 ⇒ 整个 web shell 不渲染（真白屏），')
  console.log('      **没有插件级错误边界**。属**上游限制**（004 §A7 早已预警）。')
  console.log('      又因「零宿主改动」是硬纪律 ⇒ 缓解只能落在我们这层（见阶段 C）。')
} catch (e) {
  bad(`阶段 B 异常：${e.message}`)
}
stopBrowser(); stopDsh(dsh); dsh = null; await freePort(APP_PORT)

/* ── 阶段 C：缓解手段 —— preflight + 熔断 ── */
console.log('\n── 阶段 C：★ 缓解手段 —— 启动前 preflight + 坏插件熔断（独立 DSH_HOME C）──')
try {
  const c = prepareHome('c', { corrupt: true })
  const noHeal = c.cli('preflight')
  noHeal.status !== 0 ? ok('preflight（不 auto-heal）⇒ 拒绝放行（exit≠0）') : bad('preflight 没拦住坏插件')
  noHeal.all.includes('不要直接启动') ? ok('  且明确警告"不要直接启动"（避免用户踩白屏）') : bad('  未给出警告')

  const heal = c.cli('preflight', '--auto-heal')
  heal.status === 0 ? ok('preflight --auto-heal ⇒ 处置成功（exit 0）') : bad(`auto-heal 失败：${heal.all.trim()}`)
  heal.all.includes('已自动禁用') ? ok('  坏插件已自动禁用（熔断）') : bad('  未看到自动禁用')

  const rows = JSON.parse(c.cli('list', '--json').out).plugins
  rows.find((x) => x.id === PROBE_ID)?.enabled === false ? ok('  清单里故障探针 enabled = false') : bad('  它仍为启用')
  rows.filter((x) => x.enabled).every((x) => x.health === 'ok') ? ok('  其余启用插件全部健康') : bad('  仍有不健康的启用插件')

  dsh = await startDsh(c.home)
  ok('★ 熔断后宿主**正常启动**（无警告、无白屏）')
  await startBrowser(dsh.token, 'c')
  const r = probe('--expect=开铺,智囊团', `--absent=${PROBE_LABEL}`,
    `--shot=${join(EVIDENCE, 'step3-03-熔断后宿主正常.png')}`)
  r.status === 0
    ? ok('★★ 开铺/智囊团**照旧可用**，故障探针已消失 —— 故障隔离成立（由我们这层兜住）')
    : bad(`阶段 C 探针失败：\n${r.out}${r.err}`)
} catch (e) {
  bad(`阶段 C 异常：${e.message}`)
}
stopBrowser(); stopDsh(dsh); await freePort(APP_PORT); await freePort(CDP_PORT)

console.log('')
console.log('═'.repeat(56))
console.log(fails.length === 0 ? `✓ 全绿：${pass} 项（AC-C02 故障隔离成立）` : `✗ 失败 ${fails.length} / 通过 ${pass}`)
for (const f of fails) console.log(`   · ${f}`)
process.exit(fails.length === 0 ? 0 : 1)
