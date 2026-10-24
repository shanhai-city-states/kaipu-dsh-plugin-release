/**
 * 山海·开铺 · 工位插件 · 邀请码补发闭环的**文案与纯逻辑**（083 第一批 · 块 A）
 * =====================================================================
 * ★ 为什么单独一个文件、而不是写在 `WorkstationPanel.tsx` 里：
 *   ① 判据要能**真跑**。`tools/check-join-083.mjs` 直接 import 编译产物
 *      (`lib/client/join-copy.js`) 做输入→输出断言；写在 tsx 里就只能 grep 源码，
 *      变成一个"全文搜关键词"，搜到≠跑通（星月 R-6 的原话：同一张关键词表 = 0 命中，
 *      那不是通过，是没测）。
 *   ② 文案要能**一处改全处生效**。补发这件事有三处入口（红点、审批面板、申请入口），
 *      各写一份中文必然长歪。
 *
 * ★ 铁律（任务书 §五-6）：**界面上不出现内部错误码 / 接口路径**。
 *   所以 `humanizeJoinError()` 的兜底句里**不放 code**；code 只进 `console.warn`。
 */

/* ══════════════════════════════════════════════════════════════════════
 * 一 · 错误人话化
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 服务端错误码 → 人话。键用契约里的原始码（只在这里出现，不出这个文件）。
 * ★ 每条都要说**下一步干什么**，不能只说"失败了" —— 申请人这时正在门外站着。
 */
const JOIN_ERROR_TEXT: Record<string, string> = {
  /* 403 no_credential：既没旧码也没指纹 */
  no_credential: '查不到你的身份，请用原来那张码或原来的机器再试一次',
  /* 404：铺子不存在 / 铺号打错 */
  account_not_found: '找不到这个铺子，确认一下铺号有没有打错',
  /* 409：24 小时内已经有一条待审 */
  duplicate_pending: '你已经申请过一次了，还在等铺主处理，不用重复提交',
  /* 只有铺主能批 */
  not_owner: '这条申请只有铺主能处理',
  /* 别人那条申请，你查不到 */
  not_applicant: '这条申请不是你提的，看不到结果',
  /* 已经批过/拒过了 */
  already_decided: '这条申请已经处理过了，刷新一下看结果',
  /* 24 小时没处理，自动过期（AC-07） */
  expired: '这条申请放太久，已经自动作废了，重新申请一次就行',
  /* 新版前端 + 老后端：端点还没上 */
  not_found: '铺子那边的服务还没更新，过一会儿再试',
  denied: '这次提交没被受理，确认一下码和机器对不对',
}

/**
 * 把错误码翻成人话。
 * @param code 服务端/网关给的错误码（可为空）
 * @param serverMessage 服务端原文（**仅用于兜底判断"是不是中文"**，不直接展示）
 */
export function humanizeJoinError(code: string | undefined, serverMessage?: string): string {
  const k = (code ?? '').trim()
  const hit = JOIN_ERROR_TEXT[k]
  if (hit !== undefined) return hit
  /* ★ 兜底：服务端偶尔会给一句现成的中文（例如"码已过期"），那句本身就没有内部码，
     可以直接用；但**必须过一遍 containsInternalCode**，别把 `no_credential` 漏出去。 */
  const msg = (serverMessage ?? '').trim()
  if (msg.length > 0 && !containsInternalCode(msg)) return msg
  return '这次没提交成功，过一会儿再试一次'
}

/**
 * 这段文字里有没有"内部错误码 / 接口路径"的痕迹。
 * ★ 判据 AC-10 的直接实现：渲染前用它拦一道，比事后 grep 界面可靠。
 */
const INTERNAL_CODE_RE = /\b(no_credential|not_owner|not_applicant|already_decided|duplicate_pending|account_not_found|missing_[a-z_]+|bad_[a-z_]+)\b/
const INTERNAL_PATH_RE = /\/(join|packs|grants|devices|auth)\/[A-Za-z0-9_{}/-]*/
export function containsInternalCode(text: string): boolean {
  return INTERNAL_CODE_RE.test(text) || INTERNAL_PATH_RE.test(text)
}

/* ══════════════════════════════════════════════════════════════════════
 * 二 · 待审批条目的一行摘要
 * ══════════════════════════════════════════════════════════════════════ */

export interface JoinRowLike {
  requestId?: string
  nodeId?: string
  seat?: string
  applicantName?: string
  applicantKind?: string
  reason?: string
  createdAt?: string
}

/**
 * 一行摘要：`工位 3 · 张三 · 邀请码已过期`
 *
 * ★ 三段都是**有什么写什么**，缺了就整段不写（不摆「工位 undefined」）：
 *   · 位置：nodeId 优先，退 seat（后端两个都可能空 —— 申请人可能没选位）
 *   · 人：applicantName 优先；没有就按类型退成「(Agent)」/「(未知申请人)」
 *   · 原因：用户自己填的那句；没填就按类型给一句默认（换机器 / 邀请码过期）
 */
export function joinRowLabel(row: JoinRowLike): string {
  const parts: string[] = []
  const node = (row.nodeId ?? '').trim()
  const seat = (row.seat ?? '').trim()
  if (node.length > 0) parts.push(node.startsWith('工位') ? node : `工位 ${node}`)
  else if (seat.length > 0) parts.push(seat)
  const name = (row.applicantName ?? '').trim()
  if (name.length > 0) parts.push(name)
  else parts.push(row.applicantKind === 'agent' ? '(Agent)' : '(未署名)')
  const reason = (row.reason ?? '').trim()
  if (reason.length > 0) parts.push(reason)
  else parts.push(row.applicantKind === 'agent' ? 'Agent 申请补发' : '申请补发加入码')
  return parts.join(' · ')
}

/* ══════════════════════════════════════════════════════════════════════
 * 三 · 申请人那侧的四种状态
 * ══════════════════════════════════════════════════════════════════════ */

/** 申请人视角的状态 → 该显示什么（`dot` = 要不要落红点） */
export interface ApplicantView {
  /** 一句话 */
  text: string
  /** 主色：正常 / 等待 / 成功 / 失败 */
  tone: 'plain' | 'wait' | 'ok' | 'bad'
  /** 是否显示红点（approved 才有 —— 有新码要拿） */
  dot: boolean
  /** 还能不能再点「重新申请」/「提交申请」 */
  canRetry: boolean
}

/**
 * @param status 服务端状态；空 = 还没提过申请
 */
export function applicantView(status: string | undefined): ApplicantView {
  const s = (status ?? '').trim()
  if (s === 'pending') {
    return { text: '已申请，等铺主通过', tone: 'wait', dot: false, canRetry: false }
  }
  if (s === 'approved') {
    return { text: '铺主通过了，新码在下面 —— 复制给 Agent 就能继续干活', tone: 'ok', dot: true, canRetry: false }
  }
  if (s === 'rejected') {
    return { text: '铺主拒绝了这次申请', tone: 'bad', dot: false, canRetry: true }
  }
  if (s === 'expired') {
    return { text: '这条申请放太久作废了，重新申请一次', tone: 'bad', dot: true, canRetry: true }
  }
  return { text: '', tone: 'plain', dot: false, canRetry: false }
}

/* ══════════════════════════════════════════════════════════════════════
 * 四 · 申请号与新码的本地留存（083 补充件 · 6f093831）
 *
 * ★ 两件事混在一起会做错，先拆开：
 *   · **申请号**（`jr_xxx`）是「我这条申请」的凭据 —— 关掉面板就丢，必须显式摆出来让人抄。
 *   · **新码**是「阅后即焚」的 —— 服务端读到就抹 `code_plain`，**第一次不存就永久没了**。
 *     所以前端**禁止靠轮询取码**（星月 §二原话）：轮一次没存，后面全是空。
 * ══════════════════════════════════════════════════════════════════════ */

/** 申请号键前缀 —— 按「铺号 + 申请人」分键（换铺 / 换人不串台） */
export const JOIN_REQ_KEY_PREFIX = 'kaipu.join.requestId'
/** 新码本地留存键前缀 —— 一条申请一个键 */
export const JOIN_CODE_KEY_PREFIX = 'kaipu.join.code'

/**
 * 这串看起来像不像申请号（`jr_` 开头）。
 * ★ 为什么要判：服务端若把字段名从 `requestId` 换成 `id`，取到的就是 `undefined`，
 *   界面会渲染成 `undefined` 或空白 —— 判据 AC 要求「出现原值，不是 undefined」。
 */
export function looksLikeRequestId(v: unknown): boolean {
  return typeof v === 'string' && /^jr_[A-Za-z0-9_-]{4,}$/.test(v.trim())
}

/**
 * 申请号存哪个键。
 * ★ 两个都不空才拼全键；否则退回**无后缀旧键** —— 129 版存的就是那个键，
 *   用户手上可能已经有存量数据，不能因为换键就让人「申请记录凭空消失」。
 */
export function reqStoreKey(accountId: string, appId: string): string {
  const a = (accountId ?? '').trim()
  const b = (appId ?? '').trim()
  if (a.length === 0 || b.length === 0) return JOIN_REQ_KEY_PREFIX
  return `${JOIN_REQ_KEY_PREFIX}.${a}.${b}`
}

/** 新码存哪个键（按 requestId 一条一键） */
export function codeStoreKey(requestId: string): string {
  return `${JOIN_CODE_KEY_PREFIX}.${(requestId ?? '').trim()}`
}

/** 码现在的处境 —— 决定提示哪一句，以及要不要显示码 */
export type ApplicantCodeState =
  | 'none'   // 还没到 approved
  | 'fresh'  // 本次刚拿到服务端明文 ⇒ 必须立刻存 + 提示只显示一次
  | 'stored' // 本地存着 ⇒ 直接给（服务端明文已抹）
  | 'lost'   // approved 但服务端不回码、本地也没有 ⇒ 找铺主重发

/**
 * @param status 服务端状态
 * @param serverCode 服务端本次返回的 joinCode（空 = 已抹 / 还没批）
 * @param localCode 本地存着的那张（空 = 没存过）
 */
export function applicantCodeState(
  status: string,
  serverCode: string,
  localCode: string,
): ApplicantCodeState {
  const sv = (serverCode ?? '').trim()
  if (sv.length > 0) return 'fresh'
  const s = (status ?? '').trim()
  if (s !== 'approved') return 'none'
  const lc = (localCode ?? '').trim()
  if (lc.length > 0) return 'stored'
  return 'lost'
}

/** fresh：拿到就要喊一句，别让人以为下次还能看 */
export const CODE_ONCE_TIP = '这张码只显示一次，请现在复制（关掉就找不回来了）'
/** stored：本地存下来的，说明白为什么服务端不回了 */
export const CODE_STORED_TIP = '这张码已经存在本机，服务端只回一次明文，再查不会重复给'
/** lost：取过但没存 —— 唯一出路是找铺主重发，别让人对着空白发呆 */
export const CODE_LOST_TIP = '这张码已经取过了，本机没存下来。请找铺主再补一张'

/** 「抄下申请号」那句 —— 第五节课文用，判据也断它 */
export const REQ_ID_KEEP_LINE = '★ 提交成功后请把 requestId 抄下来，查状态和取码都要用它。'

/* ══════════════════════════════════════════════════════════════════════
 * 五 · 给 Agent 的第五节课文（任务书 §一-任务4，**逐字照抄**）
 *
 * ★ 为什么必须有：Agent 没理由知道自己该调什么接口。不写，它只会一直报错重试；
 *   人也不知道"原来可以申请补发"。
 * ★ 为什么放在这里而不是内联在组件的数组里：判据要能对**产物**断言它真的被拼进去了
 *   （`check-join-083.mjs` 直接 import 常量比对关键行）。
 * ══════════════════════════════════════════════════════════════════════ */

export const JOIN_GUIDE_SECTION: string[] = [
  '',
  '五、如果你发现邀请码失效了（报错 401 / 403 / 码已用过）',
  '',
  '不要死循环重试，也不要干等。立刻申请补发：',
  '',
  '  curl -sS -X POST "https://agent.ak2029.com/kai-pu/join/request" \\',
  '    -H "Content-Type: application/json" \\',
  '    -d \'{"accountId":"{你的铺ID}","joinCode":"{旧码}","applicantKind":"agent","applicantId":"{你的agentId}","reason":"邀请码过期，无法提交交付物"}\'',
  '',
  REQ_ID_KEEP_LINE,
  '',
  '拿到 201 后，请告诉你的主人这句话：',
  '  「邀请码已过期，我已经申请补发，等铺主通过后我会拿到新码。」',
  '',
  '然后每 5 分钟查一次：',
  '  curl -sS "https://agent.ak2029.com/kai-pu/join/request/{requestId}"',
  '',
  '当 status 变成 approved，返回里的 joinCode 就是新码，用它继续干活。',
]

/** 把第五节拼到现有四节后面（**不改前四节一个字**） */
export function joinGuideText(baseLines: string[]): string {
  return [...baseLines, ...JOIN_GUIDE_SECTION].join('\n')
}
