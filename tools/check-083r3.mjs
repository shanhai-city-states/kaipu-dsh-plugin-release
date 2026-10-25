#!/usr/bin/env node
/**
 * 083-r3（dispatch-083-r3-node-binding · 乙案 · 派活绑定工位）· 前端判据
 * =====================================================================
 * A 段 · `node-pick.ts` 纯函数：缩小版工位图的取数口径（序号/姓名/空位/受邀）
 * B 段 · 接线：发布表单带 nodeId、toast 说清发到哪、任务卡能回看绑定
 *
 * ★ 本单最要紧的一条（阿开原话）：缩小版工位图要与工位界面**序号、姓名完全一致**。
 *   所以判据不比对文案，而是比对「两处用的是不是同一组函数、同一个字段」：
 *   `seq` 与 `holders[].name` —— 只要有一处自己造编号，C 段必红。
 *
 * 跑法：node tools/build.mjs && node tools/check-083r3.mjs（期望退出码 0）
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const WS = join(ROOT, 'packages/plugin-workstation')
const SRC_PANEL = join(WS, 'src/client/WorkstationPanel.tsx')
const SRC_NODE = join(WS, 'src/client/node-pick.ts')
const SRC_LIVE = join(WS, 'src/client/live.ts')
const SRC_SERVICE = join(WS, 'src/remote/service.ts')
const LIB_NODE = join(WS, 'lib/client/node-pick.js')
const LIB_BUNDLE = join(WS, 'lib/client.js')

let pass = 0
let fail = 0
/* 三参签名（id 已含完整标题）—— 四参写法会把表达式喂进标题位，造成假红 */
function check(id, ok, detail) {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '✓' : '✗'} ${id}${detail === undefined ? '' : `\n    ${detail}`}`)
}
function decodeEscapes(t) {
  return t.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
}
function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

for (const f of [SRC_PANEL, SRC_NODE, SRC_LIVE, SRC_SERVICE, LIB_NODE, LIB_BUNDLE]) {
  if (!existsSync(f)) {
    console.error(`缺文件：${f}\n（先跑 node tools/build.mjs）`)
    process.exit(2)
  }
}
const N = (() => {
  const code = readFileSync(LIB_NODE, 'utf8')
  const shell = { exports: {} }
  new Function('exports', 'module', 'require', code)(shell.exports, shell, () => {
    throw new Error('node-pick 是纯函数模块，不该 require 任何东西')
  })
  return shell.exports
})()
const panel = decodeEscapes(stripComments(readFileSync(SRC_PANEL, 'utf8')))
const live = stripComments(readFileSync(SRC_LIVE, 'utf8'))
const service = stripComments(readFileSync(SRC_SERVICE, 'utf8'))
const bundle = decodeEscapes(readFileSync(LIB_BUNDLE, 'utf8'))

/* 与 `GET /org/tree` 实测同形（含一个空位、一个受邀位、一个多人位） */
const NODES = [
  { node_id: 'n1', name: '负责人', seq: 1, holders: [] },
  { node_id: 'n2', name: '执行位', seq: 2, holders: [{ name: '阿舟' }, { name: '财税客户端 Codex' }] },
  { node_id: 'n3', name: '管理位', seq: 3, holders: [{ name: '阿里星月', online: true }] },
  { node_id: 'n4', name: '审计位', seq: 4, holders: [], invited: { invitedName: '张三' } },
  { node_id: 'n5', name: '签名位', seq: 5, holders: [] },
]

console.log('── A · 缩小版工位图的取数口径 ──')

check('A-1 序号只认 seq（#2 这种写法，与工位页徽标同款）',
  N.seqLabel(NODES[1]) === '#2' && N.nodeChipLabel(NODES[1]) === '#2 执行位',
  `${N.nodeChipLabel(NODES[1])}`)

check('A-2 反向对照：没有 seq 的老节点不编造编号',
  N.seqLabel({ node_id: 'x', name: '临时位' }) === '' && N.nodeChipLabel({ node_id: 'x', name: '临时位' }) === '临时位')

check('A-3 在位者姓名只认 holders[].name，多人用「·」原样并列（不截断）',
  N.nodeChipWho(NODES[1]) === '阿舟·财税客户端 Codex', N.nodeChipWho(NODES[1]))

check('A-4 空位显示「空」；受邀位显示「已受邀：张三」（两者必须不同）',
  N.nodeChipWho(NODES[4]) === '空' && N.nodeChipWho(NODES[3]) === '已受邀：张三',
  `${N.nodeChipWho(NODES[4])} / ${N.nodeChipWho(NODES[3])}`)

check('A-5 排序只按 seq（不按数组下标，否则与工位页顺序会对不上）',
  JSON.stringify(N.sortedNodes([NODES[3], NODES[0], NODES[4], NODES[1], NODES[2]]).map((n) => n.seq))
  === '[1,2,3,4,5]')

check('A-6 发布结果 toast：说清「发到哪 + 指派给谁」，四档都不含糊',
  N.publishToast('#2 执行位', '阿舟') === '✅ 已发布到「#2 执行位」· 指派给 阿舟'
  && N.publishToast('', '') === '✅ 已发布到公共池 · 谁都能领'
  && N.publishToast('', '阿舟').includes('公共池 · 指派给 阿舟')
  && N.publishToast('#4 审计位', '').includes('已发布到「#4 审计位」'),
  `${N.publishToast('#2 执行位', '阿舟')} | ${N.publishToast('', '')}`)

check('A-7 选择器副标题：在线/离线能领/空位/受邀 四种说法分得开',
  N.pickerHint(NODES[2]).includes('在线')
  && N.pickerHint(NODES[1]).includes('离线，能领活')
  && N.pickerHint(NODES[4]).includes('空位')
  && N.pickerHint(NODES[3]).includes('已受邀'),
  `${N.pickerHint(NODES[2])} / ${N.pickerHint(NODES[4])}`)

check('A-8 任务卡绑定标签：绑了给工位名，没绑说公共池',
  N.taskBindingText('#2 执行位', '') === '#2 执行位'
  && N.taskBindingText('', '') === '公共池 · 谁都能领'
  && N.taskBindingText('#2 执行位', '阿舟') === '#2 执行位 · 指派给 阿舟')

check('A-9 发布失败人话：node_not_found / agent_not_found 都翻成人话',
  N.humanizePublishError('node_not_found', 'x').includes('工位已经不在了')
  && N.humanizePublishError('agent_not_found', 'x').includes('铺子里')
  && N.humanizePublishError('weird', '服务端原话').includes('服务端原话'))

console.log('── B · 接线 ──')

check('B-1 发布时把 nodeId 传给 createTask（第 7 参）',
  panel.includes('notifyId || undefined, nodeId || undefined,'))
check('B-2 live.createTask 收 nodeId 并进 query',
  live.includes('nodeId?: string,\n): Promise<OrgResult<TaskItem>>') && live.includes('query.nodeId = nodeId'))
check('B-3 service.tasksCreate 把 nodeId 落到 node_id（实测这条被后端认）',
  service.includes("if (typeof query.nodeId === 'string' && query.nodeId.length > 0) body.node_id = query.nodeId"))
check('B-4 选择器数据源与工位页同端点（orgTree → setNodeOpts），不另开接口',
  panel.includes('loadOrgTree().then((r) => {') && panel.includes('setNodeOpts(sortedNodes(r.data.nodes)'))
check('B-5 选择器渲染：nodeChipLabel + nodeChipWho（两处共用一个函数）',
  panel.includes('nodeChipLabel(n)') && panel.includes('nodeChipWho(n)'))
check('B-6 「不指定工位（谁都能领）」这一档存在且可选',
  panel.includes('PUBLIC_POOL_LABEL') && panel.includes('setNodeId(PUBLIC_POOL_VALUE)'))
check('B-7 发布成功 toast 用 publishToast（不是写死「任务已发布」）',
  panel.includes('const okText = publishToast(') && !panel.includes("}, '任务已发布')"))
check('B-8 任务卡能回看绑定结果（node_id → 工位名）',
  panel.includes('nodeLabel={nodeLabelOf(t.node_id)}') && panel.includes('taskBindingText(props.nodeLabel ?? ')
  && panel.includes('const nodeLabelOf = (id?: string | null): string =>'))
check('B-9 失败提示走 humanizePublishError（node_not_found 不上屏内部码）',
  panel.includes("humanizePublishError(r.code ?? '', notifyFailText(r.code, r.message))"))
check('B-10 产物里含选择器文案（证明 build 吃到改动）',
  bundle.includes('不指定工位（谁都能领）') || bundle.includes('\\u4e0d\\u6307\\u5b9a\\u5de5\\u4f4d'))
check('B-11 没把 nodeId 塞进签名域（`POST /agent/tasks` 的签名仍是三个字段）',
  !panel.includes('agentTaskCreate(') && service.includes("body.node_id = query.nodeId"))

console.log(`\n全绿：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`)
process.exit(fail === 0 ? 0 : 1)
