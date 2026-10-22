/**
 * ★★★ 机器生成文件 —— 不要手改 ★★★
 *
 * 来源：contracts/v1.1/{errors,sse-events,features,seats}.json
 * 生成：node tools/gen-contract.mjs
 * 校验：node tools/gen-contract.mjs --check   （有漂移即失败）
 *
 * 改契约的正确姿势：改 JSON → 重跑生成 → 提差异单（★ 不单方改契约）。
 */


/** 契约版本（对账依据：认版本号，不认"我记得是这样的"） */
export const CONTRACT_VERSION = "v1.1" as const

/* ═══════════════ 错误码（errors.json）═══════════════ */

/** 错误码总表。★ 单一事实源，不要在别处再写一份。 */
export const ERROR_CODES = [
  {
    "http": 400,
    "code": "invalid_request",
    "when": "参数缺失 / 格式错",
    "uiText": "差了个东西，我没看明白。回头检查下再发。",
    "textSource": "svc-012 §2.1（原拟稿见 cli-007 §2.3）",
    "textAuthor": "cli",
    "textStatus": "confirmed",
    "why": "svc-012 §2.1：「✅ 认可 · 一字不改」。"
  },
  {
    "http": 401,
    "code": "unauthorized",
    "when": "无 / 过期 / 非法 token",
    "uiText": "你的通行证不管用了，重新领一张就好。",
    "textSource": "svc-012 §2.1",
    "textAuthor": "svc",
    "textStatus": "confirmed",
    "why": "★ 原拟稿写「过期了」，只覆盖一种成因；401 的三种成因是【无 / 过期 / 非法令牌】。只写「过期」，用户在「令牌被判非法」时会按过期去理解、反复重领还是失败 —— 文案与实际成因不符 = 让人白试。（svc-012 §2.1 定稿）"
  },
  {
    "http": 402,
    "code": "insufficient_credits",
    "when": "余额不足",
    "uiText": "场地费不够了，充一点再来。",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed"
  },
  {
    "http": 403,
    "code": "expert_forbidden",
    "when": "无该专家权益",
    "uiText": "这位不在你的铺子名单里。",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed"
  },
  {
    "http": 403,
    "code": "agent_forbidden",
    "when": "无该 Agent 权益",
    "uiText": "这位不在你的铺子名单里。",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed"
  },
  {
    "http": 403,
    "code": "seat_immutable",
    "when": "试图更换签名位",
    "uiText": "签名这件事，只能我来。",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed"
  },
  {
    "http": 404,
    "code": "not_found",
    "when": "对象不存在",
    "uiText": "没找到这个铺子，看看名字对不对？",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed"
  },
  {
    "http": 409,
    "code": "duplicate_request",
    "when": "幂等：同 requestId 重复提交",
    "uiText": "这一单已经在跑了，别急。",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed",
    "detailShape": "{ \"state\": \"running\", \"poll\": \"/scene/run/{requestId}\" }",
    "clientAction": "不弹错。按 detail.poll 直接切到查询接口。"
  },
  {
    "http": 409,
    "code": "not_checked_in",
    "when": "requiresExternal 场景无有效预约",
    "uiText": "还没到进场时间。到了我提醒你。",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed",
    "detailShape": "{ \"requiresExternal\": true, \"availableAt\": \"<ISO8601 可进场时点>\" }",
    "clientAction": "按 detail.requiresExternal 显示『该场景需进场』，不是普通报错。★ 若带 availableAt，必须一并显示——它是用户的『出路』（何时能进场），只说不给时点等于没说。"
  },
  {
    "http": 409,
    "code": "seat_conflict",
    "when": "同一实体兼任执行位 + 审计位",
    "uiText": "干活的和审账的，不能是同一个人。",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed"
  },
  {
    "http": 422,
    "code": "reservation_expired",
    "when": "过期不候",
    "uiText": "这场的门关了，是因为有下一场在等。再约一场吧，不用重新填。",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed"
  },
  {
    "http": 426,
    "code": "upgrade_required",
    "when": "客户端版本过低",
    "uiText": "这个版本的台子旧了，升一下再进。",
    "textSource": "svc-006 §二 #8",
    "textStatus": "confirmed"
  },
  {
    "http": 429,
    "code": "rate_limited",
    "when": "超限流",
    "uiText": "有点挤，缓一缓再进。",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed"
  },
  {
    "http": 500,
    "code": "server_error",
    "when": "服务端异常（5xx）",
    "uiText": "场地这边打了个喷嚏，我们看看。你的东西没丢。",
    "textSource": "cli-001 §6.3",
    "textStatus": "confirmed"
  }
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]['code']

/** ★ code 不在表内时的兜底文案（客户端纪律：不许把裸 code 印给用户） */
export const ERROR_FALLBACK = {
  "uiText": "场地这边有点不对劲，我们看一下。你的东西没丢。",
  "alsoReport": true
} as const

export const ERROR_ENVELOPE_NOTE = "客户端【不得】把原始错误直出给用户；一律按 code 翻译。code 不在本表内 ⇒ 兜底文案 + 上报（不许把裸 code 印给用户）。" as const


/* ═══════════════ SSE 事件（sse-events.json）═══════════════ */

export const SSE_EVENT_ORDER = "start → (round_start → lamp_start/lamp_delta/lamp_done×N → round_done)+ → summary → usage → done" as const

export const SSE_EVENTS = [
  {
    "event": "start",
    "fields": {
      "requestId": "string",
      "scene": "string",
      "lamps": "string[]",
      "serverTime": "iso8601"
    },
    "note": "lamps 为本次实际参与维度（dims 裁剪后的结果）"
  },
  {
    "event": "round_start",
    "isNew": "004 #2",
    "fields": {
      "round": "number",
      "reason": "string"
    },
    "note": "reason 例：'首轮' / '⚡有条件回炉'"
  },
  {
    "event": "lamp_start",
    "fields": {
      "round": "number",
      "lamp": "string",
      "agent": "string"
    },
    "note": "round 为 004 #2 新增（兜底判据）"
  },
  {
    "event": "lamp_delta",
    "fields": {
      "round": "number",
      "lamp": "string",
      "text": "string"
    },
    "note": "流式增量；按 (round, lamp) 归组渲染"
  },
  {
    "event": "lamp_done",
    "fields": {
      "round": "number",
      "lamp": "string",
      "verdict": "Verdict",
      "detail": "string",
      "latencyMs": "number"
    }
  },
  {
    "event": "round_done",
    "isNew": "004 #2",
    "fields": {
      "round": "number",
      "verdict": "Verdict"
    }
  },
  {
    "event": "summary",
    "fields": {
      "verdict": "Verdict",
      "conditions": "string[]",
      "round": "number",
      "participatedDims": "string[]",
      "skippedDims": "string[]"
    },
    "note": "★ participatedDims / skippedDims 为 004 #4 新增。报告体同步固定带『本次参与维度 / 未参与维度 / 裁剪依据』—— ★ 报告不能给出『审全了』的错觉。"
  },
  {
    "event": "usage",
    "fields": {
      "tokensIn": "number",
      "tokensOut": "number",
      "credits": "number",
      "balanceAfter": "number"
    },
    "note": "★ 唯一可信计费口径。客户端不得自行计算。"
  },
  {
    "event": "done",
    "fields": {
      "finishReason": "string"
    }
  }
] as const

export const SSE_VERDICTS = [
  {
    "value": "✅通过",
    "tone": "pass"
  },
  {
    "value": "⚡有条件",
    "tone": "conditional",
    "triggers": "回炉（goto）"
  },
  {
    "value": "❌驳回",
    "tone": "reject",
    "triggers": "abort"
  },
  {
    "value": "⛔拒收",
    "tone": "refuse",
    "triggers": "abort · 不收费"
  }
] as const

/** 渲染规则（客户端界面纪律，逐条可自查） */
export const SSE_RENDER_RULES = [
  {
    "id": "R1",
    "rule": "归组键 = (round, lamp)；round_start 为主、round 字段为兜底"
  },
  {
    "id": "R2",
    "rule": "界面按『第 N 轮』分段，回炉可见（不合并成一条流水）"
  },
  {
    "id": "R3",
    "rule": "四类判定必须可区分且可见 —— 流程透明是卖点，不是装饰"
  },
  {
    "id": "R4",
    "rule": "★ dims 裁剪后，尾部固定显示『参与维度 / 未参与维度』，不做成可折叠的次要信息"
  },
  {
    "id": "R5",
    "rule": "★ 断开 = 『已停止接收』，不写『已取消』（服务端仍在算完并落 lamp_runs）"
  },
  {
    "id": "R6",
    "rule": "轮数由服务端 loopPolicy 决定，客户端不得推断；outputLevel 只影响输出详略"
  }
] as const

export const SSE_RECOVERY = {
  "endpoint": "GET /scene/run/{requestId}",
  "isNew": "004 #5",
  "clientAction": "本地库持久化 requestId 列表；进页先查，state=done 直接渲染结果（不重连 SSE），state=running 则续订阅。★『过程透明是卖点』——刷新不能丢过程。"
} as const


/* ═══════════════ features 六位（features.json）═══════════════ */

export const FEATURE_FLAGS = [
  {
    "key": "agentProfile",
    "meaning": "Agent 档案管理",
    "p1Default": true,
    "controls": "档案入口显隐"
  },
  {
    "key": "wisdomTeam",
    "aliasOf": "expertTeam",
    "meaning": "智囊团（组团）",
    "p1Default": true,
    "controls": "智囊团入口显隐"
  },
  {
    "key": "expertTeam",
    "deprecatedInFavorOf": "wisdomTeam",
    "meaning": "（旧名，同值并存）",
    "p1Default": true
  },
  {
    "key": "customScenes",
    "meaning": "自定义场景",
    "p1Default": true,
    "controls": "C-8 入口"
  },
  {
    "key": "roleSeats",
    "meaning": "三位指派（执行/审计/管理）",
    "p1Default": true,
    "controls": "C-6 入口"
  },
  {
    "key": "reportSign",
    "meaning": "报告签名",
    "p1Default": true,
    "controls": "C-5 验签展示"
  },
  {
    "key": "promptPreview",
    "meaning": "提示词预览",
    "p1Default": false,
    "controls": "★ 敏感面默认关 · 客户端不实现"
  }
] as const

export type FeatureKey = (typeof FEATURE_FLAGS)[number]['key']

/** ★ 智囊团开关的唯一读法：wisdomTeam ?? expertTeam（契约 #16） */
export const WISDOM_TEAM_READ_RULE = "wisdomTeam ?? expertTeam —— 命名评审定后删任一字段都是改一行（契约增补 #16）" as const

export const FEATURE_DISCIPLINE = [
  "★ features.* 是【功能可见性开关】，不是【权限】。真权限在服务端判，客户端只按它控制显隐。",
  "★ 不许把 features 当安全边界用 —— 把它当权限 = 前端绕过 = 安全事故。",
  "★ promptPreview 默认 false 且客户端不实现（属『藏实现』面，N-2 邻域）。即便服务端开了也不做界面。"
] as const


/* ═══════════════ 角色位（seats.json）═══════════════ */

export const SEATS = [
  {
    "seat": "execution",
    "label": "执行位",
    "defaultHolder": "山海智囊团",
    "replaceable": true,
    "replaceableWith": [
      "客户自带 Agent",
      "第三方 Agent"
    ],
    "noImplicitIntervention": true
  },
  {
    "seat": "audit",
    "label": "审计位",
    "defaultHolder": "山海第三方审计（备选）",
    "replaceable": true,
    "replaceableWith": [
      "客户指定审计方",
      "第三方审计机构"
    ],
    "noImplicitIntervention": true
  },
  {
    "seat": "management",
    "label": "管理位",
    "defaultHolder": "山海管理方（候选）",
    "replaceable": true,
    "replaceableWith": [
      "客户自任",
      "第三方"
    ],
    "noImplicitIntervention": true,
    "note": "权限面最重 ⇒ 接入必须带四要素：身份 / 权责 / 留痕 / 可撤销（响石三道锁）"
  },
  {
    "seat": "signature",
    "label": "签名位",
    "defaultHolder": "山海（平台）",
    "replaceable": false,
    "uiRule": "★ 界面必须显示『不可更改』并说明原因 —— 签名不是服务，是担保。",
    "errorOnAttempt": "403 seat_immutable"
  }
] as const

export type SeatKey = (typeof SEATS)[number]['seat']

export const SEAT_INVARIANTS = {
  "INV-18": "执行位/审计位/管理位可替换：任一位置换成第三方 ⇒ 流程仍可完整跑通",
  "INV-19": "签名位不可替换：客户端无法指定自己为签名方；报告签名恒由服务端",
  "G3": "三个可替换位替换后，我方不做隐式干预（界面上不得出现『山海建议/提醒』类干预痕迹）"
} as const
