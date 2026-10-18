/**
 * ★ 最小本地声明 —— `@deepseek-ai/dsh-typert-protocol`
 * =====================================================================
 * **为什么需要这个文件**：本仓不是 DSH monorepo（没有 `node_modules/@deepseek-ai/*`
 * 的符号链接），而 host half 必须 import 这个包才能注册 remote 服务。
 * ⇒ 用一份**最小声明**让本地编得过；**运行时**由**宿主**提供真身
 *   （与 `dshmarket` 的做法一致 —— 它裸 import `@deepseek-ai/cordis` 而自己
 *   连 `node_modules` 都没有，靠的就是 peerDependencies + 宿主解析）。
 *
 * **签名抄自上游**（2026-10-05 读到，此处**只记签名、不指路源码）：
 *     · `export abstract class TypertRemoteService<out T = never> extends Service<T>`
 *       `protected constructor(ctx: Context, serviceKey: string, options: ...)`
 *     · `export function Remote(option: string): RemoteMethodDecorator`
 *       其中 `RemoteMethodDecorator` 用的是**标准装饰器**形态
 *       （`ClassMethodDecoratorContext`）—— 所以本仓 tsconfig **不能**开
 *       `experimentalDecorators`（开了就变成 legacy 语义，签名对不上）。
 *
 * ⚠️ 本文件只声明**我们用到的两个成员**（`TypertRemoteService` / `Remote`）。
 *    这是本仓一贯的"最小形状"风格 —— 宁可窄，不要绑一整套内部类型。
 *
 * ⚠️ **订正（2026-10-10 · 承双灯 P1-④；2026-10-18 落仓）**：原先这里写「若上游改签名，
 *    配套的桥接检查脚本会当场报错（它真跑一次注册）」—— 那是「无据的绿」。现在的准确口径是三句：
 *      · `tools/check-remote-bridge.mjs` 只**扫源码 / 编译产物**（grep 级），**不加载**本包
 *        ⇒ 它**证明不了**签名对不对；
 *      · **`tools/check-typert-signature.mjs`（2026-10-18 落仓）** 断言的是**本仓用法自洽**：
 *        `@Remote` 方法**参数无默认值** · **`signal` 在末位** · 本文件声明与 `service.ts` 用法不打架。
 *        它**不加载宿主**，所以属于「静态对齐」，不是「与上游真身逐字一致」；
 *      · 与**上游 d.ts 逐字比对**只有在该脚本拿到 `KAI_DSH_REPO`（宿主仓库在场）时才跑，
 *        不在场 ⇒ 该段打印 **SKIP**（不判红，也不假装验过）。
 *    ⇒ 上游改了这两个签名，静态段**能**发现「本仓用法已经不符合自己声明的形状」，
 *      但「上游真实的形状是否变了」要等 **`KAI_DSH_REPO` 就位（接真身轮）**。
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
   *   ⇒ **参数不能写默认值**、**`signal` 必须最后**。
   *   ★ **判据（2026-10-18 落仓）**：`tools/check-typert-signature.mjs` 直接断言这两条
   *     （扫 `service.ts` 的 `@Remote` 方法参数表：**默认值 = 0 处** · **`signal` 必在末位**）。
   *     ⚠️ 它断言的是**本仓用法**，不是「上游真身形状」——后者要 `KAI_DSH_REPO` 在场（接真身轮）。
   *   ⚠️ **订正（2026-10-10 · 我方自查补报第 5 处，评审清单未列此条）**：原写「真判据见配套的
   *     桥接检查脚本（它直接扫编译产物）」—— 当时**无据**：`check-remote-bridge.mjs` 只比
   *     NS / 端点名 / 通道名，**不看参数表**。该缺口已由上面那支脚本补上，此处留痕不删。
   */
  export function Remote(
    option: string | RemoteMethodOptions,
  ): (method: (...args: never[]) => unknown, context: ClassMethodDecoratorContextLike) => void
}
