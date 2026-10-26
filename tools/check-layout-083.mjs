#!/usr/bin/env node
/**
 * check-layout-083.mjs —— 工位卡座布局 + 加入码位置判据（2026-10-26）
 *
 * 阿开两条：
 *   ① 「把这一行移动到顶部，与顶部的 🔑 生成工位加入码 …… 合并到同一栏是不是更好管理。
 *      底部一展开已生成就要拉到底部才能看到」
 *   ② 「工位布局怎么变了呢？就按你现在的顺序，但是还会回到之前的卡座模式啊
 *      两行一行 5 个座位，6 个系统默认工位」
 *
 * ★★ 这批判据守的是**分区与位置**，不是「有没有这段代码」。
 *   ② 的根因不是网格常量变了（`repeat(5)` 一直在），是**进网格的集合变了**：
 *   判据若只断言「代码里有 repeat(5,」 ⇒ 假绿（bug 在的时候它也是绿的）。
 *   ⇒ 必须真跑 `partitionSeats`，喂**真实脏数据形态**（1 team + 6 post + 8 游离 role）。
 *
 * 用法：node tools/build.mjs && node tools/check-layout-083.mjs
  *
 * ★ 2026-10-26 状态：本脚本前 3 条（seat-partition 布局抽取测试）已失效 ——
 *   `seat-partition.ts` 在 0.2.95 删除（改 seat-grid），`seat-grid.ts` 在 0.2.96 又删
 *   （布局改回内联 gridNodes + 补空位）。当前运行会报「缺编译产物」，**不是功能坏了**。
 *   布局真值由 `check-seat-summary-083.mjs`（74 条）在守。暂挂技术债，不做假绿。
 */
import { readFileSync, existsSync, mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = '/root/work/083-开铺/repo/kaipu-dsh-plugin'
const SRC = `${ROOT}/packages/plugin-workstation/src/client`
const LIB = `${ROOT}/packages/plugin-workstation/lib/client`

let pass = 0
const fails = []
const ck = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fails.push(name); console.log(`  ✗ ${name} ｜ ${String(got).slice(0, 220)}`) }
}

/* 加载编译产物（CJS → 拷成 .cjs 才能 import，与 check-oa-ui-083 同法） */
const stage = mkdtempSync(joinPath(tmpdir(), 'layout-'))
const from = `${LIB}/seat-partition.js`
if (!existsSync(from)) {
  console.error(`✗ 缺编译产物 ${from}\n  先跑 node tools/build.mjs`)
  process.exit(1)
}
const to = joinPath(stage, 'seat-partition.cjs')
copyFileSync(from, to)
const SP = await import(pathToFileURL(to).href)

const panel = readFileSync(`${SRC}/WorkstationPanel.tsx`, 'utf8')

/* ══════════════════════════════════════════════════════════════
   一～三、卡座布局 → **已迁出到 check-seat-grid-083.mjs**

   ★ 为什么迁：本文件原来测的是 `partitionSeats`（只放 post 座位 + 补空位），
     那是第二版的中间形态。阿开最终口径是「恒定 10 格，前 6 格系统位先落座」，
     由 `seat-grid.ts` 的 `buildSeatGrid` 实现，判据在 `check-seat-grid-083.mjs`（21 条）。
     ⇒ 旧断言（`partitionSeats` / `emptySeatSlots`）已随源文件删除而失效，
       留着只会长红然后被当噪声忽略 —— 所以直接撤掉，不留半死的判据。
   ★ 本文件现在只负责第四件事：**加入码在顶部**（位置判据，与卡座无关）。
   ══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   四、加入码位置 —— 在「工位布局」标题行下方，且全文只有一份（有工位分支内）
   ══════════════════════════════════════════════════════════════ */
console.log('\n【四】加入码位置')

/* ★ 用 indexOf 取**第一次**出现（原来 `工位布局</div>` 在文件里有多处匹配，
   第一版判据拿到的是后面那个，导致 idxLayoutTitle > idxClear 判红）。
   ★ 加入码的位置判据要在**有工位分支**内找：空铺分支（roots.length===0）
     也有一份 <JoinCodeCard>，它在有工位分支之前，会污染 firstIndexOf。 */
const idxLayoutTitle = panel.indexOf('工位布局</div>')
/* ★★ 锚点踩坑记录：`一键清场` 在文件里有两处 —— 1603 行**注释**里一次、
   1815 行**按钮文字**一次。第一版 indexOf 拿到注释处 ⇒ 切片从注释开始，
   把空铺分支那份（1965）也框进来了 ⇒ 误判「重复渲染」。
   ⇒ 锚点必须是**唯一**的按钮文字（带前导缩进与独立行形态）。 */
const idxClear = panel.indexOf('          一键清场\n')
ck('L-4a-0 一键清场按钮锚点唯一命中', idxClear > 0, `idx=${idxClear}`)
/* 有工位分支起点：SeatSummaryRow 出现在有工位分支顶部，加入码在其**之前**。
   取「一键清场」之后到「SeatSummaryRow」之间 —— 这一段就是顶部加入码区。 */
const idxSeatSummary = panel.indexOf('<SeatSummaryRow')
const idxJoinTop = panel.indexOf('<JoinCodeCard compact />', idxClear)
const idxGrid = panel.indexOf("gridTemplateColumns: 'repeat(5")

ck('L-4a 找到「工位布局」标题与「一键清场」',
  idxLayoutTitle > 0 && idxClear > 0,
  `title=${idxLayoutTitle} clear=${idxClear}`)
ck('L-4b 加入码在标题行之后（顶部）',
  idxJoinTop > idxClear, `join=${idxJoinTop} clear=${idxClear}`)
/* ★★ 核心：加入码必须**早于**席位总览与卡座。
   这正是阿开要的「不用拉到底部才看到」—— 若它排在 grid 之后就是原 bug。 */
ck('L-4c 加入码排在席位总览之前（一进来看得见）',
  idxJoinTop > 0 && idxJoinTop < idxSeatSummary,
  `join=${idxJoinTop} summary=${idxSeatSummary}`)
ck('L-4d 加入码排在卡座网格之前',
  idxJoinTop > 0 && idxJoinTop < idxGrid,
  `join=${idxJoinTop} grid=${idxGrid}`)

/* ★★★ 真实结构（前三版判据都栽在这里，记清楚）：
   `OrgSection` 的 return 是：
     1715  <div marginTop:12>
     1716-1824  标题行（工位布局 / 席位说明 / 刷新 / 收起 / 一键清场）
     1830  <JoinCodeCard compact />        ← **这里**，无条件常显
     1834  {showSeatGuide && (...)}        席位说明
     1932  三分支三元：err / tree===null / roots空 / 有工位
     ...
   ⇒ 加入码**不在**有工位分支里，而是三分支之前、标题行之后 —— 无条件渲染。
      正因为无条件，空铺也能发码（无需再补一份）。
   ★ 前三版判据错因：
     ① 起点用 idxClear ⇒ 跨进空铺分支，数出 2；
     ② indexOf(') : (') ⇒ 命中更靠后的 `) : (`，起点越界，数出 0；
     ③ 按有工位分支切片 ⇒ 那个分支里本来就没有加入码（它在分支外），数出 0。
   ⇒ 正确判据：**按行号**断言
       标题区结束 < 加入码行 < 有工位分支起点
     且加入码在「一键清场」之后、第一个三分支之前，恰好一份。 */
const allLines = panel.split('\n')
const iClearBtn = allLines.findIndex((l) => l === '          一键清场')
const iJoin = allLines.findIndex((l) => l.trim() === '<JoinCodeCard compact />')
const iFirstBranch = allLines.findIndex((l) => l.includes('tree === null ? ('))
const iSummary = allLines.findIndex((l) => l.includes('<SeatSummaryRow'))

ck('L-4e 加入码在标题行之后、三分支之前（无条件常显，恰好一份）',
  iClearBtn > 0 && iJoin > iClearBtn && iFirstBranch > iJoin && iSummary > iFirstBranch
  && allLines.filter((l) => l.trim() === '<JoinCodeCard compact />').length === 1,
  `clear=${iClearBtn + 1} join=${iJoin + 1} branch=${iFirstBranch + 1} summary=${iSummary + 1}`)

ck('L-4e-2 加入码不在任何一个分支内（无条件渲染 ⇒ 空铺也有）',
  iJoin < iFirstBranch, `join=${iJoin + 1} firstBranch=${iFirstBranch + 1}`)

/* ★ 全文件**只该有 1 份**：加入码已移到三分支之外无条件渲染 ⇒ 有工位/空铺共用同一份。
   ★ 旧口径写 2 份（顶部 + 空铺各一），那是加入码还在三分支内时的形态；
     现在空铺那份已删 —— 同一件事两处渲染必然漂移。 */
const totalJoins = allLines.filter((l) => l.trim() === '<JoinCodeCard compact />').length
ck('L-4f 全文件只有 1 份加入码（无条件渲染，有工位/空铺共用）',
  totalJoins === 1, `${totalJoins} 份`)

/* ══ 汇总 ══ */
console.log(`\n${'─'.repeat(50)}`)
if (fails.length === 0) {
  console.log(`✓ 全绿：${pass} 条`)
  process.exit(0)
} else {
  console.log(`✗ ${fails.length} 条红 / 共 ${pass + fails.length} 条`)
  fails.forEach((f) => console.log(`   · ${f}`))
  process.exit(1)
}
