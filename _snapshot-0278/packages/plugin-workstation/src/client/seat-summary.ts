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
  holder?: { name?: string } | null
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
  /** 其中已经坐了人的 */
  occupied: number
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

/** 展示顺序：按「谁更常被看」排，签名位最后（平台专属，只读不可邀） */
const SEAT_ORDER: ReadonlyArray<string> = [
  'management',
  'execution',
  'audit',
  'strategy',
  'management_assistant',
  'signature',
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
      vacant: 0,
      holders: [],
    }
    cur.total += 1
    const names = holderNames(s)
    if (names.length > 0) {
      cur.occupied += 1
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

/** 一座一位的座位：`occupants` 可能有多条（历史脏数据），**全给**不丢人 */
function holderNames(s: SeatLike): string[] {
  const names: string[] = []
  if (Array.isArray(s.occupants)) {
    for (const o of s.occupants) {
      const n = typeof o?.name === 'string' ? o.name.trim() : ''
      if (n.length > 0 && !names.includes(n)) names.push(n)
    }
  }
  if (names.length === 0 && s.holder && typeof s.holder.name === 'string') {
    const n = s.holder.name.trim()
    if (n.length > 0) names.push(n)
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
  const occ = counts.reduce((n, c) => n + c.occupied, 0)
  const vac = counts.reduce((n, c) => n + c.vacant, 0)
  if (total === 0) return '还没有建工位'
  return `${total} 个位 · ${occ} 人已坐 · ${vac} 个空`
}

/** 单个席位的短标签：「执行位 2/3」—— 让数量一眼可读，不用心算 */
export function seatBadge(c: SeatTypeCount): string {
  if (c.total === c.occupied) return `${c.label} ${c.occupied}/${c.total}`
  if (c.occupied === 0) return `${c.label} 空 ${c.total}`
  return `${c.label} ${c.occupied}/${c.total}`
}
