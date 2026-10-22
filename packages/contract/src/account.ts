/**
 * 山海·开铺 · 契约层 · 鉴权与账户（契约 #1 / #2 —— ★ P0 解封项）
 * =====================================================================
 * 背景：004 Q1 —— 契约正本本来就有这两个接口，但客户端摘编漏了，
 *       导致"第 1 天自证接对了"跑不通。出具方已认错并补进 v1.1。
 *
 * ★ 客户端纪律（三条，写死在类型注释里）：
 *   1) `deviceToken` **只存内存**，不落盘。
 *   2) `serverTime` 是**本会话唯一时间基准** —— 算法：
 *      `offset = serverTime - Date.now()`，之后所有倒计时都用
 *      "服务端时间 + offset" 显示。**客户端不自己判定时间**。
 *   3) `features` 是**功能可见性开关，不是权限**。真权限在服务端判；
 *      **不许把它当安全边界用**（前端绕过 = 安全事故）。
 */

/* ───────────────────── POST /auth/device（契约 #1） ───────────────────── */

export interface DeviceAuthRequest {
  /** ★ 硬件指纹哈希 —— 必须**跨重启稳定**，不是每次随机 */
  fingerprint: string
  name: string
  platform: string
  arch: string
  clientVersion: string
}

export interface DeviceAuthResponse {
  /** ★ 只存内存，不落盘 */
  deviceToken: string
  expiresIn: number
  account: { id: number; name: string }
  /** ★ 本会话唯一时间基准 */
  serverTime: string
}

/* ───────────────────────── GET /me（契约 #2） ───────────────────────── */

export interface FeatureFlags {
  agentProfile?: boolean
  /** ★ 读法写死：`wisdomTeam ?? expertTeam`（契约 #16 别名并存） */
  wisdomTeam?: boolean
  /** @deprecated 用 `wisdomTeam`；命名评审定后删任一字段 = 改一行 */
  expertTeam?: boolean
  customScenes?: boolean
  roleSeats?: boolean
  reportSign?: boolean
  /** ★ 敏感面默认关 · 客户端**不实现**（N-2 邻域） */
  promptPreview?: boolean
}

export interface MeResponse {
  credits: number
  entitlements: string[]
  plan: { name: string; expiresAt: string }
  serverTime: string
  features: FeatureFlags
}

/**
 * ★ 智囊团开关读法 —— **唯一入口**。
 * 不要在别处直接写 `features.expertTeam`（改名时要改多处）。
 */
export function isWisdomTeamEnabled(features: FeatureFlags | undefined): boolean {
  if (features === undefined) return false
  return features.wisdomTeam ?? features.expertTeam ?? false
}

/** 计算服务端时间偏移（毫秒）。之后用 `Date.now() + offset` 显示服务端时间。 */
export function serverTimeOffset(serverTime: string, now: number = Date.now()): number {
  const t = Date.parse(serverTime)
  return Number.isNaN(t) ? 0 : t - now
}
