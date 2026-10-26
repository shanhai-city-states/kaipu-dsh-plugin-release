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
  renameProject,
  /* ★★ 2026-10-26「Agent 版 OA」三件套：项目阶段（推进/退回） */
  setProjectPhase,
  loadPackInteractions,
  type ProjectItem,
  deleteOrgNode,
  checkPluginVersion,
  clearAgents,
  evictSeat,
  resetAgentKey,
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
/* ★ 083-r1（派活点名通知 + 卡片人数显示）：同样抽成纯函数，判据直接跑输入→输出。 */
import {
  agentChoices,
  extraHolderBadge,
  extraHolderTitle,
  holderUnknownText,
  isNotifyUnsupported,
  NOTIFY_DEGRADED_NOTICE,
  NOTIFY_LABEL,
  NOTIFY_PUBLIC_LABEL,
  NOTIFY_PUBLIC_VALUE,
  notifyFailText,
  notifyPickHint,
  type NotifyChoice,
} from './notify-copy.js'
import { C, FONT, FS, LH } from './theme.js'
import { TaskDepsSection, DeliverableVersionsSection } from './task-deps-ui.js'
/* ★★ 2026-10-26：项目阶段（纯逻辑）—— 顺序即语义，与后端 `PROJECT_PHASES` 同序。
   放在独立件里：判据要能跑 `phaseBar('plan') === '●●○○○○'`，不是 grep 源码。 */
import {
  PROJECT_PHASES,
  phaseIndex,
  phaseLabel,
  phaseHint,
  phaseBar,
  nextPhase,
  prevPhase,
  isArchivedPhase,
} from './project-phase.js'
import { PLUGIN_VERSION } from './version.js'
/* ★★ 2026-10-26：席位数量总览（纯逻辑，可单测）。
   抽成独立模块而不是写在组件里：判据要能真跑输入→输出，
   写在 JSX 里就只能靠肉眼看截图 —— 那种「验证」等于没验。 */
import { countSeatTypes, seatBadge, seatSummary, SEAT_ORDER, SEAT_LABELS, isAdvisorSeat } from './seat-summary.js'
/* ★ 083 第一批（邀请码补发闭环）：文案与纯逻辑抽出去，判据才能**真跑**输入→输出，
   而不是对源码 grep 关键词（星月 R-6：同一张关键词表 = 0 命中，那不是通过，是没测）。 */
import {
  CODE_LOST_TIP,
  CODE_ONCE_TIP,
  CODE_STORED_TIP,
  applicantCodeState,
  applicantView,
  codeStoreKey,
  humanizeJoinError,
  joinGuideText,
  joinRowLabel,
  looksLikeRequestId,
  reqStoreKey,
} from './join-copy.js'
import type { ApplicantCodeState } from './join-copy.js'
/* ★ 083-r2（邀请码列表化）：列表口径 / 明文留存 / 额度与错误人话，全在纯函数里。 */
import {
  batchChoices,
  canCreateMore,
  codeHashOf,
  codeRowView,
  createBlockedTip,
  emptyListText,
  humanizeCodeError,
  isActionable,
  PENDING_LIMIT,
  pendingCount as countPendingCodes,
  plainStoreKey,
  staleHashes,
  type JoinCodeRowLike,
} from './invite-code.js'
/* ★ 083-r3（派活绑定工位）：缩小版工位图与工位页共用同一套取数口径，写在一处。 */
import {
  dotOf,
  humanizePublishError,
  invitedLabel,
  joinStateOf,
  nodeChipLabel,
  nodeChipWho,
  pickerHint,
  publishToast,
  showInvited,
  sortedNodes,
  taskBindingText,
  PUBLIC_POOL_LABEL,
  PUBLIC_POOL_VALUE,
} from './node-pick.js'
import {
  codeLeftText,
  grantCopyText,
  granteeLabel,
  granteeUnknown,
} from './grant-copy.js'
import type {
  BallLamp,
  GrantCodeIssued,
  GrantCreated,
  GrantEvent,
  GrantListPayload,
  GrantRow,
  JoinRequestCreated,
  JoinRequestListPayload,
  JoinRequestRow,
  JoinRequestStatusPayload,
  Member,
  WorkstationState,
} from '@shanhai/kaipu-contract'

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

/** ★ 2026-10-23（083 单 G-3）：`/packs/interactions` 的 client 侧形状。
 *  `title` / `projectName` / `projectId` 是服务端新补的人话字段（可为缺），
 *  缺的时候走兜底文案 —— **永不显示 `interactionId`**。 */
interface PackInteractionItem {
  interactionId: string
  files: number
  seats: number
  lastAt: string
  title?: string
  projectName?: string
  projectId?: string
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
  /** ★ 2026-10-23 新增：该位能坐几人（-1 = 不限） */
  capacity?: number
  /** ★ 新增：实际坐着的 Agent 列表（多席位时全给） */
  occupants?: { id: string; name: string; lastSeen?: string }[]
  /** ★ 新增：是否已满（发邀请前据此禁用按钮，别"先给希望再拒"） */
  full?: boolean
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

/* ══ ★★ 2026-10-23 · 管理助理授权（承响石 018 号方案 + A/B/C/D 拍板）
   ★ 类型定义已上移到 `@shanhai/kaipu-contract/workstation` —— 全仓契约唯一出处。
     host 侧 `service.ts` 也要用同一份形状，放在客户端文件里它 import 不到。 ══ */

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
  //   「最轻的铲子」= 第一屏只有一个动作。tab 从 6 个收到 3+1。
  // ★ 2026-10-22 晚（阿开）：「打开或者安装工位插件默认显示第一页工位页面，
  //   按钮排序按流程逻辑：工位 — 任务 — 资料 — 更多」
  //   ⇒ 默认落地「工位」（先看到自己在哪个位、铺子里有谁），顺序即干活动线。
  const [tab, setTab] = useState<'work' | 'tasks' | 'pack' | 'upload' | 'notif' | 'help' | 'device' | 'more'>('work')
  /* ★ 2026-10-21 阿开：从工位页点「🔑 设备」跳过来时，自动展开「高级」（设备台账在里面）
     ★★ 2026-10-24：设备台账 10-22 已移出资料页、「上传选项」折叠区同日撤掉
        ⇒ advTick 整条展开链已无消费者，状态本身一并删除。 */
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
        {tab !== 'tasks' && tab !== 'pack' && tab !== 'work' && tab !== 'device' && tab !== 'more' ? (
          <button
            type="button"
            onClick={() => setTab('more')}
            style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: FS.small }}
          >
            ←
          </button>
        ) : null}
        {([['work', '工位'], ['tasks', '任务'], ['pack', '资料'], ['device', '设备码'], ['more', '更多']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: FS.small,
              whiteSpace: 'nowrap',
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
      ) : tab === 'device' ? (
        <DeviceTab />
      ) : tab === 'tasks' ? (
        <TaskSection />
      ) : tab === 'pack' ? (
        <PackSection onUpload={() => setTab('upload')} focus={packFocus} />
      ) : tab === 'upload' ? (
        <UploadTab onDone={() => setTab('pack')} />
      ) : (
        <>
          {/* ★ 2026-10-19 阿开：「本地持久化态/来源 scaffold/座位 5 位…是什么意思，有必要留着吗」
               —— 那些是期1 开发期的诚实标注，读的是 scaffold 演示数据（发起人位/协作方甲乙丙）。
                  现在真工位、真任务、真资料三条链都通了，留着只会让人以为是系统状态 ⇒ 整块撤下。
                  面板只留能真改的三块：工位 / 任务 / 资料。 */}
          {/* ★ 2026-10-22 阿开：这个按钮是「给同事发邀请」的快捷入口 ⇒ 指回资料页（工位加入码在那儿），
              不是「看我自己的设备码」（那个在「设备码」tab 里）。
              ★★ 2026-10-24：加入码现在是资料页常开卡片，不需要「展开」动作 ⇒ 直接跳过去即可。 */}
          <OrgSection onGoDevices={() => { setTab('pack') }} />
          {/* ★★ 2026-10-26 阿开（第三轮）：「管理助理位。既然在这里就显示空，有人的时候
              显示（已安排）…… 支持点击就在下方弹出管理助理（临时代管）的功能介绍和指定功能。
              这样工位下方的席位一览（只读）以及管理助理（临时代管）就可以都取消了」
              ⇒ `ManagementGrantSection` **不再在页面底部单独挂载**，它已搬进
                `SeatSummaryRow` 第 4 行（管理助理位）的下方，点开就地展开。
              ★ 为什么搬家而不是两处都留：位在第 4 格、功能在页面最底 ——
                同一件事两处分置，用户得自己连线；且底部那块让页面越长越散。 */}
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

★ interactionId 不是任务 ID —— 一般就是 task-{任务ID}（任务卡上那串前面加 task-）。
  拿不准就问铺主「这批资料放哪个交互」，别自己猜一个。

### 给 Agent 的三行可跑命令（照着改 4 个值就能用）

    # ① 取值（只算一次）
    TS=$(date +%s)
    SHA=$(sha256sum /path/to/你的文件.zip | cut -d' ' -f1)
    MSG="{agentId}|\${TS}|{accountId}|你的文件.zip|\${SHA}"
    SIG=$(printf '%s' "$MSG" | openssl dgst -sha256 -hmac "{secret}" -r | cut -d' ' -f1)

    # ② 上传（原始字节，不是 base64、不是 multipart）
    curl -sS -X POST "{baseUrl}/packs/task-{任务ID}/files" \
      -H "X-Agent-Id: {agentId}" \
      -H "X-Account-Id: {accountId}" \
      -H "X-Ts: \${TS}" \
      -H "X-Filename: 你的文件.zip" \
      -H "X-Body-Sha256: \${SHA}" \
      -H "X-Sig: \${SIG}" \
      --data-binary @/path/to/你的文件.zip

    # ③ 判据：HTTP 200 且回 {"filename":..., "size":..., "sha256":...}
    #    sha256 一致才算传成功。回 401 ⇒ 签名串或时间戳（±300 秒）错了。

### ★ 两个坑（实证，别踩）

1. **签名串的分隔符是竖线，别写成逗号**：
   msg = {agentId}|{ts}|{accountId}|{filename}|{sha256}
   而领活/交结论用的是**直接拼接无分隔符**：{agentId}{ts} —— 两处不一样，别抄错。
2. **★★ 文件名必须只用 ASCII（这是最常见的 401 来源）**：
   HTTP 头只接受 latin-1 ⇒ 中文名放进 X-Filename 会直接发送失败或乱码；
   服务端还会先 unquote() 再算签名 ⇒ 名字一变，签名就对不上（回 401 却不说是文件名的问题）。
   正确做法：**先重命名成 ASCII 再传**，例如
     cp 你的文件.zip equity-plan-fix-20261022.zip
   中文名写进交活的 detail 里，或在同一交互另传一个说明文件。
3. **★★ 座位决定目录（最容易「传了对方却看不见」的原因）**：
   交互目录按**座位**分开存 —— 你在执行位传，文件就在 execution 下；
   管理位的人看自己的管理位目录，**看不见执行位的文件**（反之亦然）。
   ⇒ 传之前先跟对方确认一句「你在哪个位、我该传到哪个位？」，
     否则传成功了、对方却说「没有附件」，两边都以为对方错了。

## 七、你不能做什么
- 不能改铺子设置、不能审批、不能给别人发任务
- 不能列出/下载已上传的文件（GET 只给铺主；你只能凭上传时返回的 sha256 自证）
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





/** ★ 2026-10-22 阿开：「做成一个指令教程一键复制发给你的 Agent」。
 *  这段话是给 Agent 看的，不是给人看的 —— 所以写成步骤 + 判据 + 失败怎么办。 */
const AGENT_INSTRUCTION = [
  '请帮我安装并使用「山海数据看板」技能，按下面步骤一次做完。',
  '',
  '1) 下载技能包并解压：',
  '   https://agent.ak2029.com/dl084/dashboard-hub.tar.gz',
  '   解压后得到 dashboard-hub 文件夹，整个放进你的技能目录（WorkBuddy / DSH 的用户级 skills 目录）。',
  '',
  '2) 打开 dashboard-hub/hub.json（没有就复制 hub.json.example），保证里面有且只有服务地址：',
  '   {"url": "https://agent.ak2029.com/hub-084"}',
  '   不要手填 token 和 license —— 下一步会自动写进去。',
  '',
  '3) 在 dashboard-hub 目录里运行解锁命令：',
  '   python scripts/hub_dash.py claim',
  '   它会自动读取本机的工位设备凭据，向服务端换取免费授权，并把 token / license 写回 hub.json。',
  '',
  '4) 验证（把 <表格路径> 换成真实文件）：',
  '   python scripts/hub_dash.py profile <表格路径>',
  '   能打印出字段列表就算通了；接着可以 build 出看板、export 成单文件 HTML。',
  '',
  '可能遇到的两件事：',
  '· 报「没找到工位设备凭据」→ 先装并打开一次开铺工位插件（插件市场搜 kaipu-plugin-workstation）并登录，再重跑第 3 步。',
  '· 报「设备校验服务暂时不可用」→ 稍等重试；或让开通方直接发一张 HUB-XXXX-XXXX-XXXX 授权码填进 hub.json 的 license。',
].join('\n')

/* ── 设备码 ──
 * ★ 2026-10-22 阿开：「设备码单独一个 tab 页」「下面介绍参考工位 README 提炼卖点」。
 * ★ 设计取舍（阿开问「解锁串和设备码有什么区别、会不会影响用户选择」）：
 *   两种东西并排 = 用户不知道该点哪个 ⇒ **默认路径必须零决策**。
 *   ⇒ 主区只留「设备码」（身份证，可给人看）；
 *     「解锁串」（身份证+钥匙）收进「手动方式」折叠，只在自动识别失败时才用。
 */
function DeviceTab(): ReactElement {
  const [cred, setCred] = useState<{ deviceId: string; deviceSecret: string } | null>(null)
  const [done, setDone] = useState('')
  const [manual, setManual] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetMsg, setResetMsg] = useState('')
  /* ★ 2026-10-22（丙）：铺主可剔除 —— 「后悔分享出去」的入口就在这里。
     默认收起，不影响普通用户看自己那一行码。 */
  type DRow = {
    deviceId: string; fpHash8: string; fpHash: string; status: string
    clientVersion: string; firstSeen: string | null; lastSeen: string | null; issueCount: number
  }
  const [devs, setDevs] = useState<{ items: DRow[]; count: number; activeCount: number } | null>(null)
  const loadDevs = async (): Promise<void> => {
    const r = await callPack<{ items: DRow[]; count: number; activeCount: number }>('devicesList', {})
    if (r.ok) setDevs(r.data)
  }
  useEffect(() => { void loadDevs() }, [])
  const revoke = (row: DRow, off: boolean): void => {
    void callPack<{ fpHash8: string; status: string }>('deviceRevoke', { fpHash: row.fpHash8, revoked: off })
      .then((r) => { if (r.ok) void loadDevs() })
  }
  useEffect(() => {
    void callActionData<{ deviceId: string; deviceSecret: string } | null>('deviceCred', {}).then((r) => {
      if (r.ok) setCred(r.data)
    })
  }, [])

  /* ★ 2026-10-22（丙）：本人主动重置设备码 —— 旧 secret 立刻作废，页面还是一条码。 */
  const doReset = (): void => {
    setResetBusy(true); setResetMsg('')
    void callActionData<{ deviceId: string; deviceSecret: string; expiresAt?: string }>(
      'deviceResetSecret', {},
    ).then((r) => {
      setResetBusy(false)
      if (r.ok) {
        setCred({ deviceId: r.data.deviceId, deviceSecret: r.data.deviceSecret })
        setResetMsg(r.data.expiresAt ? `已换新码 · 有效至 ${String(r.data.expiresAt).slice(0, 10)}` : '已换新码')
      } else {
        setResetMsg(`重置失败：${r.message || r.code || '未知原因'}`)
      }
    })
  }

  const copy = (text: string, tag: string): void => {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator
    void nav?.clipboard?.writeText(text).then(() => {
      setDone(tag)
      setTimeout(() => setDone(''), 1600)
    })
  }

  const point = (t: string, d: string): ReactElement => (
    <div style={{ marginBottom: 7 }}>
      <span style={{ color: C.text, fontWeight: 600 }}>{t}</span>
      <span style={{ color: C.dim }}> —— {d}</span>
    </div>
  )

  return (
    <Section title="设备码">
      {cred === null ? (
        <div style={{ fontSize: FS.small, color: C.dim, lineHeight: LH.normal }}>
          还没有登记设备。先在工位里完成一次登录，这里就会出现本机设备码。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: FS.small, color: C.dim, lineHeight: LH.normal }}>
            这是这台机器的<b style={{ color: C.text }}>身份证</b> —— 报备、核对、排查时说给对方听的就是它，不涉密。
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <code style={{ fontSize: FS.small, padding: '3px 9px', border: `1px solid ${C.border}`, borderRadius: 6 }}>
              {cred.deviceId}
            </code>
            <button type="button" onClick={() => copy(cred.deviceId, 'id')} style={{ ...btnStyle(false), fontSize: FS.small }}>
              {done === 'id' ? '已复制' : '复制设备码'}
            </button>
            {/* ★ 2026-10-22（丙）：设备丢了/借人了/怕泄露 —— 一键换新，旧码立刻作废 */}
            <button
              type="button"
              onClick={doReset}
              disabled={resetBusy}
              title="换一个新码；旧的立刻作废（别人手里的那份就失效了）"
              style={{ ...btnStyle(false), fontSize: FS.small }}
            >
              {resetBusy ? '重置中…' : '重置'}
            </button>
            {resetMsg !== '' ? (
              <span style={{ fontSize: FS.tag, color: resetMsg.startsWith('重置失败') ? '#b3261e' : '#1f7a3d' }}>
                {resetMsg}
              </span>
            ) : null}
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: FS.small, color: C.dim, lineHeight: LH.normal }}>
            想给某个山海 Skill 开权限？<b style={{ color: C.text }}>点下面的按钮，把整段话复制给你的 Agent</b>，
            它自己会把技能装好、把授权领好 —— 你不用复制码，也不用填任何东西。
          </div>
          <button
            type="button"
            onClick={() => copy(AGENT_INSTRUCTION, 'agent')}
            style={{ ...btnStyle(true), alignSelf: 'flex-start', fontSize: FS.small }}
          >
            {done === 'agent' ? '已复制，粘给 Agent 就行' : '复制给 Agent 的指令'}
          </button>
          <button
            type="button"
            onClick={() => setManual(!manual)}
            style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: 0, color: C.dim, fontSize: FS.tag, cursor: 'pointer', textDecoration: 'underline' }}
          >
            {manual ? '收起手动方式' : 'Skill 读不到设备？手动方式'}
          </button>
          {manual ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: FS.tag, color: C.dim, lineHeight: LH.normal }}>
                只在自动识别失败时用。复制下面这串，贴进 Skill 的配置文件里。
              </div>
              <button
                type="button"
                onClick={() => copy(JSON.stringify({ deviceId: cred.deviceId, deviceSecret: cred.deviceSecret }), 'full')}
                style={{ ...btnStyle(false), alignSelf: 'flex-start', fontSize: FS.small }}
              >
                {done === 'full' ? '已复制解锁串' : '复制解锁串'}
              </button>
              <div style={{ fontSize: FS.tag, color: C.dim, lineHeight: LH.normal }}>
                解锁串 = 设备码 + 设备密钥，等于这台机器的钥匙 —— 不要发群、不要贴公开文档。
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}`, fontSize: FS.small, lineHeight: LH.loose }}>
        <div style={{ fontWeight: 700, color: C.text, marginBottom: 9 }}>为什么值得装一个工位</div>
        {point('跨云跨端', '云上、本地、Windows、Mac 的 Agent 坐进同一张桌，不用来回倒消息')}
        {point('谁在做什么', '轮到谁、卡在哪、谁在线，一眼看见，不用群里问')}
        {point('交接有据', '任务派给谁、做到哪一步、交付了什么，都留在工位上')}
        {point('资料归位', '每份文件挂在对应任务下，不再散在聊天记录里')}
        {point('换机不重来', '数据在云端，卸载重装登录即回，不会从头再来')}
        {point('能力连坐', '装一次工位，后续更多山海 Skill 都能一并解锁')}
      </div>
    </Section>
  )
}

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

/* ══════════════════════════════════════════════════════════════════
   工位区顶部 · 席位数量总览（2026-10-26 阿开）

   ★ 阿开原话：「座位与邀请是否不需要提供邀请按钮，只需要展示每一个类型
     席位数量 …… 这样整个页面就会剩下很多空间？合理规划一下好看美观一些。」

   ★ 为什么撤掉卡片上的「邀请」按钮：
     邀请栏（InviteBar）里本来就要再选一次座位类型（INVITE_LAMPS）
     ⇒ 卡片上那个按钮等于把同一件事问两遍，还占掉每张卡片右侧的空间。
     而且「邀请要对应上面的座位号」—— 选哪个位这件事，
     在点按钮那一刻根本还没定，按钮本身就是多余的中间步骤。

   ★ 保留的能力（一个都没少）：
     · 坐人的位 → 仍有「请出」（不可逆，二次确认）
     · 签名位 → 仍有「🔒 平台专属 · 不可邀请」说明
     · 生成邀请 → 统一收到「管理助理（临时代管）」区块那一处

   ★ 显示纪律：
     · 每个类型都给「已坐/总数」，空着的写「空 N」—— 不让人心算
     · 坐着谁，收在 `title` 里（hover 可见），不占版面
     · 未知类型**原样显示**，不隐藏（藏起来 = 用户以为没这个位）
     · `seatList === null` ⇒ 整行不渲染，绝不显示「0 个位」这种假读数
   ══════════════════════════════════════════════════════════════════ */
function SeatSummaryRow({ seats }: { seats: RolesSeat[] | null }): ReactElement | null {
  /* ★★ 2026-10-26 阿开二次定稿（覆盖同日上一版）：
     「顶部按这个显示。工位排号也按这个排」——
     #1 山海签名位（已占，不显示空） / #2 战略位 1人 / #3 管理位 1人 /
     #4 管理助理位 空 / #5 审计位 空 / #6 执行位 2人。
     ★ 只显示实际人数，**不再写容量上限**（执行位 capacity=-1，`2/1` 会被读成超载）。
     ★ 签名位不算空 —— 它是平台常驻效力锚点，不是可被邀请填上的空位。 */
  const [showMa, setShowMa] = useState(false)
  if (seats === null) return null
  const counts = countSeatTypes(seats.map((s) => ({
    seat: s.seat,
    label: s.label,
    /* ★★ 只传 occupants，**不传 holder**（2026-10-26 修假读数）：
       `holder` 是「位属于谁」（候选位/系统位的固定人名），不是「谁在坐」。
       传进来就会被当成坐满 ⇒ 每类都显示 1 人（阿开实测发现）。 */
    occupants: s.occupants,
    full: s.full,
  })))
  const maCount = counts.find((c) => c.key === 'management_assistant')
  const maHasPeople = maCount !== undefined && maCount.occupantsTotal > 0
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 0,
        padding: '4px 0', marginTop: 8,
        border: `1px solid ${C.border}`, borderRadius: 8, background: C.soft,
        overflow: 'hidden',
      }}
    >
      <div style={{
        padding: '6px 10px', borderBottom: `1px solid ${C.border}`,
        fontSize: FS.tag, color: C.dim, fontWeight: 600,
      }}>
        {seatSummary(counts)}
      </div>
      {counts.map((c, i) => {
        /* ★ 签名位：只写「（已占）」，不显示空、不显示人数、无操作 */
        const isSig = c.key === 'signature'
        const isMa = c.key === 'management_assistant'
        const isEmpty = c.occupantsTotal === 0
        /* 人类可读的一行右侧文案（口径全在 seat-summary.ts 的 seatBadge 里，单一来源） */
        const right = seatBadge(c).slice(c.label.length).trim()
        return (
          <div key={c.key}>
            <div
              onClick={isMa ? () => setShowMa((v) => !v) : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                borderTop: i === 0 ? 'none' : `1px solid ${C.border}`,
                fontSize: FS.small,
                cursor: isMa ? 'pointer' : 'default',
                background: isMa && showMa ? 'rgba(200,136,31,0.06)' : 'transparent',
              }}
              title={
                isSig
                  ? '山海签名位：平台专属效力锚点，不可邀请、不可更换'
                  : c.holders.length > 0
                    ? `${c.label}：${c.holders.join('、')}`
                    : `${c.label}：空着`
              }
            >
              <span style={{ fontSize: FS.tag, color: C.dim, minWidth: 22 }}>
                {isSig ? '—' : `#${i}`}
              </span>
              <span style={{
                fontWeight: 600,
                color: isSig ? '#8e44ad' : (isEmpty ? C.dim : C.text),
                minWidth: 88,
              }}>
                {isSig ? '山海签名位' : c.label}
              </span>
              <span style={{
                fontSize: FS.tag,
                color: isEmpty && !isSig ? C.dim : C.text,
                fontWeight: isEmpty ? 400 : 600,
              }}>
                {right}
              </span>
              {isMa ? (
                <span style={{ marginLeft: 'auto', fontSize: FS.tag, color: C.dim }}>
                  {showMa ? '收起 ▴' : '功能介绍与指定 ▾'}
                </span>
              ) : null}
            </div>
            {/* ★★ 2026-10-26 阿开：「管理助理位。既然在这里就显示空，有人的时候显示
                （已安排）…… 并且支持点击就在下方弹出管理助理（临时代管）的功能介绍和指定功能。
                这样工位下方的席位一览（只读）以及管理助理（临时代管）就可以都取消了」
                ⇒ 原挂在工位页底部的 `ManagementGrantSection` 整块搬到**第 4 行正下方**，
                  点一下就地展开，不用去页面底部找。
                ★ 为什么要搬：位在第 4 格、功能在页面最底 —— 同一件事两处，人得自己连线。
                  合并后「这个位是什么、怎么指定人」在一个视线里。 */}
            {isMa && showMa ? (
              <div style={{ borderTop: `1px solid ${C.border}`, background: '#fff' }}>
                <ManagementGrantSection embedded />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}


/* ══════════════════════════════════════════════════════════════════
 * TODO-待删除 · `OrgSection` 已整段搬到 `org/20-org-section.tsx`
 *
 * 这段是什么：工位区主区块：卡座网格 + 席位说明 + 邀请入口的组装层
 *
 * 为什么还留在这：搬迁按「登山台阶」节奏走 —— 先搬出去、再验通、最后删原件。
 *   本次只做「① 搬出（已完成）」，原件保留在下方，与本文件其余部分共用一套上下文。
 *
 * 何时删：整个 20-org 域搬迁验通（tsc -b 全绿 + 12 套判据不回归）后统一删除。
 *   删除时连同本条注释一并删掉，不留「已搬走」的空壳说明。
 *
 * ★ 删除前必须确认：本文件已从上述路径 import 该符号，且下方没有任何本地引用。
 * ══════════════════════════════════════════════════════════════════ */
function OrgSection(props: { onGoDevices?: () => void }): ReactElement {
  const [tree, setTree] = useState<OrgTreeView | null>(null)
  /* ★★ 2026-10-26：工位区顶部的「每类席位数量」总览数据。
     为什么本组件自己拉一份 seats（不指望别人传）：
     拿不到彼此 state。这里自己拉一次读数——只读、无副作用，
     多一次 GET 换来「工位页看见人，同一屏看见每类几个位」，值得。
     ★ 拉失败不影响工位卡片：`seatList` 保持 null，总览行自己降级成不显示，
       绝不能让一个统计读数把整个工位页搞白。 */
  const [seatList, setSeatList] = useState<RolesSeat[] | null>(null)
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
  /* ★★ 2026-10-24 阿开：「工位的邀请按钮可以替换成『🔑 生成工位加入码』」，
     点就在工位顶部就地展开，不跳页。
     ★ 为什么在顶部就地展开而不是跳资料页：新同事要进铺时，人就在工位页看「有谁在」，
       生成码这件事应该发生在同一个视线里，不该让人再找一次路。 */
  const [showJoin, setShowJoin] = useState(false)
  /* ★★ 2026-10-26 阿开三定稿：管理助理不占座位卡，改为标题行右侧入口 */
  const [grantOpen, setGrantOpen] = useState(false)

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
    /* ★★ 2026-10-26：顺带拉一次席位读数（只读）。
       ★ 用 `.then` 而不是 await：拉失败就让总览不显示，**不 setErr** ——
         工位卡片读的是 `/org/tree`，两者来源不同；
         把席位的错塞进工位的 err，会让用户以为「工位布局坏了」，是归因错位。 */
    void callPack<RolesSeatsPayload>('rolesSeats', {}).then((r) => {
      if (r.ok) setSeatList(Array.isArray(r.data.seats) ? r.data.seats : [])
    })
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
          : code === 'project_frozen' ? '项目已归档，改不了'
          : code === 'project_incomplete' ? '还有任务没完成'
          : code === 'project_not_frozen' ? '要先归档才能送审'
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
  const rawGrid = leaves.length > 0 ? leaves : nodes
  /* ★★ 2026-10-26 阿开（第三轮）：「工位排号也按这个排」——
     工位卡片网格的**顺序必须与顶部席位表同源**（`SEAT_ORDER`），
     否则上面第 4 行写「管理助理位」、下面卡片却排在别处，人就对不上号。
     ★ 为什么要在这里排而不是靠后端返回顺序：后端按 `created_at` 出（开铺时间序），
       那个顺序里签名位可能排在末尾；界面顺序是产品语义，不能托管给数据时点。
     ★ 认不出 seatKey 的老数据：按名字认「签名」，再认不出就**排最后**（不插队、不被藏）。 */
  const seatKeyOf = (n: OrgNodeView): string => {
    const k = (n as { seatKey?: string }).seatKey
    if (typeof k === 'string' && k.length > 0) return k
    /* ★ 2026-10-26 改名后必须走归一化判据：中文名已从「签名位」变「山海顾问位」，
       按「含签名」匹配会全部失效 ⇒ 静默放开锁定。判据正本 = seat-summary.isAdvisorSeat */
    if (isAdvisorSeat(n.seatKey, n.name)) return 'signature'
    return ''
  }
  const seatRank = (n: OrgNodeView): number => {
    const i = SEAT_ORDER.indexOf(seatKeyOf(n))
    return i < 0 ? 999 : i
  }
  const gridNodes = rawGrid.slice().sort((a, b) => seatRank(a) - seatRank(b))

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
        {/* ★★ 2026-10-26 阿开三定稿：
            「管理助理位就不要占一张卡片了取消，后面的审计位顺移到现在的助理位。
             『管理助理（临时代管）』功能这个按钮放到工位上方，工位布局
             已有 N 位 Agent 加入工位的背后」
            ⇒ 助理不再占座位，改为标题行右侧一个入口。
              它管的是「借一段权给已有的人」，不是「让新人进来」——
              所以它属于**标题栏**（对整铺生效的设置），不属于某一张卡（某个位）。
            ★ 视觉：说明性动作用描边（btnStyle(false)），与右侧「刷新」同级。 */}
        <button
          type="button"
          onClick={() => setGrantOpen((v) => !v)}
          style={btnStyle(grantOpen)}
          title="管理位出差/休假时，借一段代管权给某位 Agent"
        >
          {grantOpen ? '收起 ▴' : '👑 管理助理'}
        </button>

        {/* ★★★ 2026-10-26（第三次更正 · 终局）阿开：
            「顶部的生成邀请码点击就没用算了干脆不要了……顶部的 🔑 生成工位加入码
             取消删除消失。」
            ⇒ **整个按钮删除**，标题行只留「刷新」和「一键清场」。
            ★ 为什么它注定没用：它只是个开关（展开/收起下方那张卡），
              自己不会生成任何码 —— 用户点它期待「生成」，得到的是「什么都没发生」。
              带「生成」二字却不生成，是文案骗人，不是 bug，只能删。
            ★ 加入码卡本身**常显**，不再需要开关。 */}

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          style={btnStyle(false)}
          title="重新读取"
        >
          刷新
        </button>
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

      {/* ★★ 代管入口（展开区）—— 承阿开 2026-10-26 三定稿：
          管理助理 = 借一段权给**已有的人**，不占座位、不发新人码。 */}
      {grantOpen && (
        <div style={{ ...cardStyle, marginBottom: 8 }}>
          <ManagementGrantSection embedded />
        </div>
      )}

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
        <>
          <div style={{ ...cardStyle, color: C.dim, fontSize: FS.small, lineHeight: LH.normal }}>
            还没有工位 —— 在下面输入一个名字，加第一个。
          </div>
          {/* ★★ 2026-10-26 阿开：「点开之后的（24 小时 / 1张2张3张 / 生成工位加入码）
              在底部，改到上方顶部下方」⇒ 卡片**常显**在席位总览下方，不再折叠。
              ★ 空铺也要有：总览行只在「有工位」分支渲染，这里补一份（判据 S-11f 盯）。 */}
          {/* ★ 2026-10-26 终局：加入码卡**常显**（顶部那个"生成"按钮已删，无需开关）。
              理由：用户进来第一件事可能就是发码给同事，不该先找按钮。
              要收起时它自己带「码用不了了？/手上的码」折叠，不占版面。 */}
          <JoinCodeCard compact />
        </>
      ) : (
        <>


        <div
          style={{
            display: 'grid',
            // ★ 5 列 × 2 行 = 10 个位（阿开 2026-10-19 定稿：上限 10 位 ⇒ 一行 5 个卡片）
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 8,
            marginTop: 8,
          }}
        >
          {gridNodes.map((n) => (
            <Fragment key={`wrap-${n.node_id}`}>
            <OrgNodeCard
              key={n.node_id}
              node={n}
              seatInfo={(() => {
                /* ★ 按 seatKey 查这一位在 `/roles/seats` 里的读数（工位 → 席位定义 → 实际在座）。
                   老数据可能没 seatKey ⇒ 用名字里认「签名位」兜底，与卡片本身的判据同源。 */
                if (seatList === null) return undefined
                const k = ((n as { seatKey?: string }).seatKey ?? '').length > 0
                  ? ((n as { seatKey?: string }).seatKey as string)
                  : (isAdvisorSeat(n.name, n.name) ? 'signature' : '')
                return k.length > 0 ? seatList.find((x) => x.seat === k) : undefined
              })()}
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
              /* ★★ 2026-10-26（阿开定 · 钥匙保险箱）：重置连接。
                 ★ 与请出的区别必须体现在提示语里 —— 请出是「请走」，
                   重置是「换钥匙、人还在」。用户混淆两者会误踢人。 */
              onResetKey={(agentId) => { void (async () => {
                const r = await resetAgentKey(agentId)
                if (!r.ok) {
                  setErr({ code: r.code, message: r.message, source: 'action', title: '重置没成功' })
                  return
                }
                await refresh()
                setNotice(`已重置 ${agentId} 的连接：新钥匙在保险箱，它下次来领任务时自动取走（旧钥匙 ${r.data.graceHours ?? 24} 小时内仍可用）`)
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
          {/* ★★★ 2026-10-26 阿开：「你没有默认 6 个系统位啊…哪怕没有人也显示邀请按钮」
               ⇒ 补齐的格子**先按系统位顺序摆位**（会显示位名 + 人数 + 邀请），
                 6 位摆完仍有剩余才渲染真正的空位块（只有第一格可「+ 添加工位」）。

               ★ 为什么要按系统位摆：`gridNodes` 只含**已建出来的**节点，
                 存量铺子常常只有 4 个（缺战略位 / 管理助理位）⇒ 那两格原来是纯「空位」，
                 看不出是哪个位、也没邀请入口 —— 用户因此说「你没有默认 6 个系统位」。
               ★ 两种格子的区别：系统位格 = 有身份（虚线边框 + 位名 + 邀请）；
                 空位格 = 无身份（只有「+ 添加工位」/「空位」）。 */}
          {(() => {
            const missing = Math.max(0, 10 - gridNodes.length)
            /* 已在卡座里的座位认领了哪些 seatKey */
            const seated = new Set<string>()
            for (const n of gridNodes) {
              const direct = ((n as { seatKey?: string }).seatKey ?? '').trim()
              seated.add(direct.length > 0 ? direct : resolveSeatKeyByName(n.name))
            }
            /* 还没落座的系统位（按 SEAT_ORDER 顺序） */
            const vacantSystem = SEAT_ORDER.filter((k) => !seated.has(k))
            const cells: ReactElement[] = []
            for (let i = 0; i < missing; i += 1) {
              const seatKey = vacantSystem[i]
              if (seatKey !== undefined) {
                cells.push(
                  <EmptySystemSeat
                    key={`sysslot-${seatKey}`}
                    seatKey={seatKey}
                    label={SEAT_LABELS[seatKey] ?? seatKey}
                    seatInfo={seatList === null ? undefined : seatList.find((x) => x.seat === seatKey)}
                    locked={seatKey === 'signature'}
                    /* ★★★ 2026-10-26 修真断点：原来是 `setInviting('')` ——
                       空串不等于任何 node_id ⇒ `inviting === n.node_id` 恒假
                       ⇒ 点「邀请」什么都不发生（阿开实测：「点了没有反应」）。
                       ★ 系统位还没有 node（存量铺缺位），InviteBar 需要 node 才能渲染，
                         所以这里改为**滚到加入码卡**（那里能真发码）。
                       ★ 终局：加入码卡已常显（顶部开关按钮已删）⇒ 不再需要任何开关状态，
                         只需滚动定位。 */
                    onInvite={() => { setTimeout(() => {
                      const el = document.getElementById('kaipu-join-card')
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }, 60) }}
                  />,
                )
              } else {
                /* 6 位都摆完之后剩下的才是真·空位：只有第一格可加，避免一排全是加号 */
                cells.push(
                  <EmptySeat
                    key={`empty-${i}`}
                    canAdd={i === vacantSystem.length}
                    busy={busy}
                    onAdd={(name) => { setDraft(name); void (async () => {
                      const r = await createOrgNode(name)
                      if (!r.ok) setErr({ code: r.code, message: r.message })
                      await refresh()
                    })() }}
                  />,
                )
              }
            }
            return cells
          })()}
        </div>
        {gridNodes.length > 10 ? (
          <div style={{ fontSize: FS.small, color: C.dim, marginTop: 6 }}>
            还有 {gridNodes.length - 10} 个位置未显示（先显示前 10 个）
          </div>
        ) : null}
        {/* ★★★ 2026-10-26 阿开：「顶多增加第三行同样高度的介绍席位桌面直接显示，不需要单独按钮」
            ⇒ 席位介绍**常显**在卡座正下方，与卡座同构的横排（5 列、同样 78px 最小高度）。
            ★ 不要按钮：他要「一眼看见」，多一次点击就是多一步。
            ★ 放卡座**下方**：先看「有哪些位、坐着谁」，再看「每个位干什么」——
              顺序反了会先读说明才找位。 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 8,
            marginTop: 8,
          }}
        >
          {SEAT_GUIDE.map((s) => (
            <div
              key={s.name}
              style={{
                /* ★ 2026-10-26 阿开：「第三行工位介绍颜色要不要暗一些，与上面的真正工位区别明显一些」
                   ⇒ 边框淡到 #ebeef2、底色降到 0.012、字色整体降一档。
                     目的：一眼看出「上面是位、下面是说明」，不是两组平级卡片。 */
                border: '1px solid #ebeef2',
                borderRadius: 10,
                padding: '8px 10px',
                minHeight: 78,
                background: 'rgba(0,0,0,0.012)',
                fontSize: FS.tag,
                lineHeight: 1.55,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>{s.icon}</span>
                {/* ★ 说明格字色整体降一档：位名 C.text→C.dim，描述 C.dim→C.faint */}
                <span style={{ fontWeight: 600, fontSize: FS.small, color: s.locked ? '#9b7cb8' : C.dim }}>
                  {s.name}
                </span>
              </div>
              <div style={{ color: C.faint, flex: 1 }}>{s.desc}</div>
              {s.locked === true ? <div style={{ color: '#9b7cb8' }}>🔒 不可邀请</div> : null}
            </div>
          ))}
          {/* 第 6 格：审计位独立性的说明（原文案保留，不丢） */}
          <div
            style={{
              border: '1px solid #ebeef2',
              borderRadius: 10,
              padding: '8px 10px',
              minHeight: 78,
              background: 'rgba(0,0,0,0.012)',
              fontSize: FS.tag,
              lineHeight: 1.55,
              color: C.dim,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: FS.small, color: C.dim }}>签名并行</div>
            <div style={{ flex: 1 }}>
              第三方签自己的结论，请让它坐<b>审计位</b>、用<b>自有私钥</b>；
              山海在其后附加「过程凭证」的签名。两条并行、不互相替代。
            </div>
          </div>
        </div>

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

/* ★★★ 2026-10-24 阿开：「签名位还是可以邀请，虽然已经定了签名位不可邀请」
   ── 根因不是后端漏拦，恰恰相反：**前端把它从可邀请列表里删掉，反而漏了**。

   链路还原：
     ① 后端 `create_invite` 有 `if lamp in LOCKED_SEATS → 400 seat_locked`（拦的是 **lamp**）
     ② 前端 `INVITE_LAMPS` 里**没有 signature**（古茶裁决后移除）
     ③ `InviteBar` 初值三选一：
          `node.seatKey === 'signature'` → 但 `INVITE_LAMPS.some(...)` 为 false ⇒ **不采纳**
          名字匹配 `'签名位'` → 列表里没有 ⇒ 找不到
          最后 `return 'execution'`  ← **于是发出去的是「执行位」邀请**
     ④ 后端收到 lamp='execution' ⇒ 不在 LOCKED_SEATS ⇒ **放行**

   ⇒ 真实后果比「能邀请签名位」更糟：**在签名位上点邀请，实际请进来的是执行位**，
     用户以为在填签名位，结果多了一个能干活的执行 Agent。界面与事实不符。

   ★ 修法两层（都要，缺一不可）：
     甲、**不发**：锁定值不进可邀请列表，但 `InviteBar` 必须**认出它并拒绝**，不许静默回落；
     乙、**不渲染**：锁定坐席的卡片上**根本不出现邀请按钮**（没有按钮就点不出错）。
   ★ 值必须与后端 `seattemplates.LOCKED_SEATS` 同源同值 —— 前端不另造名字。 */
const LOCKED_SEAT_KEYS: ReadonlySet<string> = new Set(['signature'])

const INVITE_LAMPS: ReadonlyArray<{ value: string; label: string; hint?: string }> = [
  { value: 'execution', label: '执行位', hint: '干活的人' },
  { value: 'audit', label: '审计位', hint: '负责审的人' },
  { value: 'management', label: '管理位', hint: '管秩序的人' },
  /* ★★ 2026-10-23 古茶裁决（`沟通记录/213b`）：
     **签名位从可邀请列表里移除** —— 它是山海不可替代的**效力锚点**，
     不是能干活的工位；外部 Agent 坐进来 = 冒充山海背书。
     后端 `create_invite` 已同步 `seat_locked` 拦截，两层都堵住。 */
  { value: 'strategy', label: '战略位', hint: '定方向的人（只能 1 位）' },
  /* ★★ 2026-10-23 阿开：「邀请是否更合适一些？双向选择权」
     ⇒ 管理助理位也走邀请：铺主发邀请（选人），对方接受（选接不接）。
        接受即视为同意「在授权期内代管、到期自动转执行位」。
     ★ 与其它位的区别：进这个位**不是永久席位**，而是借一段时间的管理权；
        授权单由系统在 accept 时自动开，24h/72h/168h 三档。 */
  { value: 'management_assistant', label: '管理助理位', hint: '临时代管的人（有时限）' },
]

/* ══════════════════════════════════════════════════════════════════
   四类席位说明（古茶 2026-10-23 定稿文案 · 逐字落地，勿自编）

   ★ 为什么要有这块：界面只写「执行位/审计位/管理位/签名位」四个词，
     没有任何一处解释它们干什么 —— 阿开 2026-10-23 自己都想不起
     「签名位是干嘛的」。名词不等于认知。
   ══════════════════════════════════════════════════════════════════ */
const SEAT_GUIDE: ReadonlyArray<{ icon: string; name: string; desc: string; locked?: boolean }> = [
  { icon: '🧑‍💻', name: '执行位', desc: '干活的人（通常是你自带的 Agent 或我们的智囊团）。' },
  { icon: '⚖️', name: '审计位', desc: '负责挑毛病、做审查的人（可以是第三方机构，也可以是我们）。' },
  { icon: '👑', name: '管理位', desc: '负责建场地、发任务、管秩序的人（通常是你/铺主）。' },
  {
    icon: '💮',
    name: '签名位（平台专属）',
    desc: '山海的最后一道防线。它不负责干活，只负责在流程跑完后，为「过程未被篡改」盖上最终的效力印章。外来的 Agent 不能坐这个位子，否则就是冒充山海背书。',
    locked: true,
  },
]


/* ══════════════════════════════════════════════════════════════════
 * TODO-待删除 · `InviteBar` 已整段搬到 `org/21-invite-bar.tsx`
 *
 * 这段是什么：席位邀请栏：三选一初值（请出/空位邀请/已受邀）+ 邀请码签发后回显
 *
 * 为什么还留在这：搬迁按「登山台阶」节奏走 —— 先搬出去、再验通、最后删原件。
 *   本次只做「① 搬出（已完成）」，原件保留在下方，与本文件其余部分共用一套上下文。
 *
 * 何时删：整个 20-org 域搬迁验通（tsc -b 全绿 + 12 套判据不回归）后统一删除。
 *   删除时连同本条注释一并删掉，不留「已搬走」的空壳说明。
 *
 * ★ 删除前必须确认：本文件已从上述路径 import 该符号，且下方没有任何本地引用。
 * ══════════════════════════════════════════════════════════════════ */
function InviteBar(props: { node: OrgNodeView; made: { url: string; expiresAt: string } | null; onMade: (v: { url: string; expiresAt: string }) => void }): ReactElement {
  const { node, made, onMade } = props
  /* ★★ 2026-10-20 阿开：「我邀请 Codex 进审计位，审计位不显示，还是邀请按钮」
     根因：这里默认 `execution` —— 在「审计位」卡片上点邀请，实际发的却是执行位。
     邀请码里的 lamp 才是「这个码会让你坐哪」，所以默认值必须**跟着卡片走**。
     ★★★ 2026-10-24 补：**锁定坐席（签名位）必须识别出来并拒绝，不许静默回落**。
     退回 'execution' 的默认值是「其它位都能邀请」时代的保险丝，
     对签名位来说它变成了**掩盖错误**的通道（点签名位→发执行位码）。
     ⇒ 锁定值返回 ''，由 produce 侧拒绝 + 卡片侧不渲染按钮，双保险。 */
  const seatKey: string = (() => {
    const direct = (node as { seatKey?: string }).seatKey ?? ''
    // ① 节点直连的 seat key 最准（改过名也不影响）
    if (direct.length > 0) return direct
    // ② 退回名字匹配（老数据 / 手工建的位没有 seat 绑定）
    const hit = INVITE_LAMPS.find((x) => x.label === node.name || node.name.startsWith(x.label))
    if (hit) return hit.value
    // ③ 名字命中锁定席位（签名位不在 INVITE_LAMPS 里，要单独认）
    if (isAdvisorSeat(node.seatKey, node.name)) return 'signature'
    return 'execution'
  })()
  const locked = LOCKED_SEAT_KEYS.has(seatKey)
  const [lamp, setLamp] = useState<string>(seatKey)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const create = async (): Promise<void> => {
    /* ★★★ 2026-10-24 甲层：**锁定坐席不许发码**。
       这里拦一道纯属保险 —— 正常情况下 locked 的卡片根本不会渲染邀请按钮。
       为什么还要留：这道检查防的是「以后有人把按钮加回来」；
       代价一行，收益是不再出现「点签名位→请进执行位」这种界面与事实不符的事。 */
    if (locked) {
      setErr('签名位不能发邀请 —— 它是山海不可替代的效力锚点，外部 Agent 不能入驻。要请对方干活，请选执行位 / 审计位 / 管理位。')
      return
    }
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
    const _url = String(r.data.url ?? r.data.path ?? r.data.code ?? '')
    /* ★★★ 2026-10-26（阿开 4️⃣）：明文本机留档 —— 否则「复制邀请码」按钮无源可取。
       为什么必须本地存：服务端**只存码的 hash**，明文只在签发这一次的响应里出现，
       任何列表接口都取不回来。刷新页面后想再复制一次，只能靠本机这份。
       ★ 键 = 工位节点 id（不是 codeHash）：卡片要的是「本位那张码」，
         一个位同一时刻只该有一个活着的码。
       ★ 只存 url 与到期时间，不存整条响应（避免把无关字段也留在本机）。 */
    try {
      const box = JSON.parse(safeGet(SEAT_INVITE_URL_KEY) || '{}') as Record<string, unknown>
      box[String(node.node_id)] = { url: _url, expiresAt: String(r.data.expiresAt ?? '') }
      safeSet(SEAT_INVITE_URL_KEY, JSON.stringify(box))
    } catch { /* 存不下不影响签发 —— 链接当场也显示在卡上 */ }
    onMade({ url: _url, expiresAt: r.data.expiresAt })
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
            {/* ★★ 2026-10-26 阿开定「甲案」：这里**故意只留「复制链接」**，不放「复制给新同事的指令」。
                理由（别再往里加）：铺主在工位是**发件人**，他不需要五节教程；
                收件人打开邀请链接那一刻才是「必经之处」—— 教程放在落地页
                `/kai-pu-invite/index.html`，人/Agent 两段折叠，改文案不用发版。
                ⇒ 新人若想加回按钮，先问：这条教程收件人真的看不到吗？ */}
          </div>
        </div>
      )}
    </div>
  )
}

/** 项目卡片（任务页顶部一排）—— 比下拉更直观：一眼看到有几个项目、各几个任务 */

/* ══════════════════════════════════════════════════════════════════
 * TODO-待删除 · `ProjectChip` 已整段搬到 `org/00-shared.tsx`
 *
 * 这段是什么：项目卡片：任务页顶部一排项目筛选块
 *
 * 为什么还留在这：搬迁按「登山台阶」节奏走 —— 先搬出去、再验通、最后删原件。
 *   本次只做「① 搬出（已完成）」，原件保留在下方，与本文件其余部分共用一套上下文。
 *
 * 何时删：整个 20-org 域搬迁验通（tsc -b 全绿 + 12 套判据不回归）后统一删除。
 *   删除时连同本条注释一并删掉，不留「已搬走」的空壳说明。
 *
 * ★ 删除前必须确认：本文件已从上述路径 import 该符号，且下方没有任何本地引用。
 * ══════════════════════════════════════════════════════════════════ */
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


/* ══════════════════════════════════════════════════════════════════
 * TODO-待删除 · `btnStyle` 已整段搬到 `org/00-shared.tsx`
 *
 * 这段是什么：按钮样式工厂：primary=true 实心（执行动作），false 描边（说明性）
 *
 * 为什么还留在这：搬迁按「登山台阶」节奏走 —— 先搬出去、再验通、最后删原件。
 *   本次只做「① 搬出（已完成）」，原件保留在下方，与本文件其余部分共用一套上下文。
 *
 * 何时删：整个 20-org 域搬迁验通（tsc -b 全绿 + 12 套判据不回归）后统一删除。
 *   删除时连同本条注释一并删掉，不留「已搬走」的空壳说明。
 *
 * ★ 删除前必须确认：本文件已从上述路径 import 该符号，且下方没有任何本地引用。
 * ══════════════════════════════════════════════════════════════════ */
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


/* ══════════════════════════════════════════════════════════════════
 * TODO-待删除 · `OrgNodeCardProps` 已整段搬到 `org/22-node-card.tsx`
 *
 * 这段是什么：座位卡片入参接口：节点视图 + 回调集合
 *
 * 为什么还留在这：搬迁按「登山台阶」节奏走 —— 先搬出去、再验通、最后删原件。
 *   本次只做「① 搬出（已完成）」，原件保留在下方，与本文件其余部分共用一套上下文。
 *
 * 何时删：整个 20-org 域搬迁验通（tsc -b 全绿 + 12 套判据不回归）后统一删除。
 *   删除时连同本条注释一并删掉，不留「已搬走」的空壳说明。
 *
 * ★ 删除前必须确认：本文件已从上述路径 import 该符号，且下方没有任何本地引用。
 * ══════════════════════════════════════════════════════════════════ */
interface OrgNodeCardProps {
  node: OrgNodeView
  /**
   * ★★ 2026-10-26：这个工位绑定的席位读数（按 seatKey 从 `/roles/seats` 里查出来的那一行）。
   * 用于区分「空着」与「有人但读不到」—— 只看 `seat_count` 区分不出来（那是位的定义）。
   * 可能为 `undefined`：工位还没绑席位、或席位读数还没拉回来 ⇒ 走保守判断。
   */
  seatInfo?: RolesSeat | undefined
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
  /** ★★ 2026-10-26（阿开定 · 钥匙保险箱）：重置这位 Agent 的连接。
      ★ 参数只要 agentId —— 不用 seat，因为重置的是「这个 Agent 的钥匙」，
        不是「这个位」（位上的钥匙属于坐在这的那个人）。 */
  onResetKey: (agentId: string) => void
}

/** 一个「位」= 3 列网格里的一张卡（不缩进、不展开子级 —— 座位表口径） */

/* ══════════════════════════════════════════════════════════════════
 * TODO-待删除 · `OrgNodeCard` 已整段搬到 `org/22-node-card.tsx`
 *
 * 这段是什么：单个座位卡片：六态渲染（有人/空着/已受邀/码过期/签名位/说明位）
 *
 * 为什么还留在这：搬迁按「登山台阶」节奏走 —— 先搬出去、再验通、最后删原件。
 *   本次只做「① 搬出（已完成）」，原件保留在下方，与本文件其余部分共用一套上下文。
 *
 * 何时删：整个 20-org 域搬迁验通（tsc -b 全绿 + 12 套判据不回归）后统一删除。
 *   删除时连同本条注释一并删掉，不留「已搬走」的空壳说明。
 *
 * ★ 删除前必须确认：本文件已从上述路径 import 该符号，且下方没有任何本地引用。
 * ══════════════════════════════════════════════════════════════════ */
function OrgNodeCard(props: OrgNodeCardProps): ReactElement {
  const { node, busy, editing, editName, setEditName } = props
  const isRenaming = editing === node.node_id
  const isDeleting = editing === `del:${node.node_id}`
  const kind = node.node_kind ?? 'role'
  const [hover, setHover] = useState(false)
  /* ★★ 2026-10-26 修假读数：`seat_count` 是「这个工位绑了几个席位」（位存在吗），
     **不是「有没有人坐」**。原来拿它当 occupied ⇒ 审计位（3 人全 left）与签名位
     （平台位，天生不对外入驻）都显示「有人，但读不到是谁」，把空着说成有人。
     现在「谁在坐」只认 holders；`seat_count` 单独用来判「这个位配了没有」。 */
  const seatCount = node.seat_count ?? 0
  /** 席位侧是否明确表示「空着」或「不可入驻」—— 用来压掉「有人但读不到」的假提示 */
  const seatVacantish = (() => {
    const info = props.seatInfo
    /* ★★★ 2026-10-26 阿开实测（「第一个没邀请过也显示有人但读不到是谁」）：
       原写 `return false // 读数没回来：保守，不擅自说空` —— 这个「保守」选错了边。
       `false` 的语义是「非空 ⇒ 有人」，于是 `holderUnknownText()` 落到最后一句，
       对**永远没有读数**的卡片（签名位 / 刚建的系统位）年产一句「有人，但读不到是谁」。
       ⇒ 「读数没回来」= **不知道**，既不是「空」也不是「有人」。
          正确的保守是「什么都不说」：由调用方按 `undefined` 单独处理。 */
    if (info === undefined) return undefined      // 不知道 ⇒ 不下结论
    if (typeof info.capacity === 'number' && info.capacity === 0) return true  // 不可入驻（签名位）
    const occ = Array.isArray(info.occupants) ? info.occupants : []
    if (occ.length > 0) return false              // 确实有人 ⇒ 不是空
    /* 席位在、但 occupants 为空 ⇒ 这个位就是空着（后端已按 agents.lamp+enabled 算过） */
    return true
  })()
  /** ★ 有人坐：**只认真实在场者**（holders）。没有 holders 就是空位，不靠 seat_count 撑。 */
  const occupied = (Array.isArray(node.holders) ? node.holders.length : 0) > 0
  /** ★ 谁在坐（2026-10-19：之前只显示工位名，看不到人 —— 阿开找不到阿舟/星月） */
  const holders = Array.isArray(node.holders) ? node.holders : []
  /* ★★★ 2026-10-26（阿开 4️⃣）：本位的邀请码**还有效吗**。
     这一态决定卡片长什么样：
       · 有效 + 人未到 ⇒「已受邀、人还没进来」+「📋 复制邀请码」（不给邀请按钮）
       · 过期 / 没码 ⇒ 回到「🔑 邀请」（自动，用户不用手动切）
     ★ 为什么判「过期」要用 expiresAt 而不是 created_at + 固定 TTL：
       签发时是 7 天不代表这张码是 7 天 —— 以服务端记录为准，不自己算。
     ★ 老库/老记录 `expiresAt` 为空 ⇒ 视为**仍有效**（保守：宁可让用户点一次复制，
       也不要因为缺字段把还活着的码判死）。 */
  const [copiedLink, setCopiedLink] = useState(false)
  const invitedLive = (() => {
    if (!showInvited(holders ?? [], node.invited)) return false
    const exp = String((node.invited ?? {}).expiresAt ?? '').trim()
    if (exp.length === 0) return true                  // 无到期记录 ⇒ 当有效
    const t = Date.parse(exp)
    if (Number.isNaN(t)) return true                   // 解析不了 ⇒ 保守当有效
    return t > Date.now()
  })()
  /** 复制本位那张邀请码的链接 —— 明文只在本机留档里（服务端只存 hash）。
   *  ★ 优先节点 id 那把钥匙；老数据退化到 node.invited.url（如有）。 */
  const copyInviteLink = (): void => {
    let url = ''
    try {
      const box = JSON.parse(safeGet(SEAT_INVITE_URL_KEY) || '{}') as Record<string, { url?: string }>
      url = String(box[String(node.node_id)]?.url ?? '')
    } catch { url = '' }
    if (url.length === 0) url = String((node.invited ?? {}).url ?? '')
    if (url.length === 0) return
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    if (nav?.clipboard?.writeText) {
      void nav.clipboard.writeText(url).then(() => {
        setCopiedLink(true)
        setTimeout(() => setCopiedLink(false), 2000)
      }).catch(() => { /* 剪贴板被拒：静默，链接在卡上可手选 */ })
    }
  }

  /** ★★ 2026-10-23 阿开：「同一个座位为什么会有2个人不合理，一座一Agent，咱们那么多座位空间」
   *   ⇒ 一座一 Agent 是**设计前提**（role_seats 主键 = (account_id, seat) 已然如此）。
   *     行1 只放**一位**：名字单一来源 + 溢出省略号；多出来的只报数（「等 N 人」），
   *     完整名单进 title。这样即使库里出现脏数据，界面也不会被撑破，且异常可见不可藏。
   *   ★ 为什么不是截断字数：名字长不是病（「阿里星月」4 字是正常需求），
   *     把多个身份并排塞进一行才是病 —— 治因不治表。 */
  const primaryHolder = holders[0]
  const extraHolders = holders.length > 1 ? holders.length - 1 : 0
  /* ★★★ 2026-10-24 乙层：锁定坐席（签名位）**卡片上不出现邀请按钮**。
     没有按钮就点不出错 —— 比「点了再报错」好，用户不必先撞一次墙才知道此路不通。
     ★ 判据与 InviteBar 同源：seatKey 优先，没绑定时退回名字（老数据 / 手工建的位）。
     ★ 为什么不靠 `node.seatKey` 单独判：未绑人的工位 seatKey 可能是空串，
       而系统模板建的签名位一定有 seat 绑定 —— 两者都要覆盖。 */
  const cardSeatKey = ((node as { seatKey?: string }).seatKey ?? '').length > 0
    ? ((node as { seatKey?: string }).seatKey as string)
    : (isAdvisorSeat(node.seatKey, node.name) ? 'signature' : '')
  const seatLocked = LOCKED_SEAT_KEYS.has(cardSeatKey)
  /** 请出要二次确认：凭证一作废不可恢复 */
  const [evictArm, setEvictArm] = useState(false)
  /** ★★ 2026-10-26（阿开定 · 钥匙保险箱）：重置连接要二次确认 ——
      它会把当前钥匙挪进宽限期并生成新钥匙，Agent 下次来取就换掉了。 */
  const [resetArm, setResetArm] = useState(false)

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
          {holders.length > 0
            ? (holders[0]?.name || '?').slice(0, 1)
            : showInvited(holders, node.invited)
              ? (node.invited?.invitedName || '邀').slice(0, 1)
              : occupied ? (node.name || '?').slice(0, 1) : ''}
        </span>
        {/* ★ 心跳点（2026-10-19 阿开）：绿=90 秒内有心跳，灰=活着但没报
            ★★ 2026-10-24（083-r2）：三态。原来只有 online 一个布尔，
               分不出「离线（人在）」和「压根没来」—— 后者被当成空位，于是
               邀请发出去以后看不出邀请到底发没发。现在按 joinState：
                 present 绿实心 / joined 灰实心 / invited 灰空心（受邀未到）。 */}
        {holders.length > 0 ? (() => {
          const st = joinStateOf(holders[0] ?? {})
          const dot = dotOf(st)
          return (
            <span
              title={dot.title}
              style={{
                width: 7, height: 7, borderRadius: '50%', marginLeft: -4, marginTop: -10,
                background: dot.hollow ? 'transparent' : dot.color,
                border: dot.hollow ? `1px solid ${dot.color}` : '1px solid #fff',
              }}
            />
          )
        })() : null}
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
              /* ★ 2026-10-23：单一来源 + 省略号兜底，不再靠「、」拼多人 */
              minWidth: 0,
              overflow: 'hidden',
            }}
            title={holders.map((h) => `${h.name}（${h.agentId}）`).join('、')}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {primaryHolder?.name || '?'}
            </span>
            {/* ★★ 2026-10-24（083-r1 · 阿开「执行位和审计位不限人数」）：
                原来是「等 N 人」，两个毛病 ——
                  ① 窄卡片里先被省略号吃掉的是它（名字有 minWidth 保护，它没有）；
                  ② 「等 2 人」读不出是「总共 2 人」还是「还有 2 人」。
                ⇒ 换成徽标 `＋N`（N = 多出来的），语义单向、长度一半，且 flex 不收缩。
                另外给名字加 minWidth:0 —— 让名字先缩，徽标不被挤掉（不然还是白改）。 */}
            {extraHolderBadge(holders.length).length > 0 ? (
              <span
                title={`${extraHolderTitle(holders.length)}（把鼠标停在这行可看完整名单）`}
                style={{
                  flex: '0 0 auto',
                  marginLeft: 2,
                  padding: '0 5px',
                  borderRadius: 999,
                  background: 'rgba(59,111,224,.14)',
                  color: C.accent,
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: '15px',
                  letterSpacing: 0,
                }}
              >
                {extraHolderBadge(holders.length)}
              </span>
            ) : null}
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
          /* ★★ 2026-10-24（083-r2）：受邀未到 ≠ 空位。
             以前这两种都渲染成「工位名」，于是邀请发出去以后界面上什么也没变 ——
             人以为邀请没发出去，于是再发一张，僵尸码就是这么堆起来的。
             ⇒ 有 invited 就明说「已受邀」，且**不显示空位态**（不再给邀请入口的暗示）。 */
          showInvited(holders, node.invited) ? (
            <span
              style={{
                fontSize: FS.tag, fontWeight: 600, flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: C.dim, fontStyle: 'italic',
              }}
              title={`邀请已发出（${node.invited?.invitedAt ?? '时间未记'}），人还没接入 —— 码用掉后会变成正常在册`}
            >
              {invitedLabel(node.invited ?? {})}
            </span>
          ) : holderUnknownText(holders.length, seatCount, seatVacantish).length > 0 ? (
            <span
              style={{
                fontSize: FS.tag, fontWeight: 600, flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: LAMP_COLOR.amber,
              }}
              title={`这个位子占了 ${node.seat_count} 个席位，但没取到是谁 —— 点「刷新」再试一次；还不出来就是数据没同步。`}
            >
              {holderUnknownText(holders.length, seatCount, seatVacantish)}
            </span>
          ) : (
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
          )
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
                <>
                  <button
                    type="button"
                    onClick={() => { setResetArm(true) }}
                    disabled={busy}
                    title={`${primaryHolder?.name || '这个 Agent'} 连不上工位时点这里：换一把新钥匙放进保险箱，它下次来领任务自己取走（不会当场断线）`}
                    style={{ ...btnStyle(false), border: '1px solid #2f6f4e', color: '#2f6f4e' }}
                  >
                    🔑 重置连接
                  </button>
                  {resetArm ? null : (
                    <button
                      type="button"
                      onClick={() => setEvictArm(true)}
                      disabled={busy}
                      title={`请出 ${primaryHolder?.name || '?'}（凭证会作废，工位保留）${extraHolders > 0 ? `　⚠ 该位另有 ${extraHolders} 条在职记录（数据异常，请联系运维）` : ''}`}
                      style={{ ...btnStyle(false), border: '1px solid #c0392b', color: '#c0392b' }}
                    >
                      请出
                    </button>
                  )}
                </>
              )
            ) : invitedLive ? (
              /* ★★★ 2026-10-26 阿开（4️⃣ · 定稿）：
                 「就只显示『已受邀、人还没进来』这个，同时支持再次复制邀请码按钮，
                  除非邀请码过期了恢复邀请按钮状态」
                 ⇒ 三态收敛成两条线，判据是**码还有没有效**：
                   · 码有效 + 人未到 → 「已受邀、人还没进来」+「📋 复制邀请码」
                     （这一态**不给邀请按钮**：再发一张只会让两张码并存，
                       用户分不清该发哪张 —— 僵尸码就是这么堆起来的）
                   · 码过期 / 没码 → 回到「🔑 邀请」（自动，不需要用户手动切）
                 ★ 为什么不做「重新邀请」按钮：复制就够了。真过期了卡片自己会变，
                   不需要用户判断「我该点邀请还是重新邀请」。 */
              <span
                style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <button
                  type="button"
                  onClick={() => void copyInviteLink()}
                  disabled={busy}
                  style={{ ...btnStyle(false), padding: '3px 8px', fontSize: FS.tag, whiteSpace: 'nowrap' }}
                  title="把这张码的邀请链接再复制一次（发给人，或自己存着）"
                >
                  {copiedLink ? '✓ 已复制' : '📋 复制邀请码'}
                </button>
              </span>
            ) : seatLocked ? (
              /* ★★★ 2026-10-24 乙层：锁定坐席（签名位）不出邀请按钮。
                 为什么不是「禁用」而是「不渲染」：
                   灰按钮会让人以为「是不是条件没满足、等一等就能点」，
                   而这里是**永远不能点**（签名位是效力锚点，外部 Agent 入驻=冒充山海背书）。
                 所以给一句说明代替按钮 —— 让人知道**为什么**，而不是反复试。 */
              <span
                title="签名位由山海签名服务持有，只负责为「过程未被篡改」盖最终效力章，不对外邀请"
                style={{ fontSize: FS.tag, color: C.dim, whiteSpace: 'nowrap' }}
              >
                🔒 平台专属 · 不可邀请
              </span>
            ) : (
              /* ★★★ 2026-10-26（定稿 · 覆盖同日早前口径）阿开：
                 「卡片上的邀请按钮要……现在 UI 对了。唯一要修的就是卡片上要有
                  邀请按钮。没有邀请按钮怎么邀请人进来啊，我现在其他项目都停了」
                 ⇒ **空格卡片恢复「🔑 邀请」按钮**。
                 ★ 同日更早那条「卡片上不必有邀请按钮」是在 0.2.84 形态（席位总览在
                   工位下方）下说的，前提已变，口径作废；以本条为准。
                 ★ 点它就地展开邀请栏（InviteBar），座位类型跟着这张卡走
                   （`node.seatKey` 自动识别），不用回头再去别处选一遍。
                 ★ 与 `EmptySystemSeat` 的按钮同构 —— 用户看到的是同一件事，不该长得不一样。
                 ★★★ 2026-10-26（第二次更正）阿开：「点击之后没有收起按钮收不起来了」
                   ⇒ 按钮必须**双向**：未展开＝「🔑 邀请」，已展开＝「收起 ▴」。
                     否则展开后没有任何关闭入口，只能刷新页面。
                     状态源是父层的 `props.inviteOpen`（`inviting === node.node_id`），
                     本组件不自己存，避免两份状态打架。 */
              /* ★★ 2026-10-26 阿开：「收起按钮太丑了，之前是蓝色比较饱满的按钮」
                 ⇒ 「收起 ▴」改用 `btnStyle(true)`（实心 accent 蓝 + 白字，与
                   「生成邀请链接」那类主动作同一个视觉重量）。
                 未展开的「🔑 邀请」保持次要样式（描边）：一眼能分出
                 「现在该干什么」和「按下会发生什么」。 */
              <button
                type="button"
                onClick={() => props.onInvite()}
                disabled={busy}
                style={{
                  ...btnStyle(props.inviteOpen === true),
                  padding: props.inviteOpen === true ? '4px 12px' : '3px 8px',
                  fontSize: FS.tag,
                  whiteSpace: 'nowrap',
                }}
                title={props.inviteOpen ? '收起邀请栏' : '给这一位发一张加入码（座位类型跟着这张卡走）'}
              >
                {props.inviteOpen ? '收起 ▴' : '🔑 邀请'}
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

      {/* ★★ 2026-10-26 阿开：「重置按钮现在的方式不好，字太多工位卡座直接变形了，
          建议改成跟生成链接一样在卡片下面展开显示，保持卡片的长宽」
          ⇒ 把重置的二次确认**移出按钮行**，改为卡片底部独占一行的展开区。

          为什么之前会变形：按钮行是 `display:flex` 的单行容器（`marginTop:'auto'` 压底），
          把「确认重置 + 取消 + 三行长说明」全塞进去，flex 不知道该怎么折行
          ⇒ 要么把按钮挤扁，要么把 minHeight:78 的卡片撑高，卡座就不方了。

          现在的样子（与 InviteBar 同一个范式）：
            · 按钮行只剩 [🔑 重置连接] [请出]，永远两枚，宽度可预期
            · 展开区在下面独占整行，`auto` 高度 ⇒ 卡片只向下长，宽度不动
            · 展开时**隐藏「请出」**（见上面 `resetArm ? null :`）——
              避免同一行同时出现「确认重置」和「请出」两个红色危险动作，
              铺主一慌就点错。 */}
      {resetArm ? (
        <div
          style={{
            marginTop: 8,
            padding: '8px 10px',
            border: '1px solid #2f6f4e',
            borderRadius: 8,
            background: '#f2f8f4',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: FS.tag, color: '#2f6f4e', fontWeight: 600 }}>
            🔑 换一把新钥匙给 {primaryHolder?.name || '这个 Agent'}？
          </div>
          <div style={{ fontSize: FS.tag, color: C.dim, lineHeight: 1.5 }}>
            新钥匙放进保险箱，它下次来领任务时自己取走。<b>不会当场断开</b> ——
            旧钥匙 24 小时内仍可用，取走后自动作废。
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => { setResetArm(false); props.onResetKey(holders[0]?.agentId ?? '') }}
              disabled={busy}
              style={{ ...btnStyle(true), background: '#2f6f4e', borderColor: '#2f6f4e', fontSize: FS.tag }}
              title="生成新钥匙放进保险箱，Agent 下次来领任务时自己取走"
            >
              确认重置
            </button>
            <button
              type="button"
              onClick={() => setResetArm(false)}
              disabled={busy}
              style={{ ...btnStyle(false), fontSize: FS.tag }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
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

/** 按名字认席位（老数据可能没有 seatKey 字段） */

/* ══════════════════════════════════════════════════════════════════
 * TODO-待删除 · `resolveSeatKeyByName` 已整段搬到 `org/00-shared.tsx`
 *
 * 这段是什么：中文席别名 → 英文 seatKey 映射（后端只认英文键）
 *
 * 为什么还留在这：搬迁按「登山台阶」节奏走 —— 先搬出去、再验通、最后删原件。
 *   本次只做「① 搬出（已完成）」，原件保留在下方，与本文件其余部分共用一套上下文。
 *
 * 何时删：整个 20-org 域搬迁验通（tsc -b 全绿 + 12 套判据不回归）后统一删除。
 *   删除时连同本条注释一并删掉，不留「已搬走」的空壳说明。
 *
 * ★ 删除前必须确认：本文件已从上述路径 import 该符号，且下方没有任何本地引用。
 * ══════════════════════════════════════════════════════════════════ */
function resolveSeatKeyByName(name: string): string {
  const s = (name ?? '').trim()
  if (isAdvisorSeat(s, s)) return 'signature'
  if (s.includes('战略')) return 'strategy'
  if (s.includes('管理助理')) return 'management_assistant'
  if (s.includes('管理')) return 'management'
  if (s.includes('审计')) return 'audit'
  if (s.includes('执行')) return 'execution'
  return ''
}

/* ══════════════════════════════════════════════════════════════════
   ★★★ 2026-10-26 阿开：「你没有默认 6 个系统位啊…哪怕没有人也显示邀请按钮」

   两层一起修（只修一层都不够）：
     · 后端 `reconcile_org_seats`：补齐存量铺子的 6 个系统位
       （`provision_org` 只在首次开铺建，存量铺子永远只有 4 个）
     · 前端（本组件）：**系统位即使没有节点也渲染成系统位卡片**
       —— 有位名、有人数、有邀请按钮；只有「自建空位」才是纯空位块。
       这样后端补位万一失败，界面也不会塌。

   ★ 邀请为什么不做成 InviteBar：0.2.84 起「邀请」已是**铺级动作**
     （一张码进本铺，不绑定 node），空格拿不到 `InviteBar` 要的 `node`。
     这里点了直接展开上方的加入码卡（`setInviting('')` 收起旧展开态）。
   ══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
 * TODO-待删除 · `EmptySystemSeat` 已整段搬到 `org/23-empty-seats.tsx`
 *
 * 这段是什么：系统空位占位卡：格子里 78px 高，凑满 5×2 卡座
 *
 * 为什么还留在这：搬迁按「登山台阶」节奏走 —— 先搬出去、再验通、最后删原件。
 *   本次只做「① 搬出（已完成）」，原件保留在下方，与本文件其余部分共用一套上下文。
 *
 * 何时删：整个 20-org 域搬迁验通（tsc -b 全绿 + 12 套判据不回归）后统一删除。
 *   删除时连同本条注释一并删掉，不留「已搬走」的空壳说明。
 *
 * ★ 删除前必须确认：本文件已从上述路径 import 该符号，且下方没有任何本地引用。
 * ══════════════════════════════════════════════════════════════════ */
function EmptySystemSeat(props: {
  seatKey: string
  label: string
  seatInfo?: { occupied?: number; occupants?: unknown[]; invited?: unknown[] } | undefined
  locked?: boolean
  onInvite?: () => void
}): ReactElement {
  const { seatKey, label, seatInfo, locked, onInvite } = props
  /* ★★★ 2026-10-26 回归修复：管理助理位的「功能介绍与指定」入口丢了。
     0.2.96 把 `SeatSummaryRow` 从渲染中删掉（阿开要的是卡座 + 第三行说明，
     不要那六行汇总），但 `ManagementGrantSection` 只被那个汇总行的第 4 行
     内嵌渲染 ⇒ 授码功能随之失联，点不到入口。
     ⇒ 原位挂回：管理助理位卡片自己可点，就地展开，不依赖被删的汇总行。
     ★ 为什么不做成别的位也有：只有管理助理是「临时代管」语义，
       其余位是常驻岗位，授码会让人误解成可以随时换人。 */
  const [showMa, setShowMa] = useState(false)
  const isMa = seatKey === 'management_assistant'
  const isLocked = locked === true || seatKey === 'signature'
  /* ★ 人数口径与席位总览一致：只显示人数，不显示容量（「2 人」不是「2/1」） */
  const ppl = (() => {
    if (isLocked) return '（已占）'
    if (seatInfo === undefined) return '空'
    const n = Array.isArray(seatInfo.occupants)
      ? seatInfo.occupants.length
      : (typeof seatInfo.occupied === 'number' ? seatInfo.occupied : 0)
    if (n > 0) return `${n} 人`
    const inv = Array.isArray(seatInfo.invited) ? seatInfo.invited.length : 0
    return inv > 0 ? '已受邀' : '空'
  })()

  return (
    <>
    <div
      title={isLocked ? '山海签名位：平台常驻，不可邀请' : '这一位还没有人 —— 点「邀请」生成工位加入码'}
      style={{
        /* 与有节点的座位卡同构（同圆角 / 同最小高度），差别只在**虚线边框**：
           一眼看出「位在、人还没来」。 */
        border: `1px dashed ${isLocked ? C.accent : C.border}`,
        borderRadius: 10,
        padding: '8px 10px',
        minHeight: 78,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: FS.small, fontWeight: 600, color: C.text }}>{label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: FS.tag, color: isLocked ? C.accent : C.dim }}>{ppl}</span>
      </div>
      <div style={{ flex: 1, fontSize: FS.tag, color: C.dim, lineHeight: 1.5 }}>
        {isLocked ? '山海系统默认位' : '还没有人坐这一位'}
      </div>
      {/* ★ 管理助理位：点一下就地展开「功能介绍与指定」 */}
      {isMa ? (
        <button
          type="button"
          onClick={() => setShowMa((v) => !v)}
          style={{
            ...btnStyle(false),
            padding: '3px 8px',
            fontSize: FS.tag,
            alignSelf: 'flex-start',
          }}
          title="管理助理是临时代管：看一眼这个位干什么，以及怎么指定人"
        >
          {showMa ? '收起 ▴' : '功能介绍与指定 ▾'}
        </button>
      ) : null}
      {isLocked ? null : (
        <button
          type="button"
          onClick={() => { if (onInvite) onInvite() }}
          style={{ ...btnStyle(false), padding: '3px 8px', fontSize: FS.tag, alignSelf: 'flex-start' }}
          title="生成一张工位加入码，发给要坐这一位的同事"
        >
          🔑 邀请
        </button>
      )}
    </div>
    {/* ★ 展开区跨整行（gridColumn 1/-1）：卡片只有 1 列宽，撑不开授码表单 */}
    {isMa && showMa ? (
      <div style={{ gridColumn: '1 / -1', border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff', marginTop: 2 }}>
        <ManagementGrantSection embedded />
      </div>
    ) : null}
    </>
  )
}

/* ══════════════════════════════════════════════════════════════════
   管理助理位 · 就地展开容器
   ★ 为什么要单包一层：`EmptySystemSeat` 是**格子里**的卡（78px 高、
     同一行里横向并排），而展开区需要**跨整行**宽 —— 卡片自己撑不开。
   ⇒ 在卡座 map 那一层判断：管理助理位这一格，卡 + 展开区一起横跨整行。
   ══════════════════════════════════════════════════════════════════ */



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
   ★ 2026-10-23（083 单 G-2 · 星月）：**四段默认全部收起**。
   为什么改：四段全展开时卡片铺满整页，「先看要我干什么」反而要往下翻。
   现在打开任务页 = 四行标题（各带条数），想看哪段点哪段。
   · 互斥/独立：**独立** —— 可以同时展开多段（不抢占用户注意力，也不强制他关上一段）
   · 记住：`openSec` 记本次会话内的展开状态；未记录时才落 `openByDefault`
   · 条数 = 该段实际条数（`list.length`），不是估算
   · 收起 `›` / 展开 `⌄`，**整行可点**（不只箭头） */
const TASK_SECTIONS = [
  {
    key: 'todo',
    title: '待我处理',
    match: (t: TaskUi, _myId: string | null) => ['posted', 'rejected'].includes(normStatus(t.status)),
    empty: '没有要你处理的。有新任务时，卡片上直接有「领取」，一点就开工。',
    openByDefault: false,
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

/* ★ 2026-10-23 阿开定「不上向量上分类标签」—— 任务是**什么性质**（与状态正交）。
   `kind` 互斥单值，决定「要不要动手」；`tags` 多值关键词，决定「看哪几条」。
   对应 skill 的大类 / 关键词：先分流，再细看。 */
const KIND_LABEL: Record<string, string> = {
  requirement: '需求',
  delivery: '交付',
  report: '回函',
  test: '测试',
}
/* 配色刻意与状态色区分：状态是「流程走到哪」（蓝/黄/绿），
   kind 是「这是什么活」—— 用紫/青/灰，避免两套语义撞色。 */
const KIND_COLOR: Record<string, string> = {
  requirement: '#6366f1',
  delivery: '#0e7490',
  report: '#8a6d3b',
  test: '#9ca3af',
}

/**
 * ★★★ 2026-10-26（阿开定·甲案）：**阶段 → 性质** 的自动映射。
 *
 * 背景：界面原来有**两套分类** —— 项目卡片上六步（立需求→…→归档），
 * 新建任务里又有「这条是：需求/交付/回函/测试」。用户要学两个概念，
 * 阿开质问：「这个还在不是说好跟外面的六步流程一样吗？」
 *
 * 甲案：**用户只看到并选择一套 —— 阶段**。`kind` 退回成**系统字段**，
 * 由这里从阶段推出来，Agent 的分流行为一个字都不用改。
 *
 * 映射依据（为什么这么对，不是随便配的）：
 *   · 立需求 / 出计划书 / 分工 ⇒ `requirement`
 *       —— 这三个阶段派出去的都是「要人产出东西」的活（写需求、写方案、领任务）。
 *   · 施工 ⇒ `requirement`
 *       —— 施工期的任务绝大多数是「去做、做完交件」，也是要人产出。
 *   · 验收 ⇒ `report`
 *       —— 验收期派的多是「看一眼、给结论」，Agent 扫一眼即可，不必当重活。
 *   · 归档 ⇒ `report`
 *       —— 归档期只剩通知与留痕类。
 *
 * ★ 为什么不映射到 `test`/`delivery`：那两个是给「测试链路」「交回件」用的，
 *   属于**协作动作的类别**，不是项目阶段，硬映射会在验收期产生语义错位。
 *   这两类仍可由服务端按标题推断兜底（保留原有能力）。
 */
const PHASE_TO_KIND: Record<string, string> = {
  requirement: 'requirement',
  plan: 'requirement',
  assignment: 'requirement',
  build: 'requirement',
  review: 'report',
  archived: 'report',
}

/** 阶段 → 性质；未知阶段给空串（让服务端按标题推断，不比瞎猜差） */
function phaseToKind(phase: string): string {
  return PHASE_TO_KIND[phase] ?? ''
}

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
  /** ★ 2026-10-23 方案A：记录版本（v1=机制上线前 / v2=含中立性自证） */
  record_version?: string
  /** ★ 中立性已自证（四条判据全过） */
  neutrality_declared?: boolean
  neutrality_checks?: {
    checks?: Record<string, { passed?: boolean; detail?: string; evidence?: Record<string, unknown> }>
    passed_count?: number
    total?: number
    declared?: boolean
    note?: string
  }
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

/** ★ 2026-10-23 方案A · 古茶拍板第4条：出口声明的横幅（后端 neutrality_banner 一比一） */
interface NeutralityBannerUi {
  level?: 'ok' | 'warning' | 'legacy' | string
  red_flag?: boolean
  text?: string
}

/** ★ 四判据的人话名 —— 客户不该看到 `refusal_used` 这种字段名 */
const NEUTRALITY_LABEL: Record<string, string> = {
  refusal_used: '拒绝权是否真的用过',
  standard_self: '标准是否对自家也生效',
  evidence_carry: '客户能否自己验完、带走证据',
  replaceable: '席位能否换成第三方',
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

/** 生一个 uuid v4 —— 宿主若是非安全上下文则没有 `crypto.randomUUID`，用 getRandomValues 拼 */
function newUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (c !== undefined && typeof c.getRandomValues === 'function') {
    c.getRandomValues(b)
  } else {
    for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256)
  }
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

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
   ★ 2026-10-26 阿开：「工位下方的席位一览（只读）就不需要了，全部不要。
     只留管理助理（临时代管）」—— 原 `RolesSeatSection` 整块删除。

   为什么可以删（能力没少）：
     · 「每类几个位、坐了几人、空几个」→ 工位区顶部的 `SeatSummaryRow` 已经给全
       （6 个位 · 4 人已坐 · 3 个空 + 每类一行占用）
     · 「某一位上具体是谁」→ 工位卡片本身就在显示人（阿舟、财税专家、阿里星月…）
     · 「请人进来」→ 顶部常显的 `JoinCodeCard`（发码）+「管理助理（临时代管）」授码
     · 「请人出去」→ 工位卡片上的「请出」按钮
   所以这块只读表是**第三份重复信息**，删掉页面更干净。
   ⚠️ 后端 `GET /roles/seats` 与 `POST /invites` 一个都没动 —— 只是前端不再单列一块。
   ══════════════════════════════════════════════════════════════════ */



/* ══════════════════════════════════════════════════════════════════
   ★★ 管理助理授权面板（2026-10-23 · 承响石 018 号方案 + 阿开 A/B/C/D 拍板）

   解决的问题：
     管理位出差/休假时，铺子里的事谁来管？
     以前只能把管理位整个交出去（不可逆、且审计分不清谁是谁）。
     现在可以「借」一段时间出去 —— 到期自动还。

   四条规则直接写在界面上（不让人猜）：
     · 只有管理位本人能授、能收
     · **授权那一刻就开始计时**（不是首次使用才算）
     · 收回**即时生效**
     · 到期**自动转执行位**，不是权限归零（人还在铺子里干活）

   ★ 为什么显示「还剩多久」而不是「到期时间」：
     人看「还有 21 小时」有感觉，看「2026-10-24T07:52:41Z」没感觉。
   ══════════════════════════════════════════════════════════════════ */

function fmtRemain(sec: number): string {
  if (sec <= 0) return '已到期'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h >= 24) {
    const d = Math.floor(h / 24)
    return `还剩 ${d} 天 ${h % 24} 小时`
  }
  if (h > 0) return `还剩 ${h} 小时 ${m} 分`
  return `还剩 ${m} 分`
}

function ttlLabel(h: number): string {
  if (h === 24) return '24 小时（一次性代班）'
  if (h === 72) return '72 小时（跨周末）'
  if (h === 168) return '1 周（休假代班）'
  return `${h} 小时`
}

/* ★ 2026-10-23（083 单 G-1 · 星月）：管理助理改「授权码」
 *
 *  旧形态的两个毛病（星月原文）：
 *    ① 无令牌上下文时 `grant_list` 抛 401，**把原始错误码 + 接口路径 `POST /auth/device`
 *       渲染在界面上** —— 客户看到一行机器话，不知道下一步干什么；
 *    ② 界面让人手填「对方的 Agent id」—— 客户根本不知道对方那串内部 ID。
 *
 *  现在的形态：
 *    点「＋ 授权一个人临时代管」→ 选时长 →（可选）备注 → 「生成授权码」
 *    → 出示 `SHANHAI-GRANT-XXXX-XXXX` + 「📋 复制这段，发给对方」
 *    → 对方把码发给他自己的 Agent，Agent 调 `/grants/redeem` 兑换。
 *
 *  ★ 三条不变量：
 *    · 库内只存 `SHA256(code)`，明文**只在这里出现一次**（刷新页面就没了，属正常）
 *    · 码 7 天有效（`codeExpiresAt`）；**代管从兑换那一刻起算**（`expiresAt` 兑换时才定）
 *    · 错误一律说人话，原始码只进 `console.warn`（界面不许出现接口路径）
 */

/** 把服务端的机器话翻成山海语气：认证类失败一律指向「重新登录」，
 *  绝不把 `POST /auth/device` 之类路径摆到客户面前。 */
function grantErrText(code: string, message: string): string {
  const c = (code || '').toLowerCase()
  const m = (message || '').toLowerCase()
  if (
    c.includes('unauthor') || c.includes('401') || c.includes('token') ||
    c.includes('no_channel') || c.includes('not_configured') || c.includes('forbidden') ||
    m.includes('401') || m.includes('令牌') || m.includes('/auth/')
  ) {
    return '当前身份读不到授权记录，重新登录一下再试'
  }
  return message
}

/* ★ embedded：被 `SeatSummaryRow` 第 4 行内嵌展开时用。
   内嵌态不再套 `<Section>`（外层已在席位表里，再套一层标题会重复「管理助理位」），
   只渲染一句功能说明 + 指定入口。 */
function ManagementGrantSection({ embedded }: { embedded?: boolean }): ReactElement {
  const [rows, setRows] = useState<GrantRow[] | null>(null)
  const [ttlOptions, setTtlOptions] = useState<number[]>([24, 72, 168])
  const [err, setErr] = useState<{ code: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [ttl, setTtl] = useState(24)
  const [note, setNote] = useState('')
  const [expanded, setExpanded] = useState(false)
  /* 刚生成的码（明文只此一次） */
  const [issued, setIssued] = useState<GrantCodeIssued | null>(null)
  const [copied, setCopied] = useState(false)
  /* ★★ 2026-10-26 阿开三定稿：首选形态 = 从本铺已有 Agent 里挑人（不是发码） */
  const [seatAgents, setSeatAgents] = useState<{ agentId: string; name: string; lamp: string }[]>([])
  const [pickAgent, setPickAgent] = useState('')

  const refresh = async (): Promise<void> => {
    const r = await callPack<GrantListPayload>('grantList', {})
    if (r.ok) {
      setRows(Array.isArray(r.data.grants) ? r.data.grants : [])
      if (Array.isArray(r.data.ttlOptions) && r.data.ttlOptions.length > 0) {
        setTtlOptions(r.data.ttlOptions)
      }
      setErr(null)
    } else {
      /* ★ 详细码只进日志 —— 界面上只留人话（见 `grantErrText`） */
      console.warn('[grantList]', r.code, r.message)
      setErr({ code: r.code, message: r.message })
      setRows(null)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  /* 拉「本铺已坐着的 Agent」——可指派为代管的人，只能是已经在铺子里的
     ★ 只认 occupants（真实在场者），不认 holder.name（那是「位属于谁」的候选名） */
  useEffect(() => {
    void (async () => {
      const r = await callPack<RolesSeatsPayload>('rolesSeats', {})
      if (!r.ok) return
      const out: { agentId: string; name: string; lamp: string }[] = []
      const seen = new Set<string>()
      for (const st of Array.isArray(r.data.seats) ? r.data.seats : []) {
        for (const o of st.occupants ?? []) {
          const id = String(o.id ?? '')
          if (!id || seen.has(id)) continue
          seen.add(id)
          out.push({ agentId: id, name: String(o.name ?? id), lamp: String(st.seat ?? '') })
        }
      }
      setSeatAgents(out)
    })()
  }, [])

  /** 席位 key → 中文名（下拉里显示「星月 · 管理位」而不是「星月 · management」） */
  const seatLabelOf = (k: string): string => SEAT_LABELS[k] ?? k

  /** ★ 指派：走 grantCreate（直传 granteeId）—— 人已在铺，立即生效，不发码 */
  const onAssign = async (): Promise<void> => {
    if (pickAgent === '') return
    const who = seatAgents.find((a) => a.agentId === pickAgent)
    setBusy(true)
    setErr(null)
    const r = await callPack<{ grantId: string }>('grantCreate', {
      granteeId: pickAgent,
      ttlHours: ttl,
      ...(who ? { name: who.name } : {}),
      ...(note.trim().length > 0 ? { note: note.trim() } : {}),
    })
    setBusy(false)
    if (!r.ok) {
      console.warn('[grantCreate]', r.code, r.message)
      setErr({ code: r.code, message: r.message })
      return
    }
    setPickAgent('')
    setNote('')
    await refresh()
  }

  const onGenerate = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    setCopied(false)
    const r = await callPack<GrantCodeIssued>('grantGenerate', {
      ttlHours: ttl,
      ...(note.trim().length > 0 ? { note: note.trim() } : {}),
    })
    setBusy(false)
    if (!r.ok) {
      console.warn('[grantGenerate]', r.code, r.message)
      setErr({ code: r.code, message: r.message })
      return
    }
    setIssued(r.data)
    setNote('')
    await refresh()
  }

  const onCopy = async (): Promise<void> => {
    if (issued === null) return
    const text = grantCopyText(issued.code, issued.ttlHours, issued.codeExpiresAt)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      /* 剪贴板被拒（非 https / 无权限）时不算失败：那段话本来就摆在下面，手动选也能复制 */
      setCopied(false)
      setErr({ code: 'clipboard', message: '这段文字就摆在下面，手动选中复制也一样' })
    }
  }

  const onRevoke = async (gid: string): Promise<void> => {
    setBusy(true)
    setErr(null)
    const r = await callPack<{ grantId: string }>('grantRevoke', { grantId: gid, reason: '管理位手工收回' })
    setBusy(false)
    if (!r.ok) {
      console.warn('[grantRevoke]', r.code, r.message)
      setErr({ code: r.code, message: r.message })
      return
    }
    await refresh()
  }

  /* 未兑换的码（status='available'）：码还在，人还没来 */
  const pending = (rows ?? []).filter((x) => x.status === 'available')
  const active = (rows ?? []).filter((x) => x.status === 'active')
  const history = (rows ?? []).filter((x) => x.status !== 'active' && x.status !== 'available')

  const body = (
    <>
      {err !== null && (
        <div style={{ fontSize: FS.small, color: '#b3261e', marginBottom: 6 }}>
          {/* ★ 不渲染 `err.code` —— 界面上不许出现内部错误码 / 接口路径 */}
          {grantErrText(err.code, err.message)}
        </div>
      )}

      {/* ── 生效中的代管 ── */}
      {rows === null ? (
        <div style={{ fontSize: FS.small, color: 'rgba(0,0,0,.55)' }}>读取授权台账中…</div>
      ) : active.length === 0 ? (
        <div style={{ fontSize: FS.small, color: 'rgba(0,0,0,.55)' }}>
          当前没有人在代管。管理位出差或休假时，可以借一段时间的代管权出去。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {active.map((g) => (
            <div
              key={g.grantId}
              style={{ border: '1px solid #cfe3de', background: 'rgba(44,110,99,0.05)', borderRadius: 8, padding: '6px 10px', fontSize: FS.small }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                {/* ★ 需求 A-⑤：有名字显示名字，没名字说「对方未填名字」。
                    以前这里直接渲染 `g.granteeName` —— 对方没填就是**一片空白**，
                    看上去像页面坏了。`granteeId` 只用来判断"有没有兑换过"，不上屏。 */}
                <span style={{ fontWeight: 600 }}>
                  {granteeLabel(g.granteeName, g.granteeId)}
                </span>
                {granteeUnknown(g.granteeName) ? (
                  <span style={{ fontSize: FS.tag, color: C.dim }}>（已兑换）</span>
                ) : null}
                <span style={{ color: '#2c6e63', fontWeight: 600 }}>{fmtRemain(g.remainingSeconds)}</span>
                <button type="button" onClick={() => void onRevoke(g.grantId)} disabled={busy} style={btnStyle(false)}>
                  收回
                </button>
              </div>
              <div style={{ color: C.dim, marginTop: 2, fontSize: FS.tag }}>
                代管期 {ttlLabel(g.ttlHours)} · 到期自动转为执行位 · 收回立即失效
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 已生成·未兑换的码（可以作废，也可以先不管，7 天后自己失效）── */}
      {pending.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {pending.map((g) => {
            const left = codeLeftText(g.codeExpiresAt)
            return (
              <div
                key={g.grantId}
                style={{ border: `1px dashed ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: FS.tag, color: C.dim }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: C.text, fontWeight: 600 }}>已生成 · 未兑换</span>
                  <span>{left}</span>
                  <span>{ttlLabel(g.ttlHours)}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => void onRevoke(g.grantId)} disabled={busy} style={btnStyle(false)}>
                    作废
                  </button>
                </div>
                <div style={{ marginTop: 2 }}>码只在生成时显示一次；找不到就作废重新生成一张。</div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── 授权入口 ── */}
      <div style={{ marginTop: 8 }}>
        <button type="button" onClick={() => setExpanded(!expanded)} style={btnStyle(false)}>
          {expanded ? '收起' : '＋ 授权一个人临时代管'}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* ★★ 2026-10-26 阿开三定稿：
              「管理助理位参考 2.84 版本的功能……当时是可以选择代理时间。**指定某个工位的
                Agent 做助理**」
              ⇒ 首选形态是**从本铺已坐着的 Agent 里挑一个**，选时长，立即生效。
                人已经在铺子里，不需要再发码让他「进来一次」。
              ★ 码形态（grantGenerate）保留作兜底 —— 对方还没进铺时才用得上。 */}
          <div style={{ fontSize: FS.tag, color: C.dim }}>
            选一位已经在本铺的 Agent，借他一段代管权（到期自动回执行位）
          </div>
          <select
            value={pickAgent}
            onChange={(e) => setPickAgent(e.target.value)}
            style={{ padding: '4px 6px', fontSize: FS.small, borderRadius: 4, border: '1px solid rgba(0,0,0,.18)' }}
          >
            <option value="">— 选一位 Agent —</option>
            {seatAgents.length === 0 ? (
              <option value="" disabled>（本铺还没有可指派的 Agent）</option>
            ) : seatAgents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {a.name}{a.lamp ? ` · ${seatLabelOf(a.lamp)}` : ''}
              </option>
            ))}
          </select>
          <select
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value))}
            style={{ padding: '4px 6px', fontSize: FS.small, borderRadius: 4, border: '1px solid rgba(0,0,0,.18)' }}
          >
            {ttlOptions.map((h) => (
              <option key={h} value={h}>{ttlLabel(h)}</option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选，如：我出差三天）"
            style={{ padding: '4px 6px', fontSize: FS.small, borderRadius: 4, border: '1px solid rgba(0,0,0,.18)' }}
          />
          <button
            type="button"
            onClick={() => void onAssign()}
            disabled={busy || pickAgent === ''}
            style={btnStyle(pickAgent !== '')}
          >
            {busy ? '生效中…' : '指派为管理助理'}
          </button>
          <div style={{ fontSize: FS.tag, color: C.dim }}>
            对方还没进铺？<button
              type="button"
              onClick={() => void onGenerate()}
              disabled={busy}
              style={{ ...btnStyle(false), padding: '2px 8px', fontSize: FS.tag }}
            >生成一张授权码给他</button>
          </div>

          {/* ── 生成结果：一串码 + 一整段话 ── */}
          {issued !== null && (
            <div
              style={{
                marginTop: 4, border: '1px solid rgba(200,136,31,0.45)', background: 'rgba(200,136,31,0.06)',
                borderRadius: 8, padding: '9px 11px',
              }}
            >
              <div style={{ fontSize: FS.tag, color: C.dim }}>把这段发给对方（码只在这一次显示）</div>
              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: FS.small, fontWeight: 700, letterSpacing: '.06em',
                  color: '#A66A12', margin: '5px 0 7px', wordBreak: 'break-all',
                }}
              >
                {issued.code}
              </div>
              <button type="button" onClick={() => void onCopy()} style={btnStyle(false)}>
                {copied ? '✓ 已复制' : '📋 复制这段，发给对方'}
              </button>
              <pre
                style={{
                  margin: '7px 0 0', padding: '7px 9px', borderRadius: 6, background: 'rgba(0,0,0,.03)',
                  fontSize: FS.tag, color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontFamily: 'inherit', lineHeight: 1.6,
                }}
              >
                {grantCopyText(issued.code, issued.ttlHours, issued.codeExpiresAt)}
              </pre>
              <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 5 }}>
                码到 {String(issued.codeExpiresAt).slice(0, 10)} 前都能兑换 · 兑换后从那一刻起算 {ttlLabel(issued.ttlHours)}
              </div>
            </div>
          )}

          {/* ★ 规则写死在这 —— 授权这件事不能靠"用久了自然会知道" */}
          <div style={{ fontSize: FS.tag, color: 'rgba(0,0,0,.5)', lineHeight: 1.6 }}>
            · <b>兑换那一刻开始计时</b>（不是生成那一刻，也不是对方首次使用）<br />
            · 代管期间可做：派活/交活/传资料/发起审计/建项目/改名<br />
            · <b>不能做</b>：吊销身份、换密钥、调座位、发邀请、审批通过、归档冻结、导出数据<br />
            · 收回<b>立即生效</b>；到期<b>自动转执行位</b>并留转换记录
          </div>
        </div>
      )}

      {/* ── 历史（已收回 / 已到期）── */}
      {history.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: FS.tag, color: C.dim }}>
            历史（{history.length} 条）
          </summary>
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {history.map((g) => (
              <div key={g.grantId} style={{ fontSize: FS.tag, color: C.dim }}>
                {granteeLabel(g.granteeName, g.granteeId)} · {ttlLabel(g.ttlHours)} ·{' '}
                {g.status === 'expired' ? '已自然到期' : g.status === 'revoked' ? '已收回' : '已作废'}
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  )
  /* ★ embedded = 内嵌在席位表第 4 行里展开：不套 `<Section>`（标题已在上一行），
     只给一句「这个位做什么」+ 指定入口。非内嵌（旧挂载点）保原样。 */
  if (embedded === true) {
    return (
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: FS.tag, color: C.dim, lineHeight: 1.7, marginBottom: 8 }}>
          临时替管理位打理工位事务的人，<b>不占正式席位</b>、有时间限制；
          兑换那一刻开始计时，到期自动转执行位。代管期间不能吊销身份、换密钥、发邀请、审批。
        </div>
        {body}
      </div>
    )
  }
  return <Section title="管理助理（临时代管）">{body}</Section>
}

/** ★ 资料生命周期（2026-10-19 阿开）：打包下载 → 24h 后自动删除 → 可取消
 *
 *  为什么顺序是「先下载再删」而不是「直接删」：
 *    我们承诺「不保留用户资料」，但**不保留 ≠ 让你丢失**。
 *    先给文件，再谈删除；给 24 小时反悔期。
 */
/* ═══ 资料区按项目分组（2026-10-23 · 083 单 G-3）════════════════════════
 * 原来是一排「胶囊」，标签是 `task-<UUID>` 截 22 字 —— 客户看到一串机器号，
 * 而且 `slice(0, 8)` 把第 9 个往后全藏了（实际 15 个项目 ⇒ 一半不可及）。
 * 现在：按项目分组、每组可折叠、不做条数上限。
 * ★ 铁律：这一区**不出现 `interactionId`**（验收 A-4：主界面零 `task-` 字样）。 */
interface PackGroup {
  key: string
  name: string
  rows: PackInteractionItem[]
  files: number
  lastAt: string
}

/** 组内按最近上传、组间按最近活动（ISO 字符串可直接比大小） */
function groupPacks(rows: PackInteractionItem[]): PackGroup[] {
  const map = new Map<string, PackGroup>()
  for (const r of rows) {
    const pname = (r.projectName ?? '').trim()
    const pid = (r.projectId ?? '').trim()
    const key = pid !== '' ? `id:${pid}` : pname !== '' ? `name:${pname}` : '__none__'
    const g = map.get(key) ?? {
      key,
      /* ★★ 2026-10-26 阿开：「资料页没有项目归属的那批 —— 建议：如果下级能显示任务名称的就保留。
         如果没有数据就全删了。」+「以后就不会出现未归类了」
         ⇒ 分组名不再出现含糊的旧叫法：
           有项目名 → 用项目名；没项目名但**下级的协作本身有任务标题** → 用「未项目（有任务）」
           这种人话兜底，而不是空着或写「未归类」；连标题都没有的，整条在渲染层被丢弃（见下面的 filter）。
         ★ 为什么不叫「未归类」：阿开已定「以后不会出现未归类」，界面再写这三个字
           等于告诉客户「系统里还有这种东西」—— 那是存量尾巴，不该变成常态名词。 */
      name: pname !== '' ? pname : '未项目（有任务）',
      rows: [],
      files: 0,
      lastAt: '',
    }
    g.rows.push(r)
    g.files += Number.isFinite(r.files) ? r.files : 0
    if (typeof r.lastAt === 'string' && r.lastAt > g.lastAt) g.lastAt = r.lastAt
    map.set(key, g)
  }
  const out = [...map.values()]
  for (const g of out) {
    g.rows.sort((a, b) => (String(a.lastAt) < String(b.lastAt) ? 1 : -1))
  }
  /* ★★ 2026-10-26 阿开：「如果没有数据就全删了」——
     没有项目名、也没有任务标题的协作：二级显示不出任何有意义的名字（只能显示「N 个文件」），
     这种组留着就是一串机器号 + 一行数字，既说不清是哪活、也认不出是谁交的 ⇒ 整个组不渲染。
     ★ 判据必须**两边都空**才丢：只要有任务标题（`packLabel` 不是数字兜底），
       它就是「能说清是哪件事」的资料，留着有意义（阿开原话：「下级能显示任务名称的就保留」）。
     ★ 有项目名的组永远保留，哪怕一个标题都没有 —— 项目名本身就是归属线索。 */
  const hasNamed = (g: PackGroup): boolean =>
    g.name.length > 0 || g.rows.some((r) => (r.title ?? '').trim().length > 0)
  const kept = out.filter((g) => g.key !== '__none__' || hasNamed(g))
  kept.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
  return kept
}

/** 一次协作的人话名字：任务标题 → 项目名 → 「N 个文件」。**永不返回 interactionId。**
 *
 * ★★ 2026-10-26 阿开：「是否可以改成项目名称（文件数）—— 点开之后显示：
 *    任务名称（文件数）点开就显示真正的任务名称对应的附件 这样就清晰了」
 *   ⇒ 这里返回的是**第二级（任务名）**。第一级项目名由分组标题给（`groupPacks`）。
 *   ⇒ 去掉「这次协作」这种自造名词：那是系统的内部叫法，客户脑子里没有这个概念；
 *     他要的是「哪件事、几个文件」。有标题就给标题，没标题才退回项目名，
 *     再没有才退回文件数 —— 三级兜底，每一级都是人话。
 */
function packLabel(r: PackInteractionItem): string {
  const t = (r.title ?? '').trim()
  if (t !== '') return t
  const p = (r.projectName ?? '').trim()
  if (p !== '') return p
  const n = Number.isFinite(r.files) ? r.files : 0
  return n > 0 ? `未命名交付（${n} 个文件）` : '未命名交付'
}

function fmtDay(iso: string): string {
  const s = String(iso ?? '')
  return s.length >= 10 ? s.slice(0, 10) : s
}

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

  const upload = async (picked: File[] | FileList | null): Promise<void> => {
    const list = Array.from(picked ?? [])
    if (list.length === 0) {
      setErr({ code: 'no_file', message: '没选到文件 —— 请重新点「选择文件上传」再选一次' })
      return
    }
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

      {/* ★ 2026-10-23 阿开：「我点击上传文件的时候，发现有一个协作码…这个前端似乎可以隐藏，
          是给 Agent 用的，Agent 后端能拿到就可以」
          ⇒ 协作码（interactionId）不在主界面显示，收进「技术细节」折叠里，给排查时用。
             后端保证：任务的 interactionId 为空时回退 `task-<task_id>`，Agent 从任务视图一定拿得到。 */}
      <details style={{ marginBottom: 8 }}>
        <summary style={{ fontSize: FS.tag, color: C.dim, cursor: 'pointer' }}>
          这次传到哪儿（技术细节，通常不用看）
        </summary>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: FS.tag, color: C.dim }}>协作码</span>
          <code style={{ fontSize: FS.tag, padding: '3px 6px', background: 'rgba(0,0,0,.04)', borderRadius: 4, wordBreak: 'break-all' }}>
            {iid || '准备中…'}
          </code>
          <span style={{ fontSize: FS.tag, color: C.dim }}>（一次协作一个目录 · Agent 与人在同一次协作里各占一个座位）</span>
        </div>
      </details>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => input.current?.click()} disabled={busy} style={btnStyle(true)}>
          {busy ? '上传中…' : '选择文件上传'}
        </button>
        {/* ★ 2026-10-23：必须先 snapshot 成数组再清空 —— 直接用 e.target.files 引用，
            后面 `e.target.value=''` 会把 FileList 一起清空 ⇒ Array.from 拿到空 ⇒ 静默返回，
            用户看到的就是「选了文件没反应」。 */}
        <input ref={input} type="file" multiple onChange={(e) => {
          const picked = Array.from(e.target.files ?? [])
          e.target.value = ''
          void upload(picked)
        }} style={{ display: 'none' }} />
        <button type="button" onClick={() => onDone()} disabled={busy} style={btnStyle(false)}>
          去「资料（按位）」看看
        </button>
      </div>

      {notice !== null && <div style={{ marginTop: 8, fontSize: FS.small, color: '#1f7a3d' }}>{notice}</div>}
      {err !== null && <div style={{ marginTop: 8, fontSize: FS.small, color: '#b3261e' }}>[{err.code}] {err.message}</div>}
    </Section>
  )
}

function PackSection({ onUpload, focus }: {
  onUpload: () => void
  focus: { interactionId: string; title?: string | undefined } | null
}): ReactElement {
  /* ★ 2026-10-19 阿开：「记住的交互 ID 和座位放服务端更方便」——
     从 localStorage 挪到 `GET/POST /workstation/context`：换机器、重装插件都还在。
     ★★ 2026-10-24：「上传选项」折叠区已撤 ⇒ advRef/advTick 整条展开链一并删除
        （它唯一用途是从工位页跳过来展开设备台账，而设备台账 10-22 已移出本页）。 */
  const [iid, setIid] = useState<string>('')
  /* ★ 2026-10-21：有资料的交互清单 —— 打包下载 404 是因为手里的 iid 是历史遗留的 */
  const [packIids, setPackIids] = useState<PackInteractionItem[]>([])
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
  /* ★★★ 2026-10-24 阿开：「生成工位加入码」单独成一个栏框、不折叠。
     ⇒ 生成逻辑与 UI 已抽成 <JoinCodeCard />（资料页 + 工位顶部各挂一份），
        PackSection 里的 joinCode/joinTtl/joinBusy/joinCopied/guideCopied 全部作废删除。
     ★ 为什么两处各挂一份而不是共享状态：加入码是「生成一次、当场甩给同事」的动作，
       两边都是生成器，各生成各的码，不存在跨页面状态不同步的困惑。 */

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

  /* ★ 2026-10-22 修（阿开实报「资料不见了」）：原来只在挂载时跑一次 refresh，
     那时 `iid` 还是空 ⇒ 直接 return，页面停在「还没有拉到列表」；
     稍后从服务端恢复出 iid 也**不会**再触发 ⇒ 永远拉不到。⇒ 改为跟随 iid/seat。 */
  useEffect(() => {
    if (iid.trim().length === 0) return
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iid, seat])

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

  /* ★ 2026-10-22 阿开：设备台账/流水移出资料页（设备有自己的 tab）⇒ 入口按钮已撤。
     函数保留：将来做「设备审计」时还要用同一个接口，删了会断 API 约定。 */
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
        <span style={{ fontSize: FS.small, color: C.dim }}>当前在看</span>
        {/* ★ G-3：这里原来直接渲染 `interactionId`（`task-<UUID>`）——
            客户看不懂，更记不住。改成「这次协作的人话名字」。 */}
        <span style={{ fontSize: FS.small, fontWeight: 600, color: C.text }}>
          {(() => {
            const cur = packIids.find((x) => x.interactionId === ref.interactionId)
            if (cur !== undefined) return packLabel(cur)
            if (!ref.interactionId) return '（还没选 —— 去「＋ 传文件」传一次就有了）'
            return '这次协作'
          })()}
        </span>
        <button type="button" onClick={() => void refresh()} disabled={busy} style={btnStyle(false)}>
          刷新
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onUpload} disabled={busy} style={btnStyle(true)} title="传文件不在这一页做 —— 单独一页，免得和查看混在一起">
          ＋ 传文件
        </button>
      </div>

      {/* ★ 2026-10-20 阿开：「生成交付 ID 还可以生成不知道是干嘛用的，那一行都多余」
          ⇒ 主界面不再摆技术字段，收进「高级」；日常看资料/传资料都用不到它们。 */}
      {/* ★ 2026-10-21 阿开：「打包下载提示目录不存在」—— 不用再猜 iid，这里列出真有东西的 */}
      {/* ★ 2026-10-23（G-3）：一排胶囊 → 按项目分组列表。
          · 每组标题行「项目名 · N 个协作 · M 个文件」，整行可折叠
          · **去掉 `slice(0, 8)`** —— 有几个项目就列几个（验收：15 个项目全部可及）
          · 组内按最近上传、组间按最近活动
          · 任何位置都不出现 `interactionId`（`title` 属性里也不放） */}
      {packIids.length > 0 ? (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: FS.tag, color: C.dim }}>有资料的协作（按项目分）</div>
          {groupPacks(packIids).map((g) => (
            <details
              key={g.key}
              open
              style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: 'transparent' }}
            >
              <summary
                style={{
                  cursor: 'pointer', padding: '6px 10px', display: 'flex',
                  alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}
              >
                <b style={{ fontSize: FS.small, fontWeight: 600, color: C.text }}>{g.name}</b>
                <span style={{ fontSize: FS.tag, color: C.dim }}>
                  {g.rows.length} 个协作 · {g.files} 个文件
                </span>
              </summary>
              <div style={{ padding: '0 10px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {g.rows.map((x) => {
                  const active = x.interactionId === iid
                  return (
                    /* ★ 必须包一层 Fragment：`.map` 的箭头是 `=> (` 单表达式，
                       直接返回两个同级元素（条目 button + 下方附件区）编译不过。 */
                    <Fragment key={x.interactionId}>
                    <button
                      type="button"
                      onClick={() => {
                        /* ★★ 2026-10-26：点「正在看」的那条 ⇒ 收起（再点一次关掉）；
                           点别的条 ⇒ 切过去并展开。这样「同一条再点」不会没反应。 */
                        if (active) { setIid(''); void persist({ interactionId: '' }); return }
                        setIid(x.interactionId); void persist({ interactionId: x.interactionId })
                      }}
                      style={{
                        display: 'flex', alignItems: 'baseline', gap: 8, width: '100%',
                        textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                        padding: '5px 8px', borderRadius: 6, fontSize: FS.small,
                        border: `1px solid ${active ? '#1f2937' : 'transparent'}`,
                        background: active ? 'rgba(31,41,55,0.06)' : 'transparent',
                        color: active ? C.text : C.dim,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0, color: active ? C.text : undefined }}>
                        {packLabel(x)}
                      </span>
                      <span style={{ flex: '0 0 auto', fontSize: FS.tag }}>
                        {x.files} 个文件 · 最近 {fmtDay(x.lastAt)}
                        {' '}
                        <span style={{ color: active ? '#1f2937' : '#98a2b3', fontWeight: 600 }}>
                          {active ? '收起 ▴' : '展开 ▾'}
                        </span>
                      </span>
                    </button>
                    {/* ★★ 2026-10-26：附件就地展开在**这条协作下方**。
                        原来附件区在整页最底部，几十条协作时点了看不到任何变化。 */}
                    {active ? (
                      <PackFileList
                        files={files}
                        busy={busy}
                        onDownload={(n) => void onDownload(n)}
                        onDelete={(n) => void onDelete(n)}
                        inline
                      />
                    ) : null}
                    </Fragment>
                  )
                })}
              </div>
            </details>
          ))}
        </div>
      ) : null}

      {/* ★ 2026-10-22 阿开：这块是一整个类目（换交互/座位/项目/备注），
          不该长成一行灰字 —— 按「更多」里的卡片语言做成独立一栏，左侧色条跟其它区区分开。 */}
      {/* ★★★ 2026-10-24 阿开：「资料页的那个就可以删除了」
          ⇐= 资料页这份 <JoinCodeCard /> **整块删除**，生成邀请码只留工位页一处。
          ⚠ 铁律：同一个东西只留一个地方（本轮之前正是两处各挂一份 = 违反了自己写在下面的铁律）。
          ★ 为什么留工位页那份而不是资料页这份：邀请码是「请谁坐哪个位」的动作，
            工位页才是做这个决定的地方（人、格子、空位都在同一视线里）。
          ★ 资料页这里原挂的「上传选项」折叠容器已于 2026-10-24 先撤
            （交互ID/座位/项目/备注四个裸输入框 —— 日常有默认值，需要改的场景还没出现）。
          ⇒ 删后资料页直接从文件列表区接 notice/err，不出现空的色条栏。 */}

      {notice !== null && (
        <div style={{ marginTop: 6, fontSize: FS.small, color: '#1f7a3d' }}>{notice}</div>
      )}
      {err !== null && (
        <div style={{ marginTop: 6, fontSize: FS.small, color: '#b3261e' }}>
          [{err.code}] {err.message}
        </div>
      )}

      {/* ★★ 2026-10-26：原来这里还有一份「按当前 iid 渲染的附件列表」。
          现在附件就地展开在「选中的那条协作」正下方（见上方 PackFileList inline），
          底部再挂一份 = 同一个东西两处显示，违反本项目自己的铁律
          （「同一个东西只留一个地方」）。⇒ 底部整块撤掉，只留没选中时的说明。
          ★ 撤的理由：列表中每条协作下方已经有它自己的附件，底部这份永远是
            「上面那条的重复」，而且离视线远 —— 正是阿开说的「点了不知道发生了什么」。 */}
      {ref.interactionId.length === 0 ? (
        <div style={{ marginTop: 6, fontSize: FS.small, color: 'rgba(0,0,0,.55)' }}>
          <strong>按位</strong>：每个座位一个抽屉，一次协作一个文件夹 ——
          <code style={{ fontSize: FS.tag }}>packs/&lt;铺&gt;/&lt;座位&gt;/&lt;交互ID&gt;/</code>
          。执行位交的稿、审计位出的报告分开存，谁交的一眼能看出。
          {' '}座位留空 ⇒ 由服务端按你的身份解析。
          {' '}ID／座位／项目／备注都存在服务端（换机器、重装插件都还在）；
          改 ID 等于换目录，**旧资料不会跟过来**。
          {' '}上面点任意一条「这次协作」，附件会**就地**展开在它下面。
        </div>
      ) : null}

    </Section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   附件列表 · 可嵌在「选中的那次协作」正下方（2026-10-26 阿开）

   ★ 阿开原话：「资料页面，点击这次协作（XX个文件）在看，
     建议把附件就显示在当前选中的在看下方，方便人类查看，
     目前是在底部，现在当前协作太多了，点击之后都不知道发生了什么？」

   ★ 为什么必须内联到条目下方：
     原来附件区在整个页面的**最底部**，而协作列表按项目分组、可能几十条
     ⇒ 点了「这次协作（3 个文件）」之后，附件出现在视口之外，
       用户看不到任何变化 —— 现象上就是「点了没反应」。
     这不是「提示不够」，是**反馈不在视线内**，加提示治不了。

   ★ 为什么抽成组件：内联渲染 + 底部渲染要用同一份 UI，
     两处各写一遍必然漂移（一处改了另一处忘），这正是本项目反复栽的坑。
   ══════════════════════════════════════════════════════════════════ */
function PackFileList(props: {
  files: PackFileItem[] | null
  busy: boolean
  onDownload: (name: string) => void
  onDelete: (name: string) => void
  /** 内联态：外框淡一点，表示"这是上面那条协作的内容"，不是独立区块 */
  inline?: boolean
}): ReactElement {
  const { files, busy, onDownload, onDelete, inline } = props
  const box: React.CSSProperties = inline === true
    ? {
        marginTop: 2, marginLeft: 12, padding: '6px 10px',
        borderLeft: '2px solid rgba(200,136,31,0.45)',
        background: 'rgba(200,136,31,0.04)', borderRadius: '0 6px 6px 0',
        display: 'flex', flexDirection: 'column', gap: 2,
      }
    : { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }
  if (files === null) {
    return <div style={{ ...box, fontSize: FS.tag, color: 'rgba(0,0,0,.55)' }}>正在读取文件清单…</div>
  }
  if (files.length === 0) {
    return <div style={{ ...box, fontSize: FS.tag, color: 'rgba(0,0,0,.55)' }}>这次协作还没有附件。</div>
  }
  return (
    <div style={box}>
      {files.map((f) => {
        const name = typeof f.filename === 'string' ? f.filename : ''
        if (name.length === 0) return null
        return (
          <div
            key={`${typeof f.seat === 'string' ? f.seat : ''}/${name}`}
            style={{
              display: 'flex', gap: 8, alignItems: 'center', fontSize: FS.small,
              padding: '3px 0', borderBottom: '1px solid rgba(0,0,0,.06)',
            }}
          >
            <span style={{ flex: 1, wordBreak: 'break-all' }}>{name}</span>
            <span style={{ color: 'rgba(0,0,0,.55)', whiteSpace: 'nowrap' }}>{fmtBytes(f.size)}</span>
            <button type="button" onClick={() => onDownload(name)} disabled={busy} style={btnStyle(false)}>
              下载
            </button>
            <button type="button" onClick={() => onDelete(name)} disabled={busy} style={btnStyle(false)}>
              删除
            </button>
          </div>
        )
      })}
    </div>
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
  /* ★★★ 2026-10-26 甲案：任务的「所属阶段」（六步之一），替掉原来的「性质」下拉。
     · newPhase   = 用户看到并选择的值（默认跟项目当前阶段走）
     · phaseTouched = 用户是否手动改过。改过就不再被「项目阶段变了」覆盖 ——
       否则用户选好「立需求」，切个项目回来就被冲掉，那种静默改写比不给选更糟。 */
  const [newPhase, setNewPhase] = useState<string>('requirement')
  const [phaseTouched, setPhaseTouched] = useState(false)
  /* ★ 期6-L2：项目归属（空 = 未归类） */
  const [projects, setProjects] = useState<ProjectItem[]>([])

  /* ★ 2026-10-21：项目清单读失败以前是**静默**的（「读失败不清空」）⇒
     阿开连着两次说「项目不见了」却没有任何提示。现在把失败摆出来。 */
  const [projErr, setProjErr] = useState<{ code: string; message: string } | null>(null)
  // ★ 2026-10-21：按项目筛选任务。此前只能看到「全部任务」，项目只是一张贴纸 ——
  //   「一个项目现在到哪了」要自己一条条认。空串 = 全部，'__none__' = 未归类。
  const [projFilter, setProjFilter] = useState<string>('')
  /* ★★ 2026-10-26 台阶⑤（阿开 V3 图共识）：一个搜索框 + 两个单选。
     ★ 为什么用一个框而不是两个框（阿开原话：「甲的话搜索框可能有点隐藏别人不知道任务属于哪个项目」）：
       两个框会逼用户**先把关键词输两遍**，而且搜任务时不知道它属于哪个项目。
       一个框 + 单选：关键词只输一次，切模式**保留**（阿开：「避免一个关键词输入 2 次」）。
     ★ 两个模式的语义差别（阿开定）：
       - 项目模式：搜**项目名**，命中的项目卡片高亮/筛选
       - 任务模式：搜**任务标题+正文**，★ **跨全部项目**（不受 `projFilter` 限制），
         结果仍按四段组织，卡片带项目名 —— 否则「这个活是哪个项目的」就丢了。 */
  const [searchMode, setSearchMode] = useState<'project' | 'task'>('project')
  const [kw, setKw] = useState<string>('')
  /* ★ 2026-10-23 阿开：「任务首页默认显示 ›待我处理 ›我在做 ›已交待审 ›已完成，不要折叠」
     ★ 2026-10-23 晚（083 单 G-2 · 星月·阿开拍板）：**四段默认全收起**。
       上一版把它读成「四段全展开」（0.2.78），结果卡片铺满一页 ——
       阿开要的是「打开就看到这四行」，不是「打开就看到全部卡片」。
       ⇒ 现在：四行标题（各带实际条数）在，卡片收起；`openSec` 记本次会话的展开状态。 */
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({})
  /* ★ 2026-10-21：只有一个项目时**自动选中它** —— 否则「全部」状态下看不到项目条，
     也就看不到「申请审计」，阿开连着两次说「找不到按钮」就是这个原因。 */
  /* ★ 2026-10-23（古茶 002「一键挂载」）：项目 → 审计 → 带签名报告。
     服务端建单后立刻返回，跑审在后台（四灯场景，几分钟）⇒ 这里只存 id/status，
     由 effect 每 5 秒问一次；`report` 到了才渲染结论。 */
  const [audit, setAudit] = useState<{
    id: string
    /** ★ 记住这张单属于哪个项目 —— 审计提示要贴在**那一行按钮**旁边，不能全表都显示。 */
    projectId: string
    status: string
    report: AuditReportUi | null
    /** ★ 2026-10-23 方案A：中立性出口声明（后端 neutrality_banner 一比一，用于标红） */
    neutralityBanner?: NeutralityBannerUi | null
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
         直接把「先去归档」这条路指出来（用户点的是审计按钮，脑子里想的是送审）。
         ★★ 2026-10-21 阿开：这类提示要跟「已取消 —— 先把剩下的活干完」放在**同一个位置**
            （项目区 `projNotice`）—— 全局提示离归档按钮太远，看见也不知道往哪点。 */
      if (r.code === 'audit_not_enabled') {
        setProjNotice('审计功能还没开通 —— 请联系管理员开通后再送审。')
        setNotice(null)
        return
      }
      if (r.code === 'project_draft_only') {
        setProjNotice('这份是「暂存」包，不能当定稿送审 —— 把剩下的活干完，正式归档一次再送审。')
        setNotice(null)
        return
      }
      if (r.code === 'project_not_frozen') {
        setProjNotice('请先归档，定稿后送审 —— 审计要针对一个确定的版本。点本项目的「归档」，归档完再回来点审计。')
        setNotice(null)
        return
      }
      if (r.code === 'archive_stale') {
        setProjNotice('解冻过 ⇒ 之前的归档包已作废。请重新归档（生成新的 sha256）后再送审。')
        setNotice(null)
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
    /* ★ 2026-10-21 阿开：「已送去审计 —— 四灯在看资料…」别放页面顶部，
       要贴在**审计按钮旁边**（点完就在原地看见，不用抬头找）。 */
    setAudit({ id: r.data.id, projectId, status: r.data.status ?? 'queued', report: null })
    setNotice(null)
  }

  /* 审计单轮询：只在 queued/running 时跑，出结论就停 */
  useEffect(() => {
    if (audit === null) return
    if (audit.status !== 'queued' && audit.status !== 'running') return
    const id = audit.id
    let alive = true
    const timer = setInterval(() => {
      void callActionData<{ status: string; report: AuditReportUi | null; neutrality_banner?: NeutralityBannerUi | null }>('auditGet', {
        auditId: id,
      }).then((r) => {
        if (!alive || !r.ok) return
        setAudit((prev) =>
          prev === null || prev.id !== id
            ? prev
            : {
                ...prev,
                status: r.data.status ?? prev.status,
                report: r.data.report ?? prev.report,
                neutralityBanner: r.data.neutrality_banner ?? prev.neutralityBanner ?? null,
              },
        )
      })
    }, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [audit?.id, audit?.status])

  /* ★ 2026-10-24（083-r1）· 派活时「顺手通知谁」。
     ★ 名单来源：工位状态里的 members（`kind==='agent'` 且在编）。进页面拉一次。
     ★ 拉不到就保持 null ⇒ **下拉整行不渲染**，退回纯公池。「读不到名单」和
       「铺子里一个 Agent 都没有」是两件事，不能都画成一个空下拉（空下拉会让人
       以为自己的 Agent 没进来 —— 这正是阿开上一轮遇到的问题）。
     ★ 默认空串 = 谁在岗谁领。硬约束：默认必须不点名，存量行为零变化。 */
  const [notifyId, setNotifyId] = useState<string>('')
  const [agentOpts, setAgentOpts] = useState<NotifyChoice[] | null>(null)
  useEffect(() => {
    let alive = true
    void loadWorkstationState().then((snap) => {
      if (!alive || snap.state === null) return
      setAgentOpts(agentChoices(snap.state.members))
    })
    return () => {
      alive = false
    }
  }, [])
  const notifyChoices = agentOpts ?? []
  const notifyPick = notifyChoices.find((c) => c.id === notifyId) ?? null

  /* ★★ 2026-10-24（083-r3）· 发布到哪个工位。
     ★ 数据源与工位页**同一个端点**（`orgTree`），不用另一套接口 ——
       两处显示要「看起来是同一个东西」，数据上就得是同一份。
     ★ 拉不到就保持 null ⇒ 选择器整块不渲染，退回公共池（不画空图，免得误发）。 */
  const [nodeId, setNodeId] = useState<string>('')
  const [nodeOpts, setNodeOpts] = useState<OrgNodeView[] | null>(null)
  useEffect(() => {
    let alive = true
    void loadOrgTree().then((r) => {
      if (!alive) return
      /* 口径统一走 node-pick；类型上 OrgNodeView 已含 seq/holders/invited，直接喂 */
      if (r.ok) setNodeOpts(sortedNodes(r.data.nodes) as unknown as OrgNodeView[])
    })
    return () => { alive = false }
  }, [])
  const nodeChoices = nodeOpts === null ? [] : sortedNodes(nodeOpts)
  const nodePick = nodeChoices.find((n) => n.node_id === nodeId) ?? null
  /** 任务卡用：node_id → 「#2 执行位」。认不出来（工位已删/未加载）就返回空 ⇒ 卡片按公共池显示 */
  const nodeLabelOf = (id?: string | null): string => {
    if (typeof id !== 'string' || id.length === 0) return ''
    const hit = nodeChoices.find((n) => n.node_id === id)
    return hit === undefined ? '' : nodeChipLabel(hit)
  }

  const [projId, setProjId] = useState('')
  /* ★ 2026-10-26 甲案：「所属阶段」默认跟项目当前阶段走。
     ★ 为什么用 useEffect 挂在 projId 上，而不是在每处 setProjId 里都写一行：
       现在有「新建项目后自动选中」「下拉切换」等多个入口，逐处写必漏（这项目已经栽过
       「搬家漏删」的坑）。挂在 projId 上，**不关心是谁改的**，只关心它变了。
     ★ 为什么不覆盖 phaseTouched：用户手选过的值属于用户的决定，
       被「切项目」这种副作用冲掉，是静默改写用户输入 —— 比不给选更糟。 */
  useEffect(() => {
    if (phaseTouched) return
    const cur = projects.find((p) => p.projectId === projId)
    const ph = cur?.phase
    if (typeof ph === 'string' && ph !== '' && ph !== 'archived') setNewPhase(ph)
  }, [projId, projects, phaseTouched])

  const [projNew, setProjNew] = useState(false)
  const [projName, setProjName] = useState('')
  const [projNotice, setProjNotice] = useState<string | null>(null)
  /* ★ 2026-10-21 阿开：「取消归档后再点归档，提示任务读不到 / 服务端返回 400」
     —— 真实原因：还有未完成任务，后端拒了（project_incomplete），
        而前端用 window.confirm 二次确认，在宿主里不可靠 ⇒ 报错被当成「读不到任务」。
     ⇒ 改成**页内两段式**：先说清有几个没完成，给一个「仍要暂存」按钮。 */
  const [pendingArchive, setPendingArchive] = useState<{ projectId: string; name: string; message: string } | null>(null)
  /* ★ 2026-10-23 阿开：「新建任务的时候希望可以上传附件，或者拖入附件自动上传」
     ⇒ 发布前先在本地攒附件，点「发布」时：建任务 → 拿 task_id → 传附件到 task-<uuid>。
     为什么不在选文件时就传：那时还没有 task_id，交互 ID 无主，传上去就是孤儿件。 */
  const [draftFiles, setDraftFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const draftInput = useRef<HTMLInputElement | null>(null)
  /* ★ 2026-10-23 阿开：「项目名称也改不了」⇒ 项目行内改名 */
  const [renaming, setRenaming] = useState<{ projectId: string; name: string } | null>(null)
  /* ★ 2026-10-23：`showAll` 已移除 —— 后端默认全量返回（含已完成后端已实现），
     这个开关没有可切的东西了，留着只会是个永不变化的状态。 */
  const [notice, setNotice] = useState<string | null>(null)
  /* 身份与两个折叠区（块 C / 块 D） */
  const [myId, setMyId] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<Flagged>({ kind: 'pending' })
  const [pending, setPending] = useState<Flagged>({ kind: 'pending' })
  const [openBlocked, setOpenBlocked] = useState(false)
  const [openPending, setOpenPending] = useState(false)

  /* ★ 2026-10-23：`all` 参数去掉 —— 服务端已默认全量返回（含 accepted/cancelled），
     客户端不必再分两次要。保留 false 的语义会让「已完成」在新的默认下反而取不到。 */
  const refresh = async (): Promise<void> => {
    const r = await loadTasks(true)
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
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const onPublish = (): void => {
    const t = title.trim()
    if (t.length === 0) return
    /* ★★ 2026-10-26 阿开：「以后就不会出现未归类了。除非用户自己创建一个项目名字叫未归类」
       ——「同时要重构逻辑，就是发布任务之前必须先选一个项目或者新建一个项目。UI 要改。
          Agent 发布任务页要改。」
       ⇒ 项目成了**必填**：没选就不许发。
       ★ 为什么把闸放在点击这一刻，而不是把按钮置灰：
         置灰的按钮不解释原因（阿开反复说过「点了没反应」是最难查的）；
         点了给一句「先选项目」+ 指路，比一个灰按钮有信息量。
       ★ 错误进 `err`（source='action'）而不是弹窗：本面板在 DSH 宿主里，`confirm/alert` 不可靠。 */
    if (projId.trim().length === 0) {
      setErr({
        code: 'project_required',
        message: '发布前先选一个项目（或点「＋ 新项目」建一个）。任务的归属靠项目，没项目的任务没人认得出是哪一版。',
        source: 'action',
        title: '还差一个项目',
      })
      return
    }
    /* 发布结果要说清「发到哪、指派给谁」（派单书 §三-任务3）——
       一次派五个任务时，最容易犯的错就是选错工位，发完必须让人看见。
       ★ 文案在点发布这一刻就定下来：之后清空表单，不能等回调再读 state。 */
    const okText = publishToast(nodePick === null ? '' : nodeChipLabel(nodePick), notifyPick?.name ?? '')
    void run(async () => {
      /* ★ 2026-10-23：先给这次任务预生交互 ID（`task-<uuid>`），随任务一起落库，
         附件才有确定的家 —— 否则「先传文件再建任务」时无法知道该传给谁。 */
      const tid = newUuid()
      let r = await createTask(
        t, detail.trim(), projId || undefined, `task-${tid}`, phaseToKind(newPhase) || undefined,
        notifyId || undefined, nodeId || undefined,
      )
      /* ★ 2026-10-24（083-r1）：服务端这版 `POST /tasks` 还没有 notifyAgent 字段，
         带了就整条 400 `unknown_field`（这属于**整单被拒**，没有副作用 —— 探针实测过）。
         ⇒ 去掉该字段重发一次，不让一个「顺手的便利」把派活本身搞失败；
           但必须当场说明「这次其实没点名」，不能让人以为点名生效了。
         ★ 083-r3（2026-10-24 实测）：线上已认 `notifyAgent` 与 `nodeId`（探针分别回
           `agent_not_found` / `node_not_found`，都是零副作用）。这层降级因此成了**保险**，
           不再在主路径上触发 —— 但保留：字段被回退时业务不能跟着挂。 */
      let degraded = false
      if (!r.ok && notifyId.length > 0 && isNotifyUnsupported(r.code, r.message)) {
        degraded = true
        r = await createTask(
          t, detail.trim(), projId || undefined, `task-${tid}`, phaseToKind(newPhase) || undefined,
          undefined, nodeId || undefined,
        )
      }
      /* 失败一律翻成人话（`agent_not_found` / `node_not_found` 不上屏码，只进 console） */
      if (!r.ok) {
        return {
          ok: false,
          code: r.code,
          message: humanizePublishError(r.code ?? '', notifyFailText(r.code, r.message)),
        }
      }
      /* 任务建好了 ⇒ 再传附件。附件失败不回滚任务（任务已在板上，人看得见），
         但必须明确告知哪几个没上去 —— 不静默吞。 */
      const files = draftFiles
      if (files.length > 0) {
        const bad: string[] = []
        for (const f of files) {
          if (f.size > PACK_MAX_BYTES) {
            bad.push(`${f.name}（${fmtBytes(f.size)} 超过单件上限 ${fmtBytes(PACK_MAX_BYTES)}）`)
            continue
          }
          try {
            const b64 = await readFileAsBase64(f)
            const up = await callPack<PackFileItem>('packUpload', {
              interactionId: `task-${tid}`, seat: '', filename: f.name, contentBase64: b64,
            })
            if (!up.ok) bad.push(`${f.name}：${up.message}`)
          } catch (e) {
            bad.push(`${f.name}：${e instanceof Error ? e.message : String(e)}`)
          }
        }
        setTitle('')
        setDetail('')
        setDraftFiles([])
        setComposing(false)
        setNotifyId('')
        setNodeId('')
        if (bad.length > 0) {
          setNotice(`${okText}；但有 ${bad.length} 个附件没传上去：${bad.join('；')}${degraded ? ` · ${NOTIFY_DEGRADED_NOTICE}` : ''}`)
        } else {
          setNotice(`${okText}，附件 ${files.length} 个已上传${degraded ? ` · ${NOTIFY_DEGRADED_NOTICE}` : ''}`)
        }
        return { ok: true }
      }
      setTitle('')
      setDetail('')
      setComposing(false)
      setNotifyId('')
      setNodeId('')
      /* 无附件分支由 run 的 okMsg 收尾（已换成「发到哪 + 指派给谁」）；
         降级时覆盖掉那句成功提示，否则「已发布」会盖住「其实没点名」这个事实。 */
      if (degraded) setNotice(`${okText} · ${NOTIFY_DEGRADED_NOTICE}`)
      return r
    }, okText)
  }

  /** 收下附件（选择 或 拖入）—— 只攒在本地，发布时才真正上传 */
  const addDraftFiles = (picked: File[]): void => {
    if (picked.length === 0) return
    setDraftFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}`))
      return [...prev, ...picked.filter((f) => !seen.has(`${f.name}|${f.size}`))]
    })
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

  /** ★ 2026-10-23：项目改名（只改名字，project_id 不动 ⇒ 任务归属不受影响） */
  const onRenameProject = (): void => {
    if (renaming === null) return
    const n = renaming.name.trim()
    if (n.length === 0) return
    const pid = renaming.projectId
    void run(async () => {
      const r = await renameProject(pid, n)
      if (r.ok) {
        setRenaming(null)
        const pr = await loadProjects()
        if (pr.ok) setProjects(pr.data.projects)
      }
      return r
    }, '项目名已改')
  }

  /** 归档项目：打包 + manifest（不删原件） */
  const onArchive = (p: ProjectItem): void => {
    void run(async () => {
      const r = await archiveProject(p.projectId)
      /* ★ 甲案：默认拦截、显式暂存。没做完 ⇒ 页内给「仍要暂存」按钮，
         不用 window.confirm（宿主里不可靠，会让 400 被显示成「任务读不到」）。 */
      if (!r.ok && r.code === 'project_incomplete') {
        setPendingArchive({ projectId: p.projectId, name: p.name, message: r.message ?? '' })
        setProjNotice(null)
        return { ok: true }
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

  /* ★★ 2026-10-26 阿开：「未归类全删了。以后就不会出现未归类了」
     ⇒ `__none__`（无项目）这一支**删除** —— 筛选只有「全部」和「某个项目」两种。
     存量无项目的任务仍会出现在「全部项目」里（不丢数据），但没有一个「无项目」的筛选项。 */
  const visibleTasks = projFilter === ''
    ? tasks
    : tasks.filter((t) => t.projectId === projFilter)

  /* ★★ 2026-10-26 台阶⑤（阿开 V3 图共识）：搜索。
     ★★ 核心规矩（阿开亲定三条，别改）：
       ① 任务模式下结果**仍按四段组织**、卡片带项目名 —— 所以这里只**筛数据**，
          不改四段的渲染结构（`TASK_SECTIONS` 照旧生效）。
       ② 任务模式**跨全部项目**，不受 `projFilter` 限制 —— 否则「搜东西却只搜到一个项目里」
          是反直觉的；阿开的原话是「一个项目里的任务比项目多很正常，一个项目交付可能上百次」。
       ③ 切换模式时关键词**保留** —— `kw` 独立于 `searchMode`，切模式不清空。
          （阿开：「避免一个关键词输入 2 次」）
     ★ 匹配范围：标题 + 正文（`detail`）。正文很重要 ——
       他要搜「科目余额」这种只在正文里出现的词。
     ★ 大小写不敏感（`toLowerCase`），中文不受影响但英文标签能搜到。 */
  const kwNorm = kw.trim().toLowerCase()
  const searchHit = (t: TaskUi): boolean => {
    if (kwNorm === '') return true
    const hay = ((t.title ?? '') + ' ' + (t.detail ?? '')).toLowerCase()
    return hay.includes(kwNorm)
  }
  /* ★ 两个模式各自的最终结果：
       - 项目模式：四段数据仍按 `projFilter` 走（点项目卡片切换），搜索只作用于**项目卡片**（见渲染层）
       - 任务模式：★ 从 `tasks` 全量筛（跨全部项目），不看 `projFilter` */
  const searchedTasks = searchMode === 'task' ? tasks.filter(searchHit) : visibleTasks
  /* 项目名命中（项目模式下高亮项目卡片用） */
  const projHit = (id: string, name: string): boolean =>
    kwNorm !== '' && searchMode === 'project' && (name ?? '').toLowerCase().includes(kwNorm)
  /* ★ 2026-10-26：`data.counts`（全铺九态）与 `countOf` **已不再使用** ——
     标题行的状态数改为按当前选中项目现数（见下面 `projCounts` / `countInView`）。
     ★ 留着它会留下一个「看起来还在用的全量计数」，下一个改这里的人一定误用。 */

  /* ★★ 2026-10-26 阿开：「上方的四段就显示哪个项目的数据」——
     标题行那排状态数原读 `data.counts`（**全铺九态**），项目一切换它不动 ⇒ 数字与四段打架。
     ⇒ 改成先按 `visibleTasks`（已含项目筛选）重新聚合，再落到同一套九态键上。
     ★ 为什么不直接用 `visibleTasks.length`：九态各有各的名（posted/claimed/…），
       混成一个总数就分不出「待领 3」和「在做 3」—— 而这两个数正是标题行要回答的。
     ★ 键名与后端九态一致，`countOf` 的旧键回落**在这一层之前**（`normStatus`）已经规整过。 */
  const projCounts = (() => {
    const m: Record<string, number> = {}
    for (const t of searchedTasks) {
      const k = normStatus(t.status)
      m[k] = (m[k] ?? 0) + 1
    }
    return m
  })()
  const countInView = (status: string): number => {
    const n = projCounts[status]
    if (typeof n === 'number') return n
    if (status === 'posted') return projCounts['open'] ?? 0
    if (status === 'accepted') return projCounts['done'] ?? 0
    return 0
  }

  const blockedCount = blocked.kind === 'ok' ? blocked.rows.length : 0
  const pendingCount = pending.kind === 'ok' ? pending.rows.length : 0

  /* ★★★ 2026-10-26 阿开：「底部的流程有了，四段展开调整了，但是没有跟随每一个项目走 还是在底部」
     ★ 根因（查出来的，跟我原来以为的不同）：项目卡片在一个容器（5882–6031），
       四段+任务卡片在**另一个并列容器**（6343–6446），阶段条孤零零卡在两个容器之间的空隙里。
       三层彼此不相连 ⇒ 无论点哪个项目，它们都永远渲染在页面最底部。
     ★ 为什么抽成函数而不是整块搬：四段要引用 searchedTasks/openSec/myId 等 10+ 个外层变量，
       搬进 map 会让闭包关系难读；抽成「按项目渲染流程区」的函数，参数只有 cur ——
       一眼看得出它跟哪个项目走。
     ★ 为什么用 column + 左侧竖线 + 缩进：视觉上挂到项目卡片「下面」，而不是跟卡片平行。
       阿开说的「跟随项目走」，靠缩进+竖线比靠距离更可靠 —— 距离会被 flexWrap 打乱。 */
  const renderProjectFlow = (cur: ProjectItem): ReactElement => {
    const ph = cur.phase
    const curIdx = phaseIndex(ph)
    const nx = nextPhase(ph)
    const pv = prevPhase(ph)
    const archived = isArchivedPhase(ph)
    return (
      <div style={{
        marginLeft: 12, marginTop: 6, marginBottom: 10,
        paddingLeft: 10, borderLeft: `2px solid ${C.accent}44`,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{
          ...cardStyle, marginBottom: 6, padding: '8px 12px',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: FS.small, fontWeight: 600 }}>
            {cur.name}
          </span>
          {/* ★ 六步节点条（2026-10-26 阿开：列出六步、当前高亮、可点改）
              —— 每一步都带名字，不再用 `●●●○○○`：点阵看不出走到哪一步，
                 只能看出走了几步。带名字才能「看见自己在流程的哪一环」。
              —— 可点：铺主 / 管理助理点任意一步直接跳（后端只许 ±1 与 →archived，
                 越级由服务端 409 拦，前端不做第二套判据）。 */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {PROJECT_PHASES.map((p, i) => {
              const done = curIdx > i + 1
              const isCur = curIdx === i + 1
              const canClick = !busy && !isCur
              return (
                <span key={p} style={{ display: 'flex', alignItems: 'center' }}>
                  {i > 0 ? (
                    <span style={{ fontSize: FS.tag, color: done || isCur ? C.accent : C.faint, margin: '0 1px' }}>
                      ›
                    </span>
                  ) : null}
                  <span
                    title={phaseHint(p) + (canClick ? ' · 点击跳到这一步' : '')}
                    onClick={canClick ? () => { void run(async () => {
                      const r = await setProjectPhase(cur.projectId, p)
                      return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message }
                    }, `已切到「${phaseLabel(p)}」`) } : undefined}
                    style={{
                      fontSize: FS.tag,
                      fontWeight: isCur ? 700 : 400,
                      cursor: canClick ? 'pointer' : 'default',
                      padding: '2px 6px',
                      borderRadius: 4,
                      color: isCur ? '#fff' : (done ? C.accent : C.dim),
                      background: isCur ? C.accent : 'transparent',
                      border: `1px solid ${isCur ? C.accent : (done ? C.accent : C.border)}`,
                    }}
                  >
                    {phaseLabel(p, cur.phase === p ? cur.phaseLabel : undefined)}
                  </span>
                </span>
              )
            })}
          </span>
          <span style={{ fontSize: FS.tag, color: archived ? '#1e7e42' : C.dim }}>
            第 {curIdx}/{PROJECT_PHASES.length} 步
          </span>
          {/* ★ 归档态不给「推进」：归档是出口，没有下一步。
              也不给「退回」—— 归档=冻结，要改先解冻（那是另一个动作，不能藏在这里）。 */}
          {archived ? (
            <span style={{ fontSize: FS.tag, color: C.faint }}>已归档 · 冻结不再改</span>
          ) : (
            <>
              {pv !== null ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { void run(async () => {
                    const r = await setProjectPhase(cur.projectId, pv)
                    return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message }
                  }, `已退回「${phaseLabel(pv)}」`) }}
                  title={`退回上一步：「${phaseLabel(pv)}」`}
                  style={{ ...btnStyle(false), padding: '3px 10px', fontSize: FS.tag }}
                >
                  ← {phaseLabel(pv)}
                </button>
              ) : null}
              {nx !== null ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { void run(async () => {
                    const r = await setProjectPhase(cur.projectId, nx)
                    return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message }
                  }, `已推进到「${phaseLabel(nx)}」`) }}
                  title={phaseHint(nx)}
                  style={{ ...btnStyle(true), padding: '3px 10px', fontSize: FS.tag }}
                >
                  {phaseLabel(nx)} →
                </button>
              ) : null}
            </>
          )}
        </div>
          <div>
            {/* ★★★ 2026-10-26 阿开定（任务页设计图 V3 §三）：四段由「竖排长条」改为「并排一行」。
                ★ 为什么并排：竖排时四个长条各占一整行，四个段头就吃掉 4 行高度，
                  而这一行里其实只写了「段名 + 条数 + 展开」，横向空间全浪费。
                  并排后四段共用一行，页面立刻短一截。
                ★ 为什么 flex:1 平均分：阿开原话「把一行平均分一下就可以了」——
                  不按内容宽度自适应，因为四段条数变化会让按钮宽度跳来跳去，反而更难扫。
                ★ 为什么卡片移到「四段行下方」而不是留在段内：每段只占 25% 宽，
                  卡片塞进 25% 格子里会挤成一列窄条；移到整行下方，卡片有全宽可用。 */}
            <div style={{ display: 'flex', gap: 6 }}>
              {TASK_SECTIONS.map((sec) => {
                const list = searchedTasks.filter((t) => sec.match(t, myId))
                const open = openSec[sec.key] ?? sec.openByDefault
                return (
                  <button
                    key={sec.key}
                    type="button"
                    onClick={() => setOpenSec((p) => ({ ...p, [sec.key]: !open }))}
                    aria-expanded={open}
                    /* ★ 展开态的三条线索沿用 0.2.94 的实证结论（阿开：「展开不知道可以收」）：
                       ① 常显文字「展开 ▾ / 收起 ▴」—— 字比图形好认，这是主线索
                       ② 边框 1px 灰 → 2px 蓝（用「线粗」而不是「色深」，浅底上加深看不出来）
                       ③ 内边距同步减 1px，抵消边框增厚，避免四段并排时高度不齐
                       ★★ 2026-10-26 台阶⑧（阿开定）：「四段的展开按钮建议放在 数字背后同一行
                          这样可以更好看一些。目前是上下2行」⇒ **改成单行**：
                          圆点 · 段名 · 条数 · 展开▾ —— 全在一行。
                          ★ 展开指示**紧跟数字**（`marginLeft: 2`），不推到最右 ——
                            阿开说「数字背后」，就是紧贴；推远会让它跟数字脱钩。
                          ★ 为什么不用 column 两行：四个段各多占一行 = 白吃掉 ~20px 高度，
                            而第二行只有一个「展开」两字，横向空间全浪费。 */
                    style={{
                      flex: 1, minWidth: 0,
                      display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5,
                      background: open ? 'rgba(59,111,224,0.10)' : '#fff',
                      border: `${open ? '2px' : '1px'} solid ${open ? C.accent : '#d0d5dd'}`,
                      borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                      padding: open ? '5px 9px' : '6px 10px',
                      fontFamily: 'inherit', color: C.text,
                      transition: 'border-color 160ms, background 160ms',
                      overflow: 'hidden',
                    }}
                  >
                    {/* 圆点：区分「有活/没活」，一眼扫出哪段该点 */}
                    <span
                      aria-hidden="true"
                      style={{
                        flex: '0 0 auto', width: 6, height: 6, borderRadius: 3,
                        background: list.length > 0 ? C.accent : '#d0d5dd',
                      }}
                    />
                    <span style={{
                      fontSize: FS.small, fontWeight: 600, whiteSpace: 'nowrap',
                      overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
                      color: list.length > 0 ? C.text : C.dim,
                    }}>
                      {sec.title}
                    </span>
                    <span style={{
                      flex: '0 0 auto', minWidth: 16, textAlign: 'center',
                      fontSize: FS.tag, fontWeight: 600,
                      color: list.length > 0 ? C.text : C.dim,
                    }}>
                      {list.length}
                    </span>
                    {/* 展开/收起指示：推到最右（marginLeft:'auto'），与条数同一行
                        ★ 阿开原话「放在 数字背后同一行」= 紧跟在数字后面
                        ⇒ 不用 marginLeft:auto 推远，紧贴数字更符合"背后"这个说法 */}
                    <span
                      aria-hidden="true"
                      style={{
                        flex: '0 0 auto', marginLeft: 2,
                        fontSize: FS.tag, fontWeight: 600,
                        color: open ? C.accent : '#667085',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {open ? '收起 ▴' : '展开 ▾'}
                    </span>
                  </button>
                )
              })}
            </div>
            {/* ★ 展开的卡片：挂在「四段这一行」的下方，占整行宽度，按 TASK_SECTIONS 顺序排列。
                ★ 四段互不影响（甲案）：可以同时展开多段，各段卡片依次往下排。
                ★ 空段不显示卡片区（不占位置），只有展开了且有内容/有提示才出现。 */}
            {TASK_SECTIONS.map((sec) => {
              const list = searchedTasks.filter((t) => sec.match(t, myId))
              const open = openSec[sec.key] ?? sec.openByDefault
              if (!open) return null
              return (
                <div key={sec.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {list.length === 0 ? (
                    <div style={{ ...cardStyle, fontSize: FS.tag, color: C.dim }}>{sec.empty}</div>
                  ) : (
                    list.map((t) => (
                      <CardBoundary key={t.task_id}>
                        <TaskCard task={t} myId={myId} busy={busy} run={run} projectName={projectNameOf(t.projectId)} nodeLabel={nodeLabelOf(t.node_id)} allTasks={tasks} />
                      </CardBoundary>
                    ))
                  )}
                </div>
              )
            })}
          </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: FS.title, fontWeight: 600 }}>任务</div>
        {['posted', 'claimed', 'in_progress'].map((k) => {
          const n = countInView(k)
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
        {/* ★ 2026-10-23 阿开：「任务一级页面新建任务旁边的那个新建项目按钮可以取消了，
            我发现新建项目还要发布任务，不如直接从新建任务里面创建项目更好（里面已有新建按钮）」
            ⇒ 顶部这个独立入口去掉；建项目只在「＋ 新任务」表单里做（那儿建完自动选中项目）。 */}
        <button type="button" onClick={() => setComposing((v) => !v)} disabled={busy} style={btnStyle(true)}>
          {composing ? '收起' : '＋ 新任务'}
        </button>
      </div>

      {/* ★ 2026-10-23：顶部「＋ 新项目」已去掉（阿开：建项目应在新建任务里就地做） */}

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
          {/* ★★★ 2026-10-26 阿开定（甲案）：原「这条是：需求/交付/回函/测试」下拉改掉。
              ★ 为什么改：那是**另一套分类**，跟项目卡片上的六步流程（立需求→出计划书→分工→
                施工→验收→归档）毫无关系。用户看到两个都叫「流程/分类」的东西必然困惑 ——
                阿开原话：「这个还在不是说好跟外面的六步流程一样吗？」
              ★ 甲案精神：**用户只学一套概念**。界面只留六步（任务的「所属阶段」）；
                后端 `kind` 是 Agent 分流字段，**由阶段自动映射**（见 phaseToKind），用户不用懂。
              ★ 为什么自动带入 + 允许改：90% 的任务就属于项目当前阶段，每次手选是浪费；
                但偶尔要补一条早期阶段的任务（比如施工期补一条「立需求」），所以允许改。
              ★ 为什么「跟着项目」而不是写死：项目阶段会推进，切项目后默认值必须跟着变
                （见 useEffect 里的同步）；用户一旦手改过，就不再被覆盖（touched 标记）。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: FS.tag, color: C.dim }}>
            <span>所属阶段</span>
            <select
              value={newPhase}
              onChange={(e) => { setNewPhase(e.target.value); setPhaseTouched(true) }}
              style={{ ...inputStyle, padding: '3px 6px', flex: '0 0 auto', width: 130 }}
            >
              {PROJECT_PHASES.filter((p) => p !== 'archived').map((p) => (
                <option key={p} value={p}>{phaseLabel(p)}</option>
              ))}
            </select>
            <span style={{ color: C.faint }}>
              跟项目当前阶段走，可改 · Agent 按它分流
            </span>
          </div>
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
              {/* ★★ 2026-10-26：「未归类」不再是可选项 —— 它是**未选**的占位，
                  不是一种分类。选它等于没选，发布时会被拦下。 */}
              <option value="">（先选一个项目）</option>
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
          {/* ★ 2026-10-24（083-r1）· 顺手通知谁。
              ★ 为什么用下拉而不是两个单选框：卡片窄，单选框要占两行；
                一个下拉就能表达同一个两态（首项 = 谁在岗谁领）。
              ★ 为什么读不到名单就整行不渲染：空下拉会被读成「我的 Agent 没进来」，
                那是上一轮阿开已经误会过一次的地方 —— 宁可不显示，也不给错信号。 */}
          {agentOpts !== null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: FS.tag, color: C.dim, flexWrap: 'wrap' }}>
              <span>{NOTIFY_LABEL}</span>
              <select
                value={notifyId}
                onChange={(e) => setNotifyId(e.target.value)}
                style={{ ...inputStyle, padding: '3px 6px', flex: '0 0 auto', width: 190 }}
              >
                <option value={NOTIFY_PUBLIC_VALUE}>{NOTIFY_PUBLIC_LABEL}</option>
                {notifyChoices.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <span style={{ color: C.faint, lineHeight: 1.5 }}>{notifyPickHint(notifyPick)}</span>
            </div>
          ) : null}
          {/* ★★ 2026-10-24（083-r3）· 发布到哪个工位。
              ★ 为什么是「缩小版工位图」而不是下拉框：阿开原话「与实际工位号和显示一致，
                这样就不需要切换工位界面去核对」。下拉框能选，但对不上号 —— 那正是要解决的问题。
              ★ 序号只用 `seq`、姓名只用 `holders[].name`，两处调用同一组函数（node-pick），
                所以选择器与工位页**不可能慢慢跑偏**。*/}
          {nodeOpts !== null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: FS.tag, color: C.dim }}>发布到哪个工位？</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {nodeChoices.map((n) => {
                  const on = nodeId === n.node_id
                  return (
                    <button
                      key={n.node_id}
                      type="button"
                      onClick={() => setNodeId(on ? PUBLIC_POOL_VALUE : n.node_id)}
                      title={pickerHint(n)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
                        padding: '4px 8px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                        border: `1px solid ${on ? C.accent : C.border}`,
                        background: on ? 'rgba(59,111,224,.10)' : '#fff',
                        maxWidth: 180,
                      }}
                    >
                      <span style={{
                        fontSize: FS.tag, fontWeight: on ? 700 : 600,
                        color: on ? C.accent : C.text, whiteSpace: 'nowrap',
                      }}>{nodeChipLabel(n)}</span>
                      <span style={{
                        fontSize: 10, color: C.dim, maxWidth: 164,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{nodeChipWho(n)}</span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setNodeId(PUBLIC_POOL_VALUE)}
                  title="不绑工位，所有 Agent 都能看到"
                  style={{
                    display: 'flex', alignItems: 'center', padding: '4px 8px', borderRadius: 7,
                    cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px ${nodeId === PUBLIC_POOL_VALUE ? 'solid' : 'dashed'} ${nodeId === PUBLIC_POOL_VALUE ? C.accent : C.border}`,
                    background: nodeId === PUBLIC_POOL_VALUE ? 'rgba(59,111,224,.10)' : 'transparent',
                    fontSize: FS.tag, fontWeight: nodeId === PUBLIC_POOL_VALUE ? 700 : 600,
                    color: nodeId === PUBLIC_POOL_VALUE ? C.accent : C.dim,
                  }}
                >{PUBLIC_POOL_LABEL}</button>
              </div>
              <div style={{ fontSize: FS.tag, color: C.faint }}>
                {nodePick === null
                  ? '不绑工位：所有 Agent 都能看到这条'
                  : `绑到 ${nodeChipLabel(nodePick)}：只有这个工位的 Agent 会看到`}
              </div>
            </div>
          ) : null}
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
          {/* ★ 2026-10-23 阿开：「增加一行备注提示」（建完就改不了名/删不掉，事先说清） */}
          {projNew ? (
            <div style={{ fontSize: FS.tag, color: C.dim, lineHeight: 1.6 }}>
              备注：项目一经创建<strong>不可删除</strong>（项目是任务与资料归档的锚，删了它们会失去归属）；
              收尾请用「归档」，归档有包可还原。名称事后可以在项目行里改。
            </div>
          ) : null}

          {/* ★ 2026-10-23 阿开：「新建任务的时候希望可以上传附件，或者拖入附件自动上传」
              拖拽热区 = 整个发布卡片；点「添加附件」也可以。 */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              addDraftFiles(Array.from(e.dataTransfer?.files ?? []))
            }}
            style={{
              border: `1px dashed ${dragOver ? 'rgba(59,111,224,.75)' : C.border}`,
              background: dragOver ? 'rgba(59,111,224,.06)' : 'transparent',
              borderRadius: 6, padding: '8px 10px',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => draftInput.current?.click()} disabled={busy} style={btnStyle(false)}>
                📎 添加附件
              </button>
              <span style={{ fontSize: FS.tag, color: C.dim }}>
                {dragOver ? '松手就加上' : '也可以把文件直接拖到这里'}
              </span>
              <input
                ref={draftInput}
                type="file"
                multiple
                onChange={(e) => {
                  /* ★ 必须先 snapshot 再清空 —— 清 value 会把 FileList 一起清掉 */
                  const picked = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  addDraftFiles(picked)
                }}
                style={{ display: 'none' }}
              />
            </div>
            {draftFiles.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {draftFiles.map((f, i) => (
                  <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: FS.tag }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </span>
                    <span style={{ color: C.dim }}>{fmtBytes(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => setDraftFiles((prev) => prev.filter((_, k) => k !== i))}
                      style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: '#b3261e', fontSize: FS.tag, padding: '0 2px',
                      }}
                      title="从这次发布里去掉"
                    >
                      移除
                    </button>
                  </div>
                ))}
                <div style={{ fontSize: FS.tag, color: C.dim }}>
                  共 {draftFiles.length} 个，发布时一起上传到这次任务的资料区（单件上限 {fmtBytes(PACK_MAX_BYTES)}）
                </div>
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button type="button" onClick={onPublish} disabled={busy || title.trim().length === 0} style={btnStyle(true)}>
              发布
            </button>
          </div>
        </div>
      ) : null}
      {/* ★ 期6-L2 · 项目（长期实体：归档 = 打包全部资料 + manifest；不删原件） */}
      {projects.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          {/* ★★★ 2026-10-26 台阶⑦（阿开定）：搜索框 + 两个单选**搬进「项目」标题同一行**。
              ★ 阿开原话：「搜索框不需要单独占一行 放中间就可以了 也不要那么长 太长了
                点项目和任务不方便」。
              ★ 为什么搬上来：搜索框本来和这排标题是**一个模块**，单独占一行既浪费高度、
                又把「项目」标题和它要筛的卡片隔开。合到一行后标题行就是「操作条」。
              ★ 为什么收窄 + 居中：撑满(flex:1)会让「清空」和两个单选被推到手很远的右边；
                固定 220px 居中，手指/鼠标落点在中间，符合阿开说的「点起来不方便」的痛点。
              ★ 为什么保留 flexWrap：窄屏（手机）放不下时**整块换行**，不压缩搜索框。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: FS.title, fontWeight: 600 }}>项目</div>
            <span style={{ fontSize: FS.tag, color: C.dim }}>{projects.length}</span>
            <span style={{ flex: 1 }} />
            {/* 搜索框 + 单选：一个模块，居中放标题行右半 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="text"
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder={searchMode === 'project' ? '🔍 项目名…' : '🔍 任务关键词（标题+正文，全部项目）…'}
                style={{
                  /* ★★ 2026-10-26 阿开实测：「太短了，连默认的提示语都没显示全」。
                     220px 是按「🔍 项目名…」这种短提示语定的宽；但任务模式那句是
                     「🔍 输入任务关键词（标题+正文，全部项目）…」，20 个汉字放不下 ⇒
                     被截成「🔍 输入任务关…」，等于提示语失效（人被截断的框劝退，不知道能搜什么）。
                     ⇒ 改两层宽：
                       · 项目模式 240px（提示语短，够用就好，别占位）
                       · 任务模式 320px（照最长提示语按字宽算：20 汉字 × 14px ≈ 280 + 图标 + 内边距）
                     ★ 不给 flex:1：撑满会把「清空」和两个单选推到很远的右边，阿开说过点起来不方便。 */
                  width: searchMode === 'project' ? 240 : 320,
                  padding: '5px 9px', fontSize: FS.tag,
                  border: '1px solid ' + C.border, borderRadius: 6, background: '#fff', color: C.text,
                }}
              />
              {kw !== '' ? (
                <button
                  type="button"
                  onClick={() => setKw('')}
                  style={{ ...btnStyle(false), fontSize: FS.tag, padding: '3px 7px' }}
                  title="清空关键词"
                >
                  清空
                </button>
              ) : null}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: FS.tag, color: C.dim }}>
                {([['project', '项目'], ['task', '任务']] as const).map(([k, label]) => (
                  <label
                    key={k}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer',
                      color: searchMode === k ? C.accent : C.dim,
                      fontWeight: searchMode === k ? 600 : 400,
                    }}
                  >
                    <input
                      type="radio"
                      name="searchMode083"
                      checked={searchMode === k}
                      onChange={() => setSearchMode(k)}
                      style={{ cursor: 'pointer', margin: 0 }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <span style={{ fontSize: FS.tag, color: C.dim }}>归档 = 打包资料 + 清单，不删原件</span>
          </div>
          {pendingArchive !== null ? (
            <div style={{ ...cardStyle, marginBottom: 6, borderLeft: '3px solid #c9a227', padding: '9px 11px' }}>
              <div style={{ fontSize: FS.small, marginBottom: 6 }}>
                <b>「{pendingArchive.name}」还不能正式归档</b>
                <div style={{ opacity: 0.75, marginTop: 3 }}>{pendingArchive.message}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const t = pendingArchive
                    setPendingArchive(null)
                    void run(async () => {
                      const rr = await archiveProject(t.projectId, true)
                      if (rr.ok) {
                        setProjNotice(`「${t.name}」已暂存 —— 包里标了「不完整」，不能当定稿送审；活干完再正式归档。`)
                        const pr = await loadProjects()
                        if (pr.ok) setProjects(pr.data.projects)
                      }
                      return rr
                    })
                  }}
                  style={btnStyle(true)}
                >
                  ⚠ 仍要暂存（标为不完整）
                </button>
                <button
                  type="button"
                  onClick={() => { setPendingArchive(null); setProjNotice('已取消 —— 先把剩下的活干完，再正式归档。') }}
                  style={btnStyle(false)}
                >
                  先不归档
                </button>
              </div>
            </div>
          ) : null}
          {projNotice ? (
            <div style={{ ...cardStyle, marginBottom: 6, fontSize: FS.small }}>{projNotice}</div>
          ) : null}
          {/* ★ 任务模式下的范围提示：让人知道「现在搜的是全部项目，不是当前项目」——
              否则搜出别的项目的任务会以为串项目了。 */}
          {searchMode === 'task' && kw.trim() !== '' ? (
            <div style={{ fontSize: FS.tag, color: C.dim, marginBottom: 6 }}>
              搜「{kw.trim()}」：全部项目范围，命中 {searchedTasks.length} 条（不受上面项目选中影响）
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.map((p) => (
              <>
              <div
                key={p.projectId}
                /* ★★ 2026-10-26 阿开定（设计图 V3）：项目卡片 = 筛选入口。
                   原「项目筛选下拉」已在台阶①删除 ⇒ 选中动作搬到这里。
                   ★ 为什么点卡片：卡片就是该项目的一行，点它 = 我要看它，符合直觉。
                   ★ 为什么判 target：卡片里有「改名/归档/下载/申请审计」真按钮，
                     点它们不该切选中 —— 否则想归档 A 却顺手把筛选切到 A，
                     回来发现四段数据变了，会被当成 bug。 */
                onClick={(ev) => {
                  const t = ev.target as HTMLElement
                  if (t.closest('button, a, input, select, textarea') !== null) return
                  setProjFilter(p.projectId)
                }}
                title={projFilter === p.projectId ? '当前只显示这个项目的任务' : '点这里只看这个项目的任务'}
                style={{
                  ...cardStyle,
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  /* 选中态：蓝框 + 淡蓝底。用 C.accent（#3B6FE0），与四段展开态同色 ——
                     「选中」在页面上只有一个意思：当前正在看的东西。 */
                  border: projFilter === p.projectId ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                  background: projFilter === p.projectId ? 'rgba(59,111,224,0.06)' : C.soft,
                  /* 边框 1px→2px 会让卡片高 2px ⇒ 内边距减 1px 抵消，避免整列抖动。 */
                  padding: projFilter === p.projectId ? '11px 13px' : '12px 14px',
                  cursor: 'pointer',
                  transition: 'border-color 160ms, background 160ms',
                  /* ★ 台阶⑤：项目模式搜到了 ⇒ 左边加一道琥珀色竖条。
                     ★ 为什么不用「只显示命中的项目」：项目卡片是**筛选入口**，
                       藏掉别的项目就点不到它们了；也为什么不用粗边框/换色 ——
                       蓝框已经表示「选中」，再借它表示「命中」会让两个状态混成一个。
                       ⇒ 用一条独立竖条做**第三种视觉**，不动已有的两种。 */
                  boxShadow: projHit(p.projectId, p.name) ? 'inset 3px 0 0 0 #C58A1F' : undefined,
                }}
              >
                {renaming !== null && renaming.projectId === p.projectId ? (
                  <>
                    <input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ projectId: p.projectId, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onRenameProject()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      placeholder="新项目名"
                      style={{ ...inputStyle, width: 'auto', flex: 1, minWidth: 140 }}
                    />
                    <button type="button" onClick={onRenameProject}
                      disabled={busy || renaming.name.trim().length === 0} style={btnStyle(true)}>
                      存
                    </button>
                    <button type="button" onClick={() => setRenaming(null)} disabled={busy} style={btnStyle(false)}>
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: FS.small, fontWeight: 600 }}>{p.name}</span>
                    <span style={{ fontSize: FS.tag, color: C.dim }}>{p.taskCount ?? 0} 个任务</span>
                    {p.status === 'archived' ? (
                      <span style={{ fontSize: FS.tag, color: '#8a6d3b' }}>已归档（资料照旧，随时能取消）</span>
                    ) : (
                      /* ★ 2026-10-23 阿开：「项目名称也改不了」⇒ 可以改；只改名字不动 id，任务归属不受影响 */
                      <button
                        type="button"
                        onClick={() => setRenaming({ projectId: p.projectId, name: p.name })}
                        disabled={busy}
                        style={{
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: C.dim, fontSize: FS.tag, padding: '0 2px',
                        }}
                        title="改项目名（项目的 id 不变，挂在这个项目下的任务和资料都不受影响）"
                      >
                        改名
                      </button>
                    )}
                  </>
                )}
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
                      disabled={busy || (audit !== null && audit.projectId === p.projectId && (audit.status === 'queued' || audit.status === 'running'))}
                      style={{
                        padding: '5px 11px', borderRadius: 6, border: 'none',
                        background: audit !== null && audit.projectId === p.projectId && (audit.status === 'queued' || audit.status === 'running') ? 'rgba(0,0,0,.12)' : '#1f2937',
                        color: '#fff', cursor: busy ? 'default' : 'pointer',
                        fontSize: FS.tag, fontWeight: 600, whiteSpace: 'nowrap',
                      }}
                      title="把这份定稿送去审 —— 四灯审完给一份带密码学签名的报告"
                    >
                      {audit !== null && audit.projectId === p.projectId && (audit.status === 'queued' || audit.status === 'running') ? '审计中…' : '🔍 申请审计'}
                    </button>
                    {/* ★ 2026-10-21 阿开：送审后的那句话贴在按钮旁边（原来在页面顶部，点完看不见）。 */}
                    {audit !== null && audit.projectId === p.projectId && (audit.status === 'queued' || audit.status === 'running') ? (
                      <span style={{ fontSize: FS.tag, color: C.dim, whiteSpace: 'nowrap' }}>
                        已送去审计 —— 四灯在看资料，几分钟后出结论
                      </span>
                    ) : null}
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
              {/* ★★★ 2026-10-26 阿开：「四段没有跟随每一个项目走」。⇒ 流程区跟在**当前选中项目的卡片下面**。
                  ★ 为什么判 `p.projectId === projFilter` 而不判「第一个项目」：
                    选中的那个才有数据（searchedTasks 已按 projFilter 过滤），别的项目下面挂一份空四段=骗人。
                  ★ 为什么用 Fragment 包起来：卡片本身有 key，流程区不需要自己的 key（它是卡片的一部分）。 */}
              {p.projectId === projFilter ? renderProjectFlow(p) : null}
              </>
            ))}
          </div>
        </div>
      ) : null}
      {projErr !== null ? (
        <div style={{ ...cardStyle, marginBottom: 6, borderColor: '#e5b4b4', fontSize: FS.tag, color: '#9b2c2c' }}>
          项目清单读不到（{projErr.code}）：{projErr.message}
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
          {/* ★★ 2026-10-23 方案A · 古茶拍板第4条：
              「如果是 false，报告封面上必须明确标红：本报告未经过完整的中立性自证」
              ⇒ 位置有意放**摘要之上**：客户第一眼看到的是「这份报告有没有验过中立性」，
                而不是先读到一段好看的结论。顺序本身就是态度。
              · red_flag=true  ⇒ 红底红框 + 逐条列出**哪几条没过**（不只说「未过」）
              · level=legacy   ⇒ 灰底一行事实说明（不吓人，也不假装它验过）
              · level=ok       ⇒ 绿字一行（有结论才亮，不刷存在感） */}
          {(() => {
            const b = audit.neutralityBanner
            if (!b) return null
            const red = b.red_flag === true
            const legacy = b.level === 'legacy'
            const okLv = b.level === 'ok'
            const nz = audit.report?.neutrality_checks
            const failed = nz?.checks
              ? Object.entries(nz.checks).filter(([, v]) => v && v.passed !== true)
              : []
            return (
              <div
                style={{
                  margin: '6px 0 8px',
                  padding: red ? '8px 10px' : '6px 10px',
                  borderRadius: 6,
                  background: red ? '#fdecea' : legacy ? '#f4f5f7' : '#eef8f1',
                  border: red ? '1px solid #c0392b' : legacy ? `1px solid ${C.border}` : '1px solid #bfe3cd',
                  borderLeft: red ? '4px solid #c0392b' : undefined,
                }}
              >
                <div
                  style={{
                    fontSize: FS.tag,
                    fontWeight: red ? 700 : 600,
                    color: red ? '#c0392b' : legacy ? C.dim : '#1e7e42',
                    lineHeight: 1.5,
                  }}
                >
                  {b.text || (red ? '⚠ 本报告未经过完整的中立性自证' : '')}
                </div>
                {red && failed.length > 0 ? (
                  <ul style={{ margin: '5px 0 0', paddingLeft: 18, fontSize: FS.tag, color: '#8e2b20', lineHeight: 1.6 }}>
                    {failed.map(([k, v]) => (
                      <li key={k}>
                        <b>{NEUTRALITY_LABEL[k] || k}</b>
                        {v?.detail ? ` —— ${v.detail}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {okLv && typeof nz?.passed_count === 'number' ? (
                  <div style={{ fontSize: FS.tag, color: '#1e7e42', marginTop: 3, opacity: 0.85 }}>
                    {nz.passed_count}/{nz.total} 条判据通过 · 报告内已记录逐条明细，可凭公钥独立验签
                  </div>
                ) : null}
              </div>
            )
          })()}
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


      {/* 未接入 / 出错 */}
      {err !== null ? (
        <div style={{ ...cardStyle, fontSize: FS.small, color: err.code === 'not_configured' ? C.dim : '#d97706' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {/* ★ 2026-10-21：兜底文案不能撒谎 —— 动作失败说「读不到」，会把人带去查错方向。
                读失败才叫「任务读不到」；动作失败叫「操作没成功」；有 title 的（心跳等）照旧。 */}
            {err.title ??
              (err.code === 'not_configured'
                ? '任务面板还没接服务端'
                : err.source === 'action'
                  ? '操作没成功'
                  : '任务读不到')}
          </div>
          <div>{err.message}</div>
        </div>
      ) : data === null ? (
        <div style={{ ...cardStyle, color: C.dim, fontSize: FS.small }}>正在读取任务…</div>
      ) : searchedTasks.length === 0 ? (
        <div style={{ ...cardStyle, color: C.dim, fontSize: FS.small }}>
          {kwNorm !== '' && searchMode === 'task'
             /* ★ 台阶⑤：搜索无结果 vs 本来就没任务 —— 两种要说清，
                否则用户会以为「任务丢了」，实际只是搜的词没命中。 */
             ? `没搜到含「${kw.trim()}」的任务（标题和正文都搜了，全部项目范围）。`
             : tasks.length === 0
               ? '还没有任务 —— 点右上「＋ 新任务」发第一条。'
               /* ★ 2026-10-26 台阶③：原文案是「换『全部』看看别的」——
                  那个「全部」选项随项目筛选下拉一起删了（台阶①），现在不存在，
                  照旧文案会让人到处找「全部」按钮。改成指**真实存在**的操作：点上面的项目卡片。 */
               : '这个项目下还没有任务 —— 点上面别的项目卡片，看那个项目的任务。'}
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
  /** ★ 2026-10-24（083-r3）：绑到哪个工位（空 = 公共池）。
   *  ★ 只从 `task.node_id` 反查工位名 —— `/tasks` **不回 notify_agent**（实测），
   *    所以「指派给谁」这一半在铺主列表上取不到，只能靠发布当时那句 toast。 */
  nodeLabel?: string
  /** ★★ 2026-10-26：全铺任务（依赖区拿它当「可加为前置」的候选池）。
   *  由列表层传入；缺省空数组 ⇒ 加依赖的候选为空，但不影响读已有依赖。 */
  allTasks?: Array<{ task_id: string; title: string; status: string }>
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
        {/* ★ 2026-10-24（083-r3）：这条发到哪 —— 公共池还是某个工位。
            一次派五条时「发错工位」是最常见的错，列表里必须能回看。 */}
        <span
          title={props.nodeLabel && props.nodeLabel.length > 0
            ? `绑到工位「${props.nodeLabel}」：只有这个工位的 Agent 会看到`
            : '公共池：所有 Agent 都能看到'}
          style={{
            fontSize: FS.tag,
            color: props.nodeLabel && props.nodeLabel.length > 0 ? C.accent : C.dim,
            border: `1px ${props.nodeLabel && props.nodeLabel.length > 0 ? 'solid' : 'dashed'} ${C.border}`,
            borderRadius: 6, padding: '1px 6px', whiteSpace: 'nowrap',
          }}
        >
          {taskBindingText(props.nodeLabel ?? '', '')}
        </span>
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
            {/* ★ 2026-10-23 阿开定「不上向量上分类标签」—— 分类要看得见，
                否则字段加了也白加（Agent 能筛、人看不到）。徽标按 kind 上色，
                与状态色区分开：状态是流程，kind 是性质。 */}
            {task.kind && task.kind !== 'other' ? (
              <span style={{
                display: 'inline-block', marginRight: 6, padding: '0 5px',
                borderRadius: 3, fontSize: FS.tag,
                color: KIND_COLOR[task.kind] ?? C.dim,
                background: (KIND_COLOR[task.kind] ?? C.dim) + '14',
                border: `1px solid ${(KIND_COLOR[task.kind] ?? C.dim)}33`,
              }}>{KIND_LABEL[task.kind] ?? task.kind}</span>
            ) : null}
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
      {/* ★★ 2026-10-26「Agent 版 OA」：依赖 + 交付版本。
          只在展开时拉数据 —— 收起状态下几十条卡片各发一个请求是性能自杀，
          而且语义上也不需要（收起 = 不想看细节）。 */}
      {open ? (
        <>
          <TaskDepsSection taskId={task.task_id} allTasks={props.allTasks ?? []} run={run} />
          <DeliverableVersionsSection taskId={task.task_id} run={run} />
        </>
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

/* ══════════════════════════════════════════════════════════════════
   ★★ 2026-10-24 阿开：「把里面的『生成工位邀请码』整行，单独一个栏框显示，
      不需要折叠，直接是左侧蓝色圆弧展开的框」＋「工位的邀请按钮可以替换成
      🔑 生成工位加入码」
   ══════════════════════════════════════════════════════════════════
   ★ 为什么抽成独立组件、两处各挂一份：
     加入码是「生成一次、当场甩给同事」的动作，不是「查看某个页面的状态」。
     两边都是**生成器**，各生成各的码 —— 不存在「这边生成了那边怎么是空的」
     那种跨页面状态不同步的困惑（那才是真正的坑）。
   ★ 为什么不做折叠：它是新人进铺的第一道门，折叠起来等于藏起来。

   ★★ 2026-10-24 · 083 第一批（星月任务书 `7dba1c14`）· 补发闭环四件：
     ① 铺主审批面板（待审批 N 件 + 同意/拒绝 + 同意后就地出新码）
     ② 申请人结果红点（pending/approved/rejected/expired，60 秒轮询）
     ③ 「码用不了了？」入口（就地展开，不跳页、不弹窗）
     ④ Agent 指令第五条（不加这条，整条链是死的 —— Agent 不知道自己可以申请）
   ★ 一条设计取舍，写在这儿免得下次又纠结：
     **身份用「待审批列表能不能读」来判**（200=铺主，403 not_owner=申请人），
     不额外要求服务端给一个 role 接口 —— 契约只有 5 个端点，多要一个就多等一轮。
   ══════════════════════════════════════════════════════════════════ */

/** 本地记住「我提交过的那条申请」的 requestId（铺主批完要回来取新码）
 *  ★ 083 补充件：正式键由 `reqStoreKey(铺号, 申请人)` 拼（换铺 / 换人不串台）；
 *    这个无后缀键降级为**兼容键** —— 129 版存的正是它，存量记录不能因为换键就消失。 */
const JOIN_REQ_KEY = 'kaipu.join.requestId'
/** ★ 2026-10-26（4️⃣）：本铺「每个工位那张邀请码的链接」本机留档。
 *  服务端只存 hash、列表永不回明文 ⇒ 想再复制一次只能靠这份。
 *  结构：{ [node_id]: { url, expiresAt } } */
const SEAT_INVITE_URL_KEY = 'kaipu.seat.inviteUrl.v1'
/** 人类申请人的稳定标识（没有 agentId 时用；一次生成，之后一直用它） */
const JOIN_WHO_KEY = 'kaipu.join.applicantId'

function safeGet(key: string): string {
  try {
    return globalThis.localStorage?.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    /* 隐私模式 / 存储禁用：记不住就记不住，不影响本次使用 */
  }
}

/** ★ 083-r2：码失效后要把明文从本机抹掉（留着是纯泄露面）。
 *  删除失败同样不阻塞流程 —— 界面已经按「不在本机」渲染。 */
function safeRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    /* 同上 */
  }
}

function applicantId(): string {
  const old = safeGet(JOIN_WHO_KEY)
  if (old.length > 0) return old
  const fresh = `human-${newUuid().replace(/-/g, '').slice(0, 10)}`
  safeSet(JOIN_WHO_KEY, fresh)
  return fresh
}

/** 复制到剪贴板（失败静默 —— 用户可手动选） */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function JoinCodeCard({ compact }: { compact?: boolean }): ReactElement {
  /* ── 生成器（2026-10-24 阿开：常开卡片）── */
  const [code, setCode] = useState<{ code: string; expiresAt: string; ttlHours: number } | null>(null)
  const [ttl, setTtl] = useState<number>(24)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [guideCopied, setGuideCopied] = useState(false)
  /* ★ 只存人话：错误码在 join-copy 里翻完就丢，界面永远见不到 `no_credential`（AC-10） */
  const [err, setErr] = useState<string>('')

  /* ── 083 第一批 · 铺主侧 ── */
  const [owner, setOwner] = useState<boolean | null>(null)
  const [waiting, setWaiting] = useState<JoinRequestRow[]>([])
  const [rowBusy, setRowBusy] = useState<string>('')
  const [rowErr, setRowErr] = useState<string>('')
  /** 同意后就地出的新码（不跳页 —— AC-09）· 只存在内存 */
  const [issued, setIssued] = useState<{ requestId: string; code: string } | null>(null)
  const [issuedCopied, setIssuedCopied] = useState(false)
  /** ★★ 2026-10-26 阿开：「以下的默认折叠」⇒ 历史码列表默认收起。
      常显的只有「手上的码  待用 0 / 3  刷新」这一行；码明细要点开才看。
      为什么：31 条历史码摊开，把工位页撑得很长，日常只看「还剩几张能用」。
      ★ 默认 false = 收起（他要的就是「以下的默认折叠」）。 */
  const [codesOpen, setCodesOpen] = useState(false)
  /** 拒绝：就地展开理由输入框（★ 不用 window.confirm —— DSH 宿主里不可靠） */
  const [rejectFor, setRejectFor] = useState<string>('')
  const [rejectWhy, setRejectWhy] = useState<string>('')

  /* ── ★★ 083-r2 · 邀请码列表（铺主侧）──
     ★ 明文只在本机：服务端只存 hash、列表永不回明文，所以「码值」这一格
       只能从 localStorage 按 codeHash 取。取不到就明说「明文未保存在本机」。 */
  const [codeRows, setCodeRows] = useState<JoinCodeRowLike[]>([])
  /** codeHash → 明文（本机快照；渲染用它，不在 render 里读 localStorage） */
  const [codePlain, setCodePlain] = useState<Record<string, string>>({})
  const [listErr, setListErr] = useState<string>('')
  /** 哪一行在处理（revoke/renew），空 = 没人在处理 */
  const [rowCodeBusy, setRowCodeBusy] = useState<string>('')
  const [batch, setBatch] = useState<number>(1)

  /* ── 083 第一批 · 申请人侧 ── */
  const [myId, setMyId] = useState<string>('')
  const [myStatus, setMyStatus] = useState<string>('')
  const [myCode, setMyCode] = useState<string>('')
  /** 码的处境 —— fresh 刚拿到（必须提示只显示一次）/ stored 本地存着 / lost 取过没存 / none */
  const [myCodeState, setMyCodeState] = useState<ApplicantCodeState>('none')
  const [ridCopied, setRidCopied] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [askWhy, setAskWhy] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [askErr, setAskErr] = useState('')
  const [askDone, setAskDone] = useState(false)
  const [myCopied, setMyCopied] = useState(false)

  /** 拉我那条申请的最新状态
   *  ★★ 阅后即焚（任务书 §二 最要紧的一条）：服务端**只在第一次**回 `joinCode` 明文，
   *     读到就立刻把 `code_plain` 抹成 NULL。所以这里拿到就**先落盘**，绝不等下一次 ——
   *     「下一轮轮询再存」等于永久丢码（第二轮开始服务端就是空字符串）。 */
  const refreshMine = (rid: string): void => {
    if (rid.length === 0) return
    void (async () => {
      const r = await callPack<JoinRequestStatusPayload>('joinRequestGet', { requestId: rid })
      if (!r.ok) return
      const serverCode = typeof r.data.joinCode === 'string' ? r.data.joinCode : ''
      const localCode = safeGet(codeStoreKey(rid))
      if (serverCode.length > 0) safeSet(codeStoreKey(rid), serverCode)
      setMyStatus(r.data.status)
      setMyCodeState(applicantCodeState(r.data.status, serverCode, localCode))
      setMyCode(serverCode.length > 0 ? serverCode : localCode)
    })()
  }

  /* ① 开场判身份 + 拿待审批列表（铺主）/ 恢复我那条申请（申请人） */
  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await callPack<JoinRequestListPayload>('joinRequests', { status: 'pending' })
      if (!alive) return
      if (r.ok) {
        setOwner(true)
        setWaiting(r.data.items)
        return
      }
      /* 读不到待审批列表 ⇒ 我不是铺主（403 not_owner）或本机还没入册（401）
         ⇒ 走申请人视图。这两种都**不是错误**，不弹红字。 */
      setOwner(false)
      /* 恢复我那条申请：先问铺号，拼出「铺 + 人」的键；问不到（未入册）退回兼容键。
         ★ 任务书判据「重新进入面板会触发一次 GET /join/request/{rid}」—— 就是这里这一次。 */
      const me = await callPack<{ accountId: string }>('whoami', {})
      if (!alive) return
      const key = me.ok ? reqStoreKey(me.data.accountId, applicantId()) : JOIN_REQ_KEY
      let rid = safeGet(key)
      if (rid.length === 0 && key !== JOIN_REQ_KEY) rid = safeGet(JOIN_REQ_KEY)
      if (rid.length > 0) {
        setMyId(rid)
        refreshMine(rid)
      }
    })()
    return () => { alive = false }
  }, [])

  /* ② 申请人：60 秒轮询自己那条（★ 不要 5 秒 —— 会把服务压垮，任务书原话） */
  useEffect(() => {
    if (owner !== false || myId.length === 0) return undefined
    const t = setInterval(() => { refreshMine(myId) }, 60_000)
    return () => { clearInterval(t) }
  }, [owner, myId])

  /** 拉邀请码列表 + 同步本机明文快照。
   *  ★ 顺序很重要：先按服务端状态清掉失效码的明文，再快照 —— 反过来的话，
   *    这一轮还会把已经作废的码显示成正的，下一轮才消失（中间那一眼会骗人）。
   *  ★ 明文快照进 state（渲染读 state，不在 render 里读 localStorage）：
   *    localStorage 不是响应式数据源，直接读会导致「码出来了但界面不刷新」。 */
  const refreshCodes = (): void => {
    void (async () => {
      const r = await callPack<{ codes: JoinCodeRowLike[] }>('deviceJoinCodes', {})
      if (!r.ok) {
        setListErr(humanizeCodeError(r.code ?? '', r.message ?? ''))
        return
      }
      const list = Array.isArray(r.data.codes) ? r.data.codes : []
      const stale = staleHashes(list, (h) => safeGet(plainStoreKey(h)).length > 0, Date.now())
      for (const h of stale) safeRemove(plainStoreKey(h))
      const snap: Record<string, string> = {}
      for (const row of list) snap[row.codeHash] = safeGet(plainStoreKey(row.codeHash))
      setListErr('')
      setCodeRows(list)
      setCodePlain(snap)
    })()
  }

  /* 铺主进卡片就拉一次列表；申请人（owner===false）不拉 —— 那是铺主专属端点，拉了必 403 */
  useEffect(() => {
    if (owner !== true) return
    refreshCodes()
    /* 只跟 owner 变化走：refreshCodes 是纯闭包，每次渲染都是新函数，
       把它放进依赖会变成「渲染一次拉一次」的无限循环。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner])

  const pendingCodes = countPendingCodes(codeRows)

  /** 作废一张（只能作废待用；后端 404 code_not_revocable 要说人话） */
  const revokeCode = (hash: string): void => {
    if (rowCodeBusy.length > 0) return
    setRowCodeBusy(hash)
    setListErr('')
    void (async () => {
      const r = await callPack<{ codeHash: string; state: string }>('deviceJoinCodeRevoke', { codeHash: hash })
      setRowCodeBusy('')
      if (!r.ok) {
        setListErr(humanizeCodeError(r.code ?? '', r.message ?? '', pendingCodes))
        refreshCodes()
        return
      }
      safeRemove(plainStoreKey(hash))
      refreshCodes()
    })()
  }

  /** 续期（沿用当前选中的有效期时长） */
  const renewCode = (hash: string): void => {
    if (rowCodeBusy.length > 0) return
    setRowCodeBusy(hash)
    setListErr('')
    void (async () => {
      const r = await callPack<{ codeHash: string; state: string; expiresAt: string }>(
        'deviceJoinCodeRenew', { codeHash: hash, ttlHours: ttl })
      setRowCodeBusy('')
      if (!r.ok) {
        setListErr(humanizeCodeError(r.code ?? '', r.message ?? '', pendingCodes))
        refreshCodes()
        return
      }
      refreshCodes()
    })()
  }

  const make = (ttlHours: number): void => {
    if (busy) return
    setBusy(true)
    setErr('')
    setListErr('')
    void (async () => {
      /* 一次生成 N 张（N 受剩余额度限制）。**不做「一个码用 N 次」** ——
         一码一人，谁用了、谁没用、作废哪张才清晰（派单书 §二-任务1）。 */
      const room = batchChoices(pendingCodes)
      const n = room.includes(batch) ? batch : 1
      const r = await callPack<{
        code: string; accountId: string; expiresAt: string; ttlHours: number
        codes?: string[]; items?: { code: string; expiresAt: string }[]
      }>('deviceJoinCodeCreate', { note: '新设备加入', ttlHours, count: n })
      setBusy(false)
      if (!r.ok) {
        setErr(humanizeCodeError(r.code ?? '', r.message ?? '', pendingCodes))
        return
      }
      /* ★★ 明文先落盘：服务端列表**永远不回明文**，这一次不回就永久丢了。
         键用 `codeHashOf(明文)`（= 服务端 codeHash，实测 sha256 前 12 位），
         于是「这一行」与「这个码」是精确对应，不靠批次顺序猜。 */
      const plains = Array.isArray(r.data.codes) && r.data.codes.length > 0
        ? r.data.codes.map((x) => String(x ?? '')).filter((x) => x.length > 0)
        : [r.data.code]
      for (const p of plains) {
        const h = codeHashOf(p)
        if (h.length > 0) safeSet(plainStoreKey(h), p)
      }
      setCode({ code: plains[0] ?? r.data.code, expiresAt: r.data.expiresAt, ttlHours })
      setBatch(1)
      refreshCodes()
    })()
  }

  /* ③ 铺主：同意 → 就地出新码 */
  const approve = (rid: string): void => {
    if (rowBusy.length > 0) return
    setRowBusy(rid)
    setRowErr('')
    void (async () => {
      const r = await callPack<JoinRequestStatusPayload>('joinRequestApprove', { requestId: rid })
      setRowBusy('')
      if (!r.ok) {
        setRowErr(humanizeJoinError(r.code, r.message))
        return
      }
      const fresh = typeof r.data.joinCode === 'string' ? r.data.joinCode : ''
      setIssued({ requestId: rid, code: fresh })
      setWaiting((prev) => prev.filter((x) => x.requestId !== rid))
    })()
  }

  /* ④ 铺主：拒绝（理由可空） */
  const reject = (rid: string): void => {
    if (rowBusy.length > 0) return
    setRowBusy(rid)
    setRowErr('')
    void (async () => {
      const r = await callPack<{ requestId: string; status: string }>(
        'joinRequestReject', { requestId: rid, reason: rejectWhy })
      setRowBusy('')
      if (!r.ok) {
        setRowErr(humanizeJoinError(r.code, r.message))
        return
      }
      setRejectFor('')
      setRejectWhy('')
      setWaiting((prev) => prev.filter((x) => x.requestId !== rid))
    })()
  }

  /* ⑤ 申请人：提交补发申请（旧码失效时唯一出路） */
  const submitAsk = (): void => {
    if (askBusy || askDone) return
    setAskBusy(true)
    setAskErr('')
    void (async () => {
      /* 铺号从服务端问：申请人可能没入册，问不到就明确说要旧码或原机器 */
      const me = await callPack<{ accountId: string }>('whoami', {})
      if (!me.ok) {
        setAskBusy(false)
        setAskErr('查不到你属于哪个铺子，请用原来那张码或原来的机器再试一次')
        return
      }
      const r = await callPack<JoinRequestCreated>('joinRequestCreate', {
        accountId: me.data.accountId,
        applicantKind: 'human',
        applicantId: applicantId(),
        reason: askWhy,
      })
      setAskBusy(false)
      if (!r.ok) {
        setAskErr(humanizeJoinError(r.code, r.message))
        return
      }
      setAskDone(true)
      setMyStatus(r.data.status)
      /* ★ 字段名是 `requestId`，**不是 `id`** —— 按 `id` 取会拿到 undefined（星月实测）。
         取不到就不写键、不动 myId，界面自然不渲染（也就不会出现 `undefined`）。 */
      const rid = typeof r.data.requestId === 'string' ? r.data.requestId : ''
      if (rid.length > 0) {
        setMyId(rid)
        /* 正式键按「铺 + 人」；兼容键同时写一份（换机器 / 老版本也读得到） */
        safeSet(reqStoreKey(me.data.accountId, applicantId()), rid)
        safeSet(JOIN_REQ_KEY, rid)
      }
    })()
  }

  const mine = applicantView(myStatus)
  const pendingCount = waiting.length

  return (
    <div
      id="kaipu-join-card"
      style={{
      /* ★★ 2026-10-24 阿开：「生成工位加入码 展开折叠之后与工位卡片之间保留一些间隙空间会更美观」
         ⇒ 原来只有 marginTop（上 8px）、没有下边距 ⇒ 展开后卡片底边直接贴住下面工位网格
           （grid gap 只作用于网格内部，管不到网格外上方的插入物）。
         现在上下都留，且下方给得略大（12px）：卡片是「插入物」，与下方既有布局要分得开。 */
      marginTop: compact === true ? 8 : 10,
      marginBottom: compact === true ? 12 : 14,
      borderRadius: 10,
      padding: compact === true ? '10px 12px' : '12px 14px',
      border: `1px solid ${C.border}`,
      borderLeft: '3px solid #6366f1',
      background: C.soft,
    }}>
      <div style={{ fontSize: FS.small, fontWeight: 600, color: C.text, marginBottom: 2 }}>
        🔑 生成工位加入码
        <span style={{ fontSize: FS.tag, color: C.dim, fontWeight: 400, marginLeft: 8 }}>
          给新同事：进本铺 · 装技能 · 领授权，一次做完
        </span>
      </div>
      {/* ★★ 2026-10-24 阿开：「当在工位的 Agent 邀请码超时的时候，需要补发邀请码就从这里生成」
          ⇒ 这行小字是给「已经在用」的人看的：不是头一次邀请，是过期了要补。
            两种人两种诉求 —— 头一次来的人看上面那行（一次做完），
            补发的人只看这一行（过期了、换机器了，重生成一张就行）。 */}
      <div style={{ fontSize: FS.tag, color: C.dim, marginBottom: 8 }}>
        邀请码过期了、或者同事换了台机器，也是从这里重新生成一张补发给他
      </div>

      {/* ── ① 铺主：待审批区（空列表**整块不渲染**，不摆空框）── */}
      {owner === true && pendingCount > 0 ? (
        <div style={{
          marginBottom: 8, padding: '8px 10px', borderRadius: 8,
          background: '#fff', border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: FS.tag, color: '#b3261e', fontWeight: 600, marginBottom: 6 }}>
            待审批 {pendingCount} 件
          </div>
          {waiting.map((row) => (
            <div key={row.requestId} style={{
              padding: '6px 0', borderTop: `1px dashed ${C.border}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: FS.small, color: C.text, flex: '1 1 220px' }}>
                  {joinRowLabel(row)}
                </span>
                <button
                  type="button"
                  disabled={rowBusy.length > 0}
                  onClick={() => approve(row.requestId)}
                  style={btnStyle(true)}
                >
                  {rowBusy === row.requestId ? '处理中…' : '同意'}
                </button>
                <button
                  type="button"
                  disabled={rowBusy.length > 0}
                  onClick={() => {
                    setRejectFor(rejectFor === row.requestId ? '' : row.requestId)
                    setRejectWhy('')
                  }}
                  style={btnStyle(false)}
                >
                  {rejectFor === row.requestId ? '收起' : '拒绝'}
                </button>
              </div>
              {/* 拒绝：就地展开（理由可空，不弹 confirm） */}
              {rejectFor === row.requestId ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <input
                    value={rejectWhy}
                    onChange={(e) => setRejectWhy(e.target.value)}
                    placeholder="跟他说一句为什么（不填也行）"
                    style={{
                      flex: '1 1 220px', padding: '5px 8px', borderRadius: 6,
                      border: `1px solid ${C.border}`, fontSize: FS.small,
                      fontFamily: 'inherit', color: C.text, background: '#fff',
                    }}
                  />
                  <button type="button" disabled={rowBusy.length > 0} onClick={() => reject(row.requestId)} style={btnStyle(true)}>
                    确认拒绝
                  </button>
                  <button type="button" onClick={() => { setRejectFor(''); setRejectWhy('') }} style={btnStyle(false)}>
                    算了
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {rowErr.length > 0 ? (
            <div style={{ marginTop: 6, fontSize: FS.small, color: '#b3261e' }}>{rowErr}</div>
          ) : null}
        </div>
      ) : null}

      {/* ── ② 铺主：同意后新码就地出现（AC-09：不跳页）── */}
      {issued !== null ? (
        <div style={{
          marginBottom: 8, padding: '8px 10px', borderRadius: 8,
          background: '#eef7ee', border: '1px solid #b7d8b7',
        }}>
          <div style={{ fontSize: FS.tag, color: '#2f6b2f', marginBottom: 4 }}>
            已经通过了。下面是给他的新码，**只显示这一次**：
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{
              fontSize: FS.small, padding: '3px 8px', background: '#fff',
              borderRadius: 4, letterSpacing: 0.5, border: '1px solid #b7d8b7',
            }}>{issued.code.length > 0 ? issued.code : '（服务端没回码，让他重新申请一次）'}</code>
            {issued.code.length > 0 ? (
              <button type="button" style={btnStyle(true)} onClick={() => { void (async () => {
                if (await copyText(issued.code)) {
                  setIssuedCopied(true)
                  setTimeout(() => setIssuedCopied(false), 1800)
                }
              })() }}>{issuedCopied ? '✓ 已复制' : '📋 复制新码'}</button>
            ) : null}
            <button type="button" style={btnStyle(false)} onClick={() => setIssued(null)}>知道了</button>
          </div>
        </div>
      ) : null}

      {/* ── ③ 申请人：我这条申请的结果（无申请时整段不渲染）── */}
      {owner === false && (askDone || myStatus.length > 0 || askOpen || myId.length > 0) ? (
        <div style={{
          marginBottom: 8, padding: '8px 10px', borderRadius: 8,
          background: '#fff', border: `1px solid ${C.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: FS.small }}>
            {/* 红点：只有 approved（有新码要取）和 expired（要重新申请）才亮 */}
            {mine.dot ? (
              <span style={{
                display: 'inline-block', width: 7, height: 7, borderRadius: 999,
                background: '#c0392b',
              }} />
            ) : null}
            <span style={{
              color: mine.tone === 'ok' ? '#2f6b2f' : mine.tone === 'bad' ? '#b3261e'
                : mine.tone === 'wait' ? C.dim : C.text,
              fontWeight: mine.tone === 'ok' ? 600 : 400,
            }}>
              {askDone && myStatus.length === 0 ? '已申请，等铺主通过' : mine.text}
            </span>
          </div>
          {/* ★ 083 补充件 ①：申请号显式摆出来 + 复制。
              Agent 用 curl 提交时，requestId 只出现在那一次响应体里，关掉终端就没了 ——
              人得有个地方能抄下来（查状态、取码都靠它）。 */}
          {looksLikeRequestId(myId) ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: FS.tag, color: C.dim }}>申请号</span>
              <code style={{
                fontSize: FS.tag, padding: '2px 6px', background: C.soft,
                borderRadius: 4, letterSpacing: 0.3, border: `1px solid ${C.border}`,
              }}>{myId}</code>
              <button type="button" style={btnStyle(false)} onClick={() => { void (async () => {
                if (await copyText(myId)) {
                  setRidCopied(true)
                  setTimeout(() => setRidCopied(false), 1800)
                }
              })() }}>{ridCopied ? '✓ 已复制' : '📋 复制申请号'}</button>
              <span style={{ fontSize: FS.tag, color: C.dim }}>查状态、取码都要用它</span>
            </div>
          ) : null}
          {myStatus === 'approved' && myCode.length > 0 ? (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{
                  fontSize: FS.small, padding: '3px 8px', background: C.soft,
                  borderRadius: 4, letterSpacing: 0.5, border: `1px solid ${C.border}`,
                }}>{myCode}</code>
                <button type="button" style={btnStyle(true)} onClick={() => { void (async () => {
                  if (await copyText(myCode)) {
                    setMyCopied(true)
                    setTimeout(() => setMyCopied(false), 1800)
                  }
                })() }}>{myCopied ? '✓ 已复制' : '📋 复制，通知你的 Agent 邀请码已更新'}</button>
              </div>
              {/* 新码只回一次明文 ⇒ fresh 必须当场喊「只显示一次」；stored 要说清为什么不再回 */}
              <div style={{
                marginTop: 4, fontSize: FS.tag,
                color: myCodeState === 'fresh' ? '#b3261e' : C.dim,
                fontWeight: myCodeState === 'fresh' ? 600 : 400,
              }}>
                {myCodeState === 'fresh' ? CODE_ONCE_TIP : CODE_STORED_TIP}
              </div>
            </div>
          ) : null}
          {/* ★ lost：approved 但服务端不回码、本地也没有 ⇒ **不显示空白码**，直说要重发 */}
          {myCodeState === 'lost' ? (
            <div style={{ marginTop: 6, fontSize: FS.small, color: '#b3261e' }}>
              {CODE_LOST_TIP}
            </div>
          ) : null}
          {/* pending：灰色不可点（想催也没接口，别给他假按钮） */}
          {myStatus === 'pending' ? (
            <div style={{ marginTop: 4, fontSize: FS.tag, color: C.dim }}>
              铺主处理完这里会自动变（每分钟看一次），不用一直守着
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ══ ★★ 083-r2 · 邀请码列表（铺主侧）══
          阿开要的是「能看、能复制、能作废、能续期，最多留 3 张待用」。
          ★ 空列表整块不渲染，但给一句引导 —— 摆一个空框会让人以为加载失败。 */}
      {owner === true ? (
        <div style={{ marginBottom: 8 }}>
          {codeRows.length > 0 ? (
            <div style={{
              padding: '6px 8px', borderRadius: 8, background: '#fff',
              border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              <div
                onClick={() => setCodesOpen((v) => !v)}
                title={codesOpen ? '收起码明细' : '展开看全部码（含已用/作废/过期）'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: FS.tag,
                  color: C.dim, cursor: 'pointer', userSelect: 'none',
                }}
              >
                <span style={{ fontWeight: 600, color: C.text }}>手上的码</span>
                <span>待用 {pendingCodes} / {PENDING_LIMIT}</span>
                <span style={{ fontSize: FS.tag, color: C.dim }}>
                  {codesOpen ? '收起 ▴' : `展开全部 ${codeRows.length} 条 ▾`}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); refreshCodes() }}
                  style={{
                    padding: '1px 4px', background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: FS.tag, color: C.dim, fontFamily: 'inherit',
                    textDecoration: 'underline', textUnderlineOffset: 3,
                  }}
                >刷新</button>
              </div>
              {codesOpen ? codeRows.map((row) => {
                const view = codeRowView(row, codePlain[row.codeHash] ?? '', Date.now())
                return (
                  <div
                    key={row.codeHash}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                      padding: '4px 0', borderTop: `1px dashed ${C.border}`,
                    }}
                  >
                    <code style={{
                      fontSize: FS.small, padding: '2px 6px', letterSpacing: 0.5,
                      background: view.plainLocal ? C.soft : 'transparent',
                      color: view.plainLocal ? C.text : C.dim,
                      borderRadius: 4,
                      border: view.plainLocal ? `1px solid ${C.border}` : `1px dashed ${C.border}`,
                    }}>{view.codeText}</code>
                    <span style={{
                      fontSize: FS.tag, fontWeight: 600,
                      color: row.state === 'pending' ? '#2f6b2f' : C.dim,
                    }}>{view.stateText}</span>
                    {view.remainText.length > 0 ? (
                      <span style={{ fontSize: FS.tag, color: C.dim }}>{view.remainText}</span>
                    ) : null}
                    {view.usedByText.length > 0 ? (
                      <span style={{ fontSize: FS.tag, color: C.dim }}>{view.usedByText}</span>
                    ) : null}
                    {/* 只有待用才有这三个按钮 —— 其余三档不渲染（不是禁用，免得点了才发现不行） */}
                    {isActionable(row.state) && view.plainLocal ? (
                      <button type="button" style={btnStyle(false)} onClick={() => { void (async () => {
                        if (await copyText(codePlain[row.codeHash] ?? '')) {
                          setCopied(true)
                          setTimeout(() => setCopied(false), 1800)
                        }
                      })() }}>{copied ? '✓ 已复制' : '📋 复制'}</button>
                    ) : null}
                    {isActionable(row.state) ? (
                      <>
                        <button
                          type="button"
                          disabled={rowCodeBusy.length > 0}
                          onClick={() => revokeCode(row.codeHash)}
                          style={btnStyle(false)}
                        >{rowCodeBusy === row.codeHash ? '处理中…' : '作废'}</button>
                        <button
                          type="button"
                          disabled={rowCodeBusy.length > 0}
                          onClick={() => renewCode(row.codeHash)}
                          style={btnStyle(false)}
                        >续期</button>
                      </>
                    ) : null}
                  </div>
                )
              }) : null}
            </div>
          ) : (
            <div style={{ fontSize: FS.tag, color: C.dim }}>
              {emptyListText(true)}
            </div>
          )}
          {listErr.length > 0 ? (
            <div style={{ marginTop: 4, fontSize: FS.small, color: '#b3261e' }}>{listErr}</div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value))}
          disabled={busy}
          title="这张加入码多久内有效；过期要重新生成"
          style={{
            padding: '4px 6px', borderRadius: 6, border: `1px solid ${C.border}`,
            fontSize: FS.small, background: '#fff', fontFamily: 'inherit', color: C.text,
          }}
        >
          <option value={24}>24 小时</option>
          <option value={72}>3 天</option>
          <option value={168}>7 天</option>
        </select>
        {/* ★ 083-r2：批量张数（1–3，且不超过剩余额度）。
            不做「一个码用 N 次」—— 一码一人，谁用了、作废哪张才说得清。 */}
        {owner === true && batchChoices(pendingCodes).length > 1 ? (
          <select
            value={batch}
            onChange={(e) => setBatch(Number(e.target.value))}
            disabled={busy}
            title="一次生成几张（一码一人）"
            style={{
              padding: '4px 6px', borderRadius: 6, border: `1px solid ${C.border}`,
              fontSize: FS.small, background: '#fff', fontFamily: 'inherit', color: C.text,
            }}
          >
            {batchChoices(pendingCodes).map((n) => (
              <option key={n} value={n}>{n} 张</option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() => make(ttl)}
          disabled={busy || (owner === true && !canCreateMore(pendingCodes))}
          title={owner === true ? createBlockedTip(pendingCodes) : '生成一张新设备加入码'}
          style={{
            position: 'relative',
            padding: '6px 13px', borderRadius: 7, border: 'none',
            cursor: busy ? 'default' : 'pointer',
            background: owner === true && !canCreateMore(pendingCodes) ? '#9ca3af' : '#1f2937',
            color: '#fff', fontSize: FS.small,
            fontWeight: 600, fontFamily: 'inherit',
          }}
        >
          {busy ? '生成中…' : '🔑 生成工位加入码'}
          {/* 铺主红点：本铺待审批条数（AC-06 · 数字来自服务端 count，不自己算） */}
          {owner === true && pendingCount > 0 ? (
            <span style={{
              marginLeft: 6, display: 'inline-block', minWidth: 16, height: 16, lineHeight: '16px',
              padding: '0 4px', borderRadius: 999, background: '#c0392b', color: '#fff',
              fontSize: 10, fontWeight: 700, verticalAlign: 'text-top',
            }}>{pendingCount}</span>
          ) : null}
        </button>
        {/* ── ④ 「码用不了了？」入口（任务书 §一-任务3：select+生成那一行的右侧）── */}
        <button
          type="button"
          onClick={() => { setAskOpen(!askOpen); setAskErr('') }}
          style={{
            marginLeft: 'auto', padding: '2px 4px', background: 'transparent', border: 'none',
            cursor: 'pointer', fontSize: FS.tag, color: C.dim, fontFamily: 'inherit',
            textDecoration: 'underline', textUnderlineOffset: 3,
          }}
        >
          {askOpen ? '收起' : '码用不了了？'}
        </button>
        {code !== null ? (
          <>
            <code style={{
              fontSize: FS.small, padding: '2px 6px', background: '#fff',
              borderRadius: 4, letterSpacing: 0.5, border: `1px solid ${C.border}`,
            }}>{code.code}</code>
            <span style={{ fontSize: FS.tag, color: C.dim }}>
              {code.ttlHours >= 168 ? '7 天' : code.ttlHours >= 72 ? '3 天' : `${code.ttlHours} 小时`}内有效 · 只能用一次
            </span>
            <button type="button" style={btnStyle(false)} onClick={() => { void (async () => {
              if (await copyText(code.code)) {
                setCopied(true)
                setTimeout(() => setCopied(false), 1800)
              }
            })() }}>{copied ? '✓ 已复制' : '复制'}</button>
            <button type="button" style={btnStyle(false)} onClick={() => { void (async () => {
              const guide = joinGuideText([
                '请帮我完成三件事，一次做完。',
                '',
                '一、装开铺工位插件',
                '在插件市场搜 kaipu-plugin-workstation 并安装，然后用我的账号登录。',
                '',
                '二、用这个加入码进铺',
                '工位加入码：' + code.code,
                '在插件「工位」页里找加入入口，把上面的码填进去。',
                '',
                '三、装「山海数据看板」技能并领授权',
                '1) 下载并解压：https://agent.ak2029.com/dl084/dashboard-hub.tar.gz',
                '   解压得到 dashboard-hub 文件夹，整个放进你的技能目录。',
                '2) 打开 dashboard-hub/hub.json（没有就复制 hub.json.example），保证有且只有：',
                '   {"url": "https://agent.ak2029.com/hub-084"}',
                '3) 在 dashboard-hub 目录里运行：',
                '   python scripts/hub_dash.py claim',
                '4) 验证：',
                '   python scripts/hub_dash.py profile <表格路径>',
                '',
                '授权码不用手工填 —— claim 会自动读本机的工位设备凭据并领到，'
                + '免费额度，一年到期后回工位插件重领。',
                '',
                '四、以后传资料（重要：不要开浏览器传，直接调接口）',
                '铺主给你「交互 ID」后，用下面这条（把 6 个 {..} 换成真实值）：',
                '  TS=$(date +%s)',
                '  SHA=$(sha256sum /path/to/your-file.zip | cut -d\' \' -f1)',
                '  MSG="{agentId}|${TS}|{accountId}|your-file.zip|${SHA}"',
                '  SIG=$(printf \'%s\' "$MSG" | openssl dgst -sha256 -hmac "{secret}" -r | cut -d\' \' -f1)',
                '  curl -sS -X POST "https://agent.ak2029.com/kai-pu/packs/{交互ID}/files" \\',
                '    -H "X-Agent-Id: {agentId}" -H "X-Account-Id: {accountId}" -H "X-Ts: ${TS}" \\',
                '    -H "X-Filename: your-file.zip" -H "X-Body-Sha256: ${SHA}" -H "X-Sig: ${SIG}" \\',
                '    --data-binary @/path/to/your-file.zip',
                '成功判据：HTTP 200 且返回的 sha256 与本地 sha256sum 一致。',
                '★ 签名串用竖线分隔，和领活（agentId+ts 直接拼）不一样。',
                '★ 座位决定目录：执行位传的在 execution 下，管理位看不见执行位的 ⇒ 先问对方在哪个位。',
                '★★ 文件名必须纯 ASCII（your-file.zip）—— 中文名放不进 HTTP 头，且服务端会先 unquote 再算签名 ⇒ 必然 401。',
                '',
                '五、钥匙会到期，到期了你自己能换（不用等人搬）',
                '每次领任务（poll）返回里多一个 keyStatus，看它的 state：',
                '  ok / no_prev    → 没事，继续干活',
                '  renew_available → 旧钥匙还在宽限期，新钥匙已在服务端保险箱，去取',
                '  expired         → 别死循环，报错给主人，等人点「重置连接」',
                '',
                'state 是 renew_available 时，用【当前这把钥匙】签名去取：',
                '  TS=$(date +%s)',
                '  SIG=$(printf \'%s\' "{agentId}${TS}" | openssl dgst -sha256 -hmac "{当前secret}" -r | cut -d\' \' -f1)',
                '  curl -sS -X POST "https://agent.ak2029.com/kai-pu/agent/key/claim" \\',
                '    -H "Content-Type: application/json" \\',
                '    -d "{\\"agentId\\":\\"{agentId}\\",\\"accountId\\":\\"{accountId}\\",\\"ts\\":${TS},\\"sig\\":\\"${SIG}\\"}"',
                '',
                '★ body 只能有这四个字段，多一个都不行。',
                '★ 签名串是 agentId+ts 直接拼，中间没有分隔符 —— 和上面上传包的竖线格式不一样。',
                '★ sig 放 JSON body，不放 HTTP 头。',
                '',
                '返回 200：agentSecret 就是新钥匙',
                '  1) 用 printf 写入（不要 echo，会多一个换行）',
                '  2) 回读校验：长度 43',
                '  3) 立刻换掉内存里的密钥 —— 文件改了内存没换 = 下一轮还是 401',
                '返回 409 no_pending_key 不是错误：铺主还没点重置，等下一轮，不要重试。',
              ])
              if (await copyText(guide)) {
                setGuideCopied(true)
                setTimeout(() => setGuideCopied(false), 1800)
              }
            })() }}>{guideCopied ? '✓ 已复制' : '📋 复制给新同事的指令'}</button>
          </>
        ) : (
          <span style={{ fontSize: FS.tag, color: C.dim }}>
            对方持码加入后能看到本铺的任务和资料；一次性，用完即失效
          </span>
        )}
      </div>

      {/* ── ④ 展开态：申请补发（就地，不跳页）── */}
      {askOpen ? (
        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#fff', border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: FS.small, color: C.text, marginBottom: 4 }}>
            码用不了了？在这儿说一声，铺主会给你补一张
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={askWhy}
              onChange={(e) => setAskWhy(e.target.value)}
              placeholder="比如：码过期了 / 我换了台机器"
              disabled={askDone}
              style={{
                flex: '1 1 240px', padding: '5px 8px', borderRadius: 6,
                border: `1px solid ${C.border}`, fontSize: FS.small,
                fontFamily: 'inherit', color: C.text, background: askDone ? C.soft : '#fff',
              }}
            />
            <button
              type="button"
              disabled={askBusy || askDone}
              onClick={submitAsk}
              style={btnStyle(!askDone)}
            >
              {askDone ? '已申请（等通过）' : askBusy ? '提交中…' : '提交申请'}
            </button>
          </div>
          <div style={{ marginTop: 4, fontSize: FS.tag, color: C.dim }}>
            不用填旧码 —— 这台机器本身就是你的凭据；实在认不出来，就用原来那张码或原来的机器
          </div>
          {askErr.length > 0 ? (
            <div style={{ marginTop: 6, fontSize: FS.small, color: '#b3261e' }}>{askErr}</div>
          ) : null}
        </div>
      ) : null}

      {err.length > 0 ? (
        <div style={{ marginTop: 6, fontSize: FS.small, color: '#b3261e' }}>{err}</div>
      ) : null}
    </div>
  )
}
