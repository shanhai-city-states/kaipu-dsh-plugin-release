/**
 * 山海·开铺 · 工位插件 · 面板（期1 · 渲染持久化态）
 * =====================================================================
 * 渲染对象 = 工位持久化态（座位/球/轮次/留痕/事件流底座·二分口径）。
 * ★ 期1 只渲染**持久化态**，不实时流（承设计裁定：先做可追溯，再做实时）。
 * ★ 设计纪律四点在对应区块**可视化**：① fail-open 代价 ② 邀请有效期
 *   ③ 离座≠移除 ④ 人类协作方/Agent 订阅者分开。
 */
import { Component, Fragment, useEffect, useRef, useState, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import {
  callKaipu,
  getConnection,
  type ClientCtxLike,
  type ConnectionHandle,
  type EndpointName,
} from './bridge.js'
import {
  archiveProject,
  unarchiveProject,
  downloadProjectArchive,
  claimTask,
  createOrgNode,
  createProject,
  createTask,
  loadProjects,
  loadPackInteractions,
  type ProjectItem,
  deleteOrgNode,
  checkPluginVersion,
  clearAgents,
  evictSeat,
  exportPack,
  purgePack,
  cancelPurge,
  purgeStatus,
  finishTask,
  inviteExpired,
  loadNotifications,
  markNotificationsRead,
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
import { PLUGIN_VERSION } from './version.js'
import type { BallLamp, Member, WorkstationState } from '@shanhai/kaipu-contract'

/* ★ 期6a-2 资料按位的 client 侧最小形状。
   ★ 为什么本地声明而不从 host `service.ts` import：那会把 host 侧（Node）依赖
     拖进浏览器 bundle；两半只通过 `@Remote` 的方法名与 JSON 形状耦合。 */
interface PackFileItem {
  filename: string
  seat?: string
  size?: number
  sha256?: string
  createdAt?: string
}
interface PackListPayload {
  count: number
  files: PackFileItem[]
}
interface PackDownloadPayload {
  filename: string
  contentType: string
  contentBase64: string
  size: number
}
interface WorkstationContext {
  interactionId: string
  seat: string
  note: string
  /** 当前项目（一个铺子同一时间跑一个项目） */
  project: string
  updatedAt?: string
}

interface RolesSeat {
  seat: string
  label: string
  holder: { type: string; id: string; name: string }
  replaceable: boolean
}
interface RolesSeatsPayload {
  seats: RolesSeat[]
  accountId: string
}
interface InviteCreated {
  code: string
  url?: string
  path?: string
  lamp: string
  expiresAt: string
}

interface PackJournalPayload {
  interactionId: string
  seat?: string
  lines: Record<string, unknown>[]
  ok: boolean
  brokenAtSeq: number | null
  anchorOk?: boolean
  appendOnly?: boolean
}

/**
 * 面板自己握一份通道句柄。
 * ★ 为什么面板要自己握：期5b-1 的动作（start / block / unblock / approve / reject /
 *   heartbeat / blocked / pending / whoami）只在 `bridge.ts` 的 `ENDPOINTS` 里声明过，
 *   `live.ts` 没有对应封装；本轮硬约束是**只改本文件**（不动 bridge/live/service）
 *   ⇒ 面板侧直连 `callKaipu`。
 * ★ 与 `live.ts` 里那个模块级单例**同一个句柄**（`wireConnection` 同时注入两处），
 *   不是第二个连接、不是第二个通道。
 */
let panelConn: ConnectionHandle | null = null

export function wireConnection(ctx: ClientCtxLike): void {
  const conn = getConnection(ctx)
  panelConn = conn
  setConnection(conn)
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
  /* ★ 2026-10-20 阿开：「资料（按位）点了附件按钮之后是否单独出现一个 tab 页面与资料并列，
     这样更干净」——把「看资料」与「传资料」拆成两个平级 tab；生成交付 ID 那行撤下（人不需要懂）。 */
  // ★ 2026-10-22（新定案 · 见 `定案-kaipu定位与UI-2026-10-22.md`）：
  //   「最轻的铲子」= 第一屏只有一个动作。tab 从 6 个收到 3+1，
  //   默认落地「任务」（打开第一眼该看到"要我干什么"，不是"有几个座位"）。
  //   upload / notif / help 仍可达，但不再占主栏（一年用两次的东西不该占最贵的界面位置）。
  const [tab, setTab] = useState<'work' | 'tasks' | 'pack' | 'upload' | 'notif' | 'help' | 'more'>('tasks')
  /* ★ 2026-10-21 阿开：从工位页点「🔑 设备」跳过来时，自动展开「高级」（设备台账在里面） */
  const [advTick, setAdvTick] = useState(0)
  /* ★ 2026-10-20：任务卡「📎 资料」→ 切到「资料（按位）」tab 并定位那次协作。
     ★ 为什么监听要提到顶层：PackSection 现在只在 pack tab 挂载，
       若监听留在它内部，在「任务」tab 点 📎 时没人接事件 ⇒ 点了没反应。 */
  const [packFocus, setPackFocus] = useState<{ interactionId: string; title?: string | undefined } | null>(null)
  useEffect(() => {
    const onOpen = (ev: Event): void => {
      const d = (ev as CustomEvent<{ interactionId?: string; title?: string }>).detail
      const next = (d?.interactionId || '').trim()
      if (!next) return
      setPackFocus({ interactionId: next, title: d?.title })
      setTab('pack')
    }
    window.addEventListener('kaipu:open-pack', onOpen as EventListener)
    return () => window.removeEventListener('kaipu:open-pack', onOpen as EventListener)
  }, [])

  /* ★ 通知（2026-10-19 阿开）：顶部 Tab 角标，30 秒轮询 */
  const [notif, setNotif] = useState<{ unread: number; items: Array<{ kind: string; taskId: string; title: string; at: string; text: string; unread: boolean; projectId?: string; projectName?: string }> }>({ unread: 0, items: [] })
  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      const r = await loadNotifications()
      if (alive && r.ok) setNotif({ unread: r.data.unread, items: r.data.items })
    }
    void tick()
    const t = window.setInterval(() => { void tick() }, 30000)
    return () => { alive = false; window.clearInterval(t) }
  }, [])
  /* ★ 版本提示（2026-10-19）：插件打开时问一次服务端，有新版就红字提示卸载重装 */
  const [latest, setLatest] = useState<string | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  /* ★★ 2026-10-19 阿开：「有更新会提示吗？现在还是 v0.2.5」
     根因：`checkPluginVersion` 内部要求 `connection !== null`，
           但这里写的是 `useEffect(..., [])` —— **只在挂载那一刻跑一次**。
           挂载时还没登录，`connection` 是 null ⇒ 拿到 `no_channel` ⇒ 永不重试。
     ★ 教训：**依赖"登录态"的东西，不能挂在"只跑一次"的 effect 上**。
       判据：这个函数会不会因为「外部还没就绪」而返回假失败？会 ⇒ 必须能重试。 */
  const [verChecked, setVerChecked] = useState(false)
  useEffect(() => {
    if (verChecked || snap === null) return   // 没连上之前不查；查过一次就不再打扰
    void (async () => {
      const r = await checkPluginVersion(PLUGIN_VERSION)
      if (!r.ok) return                      // 通道偶断：保持未查状态，下次 snap 变化再试
      setVerChecked(true)
      if (r.data.updateAvailable) {
        setLatest(r.data.latest)
        setUpdateAvailable(true)
      }
    })()
  }, [snap, verChecked])
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
      style={{
        padding: 16,
        overflowWrap: 'break-word',
        color: C.text,
        /* ★ 面板必须自己滚动（2026-10-19 真机反馈「页面显示不全、无法下拉」）：
           宿主给的是固定高度容器，不自己开滚动 ⇒ 超出的部分既看不见也滚不到。
           `height:100%` + `minHeight:0` 是 flex 子项能收缩的前提，缺了它 overflow 不生效。 */
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Tab 头 ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
        {tab !== 'tasks' && tab !== 'pack' && tab !== 'work' && tab !== 'more' ? (
          <button
            type="button"
            onClick={() => setTab('more')}
            style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: FS.small }}
          >
            ←
          </button>
        ) : null}
        {([['tasks', '任务'], ['pack', '资料'], ['work', '工位'], ['more', '⋯']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: FS.small,
              fontWeight: tab === k ? 700 : 400,
              color: tab === k ? '#fff' : C.dim,
              background: tab === k ? C.accent : 'transparent',
            }}
          >
            {label}
            {/* ★ 2026-10-22：通知不再占 tab ⇒ 角标移到「⋯」上（有未读才出现） */}
            {k === 'more' && notif.unread > 0 ? (
              <span style={{
                marginLeft: 5, padding: '0 5px', borderRadius: 9, fontSize: FS.tag,
                background: '#c0392b', color: '#fff', fontWeight: 700,
              }}>{notif.unread}</span>
            ) : null}
          </button>
        ))}
        {/* ★ 2026-10-19 阿开：顶部显示当前版本，有新版提示卸载重装
            ★ 说清「推」的真相：插件没有长连接，是**打开时来问**，不是服务端主动推。 */}
        <span style={{ marginLeft: 'auto', fontSize: FS.tag, color: updateAvailable ? '#c0392b' : C.dim, whiteSpace: 'nowrap' }}>
          v{PLUGIN_VERSION}
          {updateAvailable && latest !== null ? ` → v${latest} 有更新，请卸载重装` : ''}
        </span>
      </div>

      {tab === 'more' ? (
        <Section title="更多">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: FS.small }}>
            {/* ★ 2026-10-21 阿开：「原来是按钮，但样式看不出能点，像输入框」⇒ 改卡片式：
                整块可点、左标题右箭头、下面一行说清「点进去是什么」。 */}
            <button
              type="button"
              onClick={() => setTab('notif')}
              style={{
                ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, cursor: 'pointer', textAlign: 'left', width: '100%',
                fontFamily: 'inherit', fontSize: FS.small, padding: '11px 13px',
              }}
            >
              <span>
                <b style={{ display: 'block', marginBottom: 2 }}>通知</b>
                <span style={{ color: C.dim, fontSize: FS.tag }}>
                  {notif.unread > 0 ? `${notif.unread} 条新的 —— 谁交了、谁被驳了` : '有人交件、被驳回时在这里'}
                </span>
              </span>
              <span style={{ color: C.dim, fontSize: 18, lineHeight: 1 }}>›</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('help')}
              style={{
                ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, cursor: 'pointer', textAlign: 'left', width: '100%',
                fontFamily: 'inherit', fontSize: FS.small, padding: '11px 13px',
              }}
            >
              <span>
                <b style={{ display: 'block', marginBottom: 2 }}>接入说明</b>
                <span style={{ color: C.dim, fontSize: FS.tag }}>给要调接口的人看（CLI / MCP / HTTP）</span>
              </span>
              <span style={{ color: C.dim, fontSize: 18, lineHeight: 1 }}>›</span>
            </button>
            <div style={{ color: C.dim, lineHeight: 1.7, paddingTop: 4 }}>
              设备与权限：<b>资料</b> 页（或工位页右上「🔑 设备」）—— 设备台账 / 给新设备开门
            </div>
            {/* ★ 2026-10-21：把版本号摆出来 —— 以后「你装的是不是新版」不用猜 */}
            <div style={{ textAlign: 'center', fontSize: FS.tag, color: C.dim, opacity: 0.6, paddingTop: 6 }}>
              工位插件 v{PLUGIN_VERSION}
            </div>
          </div>
        </Section>
      ) : tab === 'notif' ? (
        <Section title="通知">
          {notif.items.length === 0 ? (
            <div style={{ fontSize: FS.small, opacity: 0.7 }}>没有待处理的事。</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* ★ 2026-10-21 阿开：「通知应该按项目分类，别人就方便知道哪个项目来的」 */}
              {(() => {
                const groups = new Map<string, { name: string; items: typeof notif.items }>()
                for (const it of notif.items) {
                  const key = it.projectId && it.projectId.length > 0 ? it.projectId : '__none__'
                  const name = it.projectId && it.projectId.length > 0 ? (it.projectName || it.projectId) : '未归类'
                  const g = groups.get(key)
                  if (g === undefined) groups.set(key, { name, items: [it] })
                  else g.items.push(it)
                }
                return [...groups.entries()].map(([key, g]) => (
                  <div key={key}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: FS.tag, fontWeight: 600 }}>{g.name}</span>
                      <span style={{ fontSize: FS.tag, color: C.dim }}>{g.items.length}</span>
                      {g.items.some((x) => x.unread) ? (
                        <span style={{ fontSize: FS.tag, color: '#c0392b' }}>
                          {g.items.filter((x) => x.unread).length} 条新的
                        </span>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {g.items.map((it) => (
                        <div key={`${it.kind}:${it.taskId}`} style={{
                          padding: '7px 9px', borderRadius: 5, fontSize: FS.small,
                          background: it.unread ? 'rgba(192,57,43,.07)' : 'rgba(0,0,0,.03)',
                          borderLeft: it.unread ? '3px solid #c0392b' : '3px solid transparent',
                        }}>
                          <div style={{ fontWeight: it.unread ? 600 : 400 }}>{it.text}</div>
                          <div style={{ opacity: 0.6, marginTop: 2 }}>{it.at.replace('T', ' ').replace('Z', '')}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              })()}
              <button type="button" onClick={() => { void (async () => {
                await markNotificationsRead()
                const r = await loadNotifications()
                if (r.ok) setNotif({ unread: r.data.unread, items: r.data.items })
              })() }} style={{ ...btnStyle(false), alignSelf: 'flex-start', fontSize: FS.small }}>
                全部标为已读
              </button>
            </div>
          )}
        </Section>
      ) : tab === 'help' ? (
        <HelpTab />
      ) : tab === 'tasks' ? (
        <TaskSection />
      ) : tab === 'pack' ? (
        <PackSection onUpload={() => setTab('upload')} focus={packFocus} advTick={advTick} />
      ) : tab === 'upload' ? (
        <UploadTab onDone={() => setTab('pack')} />
      ) : (
        <>
          {/* ★ 2026-10-19 阿开：「本地持久化态/来源 scaffold/座位 5 位…是什么意思，有必要留着吗」
               —— 那些是期1 开发期的诚实标注，读的是 scaffold 演示数据（发起人位/协作方甲乙丙）。
                  现在真工位、真任务、真资料三条链都通了，留着只会让人以为是系统状态 ⇒ 整块撤下。
                  面板只留能真改的三块：工位 / 任务 / 资料。 */}
          <OrgSection onGoDevices={() => { setTab('pack'); setAdvTick((t) => t + 1) }} />
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
   ★ 使用说明页（阿开 2026-10-19）

   为什么要「一键复制给 Agent」：
     接入一个 Agent，光靠人在聊天里口述四个端点和签名式，必错。
     ⇒ 面板直接产出一份**可粘贴的接入说明**，对方 Agent 照着就能干活。

   ★ 为什么这个按钮放说明页、不放主页：
     主页是干活的地方（工位/任务/资料），主页每多一个按钮就多一次误触。
     而「把说明发给别人」是低频但**必须准确**的动作 —— 放说明页，找得到、不会挡路。
   ══════════════════════════════════════════════════════════════════ */

const GUIDE_JOINEE = `# 山海工位 · 被邀请方接入说明

你在一个铺子的工位上有座位了。下面是接口 + 协作默契。
**接口只要照着做；默契比接口重要 —— 做对了接口但不懂默契，会让人不敢把活交给你。**

## 一、先记住三样东西
- baseUrl   ：https://agent.ak2029.com/kai-pu     ★ 必须带 /kai-pu
- accountId ：铺子编号
- agentId   ：你的编号
- secret    ：你的密钥（**只显示一次**，自己保存，任何时候不要外发）

### ★ 调接口前先做这一步（30 秒）

    curl -s https://agent.ak2029.com/kai-pu/health
    → {"status": "ok", "service": "shanhai-kai-pu"}      ✅ base 对了

    curl -s https://agent.ak2029.com/health
    → {"status":"healthy","service":"agent-api",...}      ❌ 少了 /kai-pu（这是另一个服务）

**坑**：漏写「/kai-pu」时，「/health」也回 **200**，「/me」「/devices」还会回**一个 HTML 网页**（也是 200）
⇒ 只看状态码会以为通了，然后解析 JSON 失败。
**另**：「curl -I」（HEAD）会被 Nginx 回 **403**（只放 GET）；判活请用
curl -s -o /dev/null -w 「%{http_code}」 <url>。

## 二、你不用记地址

**铺主给你的邀请链接，就是你的工作台。** 收藏它就行 ——
打开就能看任务、传文件、交活，不用另记地址，也不用装任何东西。

---

## 三、协作默契（先看这段）
1. **领到任务先复述**：「我理解要做的是 X，交付物是 Y，对吗？」
   —— 别闷头做三天，做出来不是人家要的。
2. **做完先问，别直接传**：「资料要传到工位吗？放哪个交互？」
   —— 人类可能还要改，你抢先传上去，他反而要清理。
3. **传之前确认三件事**：交互 ID、座位、文件名。
   —— 传错目录比没传更麻烦，别人找不到。
4. **不可逆的事先问**：删除、发布上线、改生产数据 —— 一律先问，不要自己决定。
5. **拿不准就停在「问」，不要停在「猜」。**

## 三、签名（每个请求都要）
sig = HMAC-SHA256(secret, 报文) 的小写 hex，ts 是秒级时间戳（容差 ±300 秒）

- 领活 / 交结论：msg = f"{agentId}{ts}"          （直接拼接，无分隔符）
- 上传资料：      msg = f"{agentId}|{ts}|{accountId}|{filename}|{sha256hex}"

## 四、领活（拉模式，能出网就行，不需要公网地址）
POST {baseUrl}/agent/poll
{ "agentId":"...", "accountId":"...", "ts":1234567890, "sig":"..." }
→ { "task": { "taskId":"...", "lamp":"...", "payload":{...} } }   或   { "task": null }

## 五、交结论
POST {baseUrl}/agent/result
{ "agentId":"...", "accountId":"...", "ts":..., "sig":"...",
  "taskId":"...", "result": { "verdict":"done", "detail":"..." } }

## 六、上传资料（一个交互一个目录）
POST {baseUrl}/packs/{interactionId}/files
Headers:
  X-Agent-Id     {agentId}
  X-Account-Id   {accountId}
  X-Ts           {ts}
  X-Filename     {URL 编码后的文件名}
  X-Body-Sha256  {文件字节的 sha256 hex}
  X-Sig          {按第三节算}
Body: 文件原始字节（不是 base64）

## 七、你不能做什么
- 不能改铺子设置、不能审批、不能给别人发任务
- 看不到别人的交互目录（只能碰自己有座位的位）

## 八、密钥出事怎么办
立刻告诉铺主，让他作废旧密钥、重新发邀请。**不要自己尝试修复。**`;

const GUIDE_OWNER = `# 山海工位 · 管理方接入说明

你是铺主的 Agent（或铺主本人）。你可以发任务、审批、看清全局。
边界：**人类做董事长，把握底线；你做部门经理，安排日常。**

## 零、baseUrl（先确认这个，再谈接口）

**https://agent.ak2029.com/kai-pu** —— 必须带「/kai-pu」。

- 自检：curl -s {baseUrl}/health → 必须看到 "service": "shanhai-kai-pu"
- 漏写时根域「/health」也回 **200**（那是 agent-api），「/me」「/devices」回 HTML 也 **200** ⇒ 只看状态码会被骗
- 「curl -I」（HEAD）会被 Nginx 回 **403**（只放 GET），判活用 curl -s -o /dev/null -w 「%{http_code}」

## 一、你能做的事
| 能力 | 接口 |
|:--|:--|
| 代组发布任务 | POST /agent/tasks |
| 审批不可逆任务 | POST /tasks/{id}/approve |
| 看全部任务 | GET /tasks?all=1 |
| 领活 / 交结论 / 传资料 | 同被邀请方（/agent/poll · /agent/result · /packs/） |

## 二、发任务（代组发布）
POST {baseUrl}/agent/tasks
{ "accountId":"...", "agentId":"...", "ts":..., "sig":"...",
  "title":"...", "detail":"...", "isDestructive": false }

签名（**和领活不一样，别抄错**）：
    msg = f"{agentId}|{ts}|{title}|{1 if isDestructive else 0}"
    sig = HMAC-SHA256(secret, msg) 的小写 hex

- isDestructive=false ⇒ 直接入池，别人可领
- isDestructive=true  ⇒ 标记不可逆，**必须人类确认（approve）后**才能被领
- 限流：1 分钟 1 条 · 1 小时 10 条（429 = 太快了，等一会儿）
- 标题会自动带 [代组发布] 前缀，created_by 记你的 agentId

## 三、什么时候必须标 isDestructive=true
- 删除任何东西、覆盖已有文件
- 发布上线、改生产配置、动生产库
- 对外发消息、发邮件、公开文件
**判断不清就标 true** —— 多一道确认，比事后道歉便宜。

## 四、审批
POST {baseUrl}/tasks/{taskId}/approve      （铺主 Bearer，不是 Agent 签名）
→ 之后 is_destructive 任务才可被领

## 五、协作默契（同样适用）
1. 发任务前把「交付物是什么」写清楚，别让执行方猜
2. 一次发一条，别把十件事塞进一个 detail
3. 不可逆的事你先标出来，不要让执行方替你承担判断

## 六、签约前先自检
- [ ] 我知道哪些操作不可逆
- [ ] 我发任务时会写清交付物
- [ ] 我不会拿 Agent 凭据去调人类接口（/tasks 用 Bearer，/agent/tasks 用 HMAC）`;



function HelpTab(): ReactElement {
  /* ★ 2026-10-19 阿开：「使用说明是通用的吗？管理方和被邀请方同一份吗？」
     ⇒ 不分。一份说明里混着「发任务（管理方能力）」和「领活传资料（执行方能力）」，
       两边都读了不该自己干的部分 —— 执行方会以为自己能发任务，管理方会以为自己该去领活。
     ⇒ 拆两份，说明页里直接切角色，复制出去的就是对方该看的那份。 */
  const [role, setRole] = useState<'joinee' | 'owner'>('joinee')
  const [copied, setCopied] = useState(false)
  const guide = role === 'joinee' ? GUIDE_JOINEE : GUIDE_OWNER

  const copy = (): void => {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    if (nav?.clipboard?.writeText) {
      void nav.clipboard.writeText(guide).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => undefined)
    }
  }

  const roleBtn = (k: 'joinee' | 'owner', label: string): ReactElement => (
    <button
      type="button"
      onClick={() => { setRole(k); setCopied(false) }}
      style={{
        padding: '4px 12px',
        borderRadius: 6,
        border: `1px solid ${role === k ? C.accent : C.border}`,
        background: role === k ? C.accent : 'transparent',
        color: role === k ? '#fff' : C.dim,
        fontSize: FS.small,
        cursor: 'pointer',
        fontWeight: role === k ? 600 : 400,
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      {/* 角色切换 + 复制 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {roleBtn('joinee', '给被邀请方 Agent')}
        {roleBtn('owner', '给管理方 Agent')}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={copy}
          style={{ ...btnStyle(true), background: copied ? '#1f7a3d' : C.accent, minWidth: 130, transition: 'background 160ms' }}
        >
          {copied ? '✓ 已复制' : role === 'joinee' ? '复制给被邀请方' : '复制给管理方'}
        </button>
      </div>

      <div style={{ fontSize: FS.small, color: C.dim, marginBottom: 8, lineHeight: LH.normal }}>
        {role === 'joinee'
          ? '被邀请方：领活、交结论、传资料。第一段是「协作默契」—— 比接口重要。'
          : '管理方：发任务、审批、看全局。注意发任务的签名式和领活不一样。'}
      </div>

      {/* 三步上手（只在被邀请方视角出现） */}
      {role === 'joinee' && (
        <div style={{ fontSize: FS.small, marginBottom: 8 }}>
          <strong>三步上手</strong>
          <ol style={{ margin: '6px 0 0 18px', padding: 0, lineHeight: 1.8 }}>
            <li>铺主在「工位」页给某个位置点「邀请」，把链接发给你</li>
            <li>你打开链接、填名字 → 当场拿到 agentId + secret</li>
            <li>读完这份说明（尤其第二节协作默契）再开始领活</li>
          </ol>
        </div>
      )}

      <pre
        style={{
          fontSize: FS.tag,
          lineHeight: 1.55,
          background: 'rgba(127,127,127,0.08)',
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: '10px 12px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 340,
          overflowY: 'auto',
          margin: 0,
        }}
      >
        {guide}
      </pre>
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

/* ══════════════════════════════════════════════════════════════════
   ★ 任务概览条（2026-10-21 阿开：「工位下方增加任务数统计」）
   ══════════════════════════════════════════════════════════════════
   ★ 为什么只统计**状态**、不统计「每个工位几个 Agent / 几张任务」：
     按位计数一旦挂在工位卡片上，就会被当成 KPI 读（谁多谁少），
     而工位是**场地**不是员工。场地只该回答「现在堵在哪」——
     那正是状态分布能回答的。人不是数字。
   ══════════════════════════════════════════════════════════════════ */
function TaskStatsBar(): ReactElement {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  /* ★ 2026-10-21 阿开：「统计按阶段没问题，但没有按项目区分」⇒ 同一份任务再按项目分一次 */
  const [byProj, setByProj] = useState<Array<{ name: string; n: number }> | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await loadTasks(true)
      if (!alive || !r.ok) return
      const m: Record<string, number> = {}
      const pm: Record<string, number> = {}
      for (const t of r.data.tasks) {
        m[t.status] = (m[t.status] ?? 0) + 1
        const k = t.projectId || '__none__'
        pm[k] = (pm[k] ?? 0) + 1
      }
      setCounts(m)
      const pr = await loadProjects()
      if (!alive) return
      if (pr.ok) {
        const nameOf = (id: string): string =>
          id === '__none__' ? '未归类' : (pr.data.projects.find((p) => p.projectId === id)?.name ?? id)
        setByProj(
          Object.entries(pm)
            .map(([k, n]) => ({ name: nameOf(k), n }))
            .sort((a, b) => b.n - a.n),
        )
      }
    })()
    return () => { alive = false }
  }, [])

  if (counts === null) return <></>
  const g = (keys: string[]): number => keys.reduce((n, k) => n + (counts[k] ?? 0), 0)
  const items: Array<{ label: string; n: number; color: string }> = [
    { label: '待领', n: g(['posted', 'open']), color: '#8b95a5' },
    { label: '在手', n: g(['claimed', 'in_progress', 'blocked']), color: C.accent },
    { label: '待审批', n: g(['submitted']), color: '#d97706' },
    { label: '已完成', n: g(['accepted', 'done']), color: '#1a7f37' },
    { label: '其他', n: g(['rejected', 'timeout', 'cancelled']), color: '#c2410c' },
  ]
  const total = items.reduce((n, x) => n + x.n, 0)

  return (
    <div style={{
      ...cardStyle, marginTop: 8, padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <span style={{ fontSize: FS.small, color: C.dim }}>任务</span>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: FS.small }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: it.color, display: 'inline-block' }} />
          <span style={{ color: C.dim }}>{it.label}</span>
          <span style={{ fontWeight: 600, color: it.n > 0 ? C.text : C.dim }}>{it.n}</span>
        </span>
      ))}
      <span style={{ marginLeft: 'auto', fontSize: FS.tag, color: C.dim }}>共 {total} 条</span>
      </div>
      {/* ★ 2026-10-21：第二维 —— 按项目。同一批任务，换个切法看分布 */}
      {byProj !== null && byProj.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
          <span style={{ fontSize: FS.small, color: C.dim }}>按项目</span>
          {byProj.map((x) => (
            <span key={x.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: FS.tag }}>
              <span style={{ color: C.dim, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
              <span style={{ fontWeight: 600, color: C.text }}>{x.n}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function OrgSection(props: { onGoDevices?: () => void }): ReactElement {
  const [tree, setTree] = useState<OrgTreeView | null>(null)
  const [err, setErr] = useState<{ code: string; message: string; source?: 'action' | 'read'; title?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  /** 哪个工位展开了邀请栏（null = 都没展开） */
  const [inviting, setInviting] = useState<string | null>(null)
  /** 动作成功的提示（如「已请出 X」）—— 没有它，成功的动作和没反应长得一样 */
  const [notice, setNotice] = useState<string | null>(null)
  /** 最近一次生成的邀请链接（按 node_id 记） */
  const [madeBy, setMadeBy] = useState<Record<string, { url: string; expiresAt: string }>>({})
  /* ★ 一键清场（阿开 2026-10-19）：项目干完换人，一个个点太容易漏。
     ★ 为什么要二次确认：人一走，凭证立刻失效，是不可逆收尾。
     ★ 为什么清人不移位：工位是组织资产（#1-#5 编号稳定），人是流水的。 */
  const [clearing, setClearing] = useState(false)
  const [clearTxt, setClearTxt] = useState('')

  const refresh = async (): Promise<void> => {
    const r = await loadOrgTree()
    if (r.ok) {
      setTree(r.data)
      /* ★★ 2026-10-19 阿开：「刚才我测试请出没反应」
         根因就在这一行：原来是 `setErr(null)` —— 动作失败（409）刚写进 err，
         紧接着 refresh() 成功又把它清掉 ⇒ 用户什么都看不到 = "没反应"。
         ⇒ 读取成功只清「读失败」，**动作失败要留在屏上等人看见**。 */
      setErr((prev) => (prev !== null && (prev as { source?: string }).source === 'action') ? prev : null)
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
      if (!r.ok) {
        /* ★ 2026-10-19：「服务端返回 400」被显示成「任务读不到」—— 动作失败被读失败冒充。
           ⇒ 标 source:'action'，refresh 成功时也不清它；标题由错误码给人话。 */
        const code = r.code ?? 'error'
        const title = code === 'deliverable_required' ? '这次交付不完整'
          : code === 'deliverable_missing' ? '附件没找到'
          : code === 'deliver_first' ? '这个工位还有没交付的任务'
          : code === 'needs_approval' ? '要铺主确认后才能领'
          : '这个操作没成功'
        setErr({ code, message: r.message ?? '操作失败', source: 'action', title })
      } else setErr(null)
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
          {/* ★ 2026-10-21 阿开：「右边 5 个工位应该改成『已有 3 位 Agent 加入工位』」
              ⇒ 用户关心的是「有几个人在干活」，不是场地有几格。没人时退回工位总数。 */}
          {nodes.length === 0 ? '' : (() => {
            const joined = nodes.reduce(
              (n, node) => n + (node.holders ?? []).filter((h) => (h.agentId ?? '') !== '').length, 0)
            return joined > 0
              ? `已有 ${joined} 位 Agent 加入工位`
              : `10 个位置 · 已建 ${nodes.length} 个 · 还没有成员进来`
          })()}
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
        {props.onGoDevices !== undefined ? (
          <button
            type="button"
            onClick={props.onGoDevices}
            style={btnStyle(false)}
            title="设备台账 / 给新设备开门 —— 换设备、加同事的机器都在这"
          >
            🔑 设备
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setClearing((v) => !v)
            setClearTxt('')
          }}
          disabled={busy}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            border: '1px solid #c0392b',
            background: 'transparent',
            color: '#c0392b',
            fontSize: FS.small,
            cursor: 'pointer',
          }}
          title="让所有 Agent 离场（工位保留，凭证作废）"
        >
          一键清场
        </button>
      </div>

      {/* 清场确认条：必须输入 CLEAR 才放行 */}
      {clearing && (
        <div
          style={{
            border: '1px solid #c0392b',
            borderRadius: 10,
            padding: '10px 12px',
            marginBottom: 10,
            background: 'rgba(192,57,43,0.06)',
            fontSize: FS.small,
            lineHeight: LH.normal,
          }}
        >
          <div style={{ fontWeight: 600, color: '#c0392b', marginBottom: 4 }}>
            清场是收尾动作，不可逆
          </div>
          <div style={{ color: C.dim, marginBottom: 8 }}>
            工位本身会保留（#1-#5 不动），任务和资料也不会删；
            但所有 Agent 会离场，<strong>它们的密钥立刻失效</strong>。留痕会记进变更日志。
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={clearTxt}
              onChange={(e) => setClearTxt(e.target.value)}
              placeholder="输入 CLEAR 确认"
              style={{ flex: '1 1 160px', padding: '5px 7px', fontSize: FS.small, borderRadius: 4, border: '1px solid rgba(0,0,0,.18)' }}
            />
            <button
              type="button"
              disabled={busy || clearTxt.trim().toUpperCase() !== 'CLEAR'}
              onClick={() => {
                setBusy(true)
                void (async () => {
                  const r = await clearAgents()
                  if (!r.ok) setErr({ code: r.code, message: r.message })
                  else {
                    setErr(null)
                    setClearing(false)
                    setClearTxt('')
                  }
                  await refresh()
                  setBusy(false)
                })()
              }}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                border: 'none',
                background: clearTxt.trim().toUpperCase() === 'CLEAR' ? '#c0392b' : 'rgba(0,0,0,.15)',
                color: '#fff',
                fontSize: FS.small,
                cursor: clearTxt.trim().toUpperCase() === 'CLEAR' ? 'pointer' : 'not-allowed',
              }}
            >
              确认清场
            </button>
            <button type="button" onClick={() => { setClearing(false); setClearTxt('') }} style={btnStyle(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* 成功提示：动作做成了，得让人看见，否则「已完成」和「没反应」长得一样 */}
      {notice !== null ? (
        <div style={{
          border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px', marginBottom: 8,
          fontSize: FS.small, color: '#1a7f37', background: 'rgba(26,127,55,0.06)',
          display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <span>✓ {notice}</span>
          <button type="button" onClick={() => setNotice(null)}
            style={{ ...btnStyle(false), marginLeft: 'auto', padding: '0 6px' }}>知道了</button>
        </div>
      ) : null}

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
            <Fragment key={`wrap-${n.node_id}`}>
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
              onInvite={() => setInviting(inviting === n.node_id ? null : n.node_id)}
              onEvict={(seat, agentId) => { void (async () => {
                const r = await evictSeat(seat, agentId)
                if (!r.ok) {
                  /* 失败就别 refresh —— 一刷新就可能把这条错误盖掉 */
                  const title = r.code === 'seat_vacant' ? '这个位置本来就空着'
                    : r.code === 'seat_protected' ? '系统内置位，不能请出'
                    : '请出没成功'
                  setErr({ code: r.code, message: r.message, source: 'action', title })
                  return
                }
                await refresh()
                setNotice(`已请出 ${r.data.evicted.name || r.data.evicted.agentId}，这个位置现在空了`)
              })() }}
              inviteOpen={inviting === n.node_id}
            />
            {inviting === n.node_id && (
              <div style={{ gridColumn: '1 / -1' }}>
                <InviteBar
                  node={n}
                  made={madeBy[n.node_id] ?? null}
                  onMade={(v) => setMadeBy((prev) => ({ ...prev, [n.node_id]: v }))}
                />
              </div>
            )}
            </Fragment>
          ))}
          {Array.from({ length: Math.max(0, 10 - gridNodes.length) }).map((_, i) => (
            <EmptySeat
              key={`empty-${i}`}
              canAdd={i === 0}
              busy={busy}
              onAdd={(name) => { setDraft(name); void (async () => {
                const r = await createOrgNode(name)
                if (!r.ok) setErr({ code: r.code, message: r.message })
                await refresh()
              })() }}
            />
          ))}
        </div>
        {gridNodes.length > 10 ? (
          <div style={{ fontSize: FS.small, color: C.dim, marginTop: 6 }}>
            还有 {gridNodes.length - 10} 个位置未显示（先显示前 10 个）
          </div>
        ) : null}
        <TaskStatsBar />
        </>
      )}

    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   ★ 工位邀请栏（点工位卡片上的「邀请」→ 在该行下方展开，占整行）

   为什么挂在**工位**上而不是抽象的「席位区」：
     用户的心智是「我建了一个位，要请谁来坐」。
     把邀请藏在另一块列表里，等于让他自己去做概念映射。

   ★ lamp 与工位的关系（必须说清）：
     服务端 `POST /invites` 要 `lamp`（哪盏灯），而工位节点（org node）只有
     `node_kind` / `name` / `node_id`。两者**不是同一个概念** ——
     所以这里给出可选的灯，默认 `execution`，不假装它们等价。
   ══════════════════════════════════════════════════════════════════ */

const INVITE_LAMPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'execution', label: '执行位' },
  { value: 'audit', label: '审计位' },
  { value: 'management', label: '管理位' },
  { value: 'signature', label: '签名位' },
  { value: 'strategy', label: '战略位' },
]

function InviteBar(props: { node: OrgNodeView; made: { url: string; expiresAt: string } | null; onMade: (v: { url: string; expiresAt: string }) => void }): ReactElement {
  const { node, made, onMade } = props
  /* ★★ 2026-10-20 阿开：「我邀请 Codex 进审计位，审计位不显示，还是邀请按钮」
     根因：这里默认 `execution` —— 在「审计位」卡片上点邀请，实际发的却是执行位。
     邀请码里的 lamp 才是「这个码会让你坐哪」，所以默认值必须**跟着卡片走**。 */
  const [lamp, setLamp] = useState<string>(() => {
    // ① 节点直连的 seat key 最准（改过名也不影响） ② 退回名字匹配 ③ 最后 execution
    if (node.seatKey && INVITE_LAMPS.some((x) => x.value === node.seatKey)) return node.seatKey
    const hit = INVITE_LAMPS.find((x) => x.label === node.name || node.name.startsWith(x.label))
    return hit ? hit.value : 'execution'
  })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    const r = await callPack<InviteCreated>('inviteCreate', {
      lamp,
      seat: node.name,
      ...(note.length > 0 ? { note } : {}),
      ttlDays: 7,
    })
    setBusy(false)
    if (!r.ok) {
      setErr(`[${r.code}] ${r.message}`)
      return
    }
    onMade({ url: r.data.url ?? r.data.path ?? r.data.code, expiresAt: r.data.expiresAt })
  }

  return (
    <div
      style={{
        border: `1px solid ${C.accent}`,
        borderRadius: 10,
        padding: '10px 12px',
        background: C.soft,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: FS.small, fontWeight: 600 }}>
        邀请人进 {typeof node.seq === 'number' ? `#${node.seq} ` : ''}「{node.name}」
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: FS.small, color: C.dim }}>这盏灯</label>
        <select
          value={lamp}
          onChange={(e) => setLamp(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: FS.small }}
        >
          {INVITE_LAMPS.map((v) => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注（可选，如：请响石做审计）"
          style={{ flex: '1 1 220px', padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: FS.small }}
        />
        <button type="button" onClick={() => void create()} disabled={busy} style={btnStyle(true)}>
          {busy ? '生成中…' : '生成邀请链接'}
        </button>
      </div>

      {err !== null && <div style={{ fontSize: FS.small, color: '#b3261e' }}>{err}</div>}

      {made !== null && (
        <div style={{ fontSize: FS.small }}>
          <div style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'rgba(127,127,127,0.06)', userSelect: 'all' }}>{made.url}</div>
          <div style={{ color: C.dim, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>有效期至 {made.expiresAt} · 一次性</span>
            <button
              type="button"
              onClick={() => {
                const done = (): void => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }
                const nav = typeof navigator !== 'undefined' ? navigator : undefined
                if (nav?.clipboard?.writeText) {
                  void nav.clipboard.writeText(made.url).then(done).catch(() => {
                    // 剪贴板被拒（非 https / 无权限）：退化成「选中它」
                    window.getSelection()?.selectAllChildren(document.body)
                    setErr('剪贴板不可用，请手动选中上面的链接复制')
                  })
                } else {
                  setErr('剪贴板不可用，请手动选中上面的链接复制')
                }
              }}
              style={{
                ...btnStyle(true),
                background: copied ? '#1f7a3d' : C.accent,
                transition: 'background 160ms',
                minWidth: 96,
              }}
            >
              {copied ? '✓ 已复制' : '复制链接'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 项目卡片（任务页顶部一排）—— 比下拉更直观：一眼看到有几个项目、各几个任务 */
function ProjectChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
        fontSize: FS.tag, whiteSpace: 'nowrap', fontFamily: 'inherit',
        border: `1px solid ${active ? '#1f2937' : C.border}`,
        background: active ? '#1f2937' : 'transparent',
        color: active ? '#fff' : C.dim,
      }}
    >
      {children}
    </button>
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
  /** ★ 邀请：点开该工位下方的整行邀请栏 */
  onInvite: () => void
  inviteOpen: boolean
  /** ★ 请出：这个位上的人离场（只清这一个位） */
  onEvict: (seat: string, agentId: string) => void
}

/** 一个「位」= 3 列网格里的一张卡（不缩进、不展开子级 —— 座位表口径） */
function OrgNodeCard(props: OrgNodeCardProps): ReactElement {
  const { node, busy, editing, editName, setEditName } = props
  const isRenaming = editing === node.node_id
  const isDeleting = editing === `del:${node.node_id}`
  const kind = node.node_kind ?? 'role'
  const [hover, setHover] = useState(false)
  /** ★ 有人坐 = 至少一个席位绑在这个工位上（seat_count 由服务端算） */
  const occupied = (node.seat_count ?? 0) > 0
  /** ★ 谁在坐（2026-10-19：之前只显示工位名，看不到人 —— 阿开找不到阿舟/星月） */
  const holders = Array.isArray(node.holders) ? node.holders : []
  /** 请出要二次确认：凭证一作废不可恢复 */
  const [evictArm, setEvictArm] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `${occupied ? '1px solid' : '1px dashed'} ${hover || isRenaming ? C.text : occupied ? C.accent : C.border}`,
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
        {typeof node.seq === 'number' && (
          <span
            title="工位编号（沟通时说这个号）"
            style={{
              flex: '0 0 auto',
              fontSize: 10,
              fontWeight: 700,
              color: C.dim,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              padding: '1px 4px',
              lineHeight: 1.2,
            }}
          >
            #{node.seq}
          </span>
        )}
        <span
          title={occupied ? `在座：${node.seat_count} 个席位` : '待配置'}
          style={{
            flex: '0 0 auto',
            width: 22,
            height: 22,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            color: occupied ? '#fff' : C.faint,
            background: occupied ? C.accent : 'transparent',
            border: occupied ? 'none' : `1px dashed ${C.faint}`,
          }}
        >
          {holders.length > 0 ? (holders[0]?.name || '?').slice(0, 1) : occupied ? (node.name || '?').slice(0, 1) : ''}
        </span>
        {/* ★ 心跳点（2026-10-19 阿开）：绿=90 秒内有心跳，灰=活着但没报 */}
        {holders.length > 0 ? (
          <span
            title={holders[0]?.online === true ? '在线（90 秒内有心跳）' : '离线（没收到心跳）'}
            style={{
              width: 7, height: 7, borderRadius: '50%', marginLeft: -4, marginTop: -10,
              background: holders[0]?.online === true ? '#27ae60' : '#bbb',
              border: '1px solid #fff',
            }}
          />
        ) : null}
        {holders.length > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: FS.tag,
              color: C.accent,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
            title={holders.map((h) => `${h.name}（${h.agentId}）`).join('、')}
          >
            {holders.map((h) => h.name).join('、')}
            {holders.some((h) => h.online === true) ? '' : '（离线）'}
          </span>
        )}
        {/* ★ 2026-10-19 阿开：「名字太长时，系统默认的名称就挤到看不见了，改名也看不见」
            ⇒ 名字永远只占行1并省略号；**改名字段下沉到行2**（与门牌同行）。
            ★ 为什么不在行1换行：行1 是「人」，行2 是「门牌」——
              人再长也不该把门牌挤掉，那是两件事。 */}
        {/* ★ 2026-10-19 阿开：「Agent 自己的名字后面还是跟着管理方、审计方」
            ⇒ 行1 只放**人**；角色下沉到行2 当门牌。有人时不再重复工位名。 */}
        {holders.length === 0 ? (
          <span
            style={{
              fontSize: FS.small, fontWeight: 600, flex: 1, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: C.dim,
            }}
            title={node.name}
          >
            {node.name}
          </span>
        ) : (
          <span style={{ flex: 1 }} />
        )}
      </div>

      {/* 行2 = 门牌：职位标签 + 改名（办公室门牌就在门边，不在人身上） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {/* 门牌：像「财务室 / 总经理办公室」那样贴在门边上 */}
        <span
          style={{
            fontSize: FS.tag,
            color: C.dim,
            padding: '1px 6px',
            borderRadius: 3,
            background: 'rgba(0,0,0,.045)',
            whiteSpace: 'nowrap',
            flex: '0 0 auto',
            maxWidth: 140,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={`${node.name}${kind !== 'live' ? `（数据源：${kind}）` : ''}`}
        >
          {node.name}
        </span>
        {!isRenaming && node.renameable === false ? (
          /* ★ 2026-10-20 阿开：「签名位不能换人吗？如果必须，把改名按钮去掉」
             ⇒ 不给「必然失败/不该做」的按钮，直接把原因写出来。 */
          <span
            title="这个位置由平台席位占用（不可替换），名字不能改"
            style={{ flex: '0 0 auto', fontSize: FS.tag, color: C.faint, whiteSpace: 'nowrap' }}
          >
            平台位 · 不可改名
          </span>
        ) : null}
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
              padding: '2px 6px',
              borderRadius: 4,
              border: `1px solid ${C.border}`,
              background: 'transparent',
              color: C.text,
              fontSize: FS.tag,
              outline: 'none',
            }}
          />
        ) : node.renameable === false ? null : (
          <button
            type="button"
            onClick={() => props.onStartRename(node)}
            disabled={busy}
            style={{
              flex: '0 0 auto', fontSize: FS.tag, padding: '1px 6px',
              borderRadius: 3, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.faint, cursor: 'pointer',
            }}
            title="改这个工位的名字"
          >
            改名
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 'auto', alignItems: 'center' }}>
        {isRenaming ? (
          <button type="button" onClick={() => props.onRename(node.node_id)} disabled={busy} style={btnStyle(true)}>
            存
          </button>
        ) : (
          <>
            {/* ★ 2026-10-19：改名的入口只在行2（门牌旁），这里不再重复 ——
                同一个动作两个按钮，用户会以为它们不一样。 */}
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
            ) : null}

            {/* ★ 2026-10-19 阿开：「有 Agent 之后邀请按钮是不是应该换成请出？」
                ⇒ 是。一个位坐一个人时，「邀请」没有意义（会把第二个人塞进来）。
                  有的位移交：有人坐显示「请出」，空位显示「邀请」。
                  ★ 请出只清这一个位 —— 换人 ≠ 收项目，别的位不该受影响。 */}
            {holders.length > 0 ? (
              evictArm ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setEvictArm(false); props.onEvict(holders[0]?.seat ?? '', holders[0]?.agentId ?? '') }}
                    disabled={busy}
                    style={{ ...btnStyle(false), background: '#c0392b', color: '#fff', border: 'none' }}
                    title="确认后他的密钥立刻作废"
                  >
                    确认请出
                  </button>
                  <button type="button" onClick={() => setEvictArm(false)} disabled={busy} style={btnStyle(false)}>
                    取消
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setEvictArm(true)}
                  disabled={busy}
                  title={`请出 ${holders.map((h) => h.name).join('、')}（凭证会作废，工位保留）`}
                  style={{ ...btnStyle(false), border: '1px solid #c0392b', color: '#c0392b' }}
                >
                  请出
                </button>
              )
            ) : (
              <button type="button" onClick={props.onInvite} disabled={busy} style={btnStyle(props.inviteOpen)}>
                {props.inviteOpen ? '收起' : '邀请'}
              </button>
            )}

            {node.undeletable ? null : (
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
/* ★ 2026-10-19 阿开：「把添加工位的按钮直接搬到空位卡片上，更方便，还少一处栏目」
   ⇒ 空位卡本身就是入口：平时显示「+ 添加工位」，点一下原地变输入框。
   只在**第一张**空位卡上挂入口，其余保持纯空位——否则一排全是加号，反而不知道该点哪个。 */
function EmptySeat(props: {
  canAdd?: boolean
  busy?: boolean
  onAdd?: (name: string) => void
}): ReactElement {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const canAdd = props.canAdd === true

  const submit = (): void => {
    const v = name.trim()
    if (v.length === 0 || props.busy === true) return
    props.onAdd?.(v)
    setName('')
    setAdding(false)
  }

  if (canAdd && adding) {
    return (
      <div
        style={{
          border: `1px solid ${C.accent}`,
          borderRadius: 10,
          padding: '8px 10px',
          minHeight: 78,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') {
              setAdding(false)
              setName('')
            }
          }}
          placeholder="新工位名字，如「前端位」"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '5px 7px',
            borderRadius: 4,
            border: `1px solid ${C.border}`,
            background: 'transparent',
            color: C.text,
            fontSize: FS.small,
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={submit} disabled={name.trim().length === 0 || props.busy === true} style={{ ...btnStyle(true), padding: '3px 10px', fontSize: FS.tag }}>
            创建
          </button>
          <button type="button" onClick={() => { setAdding(false); setName('') }} style={{ ...btnStyle(false), padding: '3px 10px', fontSize: FS.tag }}>
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={() => { if (canAdd) setAdding(true) }}
      title={canAdd ? '点一下添加工位' : undefined}
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
        cursor: canAdd ? 'pointer' : 'default',
      }}
    >
      {canAdd ? '+ 添加工位' : '空位'}
    </div>
  )
}


/* ══════════════════════════════════════════════════════════════════
   期5 · 任务（九态 · 发布 / 领取 / 完成 / 求助 / 审批）
   ★ 2026-10-19：界面不再要求点「开始」——claimed 可直接交付（服务端允许）。
   ══════════════════════════════════════════════════════════════════
   ★ 状态机由服务端把守：posted → claimed → in_progress → submitted → accepted
     （另有 blocked / rejected / timeout / cancelled）。
   ★ 前端**不推断下一步**：按钮只按「服务端返回的当前状态」渲染，点下去是否合规由服务端判
     （409 invalid_transition / 403 not_approver / 404 一律原样上屏）。
   ★ 领取是**原子**的：两个人同时点，只有一个成功，另一个看到「已被领走」。
   ★ 这一块的每个按钮都**真会发请求**，不是装饰。
   ══════════════════════════════════════════════════════════════════ */

/** 九态文案（★ 未知状态回落原文 —— 不吞、不假装认识） */
const STATUS_TEXT: Record<string, string> = {
  posted: '待领',
  claimed: '已领',
  in_progress: '进行中',
  blocked: '求助中',
  submitted: '待审批',
  accepted: '已完成',
  rejected: '已驳回',
  timeout: '已超时',
  cancelled: '已取消',
  /* ★ 旧值兜底：后端兼容 open→posted、done→accepted，老数据/老服务端仍可能回这两值 */
  open: '待领',
  done: '已完成',
}

/** ★ 2026-10-21 阿开：「任务卡片加一个日期+时间」—— 统一成 `2026-10-21 20:22`（本地时区） */
function fmtWhen(iso?: string | null): string {
  if (iso === undefined || iso === null || iso === '') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ')
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * ★ 2026-10-21 评估结论：**不是一个时间打天下**。
 *   待领看「什么时候发的」，完成看「什么时候做完的」—— 同一个「发布时间」在已完成卡片上
 *   回答不了用户真正的问题。所以按状态取对应时间戳：
 *     待领 → 发布（created_at）· 已领/进行中 → 领取（claimed_at）
 *     待审批/已完成/已驳回 → 交付（done_at）· 其余 → 发布
 */
function taskWhen(
  t: { created_at?: string; claimed_at?: string | null; done_at?: string | null },
  st: string,
): { label: string; at: string } | null {
  if (st === 'posted') return t.created_at ? { label: '发布', at: t.created_at } : null
  if (st === 'claimed' || st === 'in_progress' || st === 'blocked') {
    return { label: '领取', at: t.claimed_at ?? t.created_at ?? '' }
  }
  if (st === 'submitted' || st === 'accepted' || st === 'rejected') {
    return { label: '完成', at: t.done_at ?? t.claimed_at ?? t.created_at ?? '' }
  }
  return t.created_at ? { label: '发布', at: t.created_at } : null
}

function statusText(status: string): string {
  return STATUS_TEXT[status] ?? status
}

/** 旧值归一到九态 —— 只做**词汇统一**，不推断任何流转 */
function normStatus(status: string): string {
  if (status === 'open') return 'posted'
  if (status === 'done') return 'accepted'
  return status
}

/* ★ 2026-10-21 第二批（阿开定）：任务页四段分组 —— 打开第一眼只看到「要我干什么」。
   验收：打开到点「领取」≤ 2 次点击（默认展开第一段，卡片上直接有「领取」= 1 次）。 */
const TASK_SECTIONS = [
  {
    key: 'todo',
    title: '待我处理',
    match: (t: TaskUi, _myId: string | null) => ['posted', 'rejected'].includes(normStatus(t.status)),
    empty: '没有要你处理的。有新任务时，卡片上直接有「领取」，一点就开工。',
    openByDefault: true,
  },
  {
    key: 'doing',
    title: '我在做',
    match: (t: TaskUi, myId: string | null) =>
      ['claimed', 'in_progress', 'blocked'].includes(normStatus(t.status)) &&
      (myId === null || t.claimed_by === myId),
    empty: '手上没有在做的任务。',
    openByDefault: false,
  },
  {
    key: 'review',
    title: '已交待审',
    match: (t: TaskUi, _myId: string | null) => normStatus(t.status) === 'submitted',
    empty: '没有等审的交付。交了件会自动出现在这里。',
    openByDefault: false,
  },
  {
    key: 'done',
    title: '已完成',
    match: (t: TaskUi, _myId: string | null) =>
      ['accepted', 'cancelled', 'timeout'].includes(normStatus(t.status)),
    empty: '还没有完成的。',
    openByDefault: false,
  },
] as const

/** 状态色：沿用本文件既有色值（LAMP_COLOR / C），不引入新主题 */
function statusTone(status: string): string {
  switch (normStatus(status)) {
    case 'posted':
      return C.text
    case 'claimed':
    case 'in_progress':
      return LAMP_COLOR.amber
    case 'blocked':
    case 'rejected':
    case 'timeout':
      return LAMP_COLOR.red
    case 'submitted':
      return LAMP_COLOR.blue
    case 'accepted':
      return LAMP_COLOR.green
    default:
      return C.dim
  }
}

/** 租约心跳周期（服务端租约 30min；60s 续一次 ⇒ 偶发断一轮也不会立刻掉回 posted） */
const HEARTBEAT_MS = 60_000

/**
 * 面板侧任务视图：`status` 放开成 `string`。
 * ★ 为什么不用 `TaskItem` 的 `status` 联合：`live.ts` 里那份声明仍是旧的四态壳，
 *   而服务端本期返回九态。这里**只放宽类型**，值一律以服务端返回为真值。
 */
type TaskUi = Omit<TaskItem, 'status'> & { status: string; approvers?: unknown }

function toTaskUi(t: TaskItem): TaskUi {
  return { ...t, status: t.status as string }
}

/* ── 服务端回体的宽容解析（`tasksBlocked` / `tasksPendingApprovals` 外层形状未在契约明定） ── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 认行数组：顶层数组，或常见包装键；**认不出来返回 null**（不静默当成 0 条） */
function rowsOf(payload: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return null
  for (const key of ['tasks', 'blocked', 'items', 'approvals', 'pending', 'rows', 'list', 'data']) {
    const got = payload[key]
    if (Array.isArray(got)) return got.filter(isRecord)
  }
  return null
}

function rowId(row: Record<string, unknown>): string {
  return str(row.task_id) || str(row.id)
}

function rowTitle(row: Record<string, unknown>): string {
  return str(row.title) || rowId(row) || '（无标题）'
}

/** `blocked_reason` 契约是 `{kind, reason}`；更早的形态可能是裸字符串 ⇒ 两种都认 */
function rowReason(row: Record<string, unknown>): string {
  const br = row.blocked_reason
  if (typeof br === 'string' && br.length > 0) return br
  if (isRecord(br)) {
    const reason = str(br.reason)
    if (reason.length > 0) return reason
    const kind = str(br.kind)
    if (kind.length > 0) return kind
  }
  const alt = str(row.reason)
  return alt.length > 0 ? alt : '（服务端未带原因）'
}

/* ── 面板侧动作调用（bridge `ENDPOINTS` 已声明 · host `@Remote` 已实现 · 本轮只接线） ── */

type ActionOutcome = { ok: boolean; code?: string; message?: string }

/** ★ 2026-10-23（一键挂载）：审计报告的最小形状（失败时只有 error/message） */
interface AuditReportUi {
  verdict?: string
  summary?: string
  precheck?: {
    counts?: Record<string, number>
    findings?: Array<{ code?: string; level?: string; detail?: string }>
  }
  review?: {
    scene?: string
    aborted?: boolean
    lights?: Record<string, string>
    error?: string
  }
  error?: string
  message?: string
}

async function callAction(method: EndpointName, query: Record<string, unknown>): Promise<ActionOutcome> {
  const conn = panelConn
  if (conn === null) {
    return { ok: false, code: 'no_channel', message: '没有数据通道 —— 工位 host 未加载。' }
  }
  const r = await callKaipu<unknown>(conn, method, query)
  if (r.ok === true) return { ok: true }
  if ('business' in r) return { ok: false, code: r.business.code, message: r.business.message }
  return { ok: false, code: r.error.code, message: r.error.detail }
}

/** 同 `callAction`，但要拿回 `data`（审计要 id / 报告） */
async function callActionData<T>(
  method: EndpointName,
  query: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; code?: string; message?: string }> {
  const conn = panelConn
  if (conn === null) return { ok: false, code: 'no_channel', message: '没有数据通道 —— 工位 host 未加载。' }
  const r = await callKaipu<T>(conn, method, query)
  if (r.ok === true) return { ok: true, data: r.data }
  if ('business' in r) return { ok: false, code: r.business.code, message: r.business.message }
  return { ok: false, code: r.error.code, message: r.error.detail }
}

const startTask = (taskId: string): Promise<ActionOutcome> => callAction('tasksStart', { taskId })

const blockTask = (taskId: string, reason: string): Promise<ActionOutcome> =>
  callAction('tasksBlock', { taskId, reason })

const unblockTask = (taskId: string): Promise<ActionOutcome> => callAction('tasksUnblock', { taskId })

const heartbeatTask = (taskId: string): Promise<ActionOutcome> => callAction('tasksHeartbeat', { taskId })

/** 审批 / 驳回：`approverId` 必须是**本人**（服务端另有 403 not_approver 把关） */
const approveTask = (taskId: string, approverId: string, comment: string): Promise<ActionOutcome> =>
  comment.length > 0
    ? callAction('tasksApprove', { taskId, approverId, comment })
    : callAction('tasksApprove', { taskId, approverId })

const rejectTask = (taskId: string, approverId: string, comment: string): Promise<ActionOutcome> =>
  comment.length > 0
    ? callAction('tasksReject', { taskId, approverId, comment })
    : callAction('tasksReject', { taskId, approverId })

/**
 * 本人 `accountId`。
 * ★ 身份在 host 侧由 `KaipuHttpClient.identify()` 换来（`GET /tenant/me`），**token 不出 host**；
 *   client 这半边只能走 `whoami` 端点取 `{accountId}` —— 不 import host 私有类
 *   （那会把 Node 侧依赖拖进浏览器 bundle）。
 * ★ 取不到返回 null ⇒ 心跳不发（宁可不续，也不拿错身份去续别人的租约）。
 */
async function fetchMyAccountId(): Promise<string | null> {
  const conn = panelConn
  if (conn === null) return null
  const r = await callKaipu<{ accountId?: string }>(conn, 'whoami', {})
  if (r.ok !== true) return null
  const id = typeof r.data?.accountId === 'string' ? r.data.accountId : ''
  return id.length > 0 ? id : null
}

/** 求助列表 / 待审批列表：三态（还没拉 / 拿到 / 读不到）—— 读不到不假装「0 条」 */
type Flagged =
  | { kind: 'pending' }
  | { kind: 'ok'; rows: Record<string, unknown>[] }
  | { kind: 'err'; code: string; message: string }

async function fetchFlagged(method: EndpointName): Promise<Flagged> {
  const conn = panelConn
  if (conn === null) {
    return { kind: 'err', code: 'no_channel', message: '没有数据通道 —— 工位 host 未加载。' }
  }
  const r = await callKaipu<unknown>(conn, method, {})
  if (r.ok === true) {
    const rows = rowsOf(r.data)
    if (rows === null) {
      return {
        kind: 'err',
        code: 'unknown_shape',
        message: '服务端回体的形状认不出来（既不是数组，也没有 tasks/blocked/items 键）。',
      }
    }
    return { kind: 'ok', rows }
  }
  if ('business' in r) return { kind: 'err', code: r.business.code, message: r.business.message }
  return { kind: 'err', code: r.error.code, message: r.error.detail }
}

/** 能否显示审批按钮：`approvers` 拿不到就都显示（点了服务端会拒，不假装有权限） */
function canApprove(task: TaskUi, myId: string | null): boolean {
  const list = task.approvers
  if (!Array.isArray(list) || list.length === 0) return true
  if (myId === null) return false
  return list.some((a) => {
    if (typeof a === 'string') return a === myId
    if (!isRecord(a)) return false
    return str(a.account_id) === myId || str(a.accountId) === myId || str(a.id) === myId
  })
}

/* ══════════════════════════════════════════════════════════════════
   ★ 期6a-2 · 资料按位（packs 5 端点接线）

   为什么单独一个区块而不是塞进任务卡片：
     资料是**按位**存的（`<account>/<seat>/<interactionId>/`），
     一个交互可能横跨多个位（铺主 management 位、执行位、审核位），
     塞进任务卡会把「位」这个概念藏掉，用户就分不清「这是谁的件」。

   ★ 三个诚实点：
     ① 上传走 base64 过 wire（`@Remote` 是 JSON），单件设 8 MB 上限，
        超限**明确告诉用户**「大件请走 CLI」，而不是悄悄截断；
     ② 下载失败不假装成功（服务端 404/500 会把 code 显示出来）；
     ③ 流水 `ok=false` 时把 `brokenAtSeq` 指出来 —— 这是我们对外承诺的核心。
   ══════════════════════════════════════════════════════════════════ */

type PackOutcome<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

async function callPack<T>(method: EndpointName, query: Record<string, unknown>): Promise<PackOutcome<T>> {
  const conn = panelConn
  if (conn === null) {
    return { ok: false, code: 'no_channel', message: '没有数据通道 —— 工位 host 未加载。' }
  }
  const r = await callKaipu<T>(conn, method, query)
  if (r.ok === true) return { ok: true, data: r.data }
  if ('business' in r) return { ok: false, code: r.business.code, message: r.business.message }
  return { ok: false, code: r.error.code, message: r.error.detail }
}

/** 单件上限：base64 过 wire 会膨胀 ≈1.4 倍，8 MB 原文件在内存上可接受 */
const PACK_MAX_BYTES = 8 * 1024 * 1024

function fmtBytes(n: unknown): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / (1024 * 1024)).toFixed(1)} MB`
}

/** 文件 → base64（去掉 data URL 前缀） */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = typeof reader.result === 'string' ? reader.result : ''
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** base64 → 触发浏览器下载 */
function triggerDownload(base64: string, filename: string, contentType: string): void {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: contentType || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/* ══════════════════════════════════════════════════════════════════
   ★ 座位与邀请（真实席位）

   为什么单独一个区块：
     下面那个 `SeatSection` 读的是 `scaffold`（演示态：发起人位/协作方甲乙丙），
     它只能**看**，不能安排人。真机上反馈「座位邀请无法用、无法安排协作」，
     根因就是**真实席位从未接进面板**（`GET /roles/seats` 零调用）。

   本区块接两条真端点：
     · `GET  /roles/seats` —— 本铺实际席位（未开铺 ⇒ 空，且**不回落模板**）
     · `POST /invites`      —— 生成邀请（码一次性、带有效期）

   ★ 邀请链接必须**当场给出来并能复制**：不给链接等于没邀请。
   ══════════════════════════════════════════════════════════════════ */

function RolesSeatSection(): ReactElement {
  const [seats, setSeats] = useState<RolesSeat[] | null>(null)
  const [err, setErr] = useState<{ code: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /** 正在为哪个位邀请（null = 没有展开的邀请面板） */
  const [inviting, setInviting] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [made, setMade] = useState<{ seat: string; url: string; expiresAt: string } | null>(null)

  const refresh = async (): Promise<void> => {
    const r = await callPack<RolesSeatsPayload>('rolesSeats', {})
    if (r.ok) {
      setSeats(Array.isArray(r.data.seats) ? r.data.seats : [])
      setErr(null)
    } else {
      setErr({ code: r.code, message: r.message })
      setSeats(null)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const onCreate = async (seat: string): Promise<void> => {
    setBusy(true)
    setErr(null)
    setMade(null)
    // ★ lamp 与 seat 同一套命名（audit / execution / management …）；
    //   若某天两者分叉，这里要改成从席位定义里取 lamp，而不是拿 seat 顶。
    const r = await callPack<InviteCreated>('inviteCreate', {
      lamp: seat,
      seat,
      ...(note.length > 0 ? { note } : {}),
      ttlDays: 7,
    })
    setBusy(false)
    if (!r.ok) {
      setErr({ code: r.code, message: r.message })
      return
    }
    setMade({
      seat,
      url: r.data.url ?? r.data.path ?? r.data.code,
      expiresAt: r.data.expiresAt,
    })
    setInviting(null)
    setNote('')
  }

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* 剪贴板不可用：链接本身已显示，用户可手选 */
    }
  }

  return (
    <Section title="座位与邀请（真实席位）">
      {err !== null && (
        <div style={{ fontSize: FS.small, color: '#b3261e', marginBottom: 6 }}>
          [{err.code}] {err.message}
        </div>
      )}

      {seats === null ? (
        <div style={{ fontSize: FS.small, color: 'rgba(0,0,0,.55)' }}>读取席位中…</div>
      ) : seats.length === 0 ? (
        <div style={{ fontSize: FS.small, color: 'rgba(0,0,0,.55)' }}>
          本铺还没有配置席位（未开铺时系统不替你预设席位 —— 这是刻意的）。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {seats.map((s) => {
            const holderName = s.holder?.name ?? ''
            const occupied = holderName.length > 0
            return (
              <div
                key={s.seat}
                style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: FS.small }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{s.label || s.seat}</span>
                  <span style={{ color: C.dim }}>{occupied ? holderName : '待配置'}</span>
                  <button
                    type="button"
                    onClick={() => setInviting(inviting === s.seat ? null : s.seat)}
                    disabled={busy}
                    style={btnStyle(false)}
                  >
                    {inviting === s.seat ? '收起' : '邀请'}
                  </button>
                </div>

                {inviting === s.seat && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="备注（可选，如：请响石做审计）"
                      style={{ flex: '1 1 200px', padding: '4px 6px', fontSize: FS.small, borderRadius: 4, border: '1px solid rgba(0,0,0,.18)' }}
                    />
                    <button type="button" onClick={() => void onCreate(s.seat)} disabled={busy} style={btnStyle(true)}>
                      {busy ? '生成中…' : '生成邀请链接'}
                    </button>
                  </div>
                )}

                {made !== null && made.seat === s.seat && (
                  <div style={{ marginTop: 6, fontSize: FS.small }}>
                    <div style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'rgba(127,127,127,0.06)', userSelect: 'all' }}>{made.url}</div>
                    <div style={{ color: C.dim, marginTop: 2 }}>
                      有效期至 {made.expiresAt} · 一次性 · 
                      <button type="button" onClick={() => void copy(made.url)} style={{ ...btnStyle(false), marginLeft: 6 }}>
                        复制链接
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 6, fontSize: FS.tag, color: 'rgba(0,0,0,.5)' }}>
        邀请链接交给对方打开 → 对方填写 Agent 名字 → 当场签发凭据（密钥只显示一次）。
      </div>
    </Section>
  )
}

/** ★ 资料生命周期（2026-10-19 阿开）：打包下载 → 24h 后自动删除 → 可取消
 *
 *  为什么顺序是「先下载再删」而不是「直接删」：
 *    我们承诺「不保留用户资料」，但**不保留 ≠ 让你丢失**。
 *    先给文件，再谈删除；给 24 小时反悔期。
 */
function PackLifecycle({ iid }: { iid: string }): ReactElement | null {
  const [pending, setPending] = useState<boolean>(false)
  const [after, setAfter] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [arm, setArm] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (iid.trim().length === 0) { setPending(false); setAfter(null); return }
    void (async () => {
      const r = await purgeStatus(iid.trim())
      if (r.ok) { setPending(r.data.pending); setAfter(r.data.deleteAfter) }
    })()
  }, [iid])

  if (iid.trim().length === 0) return null

  const doExport = async (): Promise<void> => {
    setBusy(true); setMsg(null)
    const r = await exportPack(iid.trim())
    setBusy(false)
    if (!r.ok) {
      /* ★ 2026-10-21 阿开遇到「下载失败：服务端返回 404」——
         真实原因是**这次协作的资料目录不存在**（交互 ID 是历史留下的 / 从没传过文件），
         不是权限问题。文案要说人话，并给出下一步。 */
      const gone = r.code === 'not_found' || /404/.test(r.message)
      setMsg(gone
        ? `这次协作（${iid.trim()}）没有资料可下载 —— 目录不存在，可能是历史交互 ID 或从没传过文件。换一个交互 ID 试试，或先「＋ 传文件」。`
        : `下载失败：${r.message}`)
      return
    }
    triggerDownload(r.data.dataBase64, r.data.filename, 'application/zip')
    setMsg(`已下载 ${Math.max(1, Math.round(r.data.bytes / 1024))} KB。需要清理时点右边「删除这个包」。`)
  }

  const doPurge = async (): Promise<void> => {
    setBusy(true); setArm(false); setMsg(null)
    const r = await purgePack(iid.trim())
    setBusy(false)
    if (!r.ok) { setMsg(`排定失败：${r.message}`); return }
    setPending(true); setAfter(r.data.deleteAfter)
    setMsg('已排定：24 小时后自动删除。这期间可以取消。')
  }

  const doCancel = async (): Promise<void> => {
    setBusy(true); setMsg(null)
    const r = await cancelPurge(iid.trim())
    setBusy(false)
    if (!r.ok) { setMsg(`取消失败：${r.message}`); return }
    setPending(false); setAfter(null)
    setMsg('已取消删除。资料保留。')
  }

  const when = after === null ? '' : after.replace('T', ' ').replace('Z', ' UTC')

  return (
    <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6,
      background: pending ? 'rgba(192,57,43,.06)' : 'rgba(0,0,0,.03)',
      border: pending ? '1px solid rgba(192,57,43,.3)' : '1px solid rgba(0,0,0,.08)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: FS.small, fontWeight: 600 }}>这个包</span>
        <button type="button" onClick={() => void doExport()} disabled={busy}
          style={{ ...btnStyle(false), fontSize: FS.small }}>
          打包下载
        </button>
        {pending ? (
          <>
            <span style={{ fontSize: FS.small, color: '#c0392b' }}>
              将于 {when} 自动删除
            </span>
            <button type="button" onClick={() => void doCancel()} disabled={busy}
              style={{ ...btnStyle(false), fontSize: FS.small }}>
              取消删除
            </button>
          </>
        ) : arm ? (
          <>
            <span style={{ fontSize: FS.small, color: '#c0392b' }}>确定要排定删除？</span>
            <button type="button" onClick={() => void doPurge()} disabled={busy}
              style={{ ...btnStyle(false), fontSize: FS.small, background: '#c0392b', color: '#fff', border: 'none' }}>
              确认
            </button>
            <button type="button" onClick={() => setArm(false)} disabled={busy}
              style={{ ...btnStyle(false), fontSize: FS.small }}>
              不了
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setArm(true)} disabled={busy}
            style={{ ...btnStyle(false), fontSize: FS.small, border: '1px solid #c0392b', color: '#c0392b' }}>
            删除这个包
          </button>
        )}
      </div>
      <div style={{ fontSize: FS.small, opacity: 0.7, marginTop: 5 }}>
        {msg ?? '删除会清掉这个交互在所有座位下的资料，24 小时后执行，期间可取消。'}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   ★ 上传附件 —— 独立 tab（2026-10-20 阿开）
   「资料（按位）点了附件按钮之后是否单独出现一个 tab 页面与资料并列，这样更干净」
   —— 看资料 / 传资料分开：这一页只做上传，不摆列表、不摆技术字段。

   ★ 定位（阿开同日）：「优先是 Agent 自己上传，人类是兜底」
     所以文案先告诉人「可以让 Agent 传」，人这一页是补位用的。
   ══════════════════════════════════════════════════════════════════ */
function UploadTab({ onDone }: { onDone: () => void }): ReactElement {
  const [ctx, setCtx] = useState<WorkstationContext | null>(null)
  const [iid, setIid] = useState('')
  const [seat, setSeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [err, setErr] = useState<{ code: string; message: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)

  /* ★ 2026-10-20 阿开：给这条指令加「一键复制」——省得人手动选中一长串 */
  const copyCmd = async (text: string): Promise<void> => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // Electron/非安全上下文回退（navigator.clipboard 可能没有）
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setErr({ code: 'copy_failed', message: '复制没成功，请手动选中命令复制' })
    }
  }

  /** 合规的「一次协作」ID：服务端只认 task-<uuid> / run_<uuid> / manual-<8..14>-<6..12> */
  const makeManualIid = (): string => {
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    const rnd = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
    return `manual-${stamp}-${rnd}`
  }

  useEffect(() => {
    void (async () => {
      const r = await callPack<WorkstationContext>('contextGet', {})
      const base: WorkstationContext = r.ok
        ? r.data
        : { interactionId: '', seat: '', note: '', project: '' }
      setCtx(base)
      // 没有现成交互 ⇒ 给一个，省得人想「交互 ID 是什么」
      const next = (base.interactionId || '').trim() || makeManualIid()
      setIid(next)
      setSeat(base.seat || '')
      if (!(base.interactionId || '').trim()) {
        void callPack<WorkstationContext>('contextPut', { ...base, interactionId: next })
      }
    })()
  }, [])

  const upload = async (fl: FileList | null): Promise<void> => {
    const list = Array.from(fl ?? [])
    if (list.length === 0) return
    const cur = iid.trim()
    if (!cur) {
      setErr({ code: 'missing_interaction_id', message: '还没准备好交互 ID，请稍等或点「重试」' })
      return
    }
    setBusy(true)
    setErr(null)
    setNotice(null)
    const ok: string[] = []
    const bad: string[] = []
    for (const f of list) {
      if (f.size > PACK_MAX_BYTES) {
        bad.push(`${f.name}（${fmtBytes(f.size)} 超过界面单件上限 ${fmtBytes(PACK_MAX_BYTES)}，大件请让 Agent 用 CLI 传）`)
        continue
      }
      try {
        const b64 = await readFileAsBase64(f)
        const r = await callPack<PackFileItem>('packUpload', {
          interactionId: cur, seat: seat.trim(), filename: f.name, contentBase64: b64,
        })
        if (r.ok) ok.push(`${f.name}（${fmtBytes(f.size)}）`)
        else bad.push(`${f.name}：${r.message}`)
      } catch (e) {
        bad.push(`${f.name}：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // 记住这次的归属（换机器也还在）
    if (ctx !== null) void callPack<WorkstationContext>('contextPut', { ...ctx, interactionId: cur, seat: seat.trim() })
    setBusy(false)
    if (ok.length > 0) setNotice(`已上传 ${ok.length} 个：${ok.join('、')}`)
    if (bad.length > 0) setErr({ code: 'partial_failed', message: bad.join('；') })
  }

  /* 这条命令能填实就填实：当前协作若就是某个工位任务，直接把 taskId 写进去 */
  const taskUuid = (/^task-([0-9a-fA-F-]{36})$/.exec(iid.trim()) || [])[1] || ''
  const cmdText = taskUuid
    ? `kai-pu-deliver.py --task ${taskUuid} --claim --attach <产物路径> --text "<结论>"`
    : 'kai-pu-deliver.py --task <任务ID> --claim --attach <产物路径> --text "<结论>"'

  return (
    <Section title="上传附件">
      <div style={{
        padding: '10px 12px', borderRadius: 8, background: 'rgba(59,111,224,.06)',
        border: '1px solid rgba(59,111,224,.25)', fontSize: FS.small, lineHeight: 1.7, marginBottom: 10,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>首选：让你的 Agent 传</div>
        <div style={{ opacity: 0.85 }}>
          它是干活的，产物在它手上。对它说「把这次的成果传到工位」，或者直接给它这条命令：
        </div>
        <div style={{ position: 'relative', marginTop: 6 }}>
          <code style={{
            display: 'block', padding: '6px 62px 6px 8px', borderRadius: 4,
            background: 'rgba(0,0,0,.05)', fontSize: FS.tag, wordBreak: 'break-all',
          }}>
            {cmdText}
          </code>
          <button
            type="button"
            onClick={() => void copyCmd(cmdText)}
            title="复制这条命令"
            style={{
              position: 'absolute', right: 6, top: 6, padding: '2px 9px',
              fontSize: FS.tag, lineHeight: 1.6, borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${copied ? 'rgba(31,122,61,.45)' : 'rgba(0,0,0,.18)'}`,
              background: copied ? 'rgba(31,122,61,.10)' : '#fff',
              color: copied ? '#1f7a3d' : C.dim,
            }}
          >
            {copied ? '✓ 已复制' : '复制'}
          </button>
        </div>
        <div style={{ opacity: 0.7, marginTop: 4 }}>下面这一页是<strong>人的兜底</strong>：Agent 传不了、或者你想补一份时用。</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: FS.small, color: C.dim }}>传到</span>
        <code style={{ fontSize: FS.tag, padding: '3px 6px', background: 'rgba(0,0,0,.04)', borderRadius: 4, wordBreak: 'break-all' }}>
          {iid || '准备中…'}
        </code>
        <span style={{ fontSize: FS.tag, color: C.dim }}>（一次协作一个目录 · Agent 与人在同一次协作里各占一个座位）</span>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => input.current?.click()} disabled={busy} style={btnStyle(true)}>
          {busy ? '上传中…' : '选择文件上传'}
        </button>
        <input ref={input} type="file" multiple onChange={(e) => { const fl = e.target.files; e.target.value = ''; void upload(fl) }} style={{ display: 'none' }} />
        <button type="button" onClick={() => onDone()} disabled={busy} style={btnStyle(false)}>
          去「资料（按位）」看看
        </button>
      </div>

      {notice !== null && <div style={{ marginTop: 8, fontSize: FS.small, color: '#1f7a3d' }}>{notice}</div>}
      {err !== null && <div style={{ marginTop: 8, fontSize: FS.small, color: '#b3261e' }}>[{err.code}] {err.message}</div>}
    </Section>
  )
}

function PackSection({ onUpload, focus, advTick }: {
  onUpload: () => void
  focus: { interactionId: string; title?: string | undefined } | null
  /** 每次 +1 就展开「高级」（从工位页跳过来时用） */
  advTick?: number
}): ReactElement {
  /* ★ 2026-10-19 阿开：「记住的交互 ID 和座位放服务端更方便」——
     从 localStorage 挪到 `GET/POST /workstation/context`：换机器、重装插件都还在。 */
  const advRef = useRef<HTMLDetailsElement | null>(null)
  useEffect(() => {
    if ((advTick ?? 0) > 0 && advRef.current !== null) advRef.current.open = true
  }, [advTick])
  const [iid, setIid] = useState<string>('')
  /* ★ 2026-10-21：有资料的交互清单 —— 打包下载 404 是因为手里的 iid 是历史遗留的 */
  const [packIids, setPackIids] = useState<Array<{ interactionId: string; files: number; seats: number; lastAt: string }>>([])
  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await loadPackInteractions()
      if (alive && r.ok) {
        setPackIids(r.data.interactions)
        /* ★ 2026-10-21：手里这个 iid 没有资料、但别处有 ⇒ **自动切到最近那个**。
           否则用户永远停在「无资料可下载」，明明下面那一排就有东西。 */
        const first = r.data.interactions[0]
        if (first !== undefined && !r.data.interactions.some((x) => x.interactionId === iid)) {
          setIid(first.interactionId)
          void persist({ interactionId: first.interactionId })
        }
      }
    })()
    return () => { alive = false }
  }, [])
  const [seat, setSeat] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [project, setProject] = useState<string>('')
  const [ctxLoaded, setCtxLoaded] = useState(false)
  const [files, setFiles] = useState<PackFileItem[] | null>(null)
  const [err, setErr] = useState<{ code: string; message: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [journal, setJournal] = useState<PackJournalPayload | null>(null)
  /* ★ 2026-10-21（阿开拍板 L3）：设备加入码 —— 新设备进本铺必须持码 */
  const [joinCode, setJoinCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinCopied, setJoinCopied] = useState(false)

  /* ★ 2026-10-21（阿里星月建议）：设备台账 = 白名单本体（入册/撤销/流水） */
  type DeviceRow = {
    deviceId: string; fpHash8: string; fpHash: string; status: string
    clientVersion: string; firstSeen: string | null; lastSeen: string | null; issueCount: number
  }
  const [devices, setDevices] = useState<{ items: DeviceRow[]; count: number; activeCount: number } | null>(null)

  const loadDevices = async (): Promise<void> => {
    const r = await callPack<{ items: DeviceRow[]; count: number; activeCount: number }>('devicesList', {})
    if (r.ok) setDevices(r.data)
  }

  const revokeDevice = async (fpHash: string, revoked: boolean): Promise<void> => {
    const r = await callPack<{ fpHash8: string; status: string }>('deviceRevoke', { fpHash, revoked })
    if (!r.ok) {
      setErr({ code: r.code, message: r.message })
      return
    }
    setNotice(revoked ? '已移出：这台设备下次连不进来（记录保留）' : '已恢复：这台设备可以再连')
    await loadDevices()
  }

  useEffect(() => { void loadDevices() }, [])

  const makeJoinCode = (): void => {
    setJoinBusy(true)
    void (async () => {
      const r = await callPack<{ code: string; accountId: string; expiresAt: string }>(
        'deviceJoinCodeCreate', { note: '新设备加入', ttlHours: 24 })
      setJoinBusy(false)
      if (!r.ok) {
        setErr({ code: r.code, message: r.message })
        return
      }
      setJoinCode({ code: r.data.code, expiresAt: r.data.expiresAt })
    })()
  }

  /* 开局从服务端拉「上次的交互」 */
  useEffect(() => {
    void (async () => {
      const r = await callPack<WorkstationContext>('contextGet', {})
      if (r.ok) {
        setIid(r.data.interactionId)
        setSeat(r.data.seat)
        setNote(r.data.note)
        setProject(r.data.project)
      }
      setCtxLoaded(true)
    })()
  }, [])

  /** 保存到服务端（失焦时调，不打断输入） */
  const persist = async (patchObj: { interactionId?: string; seat?: string; note?: string; project?: string }): Promise<void> => {
    const next = { interactionId: iid, seat, note, project, ...patchObj }
    const r = await callPack<WorkstationContext>('contextPut', next)
    if (!r.ok && r.code !== 'no_channel') {
      setErr({ code: r.code, message: r.message })
    }
  }

  /** 生成交互 ID（省得手填） */
  const makeIid = (): string => {
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    const rnd = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
    return `int-${stamp}-${rnd}`
  }

  const ref = { interactionId: iid.trim(), seat: seat.trim() }

  const refresh = async (ov?: { interactionId?: string; seat?: string }): Promise<void> => {
    // ★ 期6-L1：支持显式传入（任务卡片跳转时立刻用新 iid，不等 setState 生效）
    const cur = {
      interactionId: (ov?.interactionId ?? iid).trim(),
      seat: (ov?.seat ?? seat).trim(),
    }
    if (cur.interactionId.length === 0) {
      setFiles(null)
      setErr(null)
      return
    }
    const r = await callPack<PackListPayload>('packsList', cur)
    if (r.ok) {
      setFiles(Array.isArray(r.data.files) ? r.data.files : [])
      setErr(null)
    } else {
      setErr({ code: r.code, message: r.message })
      setFiles(null)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ★ 期6-L1：任务卡片「📎 资料」→ 定位那次协作
     ★ 2026-10-20 改：事件监听上移到 WorkstationPanel（切 tab 的职责在它），本区只吃 focus。 */
  useEffect(() => {
    if (focus === null) return
    setIid(focus.interactionId)
    setNotice(focus.title ? `正在看「${focus.title}」的附件` : null)
    setErr(null)
    void refresh({ interactionId: focus.interactionId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const onDownload = async (name: string): Promise<void> => {
    setBusy(true)
    setErr(null)
    setNotice(null)
    const r = await callPack<PackDownloadPayload>('packDownload', { ...ref, filename: name })
    setBusy(false)
    if (!r.ok) {
      setErr({ code: r.code, message: r.message })
      return
    }
    triggerDownload(r.data.contentBase64, r.data.filename || name, r.data.contentType)
    setNotice(`已下载：${r.data.filename || name}（${fmtBytes(r.data.size)}）`)
  }

  const onDelete = async (name: string): Promise<void> => {
    const yes = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`删除「${name}」？\n\n服务端会先物理删文件、再删索引，并在流水里留一行 delete。`)
      : true
    if (!yes) return
    setBusy(true)
    setErr(null)
    setNotice(null)
    const r = await callPack<Record<string, unknown>>('packDelete', { ...ref, filename: name })
    setBusy(false)
    if (!r.ok) {
      setErr({ code: r.code, message: r.message })
      return
    }
    setNotice(`已删除：${name}`)
    await refresh()
  }

  const onJournal = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    const r = await callPack<PackJournalPayload>('packJournal', { ...ref })
    setBusy(false)
    if (!r.ok) {
      setErr({ code: r.code, message: r.message })
      return
    }
    setJournal(r.data)
  }

  return (
    <Section title="资料（按位）">
      {/* ★ 期6-L1：任务卡片「📎」跳转的落点锚 */}
      <div id="kaipu-pack-section" />
      <PackLifecycle iid={iid} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: FS.small, color: C.dim }}>当前交互</span>
        <code style={{ fontSize: FS.tag, padding: '3px 6px', background: 'rgba(0,0,0,.04)', borderRadius: 4, wordBreak: 'break-all' }}>
          {ref.interactionId || '（还没选 —— 去「上传附件」传一次就有了）'}
        </code>
        <button type="button" onClick={() => void refresh()} disabled={busy} style={btnStyle(false)}>
          刷新
        </button>
        <button type="button" onClick={() => void onJournal()} disabled={busy || ref.interactionId.length === 0} style={btnStyle(false)}>
          流水
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onUpload} disabled={busy} style={btnStyle(true)} title="传文件不在这一页做 —— 单独一页，免得和查看混在一起">
          ＋ 传文件
        </button>
      </div>

      {/* ★ 2026-10-20 阿开：「生成交付 ID 还可以生成不知道是干嘛用的，那一行都多余」
          ⇒ 主界面不再摆技术字段，收进「高级」；日常看资料/传资料都用不到它们。 */}
      {/* ★ 2026-10-21 阿开：「打包下载提示目录不存在」—— 不用再猜 iid，这里列出真有东西的 */}
      {packIids.length > 0 ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: FS.tag, color: C.dim }}>有资料的协作</span>
          {packIids.slice(0, 8).map((x) => {
            const active = x.interactionId === iid
            const label = x.interactionId.length > 24 ? `${x.interactionId.slice(0, 22)}…` : x.interactionId
            return (
              <button
                key={x.interactionId}
                type="button"
                onClick={() => { setIid(x.interactionId); void persist({ interactionId: x.interactionId }) }}
                title={`${x.interactionId} · ${x.files} 个文件 · 最近 ${x.lastAt.replace('T', ' ').replace('Z', ' UTC')}`}
                style={{
                  padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                  fontSize: FS.tag, fontFamily: 'inherit', whiteSpace: 'nowrap',
                  border: `1px solid ${active ? '#1f2937' : C.border}`,
                  background: active ? '#1f2937' : 'transparent',
                  color: active ? '#fff' : C.dim,
                }}
              >
                {label} · {x.files}
              </button>
            )
          })}
        </div>
      ) : null}

      <details ref={advRef} style={{ marginTop: 6 }}>
        <summary style={{ fontSize: FS.tag, color: C.dim, cursor: 'pointer' }}>
          高级（换一个交互 / 座位 / 项目 / 备注）
        </summary>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <input
            value={iid}
            onChange={(e) => setIid(e.target.value)}
            onBlur={() => void persist({})}
            placeholder="交互 ID（看哪一次协作的资料）"
            title="一次协作一个目录。改这里 = 换目录查看，旧资料不会跟过来。"
            style={{ flex: '1 1 220px', padding: '5px 7px', fontSize: FS.small, borderRadius: 4, border: '1px solid rgba(0,0,0,.18)' }}
          />
          <button
            type="button"
            onClick={() => {
              const v = makeIid()
              setIid(v)
              void persist({ interactionId: v })
            }}
            style={btnStyle(false)}
            title="新建一次协作（生成一个新的目录）"
          >
            新建协作
          </button>
          <input
            value={seat}
            onChange={(e) => setSeat(e.target.value)}
            onBlur={() => void persist({})}
            placeholder="座位（可空）"
            style={{ width: 100, padding: '5px 7px', fontSize: FS.small, borderRadius: 4, border: '1px solid rgba(0,0,0,.18)' }}
          />
          <input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            onBlur={() => void persist({})}
            placeholder="当前项目（如：011 财税）"
            title="一个铺子同一时间跑一个项目。项目换了改这里就行。"
            style={{ flex: '1 1 150px', padding: '5px 7px', fontSize: FS.small, borderRadius: 4, border: '1px solid rgba(0,0,0,.18)' }}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => void persist({})}
            placeholder="备注（可选，如：和阿舟对财税）"
            style={{ flex: '1 1 180px', padding: '5px 7px', fontSize: FS.small, borderRadius: 4, border: '1px solid rgba(0,0,0,.18)' }}
          />
        </div>
        {/* ★ 2026-10-21（阿开拍板 L3）：新设备入铺要持码 —— 否则知道铺名就能进 */}
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap',
          paddingTop: 8, borderTop: `1px dashed ${C.border}`,
        }}>
          <span style={{ fontSize: FS.tag, color: C.dim }}>新设备要进这个铺：</span>
          <button
            type="button"
            onClick={makeJoinCode}
            disabled={joinBusy}
            style={{
              padding: '6px 13px', borderRadius: 7, border: 'none', cursor: joinBusy ? 'default' : 'pointer',
              background: '#1f2937', color: '#fff', fontSize: FS.small, fontWeight: 600, fontFamily: 'inherit',
            }}
          >
            {joinBusy ? '生成中…' : '🔑 生成设备加入码'}
          </button>
          {joinCode !== null ? (
            <>
              <code style={{
                fontSize: FS.small, padding: '2px 6px', background: C.soft,
                borderRadius: 4, letterSpacing: 0.5,
              }}>{joinCode.code}</code>
              <span style={{ fontSize: FS.tag, color: C.dim }}>24 小时内有效 · 只能用一次</span>
              <button type="button" style={btnStyle(false)} onClick={() => { void (async () => {
                try {
                  await navigator.clipboard.writeText(joinCode.code)
                  setJoinCopied(true)
                  setTimeout(() => setJoinCopied(false), 1800)
                } catch { /* 手动复制 */ }
              })() }}>{joinCopied ? '✓ 已复制' : '复制'}</button>
            </>
          ) : (
            <span style={{ fontSize: FS.tag, color: C.dim }}>
              另一台设备（同事的机器 / 客户机）要用本铺时，给它这个码
            </span>
          )}
        </div>
      </details>

      {/* ★ 2026-10-21（阿里星月建议 · 阿开要「进出记录」）：设备台账 = 白名单本体
          —— 入册 = 用码进来过一次；移出 = 只改状态不删记录（流水能对上）。 */}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: FS.small, color: 'rgba(0,0,0,.6)' }}>
          设备台账
          {devices !== null ? `（在册 ${devices.activeCount} 台 · 共 ${devices.count} 条记录）` : ''}
        </summary>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {devices === null ? (
            <span style={{ fontSize: FS.tag, color: C.dim }}>加载中…</span>
          ) : devices.items.length === 0 ? (
            <span style={{ fontSize: FS.tag, color: C.dim }}>还没有设备入册</span>
          ) : devices.items.map((d) => (
            <div key={d.deviceId} style={{
              display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
              fontSize: FS.tag, color: d.status === 'active' ? C.text : C.dim,
            }}>
              <code style={{ padding: '1px 5px', background: C.soft, borderRadius: 3 }}>{d.fpHash8}</code>
              <span style={{ color: C.dim }}>{d.clientVersion || '—'}</span>
              <span style={{ color: C.dim }}>
                首次 {fmtWhen(d.firstSeen)} · 最近 {fmtWhen(d.lastSeen)}
              </span>
              {d.status === 'active' ? (
                <button type="button" style={btnStyle(false)}
                  onClick={() => void revokeDevice(d.fpHash, true)}>移出</button>
              ) : (
                <>
                  <span style={{ color: '#b3261e' }}>已移出</span>
                  <button type="button" style={btnStyle(false)}
                    onClick={() => void revokeDevice(d.fpHash, false)}>恢复</button>
                </>
              )}
            </div>
          ))}
        </div>
      </details>

      {notice !== null && (
        <div style={{ marginTop: 6, fontSize: FS.small, color: '#1f7a3d' }}>{notice}</div>
      )}
      {err !== null && (
        <div style={{ marginTop: 6, fontSize: FS.small, color: '#b3261e' }}>
          [{err.code}] {err.message}
        </div>
      )}

      {ref.interactionId.length === 0 ? (
        <div style={{ marginTop: 6, fontSize: FS.small, color: 'rgba(0,0,0,.55)' }}>
          <strong>按位</strong>：每个座位一个抽屉，一次协作一个文件夹 ——
          <code style={{ fontSize: FS.tag }}>packs/&lt;铺&gt;/&lt;座位&gt;/&lt;交互ID&gt;/</code>
          。执行位交的稿、审计位出的报告分开存，谁交的一眼能看出。
          {' '}座位留空 ⇒ 由服务端按你的身份解析。
          {' '}ID／座位／项目／备注都存在服务端（换机器、重装插件都还在）；
          改 ID 等于换目录，**旧资料不会跟过来**。
        </div>
      ) : files === null ? (
        <div style={{ marginTop: 6, fontSize: FS.small, color: 'rgba(0,0,0,.55)' }}>还没有拉到列表（或读取失败）。</div>
      ) : files.length === 0 ? (
        <div style={{ marginTop: 6, fontSize: FS.small, color: 'rgba(0,0,0,.55)' }}>这个位上还没有文件。</div>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map((f) => {
            const name = typeof f.filename === 'string' ? f.filename : ''
            if (name.length === 0) return null
            return (
              <div
                key={`${typeof f.seat === 'string' ? f.seat : ''}/${name}`}
                style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: FS.small, padding: '3px 0', borderBottom: '1px solid rgba(0,0,0,.06)' }}
              >
                <span style={{ flex: 1, wordBreak: 'break-all' }}>{name}</span>
                <span style={{ color: 'rgba(0,0,0,.55)', whiteSpace: 'nowrap' }}>{fmtBytes(f.size)}</span>
                <button type="button" onClick={() => void onDownload(name)} disabled={busy} style={btnStyle(false)}>
                  下载
                </button>
                <button type="button" onClick={() => void onDelete(name)} disabled={busy} style={btnStyle(false)}>
                  删除
                </button>
              </div>
            )
          })}
        </div>
      )}

      {journal !== null && (
        <div style={{ marginTop: 10, fontSize: FS.small }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            流水 · {journal.lines.length} 行 ·{' '}
            {journal.ok ? (
              <span style={{ color: '#1f7a3d' }}>链完整</span>
            ) : (
              <span style={{ color: '#b3261e' }}>
                第 {journal.brokenAtSeq ?? '?'} 行断裂
                {journal.anchorOk === false ? '（锚点对不上：可能被截断）' : ''}
              </span>
            )}
            {journal.appendOnly === true ? ' · 内核层追加保护已开' : ''}
          </div>
          <div style={{ maxHeight: 160, overflow: 'auto', fontFamily: 'ui-monospace, monospace', lineHeight: 1.5 }}>
            {journal.lines.map((ln, i) => (
              <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {String((ln as Record<string, unknown>).seq ?? i + 1)}. {String((ln as Record<string, unknown>).event ?? '?')} ·{' '}
                {String((ln as Record<string, unknown>).actor ?? '')} · {String((ln as Record<string, unknown>).file ?? '')}
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

function TaskSection(): ReactElement {
  const [data, setData] = useState<{ tasks: TaskUi[]; counts: Record<string, number> } | null>(null)
  /**
   * ★ 错误分源：`read` = 读列表失败 · `action` = 动作失败（含心跳）。
   *   为什么必须分：动作失败后紧接着会 `refresh()`，而读列表**成功**时只应清「读失败」，
   *   不能顺手把「刚才那个动作被服务端拒了」抹掉 —— 那等于吞错（409/403 就再也看不见）。
   */
  const [err, setErr] = useState<{
    code: string
    message: string
    title?: string
    source?: 'read' | 'action'
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  /* ★ 期6-L2：项目归属（空 = 未归类） */
  const [projects, setProjects] = useState<ProjectItem[]>([])
  /* ★ 2026-10-21：项目清单读失败以前是**静默**的（「读失败不清空」）⇒
     阿开连着两次说「项目不见了」却没有任何提示。现在把失败摆出来。 */
  const [projErr, setProjErr] = useState<{ code: string; message: string } | null>(null)
  // ★ 2026-10-21：按项目筛选任务。此前只能看到「全部任务」，项目只是一张贴纸 ——
  //   「一个项目现在到哪了」要自己一条条认。空串 = 全部，'__none__' = 未归类。
  const [projFilter, setProjFilter] = useState<string>('')
  /* 四段折叠：默认只展开「待我处理」（其余段显示条数，点开看） */
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({})
  /* ★ 2026-10-21：只有一个项目时**自动选中它** —— 否则「全部」状态下看不到项目条，
     也就看不到「申请审计」，阿开连着两次说「找不到按钮」就是这个原因。 */
  /* ★ 2026-10-23（古茶 002「一键挂载」）：项目 → 审计 → 带签名报告。
     服务端建单后立刻返回，跑审在后台（四灯场景，几分钟）⇒ 这里只存 id/status，
     由 effect 每 5 秒问一次；`report` 到了才渲染结论。 */
  const [audit, setAudit] = useState<{
    id: string
    status: string
    report: AuditReportUi | null
  } | null>(null)

  /** 一键挂载：把当前项目送去审计（建单即返回，结论靠轮询） */
  const requestAudit = async (projectId: string): Promise<void> => {
    setErr(null)
    const r = await callActionData<{ id: string; status: string; reused?: boolean }>(
      'projectAuditRequest',
      { projectId, package: 'standard' },
    )
    if (!r.ok) {
      /* ★ 2026-10-21 甲案：送审必归档 ⇒ 没归档被拒时，别只报一个错误码，
         直接把「先去归档」这条路指出来（用户点的是审计按钮，脑子里想的是送审）。 */
      if (r.code === 'project_not_frozen') {
        setNotice('请先归档，定稿后送审 —— 审计要针对一个确定的版本。右侧「归档」按钮就在旁边。')
        return
      }
      if (r.code === 'archive_stale') {
        setNotice('解冻过 ⇒ 之前的归档包已作废。请重新归档（生成新的 sha256）后再送审。')
        return
      }
      setErr({
        code: r.code ?? 'audit_failed',
        message: r.message ?? '审计申请没发出去',
        source: 'action',
        title: '审计申请没发出去',
      })
      return
    }
    setAudit({ id: r.data.id, status: r.data.status ?? 'queued', report: null })
    setNotice(
      r.data.reused
        ? '这个项目已经在审了 —— 等它出结论就行。'
        : '已送去审计 —— 四灯在看资料，几分钟后出结论。',
    )
  }

  /* 审计单轮询：只在 queued/running 时跑，出结论就停 */
  useEffect(() => {
    if (audit === null) return
    if (audit.status !== 'queued' && audit.status !== 'running') return
    const id = audit.id
    let alive = true
    const timer = setInterval(() => {
      void callActionData<{ status: string; report: AuditReportUi | null }>('auditGet', {
        auditId: id,
      }).then((r) => {
        if (!alive || !r.ok) return
        setAudit((prev) =>
          prev === null || prev.id !== id
            ? prev
            : { ...prev, status: r.data.status ?? prev.status, report: r.data.report ?? prev.report },
        )
      })
    }, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [audit?.id, audit?.status])
  const [projId, setProjId] = useState('')
  const [projNew, setProjNew] = useState(false)
  const [projName, setProjName] = useState('')
  const [projNotice, setProjNotice] = useState<string | null>(null)
  /* ★ 2026-10-21 阿开：「＋发布 改成 ＋新项目，项目的问题就解决了」
     ⇒ 我的判断：那按钮是**发任务**，改名会误导；但他的真实需求是「有个明确的建项目入口」
     ⇒ 做法：发任务按钮改叫「＋ 新任务」，旁边**独立**加「＋ 新项目」。
     不改「＋ 发布」的字面，是因为点开它不是建项目 —— 按钮说什么，就该做什么。 */
  const [topProjOpen, setTopProjOpen] = useState(false)
  const [topProjName, setTopProjName] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /* 身份与两个折叠区（块 C / 块 D） */
  const [myId, setMyId] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<Flagged>({ kind: 'pending' })
  const [pending, setPending] = useState<Flagged>({ kind: 'pending' })
  const [openBlocked, setOpenBlocked] = useState(false)
  const [openPending, setOpenPending] = useState(false)

  const refresh = async (all: boolean): Promise<void> => {
    const r = await loadTasks(all)
    if (r.ok) {
      /* ★★ 2026-10-19：「任务看不到了」的兜底 ——
         后端回的 `tasks` 不是数组时，原来的 `.map` 会**同步抛错**，
         而这个 refresh 是 async 回调：抛了就再没下文，界面卡在「正在读取任务…」。
         ⇒ 认不出来就当空列表，并把原因写进 err（让故障自己说话，不用猜）。 */
      const raw = (r.data as { tasks?: unknown } | null)?.tasks
      const list = Array.isArray(raw) ? raw : []
      if (!Array.isArray(raw)) {
        setErr({ code: 'bad_payload', message: `任务列表格式异常（tasks=${raw === undefined ? 'undefined' : typeof raw}）`, source: 'read' })
      }
      setData({ tasks: list.map(toTaskUi), counts: (r.data?.counts ?? {}) as Record<string, number> })
      /* ★ 2026-10-21：项目清单随任务一起回来（后端 `tasksList` 新加的字段）——
         不再依赖那条在真实客户端里没发出的 `GET /projects`。 */
      const projs = (r.data as { projects?: unknown } | null)?.projects
      if (Array.isArray(projs)) {
        setProjects(projs as ProjectItem[])
        setProjErr(null)
      }
      /* ★ 只清「读失败」；动作失败要留在屏上（否则 409/403 一闪就没） */
      setErr((prev) => (prev !== null && prev.source === 'action' ? prev : null))
    } else {
      /* ★ 不清空：一次读失败（或刚做完动作后端抖一下）不该让已经看到的任务凭空消失。
         首次加载本来就是 null，靠上面的 err 卡片说话。 */
      setErr({ code: r.code, message: r.message, source: 'read' })
    }
    /* ★ 期6-L2：项目清单与任务同批刷新（读失败不清空，保留上次可用值） */
    const pr = await loadProjects()
    if (pr.ok) {
      setProjects(pr.data.projects)
      setProjErr(null)
    } else {
      setProjErr({ code: pr.code, message: pr.message })
    }
    /* ★ 两个徽标与任务列表同批刷新：计数取自服务端列表本身，不在前端另算 */
    const [blockedNext, pendingNext] = await Promise.all([
      fetchFlagged('tasksBlocked'),
      fetchFlagged('tasksPendingApprovals'),
    ])
    setBlocked(blockedNext)
    setPending(pendingNext)
  }

  useEffect(() => {
    void refresh(showAll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll])

  /* 身份：只取一次（心跳与审批用同一份） */
  useEffect(() => {
    let alive = true
    void (async () => {
      const id = await fetchMyAccountId()
      if (alive) setMyId(id)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ★ 租约心跳：只对「in_progress 且 claimed_by == 本人」发；页面不可见跳过本轮 */
  const tasksRef = useRef<TaskUi[]>([])
  const myIdRef = useRef<string | null>(null)
  myIdRef.current = myId
  tasksRef.current = data?.tasks ?? []

  useEffect(() => {
    const timer = setInterval(() => {
      /* ★ document.hidden === true ⇒ 跳过本轮（后台标签页不续租约，回来后由下一轮补） */
      if (document.hidden) return
      const id = myIdRef.current
      if (id === null) return
      for (const t of tasksRef.current) {
        if (normStatus(t.status) !== 'in_progress') continue
        if (t.claimed_by !== id) continue
        void heartbeatTask(t.task_id).then((r) => {
          /* 心跳失败不静默：租约断了任务会被回收，必须让人看见（失败后由下一轮成功自愈） */
          if (!r.ok) {
            setErr({
              code: r.code ?? 'heartbeat_failed',
              message: r.message ?? '租约续期失败',
              title: '租约续期失败',
              source: 'action',
            })
          } else {
            setErr((prev) => (prev !== null && prev.title === '租约续期失败' ? null : prev))
          }
        })
      }
    }, HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [])

  const run = async (
    fn: () => Promise<{ ok: boolean; code?: string; message?: string }>,
    okMsg?: string,
  ): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const r = await fn()
      if (!r.ok) setErr({ code: r.code ?? 'error', message: r.message ?? '操作失败', source: 'action' })
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
      const r = await createTask(t, detail.trim(), projId || undefined)
      if (r.ok) {
        setTitle('')
        setDetail('')
        setComposing(false)
      }
      return r
    }, '任务已发布')
  }

  /** 新建项目（发布表单里就地建，建完自动选中） */
  const onCreateProject = (): void => {
    const n = projName.trim()
    if (n.length === 0) return
    void run(async () => {
      const r = await createProject(n)
      if (r.ok) {
        setProjName('')
        setProjNew(false)
        setProjId(r.data.projectId)
        /* 立刻拉一次清单，让下拉马上有这一项（不等下次全量刷新） */
        const pr = await loadProjects()
        if (pr.ok) setProjects(pr.data.projects)
      }
      return r
    }, '项目已建')
  }

  /** ★ 2026-10-21：任务页顶部的「＋ 新项目」（不依赖发布表单） */
  const onTopCreateProject = (): void => {
    const n = topProjName.trim()
    if (n.length === 0) return
    void run(async () => {
      const r = await createProject(n)
      if (r.ok) {
        setTopProjName('')
        setTopProjOpen(false)
        const pr = await loadProjects()
        if (pr.ok) setProjects(pr.data.projects)
      }
      return r
    }, '项目已建')
  }

  /** 归档项目：打包 + manifest（不删原件） */
  const onArchive = (p: ProjectItem): void => {
    void run(async () => {
      let r = await archiveProject(p.projectId)
      /* ★ 2026-10-21 阿开拍板甲：**默认拦截，显式暂存**。
         没做完 ⇒ 后端 400 project_incomplete ⇒ 这里问一句，用户确认才带 force 重试。
         目的：不许「手一滑就把半成品当成定稿」。 */
      if (!r.ok && r.code === 'project_incomplete') {
        const go = window.confirm(
          `${r.message}\n\n点「确定」= 暂存（包里会标 complete=false，不能当定稿送审）；\n点「取消」= 先去把活干完。`,
        )
        if (!go) {
          setProjNotice('已取消归档 —— 先把剩下的活干完，再正式归档。')
          return { ok: false, code: 'cancelled', message: '用户取消' }
        }
        r = await archiveProject(p.projectId, true)
      }
      if (r.ok) {
        const d = r.data as { files?: number; bytes?: number; archive?: string; tasks?: number;
          complete?: boolean; doneTasks?: number; unfinished?: Array<{ title: string; status: string }> }
        const unf = d.unfinished ?? []
        /* ★ 2026-10-21 阿开：「担心任务还没完成就归档」—— 包是快照，不会自己更新；
           所以归档那一刻就把「完成度」打进包里、也当场说清。 */
        setProjNotice(
          unf.length > 0
            ? `「${p.name}」已归档：${d.tasks ?? 0} 个任务（${d.doneTasks ?? 0} 个已完成 · ⚠ 还有 ${unf.length} 个未完成）/ ${d.files ?? 0} 个文件 / ${d.bytes ?? 0} 字节。包里已标注「不完整」，未完成的任务清单也在 manifest 里。`
            : `「${p.name}」已归档：${d.tasks ?? 0} 个任务（全部已完成 ✓）/ ${d.files ?? 0} 个文件 / ${d.bytes ?? 0} 字节（含 manifest 清单）`,
        )
        /* ★ 关键：不刷新的话按钮还是「归档」，用户以为没成功 */
        const pr = await loadProjects()
        if (pr.ok) setProjects(pr.data.projects)
      }
      return r
    })
  }

  /** ★ 2026-10-21：取消归档（阿开拍板：归档能回来） */
  const onUnarchive = (p: ProjectItem): void => {
    void run(async () => {
      const r = await unarchiveProject(p.projectId)
      if (r.ok) {
        /* ★ 2026-10-21 阿开：「不知道取消归档之后能干嘛」⇒ 提示里直接说清能做什么，
           而不是只报一句「已取消」。 */
        setProjNotice(
          `「${p.name}」已取消归档 —— 回到项目列表。现在可以继续加任务 / 传资料 / 申请审计 / 再次归档；归档包还在，随时能下载。`,
        )
        const pr = await loadProjects()
        if (pr.ok) setProjects(pr.data.projects)
      }
      return r
    })
  }

  /** ★ 2026-10-21：下载归档包（含 manifest 清单） */
  const onDownloadArchive = (p: ProjectItem): void => {
    void run(async () => {
      const r = await downloadProjectArchive(p.projectId)
      if (!r.ok) {
        setProjNotice(`下载失败：${r.message}`)
        return r
      }
      triggerDownload(r.data.dataBase64, r.data.filename, 'application/zip')
      /* ★ 2026-10-21 阿开：「取消归档继续完成，会影响下载包的资料版本」
         ⇒ 包不可能自动更新。归档后又取消归档的，这个包就是**旧快照**，必须当场说。 */
      setProjNotice(
        r.data.stale
          ? `已下载「${p.name}」的归档包，但 ⚠ 这是**旧快照**：归档之后又取消过归档（${(r.data.staleSince ?? '').replace('T', ' ')}），期间新增的任务和资料不在包里。需要最新版就再归档一次。`
          : `已下载「${p.name}」的归档包：${Math.max(1, Math.round(r.data.bytes / 1024))} KB · sha256 ${r.data.sha256.slice(0, 12)}…（压缩包里的 manifest.json 就是归档清单）`,
      )
      return r
    })
  }

  const projectNameOf = (id?: string | null): string => {
    if (!id) return ''
    const p = projects.find((x) => x.projectId === id)
    return p ? p.name : ''
  }

  const tasks = data?.tasks ?? []
  // ★ 2026-10-21：项目筛选（客户端过滤，不动接口；服务端 `?project_id=` 已支持，供 Agent 用）
  /* ★ 2026-10-21 兜底：`GET /projects` 读失败时，从任务自带的 projectId 反推项目列表 ——
     项目行和「申请审计」不该因为一个列表接口挂了就整块消失。
     名字拿不到就先显示 id（审计只认 id，能用）。 */
  const shownProjects: ProjectItem[] = (() => {
    if (projects.length > 0) return projects
    const m = new Map<string, number>()
    for (const t of tasks) {
      const pid = t.projectId
      if (typeof pid === 'string' && pid.length > 0) m.set(pid, (m.get(pid) ?? 0) + 1)
    }
    return [...m.entries()].map(([projectId, taskCount]) => ({
      projectId,
      name: projectId,
      status: 'active',
      createdAt: '',
      taskCount,
    }))
  })()

  useEffect(() => {
    if (projFilter !== '') return
    const ids = projects.length > 0
      ? projects.map((p) => p.projectId)
      : [...new Set(tasks.map((t) => t.projectId).filter((x): x is string => typeof x === 'string' && x.length > 0))]
    if (ids.length === 1 && ids[0] !== undefined) setProjFilter(ids[0])
  }, [projects, projFilter, tasks])

  const visibleTasks = projFilter === ''
    ? tasks
    : projFilter === '__none__'
      ? tasks.filter((t) => !t.projectId)
      : tasks.filter((t) => t.projectId === projFilter)
  const counts = data?.counts ?? {}

  /** 计数取值：优先九态键，回落旧键（后端可能仍只回 open/done） */
  const countOf = (status: string): number => {
    const direct = counts[status]
    if (typeof direct === 'number') return direct
    if (status === 'posted') return counts['open'] ?? 0
    if (status === 'accepted') return counts['done'] ?? 0
    return 0
  }

  const blockedCount = blocked.kind === 'ok' ? blocked.rows.length : 0
  const pendingCount = pending.kind === 'ok' ? pending.rows.length : 0

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: FS.title, fontWeight: 600 }}>任务</div>
        {['posted', 'claimed', 'in_progress'].map((k) => {
          const n = countOf(k)
          return n > 0 ? (
            <span key={k} style={{ fontSize: FS.small, color: C.dim }}>
              {statusText(k)} {n}
            </span>
          ) : null
        })}
        {/* 块 C / 块 D：计数为 0 不显示 */}
        {blockedCount > 0 ? (
          <button
            type="button"
            onClick={() => setOpenBlocked((v) => !v)}
            disabled={busy}
            style={btnStyle(false)}
            title="看谁在求助"
          >
            求助中 {blockedCount}
          </button>
        ) : null}
        {pendingCount > 0 ? (
          <button
            type="button"
            onClick={() => setOpenPending((v) => !v)}
            disabled={busy}
            style={btnStyle(false)}
            title="看等你审批的任务"
          >
            待我审批 {pendingCount}
          </button>
        ) : null}
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
        <button type="button" onClick={() => setTopProjOpen((v) => !v)} disabled={busy} style={btnStyle(false)}
          title="新建一个项目（同一铺子里可以并行多个项目）">
          {topProjOpen ? '取消' : '＋ 新项目'}
        </button>
        <button type="button" onClick={() => setComposing((v) => !v)} disabled={busy} style={btnStyle(true)}>
          {composing ? '收起' : '＋ 新任务'}
        </button>
      </div>

      {/* ★ 2026-10-21：独立的新建项目入口（不必先发任务才能建项目） */}
      {topProjOpen ? (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            value={topProjName}
            onChange={(e) => setTopProjName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onTopCreateProject() }}
            placeholder="项目名，如「财税专家工作台」"
            style={inputStyle}
          />
          <button type="button" onClick={onTopCreateProject}
            disabled={busy || topProjName.trim().length === 0} style={btnStyle(true)}>
            建
          </button>
        </div>
      ) : null}

      {/* 发布表单 */}
      {composing ? (
        <div style={{ ...cardStyle, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* ★ 2026-10-20 阿开：发布不必手动填 —— 让 Agent 代发 */}
          <div style={{
            fontSize: FS.tag, color: C.dim, lineHeight: 1.5,
            padding: '6px 8px', borderRadius: 6, border: `1px dashed ${C.border}`,
          }}>
            💡 也可以让你的 Agent 发：对管理位的 Agent 说一句「发个帖子：&lt;标题&gt;」，它会代你发布（任务卡标注来源 · 管理位每分钟可发 10 条）。
          </div>
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
          {/* ★ 期6-L2：项目归属（空 = 未归类；也可就地新建） */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: FS.tag, color: C.dim }}>项目</span>
            <select
              value={projId}
              onChange={(e) => setProjId(e.target.value)}
              style={{ ...inputStyle, width: 'auto', flex: 1, minWidth: 140 }}
            >
              <option value="">未归类</option>
              {shownProjects.filter((p) => p.status !== 'archived').map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.name}（{p.taskCount ?? 0}）
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setProjNew((v) => !v)} disabled={busy} style={btnStyle(false)}>
              {projNew ? '取消' : '＋ 新项目'}
            </button>
          </div>
          {projNew ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onCreateProject() }}
                placeholder="项目名，如「财税专家工作台」"
                style={inputStyle}
              />
              <button type="button" onClick={onCreateProject} disabled={busy || projName.trim().length === 0} style={btnStyle(true)}>
                建
              </button>
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button type="button" onClick={onPublish} disabled={busy || title.trim().length === 0} style={btnStyle(true)}>
              发布
            </button>
          </div>
        </div>
      ) : null}

      {/* 块 C · 求助中（折叠）：读不到就说读不到，不假装 0 条 */}
      {openBlocked && blocked.kind === 'err' ? (
        <div style={{ ...cardStyle, marginBottom: 8, fontSize: FS.small }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>求助列表读不到</div>
          <div style={{ color: LAMP_COLOR.amber }}>{blocked.message}</div>
          <div style={{ color: C.dim, fontSize: FS.tag, marginTop: 2 }}>{blocked.code}</div>
        </div>
      ) : null}
      {openBlocked && blocked.kind === 'ok' ? (
        <div style={{ ...cardStyle, marginBottom: 8 }}>
          <div style={{ fontSize: FS.small, fontWeight: 600, marginBottom: 4 }}>求助中 {blocked.rows.length}</div>
          {blocked.rows.length === 0 ? (
            <div style={{ fontSize: FS.small, color: C.dim }}>没有求助。</div>
          ) : (
            blocked.rows.map((row, i) => {
              const id = rowId(row)
              return (
                <div
                  key={id.length > 0 ? id : `blocked-${i}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: FS.small }}
                >
                  <span style={{ fontWeight: 600 }}>{rowTitle(row)}</span>
                  <span
                    style={{
                      color: C.dim,
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={rowReason(row)}
                  >
                    {rowReason(row)}
                  </span>
                  <button
                    type="button"
                    disabled={busy || id.length === 0}
                    onClick={() => void run(async () => unblockTask(id), '已解除求助')}
                    style={btnStyle(false)}
                  >
                    解除
                  </button>
                </div>
              )
            })
          )}
        </div>
      ) : null}

      {/* 块 D · 待我审批（折叠）：动作在任务卡片上，这里只列清单 */}
      {openPending && pending.kind === 'err' ? (
        <div style={{ ...cardStyle, marginBottom: 8, fontSize: FS.small }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>待审批列表读不到</div>
          <div style={{ color: LAMP_COLOR.amber }}>{pending.message}</div>
          <div style={{ color: C.dim, fontSize: FS.tag, marginTop: 2 }}>{pending.code}</div>
        </div>
      ) : null}
      {openPending && pending.kind === 'ok' ? (
        <div style={{ ...cardStyle, marginBottom: 8 }}>
          <div style={{ fontSize: FS.small, fontWeight: 600, marginBottom: 4 }}>待我审批 {pending.rows.length}</div>
          {pending.rows.length === 0 ? (
            <div style={{ fontSize: FS.small, color: C.dim }}>没有等你审批的任务。</div>
          ) : (
            pending.rows.map((row, i) => {
              const id = rowId(row)
              return (
                <div
                  key={id.length > 0 ? id : `pending-${i}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: FS.small }}
                >
                  <span style={{ fontWeight: 600 }}>{rowTitle(row)}</span>
                  <span style={{ color: C.dim, fontSize: FS.tag }}>{statusText(str(row.status) || 'submitted')}</span>
                </div>
              )
            })
          )}
          <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 4 }}>在下方任务卡片上「通过 / 驳回」。</div>
        </div>
      ) : null}

      {/* 提示 */}
      {notice !== null ? (
        <div style={{ fontSize: FS.small, color: '#16a34a', marginBottom: 6 }}>{notice}</div>
      ) : null}

      {/* ★ 2026-10-21：按项目筛选 —— 「这个项目现在到哪了」一眼看到底 */}
      {projErr !== null ? (
        <div style={{ ...cardStyle, marginBottom: 6, borderColor: '#e5b4b4', fontSize: FS.tag, color: '#9b2c2c' }}>
          项目清单读不到（{projErr.code}）：{projErr.message}
        </div>
      ) : null}
      {shownProjects.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: FS.tag, color: C.dim }}>项目</span>
          {/* ★ 2026-10-21 阿开：「任务页要能看到有哪些项目、各几个任务」——
              下拉要展开才看得见 ⇒ 改成一排项目卡片，一眼扫完。 */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1 }}>
            <ProjectChip active={projFilter === ''} onClick={() => setProjFilter('')}>
              全部 · {tasks.length}
            </ProjectChip>
            {projects.filter((p) => p.status !== 'archived').map((p) => (
              <ProjectChip
                key={p.projectId}
                active={projFilter === p.projectId}
                onClick={() => setProjFilter(p.projectId)}
              >
                {p.name} · {p.taskCount ?? 0}
              </ProjectChip>
            ))}
            {tasks.filter((t) => !t.projectId).length > 0 ? (
              <ProjectChip active={projFilter === '__none__'} onClick={() => setProjFilter('__none__')}>
                未归类 · {tasks.filter((t) => !t.projectId).length}
              </ProjectChip>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ★ 2026-10-21：选中项目后给一条**项目条** —— 项目名 + 规模 + 申请审计。
          原来按钮挤在下拉右边，阿开说「选了项目没找到按钮」⇒ 挪到这里，实心更显眼。 */}
      {projFilter !== '' && projFilter !== '__none__' ? (
        <div style={{
          ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, marginBottom: 6, padding: '9px 12px',
        }}>
          <span style={{ fontSize: FS.tag, color: C.dim }}>
            <b style={{ color: 'inherit' }}>{shownProjects.find((p) => p.projectId === projFilter)?.name ?? projFilter}</b>
            {' · '}
            {visibleTasks.length} 个任务
          </span>
          {/* ★ 2026-10-21 阿开：「申请审计按钮搬到项目归档按钮旁边更方便」
              —— 送审本来就要求先归档，两个动作是一对，放一起才顺手。
              这里只留项目名与规模，按钮统一在项目卡片上。 */}
        </div>
      ) : null}

      {/* ★ 一键挂载：审计结论（四灯场景 + 资料预检；报告带 Ed25519 签名可验） */}
      {audit !== null ? (
        <div style={{ ...cardStyle, marginBottom: 6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: FS.small }}>
            {audit.status === 'queued' || audit.status === 'running'
              ? '⏳ 审计中 —— 四灯在看资料，几分钟'
              : audit.report?.verdict === 'pass'
                ? '✅ 审计通过'
                : audit.report?.verdict === 'fail'
                  ? '❌ 审计没通过'
                  : audit.report?.verdict === 'warn'
                    ? '⚡ 有条件通过（有需要处理的提醒）'
                    : '审计未完成'}
          </div>
          {audit.report?.summary ? (
            <div style={{ fontSize: FS.tag, color: C.dim, whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', lineHeight: 1.6 }}>
              {String(audit.report.summary).slice(0, 3000)}
            </div>
          ) : null}
          {audit.report?.error ? (
            <div style={{ fontSize: FS.tag, color: '#d97706', marginTop: 4 }}>
              场景未跑完：{String(audit.report.message || audit.report.error)}
            </div>
          ) : null}
          <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 6 }}>
            审计单 {audit.id}（结论可验签）
          </div>
        </div>
      ) : null}

      {/* 未接入 / 出错 */}
      {err !== null ? (
        <div style={{ ...cardStyle, fontSize: FS.small, color: err.code === 'not_configured' ? C.dim : '#d97706' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {err.title ?? (err.code === 'not_configured' ? '任务面板还没接服务端' : '任务读不到')}
          </div>
          <div>{err.message}</div>
        </div>
      ) : data === null ? (
        <div style={{ ...cardStyle, color: C.dim, fontSize: FS.small }}>正在读取任务…</div>
      ) : visibleTasks.length === 0 ? (
        <div style={{ ...cardStyle, color: C.dim, fontSize: FS.small }}>
          {tasks.length === 0 ? '还没有任务 —— 点右上「＋ 新任务」发第一条。' : '这个项目下还没有任务（换「全部」看看别的）。'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {TASK_SECTIONS.map((sec) => {
            const list = visibleTasks.filter((t) => sec.match(t, myId))
            const open = openSec[sec.key] ?? sec.openByDefault
            return (
              <div key={sec.key}>
                <button
                  type="button"
                  onClick={() => setOpenSec((p) => ({ ...p, [sec.key]: !open }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: '3px 2px', fontFamily: 'inherit', fontSize: FS.tag, color: C.dim,
                  }}
                >
                  <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>›</span>
                  <b style={{ color: list.length > 0 ? undefined : C.dim }}>{sec.title}</b>
                  <span>{list.length}</span>
                </button>
                {open ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    {list.length === 0 ? (
                      <div style={{ ...cardStyle, fontSize: FS.tag, color: C.dim }}>{sec.empty}</div>
                    ) : (
                      list.map((t) => (
                        <CardBoundary key={t.task_id}>
                          <TaskCard task={t} myId={myId} busy={busy} run={run} projectName={projectNameOf(t.projectId)} />
                        </CardBoundary>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* ★ 期6-L2 · 项目（长期实体：归档 = 打包全部资料 + manifest；不删原件） */}
      {projects.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: FS.title, fontWeight: 600 }}>项目</div>
            <span style={{ fontSize: FS.tag, color: C.dim }}>{projects.length}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: FS.tag, color: C.dim }}>归档 = 打包资料 + 清单，不删原件</span>
          </div>
          {projNotice ? (
            <div style={{ ...cardStyle, marginBottom: 6, fontSize: FS.small }}>{projNotice}</div>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.map((p) => (
              <div key={p.projectId} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: FS.small, fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: FS.tag, color: C.dim }}>{p.taskCount ?? 0} 个任务</span>
                {p.status === 'archived' ? (
                  <span style={{ fontSize: FS.tag, color: '#8a6d3b' }}>已归档（资料照旧，随时能取消）</span>
                ) : null}
                <span style={{ flex: 1 }} />
                {/* ★ 2026-10-21 阿开：
                    ① 归档之后按钮不该还是「归档」⇒ 换「取消归档」
                    ② 「下载资料 + 清单」应该紧挨着归档之后 ⇒ 归档后出现下载按钮
                    ⇒ 归档与取消归档是**一对状态**，下载只在有包时才出现。 */}
                {p.status === 'archived' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void requestAudit(p.projectId)}
                      disabled={busy || (audit !== null && (audit.status === 'queued' || audit.status === 'running'))}
                      style={{
                        padding: '5px 11px', borderRadius: 6, border: 'none',
                        background: audit !== null && (audit.status === 'queued' || audit.status === 'running') ? 'rgba(0,0,0,.12)' : '#1f2937',
                        color: '#fff', cursor: busy ? 'default' : 'pointer',
                        fontSize: FS.tag, fontWeight: 600, whiteSpace: 'nowrap',
                      }}
                      title="把这份定稿送去审 —— 四灯审完给一份带密码学签名的报告"
                    >
                      {audit !== null && (audit.status === 'queued' || audit.status === 'running') ? '审计中…' : '🔍 申请审计'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownloadArchive(p)}
                      disabled={busy}
                      style={btnStyle(true)}
                      title="下载归档包：压缩文件 + manifest.json 清单（谁交的 / 什么时候 / 多大 / sha256）"
                    >
                      ⬇ 下载归档包
                    </button>
                    <button
                      type="button"
                      onClick={() => onUnarchive(p)}
                      disabled={busy}
                      style={btnStyle(false)}
                      title="取消归档：项目回到列表，任务与资料都不动"
                    >
                      取消归档
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onArchive(p)}
                      disabled={busy}
                      style={btnStyle(true)}
                      title="打包这个项目的全部任务资料 + manifest 清单（不删原件）"
                    >
                      归档
                    </button>
                    <button
                      type="button"
                      onClick={() => void requestAudit(p.projectId)}
                      disabled={busy}
                      style={btnStyle(false)}
                      title="送审要求先归档 —— 点它会提示你先归档，定稿后再送"
                    >
                      🔍 申请审计
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
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

/** 交付内容收起时的单行摘要 —— 列表里只要「是什么」，不要「全文」 */
function shortResult(v: unknown): string {
  /* ★ 2026-10-19：这个函数在 render 里跑 —— **它抛一次，整片任务列表就没了**。
     所以先把输入变成字符串这一步也包进 try（undefined/Symbol/循环引用都会抛）。 */
  let s = ''
  try { s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v) } catch { s = String(v) }
  try {
    const o = JSON.parse(s)
    // 常见的交付结构：先取一句人话，取不到再退回原文
    if (o && typeof o === 'object') {
      s = String(o.detail || o.summary || o.message || o.verdict || s)
    }
  } catch { /* 不是 JSON，按原文处理 */ }
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > 56 ? s.slice(0, 56) + '…' : s
}

/** 展开时：JSON 缩进显示（可读），非 JSON 原样 */
function prettyResult(v: unknown): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v)
    try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
  } catch { return '' }
}

/**
 * ★★ 2026-10-19 阿开：「v0.2.8 处故障了，任务看不到了」
 *    React 的行为是：**渲染里抛一次异常，整棵子树被卸载** ——
 *    于是「一张卡的内容格式怪」会表现成「所有任务都不见了」。
 *    ⇒ 每张卡自己兜住：坏的那张写一句人话，别连累别的。
 *    ★ 判据：列表里每一项的渲染，都不该有能力让整个列表消失。
 */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  componentDidCatch(e: Error, info: ErrorInfo): void {
    // 只留一行：知道是哪张卡、什么错，不刷屏
    console.warn('[kaipu] 任务卡渲染失败：', e?.message, info?.componentStack?.slice(0, 200))
  }
  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div style={{ fontSize: FS.tag, color: C.faint, padding: '6px 10px',
                      border: `1px dashed ${C.border}`, borderRadius: 6 }}>
          这张卡的内容格式异常，显示不出来（其它任务不受影响）
        </div>
      )
    }
    return this.props.children
  }
}

function TaskCard(props: {
  task: TaskUi
  myId: string | null
  busy: boolean
  /** ★ 期6-L2：所属项目名（空 = 未归类） */
  projectName?: string
  run: (fn: () => Promise<{ ok: boolean; code?: string; message?: string }>, okMsg?: string) => Promise<void>
}): ReactElement {
  const { task, myId, busy, run } = props
  const st = normStatus(task.status)
  const tone = statusTone(task.status)
  /**
   * 行内输入（求助原因 / 驳回意见）。
   * ★ 不用 `window.prompt`：Electron 渲染进程里 `prompt()` 不支持（静默返回 null），
   *   会让「求助」按钮看上去点了没反应。行内输入在 DSH 各宿主里都能用。
   */
  const [ask, setAsk] = useState<null | 'block' | 'reject' | 'done'>(null)
  /* ★ 2026-10-20 阿开：「交付弹窗边框太靠右，没居中」。
     宿主容器若带 transform / containment，`position:fixed` 会退化成「相对该祖先」而不是视口
     ⇒ 卡片肉眼偏右。这里不猜宿主结构，直接用实测 rect 把卡片拉回视口中心（本来居中则不动）。 */
  const dlgRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (ask !== 'done') return
    const el = dlgRef.current
    if (el === null) return
    const fix = (): void => {
      const r = el.getBoundingClientRect()
      const dx = window.innerWidth / 2 - (r.left + r.width / 2)
      const dy = window.innerHeight / 2 - (r.top + r.height / 2)
      el.style.transform = (Math.abs(dx) > 2 || Math.abs(dy) > 2)
        ? `translate(${Math.round(dx)}px, ${Math.round(dy)}px)` : ''
    }
    const t = window.setTimeout(fix, 0)
    window.addEventListener('resize', fix)
    return () => { window.clearTimeout(t); window.removeEventListener('resize', fix) }
  }, [ask])
  const [askText, setAskText] = useState('')
  /* ★ 2026-10-19 阿开：「先显示标题，点开才是详情；还要有复制按钮」
     默认收起 —— 十条任务铺满一屏时，先看标题才选得动。 */
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  /** ★ 2026-10-20 阿开：「Agent 已经把交付说明写上去了，提交还要再写一遍」
      ⇒ 有附件时说明可空（服务端判据就是「有附件 或 ≥100 字」，前端不该更严）。 */
  const hasFiles = (task.fileCount ?? 0) > 0

  /* ★ 期6-L1（2026-10-20）：从任务卡直达「这次任务的附件」
     —— 约定 interactionId = 服务端回的 `interactionId`（= task-<id>）；
        资料区收到事件后切换并刷新。这样「哪次任务的附件」不再靠人脑记。 */
  const openPack = (): void => {
    if (typeof window === 'undefined') return
    const iid = task.interactionId || `task-${task.task_id}`
    window.dispatchEvent(new CustomEvent('kaipu:open-pack', {
      detail: { interactionId: iid, title: task.title },
    }))
  }

  /* ★★ 2026-10-20 阿开：「领取和复制重了 —— 领取就是复制」
     ⇒ 合并成一个按钮：未领取时叫「领取并复制」（高亮），领取后叫「复制」。
     理由：人点这一下本来就是要「把任务交给 Agent」，复制是目的、领取是副作用；
           拆成两个按钮，等于让人做两步才完成一件事。
     ★ 复制内容里带上 taskId + 交付命令 —— Agent 拿到就能直接 claim/交付。 */
  const copyTask = async (): Promise<void> => {
    const text = [
      task.detail ? `${task.title}\n\n${task.detail}` : task.title,
      '',
      `—— 工位任务 ID：${task.task_id}`,
      `干完直接交：kai-pu-deliver.py --task ${task.task_id} --claim --attach <产物路径> --text "<结论>"`,
    ].join('\n')
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    try {
      if (nav?.clipboard?.writeText) await nav.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* 剪贴板不可用时静默 —— 按钮本身仍完成了领取 */ }
  }

  const submitAsk = (): void => {
    const text = askText.trim()
    if (ask === null) return
    if (ask === 'block') {
      if (text.length === 0) return /* ★ 原因必须是用户输入，空不发 */
      void run(async () => blockTask(task.task_id, text), '已发起求助')
    } else if (ask === 'done') {
      /* ★★ 2026-10-19 阿开：「点击完成按钮之后就显示：任务读不到 / 服务端返回 400」
         ⇒ 根因：完成按钮写死了 `finishTask(id, '')` —— 空交付。
           服务端交付闸是对的（没附件就至少 100 字），但**前端不该在用户不知情时交空**。
         ⇒ 改成：点「完成」先展开交付框，**把话写进去**再提交。
           判据：凡是服务端会拒的输入，就不该由界面预先填成一个必被拒的值。 */
      if (text.length === 0) return
      void run(async () => finishTask(task.task_id, text), '已交付')
    } else {
      void run(async () => rejectTask(task.task_id, myId ?? '', text), '已驳回')
    }
    setAsk(null)
    setAskText('')
  }

  return (
    <div style={{ ...cardStyle, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: tone, flex: '0 0 auto' }} />
        <span
          onClick={() => setOpen((v) => !v)}
          title={open ? '收起详情' : '点开看详情'}
          style={{ fontSize: FS.small, fontWeight: 600, flex: 1, minWidth: 0, cursor: 'pointer' }}
        >
          {open ? '▾ ' : '▸ '}{task.title}
        </span>
        <span style={{ fontSize: FS.small, color: tone }}>{statusText(task.status)}</span>
        {/* ★ 期6-L2：所属项目（未归类不显示，避免噪音） */}
        {props.projectName ? (
          <span
            title={`属于项目「${props.projectName}」`}
            style={{
              fontSize: FS.tag,
              color: C.dim,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: '1px 6px',
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {props.projectName}
          </span>
        ) : null}
        {/* ★ 期6-L1：这次任务的附件数（0 也显示 ⇒ 可从这里直接去上传，天然归属该任务） */}
        <button
          type="button"
          onClick={openPack}
          title={(task.fileCount ?? 0) > 0
            ? `看「${task.title}」的附件（${task.fileCount} 个）`
            : '这次任务还没有附件；点开资料区即可上传到该任务'}
          style={{
            ...btnStyle((task.fileCount ?? 0) > 0),
            padding: '2px 8px',
            fontSize: FS.tag,
            minWidth: 48,
          }}
        >
          📎 {task.fileCount ?? 0}
        </button>
        <button
          type="button"
          onClick={() => { void (async () => {
            // 未领取 ⇒ 先领取（原子占位），再复制；已领取/在干 ⇒ 只复制
            if (st === 'posted') await run(async () => claimTask(task.task_id), '已领取')
            await copyTask()
          })() }}
          title={st === 'posted' ? '领取这条任务，并把任务内容复制给 Agent' : '复制这条任务的标题和内容'}
          style={{
            /* ★ 2026-10-20 阿开：「领取并复制 白字看不清，背景调成交付一样的蓝底」
               ⇒ 不再依赖 `undefined` 去“沿用” btnStyle 的底色，直接写死：
                 主态＝C.accent（与「交付」同一个蓝）+ 纯白字；复制成功＝绿底白字。 */
            ...btnStyle(true),
            padding: '2px 8px',
            fontSize: FS.tag,
            minWidth: 62,
            background: copied ? '#1f7a3d' : C.accent,
            color: '#ffffff',
            border: '1px solid transparent',
            ...(st === 'posted' || copied ? {} : {
              background: 'transparent', color: C.text, border: `1px solid ${C.border}`,
            }),
            transition: 'background 160ms',
          }}
        >
          {copied ? '✓ 已复制' : st === 'posted' ? '领取并复制' : '复制'}
        </button>
      </div>
      {/* ★ 2026-10-21 阿开：「待领和已完成加日期+时间」—— 按状态取对应时间戳（见 taskWhen） */}
      {(() => {
        const when = taskWhen(task, st)
        if (when === null) return null
        const shown = fmtWhen(when.at)
        if (shown === '') return null
        return (
          /* ★ 2026-10-21 阿开：「发布人和发布日期上下 2 行小字就可以了」
             ⇒ 拆两行、紧凑行高（不额外撑高卡片）。 */
          <div style={{ fontSize: FS.tag, color: C.faint, marginTop: 3, paddingLeft: 14, lineHeight: 1.45 }}>
            {task.createdByName !== undefined && task.createdByName !== ''
              ? <div>发布人：{task.createdByName}</div> : null}
            <div>{when.label}：{shown}</div>
          </div>
        )
      })()}
      {open && task.detail ? (
        <div style={{
          fontSize: FS.small, color: C.dim, marginTop: 4, whiteSpace: 'pre-wrap',
          maxHeight: 260, overflow: 'auto',
        }}>{task.detail}</div>
      ) : null}
      {/* ★★ 2026-10-19 阿开：「已完成的任务就会不折叠显示很多代码」
          ⇒ 根因：`detail` 跟着 `open` 折叠，**`result` 没有** —— 已完成的任务
            正好都有 result，于是每一条都把整段交付（常常是 JSON）摊在列表里。
          ⇒ 修法：result 也跟 `open` 走；收起时只给一行摘要。
          ★ 这是「折叠只折了一半」的典型 —— 加了折叠就要把**同类字段全数一遍**。 */}
      {task.result ? (
        open ? (
          <div style={{
            fontSize: FS.small, color: C.dim, marginTop: 6, whiteSpace: 'pre-wrap',
            maxHeight: 320, overflow: 'auto',
            background: 'rgba(0,0,0,.03)', borderRadius: 4, padding: '6px 8px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.5,
          }}>
            {prettyResult(task.result)}
          </div>
        ) : (
          <div style={{
            fontSize: FS.tag, color: C.faint, marginTop: 4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={String(task.result)}>
            交付：{shortResult(task.result)}
          </div>
        )
      ) : null}
      <div style={{ display: ask !== null ? 'none' : 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {/* ★★ 2026-10-20 阿开：「领取和复制重了」⇒ 「领取」已合并进上方的「领取并复制」，
            这里不再渲染第二个领取入口。 */}
        {/* ★ 2026-10-19 阿开：「开始按钮是干嘛用的，不点有必要留着吗」
            ⇒ 没有。服务端 `task_transition` 交付允许 claimed 与 in_progress 两种来源
              （claimed 直接交是合法的），所以「开始」只是一道仪式。
              小铺子里两三个人干一个项目，多一个必点按钮只增加忘记点的风险。
              原按钮删掉，领了就能直接「交付」。 */}
        {/* ★★ 2026-10-19：删掉「开始」之后，`claimed` 就成了**没有出口的状态** ——
            服务端允许 claimed 直接交付，但按钮只在 in_progress 渲染。
            ⇒ 两种活动态都给「交付」入口。 */}
        {/* ★★ 2026-10-19 阿开：「又有完成按钮，又有提交交付按钮，有点复杂，乱了」
            ⇒ 对。两个按钮同时在屏上，看起来像「先完成、再交付」两步 —— 其实是一件事。
            ⇒ 同一时刻只留一个：没展开时叫「交付」，展开后交给输入框里的「提交」。
            ★ 判据：同一件事在同一个屏幕上，不该有两个入口。 */}
        {(st === 'in_progress' || st === 'claimed') && ask !== 'done' ? (
          <button
            type="button"
            onClick={() => {
              setOpen(true)
              setAsk('done')
              /* ★ 2026-10-20 阿开：Agent 已写好交付说明 ⇒ 带入，人来「审核确认」而不是重写。
                 优先 result（已提交的交付内容），其次 detail（Agent 写的任务说明）。 */
              setAskText(String(task.result ?? task.detail ?? '').trim())
            }}
            disabled={busy}
            style={btnStyle(true)}
          >
            交付
          </button>
        ) : null}
        {st === 'claimed' || st === 'in_progress' ? (
          <button
            type="button"
            onClick={() => {
              setAsk('block')
              setAskText('')
            }}
            disabled={busy}
            style={btnStyle(false)}
          >
            求助
          </button>
        ) : null}
        {st === 'blocked' ? (
          <button
            type="button"
            onClick={() => void run(async () => unblockTask(task.task_id), '已解除求助')}
            disabled={busy}
            style={btnStyle(true)}
          >
            解除求助
          </button>
        ) : null}
        {st === 'submitted' && canApprove(task, myId) ? (
          <>
            <button
              type="button"
              onClick={() => void run(async () => approveTask(task.task_id, myId ?? '', ''), '已通过')}
              disabled={busy}
              style={btnStyle(true)}
            >
              通过
            </button>
            <button
              type="button"
              onClick={() => {
                setAsk('reject')
                setAskText('')
              }}
              disabled={busy}
              style={btnStyle(false)}
            >
              驳回
            </button>
          </>
        ) : null}
      </div>
      {ask !== null ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: ask === 'done' ? 'stretch' : 'center', flexDirection: ask === 'done' ? 'column' : 'row' }}>
          {ask === 'done' ? (
            /* ★ 2026-10-20 阿开：「窗口太小，能不能做成弹窗页面大一些方便浏览」
               ⇒ 全屏遮罩 + 居中大卡片（宽 760、正文区 260+ 高），点遮罩/取消关闭。 */
            <div
              onClick={(e) => { if (e.target === e.currentTarget) { setAsk(null); setAskText('') } }}
              style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.45)',
                       display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            >
              <div ref={dlgRef} style={{ width: 'min(760px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
                            gap: 10, padding: 18, borderRadius: 12, border: `1px solid ${C.border}`,
                            background: 'var(--dsh-bg, #fff)', boxShadow: '0 16px 48px rgba(0,0,0,.35)' }}>
                <div style={{ fontSize: FS.heading, fontWeight: 600, lineHeight: 1.4 }}>交付 · {task.title}</div>
                <div style={{ fontSize: FS.tag, color: C.dim }}>
                  {hasFiles ? `这个任务已有 ${task.fileCount} 个附件 · 说明可以留空` : '这个任务没有附件 · 需要至少 100 字说明'}
                </div>
                {(() => {
                  const fromResult = String(task.result ?? '').trim()
                  const fromDetail = String(task.detail ?? '').trim()
                  const prefill = fromResult || fromDetail
                  if (!prefill || askText.trim() !== prefill) return null
                  return (
                    <div style={{ fontSize: FS.tag, color: C.dim, lineHeight: 1.5 }}>
                      {fromResult
                        ? '已带入 Agent 提交的交付说明 —— 你在这里做的是审核确认（可直接提交，也可改后提交）'
                        : '已带入任务说明（Agent 若另有交付结果，请替换成结果）—— 确认后提交'}
                    </div>
                  )
                })()}
                <textarea
                  autoFocus
                  value={askText}
                  onChange={(e) => setAskText(e.target.value)}
                  rows={14}
                  placeholder={hasFiles
                    ? '可选：补充说明（这个任务已有附件，说明可以留空，也可写结论/遗留）'
                    : '交付说明：做了什么、结论是什么、还差什么（至少 100 字）'}
                  style={{ width: '100%', flex: 1, minHeight: 260, padding: 10, borderRadius: 8,
                           border: `1px solid ${C.border}`, background: 'transparent', color: C.text,
                           fontSize: FS.base, lineHeight: 1.6, resize: 'vertical',
                           /* ★ 2026-10-20 阿开：「蓝色边框歪了」。
                              ① 缺 boxSizing ⇒ width:100% 再加 padding/border 会右侧溢出 ~22px，蓝框被卡片裁掉；
                              ② autoFocus 时浏览器默认 outline 画在盒外 ⇒ 更明显。
                              ⇒ border-box + outlineOffset:-1（描边画在边框内侧）。 */
                           boxSizing: 'border-box', outlineOffset: -1 }}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: FS.tag, color: (hasFiles || askText.trim().length >= 100) ? '#16a34a' : C.faint }}>
                    {hasFiles ? `有附件 ${task.fileCount} 个 · 说明可留空` : `${askText.trim().length} / 100`}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={submitAsk}
                    disabled={busy || (!hasFiles && askText.trim().length < 100)} style={btnStyle(true)}>
                    确认交付
                  </button>
                  <button type="button" onClick={() => { setAsk(null); setAskText('') }} disabled={busy} style={btnStyle(false)}>
                    取消
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
          <input
            autoFocus
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAsk()
              if (e.key === 'Escape') {
                setAsk(null)
                setAskText('')
              }
            }}
            placeholder={ask === 'block' ? '求助原因（必填）' : '驳回意见（可空）'}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={submitAsk}
            disabled={busy || (ask === 'block' && askText.trim().length === 0)}
            style={btnStyle(true)}
          >
            {ask === 'block' ? '提交求助' : '确认驳回'}
          </button>
            </>
          )}
          {ask === 'done' ? null : (
          <button
            type="button"
            onClick={() => {
              setAsk(null)
              setAskText('')
            }}
            disabled={busy}
            style={btnStyle(false)}
          >
            取消
          </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
