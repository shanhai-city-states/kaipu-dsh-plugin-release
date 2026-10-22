/**
 * 山海·开铺 · 契约层 · 入口
 * =====================================================================
 * ★ 本包是全仓**契约类型的唯一出处**。任何插件都从这里 import，
 *   不许在自己包内另行定义错误码 / SSE 事件名 / 形状（否则必然漂移）。
 *
 * 分层：
 *   · `./generated.js` —— ★ **机器生成**，来自 `contracts/v1.1/*.json`。
 *                         手改会被 `gen-contract.mjs --check` 抓出来。
 *   · `./errors.js`    —— 错误码翻译（客户端纪律：不直出原始错误）
 *   · `./sse.js`       —— SSE 事件的判别联合（discriminated union）
 *   · `./models.js`    —— 接口形状（/agents /scenes /scene/run /reservations）
 *   · `./account.js`   —— /auth/device · /me（含 features 读法）
 */
export * from './generated.js'
export * from './errors.js'
export * from './sse.js'
export * from './models.js'
export * from './account.js'
export * from './wire.js'
export * from './workstation.js'
