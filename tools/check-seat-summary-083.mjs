#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   083 判据 · 席位数量总览（2026-10-26）

   ★ 判据纪律（本项目反复栽的坑）：
     · 断言**输入→输出**，不对源码 grep 关键词
       （grep 命中 = 代码里有这几个字，不等于它算对了）
     · 每条都要能真跑出红/绿。写完必须**注入一次**看它真变红
     · 反向用例必须有：空列表 / 未知类型 / 多人 / 缺 seat 字段

   ★ 怎么拿到被测函数（踩过的坑）：
     第一版用正则剥类型再 eval —— 直接报 "Missing initializer in const declaration"。
     **正则剥类型必然剥错**，剥错的判据会假绿，比没有判据更危险。
     ⇒ 改用 Node 22 自带的 `--experimental-strip-types`：真正按 TS 语法剥，
       剥错了 Node 自己会报错，不会静默产出错代码。
     ⇒ 本文件必须用 `node --experimental-strip-types` 跑（见 run 包一层）。

   跑法：node --experimental-strip-types tools/check-seat-summary-083.mjs
   ══════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/* ★★ 自重启：本文件要 import `.ts`（靠 strip-types），而仓库里其它 check 脚本
   都是**裸 `node tools/check-xxx.mjs`** 跑的 —— 若无条件要求调用方加 flag，
   迟早有人漏掉，然后看到一句看不懂的报错，误判成「判据坏了」。
   ⇒ 没带 flag 时，自己带上 flag 重跑一次当前文件，再原样退出。
   这样 `node tools/check-seat-summary-083.mjs` 和带 flag 两种跑法都成立。 */
if (!process.execArgv.includes('--experimental-strip-types')) {
  const r = spawnSync(process.execPath,
    ['--experimental-strip-types', '--no-warnings', ...process.argv.slice(1)],
    { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

/* ★ 直接 import .ts —— strip-types 负责翻译，我们不猜类型语法 */
const { countSeatTypes, seatSummary, seatBadge, resolveSeatKey } =
  await import('../packages/plugin-workstation/src/client/seat-summary.ts')

let pass = 0
const fails = []
function ck(name, cond, got) {
  if (cond) { pass += 1; return }
  fails.push(`${name}｜实际=${JSON.stringify(got)}`)
}

/* ── S-1 基本计数：三类席位，数量与占用 ── */
{
  const r = countSeatTypes([
    { seat: 'management', label: '老板位', occupants: [{ name: '阿开' }] },
    { seat: 'execution', label: '执行位', occupants: [{ name: 'Codex' }] },
    { seat: 'execution', label: '执行位', occupants: [] },
    { seat: 'audit', label: '审计位' },
  ])
  const ex = r.find((x) => x.key === 'execution')
  ck('S-1a 执行位总数=2', ex && ex.total === 2, ex)
  ck('S-1b 执行位占用=1', ex && ex.occupied === 1, ex)
  ck('S-1c 执行位空=1', ex && ex.vacant === 1, ex)
  ck('S-1d 类型数=3', r.length === 3, r.map((x) => x.key))
}

/* ── S-2 排序：★★ 2026-10-26 阿开定稿「签名位改到第一个」──
   签名位是山海不可替代的效力锚点，放第一位让它永远可见；
   其余按 management → execution → audit → strategy → management_assistant。 */
{
  const r = countSeatTypes([
    { seat: 'audit', label: '审计位' },
    { seat: 'management', label: '管理位' },
    { seat: 'signature', label: '签名位' },
  ])
  ck('S-2a 首位=signature（阿开定稿）', r[0] && r[0].key === 'signature', r.map((x) => x.key))
  ck('S-2b 末位=audit（按 management→execution→audit 排）',
    r[r.length - 1] && r[r.length - 1].key === 'audit', r.map((x) => x.key))
}
{
  /* ★ 六位全量顺序：与 `store.DEFAULT_SEATS` 及阿开给的清单一致 */
  const r = countSeatTypes([
    { seat: 'management', label: '管理位' },
    { seat: 'execution', label: '执行位' },
    { seat: 'audit', label: '审计位' },
    { seat: 'strategy', label: '战略位' },
    { seat: 'management_assistant', label: '管理助理位' },
    { seat: 'signature', label: '签名位' },
  ])
  const got = r.map((x) => x.key).join(',')
  /* ★★ 2026-10-26 阿开二次定稿（覆盖同日早间）：签名/战略/管理/助理/审计/执行 */
  ck('S-2c 六位顺序=签名/战略/管理/助理/审计/执行',
    got === 'signature,strategy,management,management_assistant,audit,execution', got)
}

/* ── S-3 缺 seat 字段 ⇒ 按 label 认字 ── */
{
  ck('S-3a label 认出执行位', resolveSeatKey({ label: '执行位' }) === 'execution', resolveSeatKey({ label: '执行位' }))
  ck('S-3b label 认出签名位', resolveSeatKey({ label: '签名位' }) === 'signature', resolveSeatKey({ label: '签名位' }))
}

/* ── S-4 未知类型：不隐藏、不改名、保留原 label ── */
{
  const r = countSeatTypes([{ seat: 'weird_seat', label: '奇怪位' }])
  ck('S-4a 未知类型不消失', r.length === 1, r)
  ck('S-4b key=weird_seat（不改名）', r[0] && r[0].key === 'weird_seat', r[0])
  ck('S-4c label 保留', r[0] && r[0].label === '奇怪位', r[0])
}
{
  const r = countSeatTypes([{ label: '说不出是什么的位' }])
  ck('S-4d 完全认不出 ⇒ unknown', r[0] && r[0].key === 'unknown', r[0])
}

/* ── S-5 occupants 多人：全给、去重 ── */
{
  const r = countSeatTypes([
    { seat: 'audit', occupants: [{ name: '甲' }, { name: '乙' }, { name: '甲' }] },
  ])
  ck('S-5a 占用计 1 个位', r[0] && r[0].occupied === 1, r[0])
  ck('S-5b holders 去重=2', r[0] && r[0].holders.length === 2, r[0] && r[0].holders)
}

/* ── S-6 空列表 ⇒ 空数组 ── */
{
  const r = countSeatTypes([])
  ck('S-6a 空进空出', Array.isArray(r) && r.length === 0, r)
}

/* ── S-7 汇总句与徽标 ── */
{
  const counts = countSeatTypes([
    { seat: 'execution', occupants: [{ name: 'A' }] },
    { seat: 'execution' },
    { seat: 'audit' },
  ])
  const s = seatSummary(counts)
  ck('S-7a 汇总含 3 个位', s.includes('3 个位'), s)
  ck('S-7b 汇总含 1 人已坐', s.includes('1 人已坐'), s)
  ck('S-7c 汇总含 2 个空', s.includes('2 个空'), s)
  const exBadge = seatBadge(counts.find((x) => x.key === 'execution'))
  /* ★★ 2026-10-26 阿开：「直接显示已有的人数，例如 2 人。其他不用备注上限容量」
     ⇒ 不再有 `1/2` 这种容量表达。 */
  ck('S-7d 徽标=执行位 1 人（只报人数、不报容量）', exBadge === '执行位 1 人', exBadge)
  const auBadge = seatBadge(counts.find((x) => x.key === 'audit'))
  /* ★★ 2026-10-26 阿开：「空的是管理助理位和审计位」，写法就是「空」，不带数字 */
  ck('S-7e 全空徽标=审计位 空（不带数字）', auBadge === '审计位 空', auBadge)
}
{
  ck('S-7f 零席位不报假数', seatSummary([]).includes('还没有'), seatSummary([]))
}

/* ── S-10 ★★ 假读数专条（2026-10-26 阿开实测暴露的 bug）──

   现象：「顶部统计有误，每一个都是 1」。
   根因：`role_seats.holder_name` 存的是**席位候选/系统位的固定人名**
        （「山海管理方（候选）」「山海智囊团」「山海签名服务」），
        它是「这个位属于谁」，**不是「谁在坐」**。
   后果：每类席位都至少有一个 holder_name ⇒ 每类都被算成坐满 1 人
        ⇒ 一铺 4 个真人被显示成「每个类型各 1 人」。
   真读数以 `agents.lamp + status='enabled'` 为准，后端只把它放进 `occupants`。

   ★ 这三条是**反向判据**：喂进去的 holder 名字必须**一个都不算**。
     它们能红 —— 把 seat-summary.ts 的 holderNames 改回读 holder 就立刻失败。 */
{
  const r = countSeatTypes([
    { seat: 'management', label: '管理位', holder: { name: '山海管理方（候选）' }, occupants: [] },
    { seat: 'execution', label: '执行位', holder: { name: '山海智囊团' }, occupants: [] },
    { seat: 'signature', label: '签名位', holder: { name: '山海签名服务' }, occupants: [] },
  ])
  const occSum = r.reduce((n, x) => n + x.occupied, 0)
  ck('S-10a holder 不算人：占用合计=0', occSum === 0, occSum)
  ck('S-10b holder 不进 holders', r.every((x) => x.holders.length === 0), r.map((x) => x.holders))
  ck('S-10c 全空 ⇒ 每类 vacant=1', r.every((x) => x.vacant === 1), r.map((x) => [x.key, x.vacant]))
}
{
  /* ★ 真实形状：橙子财税那铺 —— 4 个 enabled Agent 跨 3 类，audit 位上只剩 left
     ⇒ 期望「执行 2 人 / 管理 1 / 战略 1 / 审计 0」，绝不是「每类 1」。 */
  const r = countSeatTypes([
    { seat: 'execution', label: '执行位', occupants: [{ name: '阿舟' }, { name: '财税专家' }] },
    { seat: 'management', label: '管理位', occupants: [{ name: '阿里星月' }] },
    { seat: 'strategy', label: '战略位', occupants: [{ name: '领队星月' }] },
    { seat: 'audit', label: '审计位', occupants: [] },
  ])
  const g = (k) => r.find((x) => x.key === k)
  ck('S-10d 执行位 2 人（多席累加 occupantsTotal）',
    g('execution') && g('execution').occupantsTotal === 2, g('execution'))
  /* ★ 同时盯住「占位数」的语义：1 个执行位坐 2 人 ⇒ occupied=1（占 1 格），
     两个字段不许混，混了就会出现「2 人显示成 2 个位被占」或反向的假读数。 */
  ck('S-10d2 同一位占 1 格（occupied=1，不与人数混）',
    g('execution') && g('execution').occupied === 1, g('execution'))
  ck('S-10e 审计位 0 人（left 不算在场）', g('audit') && g('audit').occupied === 0, g('audit'))
  /* ★ 这一铺 audit 位是空的（3 条都 left）⇒ 1 个空，不是 0 个空。
     「人」数 4 人（执行 2 + 管理 1 + 战略 1），「空」按格算 1 个。 */
  ck('S-10f 汇总=4 个位 · 4 人已坐 · 1 个空',
    seatSummary(r) === '4 个位 · 4 人已坐 · 1 个空', seatSummary(r))
}

/* ── S-11 接线：底部不再重复邀请 + 加入码已挪到上面 ── */
{
  const panel = readFileSync('packages/plugin-workstation/src/client/WorkstationPanel.tsx', 'utf8')
  /* ★★ 反向：底部「座位与邀请（真实席位）」整块已收缩成只读。
     判据看**标题**还叫不叫「座位与邀请」—— 那正是阿开说「底部怎么还有邀请」的那块。 */
  ck('S-11a 底部区块已改「席位一览（只读）」',
    panel.includes('席位一览（只读）') === true, 'not found')
  /* ★ 判据要盯「真渲染出来的标题」，不是任意出现过的字串 ——
     注释里写「原名叫 X」是留档，不是残留功能；拿 includes 判会把注释也算成红。 */
  ck('S-11b 底部旧标题已撤（Section title 层面）',
    panel.includes('title="座位与邀请（真实席位）"') === false, 'still present')
  /* ★ 反向：底部那块不得再有 onClick={() => setInviting(...)} （逐位邀请按钮） */
  const bottomInvite = /setInviting\(inviting === s\.seat/.test(panel)
  ck('S-11c 底部逐位邀请按钮已撤', bottomInvite === false, `still present=${bottomInvite}`)

  /* ★ 加入码入口：必须存在，且**不在标题栏按钮堆里**（阿开要求挪到上面）。
     判据取「生成工位加入码」出现的位置：它在 SeatSummaryRow 之后、
     且在 roots.length===0 的空态分支之前（即提在分支外）。 */
  /* ★ 取**主入口**那一处：`生成工位加入码` 出现在 ①空态分支 ②主入口（总览行下方）
     ③说明文案 GUIDE_JOINEE ④JoinCodeCard 自己的按钮文案里。
     取最后一个（主入口在空态之后）—— indexOf 取第一个会命中空态那处，判据就假红。 */
  const iJoin = panel.lastIndexOf("{showJoin ? '▾' : '🔑'} 生成工位加入码")
  const iSummary = panel.indexOf('<SeatSummaryRow')
  const iEmpty = panel.indexOf('还没有工位 —— 在下面输入一个名字，加第一个。')
  /* ★★ 2026-10-26 阿开（第二轮纠正）：「生成工位邀请码改回去，是我没讲清楚
     —— 我指的是**点开之后的**（24 小时 / 1张2张3张 / 🔑 生成工位加入码）在底部，
     改到上方顶部下方」。
     ⇒ 不再有「按钮 + 就地展开」这一步，改成 `<JoinCodeCard />` **常显**。 */
  /* ★ 取**最后**一处：空铺分支与主入口各有一个 `<JoinCodeCard compact />`，
     主入口在总览行下方（位置更后）。search 取第一处会命中空铺那份 ⇒ 假红。 */
  const iCard = panel.lastIndexOf('<JoinCodeCard compact />')
  ck('S-11d 加入码卡片常显（不再折叠按钮）', iCard > 0, iCard)
  ck('S-11e 卡片在席位总览行之后', iCard > iSummary && iSummary > 0, { iCard, iSummary })
  /* ★ 反向：不许再有「点开」那一步的切换按钮 */
  const toggle = /\{showJoin \? '▾' : '🔑'\} 生成工位加入码/.test(panel)
  ck('S-11f 不再需要折叠按钮（常显）', toggle === false, `still=${toggle}`)
  /* ★ 空铺分支也要有（判据独立锚它，不只数次数） */
  const iEmpty2 = panel.indexOf('还没有工位 —— 在下面输入一个名字，加第一个。')
  const cardCount = (panel.match(/<JoinCodeCard\s+compact\s*\/>/g) || []).length
  ck('S-11g 空铺分支+有工位分支都有卡片（≥2 处）', cardCount >= 2, cardCount)
  /* ★ 反向：标题栏按钮堆里不许再有它 */
  const titleBarHasJoin = /<button[\s\S]{0,400}?生成工位加入码[\s\S]{0,80}?<\/button>\s*\n\s*<button[\s\S]{0,50}?一键清场/.test(panel)
  ck('S-11h 标题栏按钮堆已撤', titleBarHasJoin === false, `still=${titleBarHasJoin}`)
}

/* ── S-8/S-9 接线：改了三处，每一处都要真接上（防"写了没用"） ── */
{
  const panel = readFileSync('packages/plugin-workstation/src/client/WorkstationPanel.tsx', 'utf8')
  ck('S-8a 总览行已渲染', panel.includes('<SeatSummaryRow'), 'not found')
  ck('S-8b 从 seat-summary 导入', panel.includes("from './seat-summary.js'"), 'not found')
  // ★ 反向：卡片上的「邀请」按钮必须已撤
  const inviteBtn = /onClick=\{props\.onInvite\}[\s\S]{0,200}?邀请/.test(panel)
  ck('S-8c 卡片「邀请」按钮已撤', inviteBtn === false, `still present=${inviteBtn}`)

  ck('S-9a 折叠有文字线索', panel.includes("'收起 ▴' : '展开 ▾'"), 'not found')
  ck('S-9b 附件内联组件存在', panel.includes('function PackFileList'), 'not found')
  ck('S-9c 附件内联到选中条目', panel.includes('inline\n                      />'), 'not found')
  // ★ 反向：底部那份重复的附件渲染必须已撤
  ck('S-9d 底部重复附件区已撤', panel.includes('这个位上还没有文件') === false, 'still present')
}

/* ── S-12 ★★ 「有人，但读不到是谁」的假阳性（阿开截图实证）──

   现象：审计位（3 个 Agent 全 left）与签名位（平台位，天生不对外入驻）
        两张卡都显示「有人，但读不到是谁」，把「空着」说成「有人但看不见」。
   根因：判据只有 `seatCount > 0`，而 `seat_count` = **这个工位绑了几个席位**
        （位存在吗），**不是有没有人坐**。与本轮 holder 那个 bug 同族。
   改后：席位自己说「空 / 不可入驻」⇒ 老实说空位，不许说「有人」。 */
{
  const { holderUnknownText } = await import('../packages/plugin-workstation/src/client/notify-copy.ts')
  /* ① 有真人名字 ⇒ 不提示 */
  ck('S-12a 有人有名字不提示', holderUnknownText(1, 1, false) === '', holderUnknownText(1, 1, false))
  /* ② 审计位真实形状：seat_count=1，但 occupants 为空（人全 left）⇒ 不许说「有人」 */
  ck('S-12b 席位空着 ⇒ 不说「有人」', holderUnknownText(0, 1, true) === '', holderUnknownText(0, 1, true))
  /* ③ 签名位：cap=0 不可入驻 ⇒ 也不许说「有人」 */
  ck('S-12c 不可入驻 ⇒ 不说「有人」', holderUnknownText(0, 1, true) === '', holderUnknownText(0, 1, true))
  /* ④ 真异常：位配了、席位没说空、又没取到人 ⇒ 这才是「有人但读不到」 */
  ck('S-12d 真异常才报「有人但读不到」',
    holderUnknownText(0, 1, false) === '有人，但读不到是谁', holderUnknownText(0, 1, false))
  /* ⑤ 完全没配席位 ⇒ 什么也不说（空工位） */
  ck('S-12e 没配席位不说话', holderUnknownText(0, 0, false) === '', holderUnknownText(0, 0, false))
}

/* ── S-13 收起按钮显著化（阿开：「刷新旁边增加一个收起」）── */
{
  const panel = readFileSync('packages/plugin-workstation/src/client/WorkstationPanel.tsx', 'utf8')
  ck('S-13a 展开时出现明确的「收起 ▴」按钮', panel.includes('收起 ▴') === true, 'not found')
  /* ★ 反向：列表头不许再有「▾ 刷新」 —— 也就是「收起」不能只是把刷新按钮改个名 */
  ck('S-13b 收起是独立按钮，不劫持「刷新」',
    /\{\s*showSeatGuide\s*\?\s*'▾'\s*:\s*'▸'\s*\}\s*席位说明/.test(panel), '席位说明按钮名应稳定')
  /* ★ 席位说明入口名必须稳定（不能变成「收起」—— 否则下次找不到入口） */
  ck('S-13c 入口名稳定（永远是「席位说明」）',
    panel.includes('席位说明</button>') || /席位说明\s*<\/button>/.test(panel), 'not found')
}

/* ── S-14 ★★ 「席位一览（只读）」整块删除（阿开：全部不要，只留管理助理）── */
{
  const panel = readFileSync('packages/plugin-workstation/src/client/WorkstationPanel.tsx', 'utf8')
  ck('S-14a RolesSeatSection 定义已删',
    /function RolesSeatSection\s*\(/.test(panel) === false, 'still defined')
  ck('S-14b RolesSeatSection 不再挂载',
    /<RolesSeatSection\s*\/>/.test(panel) === false, 'still mounted')
  /* ★ 盯「真渲染的 Section title」，不盯注释 —— 注释里留档说明不算残留功能。 */
  ck('S-14c 只读席位表标题已撤（Section title 层面）',
    panel.includes('title="席位一览（只读）"') === false, 'still present')
  ck('S-14d 管理助理区块仍在（唯一保留）',
    panel.includes('<ManagementGrantSection') === true, 'not found')
}

/* ── S-15 ★★ 默认标配 6 个位 + 签名位第一（阿开 2026-10-26）──
   ★ 这条判据读**后端** store.py：前端排序对了但后端只开 4 个位，客户照样缺位。 */
{
  const store = readFileSync('/opt/shanhai-toolkit-opensource/modules/08-workshop/kai-pu/src/store.py', 'utf8')
  const m = store.match(/DEFAULT_SEATS\s*=\s*\[([\s\S]*?)\n\]/)
  ck('S-15a DEFAULT_SEATS 能取到', m !== null, 'not found')
  if (m) {
    const seats = [...m[1].matchAll(/\("([a-z_]+)",/g)].map((x) => x[1])
    ck('S-15b 标配恰好 6 个位', seats.length === 6, seats)
    ck('S-15c 签名位排第一', seats[0] === 'signature', seats)
    ck('S-15d 六个位齐全（含 strategy 与 management_assistant）',
      ['signature','management','execution','audit','strategy','management_assistant']
        .every((k) => seats.includes(k)), seats)
    ck('S-15e 顺序与前端 SEAT_ORDER 一致（签名/战略/管理/助理/审计/执行）',
      seats.join(',') === 'signature,strategy,management,management_assistant,audit,execution',
      seats.join(','))
  }
}

/* ── S-16 ★★ 管理助理位：功能并进位内、页面底部不再单独挂（阿开 2026-10-26 第三轮）──
   ★ 阿开原话：「支持点击就在下方弹出管理助理（临时代管）的功能介绍和指定功能。
     你觉得如何？这样工位下方的席位一览（只读）以及管理助理（临时代管）就可以都取消了」 */
{
  const panel = readFileSync('packages/plugin-workstation/src/client/WorkstationPanel.tsx', 'utf8')
  /* ① 席位表的第 4 行（management_assistant）点开就地展开 —— 必须有 embedded 挂载 */
  ck('S-16a 管理助理面板以 embedded 内嵌展开',
    panel.includes('<ManagementGrantSection embedded />') === true, 'not found')
  /* ② 页面底部那份独立挂载已撤（否则同一功能两处，人不知道点哪个） */
  const bareMount = /<ManagementGrantSection\s*\/>/.test(panel)
  ck('S-16b 页面底部不再单独挂载管理助理栏', bareMount === false, 'still mounted bare')
  /* ③ 席位行必须可点（整行命中区）—— 设了 onClick 才算 */
  ck('S-16c 管理助理位那一行可点展开',
    panel.includes('onClick={isMa ? () => setShowMa') === true, 'not clickable')
  /* ④ 签名位不上号、不能邀请（显示「山海签名位」，不显示「空」） */
  ck('S-16d 签名位显示为「山海签名位」且排第一不上号',
    panel.includes("'山海签名位'") === true && panel.includes("{isSig ? '—' : `#${i}`}") === true,
    'signature row wrong')
}

/* ── S-17 ★★ 任务页：项目筛选改一行下拉，横向胶囊整排撤掉（阿开 2026-10-26）── */
{
  const panel = readFileSync('packages/plugin-workstation/src/client/WorkstationPanel.tsx', 'utf8')
  /* ① 横向项目胶囊（ProjectChip）已不再用于项目筛选行 */
  ck('S-17a 项目筛选不再用横向 ProjectChip 列表',
    panel.includes('<ProjectChip active={projFilter === \'\'}') === false, 'chip row still there')
  /* ② 换成下拉，且「全部项目」带总数 */
  ck('S-17b 项目筛选已是下拉（含「全部项目」）',
    panel.includes('全部项目（') === true && panel.includes('onChange={(e) => setProjFilter(e.target.value)}') === true,
    'select missing')
  /* ③ 「未归类」筛选入口已删 —— 阿开：「未归类全删了」 */
  ck('S-17c 「未归类」筛选入口已删',
    panel.includes("projFilter === '__none__'") === false, 'none filter still present')
  /* ④ 上面四段/状态计数跟项目走（用的是 visibleTasks 聚合，不是全铺 counts） */
  ck('S-17d 状态计数按当前项目现数（countInView）',
    panel.includes('const countInView = (status: string)') === true &&
    panel.includes('const n = countInView(k)') === true, 'count not scoped')
}

/* ── S-18 ★★ 发布任务必须先选项目（阿开 2026-10-26 定）── */
{
  const panel = readFileSync('packages/plugin-workstation/src/client/WorkstationPanel.tsx', 'utf8')
  ck('S-18a 发布前校验项目必选（project_required）',
    panel.includes("code: 'project_required'") === true, 'no guard')
  ck('S-18b 项目下拉不再提供「未归类」选项',
    panel.includes('<option value="">未归类</option>') === false, 'still offers 未归类')
  ck('S-18c 项目下拉占位改成「（先选一个项目）」',
    panel.includes('（先选一个项目）') === true, 'placeholder missing')
  ck('S-18d 资料页不再出现「未归项目的协作」字样',
    panel.includes('未归项目的协作') === false, 'old label still rendered')
}

/* ── 输出 ── */
const total = pass + fails.length
if (fails.length === 0) {
  console.log(`✅ 席位总览判据全绿：${pass}/${total}`)
  process.exit(0)
} else {
  console.log(`❌ 失败 ${fails.length}/${total}`)
  for (const f of fails) console.log('   ' + f)
  process.exit(1)
}
