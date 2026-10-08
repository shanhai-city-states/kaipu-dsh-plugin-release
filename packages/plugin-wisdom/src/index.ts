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
 * ⚠️ 本包**不含**本插件的 skill / memory / 内部 prompt 的任何副本 ——
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
  // TODO(Step 4)：注册智囊团专属端点（灯组视图 / 会商记录）
  // ctx.remote?.register('shanhai/kaipu-wisdom', { listLampGroups, listConsultations })
  //
  // ★ 注意：**不**在这里做任何"场地必须依赖我"的事 —— 见 cordis.patch.yml 顶部。
}
