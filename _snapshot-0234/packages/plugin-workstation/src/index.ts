/**
 * 山海·开铺 · 工位插件 · host half（期1）
 * =====================================================================
 * ★ 本包不含我方服务端逻辑副本——场地数据/状态/API 在服务端。
 *   本包只是「工位」的客户端面，通过契约(@shanhai/kaipu-contract)与服务端通信。
 */

import { WorkstationRemoteService } from './remote/service.js'

/** 插件配置（与 `cordis.patch.yml` 的 config 对应） */
export interface WorkstationConfig {
  // 复核结论②：接口键集须覆盖 patch 声明键
  // cordis.patch.yml 现声明 config: { scaffold: true }，此处补对应可选项
  scaffold?: boolean
  /** ★ 服务端地址（期4 起接真数据；空 ⇒ 退回 scaffold 只读态） */
  baseUrl?: string
  /** 本机指纹（空 ⇒ host 按 hostname/user/platform 推导，同机稳定） */
  fingerprint?: string
  /** 客户端版本（服务端灰度用，可空） */
  clientVersion?: string
}

/** DSH host 侧最小 ctx 形状（只写我们用到的，避免绑 DSH monorepo 内部包） */
export interface HostContext {
  logger?: { info(msg: string, ...rest: unknown[]): void; warn(msg: string, ...rest: unknown[]): void }
}

export const name = 'shanhai-kaipu-workstation'

export function apply(ctx: HostContext, config: WorkstationConfig = {}): void {
  ctx.logger?.info(
    `[${name}] 工位插件已加载（${config.baseUrl ? '已接服务端 ' + config.baseUrl : '本地只读态（未配 baseUrl）'}）`,
  )

  // ── host 侧数据通道（Typert Remote / SRC 模式）──────────────────────
  //
  // 面板（client half）通过
  //   connection.rpc.call('/api', 'kaipu-workstation/<method>', { args: { query } })
  // 调到这里。本类只**声明**端点，descriptor 由 DSH Gateway 的 SRC 反射在
  // 运行时生成 ⇒ 本包零构建产物。
  //
  // ★ 整段 try/catch：**通道注册失败不能把插件带崩**。
  //   ⚠️ 口径（★ 2026-10-10 承双灯 P1-② 收窄）：这里防的是「**host 注册失败**波及插件加载」
  //      （一个环节抛错 ⇒ 多个插件 Failed to initialize），
  //      **不写「防整站白屏」** —— 整站白屏的真正落点在 **client 侧**
  //      （DSH client 启动「全或无」、无插件级错误边界，见 `tools/check-fault-isolation.mjs`）；
  //      那一段的防护在 `src/client/index.ts` 的 `apply()`（本批已补）。
  //   这里宁可退化到"面板显示未接入"，也不抛。
  try {
    new WorkstationRemoteService(ctx as never, config as Record<string, unknown>)
    ctx.logger?.info(
      `[${name}] ✓ 数据通道已注册（remote namespace=kaipu-workstation；` +
        `status / state / orgTree / orgNodeCreate / orgNodePatch / orgNodeDelete）`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ctx.logger?.warn(`[${name}] ⚠ 数据通道注册失败：${msg}（面板将显示未接入）`)
  }
}
