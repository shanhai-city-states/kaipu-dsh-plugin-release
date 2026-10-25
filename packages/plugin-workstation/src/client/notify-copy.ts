/* ══════════════════════════════════════════════════════════════════════════
 * 083-r1 · 派活「顺手通知谁」+ 工位卡片人数显示 —— 纯文案与纯逻辑
 *
 * 为什么单独一个文件（不是塞进组件里）：
 *   ① 这些是**判断**不是**渲染**：选谁、错怎么解释、几个人怎么显示。
 *      判断放组件里就只能靠 grep 源码来验，等于没验。
 *   ② 放在这里，判据可以直接 import 编译产物喂输入看输出（星月 R-6：
 *      同一张关键词表对着源码查 = 逻辑必然 0 命中，何况注释里也能写满词）。
 *
 * ★ 后端字段名（实测，不是照抄任务书）：
 *      POST /tasks 对不认识的字段是**硬拒**：400 `unknown_field`。
 *      `notify_agent`（8 个 snake 候选）与 `notifyAgent` 都试过 —— 全部 unknown_field。
 *      也就是说：**线上这版 POST /tasks 还没有这个字段**。任务书说「已完工并上线」，
 *      但实测对不上；详情见落件与回函。前端因此必须能识别这种「后端还不认」，
 *      否则选了人就整条派活失败（400 是无副作用的，可以安全降级重发）。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 成员的最小形态 —— 不 import contract，避免 renderer/transport 双向牵连 */
export interface NotifyMemberLike {
  id: string
  name: string
  kind: string
  membershipActive?: boolean
}

/** 下拉里的一项 */
export interface NotifyChoice {
  id: string
  name: string
}

/**
 * 本铺在编的 Agent 名单（下拉选项）。
 *
 * ★ 为什么按 `membershipActive` 过、不按 `presence` 过：
 *   离座 ≠ 离场。离座的人（away）仍在编，照样能收活 —— 把 away 过滤掉等于
 *   「人接了个电话，这单就派不出去了」。只有**真的被请出**（membershipActive=false）才排除。
 * ★ 为什么按 id 去重而不是 name：名字可以重（「星月」可以有两个），id 不会。
 *   notifyAgent 传的也是 id，所以去重口径必须和传参口径一致。
 * ★ 排序按名字：下拉是给人翻的，拼音序稳定；不按在座状态排 —— 那会让列表
 *   在每次刷新时跳动，人手还没落下去项就跑了。
 */
export function agentChoices(members: NotifyMemberLike[]): NotifyChoice[] {
  const seen = new Set<string>()
  const out: NotifyChoice[] = []
  for (const m of members) {
    if (m.kind !== 'agent') continue
    /* 未声明 membershipActive 的一律按「在编」—— 老数据没这个字段，
       宁可多列一个（后端会兜底校验），也不要凭空把人藏了。 */
    if (m.membershipActive === false) continue
    const id = (m.id ?? '').trim()
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name: (m.name ?? '').trim().length > 0 ? m.name.trim() : id })
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return out
}

/** 默认项：不点名（公池）—— 值用空串，与「没选」同一个语义，不留第三种状态 */
export const NOTIFY_PUBLIC_VALUE = ''
export const NOTIFY_PUBLIC_LABEL = '谁在岗谁领（默认）'
export const NOTIFY_LABEL = '顺手通知谁'
export const NOTIFY_HINT = '点名后它会更快看到这活；不点名，活也在公池里等认领。'

/** 选完之后按钮旁边那句短提示 */
export function notifyPickHint(choice: NotifyChoice | null): string {
  if (choice === null) return NOTIFY_HINT
  return `已选 ${choice.name} —— 它下次来取活时会先看到这条；别人也能领。`
}

/**
 * 服务端还不支持点名时的识别。
 *
 * ★ 为什么必须精确到 `notifyAgent` 这个字段名：
 *   `unknown_field` 是**通用**错误（任何多余字段都报它）。若只判 code，
 *   将来别的字段写错也会被我们当成「通知没上线」去静默降级 —— 那就把真 bug 藏了。
 *   ⇒ 必须 code 与报错里的字段名**同时**对上，才算「这个能力没上线」。
 */
export function isNotifyUnsupported(code: string, message: string): boolean {
  if (code !== 'unknown_field') return false
  return /notifyAgent|notify_agent/i.test(message)
}

/** 降级后的提示（说明这次其实没点名，别让人以为点了） */
export const NOTIFY_DEGRADED_NOTICE = '这条已按「谁在岗谁领」发到公池 —— 服务端还没开通点名通知，选了也不会生效。'

/**
 * 派活失败时给人看的话。
 * ★ 口径：后端码只进 console，界面上不出现 `agent_not_found` 这种字。
 * ★ 兜底返回 `message`（服务端中文原文）而不是「操作失败」——
 *   未知错误的原文往往已经能读（且带线索），覆盖成空话等于把线索扔了。
 */
export function notifyFailText(code: string, message: string): string {
  if (code === 'agent_not_found') {
    return '选的那个 Agent 已经不在这个铺子里了，换个目标，或者选「谁在岗谁领」。'
  }
  if (isNotifyUnsupported(code, message)) {
    return '服务端这版还不支持点名通知，把「顺手通知谁」调回「谁在岗谁领」再发一次就行。'
  }
  return message.length > 0 ? message : '这条没发出去，稍后再试一次。'
}

/* ── 任务 2 · 工位卡片上「有几个人」怎么显示 ────────────────────────────
 * 背景（阿开原话）：「执行位和审计位不限人数」。他看不到多了个人，
 * 以为 Codex 没进来 —— 问题是「等 N 人」在窄卡片里被省略号吃掉，而且
 * 「等 2 人」到底是总共 2 人还是还有 2 人，读不出来。
 * ⇒ 改成徽标：`＋N`（N = 额外人数），一眼看出「多了一个」。
 */

/**
 * 额外人数徽标。1 个人时不显示（返回空串）。
 * ★ 用「＋N」不用「等 N 人」：一半长度、语义单向（只表示多出来的），
 *   窄卡片里不会被省略号吃成「等…」。
 */
export function extraHolderBadge(holderCount: number): string {
  const extra = holderCount - 1
  if (!Number.isFinite(extra) || extra < 1) return ''
  return `＋${extra}`
}

/** 徽标的 title（完整名单在调用方拼，这里只给那句解释） */
export function extraHolderTitle(holderCount: number): string {
  const extra = holderCount - 1
  if (!Number.isFinite(extra) || extra < 1) return ''
  return `这个位子上还有 ${extra} 个人`
}

/**
 * 「有人坐着，但读不到是谁」的提示 —— ★★ 2026-10-26 收窄条件（阿开实测）。
 *
 * ## 改前（假阳性满屏）
 * 条件只有 `seatCount > 0` —— 而 `seat_count` 是**服务端算的「这个工位绑了几个席位」**，
 * 它回答的是「这个位存在吗」，**不是「有没有人坐」**。
 *
 * 后果（阿开截图实证）：
 *   · 审计位 `seat_count=1`（席位定义还在），但 3 个 Agent 全是 `left` ⇒ 一个真人都没有
 *   · 签名位 `seat_count=1`（山海签名服务这个平台席位），天生**不对外入驻**
 *   ⇒ 两张卡都显示「有人，但读不到是谁」，把「空着」说成「有人但看不见」。
 *   这是**把位的定义当成了人的在场**，与本轮 `holder` 那个 bug 同族。
 *
 * ## 改后
 * 只有「**确实有人被记着、却取不到名字**」才是真异常。要区分三件事：
 *   ① `holderCount > 0`                  → 正常，有名字，不提示
 *   ② `seatCount > 0` 且 **席位被标为空** → 老实说「空位」，不许说「有人」
 *   ③ 席位没被标空、又没有任何 holder 记录 → 这才是「有人但读不到」
 *
 * @param holderCount    取到的在座者条数
 * @param seatCount      这个工位绑定的席位数（位的定义，不是人数）
 * @param seatVacantish  ★ 席位侧是否明确表示「空」/「不可入驻」（来自 role_seats 的状态）
 */
export function holderUnknownText(
  holderCount: number,
  seatCount: number,
  seatVacantish: boolean = false,
): string {
  if (holderCount > 0) return ''
  if (!Number.isFinite(seatCount) || seatCount <= 0) return ''
  /* ★ 席位自己说「空着 / 不可入驻」⇒ 就是空位，不是「读不到」。
     签名位（cap=0）属于「不可入驻」，它的人（山海签名服务）不是 Agent，不该被当成人报。 */
  if (seatVacantish) return ''
  return '有人，但读不到是谁'
}
