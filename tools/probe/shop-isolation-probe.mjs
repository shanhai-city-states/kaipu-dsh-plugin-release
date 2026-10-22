#!/usr/bin/env node
/**
 * 山海·开铺 · 铺子资料层 · **隔离判据**（只读 · 可重复跑）
 * =====================================================================
 * 判据的目的**不是**证明"正常情况能过" —— 那是最没信息量的一种断言。
 * 它要证明两件事，缺一不可：
 *   ① **该过的能过**（正常文件名 / 自己的子目录 / 根本身）
 *   ② ★★ **不该过的过不去**（`..` 穿越 / 同前缀冒充 / 跨铺子 / 非法名）
 *
 * ★ 为什么 ② 才是重点：一个"永远返回 true"的实现能让 ① 全绿。
 *   只测 ① 是**假绿** —— 判据全过而闸门形同虚设。
 *
 * ★ 本探针**自带临时根**（`KAI_SHOP_DATA_ROOT`）⇒ 只读、可重复、不碰真实数据。
 * ★ 退出码：0 = 全过；1 = 有 FAIL。
 *
 * 用法：node tools/probe/shop-isolation-probe.mjs
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const LIB = join(ROOT, 'packages', 'plugin-platform', 'lib', 'remote', 'shop-files.js')

if (!existsSync(LIB)) {
  console.error(`✗ 找不到编译产物 ${LIB}`)
  console.error('  ⇒ 先跑 node tools/build.mjs（本判据扫的是产物，不是 src —— 漏跑 tsc 时能抓到）')
  process.exit(2)
}

/* ── 临时根：**必须在 import 之前设**（模块读 env 是调用期，但早设早安心）── */
const TMP = join(tmpdir(), `kaipu-shop-probe-${String(process.pid)}`)
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
process.env.KAI_SHOP_DATA_ROOT = TMP

const m = await import(pathToFileURL(LIB).href)

let total = 0
let failed = 0
const ok = (cond, label) => {
  total++
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}`)
  }
}

console.log(`\n铺子资料 · 隔离判据（临时根 ${TMP}）`)

/* ══════════ A. 路径收敛 ══════════ */
console.log('\n── A. 路径收敛（★ 否定样本才是重点）──')
const SHOP = join(TMP, 'shops', 'shopkey', '待审材料')
ok(m.isPathInShop(SHOP, SHOP) === true, '根自己算在内')
ok(m.isPathInShop(SHOP, join(SHOP, 'a.txt')) === true, '自己的直接子文件')
ok(m.isPathInShop(SHOP, join(SHOP, 'nested', 'deep.txt')) === true, '自己的嵌套子文件')
ok(m.isPathInShop(SHOP, join(SHOP, '..', 'evil.txt')) === false, '★ `..` 穿越必须拒')
ok(m.isPathInShop(SHOP, join(SHOP, '..', '..', '..', 'etc', 'passwd')) === false, '★ 多级 `..` 必须拒')
ok(m.isPathInShop(SHOP, resolve(SHOP, '../../..')) === false, '★ 上跳到父级必须拒')
ok(m.isPathInShop(SHOP, join(SHOP + '-evil', 'x.txt')) === false, '★ 同前缀（`…待审材料-evil`）不算在内')
ok(m.isPathInShop(SHOP, join(SHOP, '..foo', 'x.txt')) === true, '★ `..foo` 是**合法文件名**，不许误杀')

/* ══════════ B. 铺子 key 派生 ══════════ */
console.log('\n── B. 铺子 key 派生 ──')
ok(m.shopKeyOf('cli-trial') === 'cli-trial', '干净身份直接用（人可读）')
ok(m.shopKeyOf('') === 'default', '空身份有兜底（不是空目录名）')
ok(m.shopKeyOf('   ') === 'default', '全空白同空')
ok(m.shopKeyOf('ABC') === m.shopKeyOf('abc'), '★ 大小写折叠（本机文件系统不区分大小写）')
ok(m.shopKeyOf('A/B') !== m.shopKeyOf('A-B'), '★ 两个不同身份**不可折叠**进同一目录（串味）')
const weird = m.shopKeyOf('../../etc/passwd')
ok(!weird.includes('/') && !weird.includes('\\'), '★ 派生结果不含路径分隔符')
ok(!weird.includes('..'), '★ 派生结果不含 `..`')

/* ══════════ C. 文件名安全 ══════════ */
console.log('\n── C. 文件名安全 ──')
ok(m.safeFileName('report-v2.md') === 'report-v2.md', '正常名原样通过')
ok(m.safeFileName('..\\..\\evil.txt') === 'evil.txt', '★ 含目录的名字被**剥离**（拦的是路径，不是改名）')
ok(m.safeFileName('..') === null, '★ `..` 必须拒')
ok(m.safeFileName('.') === null, '★ `.` 必须拒')
ok(m.safeFileName('') === null, '★ 空名必须拒')
ok(m.safeFileName('a<b>.txt') === null, '保留字符必须拒')
ok(m.safeFileName('trailing.') === null, '★ 以点结尾必须拒（Windows 上会静默变形）')

/* ══════════ D. 真写盘（端到端）══════════ */
console.log('\n── D. 真写盘：越界尝试最终落在哪 ──')
const ensured = m.ensureShop('probe-shop')
ok(ensured.ok === true, '建铺子成功')
ok(m.pluginDataRoot() === resolve(TMP), '★ 环境变量覆盖生效（探针不碰真实数据）')

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
const w = m.writeShopFiles('probe-shop', '待审材料', [{ name: '../../escape.txt', base64: b64('payload') }])
const drawer = m.shopDirOf('probe-shop', '待审材料')
ok(w.ok === true && w.value.written.length === 1, '写入成功')
ok(existsSync(join(drawer, 'escape.txt')) === true, '★ 穿越名被剥离后仍落在**抽屉内**')
ok(existsSync(join(TMP, 'escape.txt')) === false, '★ 没有写到抽屉外面（tmp 根下无该文件）')

const bad = m.writeShopFiles('probe-shop', '待审材料', [{ name: 'bad<name>.txt', base64: b64('x') }])
ok(bad.ok === true && bad.value.failed.length === 1, '★ 非法名进 `failed`（逐个报原因），不静默丢弃')

// ★★ 这一条专门盯"编码判据是不是假判据"：
//   `Buffer.from(x,'base64')` 对非法字符**静默忽略** ⇒ 若只靠它，这段坏数据会被
//   写成一份"看不出错"的歪文件。本仓因此改用**形态正则**先行 —— 这条断言就是它的看护。
const badB64 = m.writeShopFiles('probe-shop', '待审材料', [
  { name: 'x.txt', base64: '这不是 base64 !!!' },
])
ok(
  badB64.ok === true && badB64.value.failed.length === 1 && badB64.value.written.length === 0,
  '★ 坏 base64 必须被拒（这条断言是**能失败**的，不是恒真）',
)
ok(existsSync(join(drawer, 'x.txt')) === false, '★ 坏内容没有被写成一个歪文件')

const listed = m.listShopFiles('probe-shop', '待审材料')
ok(listed.ok === true && listed.value.some((f) => f.name === 'escape.txt'), '列得到刚写的文件')
ok(listed.value.every((f) => f.sub === '待审材料'), '条目自报所属抽屉')

const rm1 = m.removeShopFile('probe-shop', '待审材料', '../../escape.txt')
ok(rm1.ok === true, '★ 删除同样过闸门（穿越名被剥离后命中真实文件）')

/* ══════════ E. 跨铺子不串味 ══════════ */
console.log('\n── E. 跨铺子隔离 ──')
m.ensureShop('shop-a')
m.ensureShop('shop-b')
ok(m.shopDirOf('shop-a', '待审材料') !== m.shopDirOf('shop-b', '待审材料'), '★ 两个铺子落不同目录')
ok(m.isPathInShop(m.shopDirOf('shop-b', '待审材料'), m.shopDirOf('shop-a', '待审材料')) === false, '★ A 的抽屉不在 B 的抽屉里')

/* ══════════ F. 打开目录（openShopDir）—— ★ 只测"不该开的开不了" ══════════ */
console.log('\n── F. 打开目录：闸门 ──')
/*
 * ★★ 这一段**故意不测 happy path**，理由不是省事：
 *
 *   它的成功路径会**真的启动系统文件管理器** —— 一个"可重复跑"的判据
 *   每跑一次就弹一个窗口，那是**判据在骚扰用它的人**。
 *   而且它要断的东西（"窗口到底弹出来了没有"）在本函数里**本来就无法确证**
 *   —— 源码末句写得很清楚：只回"**已发起**"。
 *   ⇒ 分工：**自动判据只守闸门**（这一段，零副作用）；
 *     "点一下真能打开"由**真机探针**走 UI 按钮验一次（run-view-probe 的 ⑩ 段，
 *     带 --open-dir 开关才真点）—— 那种验证需要人看着，不该混进单元层。
 *
 * ★ 这几条全是**否定样本**：闸门一旦被放宽（例如"收路径不收枚举"），它们会当场变红。
 */
const odEsc = m.openShopDir('probe-shop', '../..')
ok(odEsc.ok === false && odEsc.code === 'bad-subdir', '★ 越界串当抽屉名 ⇒ 拒（bad-subdir），不落到路径')
const odAbs = m.openShopDir('probe-shop', 'C:\\Windows')
ok(odAbs.ok === false && odAbs.code === 'bad-subdir', '★ 绝对路径当抽屉名 ⇒ 拒 ⇒ 外面**根本传不进路径**')
const odOther = m.openShopDir('probe-shop', '不存在的抽屉')
ok(odOther.ok === false && odOther.code === 'bad-subdir', '★ 枚举外的中文名也拒（是**先枚举后查**，不是"查不到才拒"）')
ok(
  m.isShopSubdir('待审材料') === true && m.isShopSubdir('审校报告') === true && m.isShopSubdir('草稿') === true,
  '枚举闸门：三个合法抽屉名都过（收紧的是"只认这三个"）',
)
const odMissing = m.openShopDir('probe-shop-没建过', '待审材料')
ok(
  odMissing.ok === false && odMissing.code === 'not-found',
  '★ 目录还没建出来 ⇒ not-found（如实说"还没建"，不假装开了）',
)
ok(
  typeof odEsc.error === 'string' && odEsc.error !== '' && !/^[a-z-]+$/.test(odEsc.error),
  '★ 拒绝时带**人话原因**（界面直接显示它，所以不能吐裸码）',
)

/* ── 收尾 ── */
rmSync(TMP, { recursive: true, force: true })

const neg = total
console.log(`\n共 ${String(neg)} 条断言，失败 ${String(failed)} 条`)
console.log(failed === 0 ? '全过 ✓（含否定样本 —— 闸门确实会拒）' : '★ 有 FAIL')
process.exit(failed === 0 ? 0 : 1)
