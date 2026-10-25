/* ══════════════════════════════════════════════════════════════════
   卡座分区 · 纯逻辑（2026-10-26 阿开定）

   ★ 阿开原话：「工位布局怎么变了呢？就按你现在的顺序，但是还会回到之前的
     卡座模式啊 两行一行 5 个座位，6 个系统默认工位」

   ★★ 根因（不是网格常量变了，是**进网格的集合变了**）：
     原来进网格的判据是「没有子节点的节点」（leaves）。
     历史遗留的游离 `role` —— 没有父节点、也不是座位 —— 同样没有子节点，
     于是被当成卡片一起铺进去：6 个系统位 + 8 个游离 role = 12 张卡，
     5×2 的卡座就被撑乱了。

   ★ 判据为什么用 `node_kind === 'post'` 而不是 `parent_node_id`：
     「没有父节点」是**数据缺陷**；「不是座位」是**语义**。
     拿缺陷当判据 = 让脏数据决定界面；拿语义当判据 = 脏数据再多也不影响卡座。

   ★ 纯函数，不碰 React：判据可以直接造三种脏数据形态断言分区结果，
     不用起浏览器、不用截图。
   ══════════════════════════════════════════════════════════════════ */

export interface SeatLikeNode {
  node_id: string
  name: string
  node_kind?: string
  parent_node_id?: string | null
}

export interface SeatPartition<T extends SeatLikeNode> {
  /** 进卡座（5 列 × N 行）—— 只含座位 */
  seats: T[]
  /** 不进卡座、但也不藏起来（历史遗留的非座位节点） */
  stray: T[]
  /** 判据来源：'post' = 按座位语义分区；'fallback' = 全铺没有座位，退回旧口径 */
  basis: 'post' | 'fallback'
}

/**
 * 把节点分成「卡座」与「未归属」。
 *
 * ★ fallback 的必要性：极老的铺子可能一个 post 都没有（纯 role 结构）。
 *   此时若严格按 post 过滤 ⇒ 卡座空着、页面像坏了。
 *   退回旧口径（无子节点者为位）至少能显示出来 ——
 *   **界面在脏数据下可以退化，但不该消失**。
 */
export function partitionSeats<T extends SeatLikeNode>(nodes: T[]): SeatPartition<T> {
  const posts = nodes.filter((n) => (n.node_kind ?? '') === 'post')
  if (posts.length > 0) {
    const stray = nodes.filter((n) => (n.node_kind ?? '') !== 'post')
    return { seats: posts, stray, basis: 'post' }
  }
  /* fallback：老口径 —— 没有子节点者视为位 */
  const hasChild = new Set<string>()
  for (const n of nodes) {
    const p = n.parent_node_id ?? ''
    if (p !== '') hasChild.add(p)
  }
  const leaves = nodes.filter((n) => !hasChild.has(n.node_id))
  const seats = leaves.length > 0 ? leaves : nodes
  const seatIds = new Set(seats.map((n) => n.node_id))
  return { seats, stray: nodes.filter((n) => !seatIds.has(n.node_id)), basis: 'fallback' }
}

/** 卡座行数（5 列一行）；用于「还有 N 个位未显示」与高度估算 */
export const SEATS_PER_ROW = 5

export function rowCount(seatCount: number): number {
  if (seatCount <= 0) return 0
  return Math.ceil(seatCount / SEATS_PER_ROW)
}

/**
 * 空位补齐数：把卡座补到整行。
 * ★ 6 个座位 ⇒ 补 4 个空位 = 两行各 5 个（阿开要的「两行一行 5 个」）。
 * ★ 超过 10 个不再补 —— 那是「上限 10 位」的老口径，补了会多出第三行空位。
 */
export function emptySeatSlots(seatCount: number, cap = 10): number {
  const total = Math.max(cap, seatCount)
  const rows = Math.ceil(total / SEATS_PER_ROW)
  return rows * SEATS_PER_ROW - seatCount
}
