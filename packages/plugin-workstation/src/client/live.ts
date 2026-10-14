/**
 * 山海·开铺 · 工位插件 · client half —— 数据源层
 * =====================================================================
 * 面板只认这一层，**不关心数据从哪来**。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 数据源是**显式五态**，绝不悄悄回落
 * ══════════════════════════════════════════════════════════════════
 *   · `scaffold`    期1 演示种子（host 回 source='scaffold'，诚实标非 live）
 *   · `live`        真服务端读到了（待服务端五项落地后接真 `kaipu-workstation/state`）
 *   · `unreachable` 想连真服务端但没连上（★ 如实说）
 *   · `no_channel`  连通道都没取到（环境问题，与"服务端故障"是两件事）
 *   · `stale`       通道在，但读不到工位数据（常见：host half 未注册端点）
 *
 * ★ 读不到 ⇒ 返回**空 + 原因**，**绝不填演示数据**（与 wisdom `live.ts` 同取向）。
 */
import type { Invite, Member, Seat, WorkstationState } from '@shanhai/kaipu-contract'
import { callKaipu, type BridgeError, type BridgeResult, type ConnectionHandle } from './bridge.js'

/* ══════════════════════════════════════════════════════════════════
   一、连接句柄（模块级单例 —— 由 `WorkstationPanel.tsx` 的 wireConnection 注入）
   ══════════════════════════════════════════════════════════════════ */
let connection: ConnectionHandle | null = null

export function setConnection(conn: ConnectionHandle | null): void {
  connection = conn
}

export function hasConnection(): boolean {
  return connection !== null
}

/* ══════════════════════════════════════════════════════════════════
   二、快照
   ══════════════════════════════════════════════════════════════════ */

export type SourceKind = 'scaffold' | 'live' | 'unreachable' | 'no_channel' | 'stale'

export interface WorkstationSnapshot {
  kind: SourceKind
  /** 状态带标签（正向诚实） */
  label: string
  /** 读不到时的原因（已翻译，不上屏技术原文） */
  reason: string | null
  /** 工位持久化态（scaffold/live 才有值；其余一律 null，绝不填演示数据） */
  state: WorkstationState | null
  server: { baseUrl: string; accountId: string } | null
}

function offline(kind: SourceKind, label: string, reason: string): WorkstationSnapshot {
  return { kind, label, reason, state: null, server: null }
}

function looksLikeMissingEndpoint(err: BridgeError): boolean {
  if (err.kind !== 'gateway') return false
  const s = `${err.code} ${err.detail}`.toLowerCase()
  return (
    s.includes('not_found') ||
    s.includes('notfound') ||
    s.includes('no_handler') ||
    s.includes('no handler') ||
    s.includes('unknown_endpoint') ||
    s.includes('unknown endpoint') ||
    s.includes('endpoint_not_found') ||
    s.includes('路径不存在')
  )
}

/** 读工位持久化态。任何一步失败都如实返回，不回落 mock */
export async function loadWorkstationState(signal?: AbortSignal): Promise<WorkstationSnapshot> {
  if (connection === null) {
    return offline('no_channel', '通道不可用', '没取到宿主的数据通道。这是环境问题，不是服务端故障。')
  }

  const r = await callKaipu<WorkstationState>(connection, 'state', {}, signal)
  if (r.ok !== true) {
    if (!('business' in r) && looksLikeMissingEndpoint(r.error)) {
      const ownBug = /\/api\//.test(r.error.detail) || /路径不存在/.test(r.error.detail)
      return offline(
        'stale',
        '工位数据读不到',
        ownBug
          ? '接入地址不对 —— 数据通道未被正确寻址（路径里混入了内部通道段），请核对接入地址配置。'
          : '数据通道未就绪 —— 工位数据由本插件 host half 提供，它可能未加载成功。',
      )
    }
    return offline('unreachable', '未连上', 'business' in r ? r.business.message : r.error.detail)
  }

  const st = r.data
  return {
    kind: st.source,
    label: st.source === 'scaffold' ? '持久化态（演示种子）' : '已接入',
    reason: null,
    state: st,
    server: { baseUrl: '', accountId: st.accountId },
  }
}

/* ══════════════════════════════════════════════════════════════════
   三、渲染用纯函数（判据可断言 · 与 host workstation-state.ts 同逻辑、各一半）
   ══════════════════════════════════════════════════════════════════ */

/** ③ 离座≠空缺≠移除：presence='away' 且 membershipActive=true ⇒ 离座·留痕在 */
export function seatText(seat: Seat): string {
  if (seat.status === 'vacant') return '空位 · 可邀请'
  if (!seat.membershipActive) return '已移除 · 释放回空位池'
  return seat.presence === 'away' ? '离座 · 留痕在' : '在场'
}

/** ② 邀请是否过期 */
export function inviteExpired(invite: Invite, now: string): boolean {
  if (invite.used) return false
  return new Date(invite.expiresAt).getTime() <= new Date(now).getTime()
}

/** ④ 成员按 kind 拆两集合：人类协作方 / Agent 订阅者 */
export function splitMembers(state: WorkstationState): { humans: Member[]; agents: Member[] } {
  const humans: Member[] = []
  const agents: Member[] = []
  for (const m of state.members) {
    if (m.kind === 'agent') agents.push(m)
    else humans.push(m)
  }
  return { humans, agents }
}

/** 座位汇总：占用/空位/离座仍在编/已移除 四数正交 */
export function summarizeSeats(state: WorkstationState): {
  occupied: number
  vacant: number
  awayButActive: number
  removed: number
} {
  let occupied = 0
  let vacant = 0
  let awayButActive = 0
  let removed = 0
  for (const s of state.seats) {
    if (s.status === 'vacant') {
      vacant++
      continue
    }
    if (!s.membershipActive) {
      removed++
      continue
    }
    occupied++
    if (s.presence === 'away') awayButActive++
  }
  return { occupied, vacant, awayButActive, removed }
}
