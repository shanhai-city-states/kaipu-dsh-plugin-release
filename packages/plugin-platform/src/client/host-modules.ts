/**
 * ★ 宿主模块的**手写最小形状**。
 *
 * 为什么不 import DSH 的类型：`@deepseek-ai/dsh-client-ui-layout` /
 * `dsh-client-ui-sidebar` 是 DSH monorepo 内部包，**不发布到 npm**，
 * 独立包解析不到。只有 ui-slots / ui-primitives / cordis / store / dockkit
 * 在浏览器运行时的 PLATFORM_MODULES 表里（那也只是运行时表，不是 npm 依赖）。
 *
 * ⇒ 按实际用到的 API 手写 interface。代价：类型安全靠我们自己维护；
 *   收益：**插件能独立构建、不绑 DSH monorepo**（这正是"能上市场"的前提）。
 *
 * 依据：`src/client/index.ts` 同名注释（源码级核过）。
 */

export interface SlotsService {
  /** 等某个 slot 被**声明**后再执行注册（解决"我注册的座位由别的插件声明"的时序） */
  inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void
  /**
   * 往已声明的 slot 注册条目。
   * ★ 会抛错：slot 未声明 / keyed 缺 key / **list 缺 id** / 同 key 同优先级重复。
   *   这些错误是好事 —— 早点炸比静默不显示强（漏 id ⇒ 整站白屏）。
   */
  register(options: Record<string, unknown>, component: unknown): () => void
}

export interface ClientContext {
  slots: SlotsService
  /** 按**服务名**取 cordis 服务（官方写法 `ctx.get('connection')`） */
  get?(name: string): unknown
  /** cordis effect 作用域：卸载时自动反向清理 */
  effect?(callback: () => (() => void) | void, label?: string): () => void
  layout?: { selectPanel?: (panelId: unknown) => void }
}
