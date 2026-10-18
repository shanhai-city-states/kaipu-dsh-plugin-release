/**
 * 山海·开铺 · 工位插件 · 面板（期1 · 渲染持久化态）
 * =====================================================================
 * 渲染对象 = 工位持久化态（座位/球/轮次/留痕/事件流底座·二分口径）。
 * ★ 期1 只渲染**持久化态**，不实时流（承设计裁定：先做可追溯，再做实时）。
 * ★ 设计纪律四点在对应区块**可视化**：① fail-open 代价 ② 邀请有效期
 *   ③ 离座≠移除 ④ 人类协作方/Agent 订阅者分开。
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { getConnection, type ClientCtxLike } from './bridge.js'
import {
  claimTask,
  createOrgNode,
  createTask,
  deleteOrgNode,
  finishTask,
  inviteExpired,
  loadOrgTree,
  loadTasks,
  loadWorkstationState,
  renameOrgNode,
  seatText,
  setConnection,
  splitMembers,
  summarizeSeats,
  type OrgNodeView,
  type OrgTreeView,
  type TaskItem,
  type SourceKind,
  type WorkstationSnapshot,
} from './live.js'
import { C, FONT, FS, LH } from './theme.js'
import type { BallLamp, Member, WorkstationState } from '@shanhai/kaipu-contract'

export function wireConnection(ctx: ClientCtxLike): void {
  setConnection(getConnection(ctx))
}

type Loaded = WorkstationSnapshot | null

/** 留痕折叠阈值（★ 戒 P2-8：先戴上限 + 展开，真分页/虚拟化转期3 按试点数据量定形态） */
const TRACE_LIMIT = 50

/** 时间刷新周期（★ 戒 P2-8：`now` 原先只在快照变化时取一次 ⇒ 邀请过期提示不会自己变） */
const NOW_TICK_MS = 60_000

const LAMP_COLOR: Record<BallLamp, string> = {
  red: '#dc2626',
  green: '#16a34a',
  amber: '#d97706',
  blue: '#3B6FE0',
}

export function WorkstationPanel(): ReactElement {
  const [snap, setSnap] = useState<Loaded>(null)
  /* ★ 戒 P2-8：`now` 必须自己走，不能吊在 `snap` 上（否则页面挂着不动，邀请永不显过期） */
  const [nowIso, setNowIso] = useState(() => new Date().toISOString())

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

  useEffect(() => {
    const timer = setInterval(() => setNowIso(new Date().toISOString()), NOW_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const state = snap?.state ?? null

  return (
    <div
      data-kaipu-workstation="1"
      style={{ padding: 16, overflowWrap: 'break-word', color: C.text }}
    >
      <div style={{ fontSize: FS.heading, fontWeight: 600, marginBottom: 10 }}>工位</div>

      <StatusBand snap={snap} state={state} />

      {/* ★ 期4：真组织层（独立于 scaffold —— 没接服务端时自己显示「未接入」） */}
      <OrgSection />

      {/* ★ 期5：任务层（发布 / 领取 / 完成） */}
      <TaskSection />

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
  /* ★ 匠 P2-③：**四数分账**，不是「四数正交」——
     `occupied` 含 away、`awayButActive` ⊆ occupied ⇒ 直接四项相加会重复计数。
     口径：先给座位总数（occupied + vacant + removed），离座作为 occupied 的子集括注。 */
  const totalSeats = sum === null ? 0 : sum.occupied + sum.vacant + sum.removed
  const summaryLine =
    sum === null
      ? ''
      : `· 座位 ${totalSeats} 位：${sum.occupied} 占用（含 ${sum.awayButActive} 离座仍在编）· ${sum.vacant} 空位 · ${sum.removed} 已移除`

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
              {/* ② 邀请**三态**（★ 匠 P2-②：`used` 原先在面板里零消费 ⇒ 已接受的邀请
                  仍显示「＋邀请 · 有效期至」，看起来像还能再邀一次） */}
              {invite !== undefined && (
                <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 2 }}>
                  {invite.used
                    ? `✓ 邀请已被接受（${invite.toName} · ${invite.expiresAt.slice(11, 16)} 前有效）`
                    : expired
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
        <MemberCol heading="协作方（人）" members={humans} tone="#3B6FE0" />
        <MemberCol heading="订阅者（Agent）" members={agents} tone="#6d28d9" />
      </div>
      <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 4 }}>
        人类协作方能坐座位、产生留痕；Agent 订阅事件流/被叫醒——两个集合不混列、不互推；邀请只发人。
      </div>
    </Section>
  )
}

/**
 * 单侧成员栏。
 * ★ 匠 P2-⑤：列表项 key 用 **`member.id`**，不用成员名 —— 名字可重（同名协作方），
 *   用名字做 key 会让 React 把两个人当成同一个节点（状态串到别人身上）。
 */
function MemberCol({ heading, members, tone }: { heading: string; members: Member[]; tone: string }): ReactElement {
  return (
    <div style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px' }}>
      <div style={{ fontSize: FS.tag, color: tone, fontWeight: 600, marginBottom: 4 }}>{heading}</div>
      {members.length === 0 ? (
        <div style={{ fontSize: FS.tag, color: C.dim }}>（空）</div>
      ) : (
        members.map((m) => (
          <div key={m.id} style={{ fontSize: FS.small }}>
            {m.name}
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
  /* ★ 戒 P2-8（分层处置）：本期先戴**上限 50 条 + 展开全部**；
     真分页 / 虚拟化 ⇒ 转期3（试点一个客户后按真实数据量定形态，现在拍形态没有依据）。 */
  const [showAll, setShowAll] = useState(false)
  const overLimit = state.traces.length > TRACE_LIMIT
  const visible = overLimit && !showAll ? state.traces.slice(0, TRACE_LIMIT) : state.traces
  return (
    <Section title="留痕（谁 / 何时 / 从哪 / 是否协作方）">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map((t) => (
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
      {overLimit && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          style={{
            marginTop: 6,
            fontSize: FS.tag,
            color: C.accent,
            background: 'transparent',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: '3px 8px',
            cursor: 'pointer',
          }}
        >
          {showAll ? `收起（只看最近 ${TRACE_LIMIT} 条）` : `展开全部（共 ${state.traces.length} 条 · 当前显示最近 ${TRACE_LIMIT} 条）`}
        </button>
      )}
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
   设计纪律四点一览 · 明示已吸收
   ══════════════════════════════════════════════════════════════════ */

function DisciplineCard(): ReactElement {
  return (
    <Section title="设计纪律 · 四点已吸收">
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: FS.tag, color: C.dim, lineHeight: LH.normal }}>
        <li>① fail-open 要说清代价（外发失败不影响落库，代价已明示）</li>
        <li>② 邀请带有效期（invite.expiresAt，过期不占座）</li>
        <li>③ 离座≠移除（presence × membershipActive 是两个维度 —— 四数分账：occupied 含 away · awayButActive ⊆ occupied · 移除=释放回空位池）</li>
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

/* ══════════════════════════════════════════════════════════════════
   期4 · 工位布局（真数据 · 可操作）
   ══════════════════════════════════════════════════════════════════
   ★ 这一块与上面的「本地持久化态」不同：它读服务端 `/org/*`，**真能改**。
   ★ 没接服务端时显示「未接入」+ 原因，**不假装成功**（承「未接入不是 bug」）。
   ★ 卡片语言对齐 platform：圆角 10 / 细边 / 状态点 / 操作靠右。
   ══════════════════════════════════════════════════════════════════ */

function OrgSection(): ReactElement {
  const [tree, setTree] = useState<OrgTreeView | null>(null)
  const [err, setErr] = useState<{ code: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const refresh = async (): Promise<void> => {
    const r = await loadOrgTree()
    if (r.ok) {
      setTree(r.data)
      setErr(null)
    } else {
      setErr({ code: r.code, message: r.message })
      setTree(null)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (fn: () => Promise<{ ok: boolean; code?: string; message?: string }>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fn()
      if (!r.ok) setErr({ code: r.code ?? 'error', message: r.message ?? '操作失败' })
      else setErr(null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const onAdd = (): void => {
    const name = draft.trim()
    if (name.length === 0) return
    void run(async () => {
      const r = await createOrgNode(name)
      if (r.ok) setDraft('')
      return r
    })
  }

  const onRename = (nodeId: string): void => {
    const name = editName.trim()
    if (name.length === 0) {
      setEditing(null)
      return
    }
    void run(async () => {
      const r = await renameOrgNode(nodeId, name)
      if (r.ok) setEditing(null)
      return r
    })
  }

  const onDelete = (node: OrgNodeView): void => {
    // ★ 不弹原生 confirm（DSH 面板里体验差）：改两步 —— 第一次点变「确认删除」，再点才删
    if (editing !== `del:${node.node_id}`) {
      setEditing(`del:${node.node_id}`)
      return
    }
    setEditing(null)
    void run(async () => deleteOrgNode(node.node_id))
  }

  const nodes = tree?.nodes ?? []
  const roots = nodes.filter((n) => !n.parent_node_id)
  const childrenOf = (id: string): OrgNodeView[] => nodes.filter((n) => n.parent_node_id === id)
  // ★ 座位表口径（阿开 2026-10-19）：**位** = 叶子节点（post）；只有一个根时它自己也是位
  //   ⇒ 不按树缩进展示，而按 3 列网格铺开，更像办公室
  const leaves = nodes.filter((n) => childrenOf(n.node_id).length === 0)
  const gridNodes = leaves.length > 0 ? leaves : nodes

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: FS.title, fontWeight: 600 }}>工位布局</div>
        <span style={{ fontSize: FS.small, color: C.dim }}>
          {nodes.length === 0 ? '' : `${nodes.length} 个工位`}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          style={btnStyle(false)}
          title="重新读取"
        >
          刷新
        </button>
      </div>

      {/* 未接入 / 出错 */}
      {err !== null ? (
        <div
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: '12px 14px',
            background: C.soft,
            fontSize: FS.small,
            color: err.code === 'not_configured' ? C.dim : '#d97706',
            lineHeight: LH.normal,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {err.code === 'not_configured' ? '工位还没接服务端' : '工位布局读不到'}
          </div>
          <div>{err.message}</div>
        </div>
      ) : tree === null ? (
        <div style={{ ...cardStyle, color: C.dim, fontSize: FS.small }}>正在读取工位布局…</div>
      ) : roots.length === 0 ? (
        <div style={{ ...cardStyle, color: C.dim, fontSize: FS.small, lineHeight: LH.normal }}>
          还没有工位 —— 在下面输入一个名字，加第一个。
        </div>
      ) : (
        <>
        <div
          style={{
            display: 'grid',
            // ★ 5 列 × 2 行 = 10 个位（阿开 2026-10-19 定稿：上限 10 位 ⇒ 一行 5 个卡片）
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 8,
          }}
        >
          {gridNodes.map((n) => (
            <OrgNodeCard
              key={n.node_id}
              node={n}
              busy={busy}
              editing={editing}
              editName={editName}
              setEditName={setEditName}
              onStartRename={(node) => {
                setEditing(node.node_id)
                setEditName(node.name)
              }}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
          {Array.from({ length: Math.max(0, 10 - gridNodes.length) }).map((_, i) => (
            <EmptySeat key={`empty-${i}`} />
          ))}
        </div>
        {gridNodes.length > 10 ? (
          <div style={{ fontSize: FS.small, color: C.dim, marginTop: 6 }}>
            还有 {gridNodes.length - 10} 个位未显示（先显示前 10 个）
          </div>
        ) : null}
        </>
      )}

      {/* 添加工位 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAdd()
          }}
          placeholder="新工位名字，如「前端位」"
          disabled={busy || err?.code === 'not_configured'}
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: 'transparent',
            color: C.text,
            fontSize: FS.small,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={busy || draft.trim().length === 0 || err?.code === 'not_configured'}
          style={btnStyle(true)}
        >
          添加工位
        </button>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: '12px 14px',
  background: C.soft,
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: 8,
    border: `1px solid ${primary ? 'transparent' : C.border}`,
    // ★★ 2026-10-19 阿开实测「按钮看不见但盲点能点」的两个根因：
    //   ① C.text = 'var(--dsh-text, inherit)' —— 拿来当 background 时，
    //      宿主没注入变量 ⇒ 回退成 inherit ⇒ **对 background-color 无效** ⇒ 整条声明被丢弃 ⇒ 无背景
    //   ② C.soft = 'var(--dsh-surface-secondary, rgba(127,127,127,0.08))' —— 当文字色时是
    //      8% 透明度的灰 ⇒ 落在浅底上几乎全透明
    //   ⇒ 无背景 + 近透明字 = 看不见；但 padding 还在 = 点得到。
    //   ⇒ 主按钮改用 theme 里唯一写死的实色 C.accent + 纯白字。
    background: primary ? C.accent : 'transparent',
    color: primary ? '#ffffff' : C.text,
    fontSize: FS.small,
    cursor: 'pointer',
    opacity: 1,
  }
}

interface OrgNodeCardProps {
  node: OrgNodeView
  busy: boolean
  editing: string | null
  editName: string
  setEditName: (v: string) => void
  onStartRename: (n: OrgNodeView) => void
  onRename: (nodeId: string) => void
  onDelete: (n: OrgNodeView) => void
}

/** 一个「位」= 3 列网格里的一张卡（不缩进、不展开子级 —— 座位表口径） */
function OrgNodeCard(props: OrgNodeCardProps): ReactElement {
  const { node, busy, editing, editName, setEditName } = props
  const isRenaming = editing === node.node_id
  const isDeleting = editing === `del:${node.node_id}`
  const kind = node.node_kind ?? 'role'
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${hover || isRenaming ? C.text : C.border}`,
        borderRadius: 10,
        padding: '10px 12px',
        background: C.soft,
        transition: 'border-color 120ms',
        minHeight: 78,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: kind === 'team' ? C.text : C.dim,
            flex: '0 0 auto',
          }}
        />
        {isRenaming ? (
          <input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onRename(node.node_id)
              if (e.key === 'Escape') props.onStartRename({ ...node, name: '' })
            }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '3px 6px',
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: 'transparent',
              color: C.text,
              fontSize: FS.small,
              outline: 'none',
            }}
          />
        ) : (
          <span
            style={{
              fontSize: FS.small,
              fontWeight: 600,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={node.name}
          >
            {node.name}
          </span>
        )}
      </div>

      <div style={{ fontSize: FS.small, color: C.dim }}>{kind}</div>

      <div style={{ display: 'flex', gap: 6, marginTop: 'auto', alignItems: 'center' }}>
        {isRenaming ? (
          <button type="button" onClick={() => props.onRename(node.node_id)} disabled={busy} style={btnStyle(true)}>
            存
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => props.onStartRename(node)}
              disabled={busy}
              style={btnStyle(false)}
            >
              改名
            </button>
            {/* ★★ 2026-10-19（阿开：「不能删的为什么要有删除按钮」）
                undeletable 非空 ⇒ **不渲染删除按钮**，把原因直接写出来。
                理由：给一个必然失败的按钮，比不给更糟 —— 用户点了才知道不行，
                而且「点了没反应 / 报错」看起来像 bug。 */}
            {node.undeletable ? (
              <span
                title={node.undeletable}
                style={{
                  fontSize: FS.small,
                  color: C.faint,
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {node.undeletable}
              </span>
            ) : (
              <button type="button" onClick={() => props.onDelete(node)} disabled={busy} style={btnStyle(false)}>
                {isDeleting ? '确认?' : '删除'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** 空位（凑满 6 格 · 像办公室里的空工位） */
function EmptySeat(): ReactElement {
  return (
    <div
      style={{
        border: `1px dashed ${C.border}`,
        borderRadius: 10,
        padding: '10px 12px',
        minHeight: 78,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: C.dim,
        fontSize: FS.small,
      }}
    >
      空位
    </div>
  )
}


/* ══════════════════════════════════════════════════════════════════
   期5 · 任务（发布 / 领取 / 完成）
   ══════════════════════════════════════════════════════════════════
   ★ 状态机由服务端把守：open → claimed → done
   ★ 领取是**原子**的：两个人同时点，只有一个成功，另一个看到「已被领走」
   ★ 这一块的每个按钮都**真会发请求**，不是装饰
   ══════════════════════════════════════════════════════════════════ */

const STATUS_TEXT: Record<string, string> = {
  open: '待领',
  claimed: '已领',
  done: '已完成',
  cancelled: '已取消',
}

function TaskSection(): ReactElement {
  const [data, setData] = useState<{ tasks: TaskItem[]; counts: Record<string, number> } | null>(null)
  const [err, setErr] = useState<{ code: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = async (all: boolean): Promise<void> => {
    const r = await loadTasks(all)
    if (r.ok) {
      setData(r.data)
      setErr(null)
    } else {
      setErr({ code: r.code, message: r.message })
      setData(null)
    }
  }

  useEffect(() => {
    void refresh(showAll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll])

  const run = async (
    fn: () => Promise<{ ok: boolean; code?: string; message?: string }>,
    okMsg?: string,
  ): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const r = await fn()
      if (!r.ok) setErr({ code: r.code ?? 'error', message: r.message ?? '操作失败' })
      else {
        setErr(null)
        if (okMsg) setNotice(okMsg)
      }
      await refresh(showAll)
    } finally {
      setBusy(false)
    }
  }

  const onPublish = (): void => {
    const t = title.trim()
    if (t.length === 0) return
    void run(async () => {
      const r = await createTask(t, detail.trim())
      if (r.ok) {
        setTitle('')
        setDetail('')
        setComposing(false)
      }
      return r
    }, '任务已发布')
  }

  const tasks = data?.tasks ?? []
  const counts = data?.counts ?? {}

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: FS.title, fontWeight: 600 }}>任务</div>
        {['open', 'claimed'].map((k) =>
          counts[k] ? (
            <span key={k} style={{ fontSize: FS.small, color: C.dim }}>
              {STATUS_TEXT[k]} {counts[k]}
            </span>
          ) : null,
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          disabled={busy}
          style={btnStyle(false)}
          title="连已完成的也列出来"
        >
          {showAll ? '只看未完成' : '含已完成'}
        </button>
        <button type="button" onClick={() => setComposing((v) => !v)} disabled={busy} style={btnStyle(true)}>
          {composing ? '收起' : '＋ 发布'}
        </button>
      </div>

      {/* 发布表单 */}
      {composing ? (
        <div style={{ ...cardStyle, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) onPublish()
            }}
            placeholder="任务标题，如「写完期5验收报告」"
            style={inputStyle}
          />
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="补充说明（可空）"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button type="button" onClick={onPublish} disabled={busy || title.trim().length === 0} style={btnStyle(true)}>
              发布
            </button>
          </div>
        </div>
      ) : null}

      {/* 提示 */}
      {notice !== null ? (
        <div style={{ fontSize: FS.small, color: '#16a34a', marginBottom: 6 }}>{notice}</div>
      ) : null}

      {/* 未接入 / 出错 */}
      {err !== null ? (
        <div style={{ ...cardStyle, fontSize: FS.small, color: err.code === 'not_configured' ? C.dim : '#d97706' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {err.code === 'not_configured' ? '任务面板还没接服务端' : '任务读不到'}
          </div>
          <div>{err.message}</div>
        </div>
      ) : data === null ? (
        <div style={{ ...cardStyle, color: C.dim, fontSize: FS.small }}>正在读取任务…</div>
      ) : tasks.length === 0 ? (
        <div style={{ ...cardStyle, color: C.dim, fontSize: FS.small }}>
          还没有任务 —— 点右上「＋ 发布」发第一条。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map((t) => (
            <TaskCard key={t.task_id} task={t} busy={busy} run={run} />
          ))}
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: 'transparent',
  color: C.text,
  fontSize: FS.small,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

function TaskCard(props: {
  task: TaskItem
  busy: boolean
  run: (fn: () => Promise<{ ok: boolean; code?: string; message?: string }>, okMsg?: string) => Promise<void>
}): ReactElement {
  const { task, busy, run } = props
  const isOpen = task.status === 'open'
  const isClaimed = task.status === 'claimed'
  const tone = isOpen ? C.text : isClaimed ? '#d97706' : C.dim

  return (
    <div style={{ ...cardStyle, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: tone, flex: '0 0 auto' }} />
        <span style={{ fontSize: FS.small, fontWeight: 600, flex: 1, minWidth: 0 }}>{task.title}</span>
        <span style={{ fontSize: FS.small, color: tone }}>{STATUS_TEXT[task.status] ?? task.status}</span>
      </div>
      {task.detail ? (
        <div style={{ fontSize: FS.small, color: C.dim, marginTop: 4, whiteSpace: 'pre-wrap' }}>{task.detail}</div>
      ) : null}
      {task.result ? (
        <div style={{ fontSize: FS.small, color: C.dim, marginTop: 4 }}>
          交付：{task.result}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {isOpen ? (
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                const r = await claimTask(task.task_id)
                return r
              }, '已领取')
            }
            disabled={busy}
            style={btnStyle(true)}
          >
            领取
          </button>
        ) : null}
        {isClaimed ? (
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                const r = await finishTask(task.task_id, '')
                return r
              }, '已标记完成')
            }
            disabled={busy}
            style={btnStyle(true)}
          >
            完成
          </button>
        ) : null}
      </div>
    </div>
  )
}
