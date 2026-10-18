# @shanhai/kaipu-workstation · 工位插件

> ★ **可单独装 / 可不装。** 卸掉它，场地仍完整可用 —— 这是本包存在的**前提**，不是附加条件。

## 它是什么

工位插件是场地插件（plugin-platform）的配套**操作台面板**：轮次时间线、状态、跳转门，以及对外协作方的浏览器入口。它本身不持有场地数据 —— 数据 / 状态 / API 在服务端，本包只是「工位」的客户端面，通过契约（`@shanhai/kaipu-contract`）与服务端通信。

## ★★ 「可摘除」约束（本包能不能被摘掉）

| 判据 | 怎么验 | 当前 |
|:--|:--|:-:|
| `@shanhai/kaipu-platform` **不依赖**本包 | 查 platform 的 `package.json` dependencies | ✅ |
| 本包**不往场地插件的座位里塞东西** | 两个 client half 的 `slots.register` 各自独立 | ✅ |
| 摘掉本包目录 + patch 段 ⇒ 场地仍完整 | `tools/check-decoupling.mjs`（含 **工位↔场地** / **工位↔智囊团** 两组依赖与 import 检查） | ✅ |

## 面板注册纪律（本项目约定）

- **面板必须成对注册**：`sidebar.panellist(id)` == `main(key)` == `WORKSTATION_PANEL_ID`（唯一出处 `src/client/panel-id.ts`，两处不得手抄）。
- **`order` 取 40**：排在宿主内置项（0/10/20）与开铺（30）、凉亭（35）之后，**36–39 留空**给后人。
- **`label` 必须是函数**：直接传字符串在部分 cordis 版本会渲染成 `[object Object]`。
- **两套 inject 词表都要填**：`package.json` 的 `dsh.client.inject` 是【包名】词表（模块图边 / boot 顺序）；`src/client/index.ts` 的 `inject` 是【服务名】词表（`slots` / `connection`）。**填反了会卡在 waiting for services（白屏级）**。
- **面板注册六字段**（本仓约定，落 `package.json → kaipu.panel`，DSH 官方不读；机检 `tools/check-panel-registry.mjs`）：

| 字段 | 本包取值 | 口径 |
|:--|:--|:--|
| `panelId` | `shanhai-kaipu-workstation` | 与 `cordis.patch.yml` 的 `id`、`src/client/panel-id.ts` 的 `WORKSTATION_PANEL_ID` **三处同值** |
| `displayName` | `meta.title` | **只声明文案 key**，不写死文案（避免第三份副本）；`locale/*.json` 里才是文案本体 |
| `description` | `meta.description` | 同上 |
| `entryId` | `workstation` | **非 URL 的逻辑标识**（不含 `/` `#` `:`）；DSH 当前无 URL hash 路由 |
| `parent` | *（本期不填）* | 可选字段；不把内部架构代号写进发布面 |
| `siblings` | *（本期缺席）* | 待单源派生就位前**必须缺席**（宁缺不假） |

> ★ 「**门，不是传送带**」：六字段**只声明不驱动**，本包不新增任何自动跳转代码。

## 本包**不含**什么（重要）

- ❌ 我方服务端的 skill / memory / 内部 prompt（那些只在服务端）
- ❌ 判据 / 规则库全文
- ❌ 任何密钥

★ 本包只是「工位的客户端面」，不是「服务端能力的实现」。

## ★ 契约层不在本仓（给 clone 下来读/审的人）

**本仓可 `pnpm install` / 可读源码；完整 build 需配套契约层。**

源码里 `import … from '@shanhai/kaipu-contract'`（**本包只 import 类型**），而那个包不在本仓 —— 它是与受理侧共管的**构建期**依赖。
⇒ `pnpm install` 能过（本包刻意不把它声明为依赖）；
⇒ **完整构建**需要同级放一份契约包（`tsconfig.json` / `tsconfig.client.json` 的 `paths` 指向它）；
⇒ **用户机不需要它** —— 本包 client 侧只用类型（编译即擦除）。

完整说明见 `packages/plugin-platform/README.md` 的「契约层不在本仓」。

## 当前状态

**初始版本可用（渲染持久化态）**：结构上可摘除（静态证据齐），面板成对注册已就位；轮次时间线 / 状态面板 / 座位（含空位与邀请）/ 成员两栏 / 留痕 / 事件流底座均已渲染。

**数据源是显式五态，绝不悄悄回落到演示数据**：

| 值 | 含义 |
|:--|:--|
| `scaffold` | 初始化时的本地持久化态（诚实标非 live） |
| `live` | 读到了真实服务端 |
| `unreachable` | 想连真服务端但没连上（如实说） |
| `no_channel` | 连通道都没取到（环境问题，≠ 服务端故障） |
| `stale` | 通道在，但读不到工位数据 |

> 说「四态」时只指后四项（数据源态）；`scaffold` 是种子态。两者合称五态。

本期**不实时流**：真实服务端接入（`source='live'`）在后续版本完成；届时 fail-open 字段才由真实外发结果驱动。

## 字段与分发说明

`package.json` 关键字段含义：

| 字段 | 含义 |
|:--|:--|
| `main` / `types` | host half 的 ESM 产物与类型入口（`lib/index.js` / `lib/index.d.ts`） |
| `exports["./client"]` | client half 入口（被打包脚本内联进 bundle） |
| `exports["./cordis.patch.yml"]` | patch 层（可摘除约束的一半） |
| `exports["./locale/*.json"]` | 多语言文案 |
| `dsh.bundle.patch` | 声明本包的 patch 层文件 |
| `dsh.client.inject` | 【包名】词表（boot 顺序 / 模块图边） |
| `kaipu.*` | 本仓自有的声明块（DSH 官方不读；能力披露 / 契约标记） |
| `peerDependencies` | `react` 由宿主 DSH 提供；`@deepseek-ai/cordis` 为宿主运行时 |

## 版本记录

| 版本 | 日期 | 变更 |
|:--|:--|:--|
| `0.1.0` | 2026-10-18 | **技术清账轮**（版本号按纪律不升，待发布责任人统一升级）：数据源态类型收敛到契约单点（`SourceKind` 全仓一处定义）；座位汇总改「四数分账」并修正「已移除」归类；移除语义写死为「释放回空位池」；新增「座位为权威源」的一致性不变量；端点缺失判定改「结构化码优先 + 文案兜底」；邀请三态（含**已接受**）；成员列表 key 改用 `member.id`；留痕上限 50 条 + 展开全部；`now` 改为 60 秒自走；空位不再带在场态；删除未使用的 `VACANT` 导出；面板注册六字段落 `kaipu.panel`；新增三支判据脚本。 |
| `0.1.0` | 2026-10-09 | 初始版本：可摘除 + 面板成对注册 + 渲染工位本地持久化态。 |
