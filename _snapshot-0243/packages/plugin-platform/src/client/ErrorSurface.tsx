/**
 * 山海·开铺 · 场地插件 · 错误面（把 `code` 翻译成用户语言）
 * =====================================================================
 * ★★ 客户端纪律（契约 `errors.json` envelope）：
 *      **不把原始错误直出给用户**；一律按 `code` 翻译。
 *      `code` 不在表内 ⇒ 兜底文案 + 上报（**不许把裸 code 印给用户**）。
 *   ⇒ 本组件的可见文字**只来自 `translateError()`**，任何人都不许在这里写技术报错。
 *     裸 code 只出现在 `data-kaipu-*` 属性里（给判据用，不给用户看）。
 *
 * ★★ 还有一类不是"错误"，是"该走另一条路"（契约 `clientAction`）：
 *      · `duplicate_request` ⇒ **不弹错**，按 `detail.poll` 切到查询接口
 *      · `not_checked_in`    ⇒ 显示「该场景需进场」，不是普通报错
 *    这两种**不能用错误样式**渲染 —— 用红框弹一个"已经在跑了"是不对的：
 *    用户没做错任何事，他只需要被送到正确的页面。
 */
import type { ReactElement } from 'react'
import { duplicatePollPath, isReroutableError, translateError } from '@shanhai/kaipu-contract'
import { CONSTRAINTS } from './copy.js'
import { C, FS, LH } from './theme.js'

export interface ErrorSurfaceProps {
  code: string
  detail?: Record<string, unknown> | undefined
  onDismiss: () => void
}

export function ErrorSurface({ code, detail, onDismiss }: ErrorSurfaceProps): ReactElement {
  // ★ 契约点名的两个"另走一条路"的码
  if (isReroutableError(code)) return <Reroute code={code} detail={detail} onDismiss={onDismiss} />

  const text = translateError(code)
  const isExpiry = code === 'reservation_expired'

  return (
    <div
      data-kaipu-error={code}
      style={{
        marginTop: 12,
        padding: '10px 12px',
        border: `1px solid ${C.border}`,
        borderLeft: '3px solid #dc2626',
        background: 'rgba(220,38,38,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* ★ 只显示译后文案 —— 裸 code 不出现在可见文字里 */}
        <span style={{ fontSize: FS.base, lineHeight: LH.normal }}>{text}</span>
        <button type="button" onClick={onDismiss} style={{ ...ghost, marginLeft: 'auto' }}>
          知道了
        </button>
      </div>

      {/* 约束 ③：超时释放 —— 「过期不候 · 可重新预约」（不惩罚首次） */}
      {isExpiry && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: FS.base, color: '#b45309' }}>{CONSTRAINTS.expiry}</div>
          <div style={{ fontSize: FS.small, color: C.dim, marginTop: 3, lineHeight: LH.normal }}>
            {CONSTRAINTS.expiryWhy}
          </div>
          <button type="button" onClick={onDismiss} style={{ ...ghost, marginTop: 8 }}>
            重新预约（不用重新填）
          </button>
        </div>
      )}
    </div>
  )
}

/** `duplicate_request` / `not_checked_in` ⇒ **不是错误**，是"该走另一条路"。 */
function Reroute({
  code,
  detail,
  onDismiss,
}: {
  code: string
  detail?: Record<string, unknown> | undefined
  onDismiss: () => void
}): ReactElement {
  const text = translateError(code)
  const poll = duplicatePollPath(detail)
  const requiresExternal = detail?.['requiresExternal'] === true
  const availableAt = formatAt(detail?.['availableAt'])

  return (
    <div
      data-kaipu-reroute={code}
      // ★ 把真正消费到的 poll 路径挂出来 —— 判据据此证明 detail **真的被用了**，
      //   而不是"我读了契约文档、以为它会用"。裸路径不给用户看（只在属性里）。
      {...(poll === undefined ? {} : { 'data-kaipu-poll': poll })}
      // 同理：可进场时点也挂出来，让判据断言"它真被渲染了"，而不是"我以为读了"
      {...(availableAt === null ? {} : { 'data-kaipu-available-at': availableAt })}
      style={{
        marginTop: 12,
        padding: '10px 12px',
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.accent}`,
        background: 'rgba(59,111,224,0.06)',
      }}
    >
      <div style={{ fontSize: FS.base, lineHeight: LH.normal }}>{text}</div>
      {poll !== undefined && (
        <div style={{ marginTop: 8 }}>
          {/* 契约 clientAction：按 detail.poll 直接切到查询接口，不弹错 */}
          <button type="button" onClick={onDismiss} style={ghost}>
            查看这次运行
          </button>
          <span style={{ fontSize: FS.tag, color: C.dim, marginLeft: 10 }}>（切到查询接口，不重复提交）</span>
        </div>
      )}
      {requiresExternal && (
        <div style={{ fontSize: FS.small, color: C.dim, marginTop: 6, lineHeight: LH.normal }}>
          该场景需进场：有有效预约后才可运行（这不是故障）。
          {/* ★★ `availableAt` 是这条"出路"的**具体时点** —— 只说"要有预约"而不给时点，用户还是不知道下一步。
              契约 `errors.json` 的 `clientAction` 明文要求：带 availableAt 就必须一并显示。 */}
          {availableAt !== null && (
            <span>
              {' '}
              可进场时点：<strong data-kaipu-available-text="1">{availableAt}</strong>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * ISO8601 → 本地可读时点。**读不懂就返回 null**（不显示，不抛）。
 *
 * ★★ 只做「格式化绝对时点」，**不做「还剩多久」** —— 这是契约纪律，不是偷懒：
 *   服务端给的是**绝对时点**（`availableAt`），而倒计时的**基准**必须由服务端给
 *   （契约原文：`windowRemainingSec` 服务端给，客户端不自己算基准）。
 *   ⇒ 一旦我自己 `Date.now()` 相减，客户端时钟偏差就会变成一个**看起来像真的**的错数字。
 */
function formatAt(iso: unknown): string | null {
  if (typeof iso !== 'string') return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const ghost = {
  fontSize: FS.small,
  padding: '4px 12px',
  border: `1px solid ${C.border}`,
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
} as const
