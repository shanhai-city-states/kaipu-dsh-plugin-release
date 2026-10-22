#!/usr/bin/env node
/**
 * 山海·开铺 · **面板注册六字段判据**（`check-panel-registry.mjs`）
 * =====================================================================
 * ★ 为什么需要它：面板注册六字段（`panelId` / `displayName` / `description` /
 *   `entryId` / `parent` / `siblings`）是**三插件平级共存的最低公共约定**。
 *   这类字段的特点与 `order` 一样：**写错了不会报错，只有用户/审核看得出来**
 *   （门牌号两处不同 ⇒ 侧边栏点进去是空面板；`entryId` 写成 URL ⇒ 宿主无此路由）。
 *
 * ★ 本期落法（领队终审 R-8 定 C 案）：六字段落 `package.json → kaipu.panel`
 *   （本仓自有声明块，DSH 官方不读）。**不塞进 `cordis.patch.yml` 的 config**
 *   —— 那里是「能力开关」层，且既有注释写死「形状对齐 wisdom/platform 两包（扁平 key）」
 *   与嵌套 `config.panel` 正面冲突。
 *
 * ── 判据六条（施工照此值，逐条可被验伪）─────────────────────────────────
 *   ① **必填四字段齐**：panelId / displayName / description / entryId（缺一即红）
 *   ② **panelId 三处同值**：`package.json kaipu.panel.panelId`
 *      == `cordis.patch.yml` 的 `id` == `src/client/panel-id.ts` 的 `WORKSTATION_PANEL_ID`
 *   ③ **entryId 是逻辑标识**：匹配 `^[a-z][a-z0-9-]*$`，且**不得含** `#/`、`/`、`://`
 *      （R-1：`entryRoute`→`entryId`。DSH 当前无 URL hash 路由，写 URL 就是假承诺）
 *   ④ **`parent` 零代号进发布面**：发布面五件对 `shanhai-base` **零命中**
 *      （R-2：`parent` 本期不填值；不填＝零代号进面，优于换填另一个代号）
 *   ⑤ **`siblings` 必须缺席**：三包声明里出现即红
 *      （R-3：单源派生未就位 ⇒ 宁缺不假；现盘 platform/wisdom 都没有这字段）
 *   ⑥ **上屏名同源**：`locale/zh.json` 与 `locale/en.json` 的 `meta.title`
 *      **均非空且互不相等**；且 `src/client/index.ts` 的 `label()` 返回值
 *      必须是 zh `meta.title` 的**子串**（防两处手抄漂移）
 *
 * ★ 本判据**自带阴面对照**（G 组）：用内存假样本证明每条断言真的会红，
 *   否则"跑过了"可能只是"没断言"（本仓有假绿前科，见 `check-theme-tokens.mjs` 头注释）。
 *
 * 用法：node tools/check-panel-registry.mjs
 * 退出码：0 = 全过；1 = 有 FAIL
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
/* ★ R-13：清单只从唯一出处取，**禁止**在本文件里再写一份 packages/plugin-* 字面量 */
import { PLUGINS, panelDeclOf } from './panel-plugins.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 本判据看护的包（六字段的"起点"，其余两包只做 ⑤ 的存在性检查） */
const WORKSTATION = 'packages/plugin-workstation'

/** `entryId` 形制：小写字母开头、只允许小写字母/数字/连字符 */
const ENTRY_ID_RE = /^[a-z][a-z0-9-]*$/
/** 不得出现的 URL 痕迹（写进 entryId 就是假承诺：宿主没有 hash 路由） */
const URL_TRACES = ['#/', '://', '/']

/** R-2：本期 `parent` 不填值 ⇒ 发布面任何一处都不许出现这个内部架构代号 */
const FORBIDDEN_PARENT = 'shanhai-base'

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failed++
}
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)

console.log('面板注册六字段判据\n')

/* ══════════════════════════════════════════════════════════════════
   ① 必填四字段齐
   ══════════════════════════════════════════════════════════════════ */
const REQUIRED = ['panelId', 'displayName', 'description', 'entryId']
const panel = panelDeclOf(ROOT, WORKSTATION)

console.log('── ① 必填字段齐（panelId / displayName / description / entryId）──')
say(panel !== null, `${WORKSTATION}：有 kaipu.panel 声明块（六字段落 package.json · 官方不读）`)
if (panel === null) {
  console.log('\n✗ 没有声明块 ⇒ 后续断言无从谈起\n')
  process.exit(1)
}
for (const k of REQUIRED) {
  const v = panel[k]
  say(typeof v === 'string' && v.trim() !== '', `kaipu.panel.${k} 非空（= ${JSON.stringify(v)}）`)
}

/* ══════════════════════════════════════════════════════════════════
   ② panelId 三处同值
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── ② panelId 三处同值（package.json ↔ patch id ↔ panel-id.ts）──')
const panelIdPkg = typeof panel.panelId === 'string' ? panel.panelId : null
const patchText = read(join(ROOT, WORKSTATION, 'cordis.patch.yml'))
const patchId = patchText === null ? null : (/^\s*-?\s*id:\s*([^\s#]+)/m.exec(patchText)?.[1] ?? null)
const idFileText = read(join(ROOT, WORKSTATION, 'src/client/panel-id.ts'))
const panelIdConst = idFileText === null ? null : /WORKSTATION_PANEL_ID\s*=\s*'([^']+)'/.exec(idFileText)?.[1] ?? null

say(panelIdPkg !== null, `package.json kaipu.panel.panelId = ${JSON.stringify(panelIdPkg)}`)
say(patchId !== null, `cordis.patch.yml id = ${JSON.stringify(patchId)}`)
say(panelIdConst !== null, `src/client/panel-id.ts WORKSTATION_PANEL_ID = ${JSON.stringify(panelIdConst)}`)
say(
  panelIdPkg !== null && panelIdPkg === patchId && panelIdPkg === panelIdConst,
  `三处同值：${JSON.stringify([panelIdPkg, patchId, panelIdConst])}`,
)

/* ══════════════════════════════════════════════════════════════════
   ③ entryId 形制（R-1：逻辑标识，不是 URL）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── ③ entryId 形制（逻辑标识 · 非 URL）──')
const entryId = typeof panel.entryId === 'string' ? panel.entryId : null
say(entryId !== null && ENTRY_ID_RE.test(entryId), `entryId=${JSON.stringify(entryId)} 匹配 ${ENTRY_ID_RE}`)
const traces = entryId === null ? [] : URL_TRACES.filter((t) => entryId.includes(t))
say(traces.length === 0, `entryId 不含 URL 痕迹（检查了 ${URL_TRACES.map((t) => JSON.stringify(t)).join(' / ')}）`)

/* ══════════════════════════════════════════════════════════════════
   ④ parent 零代号进发布面（R-2）
   ══════════════════════════════════════════════════════════════════ */
console.log(`\n── ④ 发布面五件对 ${FORBIDDEN_PARENT} 零命中（parent 本期不填值）──`)
const RELEASE_FILES = [
  `${WORKSTATION}/package.json`,
  `${WORKSTATION}/cordis.patch.yml`,
  `${WORKSTATION}/README.md`,
  `${WORKSTATION}/locale/zh.json`,
  `${WORKSTATION}/locale/en.json`,
  'market/shanhai-city-states__kaipu-dsh-plugin-release--packages-plugin-workstation.yml',
]
let parentHits = 0
for (const rel of RELEASE_FILES) {
  const text = read(join(ROOT, rel))
  if (text === null) {
    say(false, `${rel}：文件不存在（发布面缺件）`)
    continue
  }
  const n = text.split(FORBIDDEN_PARENT).length - 1
  parentHits += n
  say(n === 0, `${rel}：${n} 处${n === 0 ? '' : ` ⟵ 发布面不许出现内部架构代号`}`)
}

/* ══════════════════════════════════════════════════════════════════
   ⑤ siblings 必须缺席（R-3）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── ⑤ siblings 在三包声明中必须缺席（单源派生未就位 ⇒ 宁缺不假）──')
let siblingHits = 0
for (const dir of PLUGINS) {
  const p = panelDeclOf(ROOT, dir)
  if (p === null) {
    /* platform/wisdom 本期没有 panel 块 —— 缺席本身就是合法态，打印说明不判红 */
    console.log(`  · ${dir}：无 kaipu.panel 声明（本期只要求工位声明；缺席 ≠ 失败）`)
    continue
  }
  const has = Object.prototype.hasOwnProperty.call(p, 'siblings')
  siblingHits += has ? 1 : 0
  say(!has, `${dir}：siblings ${has ? '出现了 ⟵ 必须缺席' : '缺席（正确）'}`)
}
say(siblingHits === 0, `三包 siblings 命中合计 = ${siblingHits}（期望 0）`)

/* ══════════════════════════════════════════════════════════════════
   ⑥ 上屏名同源（R-5）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── ⑥ displayName ↔ locale 同源（不写死第三份文案）──')
const zhText = read(join(ROOT, WORKSTATION, 'locale/zh.json'))
const enText = read(join(ROOT, WORKSTATION, 'locale/en.json'))
const titleOf = (t) => {
  if (t === null) return null
  try {
    return JSON.parse(t)?.meta?.title ?? null
  } catch {
    return null
  }
}
const zhTitle = titleOf(zhText)
const enTitle = titleOf(enText)
say(typeof zhTitle === 'string' && zhTitle.trim() !== '', `zh meta.title 非空（= ${JSON.stringify(zhTitle)}）`)
say(typeof enTitle === 'string' && enTitle.trim() !== '', `en meta.title 非空（= ${JSON.stringify(enTitle)}）`)
say(zhTitle !== null && enTitle !== null && zhTitle !== enTitle, 'zh / en title 互不相等（两种语言，不是同一句）')

const clientIndex = read(join(ROOT, WORKSTATION, 'src/client/index.ts'))
const labelReturn = clientIndex === null ? null : /label:\s*\(\)\s*=>\s*'([^']*)'/.exec(clientIndex)?.[1] ?? null
say(labelReturn !== null, `src/client/index.ts 的 label() 返回字面量（= ${JSON.stringify(labelReturn)}）`)
say(
  typeof labelReturn === 'string' && typeof zhTitle === 'string' && zhTitle.includes(labelReturn),
  `上屏名同源：label()=${JSON.stringify(labelReturn)} ⊂ zh meta.title=${JSON.stringify(zhTitle)}`,
)
say(
  typeof panel.displayName === 'string' && !panel.displayName.includes('山海'),
  `displayName 只声明文案 key（= ${JSON.stringify(panel.displayName)}），不写死文案`,
)

/* ══════════════════════════════════════════════════════════════════
   G 组 · 阴面对照（证明每条断言真的会红，不是"没断言"）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── G. 阴面对照：判据真的会 FAIL 吗（内存假样本 · 不动磁盘）──')

/** 纯判定函数（与上面 ③ ④ ⑤ ⑥ 同口径），返回 true = 应该 FAIL */
const entryIdBad = (v) => !ENTRY_ID_RE.test(v) || URL_TRACES.some((t) => v.includes(t))
const parentBad = (text) => text.includes(FORBIDDEN_PARENT)
const siblingBad = (p) => Object.prototype.hasOwnProperty.call(p, 'siblings')
const labelBad = (label, zh) => typeof label !== 'string' || typeof zh !== 'string' || !zh.includes(label)

say(!entryIdBad('workstation'), 'G0 对照基准：entryId="workstation" ⇒ 判**过**（不是一律 FAIL 的假判据）')
say(entryIdBad('#/panel/workstation'), 'G1 注入 URL 形态 entryId ⇒ 必红（③ 真的在看）')
say(entryIdBad('Work Station'), 'G2 注入大写/空格 ⇒ 必红（形制正则真的在看）')
say(!parentBad('这是一段普通描述'), 'G3 对照基准：无代号文本 ⇒ 判**过**')
say(parentBad(`父面板 ${FORBIDDEN_PARENT}`), 'G4 注入内部架构代号 ⇒ 必红（④ 真的在看）')
say(!siblingBad({ panelId: 'x' }), 'G5 对照基准：无 siblings ⇒ 判**过**')
say(siblingBad({ panelId: 'x', siblings: [] }), 'G6 注入 siblings ⇒ 必红（⑤ 真的在看）')
say(!labelBad('工位', '山海·开铺 工位'), 'G7 对照基准：label 是 title 子串 ⇒ 判**过**')
say(labelBad('工位台', '山海·开铺 工位'), 'G8 改 label 为 title 之外的值 ⇒ 必红（⑥ 真的在看）')

console.log(`\n${failed === 0 ? '✓ 全过：面板注册六字段齐且四处口径一致' : `✗ 有 ${failed} 条 FAIL`}`)
process.exit(failed === 0 ? 0 : 1)
