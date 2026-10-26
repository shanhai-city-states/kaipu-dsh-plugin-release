/* ══════════════════════════════════════════════════════════════════
   任务依赖 + 交付版本 · 卡片内区块（2026-10-26 · Agent 版 OA）

   ★ 为什么做成独立件而不是塞进 WorkstationPanel：
     WorkstationPanel.tsx 已 7,000+ 行。再往里塞两块带异步状态的 UI，
     判据就只能靠「读源码找字符串」—— 那是纸面判据，不是行为判据。
     纯逻辑抽出来（`deps-text.ts` / `deliverable-text.ts`）能真跑输入→输出。

   ★ 两块都不自动拉数据：只在卡片**展开时**才拉。
     任务列表可能几十条，每条都挂一个 useEffect 去要依赖 ⇒ 一屏几十个请求。
     「展开才说是哪条」既是性能，也是语义：收起的卡片不需要知道细节。
   ══════════════════════════════════════════════════════════════════ */
import { useEffect, useState, type ReactElement } from 'react'
import {
  loadTaskDeps,
  addTaskDep,
  removeTaskDep,
  loadDeliverables,
  promoteDeliverable,
  type TaskDepsPayload,
  type DeliverablesPayload,
} from './live.js'
import { C, FS } from './theme.js'
import { depsHeadline, depLine, versionLine, versionHint, pickDepCandidates } from './deps-text.js'

const box: React.CSSProperties = {
  marginTop: 8,
  padding: '8px 10px',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
}

const btn = (primary: boolean): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 6,
  border: `1px solid ${primary ? 'transparent' : C.border}`,
  background: primary ? C.accent : 'transparent',
  color: primary ? '#ffffff' : C.text,
  fontSize: FS.tag,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
})

/** 一条可点的候选（加依赖用）—— 收在 `<details>` 里，不占版面 */
function CandidateList({
  candidates, onPick, busy,
}: {
  candidates: Array<{ id: string; title: string }>
  onPick: (id: string) => void
  busy: boolean
}): ReactElement | null {
  if (candidates.length === 0) return null
  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ fontSize: FS.tag, color: C.dim, cursor: 'pointer' }}>
        ＋ 选一条前置任务（{candidates.length}）
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4, maxHeight: 180, overflow: 'auto' }}>
        {candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={busy}
            onClick={() => onPick(c.id)}
            style={{ ...btn(false), textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={c.title}
          >
            {c.title}
          </button>
        ))}
      </div>
    </details>
  )
}

/* ── 依赖区 ────────────────────────────────────────────────────── */

export function TaskDepsSection({
  taskId, allTasks, run,
}: {
  taskId: string
  /** 全铺任务（用来当「可加为前置」的候选池） */
  allTasks: Array<{ task_id: string; title: string; status: string }>
  run: (fn: () => Promise<{ ok: boolean; code?: string; message?: string }>, okMsg?: string) => Promise<void>
}): ReactElement {
  const [deps, setDeps] = useState<TaskDepsPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = (): void => {
    void loadTaskDeps(taskId).then((r) => {
      if (r.ok) { setDeps(r.data); setErr(null) }
      else setErr(`${r.code}：${r.message}`)
    })
  }
  useEffect(reload, [taskId])

  const candidates = deps === null ? [] : pickDepCandidates(taskId, allTasks, deps)

  const doAdd = (depId: string): void => {
    setBusy(true)
    void run(async () => {
      const r = await addTaskDep(taskId, depId)
      return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message }
    }, '已加依赖').then(() => { setBusy(false); reload() })
  }
  const doRemove = (depId: string): void => {
    setBusy(true)
    void run(async () => {
      const r = await removeTaskDep(taskId, depId)
      return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message }
    }, '已撤依赖').then(() => { setBusy(false); reload() })
  }

  if (err !== null) {
    return <div style={{ ...box, borderColor: '#e5b4b4' }}>
      <span style={{ fontSize: FS.tag, color: '#9b2c2c' }}>依赖读不到（{err}）</span>
    </div>
  }
  if (deps === null) {
    return <div style={{ ...box }}>
      <span style={{ fontSize: FS.tag, color: C.faint }}>依赖读取中…</span>
    </div>
  }

  const idle = deps.dependsOn.length === 0 && deps.blocks.length === 0
  return (
    <div style={box}>
      <div style={{ fontSize: FS.tag, fontWeight: 600, color: C.dim, marginBottom: 4 }}>
        {depsHeadline(deps)}
      </div>
      {deps.dependsOn.length > 0 ? (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: FS.tag, color: C.faint }}>我等这些先交：</div>
          {deps.dependsOn.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ fontSize: FS.tag, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={d.title}>
                {depLine(d)}
              </span>
              <button type="button" disabled={busy} onClick={() => doRemove(d.id)} style={btn(false)}
                title="撤掉这条依赖 —— 撤了这条任务可能立刻可以领">
                撤
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {deps.blocks.length > 0 ? (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: FS.tag, color: C.faint }}>我挡着这些（我交了它们才能动）：</div>
          {deps.blocks.map((d) => (
            <div key={d.id} style={{ fontSize: FS.tag, color: C.dim, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={d.title}>
              {depLine(d)}
            </div>
          ))}
        </div>
      ) : null}
      {idle ? (
        <div style={{ fontSize: FS.tag, color: C.faint }}>
          没有依赖 —— 这条现在就能领，也不挡别人的活。
        </div>
      ) : null}
      <CandidateList candidates={candidates} onPick={doAdd} busy={busy} />
    </div>
  )
}

/* ── 交付版本区 ────────────────────────────────────────────────── */

export function DeliverableVersionsSection({
  taskId, run,
}: {
  taskId: string
  run: (fn: () => Promise<{ ok: boolean; code?: string; message?: string }>, okMsg?: string) => Promise<void>
}): ReactElement {
  const [dl, setDl] = useState<DeliverablesPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = (): void => {
    void loadDeliverables(taskId).then((r) => {
      if (r.ok) { setDl(r.data); setErr(null) }
      else setErr(`${r.code}：${r.message}`)
    })
  }
  useEffect(reload, [taskId])

  const doPromote = (did: string): void => {
    setBusy(true)
    void run(async () => {
      const r = await promoteDeliverable(taskId, did)
      return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message }
    }, '已切换最终稿').then(() => { setBusy(false); reload() })
  }

  if (err !== null) {
    return <div style={{ ...box, borderColor: '#e5b4b4' }}>
      <span style={{ fontSize: FS.tag, color: '#9b2c2c' }}>交付版本读不到（{err}）</span>
    </div>
  }
  if (dl === null) {
    return <div style={{ ...box }}>
      <span style={{ fontSize: FS.tag, color: C.faint }}>交付版本读取中…</span>
    </div>
  }
  if (dl.count === 0) {
    return <div style={box}>
      <span style={{ fontSize: FS.tag, color: C.faint }}>还没交过东西 —— 交了第一稿这里会有版本。</span>
    </div>
  }

  return (
    <div style={box}>
      <div style={{ fontSize: FS.tag, fontWeight: 600, color: C.dim, marginBottom: 2 }}>
        {versionLine(dl)}
      </div>
      <div style={{ fontSize: FS.tag, color: C.faint, marginBottom: 6 }}>{versionHint(dl)}</div>
      {dl.items.map((it) => {
        const isFinal = it.is_final === 1
        return (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: FS.tag, fontWeight: isFinal ? 700 : 400, flex: '0 0 auto' }}>
              v{it.version}
            </span>
            <span style={{ fontSize: FS.tag, color: C.dim, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={`${it.filename} · ${it.sha256}`}>
              {it.filename}
            </span>
            {isFinal ? (
              <span style={{ fontSize: FS.tag, color: '#1e7e42', flex: '0 0 auto' }}>最终稿</span>
            ) : (
              <button type="button" disabled={busy} onClick={() => doPromote(it.id)} style={btn(false)}
                title="把这一稿指定为最终稿（下一稿交坏了，用它回退）">
                设为最终
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
