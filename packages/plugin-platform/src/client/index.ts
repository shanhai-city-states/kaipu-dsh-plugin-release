/**
 * 山海·开铺 · 场地插件 · client half
 * =====================================================================
 * 这一半在**浏览器侧**（DSH web shell 里），往 UI 的 slot 树注册界面。
 * 与 `../index.ts`（host half）是两半，**通过 rpc 见面**，不共享内存。
 *
 * ── ★★ 两条 inject 是两套词表（最贵的坑之一）──────────────
 *
 *   · `package.json` 的 `dsh.client.inject` = **模块图边**（boot 顺序）→ 填**包名**
 *   · 本文件导出的 `inject`                   = **cordis 服务依赖**   → 填**服务名**
 *
 *   早先把包名填进本文件的 inject，结果卡在
 *     `pending (waiting for services: @deepseek-ai/dsh-client-ui-renderer, …)`
 *   侧边栏图标根本出不来。⇒ **别犯第二次。**
 *
 * ── ★★ 面板必须成对注册──────────────────────────────────────
 *
 *   · `sidebar.panellist`（list）：`id` + `order` + **`label` 必须是函数**
 *   · `main`（keyed）：`key` **必须等于** 上面那个 `id`
 *   两者靠同一个字符串对上号，写错就是「点了没反应」。
 *
 * ── ★★ list 座位漏 `id` ⇒ 整站白屏─────────────────────────
 *
 *   实测：`sidebar.session.row.leading` 漏 `id` ⇒ apply 阶段抛错
 *   ⇒ 整个 client bundle 加载失败 ⇒ **整站白屏**。list 座位**必须**给 `id`。
 */
import { createElement } from 'react'
import { KaipuBrandName } from './Brand.js'
import { getConnection, type ClientCtxLike } from './bridge.js'
import { setConnection } from './live.js'
import { PANEL_ID } from './panel-id.js'
import { PlatformPanel } from './PlatformPanel.js'
import { PlatformPanelIcon } from './PlatformPanelIcon.js'
import type { ClientContext } from './host-modules.js'

/**
 * ★ 服务名（不是包名）。
 *   · `slots`      —— 由 ui-renderer 提供（面板注册用）
 *   · `connection` —— 由 `@deepseek-ai/dsh-client-connection` 提供（**数据通道**；
 *     面板经它调本插件 host half，见 `bridge.ts` 文件头）
 *
 * ★★ 这里**曾经加过** `'remote'`（为了走流式端点），2026-10-05 **撤掉了**，原因记在这：
 *   加了 `'remote'` 之后确实能拿到 `ctx.remote`（键：`ctx/name/ownerCtx/connection/
 *   namespaces/hostFacts/streams/events/mutations`），**但里面没有 `kaipu`** ——
 *   DSH 侧装配 namespace 的那份清单是**硬编码的内部包清单**
 *   （逐个 `import '@deepseek-ai/xxx/remote'` 再 `ctx.remote.$mount(...)`），
 *   **第三方插件不在其中**，namespace 不会自动来。
 *   ⇒ 运行改走一元通道（`startRun` + `pollRun`），`remote` 也就不需要了。
 *   ★ 留这条注释是因为"加 inject 拿 remote"是一条**看起来最自然、实际走不通**的路，
 *     下一个人很可能再试一次。
 */
export const inject = ['slots', 'connection']

export function apply(ctx: ClientContext): void {
  // ── ⓪ 取数据通道（★ 取不到也不能炸：面板会显示"通道不可用"，见 live.ts）──
  setConnection(getConnection(ctx as unknown as ClientCtxLike))

  // ── ① 主区域面板（keyed slot）──────────────────────────────
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: PANEL_ID },
      () => createElement(PlatformPanel, {}),
    ),
  )

  // ── ② 侧边栏图标（list slot · ★ id/order/label 三件套缺一不可）──
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID, // ★ 必须 == 上面 main 的 key
        /**
         * ★★ `order` 的取值不是审美，是**位置礼仪**（2026-10-05 实测后改）。
         *
         * 宿主 `sidebar` 的排序规则（实测自行为）：
         *   `.sort((a, b) => a.order - b.order)`  —— 升序，**同值看注册顺序**。
         *
         * 宿主内置项的 order 区间（实测自各包注册处）：
         *   · `ui-plugin-manager`（插件）  0
         *   · `ui-schedule`（任务）        10
         *   · `ui-agent-preset`            20
         *
         * ★ 原来我写 `0` —— 与宿主「插件」**同值**，实测结果是我的按钮**排在它前面**：
         *     `… 全局面板 | 开铺 | 插件 | 智囊团 …`
         *   这不是"我们更重要"，而是**打乱了宿主既有用户的位置记忆**（插件按钮是宿主自带的，
         *   用户已经形成肌肉记忆；第三方插件插到它前面，等于替宿主改了布局）。
         *
         * ⇒ **第三方插件一律排在宿主内置项之后**：取 **> 20** 的值。用 30 留出空隙，
         *   后来者要插在中间也有位置（这是"给后人留位"的取值，不是随手写的）。
         */
        order: 30,
        // ★ label 是**函数**：sidebar 读取时调用。传字符串不报错但会显示成 "[object]"。
        label: () => '开铺',
      },
      PlatformPanelIcon,
    ),
  )

  // ── ③ 宿主侧边栏的**品牌名**（2026-10-07 加 · 点题）──────────
  //
  // 座位 `sidebar.brand.name` 是宿主**公开**的品牌位（官方自己的品牌插件
  // 就是它的示例占用者）⇒ 占它是"坐席位"，不是改宿主源码。
  // ★ 只占 name、不占 mark：图形标继续用宿主原生那条鱼。
  // ★ 完整的理由 / 字号依据 / 为什么必须兜底 —— 全在 `Brand.tsx` 文件头。
  ctx.slots.inject('sidebar.brand.name', () => {
    try {
      return ctx.slots.register({ name: 'sidebar.brand.name' }, KaipuBrandName)
    } catch {
      // ★★ 这一格已经被坐了（宿主是 official 构建时，官方品牌插件先到）。
      //   座位类型是 **single** —— 同优先级重复注册会 **throw**，
      //   而 apply() 抛错 ⇒ 整个 client bundle 加载失败 ⇒ **整站白屏**。
      //   ⇒ 让给它，静默退回宿主原生名。**不争**（同 order:30 那条的姿态）。
      return () => {}
    }
  })
}
