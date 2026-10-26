/* ══════════════════════════════════════════════════════════════════
   项目阶段 · 纯逻辑（2026-10-26 阿开定 · Agent 版 OA）

   ★ 为什么要有：
     现在有「项目」有「任务」，但**项目本身没有状态**。一个项目走到哪一步，
     系统里看不出来，只能靠翻任务去推。
     阿开原话：「这样清晰之后，我们的审计以及第三方审计就省事很多了。
     直接按项目。按任务先后顺序以及任务需求和交付条理非常清晰。」

   ★ 纯函数，不碰 React、不碰网络：可单测，判据能真跑输入→输出。

   ★ 顺序即语义（与后端 `PROJECT_PHASES` 逐字同序）：
     立需求 → 出计划书 → 分工 → 施工 → 验收 → 归档
     ★ 前端不另造名字、不另排序 —— 后端给 `phaseLabel`，这里只在缺失时兜底。
   ══════════════════════════════════════════════════════════════════ */

/** 六个阶段（与后端 `PROJECT_PHASES` 同序同值） */
export const PROJECT_PHASES: ReadonlyArray<string> = [
  'requirement',
  'plan',
  'assignment',
  'build',
  'review',
  'archived',
]

/** 兜底人话名 —— 只有服务端没给 `phaseLabel` 时才用 */
const PHASE_LABEL: Readonly<Record<string, string>> = {
  requirement: '立需求',
  plan: '出计划书',
  assignment: '分工',
  build: '施工',
  review: '验收',
  archived: '归档',
}

/** 每一阶段「该产出什么」—— 用在 hover 提示上，让人知道这步要交什么 */
const PHASE_DELIVERABLE: Readonly<Record<string, string>> = {
  requirement: '需求确认书：要做成什么样、什么不做',
  plan: '开发计划书：怎么做、分几期、多大代价',
  assignment: '分工方案：谁干哪件（任务依赖在这里定）',
  build: '交付物：干出来的东西',
  review: '验收结论：通过 / 有条件通过 / 打回',
  archived: '归档包：定稿资料 + 清单，冻结不再改',
}

/**
 * 阶段序号（1..6）。`archived` 是第 6。
 * ★ 未知阶段一律返回 0 —— 不猜、不插队。前端据此显示「未知阶段」而不是
 *   假装它在第一步（假装 = 让人以为项目刚起步，是假读数）。
 */
export function phaseIndex(phase: string | undefined): number {
  const p = (phase ?? '').trim()
  const i = PROJECT_PHASES.indexOf(p)
  return i < 0 ? 0 : i + 1
}

/** 人话名：服务端 label 优先，其次本地兜底，再不行原样返回（不吞） */
export function phaseLabel(phase: string | undefined, serverLabel?: string | undefined): string {
  const p = (phase ?? '').trim()
  if (p === '') return '未知阶段'
  const given = (serverLabel ?? '').trim()
  if (given.length > 0) return given
  return PHASE_LABEL[p] ?? p
}

/** hover 提示：第几步 / 共六步 · 这步该交什么 */
export function phaseHint(phase: string | undefined): string {
  const p = (phase ?? '').trim()
  const i = phaseIndex(p)
  if (i === 0) return `未知阶段（${p || '空'}）—— 不在六阶之内`
  const what = PHASE_DELIVERABLE[p] ?? ''
  return `第 ${i}/${PROJECT_PHASES.length} 步：${PHASE_LABEL[p] ?? p}${what ? ' · 这步要交：' + what : ''}`
}

/**
 * 进度条（纯文本 / 非图形，便于在窄卡片里放）：
 * `●●●○○○` —— 已走过几步一眼看出。
 * ★ 用两字符而不是百分比数字：卡片很窄，`3/6` 要读，`●●●○○○` 直接看。
 */
export function phaseBar(phase: string | undefined): string {
  const i = phaseIndex(phase)
  if (i === 0) return '？'.repeat(PROJECT_PHASES.length)
  return '●'.repeat(i) + '○'.repeat(PROJECT_PHASES.length - i)
}

/** 下一阶（用于「推进到下一步」按钮）；已是最后一阶 ⇒ null */
export function nextPhase(phase: string | undefined): string | null {
  const i = phaseIndex(phase)
  if (i === 0 || i >= PROJECT_PHASES.length) return null
  return PROJECT_PHASES[i] ?? null
}

/** 上一阶（用于「退回一步」按钮）；已是第一阶 ⇒ null */
export function prevPhase(phase: string | undefined): string | null {
  const i = phaseIndex(phase)
  if (i <= 1) return null
  return PROJECT_PHASES[i - 2] ?? null
}

/** 归档态：不再是「推进」，而是「这个项目已经收口」 */
export function isArchivedPhase(phase: string | undefined): boolean {
  return (phase ?? '').trim() === 'archived'
}
