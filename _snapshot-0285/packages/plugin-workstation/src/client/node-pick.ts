/* ══════════════════════════════════════════════════════════════════════════
 * 083-r3 · 派活绑定工位（dispatch-083-r3-node-binding · 乙案）—— 纯判断与纯文案
 *
 * 本单最要紧的一条是阿开的原话：「与实际工位号和显示一致，这样就不需要切换
 * 工位界面去核对」。⇒ 缩小版工位图与工位页**必须共用同一套取数口径**：
 *   序号 只认 `node.seq`（不按数组下标、不自己编号）
 *   姓名 只认 `holders[].name`（不截断、不改写）
 *   空位 与「已受邀」必须分得开（否则会以为邀请没发出去）
 * 这些口径写在这里，两处调用同一个函数，才不会各写各的、慢慢跑偏。
 * ══════════════════════════════════════════════════════════════════════════ */

export interface NodeHolderLike {
  agentId?: string
  name?: string
  seat?: string
  online?: boolean
  onRoster?: boolean
  hasCred?: boolean
  /** present | joined | invited（服务端三态；老数据可能没有 */
  joinState?: string
}

export interface NodeInvitedLike {
  lamp?: string
  invitedName?: string
  invitedAt?: string
}

export interface OrgNodeLike {
  node_id: string
  name: string
  node_kind?: string
  seq?: number
  seat_count?: number
  holders?: NodeHolderLike[]
  invited?: NodeInvitedLike | null
}

/** 「不指定工位」的取值 —— 空串与「没选」同义，不留第三种状态 */
export const PUBLIC_POOL_VALUE = ''
/** 公共池那一档的文案（派单书 §三-任务1-5 指定） */
export const PUBLIC_POOL_LABEL = '不指定工位（谁都能领）'

/** 工位编号：`#2` 这种形式，与工位页卡片上的徽标**同一个写法** */
export function seqLabel(node: OrgNodeLike): string {
  return typeof node.seq === 'number' && Number.isFinite(node.seq) ? `#${node.seq}` : ''
}

/** 工位图上这一格的主标签：`#2 执行位`（序号 + 名称，两处显示完全一致） */
export function nodeChipLabel(node: OrgNodeLike): string {
  const seq = seqLabel(node)
  const name = (node.name ?? '').trim()
  return seq.length > 0 ? `${seq} ${name}` : name
}

/** 在位者一行字：`阿舟·Codex` / `已受邀：张三` / `空` —— 与工位页第二行同口径 */
export function nodeChipWho(node: OrgNodeLike): string {
  const holders = Array.isArray(node.holders) ? node.holders : []
  const names = holders
    .map((h) => (h.name ?? '').trim())
    .filter((n) => n.length > 0)
  if (names.length > 0) return names.join('·')
  const invited = node.invited
  if (invited !== null && invited !== undefined) return invitedLabel(invited)
  return '空'
}

/** 工位排序：只按 seq；没有 seq 的排最后（老数据），同序时按名字，保证每次渲染稳定 */
export function sortedNodes(nodes: OrgNodeLike[]): OrgNodeLike[] {
  const withSeq = nodes.filter((n) => typeof n.seq === 'number' && Number.isFinite(n.seq))
  const rest = nodes.filter((n) => !(typeof n.seq === 'number' && Number.isFinite(n.seq)))
  withSeq.sort((a, b) => (a.seq as number) - (b.seq as number))
  rest.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-Hans-CN'))
  return [...withSeq, ...rest]
}

/** 发布结果 toast：说清「发到哪」+「指派给谁」（派单书 §三-任务3，防发错工位） */
export function publishToast(nodeLabel: string, agentName: string): string {
  const who = (agentName ?? '').trim()
  if (nodeLabel.length === 0) {
    return who.length > 0
      ? `✅ 已发布到公共池 · 指派给 ${who}`
      : '✅ 已发布到公共池 · 谁都能领'
  }
  return who.length > 0
    ? `✅ 已发布到「${nodeLabel}」· 指派给 ${who}`
    : `✅ 已发布到「${nodeLabel}」`
}

/** 选中工位那一格的副标题（选择器里第二行） */
export function pickerHint(node: OrgNodeLike): string {
  const holders = Array.isArray(node.holders) ? node.holders : []
  if (holders.length > 0) {
    const online = holders.filter((h) => h.online === true).length
    return online > 0 ? `${nodeChipWho(node)}（在线）` : `${nodeChipWho(node)}（离线，能领活）`
  }
  if (node.invited !== null && node.invited !== undefined) return invitedLabel(node.invited)
  return '空位（没人，发了暂时没人领）'
}

/* ── 三态（派单书 §二-任务3）────────────────────────────────────────────── */

export type JoinState = 'present' | 'joined' | 'invited'

/**
 * 服务端 `joinState` 的出入口。
 * ★ 老数据没有 `joinState` 时按 `online` 退一格：online=true ⇒ present，否则 joined。
 *   **绝不**因为缺字段就显示成「已受邀」—— 那是把老实人当成没来。
 */
export function joinStateOf(holder: NodeHolderLike): JoinState {
  const s = (holder.joinState ?? '').trim()
  if (s === 'present' || s === 'joined' || s === 'invited') return s
  return holder.online === true ? 'present' : 'joined'
}

/** 状态点：绿=在场、灰=人在但没心跳、空心虚线=受邀未到 */
export function dotOf(state: JoinState): { color: string; hollow: boolean; title: string } {
  if (state === 'present') return { color: '#27ae60', hollow: false, title: '在岗（90 秒内有心跳）' }
  if (state === 'joined') return { color: '#bbb', hollow: false, title: '离线（人在，没收到心跳）' }
  return { color: '#bbb', hollow: true, title: '已受邀，还没来' }
}

/** 「已受邀」一行字：有名字带名字，没名字就说在等（不留空） */
export function invitedLabel(invited: NodeInvitedLike): string {
  const n = (invited.invitedName ?? '').trim()
  return n.length > 0 ? `已受邀：${n}` : '已受邀 · 等待接入'
}

/**
 * 该不该显示「已受邀」。
 * ★ 条件严一点：**只有 holders 为空**才算受邀态。有 holder 就不该再显示邀请
 *   （人已经来了，还挂着「已受邀」会让人以为有两个）。
 */
export function showInvited(holders: NodeHolderLike[], invited: NodeInvitedLike | null | undefined): boolean {
  if (holders.length > 0) return false
  return invited !== null && invited !== undefined
}

/** 任务卡上的绑定标签（铺主视角）：`#2 执行位 · 指派给 阿舟` / `公共池 · 谁都能领` */
export function taskBindingText(nodeLabel: string, agentName: string): string {
  const label = (nodeLabel ?? '').trim()
  const who = (agentName ?? '').trim()
  if (label.length === 0 && who.length === 0) return '公共池 · 谁都能领'
  if (label.length === 0) return `公共池 · 指派给 ${who}`
  return who.length > 0 ? `${label} · 指派给 ${who}` : label
}

/** 工位隔离的失败人话（派单书 §二-2.2 两个错误码 + 兜底） */
export function humanizePublishError(code: string, message: string): string {
  switch (code) {
    case 'node_not_found':
      return '选的那个工位已经不在了（可能被改名或删掉），换个工位或选「谁都能领」'
    case 'agent_not_found':
      return '选的那个 Agent 已经不在这个铺子里了，换个目标或选「谁在岗谁领」'
    case 'project_not_found':
      return '选的项目已经不在了，换一个项目再发'
    default: {
      const m = (message ?? '').trim()
      return m.length > 0 ? m : '发布没成功，稍后再试一次'
    }
  }
}
