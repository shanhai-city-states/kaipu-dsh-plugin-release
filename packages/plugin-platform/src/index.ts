/**
 * 山海·开铺 · 场地插件 · host half
 * =====================================================================
 * 这一半跑在 **DSH Host（②/③ 层）**，不碰浏览器。
 * 它负责：契约对接（④ 适配层）、场地能力（场景目录 / 运行编排对接 /
 * 角色位 / 能力边界 / 留痕读取）。
 *
 * ★★ 三条不能破的边界（架构级，不是"藏起来"）：
 *   1. **不持有模型 Key、不直连模型**
 *   2. **不绕过宿主统一适配层**直连服务端域名
 *   3. **不越受管根**
 *
 * ★ 本插件的 skill / memory / 内部 prompt **永不出现在任何响应体里** ——
 *   这条要在每个出参上自查（后续会做成可断言的用例）。
 *
 * ── 2026-10-05（接真接口）改了什么 ──────────────────────────────────
 *   ① 新增 `src/remote/`：host 侧数据通道（`kaipu/status` · `connect` ·
 *      `listAgents` · `listScenes` · `capabilities`）；面板经**宿主网关**调到它。
 *      ★ 为什么必须中转而不是浏览器直连：`kai-pu` **不发任何 `access-control-*`
 *        头**、预检 `OPTIONS` 回 **501**（实测）⇒ 浏览器跨源直连在**技术上**
 *        就走不通；纪律（不直连服务端域名）与物理现实在这里指向同一处。
 *   ② ★ **凭据（deviceToken）落在本进程内存**，浏览器永不持有 ——
 *      这是那条纪律的**收益**，不是负担。
 *   ③ 未配 `baseUrl` ⇒ **本地/未接入模式**（`status.connected:false`）。
 *      ★ 这是**正常状态**，不是故障 —— 面板按它如实说，而不是靠"请求失败"去猜。
 */

import { KaipuRemoteService, type KaipuServiceConfig } from './remote/service.js'

/** 插件配置（与 `cordis.patch.yml` 的 config 对应） */
export interface PlatformConfig extends KaipuServiceConfig {
  scenesCatalog?: boolean
  runView?: boolean
  capabilityBoundary?: boolean
  roleSeats?: boolean
}

/** DSH host 侧最小 ctx 形状（只写我们用到的，避免绑 DSH monorepo 内部包） */
export interface HostContext {
  logger?: { info(msg: string, ...rest: unknown[]): void; warn(msg: string, ...rest: unknown[]): void }
}

export const name = 'shanhai-kaipu-platform'

export function apply(ctx: HostContext, config: PlatformConfig = {}): void {
  const connected = typeof config.baseUrl === 'string' && config.baseUrl !== ''

  ctx.logger?.info(
    `[${name}] 场地插件已加载 · 服务端=${connected ? `已接入（${config.baseUrl}）` : '未接入（本地模式）'}`,
  )

  // ── host 侧数据通道（Typert Remote / SRC 模式）──────────────────────
  //
  // 面板（client half）通过
  //   connection.rpc.call('/api', 'kaipu/<method>', { args: { query } })
  // 调到这里。本类只**声明**端点，descriptor 由 DSH Gateway 的 SRC 反射在
  // 运行时生成 ⇒ 本包零构建产物（不需要 tsdown / zod 生成）。
  //
  // ★ 整段 try/catch：**通道注册失败不能把插件带崩**。
  //   教训是反过来的 —— 一个环节抛错会让整站 UI 链断掉
  //   （15 个插件 Failed to initialize，整站白屏）。这里宁可退化到
  //   "面板显示未接入"，也不抛。
  try {
    new KaipuRemoteService(ctx as never, config)
    ctx.logger?.info(
      `[${name}] ✓ 数据通道已注册（remote namespace=kaipu；` +
        `status / connect / listAgents / listScenes / capabilities）`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ctx.logger?.warn(`[${name}] ⚠ 数据通道注册失败：${msg}（面板将显示未接入）`)
  }
}
