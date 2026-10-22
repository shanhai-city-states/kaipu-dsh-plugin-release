#!/usr/bin/env node
/**
 * g2-disinfect-apply.mjs — 按工坊 `058 §三·3.1` 四条处置口径，对 32 件逐处消毒。
 *
 * ★ mapping 即审计表：每条 [old, new, 依据] 都可逐条核对、可重跑、可回滚（git）。
 * ★ 默认 dry-run（只打印，不写盘）；加 `--apply` 才落地。
 *
 * 处置口径（工坊 `058 §三·3.1`）：
 *   1 件号 → 语义代称（去号，保留技术内容）
 *   2 内部裁定术语/判据编号 → 中性表述
 *   3 内部路径/件名 → 删句
 *   4 花名 → 中性化（换主语，不删句）
 *
 * 用法：node tools/probe/g2-disinfect-apply.mjs [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')

const M = {
  // ─────────────────────────── plugin-platform · client ───────────────────────────
  'packages/plugin-platform/src/client/LeftPane.tsx': [
    ['（能力 C-1）', '', '④ C族'],
    ['用户会以为是自己出错（004 Q14）。', '用户会以为是自己出错。', '2 裁定术语'],
    ['就看得见（A-3）。', '就看得见。', '2 判据编号'],
    ['*   目的（星月 012 §4.1）：', '*   目的：', '1+3+4'],
    ['（2026-10-05 阿开提"一页预览"后加）', '（为"一页预览"后加）', '4 花名'],
    ['（2026-10-05 阿开："分组之间加条线"）：', '（"分组之间加条线"）：', '4 花名'],
    ['（2026-10-05 阿开说"左栏不如右栏清晰"后加）：', '（"左栏不如右栏清晰"反馈后加）：', '4 花名'],
    ['，004 Q14）', '）', '2 裁定术语'],
  ],
  'packages/plugin-platform/src/client/RightPane.tsx': [
    ['（能力 C-2）', '', '④ C族'],
    ['（阿开要的"一页预览"：折轮次过程）', '（"一页预览"：折轮次过程）', '4 花名'],
    ['// ★ A-3：一个执行方都没有', '// ★ 一个执行方都没有', '2 判据编号'],
    ['空场（A-3 的用户可见面）', '空场（用户可见面）', '2 判据编号'],
    ['（A-3）。接入执行方后本场景即可运行', '。接入执行方后本场景即可运行', '2 判据编号'],
    ['（2026-10-05 阿开提"一页预览"后加的，逐条对应契约）', '（为"一页预览"加的，逐条对应契约）', '4 花名'],
    ['① 默认折叠（阿开要的"一页预览"）；', '① 默认折叠（"一页预览"）；', '4 花名'],
    ['这正是阿开说的"信息量太大"。', '这正是"信息量太大"。', '4 花名'],
    ['（A-3 一等公民）', '（一等公民）', '2 判据编号'],
  ],
  'packages/plugin-platform/src/client/PlatformPanel.tsx': [
    ['（承 003 最后优化的"内侧竖栏"设计）', '（承"内侧竖栏"设计）', '1 件号'],
    ['*   003 的教训：面板可能被塞进很窄的挂载点', '*   早先的教训：面板可能被塞进很窄的挂载点', '1 件号'],
    [' —— 2026-10-05 阿开提"横向空间能不能还给内容"后加。', ' —— 为"横向空间还给内容"后加。', '4 花名'],
    ['（2026-10-05 阿开定：放标题栏要移鼠标）。', '（放标题栏要移鼠标）。', '4 花名'],
  ],
  'packages/plugin-platform/src/client/ErrorSurface.tsx': [
    ['（001-开发包 §4.2 / 契约 `errors.json` envelope）：', '（契约 `errors.json` envelope）：', '1+2'],
    ['（`007 §5.1` 原文：', '（契约原文：', '1 件号'],
  ],
  'packages/plugin-platform/src/client/bridge.ts': [
    ['（003 实测踩出来的，逐字照搬）', '（实测踩出来的，逐字照搬）', '1 件号'],
    ['003 实测过 ', '实测过 ', '1 件号'],
  ],
  'packages/plugin-platform/src/client/copy.ts': [
    ['001-客户端开发包-给阿舟-v1.0 §6.4「三条必须显示的约束」', '契约 §6.4「三条必须显示的约束」', '1+2+4'],
    ['*   001 开发包 §6.4，尚未进契约 ⇒ 由客户端本地持有', '*   该约定尚未进契约 ⇒ 由客户端本地持有', '1+2'],
  ],
  'packages/plugin-platform/src/client/host-modules.ts': [
    ['依据：003 `src/client/index.ts` 同名注释', '依据：`src/client/index.ts` 同名注释', '1 件号'],
    ['（003：漏 id ⇒ 整站白屏）', '（漏 id ⇒ 整站白屏）', '1 件号'],
  ],
  'packages/plugin-platform/src/client/index.ts': [
    ['（003 最贵的坑之一，D2）', '（最贵的坑之一）', '1+2'],
    ['*   003 当年把包名填进本文件的 inject', '*   早先把包名填进本文件的 inject', '1 件号'],
    ['面板必须成对注册（D3）', '面板必须成对注册', '2 判据编号'],
    ['list 座位漏 `id` ⇒ 整站白屏（D1）', 'list 座位漏 `id` ⇒ 整站白屏', '2 判据编号'],
    ['003 实测：`sidebar.session.row.leading` 漏 `id`', '实测：`sidebar.session.row.leading` 漏 `id`', '1 件号'],
  ],
  'packages/plugin-platform/src/client/live.ts': [
    ['（2026-10-05，样本存 `021-工坊来件-20261005/联调实测/scenes.json`）', '（2026-10-05）', '3 内部路径'],
    ['与 003 同款做法。', '同款做法。', '1 件号'],
    ['见 `030` 之后的收执件。', '见后续收执件。', '1 件号'],
  ],
  'packages/plugin-platform/src/client/mock/data.ts': [
    ['| **A-3**：`agentId === null`', '| `agentId === null`', '2 判据编号'],
    ['这是 A-3「场地零内置可跑」的用户可见面', '这是「场地零内置可跑」的用户可见面', '2 判据编号'],
    ["'★ A-3 的用户可见面：", "'★ 场地零内置可跑的用户可见面：", '2 判据编号'],
    ['（星月 012 §四 答复「**消费**」）', '（设计答复「**消费**」）', '1+3+4'],
  ],
  'packages/plugin-platform/src/client/run-reducer.ts': [
    ['（**不是错误态**，A-3 里这是正常状态）', '（**不是错误态**，这是正常状态）', '2 判据编号'],
    ['（这也是 004/星月要的"第三道闸门', '（这也是"第三道闸门', '1+3+4'],
  ],
  'packages/plugin-platform/src/client/theme.ts': [
    ['（2026-10-05 阿开："信息量太大、不够清晰"）：', '（"信息量太大、不够清晰"反馈）：', '4 花名'],
    ['（003 踩过）。', '（踩过）。', '1 件号'],
  ],
  'packages/plugin-platform/src/client/PlatformPanelIcon.tsx': [
    ['整站白屏（D1）。', '整站白屏。', '2 判据编号'],
  ],
  'packages/plugin-platform/src/client/panel-id.ts': [
    ['**必须是同一个值**（D3），', '**必须是同一个值**，', '2 判据编号'],
  ],
  'packages/plugin-platform/src/client/Intro.tsx': [
    ['（2026-10-05 阿开指出）。', '（设计评审指出）。', '4 花名'],
  ],
  // ─────────────────────────── plugin-platform · 根 src / remote ───────────────────────────
  'packages/plugin-platform/src/index.ts': [
    ['（004 §C · 架构级，不是"藏起来"）', '（架构级，不是"藏起来"）', '1+2'],
    ['不直连模型**（CN-5）', '不直连模型**', '2 判据编号'],
    ['直连服务端域名（C3）', '直连服务端域名', '2 判据编号'],
    ['不越受管根**（C4）', '不越受管根**', '2 判据编号'],
    ['* ★ CN-1：我方 Agent', '* ★ 我方 Agent', '2 判据编号'],
    ['//   003 的教训是反过来的', '//   教训是反过来的', '1 件号'],
  ],
  'packages/plugin-platform/src/remote/service.ts': [
    ['（承 003 `src/remote/service.ts` 的实测结论', '（承 `src/remote/service.ts` 的实测结论', '1 件号'],
    ['（003 同款"宽松签名"', '（同款"宽松签名"', '1 件号'],
  ],
  // ─────────────────────────── plugin-platform · patch / README ───────────────────────────
  'packages/plugin-platform/cordis.patch.yml': [
    ['# 语法（承 003 的实测约定）：', '# 语法（承实测约定）：', '1 件号'],
    ['# ⚠️ 禁用宿主插件行前必读（003 用血换来的）：', '# ⚠️ 禁用宿主插件行前必读：', '1 件号'],
    ['#   003 曾禁 `ui-workspace`', '#   曾禁 `ui-workspace`', '1 件号'],
    ['# C-1 场景/Agent 目录面', '# 场景/Agent 目录面', '④ C族'],
    ['# C-2 运行视图（逐灯 + 判定路由）', '# 运行视图（逐灯 + 判定路由）', '④ C族'],
    ['# C-7 能力边界页', '# 能力边界页', '④ C族'],
    ['# C-6 角色位', '# 角色位', '④ C族'],
  ],
  'packages/plugin-platform/README.md': [
    ['依据：`001-A §4.2`「', '依据：契约 §4.2「', '1 件号'],
    ['## 它承担的客户端能力（C-1…C-8 的落点）', '## 它承担的客户端能力', '④ C族'],
    [
      '| # | 能力 | 期 | 本包位置 |\n|:-:|:--|:-:|:--|\n| **C-1** | 总台（Agent 卡片 + 场景卡片） | P1 | `client/PlatformPanel.tsx` 左栏 |\n| **C-2** | 运行视图（逐灯 + 判定路由可见） | P1 | `client/PlatformPanel.tsx` 右栏 |\n| **C-6** | 角色位（执行 / 审计 / 管理，签名位不可改） | P2 | Step 4 拆子页 |\n| **C-7** | 能力边界页（`cannot` 段必须完整展示） | P2 | Step 4 拆子页 |\n| **C-8** | 自定义场景编辑（登记即生效，**不是等审批**） | P2 | Step 4 拆子页 |\n| **C-5** | 报告查看与本地验签 | P3 | Step 6+ |',
      '| 能力 | 期 | 本包位置 |\n|:--|:-:|:--|\n| 总台（Agent 卡片 + 场景卡片） | P1 | `client/PlatformPanel.tsx` 左栏 |\n| 运行视图（逐灯 + 判定路由可见） | P1 | `client/PlatformPanel.tsx` 右栏 |\n| 角色位（执行 / 审计 / 管理，签名位不可改） | P2 | Step 4 拆子页 |\n| 能力边界页（`cannot` 段必须完整展示） | P2 | Step 4 拆子页 |\n| 自定义场景编辑（登记即生效，**不是等审批**） | P2 | Step 4 拆子页 |\n| 报告查看与本地验签 | P3 | Step 6+ |',
      '④ C族 表头去列',
    ],
    ['★ **C-3 预约排期面板** 与 **C-4 外部 Agent 接入配置** 在 P2 加：', '★ **预约排期面板** 与 **外部 Agent 接入配置** 在 P2 加：', '④ C族'],
    [
      'C-4 **只做配置面板 + 状态镜像**（不代签、不持 `agent_secret`）—— 见 `../../../007-阿舟-契约工作基线…` §六.2 Q-A 裁决 (A)。',
      '外部 Agent 接入配置 **只做配置面板 + 状态镜像**（不代签、不持 `agent_secret`）。',
      '1+3 内部路径删句',
    ],
    ['## ★ 与智囊团插件的关系（A-1 / A-2 / A-3）', '## ★ 与智囊团插件的关系（三条约束）', '2 判据编号'],
    [
      '| 约束 | 含义 | 怎么验 |\n|:--|:--|:--|\n| **A-1** | 智囊团 = 独立插件；**删掉它，场地仍完整可用** | 静态：本包 `package.json` **不依赖** `@shanhai/kaipu-wisdom`；patch 各自独立 |\n| **A-2** | 两者**只通过接口通信** | 本包不 import 智囊团内部实现；智囊团也不 import 本包内部 |\n| **A-3** | **场地不内置任何"必须有的" Agent** | 零 Agent ⇒ 界面显「**待接入**」（`SceneLamp.agentId === null`），流程仍能走 |',
      '| 含义 | 怎么验 |\n|:--|:--|\n| 智囊团 = 独立插件；**删掉它，场地仍完整可用** | 静态：本包 `package.json` **不依赖** `@shanhai/kaipu-wisdom`；patch 各自独立 |\n| 两者**只通过接口通信** | 本包不 import 智囊团内部实现；智囊团也不 import 本包内部 |\n| **场地不内置任何"必须有的" Agent** | 零 Agent ⇒ 界面显「**待接入**」（`SceneLamp.agentId === null`），流程仍能走 |',
      '2 判据编号 表头去列',
    ],
    ['★ 这条不是洁癖：', '★ 上面这三条不是洁癖：', '承接上表'],
    ['（001-A §3.2）。', '。', '1 件号'],
    ['| **C-1** | 总台（Agent 卡片 + 场景卡片） | ✅ 左栏', '| **面板** | 总台（Agent 卡片 + 场景卡片） | ✅ 左栏', '④ C族'],
    ['| **C-2** | 运行视图（逐灯 + 判定路由可见） | ✅ 右栏', '| **面板** | 运行视图（逐灯 + 判定路由可见） | ✅ 右栏', '④ C族'],
    [
      '**还没做**：C-5 报告验签（P3）· C-3/C-4 预约与外部接入（P2）· C-6/C-7/C-8 三个子页（P2）· 接真服务端。',
      '**还没做**：报告验签（P3）· 预约与外部接入（P2）· 三个子页（P2）· 接真服务端。',
      '④ C族',
    ],
    ['这是 001-开发包 §4.2 的客户端纪律。', '这是既定的客户端纪律。', '1+2'],
    ['- **三条必须显示的约束**（001 §6.4）：', '- **三条必须显示的约束**：', '1 件号'],
    ['## 本包的三条硬边界（004 §C · 架构级）', '## 本包的三条硬边界（架构级）', '1+2'],
    ['1. **不持有模型 Key、不直连模型**（CN-5）', '1. **不持有模型 Key、不直连模型**', '2 判据编号'],
    ['2. **不绕过宿主统一适配层**直连服务端域名（C3）', '2. **不绕过宿主统一适配层**直连服务端域名', '2 判据编号'],
    ['3. **不越受管根**（C4）', '3. **不越受管根**', '2 判据编号'],
    ['外加 CN-1：**我方 Agent 的 skill', '外加一条：**我方 Agent 的 skill', '2 判据编号'],
    ['反而破坏 A-2。', '反而破坏上面的约束。', '2 判据编号'],
    ['只在这四个**触发条件**之一成立时才拆（承外部评审 `008` §三 留意 2）：', '只在这四个**触发条件**之一成立时才拆（承外部评审意见）：', '1 件号'],
    ['`contracts/v1.1/errors.json` → ', '', '3 指向排除面路径'],
  ],
  // ─────────────────────────── plugin-wisdom · client ───────────────────────────
  'packages/plugin-wisdom/src/client/WisdomPanel.tsx': [
    ['（`041 §〇` · 已确认）', '（已确认）', '1 件号'],
    ['（`041 §一` 设计稿 · 043 裁定可开工 4/5 区）', '（设计稿 · 可开工 4/5 区）', '1 件号'],
    ['（043 Q1 的落点）', '（状态带区分的落点）', '2 裁定术语'],
    ['（数据源未知 · 043 Q3=a）', '（数据源未知）', '2 裁定术语'],
    ['*   它是 A-3「场地零内置可跑」的**用户可见面**', '*   它是「场地零内置可跑」的**用户可见面**', '2 判据编号'],
    ['（阿开要看界面长什么样）', '（便于设计评审看界面）', '4 花名'],
    ['* ★★ 043 裁定「Q1=a，状态带内部区分已登记/未登记」的**唯一落点**。', '* ★★ 「状态带内部区分已登记/未登记」的**唯一落点**。', '2 裁定术语'],
    ['*   这是 A-3「场地零内置可跑」的**用户可见面**，现在实测', '*   这是「场地零内置可跑」的**用户可见面**，现在实测', '2 判据编号'],
    ['*   这也是 `041 §一·②` 立的关键纪律：', '*   这也是既定的关键纪律：', '1 件号'],
    ['*   这是 043 **Q1=a** 的保守面', '*   这是该裁定的保守面', '2 裁定术语'],
    ['* 取向（`041 §二`）：这是 A-3「场地零内置可跑」的正向表达', '* 取向：这是「场地零内置可跑」的正向表达', '1+2'],
    ['* 对齐 001-A 的定位：', '* 对齐总体定位：', '1 件号'],
    ['* ⚠️ **Q4 的纠结已按 043 落地**（Q4 归阿开拍，他选了', '* ⚠️ **Q4 的纠结已落地**（Q4 归发起人拍，选了', '2+4'],
    ['（这是 `041 §一·②` 许下的降级承诺：', '（这是已承诺的降级行为：', '1 件号'],
    ['④ 会商履历（⏸ 只占位 · 043 Q3=a）', '④ 会商履历（⏸ 只占位 · 数据源未知）', '2 裁定术语'],
    ['（`042` Q3：P1 清单里**找不到**跨场会商记录的读口；', '（P1 清单里**找不到**跨场会商记录的读口；', '1 件号'],
    ['**不 import 它的任何东西**（A-2）', '**不 import 它的任何东西**', '2 判据编号'],
  ],
  'packages/plugin-wisdom/src/client/bridge.ts': [
    ['但 A-2 明令两包**互不 import**', '但两包**互不 import**', '2 判据编号'],
    ['—— 两种结果都违反 A-1「摘掉智囊团，场地仍完整可用」。', '—— 两种结果都违反「摘掉智囊团，场地仍完整可用」。', '2 判据编号'],
    ['* **为什么 ② 是正解 —— 关键是把「A-2 管的是什么」读准**：', '* **为什么 ② 是正解 —— 关键是把「约束管的是什么」读准**：', '2 判据编号'],
    ['*   > A-2 的原文边界是「两包的 **client half 互不 import**」、', '*   > 约束的原文边界是「两包的 **client half 互不 import**」、', '2 判据编号'],
    ['⇒ A-2 完好。', '⇒ 约束完好。', '2 判据编号'],
    ['*   · 智囊团**依赖场地插件在场**（端点由它注册）。这与 A-1/A-3 冲突吗？', '*   · 智囊团**依赖场地插件在场**（端点由它注册）。这与上面的约束冲突吗？', '2 判据编号'],
    ['* **★★ A-1 / A-3 为什么不受影响（这一条最要紧，别读错）**：', '* **★★ 这两条约束为什么不受影响（这一条最要紧，别读错）**：', '2 判据编号'],
    ['*   · A-1 要求的是「**摘掉智囊团** ⇒ 场地仍完整可用」', '*   · 「可摘除」要求的是「**摘掉智囊团** ⇒ 场地仍完整可用」', '2 判据编号'],
    ['*   · A-3 要求的是「**场地**零内置可跑」', '*   · 「零内置」要求的是「**场地**零内置可跑」', '2 判据编号'],
    ['那是源码 import ⇒ A-2 FAIL。', '那是源码 import ⇒ 判据 FAIL。', '2 判据编号'],
    [
      '本项目里 404 有**两个来源**，别混（既有判定见\n    //   `005-083…/tools/probe/status-404-verdict.mjs` 与 `status-404-probe.mjs`）：',
      '本项目里 404 有**两个来源**，别混：',
      '3 内部路径删句',
    ],
  ],
  'packages/plugin-wisdom/src/client/index.ts': [
    ['*   两者**互不 import**（A-2）。', '*   两者**互不 import**。', '2 判据编号'],
    ['* ★ 两条 inject 是两套词表（D2）：', '* ★ 两条 inject 是两套词表：', '2 判据编号'],
    ['* ★ 面板成对注册（D3）：', '* ★ 面板成对注册：', '2 判据编号'],
    ['* ★ list 座位**必须给 `id`**（D1）：', '* ★ list 座位**必须给 `id`**：', '2 判据编号'],
    ['那是**源码 import** ⇒ A-2 判据 FAIL。', '那是**源码 import** ⇒ 判据 FAIL。', '2 判据编号'],
    ['*     这是 003 踩过的 D2 坑：', '*     这是踩过的坑：', '1+2'],
    ['// ★ 排在场地插件（order 30）之后 —— 场地是核心，智囊团可选（A-1/A-3）', '// ★ 排在场地插件（order 30）之后 —— 场地是核心，智囊团可选', '2 判据编号'],
  ],
  'packages/plugin-wisdom/src/client/live.ts': [
    ['* （不 import，A-2）——', '* （不 import）——', '2 判据编号'],
    ['（`041 §〇` 已否掉）。', '（已否掉）。', '1 件号'],
    ['（这是 043 裁定的落点）：', '（这是裁定的落点）：', '2 裁定术语'],
    ['* ★★ **043 裁定 Q1=a 的准确读法**', '* ★★ **状态带区分的准确读法**', '2 裁定术语'],
    ['六、★ 状态带汇总 —— 043 Q1 裁定的**唯一落点**', '六、★ 状态带汇总 —— 裁定的**唯一落点**', '2 裁定术语'],
    ['它是 043 裁定「状态带内部区分已登记/未登记」的**全部意义**。', '它是「状态带内部区分已登记/未登记」的**全部意义**。', '2 裁定术语'],
    ['因为它是 043 Q1 裁定的**可断言面**。', '因为它是该裁定的**可断言面**。', '2 裁定术语'],
    ['* · **OPEN-1 · `disabled` 的行文案**：043 只裁了 `pending`（Q1）。', '* · **`disabled` 的行文案**：本轮只裁了 `pending`。', '2 判据编号'],
    ['* · **OPEN-2 · 同名灯位跨场景配不同 agentId**：', '* · **同名灯位跨场景配不同 agentId**：', '2 判据编号'],
    ['* · **OPEN-3 · Q2（5 条灯是否共享同一 host Agent）**：★★ 待星月一句话。', '* · **Q2（5 条灯是否共享同一 host Agent）**：★★ 待服务端一句话。', '2+3+4'],
    ['（这正是 `041 §一·②` 许下的降级承诺）。', '（这正是已承诺的降级行为）。', '1 件号'],
  ],
  'packages/plugin-wisdom/src/client/theme.ts': [
    ['而 A-2 明令两包', '而两包', '2 判据编号'],
    ['* ⇒ 三条路，只有第三条能走（`041 §四 Q5`）：', '* ⇒ 三条路，只有第三条能走：', '1 件号'],
    ['| ❌ **破坏 A-1/A-2**（判据当场 FAIL） |', '| ❌ **破坏上述约束**（判据当场 FAIL） |', '2 判据编号'],
    ['而契约包是**与星月共管的产物**', '而契约包是**与服务端共管的产物**', '4 花名'],
    ['⇒ 列成 `Q5` 请阿开拍。', '⇒ 列成 `Q5` 请发起人拍。', '4 花名'],
  ],
  'packages/plugin-wisdom/src/client/WisdomPanelIcon.tsx': [
    ['整站白屏（D1）。', '整站白屏。', '2 判据编号'],
  ],
  // ─────────────────────────── plugin-wisdom · 根 src / patch / README ───────────────────────────
  'packages/plugin-wisdom/src/index.ts': [
    ['* ★ 定位（001-A §3.1）：', '* ★ 定位：', '1 件号'],
    ['* ★ 两种姿态（必须分开，001-A §3.3）：', '* ★ 两种姿态（必须分开）：', '1 件号'],
    ['*    那些只在服务端（CN-1 / N-1）。', '*    那些只在服务端。', '2 判据编号'],
  ],
  'packages/plugin-wisdom/cordis.patch.yml': [
    ['# ★★ 本文件是 A-1 判据的一半：', '# ★★ 本文件是「可摘除」约束的一半：', '2 判据编号'],
    ['#   Agent、能出审计流程（INV-17 / AC-26）。', '#   Agent、能出审计流程。', '2 判据编号'],
    ['与场地通信（A-2）', '与场地通信', '2 判据编号'],
    ['# ★ 命名：`expertTeam` → `wisdomTeam` 属 N-1「智囊团命名是否成立」（归五人众评审），', '# ★ 命名：`expertTeam` → `wisdomTeam` 待评审组定，', '2+4'],
    ['灯位可被顶替（001-A §3.3）。', '灯位可被顶替。', '1 件号'],
  ],
  'packages/plugin-wisdom/README.md': [
    ['⚠️ **命名归五人众评审（N-1），尚未定**；', '⚠️ **命名待评审组定**；', '2+4'],
    ['## ★★ A-1 判据（本包能不能被摘掉）', '## ★★ 「可摘除」约束（本包能不能被摘掉）', '2 判据编号'],
    ['（**CN-1** —— 那些只在服务端）', '（那些只在服务端）', '2 判据编号'],
    ['- ❌ 判据 / 规则库全文（**CN-2**）', '- ❌ 判据 / 规则库全文', '2 判据编号'],
    ['`node ../../tools/check-decoupling.mjs`', '配套解耦检查脚本', '3 指向排除面路径'],
  ],
}

// ─────────────────────────── 应用 ───────────────────────────
/**
 * ★★ 第二轮（R2）：我独立复算发现的**两类工坊口径未覆盖**的问题
 *   A. 内部痕迹出现在**压舱件**（package.json / tsconfig / pnpm-*.yaml）—— 不在工坊 32 件扫描面内
 *   B. **指向排除面的引用**（`tools/**`、`contracts/**`）—— 5 条正则都抓不到，
 *      但公开仓里这些路径**不存在**（`053 §五` 明确排除），且 `tools/` 是**判据库**、
 *      `contracts/` 是**我方契约全表** —— 古茶判据 3 明令「判据库不在公开面」。
 *   C. 修一处 v1 消毒**自己引入的语义破损**（copy.ts 跨行替换把句子截断）。
 */
const M_RELEASE = {
  // ── C. 修破损
  'packages/plugin-platform/src/client/copy.ts': [
    ['★★ 为什么放在客户端、而不是 `contracts/v1.1/`：', '★★ 为什么放在客户端、而不是契约层：', '3 内部路径'],
    [
      '契约的改动要**提差异单**（本仓纪律：不单方改契约）。这三句目前只出现在\n *   该约定尚未进契约 ⇒ 由客户端本地持有，并在注释里标明出处。',
      '契约的改动要**提差异单**（本仓纪律：不单方改契约）。这三句目前尚未进契约\n *   ⇒ 由客户端本地持有，并在注释里标明出处。',
      '★ 修 v1 破损：句子被截断（原意"只出现在 001 开发包 §6.4，尚未进契约"）',
    ],
  ],
  // ── A. 压舱件里的内部痕迹
  'package.json': [
    ['"description": "山海·开铺（083）· 插件仓', '"description": "山海·开铺 · 插件仓', '1 件号'],
  ],
  'packages/plugin-platform/tsconfig.client.json': [
    [
      'tools/build-client.mjs 只需把相对 require 改指到同 bundle 内的局部变量，**不需要任何 ESM→CJS 的语法改写**（003 那份手写 ESM 改写器是这里最大的脆弱点）。',
      '配套的打包脚本只需把相对 require 改指到同 bundle 内的局部变量，**不需要任何 ESM→CJS 的语法改写**（手写的 ESM 改写器是这里最大的脆弱点）。',
      '1 件号 + 3 内部路径',
    ],
  ],
  'packages/plugin-wisdom/tsconfig.client.json': [
    ['让 tools/build-client.mjs 只需改相对 require 的目标，无需语法改写。', '让配套的打包脚本只需改相对 require 的目标，无需语法改写。', '3 内部路径'],
  ],
  'tsconfig.base.json': [
    ['"//lib": "★ 003 的教训：host 侧 tsconfig', '"//lib": "★ 实测教训：host 侧 tsconfig', '1 件号'],
  ],
  'packages/plugin-wisdom/package.json': [
    ['卸掉它，场地仍完整可用（A-1）。当前为骨架版。', '卸掉它，场地仍完整可用。当前为骨架版。', '2 判据编号'],
    ['填反了会卡在 waiting for services（D2）。', '填反了会卡在 waiting for services。', '2 判据编号'],
  ],
  'packages/plugin-platform/package.json': [
    ['—— check-market-ready.mjs --release 缺它即 FAIL。', '—— 缺少它会在发布前检查中被判 FAIL。', '3 内部路径'],
  ],
  'pnpm-workspace.yaml': [
    [
      '# ★ 为什么用 pnpm：003 的实测结论（见 skill `windows-node-monorepo-build`）——\n#   · 本机 **pnpm 11.7.0 不创建任何 symlink**，必须用 **pnpm@10.18.3**\n#     （装在项目外的独立目录，加进 PATH 最前）；\n#   · 且 install 阶段必须 `unset NODE_OPTIONS` —— 宿主注入的 node-language-shim.cjs\n#     会让 pnpm 建软链**静默失败**（最小项目对照：3m13s → 1.2s）。',
      '# ★ 依赖安装请固定 pnpm 版本（本仓在 pnpm@10.18.3 下验证通过）。',
      '1 件号 + 内部 skill 名 + 本机环境细节',
    ],
  ],
  '.gitignore': [
    [
      '# ★ 开发用 DSH_HOME 与浏览器 profile（由 tools/setup-dev-profile.mjs 生成）\n#   里面有 DSH 写的 sessions / storages / 浏览器缓存 —— **不进仓**，\n#   需要时一条命令重建：node tools/setup-dev-profile.mjs',
      '# ★ 开发用的本地 DSH_HOME 与浏览器 profile（本地生成，不进仓）',
      '3 内部路径删句',
    ],
  ],
  // ── B. 指向排除面的引用（src 注释中性化）
  'packages/plugin-platform/src/client/RightPane.tsx': [
    ['（对准契约原文，见 `tools/probe/run-view-probe.mjs`）。', '（对准契约原文）。', '3 内部路径'],
  ],
  'packages/plugin-platform/src/client/bridge.ts': [
    ['*   `tools/check-remote-bridge.mjs` 直接扫**编译产物**，比对命名空间与端点名，', '*   配套的桥接检查脚本直接扫**编译产物**，比对命名空间与端点名，', '3 内部路径'],
  ],
  'packages/plugin-platform/src/client/mock/data.ts': [
    ['（契约包的运行时值会被内联进 bundle，见 `tools/build-client.mjs` §1b。）', '（契约包的运行时值会被内联进 bundle。）', '3 内部路径'],
    ['形状照抄契约 `contracts/v1.1/errors.json` 的 `detailShape` 字段：', '形状照抄契约的 `detailShape` 字段：', '3 内部路径'],
  ],
  'packages/plugin-platform/src/remote/dsh-typert.d.ts': [
    ['若上游改了这两个签名，`tools/check-remote-bridge.mjs` 会在', '若上游改了这两个签名，配套的桥接检查脚本会在', '3 内部路径'],
    ['`tools/check-remote-bridge.mjs`（它直接扫编译产物）。', '配套的桥接检查脚本（它直接扫编译产物）。', '3 内部路径'],
  ],
  'packages/plugin-platform/src/remote/service.ts': [
    ['这样判据也能直接 import 它来喂帧断言（见 tools/probe/sse-frame-probe.mjs）。', '这样判据也能直接 import 它来喂帧断言（由配套探针脚本）。', '3 内部路径'],
    ['这条由 tools/check-remote-bridge.mjs 看护。', '这条由配套的桥接检查脚本看护。', '3 内部路径'],
    ['* ⇒ 两端各写一份 + **判据强制一致**：`tools/check-remote-bridge.mjs`', '* ⇒ 两端各写一份 + **判据强制一致**（配套的桥接检查脚本）', '3 内部路径'],
  ],
  'packages/plugin-platform/src/remote/sse-frame.ts': [
    ['于是**判据可以直接 import 编译产物来喂帧**（见 `tools/probe/sse-frame-probe.mjs`）。', '于是**判据可以直接 import 编译产物来喂帧**（由配套探针脚本）。', '3 内部路径'],
  ],
  'packages/plugin-platform/cordis.patch.yml': [
    ['#   联调地址写在 **dev profile 的覆盖层**里（`tools/plugin.mjs` 的 sync 生成，', '#   联调地址写在 **dev profile 的覆盖层**里（由开发配置脚本生成，', '3 内部路径'],
    ['#   想改地址/铺子：`KAIPU_BASE_URL=… KAIPU_ACCOUNT=… node tools/setup-dev-profile.mjs`', '#   想改地址/铺子：改 dev profile 的 `KAIPU_BASE_URL` / `KAIPU_ACCOUNT`', '3 内部路径'],
    ['#   想验"未接入模式"：`KAIPU_DISCONNECT=1 node tools/setup-dev-profile.mjs`', '#   想验"未接入模式"：在 dev profile 里设 `KAIPU_DISCONNECT=1`', '3 内部路径'],
  ],
  'packages/plugin-wisdom/src/client/bridge.ts': [
    ['* （`tools/check-decoupling.mjs` 会 FAIL）。那数据从哪来？三条路：', '* （解耦判据会 FAIL）。那数据从哪来？三条路：', '3 内部路径'],
    ['⇒ 靠 `tools/check-remote-bridge.mjs` 的 D 组**扩到三处对账**看护（已改）。', '⇒ 靠配套的桥接检查脚本 D 组**扩到三处对账**看护（已改）。', '3 内部路径'],
    ['由 `tools/check-remote-bridge.mjs` 比对两处的 `REMOTE_NS` / `REMOTE_CHANNEL` 常量值。', '由配套的桥接检查脚本比对两处的 `REMOTE_NS` / `REMOTE_CHANNEL` 常量值。', '3 内部路径'],
    ['这正是 `check-remote-bridge.mjs` 的 D 组。', '这正是配套的桥接检查脚本的 D 组。', '3 内部路径'],
  ],
  'packages/plugin-wisdom/src/client/index.ts': [
    ['由 `tools/check-remote-bridge.mjs` 的 A 组比对 `REMOTE_NS` / `REMOTE_CHANNEL` 常量。', '由配套的桥接检查脚本的 A 组比对 `REMOTE_NS` / `REMOTE_CHANNEL` 常量。', '3 内部路径'],
  ],
  'packages/plugin-wisdom/src/client/live.ts': [
    ['（判据会喂构造样本，见 `tools/probe/wisdom-panel-probe.mjs`）。', '（判据会喂构造样本）。', '3 内部路径'],
  ],
  'packages/plugin-wisdom/src/client/theme.ts': [
    ['**互不 import**（`tools/check-decoupling.mjs` 会 FAIL）。', '**互不 import**（解耦判据会 FAIL）。', '3 内部路径'],
    [
      '（`contracts/v1.1/*.json`\n * 有生成链，`gen-contract.mjs --check` 看护）⇒ 这属于**架构调整**，',
      '（有生成链看护）⇒ 这属于**架构调整**，',
      '3 内部路径',
    ],
    ['并跑 `node tools/check-theme-tokens.mjs`（判据，见下）。', '并跑配套的主题令牌判据（见下）。', '3 内部路径'],
    ['这不是"抄得像"，是**逐字等价**，由 `tools/check-theme-tokens.mjs` 强制。', '这不是"抄得像"，是**逐字等价**，由配套的主题令牌判据强制。', '3 内部路径'],
  ],
}

const R2 = process.argv.includes('--r2')
const TABLE = R2 ? M_RELEASE : M

let ok = 0
let miss = 0
const report = []

for (const [file, rules] of Object.entries(TABLE)) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    report.push(`✗ 读不到 ${file} :: ${e.code}`)
    miss += rules.length
    continue
  }
  const orig = text
  for (const [oldS, newS, why] of rules) {
    const n = text.split(oldS).length - 1
    if (n === 0) {
      report.push(`✗ 未命中  ${file}\n     old: ${JSON.stringify(oldS.slice(0, 90))}`)
      miss++
      continue
    }
    if (n > 1) {
      report.push(`⚠ 命中 ${n} 次（期望 1）  ${file}\n     old: ${JSON.stringify(oldS.slice(0, 90))}`)
    }
    text = text.split(oldS).join(newS)
    ok++
  }
  if (text !== orig) {
    if (APPLY) writeFileSync(file, text, 'utf8')
  }
}

console.log(report.join('\n'))
console.log('')
console.log(`✅ 成功 ${ok} 处 ｜ ✗ 失败 ${miss} 处 ｜ 涉及 ${Object.keys(TABLE).length} 个文件`)
console.log(`阶段：${R2 ? '★ 第二轮（压舱件 + 排除面引用 + 修 v1 破损）' : '第一轮（工坊 34 件口径）'}`)
console.log(APPLY ? '★ 已写入磁盘' : '（dry-run：未写盘；加 --apply 落地）')
