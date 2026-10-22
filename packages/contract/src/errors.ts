/**
 * 山海·开铺 · 契约层 · 错误码与翻译
 * =====================================================================
 * ★ 客户端纪律：
 *     **不把原始错误直出给用户**；一律按 `code` 翻译成用户语言。
 *     `code` 不在表内 ⇒ 兜底文案 + 上报（**不许把裸 code 印给用户**）。
 *
 * 表来自 `./generated.js`（由 `contracts/v1.1/errors.json` 生成）。
 * ★ 新增/修改文案 ⇒ 改 JSON + 重跑 `node tools/gen-contract.mjs`，**不要改这里**。
 */
import { ERROR_CODES, ERROR_FALLBACK, type ErrorCode } from './generated.js'

export type { ErrorCode }

/** 统一错误体（I-3 通用约定） */
export interface ApiErrorEnvelope {
  error: {
    code: string
    message?: string
    detail?: Record<string, unknown>
  }
}

const UI_TEXT: Record<string, string> = Object.fromEntries(
  // `as const` 保住元组形状 —— 否则 map 推断成 string[][]，Object.fromEntries 不接
  ERROR_CODES.map((e) => [e.code, e.uiText] as const),
)

/** `code` ⇒ 用户可见文案。未收录 ⇒ 兜底文案。 */
export function translateError(code: string | undefined): string {
  if (code !== undefined && UI_TEXT[code] !== undefined) return UI_TEXT[code] as string
  return ERROR_FALLBACK.uiText
}

/**
 * 这个 `code` 在 §8.2 文案表里**有没有译法**。
 *
 * ★ 为什么单独导出（2026-10-06 加）：流内 `error` 事件要区分两种情形 ——
 *   · **有译法** ⇒ 用契约口径的译法（统一口径）
 *   · **没有**   ⇒ 如实显示服务端给的 `message`，并**标记「未收录」**
 *     ★ 且**不许自己补一条文案**：§8.2 由对方维护，**发现缺口要报，不单方补**。
 *
 * ★ 为什么不能只看 `translateError` 的返回值分辨：它对两种情况**都返回字符串**
 *   （未收录时返回兜底文案，看上去像"翻译过了"）。
 *   —— 这正是本项目反复踩的那类形态：**兼容路径把"没收录"吸收掉了，外面看不出来**。
 */
export function hasUiText(code: string): boolean {
  return UI_TEXT[code] !== undefined
}

/** 是否是需要"另走一条路"而不是弹错的码（客户端据此切换行为）。 */
export function isReroutableError(code: string | undefined): boolean {
  return code === 'duplicate_request' || code === 'not_checked_in'
}

/**
 * 从任意响应体里安全提取 `code`。
 * ★ 容错：契约未落地 / 代理返回 HTML / 空体 —— 一律返回 undefined 而不抛。
 */
export function extractErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const err = (body as ApiErrorEnvelope).error
  if (typeof err !== 'object' || err === null) return undefined
  return typeof err.code === 'string' ? err.code : undefined
}

/** `duplicate_request` 附带的轮询地址（客户端据此切到查询接口，不弹错）。 */
export function duplicatePollPath(detail: unknown): string | undefined {
  if (typeof detail !== 'object' || detail === null) return undefined
  const poll = (detail as Record<string, unknown>)['poll']
  return typeof poll === 'string' ? poll : undefined
}
