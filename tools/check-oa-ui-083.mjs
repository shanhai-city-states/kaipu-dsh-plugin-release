#!/usr/bin/env node
/**
 * check-oa-ui-083.mjs —— 「Agent 版 OA」前端三块判据（2026-10-26）
 *
 * ★★ 为什么单独一个脚本、且要**真跑函数**而不是 grep 源码：
 *   本项目已经栽过：`check-oa-083.mjs` 里那条列集断言连假绿两轮
 *   （第一版「建表 vs 单源」注入后两边一起少、判齐；第二版被后续 ALTER 掩盖）。
 *   教训：**判据替身与真值不同源，就必然假绿。**
 *   ⇒ 这里 import 真实的纯逻辑模块，喂真实形态的 payload，断言输出**逐字**。
 *   ⇒ 注入（改坏被测函数）必须**真变红**，否则本脚本自身视为无效。
 *
 * 覆盖：
 *   ① 项目阶段（project-phase.ts）—— 六阶序、±1、进度条、归档出口
 *   ② 依赖文案（deps-text.ts）—— 能不能领先说、双向、候选剔成环
 *   ③ 版本文案（deps-text.ts）—— 「最终 ≠ 最新」必须显式说出来
 *   ④ 接线存在性 —— 三块真被挂进面板（防「写了组件没人用」）
 *
 * 用法：node tools/check-oa-ui-083.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const ROOT = '/root/work/083-开铺/repo/kaipu-dsh-plugin'
const SRC = `${ROOT}/packages/plugin-workstation/src/client`
const LIB = `${ROOT}/packages/plugin-workstation/lib/client`

let pass = 0
const fails = []
const ck = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fails.push(name); console.log(`  ✗ ${name} ｜ ${String(got).slice(0, 220)}`) }
}

/* ★ 被测件用**编译产物**（tsc 把每个 src/client/*.ts 编到 lib/client/*.js），
   保证「判的」就是「打包进 client.js 的同一份源码编译结果」。
   ★★ 为什么要拷到 /tmp 改 .cjs：包声明了 `"type": "module"`，
      但 tsc 吐出的是 CommonJS（首行 `"use strict"` + `exports.`），
      直接 import 会报「exports is not defined in ES module scope」。
      拷成 .cjs 才能让 node 按 CJS 解析 —— 这是**加载方式**问题，
      不改被测代码一个字节。 */
import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'

const stage = mkdtempSync(joinPath(tmpdir(), 'oa-ui-'))
const staged = {}
for (const name of ['project-phase', 'deps-text']) {
  const from = `${LIB}/${name}.js`
  if (!existsSync(from)) {
    console.error(`✗ 缺编译产物 ${from}\n  先跑 node tools/build.mjs`)
    process.exit(1)
  }
  const to = joinPath(stage, `${name}.cjs`)
  copyFileSync(from, to)
  staged[name] = to
}

const modOf = async (name) => await import(pathToFileURL(staged[name]).href)

let PP, DT
try {
  PP = await modOf('project-phase')
  DT = await modOf('deps-text')
} catch (e) {
  console.error(`✗ 无法加载被测模块：${e.message}`)
  process.exit(1)
}

/* ══════════════════════════════════════════════════════════════
   一、项目阶段
   ══════════════════════════════════════════════════════════════ */
console.log('\n【一】项目阶段（前端纯逻辑）')

ck('U-1a 六阶顺序与后端逐字同序',
  JSON.stringify(PP.PROJECT_PHASES) === JSON.stringify(
    ['requirement', 'plan', 'assignment', 'build', 'review', 'archived']),
  PP.PROJECT_PHASES.join(','))

ck('U-1b phaseIndex: requirement=1 / archived=6',
  PP.phaseIndex('requirement') === 1 && PP.phaseIndex('archived') === 6,
  `${PP.phaseIndex('requirement')},${PP.phaseIndex('archived')}`)

/* ★ 未知阶段必须返回 0 —— 不许默认当成第一步。
   默认成 requirement 会让「未知」显示成「刚立项」，是假读数。 */
ck('U-1c 未知阶段 = 0，不冒充第一步',
  PP.phaseIndex('bogus') === 0 && PP.phaseIndex(undefined) === 0 && PP.phaseIndex('') === 0,
  PP.phaseIndex('bogus'))

ck('U-1d phaseBar 三阶 = ●●●○○○',
  PP.phaseBar('assignment') === '●●●○○○', PP.phaseBar('assignment'))

ck('U-1e 未知阶段进度条 = ？？？？？？（不画成空进度）',
  PP.phaseBar('bogus') === '？？？？？？', PP.phaseBar('bogus'))

ck('U-1f nextPhase: requirement→plan，archived→null',
  PP.nextPhase('requirement') === 'plan' && PP.nextPhase('archived') === null,
  `${PP.nextPhase('requirement')} / ${PP.nextPhase('archived')}`)

ck('U-1g prevPhase: 第一步→null（不能退），第四步→分工',
  PP.prevPhase('requirement') === null && PP.prevPhase('build') === 'assignment',
  `${PP.prevPhase('requirement')} / ${PP.prevPhase('build')}`)

ck('U-1h 服务端 phaseLabel 优先于本地兜底',
  PP.phaseLabel('plan', '服务端叫法') === '服务端叫法'
  && PP.phaseLabel('plan') === '出计划书'
  && PP.phaseLabel('plan', '') === '出计划书',
  PP.phaseLabel('plan', '服务端叫法'))

ck('U-1i 未知阶段 label 说明「未知」不返回空串',
  PP.phaseLabel('bogus') === 'bogus' && PP.phaseLabel('') === '未知阶段',
  PP.phaseLabel('bogus'))

ck('U-1j isArchivedPhase 只认 archived',
  PP.isArchivedPhase('archived') === true && PP.isArchivedPhase('review') === false,
  PP.isArchivedPhase('review'))

ck('U-1k phaseHint 带步数与该交什么',
  PP.phaseHint('build').includes('第 4/6 步') && PP.phaseHint('build').includes('交付物'),
  PP.phaseHint('build'))

/* ══════════════════════════════════════════════════════════════
   二、任务依赖文案
   ══════════════════════════════════════════════════════════════ */
console.log('\n【二】任务依赖（能不能领先说）')

const dep = (id, title, status) => ({ id, title, status })

const dBlocked = {
  task_id: 'B', dependsOn: [dep('A', '需求确认', 'posted')], blocks: [],
  unmet: 1, claimable: false,
}
const dFree = { task_id: 'B', dependsOn: [], blocks: [], unmet: 0, claimable: true }
const dHolder = {
  task_id: 'A', dependsOn: [], blocks: [dep('B', '写计划书', 'posted')],
  unmet: 0, claimable: true,
}

ck('U-2a 不能领 ⇒ 标题直说「还不能领」并给件数',
  DT.depsHeadline(dBlocked).includes('还不能领')
  && DT.depsHeadline(dBlocked).includes('等 1 件'),
  DT.depsHeadline(dBlocked))

/* ★ 修改前这条写成 `=== '能领'` —— 但「无依赖」本就该说「无依赖」（U-2d），
   空依赖的卡片说「能领」反而信息量更低。判据写错，不是代码错。
   ⇒ 正确形态：**有前置但都已交齐 ⇒ 能领**（此时才需要强调「能领」）。 */
const dSatisfied = {
  task_id: 'B', dependsOn: [dep('A', '需求确认', 'done')], blocks: [],
  unmet: 0, claimable: true,
}
ck('U-2b 前置都已交齐 ⇒ 说「能领」',
  DT.depsHeadline(dSatisfied) === '能领', DT.depsHeadline(dSatisfied))

/* ★ 双向信息：不只说「我等谁」，还要说「我挡着谁」。
   只看单向 ⇒ 人不知道自己卡着别人的活。 */
ck('U-2c 我挡着别人 ⇒ 标题带出被挡件数',
  DT.depsHeadline(dHolder).includes('挡着 1 件'), DT.depsHeadline(dHolder))

ck('U-2d 无依赖明说「无依赖」而不是留空',
  DT.depsHeadline({ task_id: 'X', dependsOn: [], blocks: [], unmet: 0, claimable: true }) === '无依赖',
  DT.depsHeadline({ task_id: 'X', dependsOn: [], blocks: [], unmet: 0, claimable: true }))

ck('U-2e depLine 标题 + 状态人话',
  DT.depLine(dep('A', '需求确认', 'posted')) === '需求确认（待领）',
  DT.depLine(dep('A', '需求确认', 'posted')))

ck('U-2f 未知 status 不吞，原样显示',
  DT.depLine(dep('A', 'T', 'weird_state')) === 'T（weird_state）',
  DT.depLine(dep('A', 'T', 'weird_state')))

ck('U-2g 空标题不返回空串（退回 id）',
  DT.depLine(dep('tid_9', '', 'done')) === 'tid_9（已交）',
  DT.depLine(dep('tid_9', '', 'done')))

/* ── 候选池：必须剔掉「会成环」的 ── */
const all = [
  { task_id: 'A', title: '需求确认', status: 'posted' },
  { task_id: 'B', title: '写计划书', status: 'posted' },
  { task_id: 'C', title: '施工', status: 'posted' },
]
const cand = DT.pickDepCandidates('B', all, dBlocked)
ck('U-2h 候选剔自己、剔已依赖的',
  cand.length === 1 && cand[0].id === 'C',
  cand.map(c => c.id).join(','))

/* ★★ 这条是本轮最该守的：B 已经有 A 作前置；此时 A 的卡片里
   「B」必须**不出现**在候选里 —— 加进去就是 A→B 且 B→A（环）。
   服务端会 409，但让用户先点一次撞墙是缺陷，不是保护。 */
const candForA = DT.pickDepCandidates('A', all, {
  task_id: 'A', dependsOn: [], blocks: [dep('B', '写计划书', 'posted')], unmet: 0, claimable: true,
})
ck('U-2i 候选剔掉「已经等我」的（防成环，不让人先撞墙）',
  candForA.every(c => c.id !== 'B') && candForA.length === 1,
  candForA.map(c => c.id).join(','))

ck('U-2j 候选不返回空标题',
  DT.pickDepCandidates('X', [{ task_id: 'Y', title: '', status: 'posted' }], {
    task_id: 'X', dependsOn: [], blocks: [], unmet: 0, claimable: true,
  })[0].title === 'Y',
  'empty title')

/* ══════════════════════════════════════════════════════════════
   三、交付版本文案
   ══════════════════════════════════════════════════════════════ */
console.log('\n【三】交付版本（哪一稿算数）')

const oneVer = {
  task_id: 'T', versions: [1], count: 1, finalVersion: 1,
  items: [{ id: 'd1', version: 1, is_final: 1, filename: 'a.md' }],
}
const twoVer = {
  task_id: 'T', versions: [1, 2], count: 2, finalVersion: 2,
  items: [
    { id: 'd1', version: 1, is_final: 0, filename: 'a.md' },
    { id: 'd2', version: 2, is_final: 1, filename: 'b.md' },
  ],
}
/* ★★ 回退态：交了 v2，但最终稿被切回 v1 —— 这是最容易看错的状态。
   人默认「最新 = 算数」，此处必须**显式**说「不是最新那稿」。 */
const rolledBack = {
  task_id: 'T', versions: [1, 2], count: 2, finalVersion: 1,
  items: [
    { id: 'd1', version: 1, is_final: 1, filename: 'a.md' },
    { id: 'd2', version: 2, is_final: 0, filename: 'b.md' },
  ],
}

ck('U-3a 单稿：交付 1 稿 · 最终 v1',
  DT.versionLine(oneVer) === '交付 1 稿 · 最终 v1', DT.versionLine(oneVer))

ck('U-3b 两稿且最新即最终：交付 2 稿 · 最终 v2',
  DT.versionLine(twoVer) === '交付 2 稿 · 最终 v2', DT.versionLine(twoVer))

ck('U-3c 回退态：必须写明「不是最新那稿」',
  DT.versionLine(rolledBack).includes('不是最新那稿'),
  DT.versionLine(rolledBack))

ck('U-3d 回退态提示解释「算数的是 v1」',
  DT.versionHint(rolledBack).includes('回退') && DT.versionHint(rolledBack).includes('v1'),
  DT.versionHint(rolledBack))

ck('U-3e 单稿提示只说「只有一稿」，不啰嗦',
  DT.versionHint(oneVer) === '只有一稿。', DT.versionHint(oneVer))

ck('U-3f 无交付 ⇒ 「无交付」而不是空串',
  DT.versionLine({ task_id: 'T', versions: [], count: 0, finalVersion: 0, items: [] }) === '无交付',
  DT.versionLine({ task_id: 'T', versions: [], count: 0, finalVersion: 0, items: [] }))

/* ══════════════════════════════════════════════════════════════
   四、接线存在性 —— 防「写了组件没人用」
   ★ 上一轮 `tasksDeps` 通道在 bridge 里躺了整轮、注释写着「本轮只开通道」,
     UI 从没做出来。通道开着没人用比没开更危险：后来人以为功能已有。
   ⇒ 本组判据守的就是这个形态：**组件必须真被 jsx 引用**。
   ══════════════════════════════════════════════════════════════ */
console.log('\n【四】接线（写了就必须挂上）')

const panel = readFileSync(`${SRC}/WorkstationPanel.tsx`, 'utf8')
const depsUi = existsSync(`${SRC}/task-deps-ui.tsx`) ? readFileSync(`${SRC}/task-deps-ui.tsx`, 'utf8') : ''

ck('U-4a 面板 import 了 TaskDepsSection',
  /import\s*\{[^}]*TaskDepsSection[^}]*\}\s*from\s*'\.\/task-deps-ui\.js'/.test(panel),
  'import 没找到')

ck('U-4b 面板真的渲染了 <TaskDepsSection',
  panel.includes('<TaskDepsSection'), '没有渲染调用')

ck('U-4c 面板真的渲染了 <DeliverableVersionsSection',
  panel.includes('<DeliverableVersionsSection'), '没有渲染调用')

ck('U-4d 阶段条真的用了 phaseBar',
  panel.includes('phaseBar(') && panel.includes('nextPhase(') && panel.includes('prevPhase('),
  '阶段 UI 未接线')

ck('U-4e 阶段条只在选中单个项目时出现（流程区挂在选中卡片下）',
  /* ★★ 2026-10-26 结构调整：原实现是底部一个 IIFE 里 `projects.find(projFilter)`；
     阿开要「四段跟随项目走」⇒ 改成在每张卡片后 `p.projectId === projFilter ? renderProjectFlow(p) : null`。
     ★ 判据要跟着设计走：验「选中判据存在」+「渲染调用存在」+「不会给未选中的项目也挂」。
       ★ 为什么必须验三元的两边：只验 `renderProjectFlow(p)` 会被 `projects.map(p => renderProjectFlow(p))`
         骗过 —— 那样每个项目都挂一份，正是这次要修的 bug。 */
  /p\.projectId\s*===\s*projFilter\s*\?\s*renderProjectFlow\(\s*p\s*\)\s*:\s*null/.test(panel),
  '没找到「按选中项目挂流程区」的判据（或给所有项目都挂了）')

/* ★ 收起不拉数据：几十条卡片各挂 useEffect = 一屏几十个请求 */
ck('U-4f 依赖/版本区只在 open 时渲染（收起不发请求）',
  /open\s*\?\s*\(\s*<>\s*<TaskDepsSection/.test(panel.replace(/\s+/g, ' ').replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ').replace(/\s+/g, ' '))
  || (panel.includes('{open ? (') && panel.includes('<TaskDepsSection')),
  '未确认 open 门控')

ck('U-4g 依赖区把全铺任务当候选池（allTasks 已传）',
  panel.includes('allTasks={tasks}') && depsUi.includes('allTasks'),
  'allTasks 未贯通')

ck('U-4h 归档态不给推进/退回按钮',
  panel.includes('已归档 · 冻结不再改'), '归档态未特判')

/* ══ U-5 · 任务页 V3 四段并排（2026-10-26 阿开定 · 设计图V3 §三）══
   ★★ 本条最重要的一课：**判据不许全文 includes**。
     实证：`flex: 1, minWidth: 0,` 全文件 7 处、`收起 ▴` 10 处 ——
     改掉四段那一处，全文仍有 6/9 处 ⇒ 判据照样绿 ⇒ 注入测试抓不到 ⇒ 假绿。
     ⇒ 一律先切「四段区域」再验。切片锚点 = V3 标记起，到第二个 TASK_SECTIONS.map 结束。 */

const v3 = panel
const v3Seg = (() => {
  const i = v3.indexOf('任务页设计图 V3 §三')
  if (i < 0) return ''
  /* ★★ 不许用固定字符数截断（第一版取 6000 越界到后面的 CardBoundary 组件，
     而那儿也有「收起 ▴」和「flex: 1」⇒ 注入测试抓不到 ⇒ 假绿）。
     用**结构边界**：从 V3 标记起，数 `TASK_SECTIONS.map` 出现 2 次（段头 + 卡片区），
     到第二个 map 的收尾 `})}` 之后截止。 */
  let n = 0
  let end = i
  for (let k = i; k < v3.length - 20; k++) {
    if (v3.startsWith('TASK_SECTIONS.map((sec) => {', k)) {
      n++
      if (n === 2) {
        /* 第二个 map 结束：从 k 往后找 `})}`，再吃掉后面的 `</div>` 与 `)}` */
        const close = v3.indexOf('})}', k)
        end = close < 0 ? k + 500 : close + 3
        break
      }
    }
  }
  return v3.slice(i, end)
})()
/* ★★★ 关键：判据必须去注释后再匹配。
   实证（2026-10-26 台阶④第二轮）：注释里也写着「展开 ▾ / 收起 ▴」和 flex: 1，
   判据匹配到了**注释内容** ⇒ 改坏代码后仍然绿 ⇒ 注入测试抓不到。
   这是「字符串在文件里出现 ≠ 功能还在」的又一次复现 —— 在判据自己身上犯的。
   ⇒ 一律用 v3Code（剥掉块注释与行注释的版本）做功能判据。 */
const v3Code = v3Seg
  .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), ' ')
  .replace(new RegExp('//[^\\n]*', 'g'), ' ')

ck('U-5a 四段容器是横排（flex + gap，无 flexDirection: column）',
  /* ★ 不靠长正则（脆）：验三件事凑齐 —— ①V3标记在 ②横排容器 ③该容器后面紧跟 TASK_SECTIONS.map */
  /* ★ 判据设计原则：验「结构事实」，不验「注释与代码的相对位置」——
     注释随时会被改写/移动，用它当锚点会让判据假红（本判据第一版就栽在这）。 */
  (() => {
    /* ★ 必须切片后再验：全文件里 flexDirection:'column' 有 27 处，全文搜必然假绿/假红。
       切片起点 = V3 标记，终点 = 第一个四段段头 map 结束（'})}' 之后）。
       判据只看这一小段：横排容器在、竖排容器不在。 */
    const i = v3.indexOf('任务页设计图 V3 §三')
    if (i < 0) return false
    const seg = v3.slice(i, i + 1200)
    return seg.includes("display: 'flex', gap: 6 }}>") &&
           seg.includes('{TASK_SECTIONS.map((sec) => {') &&
           seg.includes("flexDirection: 'column', gap: 8 }}>") === false
  })(),
  '四段容器未改为横排')

ck('U-5b 每段 flex:1 平均分宽（阿开：「把一行平均分一下」）',
  v3Code.includes('flex: 1, minWidth: 0,'),
  'flex:1 平均分宽缺失')

ck('U-5c 每段内部**单行**（圆点/段名/条数/展开 同一行，紧贴数字）',
  /* ★★ 2026-10-26 台阶⑧（阿开定）：「四段的展开按钮建议放在 数字背后同一行
     这样可以更好看一些。目前是上下2行」⇒ 形态从「竖排两行」改为「单行」。
     ★ 判据跟着设计走 —— 旧判据绑两行，挡住的是新设计而非缺陷，必须改。
     ★ 新判据要点：
       ① 段头 button 是 row 不是 column
       ② 展开指示有 marginLeft 紧贴数字（阿开说"数字背后"）
       ③ 反向：不许再出现 column 两行那个特征串 */
  v3Code.includes("flexDirection: 'row', alignItems: 'center', gap: 5")
  && /展开 ▾/.test(v3Code)
  && !v3Code.includes("flexDirection: 'column', alignItems: 'flex-start', gap: 2"),
  '单行结构缺失或仍在两行')

ck('U-5d 卡片移到四段行下方（TASK_SECTIONS.map 必须出现 2 次）',
  (v3.match(/TASK_SECTIONS\.map\(\(sec\) => \{/g) || []).length === 2,
  `TASK_SECTIONS.map 出现 ${(v3.match(/TASK_SECTIONS\.map\(\(sec\) => \{/g) || []).length} 次，应为 2（段头 + 卡片区）`)

ck('U-5e 卡片区可同时展开多段（甲案：不是单选 tab，没有「只留一个」的逻辑）',
  /* 单选 tab 的特征会是 openSec 只能有一个 key（如 setOpenSec({[k]:true}) 或 === 比较）。
     甲案的特征是每段独立 `if (!open) return null`，且没有互斥写法。 */
  v3Code.includes('if (!open) return null') &&
  v3.includes('setOpenSec({') === false,
  '卡片区可能是单选 tab，或缺少逐段门控')

ck('U-5f 四段互不影响：openSec 用对象记录每段独立状态',
  v3Code.includes('setOpenSec((p) => ({ ...p, [sec.key]: !open }))'),
  'openSec 未按 sec.key 独立记录')

ck('U-5g 展开/收起文字线索保留（阿开：「展开不知道可以收」）',
  v3Code.includes("'收起 ▴'") && v3Code.includes("'展开 ▾'"),
  '展开/收起文字线索缺失')

ck('U-5h 空段文案保留（搜不到/没任务时给一句人话）',
  v3Code.includes('sec.empty'),
  '空段文案缺失')

ck('U-5i 段头圆点区分有无活（list.length > 0）',
  v3Code.includes("background: list.length > 0 ? C.accent : '#d0d5dd'"),
  '段头圆点缺失')

/* ══════════════════════════════════════════════════════════════
   台阶⑨ · 六步进度条（2026-10-26）
   ★★ 为什么要专门切片：进度条与四段在同一个 `(() => {...})()` 里，
      但全文里 `PROJECT_PHASES.map` 只有进度条这一处 —— 仍要切片，
      否则一旦别处也 map 一遍就假绿。
   ★ 切片边界：`const cur = projects.find` 起，到 `已归档 · 冻结不再改` 之后的
      收尾 `</div>` 截止（= 整个进度条卡片）。
   ★ 必须剥注释：本台阶刚才在注释里写了「六步节点条」「可点」等词 ——
      不剥的话，代码删光判据仍绿（台阶④已栽过一次，不重犯）。
   ══════════════════════════════════════════════════════════════ */
const phaseSeg = (() => {
  /* ★★★ 2026-10-26 结构调整（阿开：「四段没有跟随每一个项目走」）。
     原锚点 `const cur = projects.find((p) => p.projectId === projFilter)` 是**底部孤立 IIFE** 的开头；
     那次改造把阶段条搬进 `renderProjectFlow(cur)`，IIFE 整段删除 ⇒ 锚点消失，7 条 P-9 全红。
     ★ 这不是功能坏了，是判据锚点过期。按「判据要跟着设计走」：锚点换成新结构的函数头。
     ★ 为什么不退回用 `projects.find`：那行真没了，硬留会让判据变成「为了绿而留垃圾代码」。
     ★ 为什么仍用结构边界（不是全文 includes）：下面 P-9b 要验「JSX 文本子节点不是裸 {p}」，
       全文匹配会被别处同名结构骗过 —— 必须只在这个函数体内判。 */
  const anchor = 'const renderProjectFlow = (cur: ProjectItem): ReactElement => {'
  const i = v3.indexOf(anchor)
  if (i < 0) return ''
  /* 结束边界：renderProjectFlow 的收尾 `  }` + 空行 + 下一个顶层 const/function。
     用结构找：从锚点起，花括号配平归零处即函数尾。 */
  let depth = 0
  let end = -1
  for (let k = i; k < v3.length; k++) {
    const ch = v3[k]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { end = k + 1; break }
    }
  }
  return v3.slice(i, end < 0 ? i + 6000 : end)
})()
const phaseCode = phaseSeg
  .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), ' ')
  .replace(new RegExp('//[^\\n]*', 'g'), ' ')

ck('P-9a 六步**全部列出**（map PROJECT_PHASES，不是只画点阵）',
  /* ★★ 注入测试教训（2026-10-26 台阶⑨第一轮）：
     只用 `includes('PROJECT_PHASES.map')` 会被 `{false && PROJECT_PHASES.map(...)}`
     这种**短路禁用**骗过 —— 字符串还在，渲染已死。
     ⇒ 必须验「map 真的被执行」：该行不以 `false &&` 开头，且不在 `false ?` 分支里。 */
  (() => {
    const i = phaseCode.indexOf('PROJECT_PHASES.map((p, i) =>')
    if (i < 0) return false
    /* 往前看 40 字符：不允许被 false&& / false? / undefined&& 短路 */
    const before = phaseCode.slice(Math.max(0, i - 40), i)
    if (/false\s*&&\s*\{?\s*$/.test(before)) return false
    if (/false\s*\?\s*[^:]*$/.test(before)) return false
    if (/undefined\s*&&\s*$/.test(before)) return false
    return true
  })() &&
  phaseCode.includes('phaseLabel(p'),
  '六步未逐一列出（被短路禁用，或还是 phaseBar 点阵）')

ck('P-9b 每步**带名字**（不是 ●●○○ 点阵，也不是原始 key）',
  /* ★★ 注入测试教训（2026-10-26 台阶⑨第一轮）：
     注入「把子节点换成 {p}」时判据仍绿 —— 因为 `phaseLabel(p` 在 title 属性里也有。
     ⇒ 必须验 **JSX 文本子节点** 是 phaseLabel(...)，不是裸 {p}。
     结构形态：`>\n  {phaseLabel(p, cur.phase === p ? cur.phaseLabel : undefined)}\n</span>` */
  phaseCode.includes('phaseBar(') === false &&
  /\{\s*phaseLabel\(p,\s*cur\.phase === p \? cur\.phaseLabel : undefined\)\s*\}/.test(phaseCode) &&
  /* 反向：不得把**裸变量当 JSX 文本子节点**。
     ★★ 教训（台阶⑨第二轮）：`\{\s*p\s*\}` 被 `PROJECT_PHASES.map((p, i) => {` 的
        箭头函数体误命中 —— 那里也有 `{` 和 `p`。必须用**JSX 子节点形态**：
        `>` 之后紧跟 `{p}`，或 `{p}` 紧跟 `</`。 */
  /(>\s*\{\s*p\s*\})|(\{\s*p\s*\}\s*<)/.test(phaseCode) === false,
  '进度条仍用点阵，或每步显示的是原始 key（没换成人话名）')

ck('P-9c 当前步**高亮**（背景着色 + 加粗，与已走过/未到区分）',
  phaseCode.includes('background: isCur ? C.accent') &&
  phaseCode.includes('fontWeight: isCur ? 700 : 400'),
  '当前步高亮缺失')

ck('P-9d 六步**可点**（onClick 调 setProjectPhase）',
  phaseCode.includes('onClick={canClick ?') &&
  phaseCode.includes('setProjectPhase(cur.projectId, p)') &&
  /* ★★ 2026-10-26 注入测试抓出的假绿：把 `const canClick = !busy && !isCur` 改成
     `const canClick = false` —— 六步变死块，但上面两句字符串都还在，判据照样绿。
     ⇒ 必须验 `canClick` 的**定义不是常量假**（它得真依赖 busy/isCur）。
     ★ 为什么查 !isCur：当前步不该可点（点了是空操作），这是设计；
       所以「可点」的真实含义是 `!busy && !isCur`，不是恒真也不是恒假。 */
  /const\s+canClick\s*=\s*!busy\s*&&\s*!isCur/.test(phaseCode),
  '六步不可点（onClick → setProjectPhase 缺失，或 canClick 被写成常量）')

ck('P-9e ★ 前端**不自造越级判据**（越级由服务端 409 拦）',
  /* ★ 设计纪律：后端只许 ±1 与 →archived。前端若自己再判一遍，
     两套判据必然漂移。判据要「无第二套」：不得出现 nextPhase/pv 之外的自造规则。 */
  phaseCode.includes('PROJECT_PHASES.indexOf(p) - curIdx') === false &&
  phaseCode.includes('Math.abs(') === false,
  '前端自造了越级过滤判据（应只靠服务端 409）')

ck('P-9f 六步之外仍保留 ±1 按钮（细粒度推进）',
  phaseCode.includes('setProjectPhase(cur.projectId, nx)') &&
  phaseCode.includes('setProjectPhase(cur.projectId, pv)'),
  '±1 推进/退回按钮丢失')

ck('P-9g 归档态不给推进（归档是出口，没有下一步）',
  phaseCode.includes('isArchivedPhase(ph)') &&
  phaseCode.includes('已归档 · 冻结不再改'),
  '归档态仍显示推进按钮')

/* ══ K-1 · 任务「所属阶段」（2026-10-26 甲案：界面只留一套分类）══
   ★ 阿开原话：「这个还在不是说好跟外面的六步流程一样吗？」
     —— 新建任务里原来有「这条是：需求/交付/回函/测试」，跟项目六步是两套。
   甲案：界面只留六步；`kind` 退回系统字段，由 PHASE_TO_KIND 从阶段推出。
   ★ 判据怎么写（这里最容易写假绿）：
     不能只验「新下拉存在」—— 旧下拉还在、或映射漏项，都能骗过。
     必须三条一起：①旧选项真没了 ②下拉真用六步 ③映射覆盖全部六步。 */

ck('K-1a 旧的「这条是」下拉已删（不留第二套分类）',
  panel.includes('自动判断') === false &&
  panel.includes('需求（要人干活）') === false &&
  panel.includes('回函（只同步信息）') === false &&
  panel.includes('Agent 靠它先分流，不用逐条读全文') === false,
  '旧的「性质」下拉或其提示语还在')

ck('K-1b 阶段下拉真用六步（不是硬编码选项）',
  /* ★ 为什么验 map 而不是数 option：硬编码 <option value="requirement"> 也能显示六个，
     但项目阶段一变（后端加第七步）它不会跟着变 ⇒ 又变成「两套分类」。
     必须验它从 PROJECT_PHASES 生成，且排除 archived（归档不该是新任务的阶段）。 */
  /PROJECT_PHASES\.filter\(\(p\)\s*=>\s*p\s*!==\s*'archived'\)\.map/.test(panel) &&
  /<option key=\{p\} value=\{p\}>\{phaseLabel\(p\)\}<\/option>/.test(panel),
  '阶段下拉没从 PROJECT_PHASES 生成（可能又硬编码了）')

ck('K-1c 阶段→性质映射覆盖全部六步',
  /* ★ 为什么逐个验：漏一个阶段 ⇒ phaseToKind 返回空串 ⇒ 服务端按标题瞎猜，
     而界面上完全看不出来（不报错、不下线、不提示）。
     这种「静默降级」只能靠判据守。 */
  ['requirement', 'plan', 'assignment', 'build', 'review', 'archived']
    .every((p) => new RegExp(`\\b${p}:\\s*'`).test(panel)) &&
  /function phaseToKind\(/.test(panel),
  'PHASE_TO_KIND 漏了某个阶段，或没有 phaseToKind 函数')

ck('K-1d 阶段默认跟项目走，但用户改过就不再覆盖',
  /* ★ 这两条必须成对验：
     - 只验「自动带入」⇒ 用户手选被冲掉（静默改写用户输入），骗过判据；
     - 只验「touched 保护」⇒ 可能压根没自动带入，用户每次手选。
     ★ 为什么用 useEffect 挂 projId：多个 setProjId 入口逐处写必漏。 */
  /useEffect\(\(\)\s*=>\s*\{[\s\S]{0,400}if\s*\(phaseTouched\)\s*return/.test(panel) &&
  /\[projId,\s*projects,\s*phaseTouched\]/.test(panel),
  '阶段的「自动带入 + 手改不被覆盖」缺失（或 useEffect 依赖不全）')

ck('K-1e 发布时真的把阶段映射成 kind 传下去',
  /* ★ 最容易被忘的一步：界面改好了，但发布时还传旧 newKind（现在是 undefined）⇒
     所有任务的 kind 都靠服务端猜，等于这次改造白做。 */
  /phaseToKind\(newPhase\)\s*\|\|\s*undefined/.test(panel) &&
  panel.includes('newKind || undefined') === false,
  '发布时没接 phaseToKind（界面改了但没生效）')

/* ══ 汇总 ══ */
console.log(`\n${'─'.repeat(50)}`)
if (fails.length === 0) {
  console.log(`✓ 全绿：${pass} 条`)
  process.exit(0)
} else {
  console.log(`✗ ${fails.length} 条红 / 共 ${pass + fails.length} 条`)
  fails.forEach(f => console.log(`   · ${f}`))
  process.exit(1)
}
