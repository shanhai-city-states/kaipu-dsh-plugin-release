/* ══════════════════════════════════════════════════════════════════════════
 * 083-r2 · 邀请码列表化（dispatch-083-r2-invite）—— 纯判断与纯文案
 *
 * 为什么单独一个文件（同 083-r1 的 notify-copy）：
 *   ① 「哪张码还能用」「剩余多久」「明文在不在本机」都是**判断**，不是渲染；
 *      判断塞进组件就只能 grep 源码，等于没验。
 *   ② 判据要能直接 import 编译产物喂输入看输出（星月 R-6）。
 *
 * ★★ 本单的核心约束（派单书 §二-任务1 与 §三-硬约束 1/2/3）：
 *   服务端**只存 hash、永不返回明文**。所以明文只能留在用户本机的 localStorage，
 *   按 `codeHash` 索引；码一旦进入 used / revoked / expired，就必须把明文删掉
 *   （留着是纯泄露面，且会让人误以为那张码还能用）。
 *   ⇒ 这里的所有函数都**不直接摸 localStorage**，一律由调用方注入 getter，
 *     判据才能在 node 里跑（没有 window）。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 服务端 `GET /device-join-codes` 的一行（字段名照契约，snake 无 —— 全是 camel） */
export interface JoinCodeRowLike {
  codeHash: string
  note?: string
  seat?: string
  invitedName?: string
  /** pending | used | expired | revoked（服务端四档，别的值一律按「未知」显示，不吞） */
  state: string
  createdAt: string
  expiresAt: string
  usedAt?: string | null
  usedBy?: string
  revokedAt?: string | null
  batchId?: string
}

/** 待用上限（派单书 §二-任务1：最多留 3 张待用） */
export const PENDING_LIMIT = 3

/** 明文在 localStorage 的键前缀。★ 不写死成一张大表：按 hash 一行一个键，
 *  这样「清掉某一张」是一次 `removeItem`，不必读改写整张表（并发/半失败都安全）。 */
export const CODE_STORE_PREFIX = 'kaipu.joinCode.plain.'

export function plainStoreKey(hash: string): string {
  return CODE_STORE_PREFIX + hash
}

/* ── 明文 → codeHash：自己算，不靠批次顺序猜 ──────────────────────────────
 * ★ 实测（2026-10-24，真码 `dXsxbHIEkbpA`）：服务端的 `codeHash` 就是
 *   `sha256(明文)` 的前 12 位十六进制（完整 hash 见落件）。
 *   ⇒ 生成响应里没给 codeHash 也没关系：前端自己算得出来，明文与列表行
 *     可以**精确对上**，不必按 batchId 顺序瞎配（配错就会「复制的码」和
 *     「作废的那张」不是同一张 —— 这种错最难查）。
 * ★ 为什么手写 sha256 而不用 `crypto.subtle`：宿主渲染层不保证有 WebCrypto
 *   （非安全上下文/老内核都没有），而这条链路是**纯函数**，node 判据里也要跑
 *   同一份实现。40 行换来「处处可算、可测」比依赖运行时 API 划算。 */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

/** sha256(utf8) → 64 位十六进制小写 */
export function sha256Hex(input: string): string {
  const bytes: number[] = []
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = input.charCodeAt(i + 1)
      const cp = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00)
      i += 1
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  /* 长度是大端 64 位；JS 里按高 32 + 低 32 写 */
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff)
  bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff)

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Array<number>(64)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = off + i * 4
      w[i] = ((bytes[j] ?? 0) << 24) | ((bytes[j + 1] ?? 0) << 16) | ((bytes[j + 2] ?? 0) << 8) | (bytes[j + 3] ?? 0)
    }
    for (let i = 16; i < 64; i += 1) {
      /* ★ noUncheckedIndexedAccess：下标取值一律显式断言（定长数组，越界不可能） */
      const w15 = w[i - 15] as number
      const w2 = w[i - 2] as number
      const s0 = (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) >>> 0
      const s1 = (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)) >>> 0
      w[i] = (((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0)
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7
    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const t1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const t2 = (S0 + maj) >>> 0
      hh = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + hh) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('')
}

/** 明文码 → 服务端口径的 codeHash（sha256 前 12 位） */
export function codeHashOf(plain: string): string {
  return sha256Hex(plain.trim()).slice(0, 12)
}

/** 四档状态的人话。★ 未知状态**不猜**，原样带出来给人看（宁可难看也别骗人）。 */
export function stateLabel(state: string): string {
  switch (state) {
    case 'pending': return '待用'
    case 'used': return '已用'
    case 'expired': return '已过期'
    case 'revoked': return '已作废'
    default: return state.length > 0 ? `状态未知（${state}）` : '状态未知'
  }
}

/** 只有「待用」才有复制 / 作废 / 续期 —— 其余三档按钮一律不出现（不是禁用，是不渲染）。 */
export function isActionable(state: string): boolean {
  return state === 'pending'
}

/** 剩余时间的人话。nowMs 由调用方给（便于判据固定时钟）。 */
export function remainingText(expiresAt: string, nowMs: number): string {
  const t = Date.parse(expiresAt)
  if (!Number.isFinite(t)) return '有效期读不出来'
  const ms = t - nowMs
  if (ms <= 0) return '已过期'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `还剩 ${Math.max(1, min)} 分钟`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `还剩 ${hour} 小时 ${min % 60} 分`
  const day = Math.floor(hour / 24)
  return `还剩 ${day} 天 ${hour % 24} 小时`
}

/**
 * 码值这一格显示什么。
 * ★ 明文只在本机；查不到就明说「明文未保存在本机」——
 *   留空会让人以为是加载失败，写「已使用」会让人以为码废了，两者都是在编事实。
 */
export function codeTextOf(hash: string, plain: string): string {
  const p = (plain ?? '').trim()
  if (p.length > 0) return p
  return hash.length > 0 ? '已生成 · 明文未保存在本机' : '（缺 codeHash）'
}

/** 「已用」那一行要报是谁用的 —— 这是查账的关键（派单书 §二-任务1）。 */
export function usedByText(row: JoinCodeRowLike): string {
  if (row.state !== 'used') return ''
  const who = (row.usedBy ?? '').trim()
  return who.length > 0 ? `被 ${who} 用掉` : '已用（服务端没记是谁）'
}

/** 待用张数（只数 pending —— exceeded/used 不占额度）。 */
export function pendingCount(rows: JoinCodeRowLike[]): number {
  let n = 0
  for (const r of rows) if (r.state === 'pending') n += 1
  return n
}

/** 还能不能再生成。 */
export function canCreateMore(pending: number): boolean {
  return pending < PENDING_LIMIT
}

/** 生成按钮为什么不能点（空串 = 能点）。hover 提示用这句。 */
export function createBlockedTip(pending: number): string {
  return canCreateMore(pending) ? '' : `先作废不用的，或等它们过期（现在手上 ${pending} 张没用过）`
}

/** 批量下拉：一次最多生成的张数，且不得超过剩余额度（下限 1）。 */
export function batchChoices(pending: number): number[] {
  const room = Math.max(1, PENDING_LIMIT - pending)
  const top = Math.min(PENDING_LIMIT, room)
  const out: number[] = []
  for (let i = 1; i <= top; i += 1) out.push(i)
  return out
}

/**
 * 该从本机抹掉明文的码。
 *
 * ★ 只在**服务端状态已确定失效**时清理：pending 留着（还要复制给同事），
 *   expired 也清（expiresAt 过了就是废码，留着只会被误发出去）。
 * ★ 判据反向对照：把这条改成「只要不是 pending 就清」之外的条件（例如全清 / 不清），
 *   R2 判据必须变红。
 */
export function staleHashes(
  rows: JoinCodeRowLike[],
  hasPlain: (hash: string) => boolean,
  nowMs: number,
): string[] {
  const out: string[] = []
  for (const r of rows) {
    const h = (r.codeHash ?? '').trim()
    if (h.length === 0 || !hasPlain(h)) continue
    const expiredByTime = r.state === 'pending' && Date.parse(r.expiresAt) <= nowMs
    if (r.state === 'used' || r.state === 'revoked' || r.state === 'expired' || expiredByTime) {
      out.push(h)
    }
  }
  return out
}

/**
 * 码相关错误的人话（派单书 §三-硬约束 4 点名两条，其余按同一口径补齐）。
 * ★ 界面永远见不到内部码：这里翻完就把 code 丢掉。
 */
export function humanizeCodeError(code: string, message: string, pending?: number): string {
  switch (code) {
    case 'too_many_pending_codes':
      return typeof pending === 'number' && pending > 0
        ? `手上还有 ${pending} 张没用过的码，先作废不用的`
        : '手上没用过的码已经满了，先作废不用的'
    case 'code_not_revocable':
      return '这张码已经用过或过期了，作废不了'
    /* ★ 实测（2026-10-24）：续期有自己的码 `code_not_renewable`，派单书只写了作废那条。
       照作业抄会把它落到 default 分支，弹出服务端原文 —— 那是内部话，不是人话。 */
    case 'code_not_renewable':
      return '这张码已经用过或作废了，续不了期'
    case 'code_not_found':
      return '找不到这张码（可能刚被清理），刷新一下再看'
    case 'owner_only':
    case 'not_owner':
      return '只有铺主能管理邀请码'
    case 'unauthorized':
    case 'login_required':
      return '这台机器还没进本铺，先用加入码进来'
    default: {
      const m = (message ?? '').trim()
      return m.length > 0 ? m : '操作没成功，稍后再试一次'
    }
  }
}

/** 一行要渲染什么（判据直接断言这个对象，不必读 JSX）。 */
export interface CodeRowView {
  codeText: string
  stateText: string
  remainText: string
  actionable: boolean
  usedByText: string
  /** 明文在本机吗（决定是否显示「明文未保存在本机」这句说明） */
  plainLocal: boolean
}

export function codeRowView(row: JoinCodeRowLike, plain: string, nowMs: number): CodeRowView {
  const p = (plain ?? '').trim()
  return {
    codeText: codeTextOf(row.codeHash, p),
    stateText: stateLabel(row.state),
    /* 只有待用才谈「剩余时间」：已用/已作废的码谈剩余毫无意义（会让人以为还能用） */
    remainText: isActionable(row.state) ? remainingText(row.expiresAt, nowMs) : '',
    actionable: isActionable(row.state),
    usedByText: usedByText(row),
    plainLocal: p.length > 0,
  }
}

/** 列表为空时的引导语（不摆空框也要说清楚「这里本来该有什么」）。 */
export function emptyListText(owner: boolean): string {
  return owner ? '还没有生成过加入码 —— 点上面「生成」给新同事发一张' : ''
}
