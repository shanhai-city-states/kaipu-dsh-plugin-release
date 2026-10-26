/**
 * 山海·开铺 · 智囊团插件 · host half
 * =====================================================================
 * ★ 定位：**「专家团」= 一组专家（能力的集合）；
 *   「智囊团」= 一群谋士（会商量的组织）** ——
 *   按流程组团**本质是会商流程**，不是并行调用。名字要装得下这件事。
 *
 * ★ 两种姿态（必须分开）：
 *   · **默认内置**：客户没带自己的 Agent ⇒ 开箱即用（**我们的"样品间"**）
 *   · **可被替换**：客户带了自己的 Agent ⇒ **任一灯位都能被顶替**
 *   ⇒ 能做到"可被顶替"，才是真自由。
 *
 * ⚠️ 本包**不含**我方 Agent 的 skill / memory / 内部 prompt 的任何副本 ——
 *    那些只在服务端。本包只是"对内灯组的客户端面"。
 */

export interface WisdomConfig {
  builtinSample?: boolean
  lampGroups?: unknown[]
}

export interface HostContext {
  logger?: { info(msg: string, ...rest: unknown[]): void; warn(msg: string, ...rest: unknown[]): void }
  remote?: { register(ns: string, handlers: Record<string, (...args: never[]) => unknown>): void }
}

export const name = 'shanhai-kaipu-wisdom-team'

export function apply(ctx: HostContext, config: WisdomConfig = {}): void {
  ctx.logger?.info(
    `[${name}] 智囊团插件已加载 · 内置样品=${config.builtinSample === true ? '开' : '关'}`,
  )
  // ★★ 本插件**不注册自己的 remote 端点** —— 这是架构抉择，不是未完成。
  //
  //   数据由「场地插件」注册的 `kaipu/*` 命名空间提供。原因（技术硬约束）：
  //   DSH 网关按**命名空间**挂载，同一个 ns 只能挂一个 service。
  //   本插件若也注册 `kaipu`，要么覆盖场地通道（场地挂掉），要么被拒（自己挂掉）
  //   —— 两种结果都违反「摘掉智囊团，场地仍完整可用」。
  //
  //   ⇒ client half 经宿主的 `connection` 服务调用
  //     `kaipu/status` · `kaipu/listScenes` · `kaipu/listAgents`
  //     （wire 契约，非源码依赖；验收由 tools/check-remote-bridge.mjs 看护）。
  //   详见 `src/client/bridge.ts` 文件头的架构说明。
  //
  // ★ 本插件**不**做任何"场地必须依赖我"的事 —— 见 cordis.patch.yml 顶部。
  ctx.logger?.info(`[${name}] 数据通道：复用场地插件的 kaipu/* 端点（本包不注册端点）`)
}
