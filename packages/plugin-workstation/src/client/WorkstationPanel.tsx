/**
 * 山海·开铺 · 工位插件 · 面板（083-C 期1 · 渲染持久化态）
 * =====================================================================
 * 渲染对象 = 工位持久化态（座位/球/轮次/留痕/事件流底座·二分口径）。
 * ★ 期1 只渲染**持久化态**，不实时流（承 083-C-014 裁定：先做可追溯，再做实时）。
 * ★ 设计纪律四点（083-C-015）在对应区块**可视化**：① fail-open 代价 ② 邀请有效期
 *   ③ 离座≠移除 ④ 人类协作方/Agent 订阅者分开。
 */
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { getConnection, type ClientCtxLike } from './bridge.js'
import {
  inviteExpired,
  loadWorkstationState,
  seatText,
  setConnection,
  splitMembers,
  summarizeSeats,
  type SourceKind,
  type WorkstationSnapshot,
} from './live.js'
import { C, FONT, FS, LH } from './theme.js'
import type { BallLamp, WorkstationState } from '@shanhai/kaipu-contract'

export function wireConnection(ctx: ClientCtxLike): void {
  setConnection(getConnection(ctx))
}

type Loaded = WorkstationSnapshot | null

const LAMP_COLOR: Record<BallLamp, string> = {
  red: '#dc2626',
  green: '#16a34a',
  amber: '#d97706',
  blue: '#3B6FE0',
}

export function WorkstationPanel(): ReactElement {
  const [snap, setSnap] = useState<Loaded>(null)

  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    void (async () => {
      const next = await loadWorkstationState(ac.signal)
      if (alive) setSnap(next)
    })()
    return () => {
      alive = false
      ac.abort()
    }
  }, [])

  const state = snap?.state ?? null
  const nowIso = useMemo(() => new Date().toISOString(), [snap])

  return (
    <div
      data-kaipu-workstation="1"
      style={{ padding: 16, overflowWrap: 'break-word', color: C.text }}
    >
      <div style={{ fontSize: FS.heading, fontWeight: 600, marginBottom: 10 }}>工位</div>

      <StatusBand snap={snap} state={state} />

      {state === null ? (
        <Unreadable kind={snap?.kind ?? 'loading'} reason={snap?.reason ?? null} />
      ) : (
        <>
          <BallPanel state={state} />
          <SeatSection state={state} now={nowIso} />
          <MemberColumns state={state} />
          <RoundTimeline state={state} />
          <TraceSection state={state} />
          <EventStreamCard state={state} />
          <DisciplineCard />
        </>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   ① 状态带（一行 · 来源显式）
   ══════════════════════════════════════════════════════════════════ */

function StatusBand({ snap, state }: { snap: Loaded; state: WorkstationState | null }): ReactElement {
  const kind: SourceKind | 'loading' = snap === null ? 'loading' : snap.kind
  const label = snap === null ? '正在读取…' : snap.label

  const sum = state === null ? null : summarizeSeats(state)
  const summaryLine =
    sum === null
      ? ''
      : `· 座位 ${sum.occupied} 占用 / ${sum.vacant} 空位 / ${sum.awayButActive} 离座仍在编 / ${sum.removed} 已移除`

  const tone =
    kind === 'scaffold' || kind === 'live'
      ? '#16a34a'
      : kind === 'stale'
        ? '#d97706'
        : '#dc2626'

  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '8px 10px',
        marginBottom: 12,
        background: C.soft,
      }}
    >
      <div style={{ fontSize: FS.small, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ color: tone, fontWeight: 600 }}>{label}</span>
        <span style={{ color: C.dim, fontSize: FS.tag }}>来源：{kind}</span>
      </div>
      {summaryLine !== '' && (
        <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 4 }}>{summaryLine}</div>
      )}
      {kind === 'scaffold' && (
        <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 2 }}>
          期1 渲染持久化态（诚实标非 live）；服务端五项落地后接真 kaipu-workstation/state
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   状态面板（多球）
   ══════════════════════════════════════════════════════════════════ */

function BallPanel({ state }: { state: WorkstationState }): ReactElement {
  return (
    <Section title="状态面板 · 多球">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {state.balls.map((b) => (
          <div
            key={b.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: `1px solid ${C.border}`,
              borderRadius: 999,
              padding: '4px 10px',
              fontSize: FS.small,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: LAMP_COLOR[b.lamp],
                display: 'inline-block',
              }}
            />
            <span>{b.label}</span>
            <span style={{ color: C.dim, fontSize: FS.tag }}>{b.lamp}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   座位（含空位 + 邀请）· ③ 离座≠移除 可视化
   ══════════════════════════════════════════════════════════════════ */

function SeatSection({ state, now }: { state: WorkstationState; now: string }): ReactElement {
  return (
    <Section title="座位（含空位 · 邀请）">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {state.seats.map((s) => {
          const text = seatText(s)
          const isAway = s.status === 'occupied' && s.presence === 'away' && s.membershipActive
          const invite = s.invite
          const expired = invite !== undefined && inviteExpired(invite, now)
          return (
            <div
              key={s.id}
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: FS.small,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{s.label}</span>
                <span style={{ color: isAway ? '#d97706' : C.dim }}>{text}</span>
              </div>
              {/* ③ 离座≠移除：显式提示，座位仍占用、留痕在、不进空位池 */}
              {isAway && (
                <div style={{ fontSize: FS.tag, color: '#d97706', marginTop: 2 }}>
                  离座≠移除：座位仍占用、留痕在（presence=away 不推出 membershipActive=false）
                </div>
              )}
              {/* ② 邀请有效期：空位待接受，标有效期；过期置灰提示 */}
              {invite !== undefined && (
                <div style={{ fontSize: FS.tag, color: expired ? C.dim : C.dim, marginTop: 2 }}>
                  {expired
                    ? `邀请已失效（有效期至 ${invite.expiresAt.slice(11, 16)}）· 重新邀请`
                    : `＋邀请「${invite.toName}」· 有效期至 ${invite.expiresAt.slice(11, 16)}`}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   ④ 成员两栏：人类协作方 / Agent 订阅者 分开
   ══════════════════════════════════════════════════════════════════ */

function MemberColumns({ state }: { state: WorkstationState }): ReactElement {
  const { humans, agents } = splitMembers(state)
  return (
    <Section title="成员 · ④ 两集合分开">
      <div style={{ display: 'flex', gap: 10 }}>
        <MemberCol heading="协作方（人）" members={humans.map((m) => m.name)} tone="#3B6FE0" />
        <MemberCol heading="订阅者（Agent）" members={agents.map((m) => m.name)} tone="#6d28d9" />
      </div>
      <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 4 }}>
        人类协作方能坐座位、产生留痕；Agent 订阅事件流/被叫醒——两个集合不混列、不互推；邀请只发人。
      </div>
    </Section>
  )
}

function MemberCol({ heading, members, tone }: { heading: string; members: string[]; tone: string }): ReactElement {
  return (
    <div style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px' }}>
      <div style={{ fontSize: FS.tag, color: tone, fontWeight: 600, marginBottom: 4 }}>{heading}</div>
      {members.length === 0 ? (
        <div style={{ fontSize: FS.tag, color: C.dim }}>（空）</div>
      ) : (
        members.map((n) => (
          <div key={n} style={{ fontSize: FS.small }}>
            {n}
          </div>
        ))
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   轮次时间线 B3
   ══════════════════════════════════════════════════════════════════ */

function RoundTimeline({ state }: { state: WorkstationState }): ReactElement {
  return (
    <Section title="轮次时间线 · B3">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {state.rounds.map((r) => (
          <div key={r.id} style={{ fontSize: FS.small, borderLeft: `3px solid ${C.accent}`, paddingLeft: 8 }}>
            <div style={{ fontWeight: 600 }}>
              R{r.index} · {r.at.slice(0, 10)} · {r.byName}
            </div>
            <div style={{ color: C.dim }}>{r.title} —— {r.what}</div>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   留痕（身份四字段）
   ══════════════════════════════════════════════════════════════════ */

function TraceSection({ state }: { state: WorkstationState }): ReactElement {
  return (
    <Section title="留痕（谁 / 何时 / 从哪 / 是否协作方）">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {state.traces.map((t) => (
          <div key={t.id} style={{ fontSize: FS.small, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{t.actorName}</span>
              <span style={{ color: C.dim, fontSize: FS.tag }}>
                {t.at.slice(0, 16)} · {t.from === 'desktop' ? '桌面端' : '浏览器入口'} ·{' '}
                {t.isCollaborator ? '协作方' : '非协作方'} · {t.actorKind === 'agent' ? 'Agent' : '人'}
              </span>
            </div>
            <div style={{ color: C.dim, marginTop: 2 }}>{t.summary}</div>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   事件流底座卡 · C 双轨 + 二分口径 + ① fail-open 代价明示
   ══════════════════════════════════════════════════════════════════ */

function EventStreamCard({ state }: { state: WorkstationState }): ReactElement {
  const a = state.async
  return (
    <Section title="事件流 & 球转移 · 异步审核底座">
      <div style={{ fontSize: FS.small, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>C 双轨（事件落库本体 + 外发叫醒旁路）</div>
        <div style={{ color: C.dim }}>
          · 本体：<code style={{ fontFamily: FONT.mono }}>events</code> 表落库（球转移/座位变更/留痕）
        </div>
        <div style={{ color: C.dim }}>
          · 旁路：落库时外发邮件/飞书叫醒（<code style={{ fontFamily: FONT.mono }}>{a.eventsSinceEndpoint}</code> 回座拉）
        </div>
        {/* ① fail-open 代价明示：外发失败不影响落库，但代价要说清 */}
        <div style={{ color: '#d97706', marginTop: 4 }}>
          ① fail-open：外发叫醒失败不影响落库，但代价须明示 —— {a.notifyCostNote}
        </div>
        <div style={{ color: C.dim, marginTop: 4 }}>通知通道：{a.notifyChannel} · fail-open={String(a.notifyFailOpen)}</div>
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ color: '#dc2626' }}>🔴 实时通道：{state.channels.live.note}</div>
          <div style={{ color: '#16a34a' }}>🟢 历史留痕：回座可 replay（{state.channels.history.endpoint}）</div>
        </div>
      </div>
    </Section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   设计纪律四点（083-C-015）一览 · 明示已吸收
   ══════════════════════════════════════════════════════════════════ */

function DisciplineCard(): ReactElement {
  return (
    <Section title="设计纪律 · 四点已吸收">
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: FS.tag, color: C.dim, lineHeight: LH.normal }}>
        <li>① fail-open 要说清代价（外发失败不影响落库，代价已明示）</li>
        <li>② 邀请带有效期（invite.expiresAt，过期不占座）</li>
        <li>③ 离座≠移除（presence × membershipActive 正交，离座≠空缺≠移除）</li>
        <li>④ 人类协作方 / Agent 订阅者分开（两个集合，不混列）</li>
        <li>边界：离座≠辞退/移除（硬边界，判据拦截自动映射）</li>
      </ul>
    </Section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   空态（读不到时只给原因，绝不渲染座位区）
   ══════════════════════════════════════════════════════════════════ */

function Unreadable({ kind, reason }: { kind: SourceKind | 'loading'; reason: string | null }): ReactElement {
  const isLoading = kind === 'loading'
  const tone = kind === 'stale' ? '#d97706' : '#dc2626'
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '14px 12px',
        fontSize: FS.small,
        color: tone,
        background: C.soft,
      }}
    >
      {isLoading ? '正在读取工位数据…' : reason ?? '工位数据读不到'}
    </div>
  )
}

/* ── 通用小节外壳 ── */
function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: FS.title, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}
