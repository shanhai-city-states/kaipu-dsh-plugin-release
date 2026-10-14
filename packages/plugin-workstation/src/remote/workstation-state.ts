/**
 * 山海·开铺 · 工位插件 · host half · 工位持久化态（083-C 期1）
 * =====================================================================
 * ★ 纯类型经契约层（@shanhai/kaipu-contract）import —— 本文件只放【纯函数 + scaffold 种子】。
 * ★ 设计纪律四点（083-C-015）的类型落点在契约层 `workstation.ts`；本文件落【纯函数判据 + 种子】。
 *
 * ★ 硬边界（不可破）：presence='away' 绝不自动推出 membershipActive=false。
 *   判据见 `seatText` —— 任何把「离座」当成「移除」的代码都是违反边界，须拦截。
 */

import type {
  Invite,
  Member,
  Seat,
  WorkstationState,
} from '@shanhai/kaipu-contract'

// ───────────────────────────── 纯函数（判据可直接 import 断言） ─────────────────────────────

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
      removed++ // 移除=释放回空位池
      continue
    }
    occupied++
    if (s.presence === 'away') awayButActive++ // ③ 离座但仍占座、留痕在
  }
  return { occupied, vacant, awayButActive, removed }
}

/**
 * ③ 边界判据：座位文案——离座≠空缺≠移除。
 * presence='away' 且 membershipActive=true ⇒ 「离座·留痕在」（非空缺、非移除）。
 */
export function seatText(seat: Seat): string {
  if (seat.status === 'vacant') return '空位 · 可邀请'
  if (!seat.membershipActive) return '已移除 · 释放回空位池'
  return seat.presence === 'away' ? '离座 · 留痕在' : '在场'
}

/** ② 邀请是否过期（未使用且超过 expiresAt） */
export function inviteExpired(invite: Invite, now: string): boolean {
  if (invite.used) return false
  return new Date(invite.expiresAt).getTime() <= new Date(now).getTime()
}

/** ④ 成员按 kind 拆两集合——人类协作方 / Agent 订阅者 分离渲染 */
export function splitMembers(state: WorkstationState): {
  humans: Member[]
  agents: Member[]
} {
  const humans: Member[] = []
  const agents: Member[] = []
  for (const m of state.members) {
    if (m.kind === 'agent') agents.push(m)
    else humans.push(m)
  }
  return { humans, agents }
}

// ───────────────────────────── scaffold 种子（诚实标 source='scaffold' · 非 live） ─────────────────────────────

/**
 * 期1 渲染以持久化态先行：本种子标注 source='scaffold'，
 * 待服务端五项（083-C-014 §五）落地后接真 `kaipu-workstation/state`（source='live'）。
 * 种子内容对齐 v0.4-A 原型标注：发起人·协作方甲·协作方乙在场，协作方丙离座·留痕在，空位可邀请。
 * ★ 花名中性化（`083-C-021 §一` 裁定①）：演示种子的作用是让人看懂「结构」，不是记住「人」——
 *   真名反而模糊「这是演示」的信号（下载者可能当成真实配置照抄）。
 */
export function scaffoldState(projectId = 'proj_083c_demo'): WorkstationState {
  const members: Member[] = [
    { id: 'm_kai', name: '发起人', kind: 'human', seatId: 's1', presence: 'present', membershipActive: true },
    { id: 'm_zhou', name: '协作方甲', kind: 'human', seatId: 's2', presence: 'present', membershipActive: true },
    { id: 'm_yue', name: '协作方乙', kind: 'human', seatId: 's3', presence: 'present', membershipActive: true },
    // ③ 协作方丙离座：presence='away' 但 membershipActive=true（仍占座、留痕在、不进空位池）
    { id: 'm_gu', name: '协作方丙', kind: 'human', seatId: 's4', presence: 'away', membershipActive: true },
  ]

  const invite: Invite = {
    id: 'inv_001',
    seatId: 's5',
    toName: '新协作方',
    toKind: 'human',
    issuedAt: '2026-10-09T22:00:00+08:00',
    // ② 有效期至次日 12:00（过期自动失效、不占座）
    expiresAt: '2026-10-10T12:00:00+08:00',
    used: false,
  }

  const seats: Seat[] = [
    { id: 's1', label: '发起人位', status: 'occupied', holderId: 'm_kai', presence: 'present', membershipActive: true },
    { id: 's2', label: '协作方甲位', status: 'occupied', holderId: 'm_zhou', presence: 'present', membershipActive: true },
    { id: 's3', label: '协作方乙位', status: 'occupied', holderId: 'm_yue', presence: 'present', membershipActive: true },
    // ③ 协作方丙离座≠空缺：status 仍 occupied、membershipActive 仍 true
    { id: 's4', label: '协作方丙位', status: 'occupied', holderId: 'm_gu', presence: 'away', membershipActive: true },
    // 空位 + 待接受邀请（②）
    { id: 's5', label: '空位', status: 'vacant', presence: 'away', membershipActive: true, invite },
  ]

  return {
    projectId,
    name: '山海·开铺 · 工位（演示）',
    accountId: 'acct_shanhai',
    source: 'scaffold',
    members,
    seats,
    balls: [
      { id: 'b1', label: '需求定案', lamp: 'red', holderSeatId: 's1', roundId: 'r3' },
      { id: 'b2', label: '契约对齐', lamp: 'green', holderSeatId: 's2' },
      { id: 'b3', label: '发布面', lamp: 'amber', holderSeatId: 's3' },
    ],
    rounds: [
      { id: 'r0', index: 0, title: '立项 · 工位插件骨架', at: '2026-10-09T20:15:00+08:00', byName: '发起人', what: '复核结论，门牌号 shanhai-kaipu-workstation / order 40 定' },
      { id: 'r1', index: 1, title: '面板注册约定对齐', at: '2026-10-09T20:43:00+08:00', byName: '协作方乙', what: 'panelId 同族 / order 礼仪 / slot 成对 + label 是函数 / package.json 形制' },
      { id: 'r2', index: 2, title: '期0 双灯审毕', at: '2026-10-09T21:37:00+08:00', byName: '协作方乙', what: '四条地基独立复现全成立，可进期1' },
      { id: 'r3', index: 3, title: 'v0.4-A/B 确认 · 开期1', at: '2026-10-09T23:00:00+08:00', byName: '发起人', what: '布局字段拍板，渲染持久化态；设计纪律四点已吸收' },
    ],
    traces: [
      {
        id: 't1', kind: 'seat', actorId: 'm_gu', actorName: '协作方丙', actorKind: 'human',
        at: '2026-10-09T22:30:00+08:00', from: 'desktop', isCollaborator: true,
        summary: '离座（presence=away），留痕在，座位仍占用——离座≠移除',
      },
      {
        id: 't2', kind: 'ball', actorId: 'm_zhou', actorName: '协作方甲', actorKind: 'human',
        at: '2026-10-09T22:40:00+08:00', from: 'desktop', isCollaborator: true,
        summary: '持球「契约对齐」(green) 落座 s2',
      },
      {
        id: 't3', kind: 'round', actorId: 'm_kai', actorName: '发起人', actorKind: 'human',
        at: '2026-10-09T23:00:00+08:00', from: 'desktop', isCollaborator: true,
        summary: '开期1：状态面板+座位+轮次 B3+留痕+事件流底座（渲染持久化态）',
      },
      {
        id: 't4', kind: 'formal', actorId: 'm_zhou', actorName: '协作方甲', actorKind: 'human',
        at: '2026-10-09T23:05:00+08:00', from: 'desktop', isCollaborator: true,
        summary: '拟正式件 → 邮件草稿（发送/正本归邮件，工位不直发）',
      },
    ],
    async: {
      dualTrack: true,
      notifyChannel: 'email',
      notifyFailOpen: true,
      // ① 代价明示：外发叫醒失败不丢 events，但人类协作方需回座拉 events?since= 才补阅
      notifyCostNote: '外发叫醒失败不影响 events 落库；代价=人类协作方需回座拉 events?since= 才补阅（不实时推送）',
      eventsSinceEndpoint: 'GET /projects/{id}/events?since=',
    },
    channels: {
      live: {
        visible: 'present_only',
        note: '🔴 实时通道：不在座位收不到实时消息/流（承设计纪律）',
      },
      history: {
        replayable: true,
        endpoint: 'GET /projects/{id}/events?since=',
      },
    },
  }
}
