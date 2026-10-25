/* ══════════════════════════════════════════════════════════════════
   卡座布局 · 纯逻辑（2026-10-26 阿开定 · 最终口径）

   ★ 阿开原话（这一版按他说的写，不再自己发挥）：
     「工位还是保持原来的 10 个座位要在顶部。
      6 个位 · 4 人已坐 · 2 个空
      —山海签名位（已占） #1战略位1人 #2管理位1人 #3管理助理位空 #4审计位空 #5执行位2人
      这里 2 行一行 5 个座位。然后把上面的 6 个座位按照上面那样先落座显示系统默认工位」

   ⇒ 卡座 = **固定 10 格**（2 行 × 5 列）。
     前 6 格 = 系统默认工位，顺序与顶部席位表**逐字同序**（SEAT_ORDER）。
     后 4 格 = 空位（可「+ 加位置」）。
     「先落座」= 6 个系统位**先占住前 6 格**，其它任何东西都不许插到它们前面。

   ★★ 之前两版为什么乱（记下来，别再犯）：
     第一版：按「没有子节点」取卡片 ⇒ 8 个历史遗留的游离 role 混进卡座
             （6 系统位 + 8 游离 = 12 张卡，5×2 被撑成 3 行）。
     第二版：改成「只放 6 个座位 + 补 4 空位」⇒ 格数对了，
             但那是 6 张真卡片 + 4 个占位块，**不是**「10 个座位里前 6 个落座」。
             差别在于：用户要的是「卡座有 10 个座位，其中 6 个是系统位已落座」，
             不是「只有 6 个座位」。
     ⇒ 现在：10 格恒定，前 6 格按 SEAT_ORDER 落座，后 4 格空。

   ★ 纯函数，判据能真跑：喂脏数据（12 节点）必须仍得 10 格、前 6 格是系统位。
   ══════════════════════════════════════════════════════════════════ */

/** 卡座固定格数（阿开 2026-10-19 定稿上限 10 位，2026-10-26 重申「还是 10 个座位」） */
export const GRID_CAPACITY = 10
export const SEATS_PER_ROW = 5

/** 6 个系统默认位，顺序 = 顶部席位表 SEAT_ORDER（逐字同序，单一来源） */
export const SYSTEM_SEAT_ORDER: ReadonlyArray<string> = [
  'signature',
  'strategy',
  'management',
  'management_assistant',
  'audit',
  'execution',
]

export interface NodeLike {
  node_id: string
  name: string
  node_kind?: string
  parent_node_id?: string | null
  seatKey?: string
}

export interface SeatCell<T> {
  /** 'system' = 系统默认位落座；'extra' = 用户自建的空位/额外位 */
  kind: 'system' | 'extra'
  /** 系统位对应的 seatKey（extra 为空串） */
  seatKey: string
  /**
   * 该格绑定到的节点；`undefined` = 这一格空着。
   * ★ 写成 `T | undefined` 而不是 `node?: T`：本项目 tsconfig 开了
   *   `exactOptionalPropertyTypes` ⇒ 可选属性不允许显式赋 `undefined`，
   *   而这里「空着」就是**显式**的 undefined，必须写进类型里。
   */
  node: T | undefined
}

/**
 * 把一个 seatKey 认出来 —— 优先节点自带的 `seatKey`，其次按名字认。
 * ★ 按名字认是给老数据兜底（早年建的位没有 seatKey 字段）。
 * ★ 认不出返回空串，**不猜**（猜错会把位排错，人对着表找不到）。
 */
export function resolveNodeSeatKey(n: NodeLike): string {
  const k = typeof n.seatKey === 'string' ? n.seatKey.trim() : ''
  if (k.length > 0) return k
  const name = (n.name ?? '').trim()
  if (name.includes('签名')) return 'signature'
  if (name.includes('战略')) return 'strategy'
  if (name.includes('管理助理')) return 'management_assistant'
  if (name.includes('管理')) return 'management'
  if (name.includes('审计')) return 'audit'
  if (name.includes('执行')) return 'execution'
  return ''
}

/**
 * 生成卡座 10 格。
 *
 * 规则（按阿开的「先落座」）：
 *   ① 前 6 格固定为系统位，顺序 = SYSTEM_SEAT_ORDER
 *   ② 每个系统位去 `nodes` 里找**对上 seatKey** 的座位（node_kind='post'）挂上
 *   ③ 找不到对应节点的系统位 ⇒ 那一格**空着**（不臆造一个假节点）
 *   ④ 第 7..10 格：先放「用户自建的额外座位」（node_kind='post' 且 seatKey 不在系统六位里），
 *      再补空位
 *   ⑤ 非座位节点（游离 role / team 根）**一律不进卡座**
 *
 * ★★ 为什么系统位找不到节点时空着而不是补一个假卡片：
 *   空着 = 「这个位还没有」（真实状态）；补假卡片 = 让人以为有位可邀请，
 *   点进去报错。空位是真话，假卡片是假话。
 */
export function buildSeatGrid<T extends NodeLike>(
  nodes: ReadonlyArray<T>,
  systemOrder: ReadonlyArray<string> = SYSTEM_SEAT_ORDER,
  capacity = GRID_CAPACITY,
): SeatCell<T>[] {
  /* 只认座位（post）。老铺可能一个 post 都没有 ⇒ 卡座全空，但格数不变。 */
  const seats = nodes.filter((n) => (n.node_kind ?? '') === 'post')

  /* seatKey → 节点（同 key 多个时取第一个，不合并 —— 一个位就该一个节点） */
  const byKey = new Map<string, T>()
  for (const n of seats) {
    const k = resolveNodeSeatKey(n)
    if (k.length > 0 && !byKey.has(k)) byKey.set(k, n)
  }

  const cells: SeatCell<T>[] = []
  const used = new Set<string>()

  /* ① 系统位：按系统顺序先落座 */
  for (const key of systemOrder) {
    if (cells.length >= capacity) break
    const node = byKey.get(key)
    if (node !== undefined) used.add(node.node_id)
    cells.push({ kind: 'system', seatKey: key, node })
  }

  /* ② 其余自建座位，按原顺序（后端给的 created_at 序）占后面的格 */
  for (const n of seats) {
    if (cells.length >= capacity) break
    if (used.has(n.node_id)) continue
    used.add(n.node_id)
    cells.push({ kind: 'extra', seatKey: resolveNodeSeatKey(n), node: n })
  }

  /* ③ 补空位到 capacity */
  while (cells.length < capacity) {
    cells.push({ kind: 'extra', seatKey: '', node: undefined })
  }

  return cells
}

/** 卡座里已落座的系统位个数（用于「6 个位」文案） */
export function systemSeatedCount<T>(cells: ReadonlyArray<SeatCell<T>>): number {
  return cells.filter((c) => c.kind === 'system' && c.node !== undefined).length
}

/** 卡座里空着的格数（系统位未落座 + 补的空位） */
export function emptyCount<T>(cells: ReadonlyArray<SeatCell<T>>): number {
  return cells.filter((c) => c.node === undefined).length
}
