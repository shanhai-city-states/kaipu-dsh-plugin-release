/**
 * 山海·开铺 · 工位插件 · client half（期1）
 * =====================================================================
 * ★ 与场地/智囊团插件**同构但独立**：自己一个侧边栏入口、自己一个 main 面板。
 *   两包**互不 import**。
 * ★ 两条 inject 是两套词表：package.json 填**包名**，这里填**服务名**。
 * ★ 面板成对注册：`main.key` == `sidebar.panellist.id`。
 * ★ list 座位**必须给 `id`**：漏了 ⇒ 整站白屏。
 */
import { createElement } from 'react'
import { WORKSTATION_PANEL_ID } from './panel-id.js'
import { WorkstationPanelIcon } from './WorkstationPanelIcon.js'
import { WorkstationPanel, wireConnection } from './WorkstationPanel.js'
import type { ClientCtxLike } from './bridge.js'

interface ClientContext {
  slots: {
    inject(key: string, cb: () => (() => void) | Iterable<() => void>): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

/** 服务名（不是包名）：`slots`（ui-renderer）+ `connection`（数据通道） */
export const inject = ['slots', 'connection']

export function apply(ctx: ClientContext): void {
  /* ★★ 2026-10-10（双灯 P1-②）：**白屏在 client，不在 host** —— 防护要装在这一端。
     本仓 `tools/check-fault-isolation.mjs` 实测：DSH 的 client 启动是**全或无**的
     （**没有插件级错误边界**）⇒ client 侧 `apply()` 抛错 = **整站白屏**。
     而原先只有 host（`src/index.ts`）包了 try/catch ⇒ **防护装错了端**。
     ⇒ 这里整段 try/catch：退化为「本面板不显示」，不把整站带下去。
     ⚠️ 口径（承双灯 P1-②）：本防护管的是**本插件 client 侧注册失败**；
        它**不声称**能兜住**模块加载期**错误（如顶层 import 失败 —— 那发生在 `apply` 之前）。 */
  try {
    // ── ⓪ 取数据通道（取不到也不炸：面板显示"通道不可用"）──
    wireConnection(ctx as unknown as ClientCtxLike)

    ctx.slots.inject('main', () =>
      ctx.slots.register({ name: 'main', key: WORKSTATION_PANEL_ID }, () => createElement(WorkstationPanel, {})),
    )

    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: WORKSTATION_PANEL_ID, // ★ 必须 == main 的 key
          order: 40, // ★ 排在场地(30)/智囊团(35)之后 —— 工位可选配套
          label: () => '工位', // ★ 必须是函数
        },
          WorkstationPanelIcon, // ★ 图标位返回图标（原来返回文字 ⇒ 侧边栏重复「工位 工位」）
      ),
    )
  } catch (e) {
    // 面板不显示，但**不让它把整站带下去**
    console.error('[shanhai-kaipu-workstation] client apply 失败 ⇒ 工位面板不显示（其余不受影响）', e)
  }
}
