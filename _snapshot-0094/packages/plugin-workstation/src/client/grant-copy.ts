/**
 * grant-copy.ts · 管理助理授权码的**纯判断**（083 单 G-1 · 需求 A）
 *
 * 抽成独立文件的理由跟 `join-copy.ts` / `notify-copy.ts` 一样：
 * 判断要能被判据脚本 `import` 后喂输入看输出，不然只能靠正则去猜源码。
 *
 * ★ 需求 A-⑤（星月原文）：
 *   「已兑换的显示对方名字：如果对方兑换时带了名字就用名字，没有就显示
 *    『已兑换（对方未填名字）』—— **不显示内部 ID**」
 *
 *   这一条有两个容易做错的方向，都必须挡住：
 *     ① 空白名字 ⇒ 直接渲染出来就是一个空位，用户看到「· 剩 23 小时 · 收回」，
 *        根本不知道谁在代管（比不显示更糟：看着像页面坏了）；
 *     ② 拿 `granteeId` 顶上 ⇒ 客户看到一串 `dev-cf78b69e0e8c`，既不认识也不该知道。
 */

/** 被授权人的显示名。
 *
 * @param name 服务端给的 `granteeName`（兑换时对方自填，可能为空）
 * @param id   服务端给的 `granteeId` —— **只用来判断「有没有人兑换过」，绝不返回它**
 */
export function granteeLabel(name?: string | null, id?: string | null): string {
  const n = String(name ?? '').trim()
  if (n.length > 0) return n
  const i = String(id ?? '').trim()
  // 有 id 却没名字 ⇒ 已经兑换过，但对方没填名字
  // 没 id ⇒ 这张码压根还没被兑换（作废/过期的那种）
  return i.length > 0 ? '对方未填名字' : '未兑换'
}

/** 名字是不是「不知道是谁」的状态（界面据此决定要不要加括号/弱化显示） */
export function granteeUnknown(name?: string | null): boolean {
  return String(name ?? '').trim().length === 0
}

/** 复制出去的那一整段话 —— 对方收到就能照做，不用再问一句「这码干嘛的」。
 *
 * 需求 A-③ 要的是「复制整段话」，不是只复制码：人类发给别人的是能看懂的话。
 */
export function grantCopyText(code: string, ttlHours: number, codeExpiresAt: string): string {
  const day = String(codeExpiresAt ?? '').slice(0, 10)
  const when = day.length === 10 ? `这个码到 ${day} 前都能兑换` : '这个码 7 天内有效'
  return [
    `我在山海城铺子里给你开了临时管理权限（兑换后 ${ttlHours} 小时，${when}）。`,
    '把这个码发给你自己的 Agent 就行：',
    '',
    code,
  ].join('\n')
}

/** 码还剩几天（向上取整）。服务端没给时间 ⇒ null（不猜）。 */
export function codeDaysLeft(codeExpiresAt: string | undefined, nowMs?: number): number | null {
  const t = Date.parse(String(codeExpiresAt ?? ''))
  if (Number.isNaN(t)) return null
  const now = typeof nowMs === 'number' ? nowMs : Date.now()
  const ms = t - now
  if (ms <= 0) return 0
  return Math.ceil(ms / 86400000)
}

/** 未兑换码的剩余说明。三态：没时间 / 已过期 / 剩 N 天 */
export function codeLeftText(codeExpiresAt: string | undefined, nowMs?: number): string {
  const d = codeDaysLeft(codeExpiresAt, nowMs)
  if (d === null) return '码 7 天内有效'
  if (d <= 0) return '码已过期'
  return `剩 ${d} 天`
}
