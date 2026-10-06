/**
 * ★ 最小本地声明 —— `@deepseek-ai/dsh-typert-protocol`
 * =====================================================================
 * **为什么需要这个文件**：本仓不是 DSH monorepo（没有 `node_modules/@deepseek-ai/*`
 * 的符号链接），而 host half 必须 import 这个包才能注册 remote 服务。
 * ⇒ 用一份**最小声明**让本地编得过；**运行时**由**宿主**提供真身
 *   （与 `dshmarket` 的做法一致 —— 它裸 import `@deepseek-ai/cordis` 而自己
 *   连 `node_modules` 都没有，靠的就是 peerDependencies + 宿主解析）。
 *
 * **签名抄自上游**（2026-10-05 读到）：
 *   `deepseek-harness/packages/typert/protocol/src/index.ts`
 *     · `export abstract class TypertRemoteService<out T = never> extends Service<T>`
 *       `protected constructor(ctx: Context, serviceKey: string, options: ...)`
 *     · `export function Remote(option: string): RemoteMethodDecorator`
 *       其中 `RemoteMethodDecorator` 用的是**标准装饰器**形态
 *       （`ClassMethodDecoratorContext`）—— 所以本仓 tsconfig **不能**开
 *       `experimentalDecorators`（开了就变成 legacy 语义，签名对不上）。
 *
 * ⚠️ 本文件只声明**我们用到的两个成员**（`TypertRemoteService` / `Remote`）。
 *    这是本仓一贯的"最小形状"风格（见 `HostContext`）—— 宁可窄，不要绑一整套内部类型。
 *    若上游改了这两个签名，配套的桥接检查脚本会在
 *    **装上真身之后**当场报错（它真跑一次注册），不会静默。
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  /** 标准装饰器上下文（lib.es5 未提供，这里只声明用到的成员） */
  interface ClassMethodDecoratorContextLike {
    readonly kind: 'method'
    readonly name: string | symbol
  }

  /**
   * Cordis Service 基类，同时把服务键绑到 Typert Gateway。
   * @param ctx 所属 cordis Context
   * @param serviceKey **既是 cordis 服务键，也是默认 wire namespace**
   */
  export abstract class TypertRemoteService<T = never> {
    protected constructor(ctx: unknown, serviceKey: string, options?: unknown)
  }

  /**
   * 非一元（流式）端点的选项。
   * ★ 上游**要求且只允许** `mode` 一个键（`Remote` 的实现里会校验
   *   `Reflect.ownKeys(options).length === 1`，多写一个键**当场抛 TypeError**）。
   */
  export interface RemoteMethodOptions {
    /** `stream`：把 Host 方法返回的 `Iterable` / `AsyncIterable` 逐项送过逻辑流 */
    readonly mode: 'stream'
  }

  /**
   * 把一个 public 实例方法标成 Remote 端点。
   *
   * ★★ 网关靠 **`Function.prototype.toString()` 读编译后的参数名**来生成 descriptor
   *   ⇒ **参数不能写默认值**、**`signal` 必须最后**。真判据见
   *   配套的桥接检查脚本（它直接扫编译产物）。
   *
   * ★ `{ mode: 'stream' }` —— 契约 §3.4 的 `POST /scene/{id}/run` 是 SSE，
   *   必须走这条：Host 方法返回 `AsyncIterable<Out>`，客户端用
   *   `remote.<ns>.<method>(query, signal)` 直接 `for await` 消费。
   */
  export function Remote(
    option: string | RemoteMethodOptions,
  ): (method: (...args: never[]) => unknown, context: ClassMethodDecoratorContextLike) => void
}
