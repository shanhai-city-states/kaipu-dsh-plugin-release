/**
 * 山海·开铺 · 智囊团插件 · client half
 * =====================================================================
 * ★ 与场地插件**同构但独立**：自己一个侧边栏入口、自己一个 main 面板。
 *   两者**互不 import**。
 *
 * ★ 两条 inject 是两套词表：package.json 填**包名**，这里填**服务名**。
 * ★ 面板成对注册：`main.key` == `sidebar.panellist.id`。
 * ★ list 座位**必须给 `id`**：漏了 ⇒ 整站白屏。
 *
 * ── ★★ 新增：`connection` 注入 ────────────────────
 *
 * 智囊团面板要读灯位数据，走的是**宿主网关**（与场地侧同一条物理通道）。
 * 取 `connection` 的取法与场地侧**逐字一致**（宽松取两种形态、取不到不抛）。
 *
 * ★ 为什么不共用一份 `getConnection`：那是**源码 import** ⇒ 判据 FAIL。
 *   这里是同形状重写（`bridge.ts` 里约 20 行），**行为必须一致**，
 *   由配套的桥接检查脚本的 A 组比对 `REMOTE_NS` / `REMOTE_CHANNEL` 常量。
 *
 * ★ 取不到 connection **不能炸**：`wireConnection` 存 null，面板显示"通道不可用"。
 *   这是**环境问题**，不是业务错误 —— 见 `live.ts` 文件头。
 */
import { createElement } from 'react'
import { WISDOM_PANEL_ID } from './panel-id.js'
import { WisdomPanel, wireConnection } from './WisdomPanel.js'
import { WisdomPanelIcon } from './WisdomPanelIcon.js'
import type { ClientCtxLike } from './bridge.js'

interface ClientContext {
  slots: {
    inject(key: string, cb: () => (() => void) | Iterable<() => void>): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

/**
 * ★ 服务名（不是包名）。
 *   · `slots`      —— 由 ui-renderer 提供（面板注册用）
 *   · `connection` —— 由 `@deepseek-ai/dsh-client-connection` 提供（**数据通道**）
 *
 * ⚠️ `connection` 是**新增**的（骨架期没有）——
 *   ⇒ `package.json` 的 `dsh.client.inject`（**包名**词表）也要同步加
 *     `@deepseek-ai/dsh-client-connection`，**两处都要**（漏一处 = 取不到服务）。
 *     这是踩过的坑：两套词表填反了会卡在 "waiting for services"。
 */
export const inject = ['slots', 'connection']

export function apply(ctx: ClientContext): void {
  // ── ⓪ 取数据通道（★ 取不到也不炸：面板会显示"通道不可用"）──
  //   取出入口在 WisdomPanel 里（`wireConnection`）——
  //   接线层只表达意图，不必知道"数据层把句柄存在哪"。
  wireConnection(ctx as unknown as ClientCtxLike)

  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: WISDOM_PANEL_ID }, () => createElement(WisdomPanel, {})),
  )

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: WISDOM_PANEL_ID, // ★ 必须 == main 的 key
        order: 35, // ★ 排在场地插件（order 30）之后 —— 场地是核心，智囊团可选
        label: () => '智囊团', // ★ 必须是函数
      },
      WisdomPanelIcon,
    ),
  )
}
