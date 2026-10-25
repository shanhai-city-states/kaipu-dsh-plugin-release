/* ══════════════════════════════════════════════════════════════════
   席位数量总览 · 纯逻辑（2026-10-26 阿开）

   ★ 为什么要有这个：
     原工位卡片上**每个空位都挂一个「邀请」按钮**，而邀请本身还要先选座位类型
     （在邀请栏里再选一次）⇒ 同一件事问两遍，页面也被按钮塞满。
     阿开原话：「座位与邀请是否不需要提供邀请按钮，只需要展示每一个类型席位数量，
     因为这里的邀请还要对上面的座位号所以没有必要，唯一有必要的是保留
     —— 管理助理（临时代管）的生成邀请按钮。」

   ★ 所以这里的职责**只有一个**：把 `RolesSeat[]` 压成「每类几个、坐着几个」。
     不判断能不能邀请 —— 邀请入口收归到「管理助理（临时代管）」一处，
     那里本来就自带类型选择（INVITE_LAMPS），不需要卡片上再来一遍。

   ★ 纯函数，不碰 React、不碰网络：可单测，判据能真跑输入→输出。
   ══════════════════════════════════════════════════════════════════ */

/** 一个座位的形状（只取本模块要用的字段 —— 结构子集，不复制契约类型） */
export interface SeatLike {
  seat?: string
  label?: string
  /* ★ 收 `undefined`：调用方传的是 `s.occupants`（可能是 undefined），
     而本仓 tsconfig 开了 `exactOptionalPropertyTypes`
     ⇒ 只写 `occupants?: T[]` 不够，必须显式含 `undefined`，否则编译不过。 */
  occupants?: Array<{ name?: string }> | undefined
  full?: boolean | undefined
}

export interface SeatTypeCount {
  /** 席位类型 key（execution / audit / management / strategy / signature / management_assistant） */
  key: string
  /** 人话名字（执行位 / 审计位 …） */
  label: string
  /** 该类型一共几个位 */
  total: number
  /**
   * ★ 该类型**坐了几个位**（一席多人也只算 1）—— 用于「空几格」的算术。
   * ★★ 与 `occupantsTotal` 刻意分开（2026-10-26）：执行位是 `capacity=-1` 的多席位，
   *    一个位上可以坐好几个人。阿开看统计时问的是「**有几个人在干活**」，
   *    不是「占了几格」—— 混成一个字段就会出现「1 个位坐 2 人，显示 1 人已坐」。
   */
  occupied: number
  /** ★ 该类型**一共坐了几个人**（多席位累加）—— 汇总句用它 */
  occupantsTotal: number
  /** 还空着的 */
  vacant: number
  /** 坐着的人名（去重、去空）—— hover 看得到「谁在坐」 */
  holders: string[]
}

/** 席位 key → 人话名字。★ 未知 key 不隐藏，原样显示 —— 界面宁可露出怪名字，
 *  也不要把一类席位悄悄吞掉（吞掉 = 用户以为没有这个位）。 */
const SEAT_LABELS: Readonly<Record<string, string>> = {
  execution: '执行位',
  audit: '审计位',
  management: '管理位',
  strategy: '战略位',
  signature: '签名位',
  management_assistant: '管理助理位',
}

/** 展示顺序 —— ★★ 2026-10-26 阿开二次定稿（覆盖同日早间口径）：
 *  **签名位 → 战略位 → 管理位 → 管理助理位 → 审计位 → 执行位**。
 *
 *  ★ 签名位排第一：它是山海不可替代的效力锚点（平台专属），
 *    永远可见 —— 它不是「可邀请的空位」，而是「这铺受山海背书」这件事本身。
 *  ★ 其余按阿开给的六行原序，不另排序（他明确说「顺序就按这个排」）：
 *    战略位（看远）→ 管理位（担责）→ 管理助理位（代管）→ 审计位（查错）→ 执行位（干活）。
 *  ★ 这个顺序**同时决定工位卡片网格的顺序**（`OrgSection` 按同一个数组排）。 */
export const SEAT_ORDER: ReadonlyArray<string> = [
  'signature',
  'strategy',
  'management',
  'management_assistant',
  'audit',
  'execution',
]

/**
 * 从座位列表压出「每类几个」。
 *
 * ★ 归类的判据顺序（缺一条就会算错）：
 *   ① `seat` 字段优先 —— 系统模板建的位一定有它
 *   ② 没有 `seat` 就退回 `label` 里认字（老数据 / 手工建的位 seat 可能是空串）
 *   ③ 都认不出 ⇒ 归到 `unknown`，且**保留原 label**，不并进任何已知类
 *      （并进去就会把「不知道是什么」伪装成「知道」，是假读数）
 */
export function countSeatTypes(seats: ReadonlyArray<SeatLike>): SeatTypeCount[] {
  const map = new Map<string, SeatTypeCount>()
  for (const s of seats) {
    const key = resolveSeatKey(s)
    const cur = map.get(key) ?? {
      key,
      label: SEAT_LABELS[key] ?? (typeof s.label === 'string' && s.label.trim().length > 0 ? s.label.trim() : key),
      total: 0,
      occupied: 0,
      occupantsTotal: 0,
      vacant: 0,
      holders: [],
    }
    cur.total += 1
    const names = holderNames(s)
    if (names.length > 0) {
      cur.occupied += 1          // 这个位被占了（算 1 格）
      cur.occupantsTotal += names.length  // 这个位上坐了几个人（多席位累加）
      for (const n of names) if (!cur.holders.includes(n)) cur.holders.push(n)
    } else {
      cur.vacant += 1
    }
    map.set(key, cur)
  }
  const out = Array.from(map.values())
  out.sort((a, b) => {
    const ia = SEAT_ORDER.indexOf(a.key)
    const ib = SEAT_ORDER.indexOf(b.key)
    // 已知类型按 SEAT_ORDER；未知类型一律排最后（不插队、不被藏）
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
  })
  return out
}

/**
 * 一座几位：**只认 `occupants`** —— 那是后端从 `agents.lamp` + `status='enabled'`
 * 算出来的「真实在场者」，也是唯一能代表「有人坐在这个位上」的读数。
 *
 * ★★ 2026-10-26 阿开：「顶部统计有误，每一个都是 1」。根因就在这：
 *    v1 我读了 `holder.name` 兜底 —— 而 `role_seats.holder_name` 存的是
 *    **候选位/系统位的固定人名**（「山海管理方（候选）」「山海智囊团」「山海签名服务」），
 *    它**不是「谁在坐」，是「这个位属于谁」**。
 *    后果：每一类席位都至少有一个 holder_name ⇒ **每类都被算成坐满 1 人**，
 *    于是「4 人已坐」显示成「每个类型 1 人」。这是假读数，不是界面瑕疵。
 *
 * ★ 判据口径以 `gateway.py:3534` 为准（那里已经踩过同一个坑）：
 *    `role_seats` = 位的**定义**（有这个位吗、能不能换人）
 *    `agents.lamp` = **谁在坐**（真实在场，且 enabled）
 *    后端只把后者放进 `occupants`；`holder` 里的 `vacant`/`builtin`/`platform`
 *    都是「位」的属性，**不能当人来数**。
 *
 * ★ 历史脏数据：一个位上 `occupants` 可能有多条（`capacity=-1` 的不限位）。
 *   这里**全给**、去重、去空 —— 不丢人，也不重复计数。
 */
function holderNames(s: SeatLike): string[] {
  const names: string[] = []
  if (Array.isArray(s.occupants)) {
    for (const o of s.occupants) {
      const n = typeof o?.name === 'string' ? o.name.trim() : ''
      if (n.length > 0 && !names.includes(n)) names.push(n)
    }
  }
  return names
}

/** 席位归类：seat 字段优先，其次 label 认字，都认不出 ⇒ 'unknown' */
export function resolveSeatKey(s: SeatLike): string {
  const raw = typeof s.seat === 'string' ? s.seat.trim().toLowerCase() : ''
  if (raw.length > 0 && SEAT_LABELS[raw] !== undefined) return raw
  // seat 有值但不在已知表里 —— 直接用它（不猜、不改名）
  if (raw.length > 0) return raw
  const label = typeof s.label === 'string' ? s.label : ''
  for (const k of Object.keys(SEAT_LABELS)) {
    /* ★ 必须取出来判空：`SEAT_LABELS[k]` 的类型是 `string | undefined`
       （noUncheckedIndexedAccess），直接传给 `includes` 编译不过。 */
    const name = SEAT_LABELS[k]
    if (name !== undefined && label.includes(name)) return k
  }
  return 'unknown'
}

/** 汇总一句话：「6 个位 · 4 人已坐 · 2 个空」—— 给总览行标题用 */
export function seatSummary(counts: ReadonlyArray<SeatTypeCount>): string {
  const total = counts.reduce((n, c) => n + c.total, 0)
  /* ★ 「人已坐」数**人**，不数位（多席位位上坐 2 人要显示 2）。
     「个空」仍按格算 —— 空的是格子，不是人头。
     ★★ 2026-10-26 阿开：「签名位不算空」—— 签名位是平台常驻位（`capacity=0`），
     它永远不会「有人凭邀请入驻」，所以它既不算空位、也不算在「几人已坐」里。
     把它算进空位会让空位数虚高（6 个位显示 3 个空，其中 1 个根本不可能被填）。 */
  const people = counts.reduce((n, c) => (c.key === 'signature' ? n : n + c.occupantsTotal), 0)
  const vac = counts.reduce((n, c) => (c.key === 'signature' ? n : n + c.vacant), 0)
  if (total === 0) return '还没有建工位'
  return `${total} 个位 · ${people} 人已坐 · ${vac} 个空`
}

/**
 * 单个席位的短标签 —— ★★ 2026-10-26 阿开二次定稿，**口径全改**：
 *
 *   `签名位 （已占）`    ← 平台位，永远有人，不显示空/容量
 *   `战略位 1 人`        ← 有人：只写人数，**不写容量上限**
 *   `管理助理位 空`      ← 没人：只写一个「空」字，不写「空 1」
 *
 * ★ 为什么去掉容量：执行位 `capacity=-1`（多席不限）⇒ 写成 `2/1` 看起来像超载，
 *   读者要去理解「-1 是什么意思」。阿开原话：「直接显示已有的人数，例如 2 人。
 *   其他不用备注上限容量。」—— 界面不解释模型，只回答「这个位上有几个人」。
 * ★ 为什么签名位单独一支：它不是「可用/不可用」，是「在/不在」——
 *   山海签名服务常驻 ⇒ 永远「已占」，把它算进「几个空」是错的（会让空位数虚高）。
 */
export function seatBadge(c: SeatTypeCount): string {
  if (c.key === 'signature') return `${c.label} （已占）`
  if (c.occupantsTotal === 0) return `${c.label} 空`
  return `${c.label} ${c.occupantsTotal} 人`
}
