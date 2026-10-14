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

**只有骨架**：结构上可摘除（静态证据齐）。面板成对注册已就位；轮次时间线 / 状态 / 跳转门 / 浏览器入口在后续版本补全（由服务端契约定稿后接入）。

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
