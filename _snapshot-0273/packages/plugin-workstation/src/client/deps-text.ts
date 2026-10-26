/* ══════════════════════════════════════════════════════════════════
   依赖 / 交付版本 · 纯文案逻辑（2026-10-26 · Agent 版 OA）

   ★ 为什么单独成件：UI 组件（`.tsx`）要 React 运行时才能跑，判据跑不动。
     这里全是**纯函数**，判据可以直接 `assert(depsHeadline(payload) === '…')`。
     「能真跑输入→输出」是判据的前提，不是洁癖。

   ★ 口径（阿开 2026-10-26）：
     「任务依赖和交付版本一起搞」—— 依赖决定「能不能领」，版本决定「哪一稿算数」。
     两者都是**给人看的话**，不是给机器看的字段。
   ══════════════════════════════════════════════════════════════════ */

export interface DepItem { id: string; title: string; status: string }
export interface DepsLike {
  task_id: string
  dependsOn: DepItem[]
  blocks: DepItem[]
  unmet: number
  claimable: boolean
}

/** 状态人话（后端给的是裸 status；这里只做展示映射，不改语义） */
const ST_LABEL: Readonly<Record<string, string>> = {
  posted: '待领',
  claimed: '已领',
  in_progress: '在干',
  done: '已交',
  accepted: '已通过',
  rejected: '被驳回',
  blocked: '求助中',
}

export function depStatusLabel(status: string | undefined): string {
  const s = (status ?? '').trim()
  if (s === '') return '状态不明'
  return ST_LABEL[s] ?? s
}

/** 一行依赖：`《标题》（已交）` —— 状态跟在标题后，因为同一标题不同状态意味完全不同 */
export function depLine(d: DepItem): string {
  const title = (d.title ?? '').trim() || (d.id ?? '').trim() || '未命名任务'
  return `${title}（${depStatusLabel(d.status)}）`
}

/**
 * 依赖区标题 —— **先说结论（能不能领），再说原因**。
 * ★ 不写「依赖状态」这种空话：人打开这条卡片想知道的是「我现在能不能干」。
 */
export function depsHeadline(d: DepsLike): string {
  const on = d.dependsOn.length
  const bl = d.blocks.length
  if (on === 0 && bl === 0) return '无依赖'
  if (d.claimable && on === 0) return `能领${bl > 0 ? ` · 我挡着 ${bl} 件` : ''}`
  if (!d.claimable) {
    const n = d.unmet > 0 ? d.unmet : on
    return `还不能领 · 等 ${n} 件前置交付`
  }
  return `能领${bl > 0 ? ` · 我挡着 ${bl} 件` : ''}`
}

/**
 * 可选前置候选 = 全铺任务 −（自己 + 已依赖的 + 会成环的）。
 *
 * ★★ 「会成环的」必须在这里先剔掉：服务端 409 拦得住，但让用户先点一次撞墙
 *    再看到报错，等于把「不可能成功」伪装成「可以试试」。
 *    这是本项目的既有纪律（签名位不给邀请按钮，同理）。
 *
 * ★ 只剔一层（直接后继）。真正的传递闭包由服务端算；
 *   前端不复制服务端的图算法 —— 复制就是第二个真值源，必然漂移。
 */
export function pickDepCandidates(
  selfId: string,
  all: Array<{ task_id: string; title: string; status: string }>,
  deps: DepsLike,
): Array<{ id: string; title: string }> {
  const have = new Set(deps.dependsOn.map((d) => d.id))
  const blocksMe = new Set(deps.blocks.map((d) => d.id))
  return all
    .filter((t) => t.task_id !== selfId)
    .filter((t) => !have.has(t.task_id))
    .filter((t) => !blocksMe.has(t.task_id))  // 加它必成环（它已经等我）
    .map((t) => ({ id: t.task_id, title: t.title || t.task_id }))
}

/* ── 交付版本 ── */

export interface DeliverablesLike {
  task_id: string
  versions: number[]
  count: number
  finalVersion: number
  items: Array<{ id: string; version: number; is_final: number; filename: string }>
}

/**
 * 版本行：`交付 2 稿 · 最终 v1` 
 * ★ 特别标出「最终 < 最大」，因为那意味着**最后一稿不是算数的那一稿** ——
 *   这是最容易搞错的地方（人默认最新=最终）。
 */
export function versionLine(dl: DeliverablesLike): string {
  const n = dl.count
  if (n === 0) return '无交付'
  const fv = dl.finalVersion
  const max = dl.versions.length > 0 ? Math.max(...dl.versions) : 0
  const tail = fv > 0 && fv < max ? ` · 最终 v${fv}（不是最新那稿）` : fv > 0 ? ` · 最终 v${fv}` : ''
  return `交付 ${n} 稿${tail}`
}

/** 版本提示：只在「最终 ≠ 最新」时解释一句，其余不啰嗦 */
export function versionHint(dl: DeliverablesLike): string {
  const max = dl.versions.length > 0 ? Math.max(...dl.versions) : 0
  if (dl.finalVersion > 0 && dl.finalVersion < max) {
    return `v${max} 交上去后发现有问题，已回退到 v${dl.finalVersion} —— 对外算数的是 v${dl.finalVersion}。`
  }
  if (dl.count === 1) return '只有一稿。'
  return `v${max} 是最新，也是最终稿。`
}
