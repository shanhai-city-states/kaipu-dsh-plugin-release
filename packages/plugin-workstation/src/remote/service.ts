/**
 * 山海·开铺 · 工位插件 · host 侧数据通道（Typert Remote / SRC 模式 · 083-C 期1）
 * =====================================================================
 * 面板（client half）经 `connection.rpc.call('/api', 'kaipu-workstation/<method>', …)` 调到这里。
 * 本类只**声明**端点，descriptor 由 DSH Gateway 的 SRC 反射在**运行时**生成
 * ⇒ 本包零构建产物（不需要 tsdown / zod 代码生成）。
 *
 * ★★ 硬约束（与 plugin-platform 同款，逐字照搬纪律）：
 *   ① 参数不能有默认值（网关靠 `Function.prototype.toString()` 反射参数名）
 *   ② `signal` 必须是最后一个参数
 *   ③ 业务参数一律从 `query` 里取
 *
 * ★ 期1：返回【scaffold 持久化态】（source='scaffold'），诚实标非 live。
 *   待服务端五项（083-C-014 §五）落地后，`state()` 改读真
 *   `kaipu-workstation/state`（source='live'）；本文件只换取数源，不改 wire 形状。
 *
 * ★ 凭据纪律（承 plugin-platform）：工位插件**不持有模型 Key、不直连服务端域名**。
 *   期1 仅渲染持久化态（本地种子），不发起任何对外 HTTP；凭据议题留待服务端接入期。
 */

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// ★ 只 import type —— host half 不经打包，契约包是构建期依赖（用户机上没有），
//   类型被 tsc 擦除 ⇒ 不产生运行时依赖（由桥接检查脚本看护）。
import type {
  RemoteResult,
  WorkstationState,
  WorkstationStatusPayload,
} from '@shanhai/kaipu-contract'
import { scaffoldState, summarizeSeats } from './workstation-state.js'

/** remote 命名空间。★ 必须与 client `bridge.ts` 里的同值（判据看护） */
export const REMOTE_NS = 'kaipu-workstation'

/** 网关取消参数形状（★ 参数名必须叫 `signal`，网关靠它识别并剥出 wire） */
export interface CancelSignal {
  readonly aborted: boolean
}

/** 空入参（有些端点不需要参数；仍要有一个 query，见约束 ③） */
export interface EmptyQuery {
  [k: string]: never
}

/**
 * 工位数据通道服务。
 * 第 2 个构造参数 `REMOTE_NS` 同时是：cordis 服务键 + 默认 wire namespace
 * （客户端端点即 `kaipu-workstation/status` / `kaipu-workstation/state`）。
 */
export class WorkstationRemoteService extends TypertRemoteService {
  constructor(ctx: unknown, _cfg: Record<string, unknown> = {}) {
    super(ctx, REMOTE_NS)
    void _cfg
  }

  /**
   * `kaipu-workstation/status` —— 面板第一件要知道的事：接没接上 + 种子概览。
   * ★ 期1 恒 `connected:true`（本地种子模式，非未接入故障），source 明示 `scaffold`。
   */
  @Remote('status')
  async status(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<WorkstationStatusPayload>> {
    void query
    void signal
    const state = scaffoldState()
    return {
      ok: true,
      data: {
        connected: true,
        projectId: state.projectId,
        source: state.source,
        seats: summarizeSeats(state),
        note: '期1 渲染持久化态（scaffold），服务端五项落地后接真 kaipu-workstation/state',
      },
    }
  }

  /**
   * `kaipu-workstation/state` —— 工位完整持久化态
   * （状态面板多球 / 座位含空位+邀请 / 轮次 B3 / 留痕四字段 / 事件流底座 · 二分口径）。
   * ★ 期1 返回 scaffold 种子（诚实标 source='scaffold'）；不实时流、不悄悄回落 mock。
   */
  @Remote('state')
  async state(query: EmptyQuery, signal?: CancelSignal): Promise<RemoteResult<WorkstationState>> {
    void query
    void signal
    return { ok: true, data: scaffoldState() }
  }
}
