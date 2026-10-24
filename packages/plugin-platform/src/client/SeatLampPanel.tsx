/**
 * 山海·开铺 · 场地插件 · 左栏之外的**第二块展示面**：「这场谁来审」+「要过哪几面」
 * =====================================================================
 * 回答两个用户在**发起之前**就该知道的问题：
 *   · **这场谁来审** —— 执行 / 审计 / 管理 / 签名 四个位，当前各自由谁承担；
 *   · **要过哪几面** —— 这场有几个审核面，每个面管什么。
 *
 * ★ 设计稿（位与灯分开画 · v2.1/v2.2 口径）。发起人 2026-10-08 定稿认可。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 为什么这块**必须**长在 `[data-kaipu-run]` **之外**（不是审美，是判据）
 * ══════════════════════════════════════════════════════════════════
 * 探针有一条 R4 断言：「被裁剪的审核面（`仁灯`）在**报告**里可见」——
 * 它读的正是 `[data-kaipu-run]` 区块**内**的文本。
 * 而本块按设计就会列出**全部审核面**（含 `仁灯`）。
 * ⇒ 若把本块塞进运行视图，那条断言会**恒真**：不管报告里有没有仁灯，
 *   它都能在灯栏里找到「仁灯」两个字。**一个不会失败的断言等于没有断言。**
 * ★ 这不是"判据写得不好"，而是**新内容越过了判据边界**。那节口径的原话：
 *   「**先隔离，再展示**」，且「**新增锚点必须在 `data-kaipu-run` 之外**」。
 * ★ 同类先例：`ProcessFacts`（`data-kaipu-process`）与 `Intro` 卡都照此处理。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 两个取数口径（**权威源已钉死 = `GET /roles/seats`**）
 * ══════════════════════════════════════════════════════════════════
 *   · **位名**（执行位/审计位/…）：★ 钉死以 `/roles/seats[].label`（租户级配置）为准。
 *     **当前我方不接该端点** —— 因为服务端明确「你不必现在改：
 *     `seatHolders[]` 保留 ⇒ 你现状可不动」，并建议 **v1.6 落地后再新接 `/roles/seats`**。
 *     ⇒ 现在用常量 `SEAT_LABEL` 把 key 译成中文（同义兜底；v1.6 后改为读 `label`）。
 *     ★ **重要实测**：`seatHolders[]` 是**租户级数据在 N 个场景里的 N 份拷贝**，
 *       根本不跟场景走 —— 所以位栏本质是「**本开铺**由谁审」，不是「这场戏谁来审」。
 *   · **承担方名**：一律取 `holderName`（**不硬编码「山海」**）—— 发起人 2026-10-08 明确
 *     「管理位不一定姓山海，可以是**项目主持人**，也可以是**委托方自己**」；
 *     已钉死：**管理位由铺主（委托方）指派**，值域 `builtin/client/none`。
 *     `holderType === 'none'`、或响应里根本没这一位 ⇒ 如实显示「没人 / 未登记」，
 *     **不替它编一个名字**（编了就是编事实）。
 *   · **位行带「可改 / 不可改 / 🔒 锁死」纯展示标签（非控件）**：已确认
 *     **P1 期客户端无自助改入口** —— 所以这只是**把既定政策标出来**（谁有资格改这个位），
 *     **不是**一个可点控件。样式用淡色纯文本（与灯栏「待接入」同款），不画边框、不挂
 *     `cursor:pointer`，避免被读成"这里能改"。政策依据见 `SEAT_EDITABLE` 注释与文件末注释。
 */
import { Fragment, useCallback, useState, type ReactElement } from 'react'
import type { SceneCard, SeatHolder } from '@shanhai/kaipu-contract'
import { ENDPOINTS, callKaipu } from './bridge.js'
import { currentConnection } from './live.js'
import { C, FS, LH } from './theme.js'

/**
 * ★★ 四个位的**固定顺序与位名** —— 这是本文件里唯一"可能要改"的一处。
 *
 * **为什么用常量而不是"有什么画什么"**：
 *   契约 v1.5 §23.3 说 `seatHolders`「各场景 4 项」，但**万一**某场景少一项，
 *   "少一项"与"这一位没人"是**两件不同的事**（前者是响应缺字段，后者是 `holderType:'none'`）。
 *   ⇒ 以契约的**四席为准**逐位渲染，缺的落「未登记」兜底 ——
 *     两者在界面上**看得出来**，不会糊成一句"没人"。
 *
 * **为什么现在是常量（而不是取 `/roles/seats[].label`）**：
 *   已钉死**权威源 = `GET /roles/seats`**，但同时也明确
 *   「**你不必现在改**：`seatHolders[]` 保留 ⇒ 你现状可不动；等 v1.6 落地后建议新接 `/roles/seats`」。
 *   ⇒ 现在仍用常量译 `seat` key 的位名（同义兜底，因 `seatHolders[]` 无 `label` 字段）。
 *   **将来切换点（唯一一处）**：v1.6 落地后，把 `SEAT_LABEL` 换成从 `/roles/seats[].label` 读，
 *   **行形态一行都不用动**；取数从 `scene.seatHolders` 改为一次拉 `/roles/seats`（租户级、可缓存）。
 *
 * ★ `seat` 取值域（实测四席）来自契约 `seats.json`，不是自编。
 */
/* ★ 2026-10-23（083 单 G-4 · 星月）：**签名位挪到 1 号位**。
 *   为什么是它排第一：签名是审计流程的**最后一环**，也是整条链的出口 ——
 *   用户在这一排里先看到「签没签」，才明白前面四个位在为什么服务。
 *   ★ 顺序是「流程顺序」，不是「权限大小」，所以不写"级别"含义。 */
const SEAT_ORDER = ['signature', 'execution', 'audit', 'management'] as const

/* ★ 2026-10-23（G-4）：**签名位不进邀请抽屉**。
 *   抽屉干的事是「请个人来坐这个位」；签名位是契约层结构性锁死、
 *   由系统在送审闭环里落章 —— 它出现在「邀请谁」的勾选清单里，
 *   就是「标了锁死却还能邀请」的语义打架（星月原文：语义矛盾）。
 *   ⇒ 抽屉只列可请人的位，签名位不出现；它在位栏里照常显示状态。 */
const INVITE_SEATS = SEAT_ORDER.filter((s) => s !== 'signature')

/* ★ 2026-10-23（G-4）：签名位**不单独给按钮** —— 用户只点「申请送审」。
 *   状态只有两种说法：「⛨ 山海已签」/「⛨ 待签」。
 *   为什么不像别的位那样写「未指派」：签名方不是一个"座位上的同事"，
 *   是场地底座，人不需要去指派它，只需要知道「签了 / 还没签」。 */
function signatureLabel(h: SeatHolder | undefined): string {
  const signed = h !== undefined && h.holderType !== 'none' && h.holderName.trim() !== ''
  return signed ? '⛨ 山海已签' : '⛨ 待签'
}

const SEAT_LABEL: Record<string, string> = {
  execution: '执行位',
  audit: '审计位',
  management: '管理位',
  signature: '签名位',
}

/**
 * ★ 每个位「谁有资格改」的既定政策（**纯展示标签用，不控制任何行为**）。
 *
 * 依据：定案「P1 阶段客户**只能改执行位与审计位**，管理位与签名位不可改。」
 *   · 执行位 / 审计位 ⇒ `可改`：这两位在 P1 就是可重派的（由管理位/铺主指派），
 *     标「可改」= 陈述"这个位允许被改"这一事实，**不暗示界面上有按钮**。
 *   · 管理位 ⇒ `不可改`：定案说客户不能自助改；但它**由铺主指派**（已钉死），
 *     本质是"指派给谁"的问题，不是"锁死"——故用「不可改」而非「锁死」。
 *   · 签名位 ⇒ `🔒 锁死`：契约层**结构性不可改**（签名身份是场地底座的硬约束），
 *     不是策略层的"暂不许"，故用「锁死」标其性质。
 *
 * ★ 这三类标签**都是纯文本**（淡色、无边框、无 pointer），刻意**不做成控件** ——
 *   避免"标了可改却点不动"这类界面说了不成立的话。政策若随 v1.6 / P2.5 调整，只改这一个常量。
 */
const SEAT_EDITABLE: Record<string, boolean> = {
  execution: true,
  audit: true,
  management: false,
  signature: false,
}

/** 位行右侧的「可改性」标签（纯展示，非控件）。 */
function editLabelOf(seat: string): string {
  if (SEAT_EDITABLE[seat] === true) return '可改'
  return seat === 'signature' ? '🔒 锁死' : '不可改'
}

/**
 * ★ 承担方名 —— 三种"没有人"必须**分开说**，不能糊成一句：
 *   · 响应里没这一位     ⇒ 「未登记」（**是数据缺口**，该去问服务端）
 *   · `holderType:'none'` ⇒ 「未指派」（**是事实**：这个位现在没人）
 *   · `none` 但有名字     ⇒ 仍按 `holderType` 判 —— 名字是服务端给的标签，位置状态以类型为准
 *   ★ 空名字（`''`）也归「未指派」：界面上不能出现一个**光秃秃的空格**当人名。
 */
function holderLabel(h: SeatHolder | undefined): { text: string; muted: boolean } {
  if (h === undefined) return { text: '（未登记）', muted: true }
  if (h.holderType === 'none' || h.holderName.trim() === '') return { text: '（未指派）', muted: true }
  return { text: h.holderName, muted: false }
}

export function SeatLampPanel({ scene }: { scene: SceneCard | null }): ReactElement | null {
  // ★★ Hooks 必须在 early return **之前**（React 规则：条件返回后不能再挂 hooks）
  // ── 指派已有执行方（能力保留，入口收进邀请抽屉 —— 2026-10-18 发起人裁定）──
  const [editing, setEditing] = useState<string | null>(null)
  const [cands, setCands] = useState<Array<{ id: string; name: string }>>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // ── ★ 邀请协作方 · **抽屉式**（2026-10-18 · 发起人重画了交互）──────────────
  //   原来是两处入口：行内「可改」按钮（点开=换已有执行方）+ 标题行「＋邀请协作方」
  //   （点开=小表单选灯位）。发起人反馈：行内「可改」点开没意义；他想象中的形态是
  //   —— 点「邀请」→ **抽屉**里把四个位摆出来（位名 + 当前承担方 + 可改性），
  //   **勾选**可改的位 → 生成邀请链接。
  //   ⇒ 按他画的改：行内按钮撤掉（恢复纯文本标签），邀请入口只剩一个，
  //     抽屉里"看位 → 勾位 → 出链接"一条线走完。
  const [inviting, setInviting] = useState<boolean>(false)
  /** 勾选了哪些位（只有 `可改` 的位可勾；默认全勾 —— 打开后一步就能生成） */
  const [picked, setPicked] = useState<string[]>([])
  const [invNote, setInvNote] = useState<string>('')
  const [invBusy, setInvBusy] = useState<boolean>(false)
  const [invErr, setInvErr] = useState<string | null>(null)
  const [invResults, setInvResults] = useState<Array<{ seat: string; url: string; expiresAt: string }>>([])

  /**
   * 抽屉里的「生成邀请链接」：对**每个勾选的位**各生成一条一次性链接。
   * ★ `seat` 走勾选值（execution/audit…）；`lamp` 取该场景**第一个待接入**的审核面
   *   （全接入则退第一个）—— 对方 Agent 接进来先补"缺人"的那面，这是最自然的落位。
   * ★ 有效期、一次性消费、码的随机性全在服务端；前端只负责发起与展示。
   */
  const doInvitePicked = useCallback(async (): Promise<void> => {
    const conn = currentConnection()
    if (!conn) {
      setInvErr('还没接上服务端，发不了邀请。')
      return
    }
    if (picked.length === 0) {
      setInvErr('先勾选要请人的位。')
      return
    }
    const lamp = scene?.lamps?.find((l) => l.agentId === null)?.lamp ?? scene?.lamps?.[0]?.lamp ?? ''
    if (lamp === '') {
      setInvErr('这一场还没有可接入的审核面。')
      return
    }
    setInvBusy(true)
    setInvErr(null)
    const got: Array<{ seat: string; url: string; expiresAt: string }> = []
    for (const seat of picked) {
      const r = await callKaipu<{ url?: string; expiresAt?: string }>(conn, ENDPOINTS.createInvite, {
        lamp,
        seat,
        note: invNote,
        ttlDays: 7,
      })
      if (r.ok === true) {
        got.push({ seat, url: String(r.data.url ?? ''), expiresAt: String(r.data.expiresAt ?? '') })
      } else {
        setInvErr('business' in r ? r.business.message : r.error.detail)
        break
      }
    }
    setInvBusy(false)
    if (got.length > 0) setInvResults(got)
  }, [picked, invNote, scene])

  /**
   * 点「可改」→ 拉可选执行方。
   * ★ 候选来自 `GET /agents`（本铺 + 平台级），**不在前端硬编码** ——
   *   谁有资格当执行方是服务端的事实，不是界面常量。
   */
  const openEditor = useCallback(async (seat: string): Promise<void> => {
    setNote(null)
    setCands([])
    setEditing((cur) => (cur === seat ? null : seat))
    const conn = currentConnection()
    if (!conn) {
      setNote('还没接上服务端，改不了。')
      return
    }
    const r = await callKaipu<{ agents?: Array<{ id?: string; name?: string }> }>(conn, ENDPOINTS.listAgents, {})
    if (r.ok === true) {
      const list = (r.data.agents ?? [])
        .filter((a) => typeof a.id === 'string' && a.id !== '')
        .map((a) => ({ id: String(a.id), name: String(a.name ?? a.id) }))
      setCands(list)
      if (list.length === 0) setNote('这个开铺里还没有可以指派的执行方。')
    } else {
      setNote('读不到可选执行方。')
    }
  }, [])

  const doAssign = useCallback(async (seat: string, id: string, name: string): Promise<void> => {
    const conn = currentConnection()
    if (!conn) {
      setNote('还没接上服务端，改不了。')
      return
    }
    setBusy(true)
    const r = await callKaipu(conn, ENDPOINTS.assignSeat, { seat, holderId: id, holderName: name, reason: '' })
    setBusy(false)
    if (r.ok === true) {
      setEditing(null)
      setNote(`已改成「${name}」—— 重新打开面板即可看到。`)
    } else {
      // ★ 服务端的话原样给用户看（签名位 403 / 兼任 409 都在这里出）
      setNote('business' in r ? r.business.message : r.error.detail)
    }
  }, [])

  // ★ 没选场景 ⇒ 什么都不画（与 `ProcessFacts` 同款：不占位、不留空壳）
  if (scene === null) return null

  const holders = new Map<string, SeatHolder>((scene.seatHolders ?? []).map((h) => [h.seat, h]))

  return (
    // ★ `data-kaipu-seatlamp` = 本块的**判据锚点**，探针据此断言"它在 run 之外"
    <section data-kaipu-seatlamp="1" style={{ padding: '14px 14px 0' }}>
      {/* ★ 自带场景名：本块长在运行视图**之前**，而运行视图的标题在它下面 ——
          不带名字的话，"这场"指哪一场就得回头看（面板挂在宿主容器里，位置不保证相邻）。 */}
      <div style={{ fontSize: FS.title, fontWeight: 500, color: C.text }}>{scene.label}</div>
      <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 2, lineHeight: LH.tight }}>
        发起之前先看清两件事：谁在帮你做，以及要过哪几面。
      </div>

      {/* ── 位栏：本开铺由谁审（租户级，不跟场景走） ─────────────────────────────
          ★★ 界面对齐介绍「角色位」（双向对齐，改界面）。
          小标题加「角色位」标识 —— 介绍称「角色位」、界面原叫「位栏」，现统一为「角色位」。
          ★ 2026-10-18：这是**唯一**的邀请/换人入口 —— 行内「可改」按钮已撤
          （发起人：点开没意义；他画的形态是"点邀请 → 抽屉 → 勾位 → 出链接"）。 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
        <span style={{ fontSize: FS.tag, color: C.dim }}>
          角色位 · 本开铺谁来审 · {SEAT_ORDER.length} 个位
        </span>
        <button
          type="button"
          onClick={() => {
            const next = !inviting
            setInviting(next)
            setInvErr(null)
            setInvResults([])
            setEditing(null)
            // ★ 打开抽屉 ⇒ 默认把两个可改位勾上 —— "打开 → 生成"两步走完；
            //   不想请某一位就取消勾选（勾选权仍在用户手里）
            setPicked(next ? SEAT_ORDER.filter((k) => SEAT_EDITABLE[k] === true) : [])
          }}
          style={{
            marginLeft: 'auto', fontSize: FS.tag, color: C.dim, background: 'none',
            border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          {inviting ? '收起' : '＋ 邀请协作方'}
        </button>
      </div>

      {/* ── ★ 邀请抽屉（2026-10-18 · 发起人重画）────────────────────────────
          交互一条线：点「＋邀请协作方」→ 抽屉弹出**四个位**（位名 · 当前承担方 · 可改性）
          → 勾选可改的位（默认全勾）→ 「生成邀请链接」→ 每位一条，带复制。
          ★ 管理位/签名位**不可勾**：不是前端偷懒，是既定政策（管理位由铺主指派、
            签名位契约层锁死）—— 行右侧标签如实标注，不画一个点不动的勾选框。
          ★ 抽屉放在 `[data-kaipu-seats]` **之外**：探针按 `seats > div` 数四行，
            抽屉混进去计数就漂（判据正确性，不是洁癖）。
          ★ 指派已有执行方的**能力没删**：收进抽屉作为次要动作（勾选行下的小链接），
            主线是"邀请新人"，"换已有的人"退居二线。 */}
      {inviting ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 11px', marginTop: 6 }}>
          <div style={{ fontSize: FS.tag, color: C.dim, marginBottom: 4 }}>
            勾选要请人坐的位，生成一次性邀请链接 —— 对方打开就能接入。
          </div>

          {/* 位行：勾选框（仅可改位）+ 位名 + 当前承担方 + 可改性标签
              ★ 2026-10-23（G-4）：这里走 `INVITE_SEATS` —— **签名位不出现**（不可邀请） */}
          {INVITE_SEATS.map((k) => {
            const { text, muted } = holderLabel(holders.get(k))
            const editable = SEAT_EDITABLE[k] === true
            const checked = picked.includes(k)
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                {editable ? (
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setPicked((cur) => (e.target.checked ? [...cur, k] : cur.filter((s) => s !== k)))
                    }
                    style={{ flex: '0 0 auto', margin: 0, accentColor: '#C8881F' }}
                  />
                ) : (
                  // ★ 占位对齐：不可改的位没有勾选框，但留同样宽的空位 —— 四行左缘齐
                  <span aria-hidden="true" style={{ flex: '0 0 13px' }} />
                )}
                <span style={{ flex: '0 0 44px', fontSize: FS.tag, color: C.dim }}>{SEAT_LABEL[k] ?? k}</span>
                <span style={{ fontSize: FS.small, color: muted ? C.dim : C.text, minWidth: 0 }}>{text}</span>
                <span style={{ marginLeft: 'auto', flex: '0 0 auto', fontSize: FS.tag, color: C.dim }}>
                  {editLabelOf(k)}
                </span>
              </div>
            )
          })}

          {/* 留一句话（可选）+ 生成按钮 */}
          {invResults.length === 0 && (
            <>
              <input
                value={invNote}
                onChange={(e) => setInvNote(e.target.value)}
                placeholder="给对方留一句话（可选）"
                style={{
                  width: '100%', boxSizing: 'border-box', fontSize: FS.tag, padding: '4px 7px',
                  border: `1px solid ${C.border}`, borderRadius: 4, marginTop: 4, fontFamily: 'inherit',
                }}
              />
              <button
                type="button"
                disabled={invBusy || picked.length === 0}
                onClick={() => void doInvitePicked()}
                style={{
                  width: '100%', marginTop: 7, padding: '7px 12px', borderRadius: 6,
                  border: `1px solid ${picked.length === 0 || invBusy ? C.border : '#C8881F'}`,
                  background: picked.length === 0 || invBusy ? 'transparent' : 'rgba(200,136,31,0.12)',
                  color: picked.length === 0 || invBusy ? C.dim : '#A66A12',
                  cursor: picked.length === 0 || invBusy ? 'default' : 'pointer',
                  font: 'inherit', fontSize: FS.small, fontWeight: 600,
                }}
              >
                {invBusy ? '生成中…' : picked.length === 0 ? '先勾选上面的位' : `生成邀请链接（${picked.length} 位）`}
              </button>
            </>
          )}

          {/* 生成结果：每个勾选位一条链接（可复制） */}
          {invResults.length > 0 && (
            <>
              <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 6, marginBottom: 3 }}>
                把链接发给对方（7 天有效 · 一次性）：
              </div>
              {invResults.map((r) => (
                <div
                  key={r.seat}
                  style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}
                >
                  <span style={{ flex: '0 0 44px', fontSize: FS.tag, color: C.dim }}>
                    {SEAT_LABEL[r.seat] ?? r.seat}
                  </span>
                  <input
                    readOnly
                    value={r.url}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{
                      flex: '1 1 160px', minWidth: 0, fontSize: FS.tag, padding: '3px 6px',
                      border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: 'inherit',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(r.url)
                    }}
                    style={{ flex: '0 0 auto', fontSize: FS.tag, padding: '2px 8px', cursor: 'pointer' }}
                  >
                    复制
                  </button>
                </div>
              ))}
              <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 4 }}>
                有效期至 {invResults[0]?.expiresAt ?? '—'}
                <button
                  type="button"
                  onClick={() => {
                    setInvResults([])
                    setPicked(SEAT_ORDER.filter((k) => SEAT_EDITABLE[k] === true))
                  }}
                  style={{
                    marginLeft: 10, fontSize: FS.tag, background: 'none', border: 'none',
                    color: C.dim, cursor: 'pointer', textDecoration: 'underline', padding: 0,
                  }}
                >
                  再发一批
                </button>
              </div>
            </>
          )}

          {invErr !== null && (
            <div style={{ fontSize: FS.tag, color: '#b45309', marginTop: 5, lineHeight: LH.tight }}>{invErr}</div>
          )}
        </div>
      ) : null}
      <div
        data-kaipu-seats="1"
        style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 10px', marginTop: 4 }}
      >
        {SEAT_ORDER.map((k) => {
          const { text, muted } = holderLabel(holders.get(k))
          const editable = SEAT_EDITABLE[k] === true
          /* ★ 2026-10-23（G-4）：签名位不按「未登记/未指派」说 —— 它不是座位，是底座。
             状态只有两种：⛨ 山海已签 / ⛨ 待签。 */
          const isSig = k === 'signature'
          return (
            <Fragment key={k}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0' }}>
                {/*
                  ★ 位名用 `dim`、承担方用 `text`：**人是主体，位是格子**（同左栏 V3 层级口径）。
                  ★ 行末标签 —— **2026-10-18 改回纯文本**：
                    行内「可改」按钮撤掉（发起人：点开没意义）—— 换人/请人统一走上面的邀请抽屉；
                    标签保留为**政策陈述**（谁有资格改这个位），不是入口。
                */}
                <span style={{ flex: '0 0 44px', fontSize: FS.tag, color: C.dim }}>{SEAT_LABEL[k] ?? k}</span>
                <span style={{ fontSize: FS.small, color: muted ? C.dim : C.text }}>{isSig ? '' : text}</span>
                <span style={{ marginLeft: 'auto', fontSize: FS.tag, color: C.dim }}>
                  {isSig ? signatureLabel(holders.get(k)) : editLabelOf(k)}
                </span>
              </div>

              {/* 指派已有执行方：入口收进邀请抽屉（勾选行下的小链接），此处只渲染展开态 */}
              {inviting && editable && editing === k && cands.length > 0 ? (
                <div style={{ padding: '2px 0 8px 13px' }}>
                  {cands.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void doAssign(k, a.id, a.name)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', fontSize: FS.small,
                        color: C.text, background: 'none', border: `1px solid ${C.border}`,
                        borderRadius: 3, padding: '3px 8px', marginTop: 4,
                        cursor: busy ? 'default' : 'pointer',
                      }}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </Fragment>
          )
        })}
        {note !== null ? (
          <div style={{ fontSize: FS.tag, color: C.dim, padding: '4px 0 2px' }}>{note}</div>
        ) : null}
      </div>

      {/* 指派已有执行方的次要入口（抽屉内）：勾选了可改位才出现 —— 能力保留，不占主线 */}
      {inviting && picked.length > 0 && (
        <div style={{ fontSize: FS.tag, color: C.dim, marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span>不是请新人，是把位子换给已有执行方？</span>
          {picked.filter((k) => SEAT_EDITABLE[k] === true).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => void openEditor(k)}
              style={{
                fontSize: FS.tag, color: C.dim, background: 'none', border: 'none', padding: 0,
                cursor: 'pointer', textDecoration: 'underline', font: 'inherit',
              }}
            >
              指派{SEAT_LABEL[k] ?? k}
            </button>
          ))}
        </div>
      )}

      {/* ── 灯栏：要过哪几面 ─────────────────────────────
          ★★ 2026-10-08 夜话改版：**把五盏灯真的画成五盏灯**（发起人点题参考灯笼🏮）。
          旧版是 5 行文字 + 橙色「待接入」，满屏像报错台；
          改成「灰灯=未接入 / 金灯=已接入」的灯阵，一眼看懂"还都没亮，等主人来点"。
          · 灯之下才是名字与状态；说明（duty/dutyNote）收进 `title` 悬停，不铺页面。
          · 每个灯列 `data-kaipu-lamp="1"` 锚点供探针断言（含 hover `title` 里的 duty）。
      */}
      {/* ── 灯栏：要过哪几面 ─────────────────────────────
          ★★ 界面对齐介绍「能力边界」（双向对齐，改界面）。
          小标题加「能力边界」标识 —— 介绍称「能力边界」、界面原叫「灯阵」，现统一为「能力边界」。 */}
      <div style={{ marginTop: 12, fontSize: FS.tag, color: C.dim }}>
        能力边界 · 要过哪几面 · {scene.lamps.length} 个审核面
      </div>
      <div
        data-kaipu-lamps="1"
        style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: '12px 10px 10px', marginTop: 4 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-around', gap: 6 }}>
          {scene.lamps.map((l, i) => {
            const lit = l.agentId !== null
            // ★ hover 说明：把 duty 短名 + dutyNote 长说明 + 连接状态**收进 title**，
            //   页面本身只留"灯笼 + 名字 + 状态"三层安静信息。
            const tip = [
              l.lamp,
              l.duty !== undefined && l.duty !== '' ? `· ${l.duty}` : '',
              l.dutyNote !== undefined && l.dutyNote !== '' ? `（${l.dutyNote}）` : '',
              lit ? '已接入执行方' : '尚未接入执行方 —— 这不是故障，接入后即可点亮',
            ]
              .filter(Boolean)
              .join(' ')
            // ★★ 2026-10-08 发起人点题「参考灯笼🏮好看一些」：把圆点做成**小灯笼**。
            //   画法对齐《山海城邦 · 视觉设计文档》（DESIGN.md §5）：
            //   「圆角灯体 + 暖金径向光晕 + 朱砂灯帽 + 火苗」，色板取品牌四色：
            //     · 暖金 gold #C8881F —— 灯体 / 光晕
            //     · 朱砂 cinnabar #A8351A —— 灯帽（点睛）
            //     · 宣纸米 #F7F4EC / 松烟墨 #1A1A1A —— 高光核心 / 暗字
            //   · 未接入 ⇒ 灯帽与灯体一律**褪成灰**、无光晕（安静，不抢眼、不像报错）；
            //   · 已接入 ⇒ 朱砂灯帽 + 暖金径向灯体（核心近米白 = 火苗）+ 暖金光晕。
            const capColor = lit ? '#A8351A' : '#C9C2B4' // 灯帽：朱砂 / 灰
            return (
              <div
                key={`${l.lamp}-${String(i)}`}
                data-kaipu-lamp="1"
                title={tip}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  minWidth: 0,
                  flex: '1 1 0',
                }}
              >
                {/* 朱砂灯帽 */}
                <span aria-hidden="true" style={{ width: 9, height: 3, borderRadius: 1.5, background: capColor }} />
                {/* 暖金灯体：核心近米白（火苗）→ 暖金 → 深金 */}
                <span
                  aria-hidden="true"
                  style={{
                    width: 21,
                    height: 26,
                    borderRadius: '50%',
                    boxSizing: 'border-box',
                    border: lit ? '1px solid #A66A12' : '1.5px solid #C9C2B4',
                    background: lit
                      ? 'radial-gradient(circle at 50% 36%, #FFF6DA 0%, #F0BE55 36%, #C8881F 70%, #A66A12 100%)'
                      : 'rgba(26,26,26,0.05)',
                    boxShadow: lit
                      ? '0 0 9px 2px rgba(200,136,31,0.55), inset 0 0 3px rgba(255,246,218,0.7)'
                      : 'none',
                  }}
                />
                {/* 灯坠（朱砂小点） */}
                <span aria-hidden="true" style={{ width: 4, height: 4, borderRadius: '50%', background: capColor }} />
                <span
                  style={{ fontSize: FS.tag, color: C.text, lineHeight: 1.3, textAlign: 'center', marginTop: 3 }}
                >
                  {l.lamp}
                </span>
                <span style={{ fontSize: FS.tag, color: C.dim, lineHeight: 1.3 }}>{lit ? '已接入' : '待接入'}</span>
              </div>
            )
          })}
        </div>

        {/* ★ 下一步出口：把"待接入"从状态变成动作（夜话 2026-10-08）。
           P1 暂无"选择执行方"自助入口 ⇒ 点击如实展开去向说明，不伪造流程（本仓纪律：不点假的承诺）。 */}
        <LightFirstButton />
      </div>
    </section>
  )
}

/*
 * ★★ 「🪔 点亮第一盏灯」—— 给面板一个**出口**（夜话 2026-10-08）。
 *
 * 页面原来全在解释状态、没有告诉用户"现在该做什么"。这个主按钮把
 * "待接入"从**状态**变成**动作**：点下去 = 去选执行方。
 *
 * ★★ 为什么点击只展开一段**说明**、不直接开"选择执行方"：
 *   定案 + 服务端口径钉死 ——P1 期客户端**无自助改入口**，
 *   执行位/审计位由铺主指派、管理位/签名位结构性不可改。⇒ "选择执行方"这个动作
 *   **在当前版本不存在**。若把按钮做成"点了跳去一个不存在的 picker"，就是本仓明令禁止的
 *   "点了没反应的承诺"。⇒ 如实展开去向（接入服务端后由铺主在管理方界面指派，P2.5），
 *   既给了出口，又没编一条假的流程。
 *   ★ 锚点 `data-kaipu-light-first="1"` 供探针断言"出口存在"。
 */
function LightFirstButton(): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        data-kaipu-light-first="1"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: 6,
          // ★ 色对齐《山海城邦 · 视觉设计文档》暖金 gold #C8881F（"灯火"用色）
          border: '1px solid #C8881F',
          background: 'rgba(200,136,31,0.12)',
          color: '#A66A12',
          cursor: 'pointer',
          // ⚠️⚠️ `font` 是**简写属性**，会重置 `fontSize` / `fontWeight`。
          //   本行原来写在它俩**之前** ⇒ 那两行**一直没生效**（2026-10-08 用 CDP 读
          //   computed style 才发现：代码写 600，实读 400 —— 光看代码看不出来）。
          //   ⇒ 简写放**最后**，再补要覆盖的。
          font: 'inherit',
          fontSize: FS.base,
          fontWeight: 600,
        }}
      >
        🪔 点亮第一盏灯
      </button>
      {open && (
        <div style={{ marginTop: 8, fontSize: FS.small, color: C.dim, lineHeight: LH.normal }}>
          「选择执行方」将在接入服务端后、由铺主在管理方界面指派（P2.5）。当前本地演示模式暂不开放此入口 ——
          五盏灯会在接入后逐一亮起。
        </div>
      )}
    </div>
  )
}

/*
 * ★★ 位行为什么**现在就标「可改 / 不可改 / 🔒 锁死」**，且**故意不做成控件**（2026-10-08 修订）
 *
 * 定案：P1 阶段客户**只能改执行位与审计位**，管理位与签名位不可改。
 * 这是**既定政策**，不是"将来才有"——所以把它**作为纯展示标签**标出来是诚实的：
 *
 *   1. ★ **标签 ≠ 控件。** 它只陈述"这个位允许被谁改"（政策事实），
 *      **不暗示界面上有按钮**：样式用淡色纯文本（与灯栏「待接入」同款），
 *      无边框、`cursor` 默认。**点不动的承诺**那类错，是"把标签做成按钮却无行为"才会犯；
 *      纯文本陈述政策，不存在"点了没反应"的问题。
 *   2. ★ 三类分清楚比"只标一半"更准：执行/审计=`可改`、管理=`不可改`（由铺主指派，
 *      不是锁死）、签名=`🔒 锁死`（契约层结构性不可改）。混成一句"不可改"反而丢信息。
 *
 * ⇒ 「谁能改」的**实际入口**仍归 P2.5（管理方界面）；标签只是先把政策讲清楚，
 *   等入口真落地时**连同行为一起加**，现在只如实展示**"是谁" + "这个位能不能改"**。
 *   「是谁」与「谁能改」本来就是两件事 —— 见设计稿。
 */
