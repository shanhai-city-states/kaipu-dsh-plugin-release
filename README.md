# 山海 · 开铺

> **Kai Pu — an audit workspace plugin for DSH.**

**山海·开铺** 是一套 **DSH（DeepSeek Harness）插件**，为「多 Agent 会商 + 审计留痕」这类场景提供**场地能力**。

> 本仓为「开铺」插件的**源码仓** —— 供 DSH 插件市场收录与源码查阅。

它做的是**场地**该做的事：把台子搭好、把流程跑通、把每一轮的痕迹留下。至于谁上台、按什么规矩审 —— **由你来定**。

---

## 这是什么

| 项 | 说明 |
|:--|:--|
| **形态** | DSH 插件（两个包） |
| **定位** | 审计**场地** —— 提供场景与 Agent 目录、运行视图、角色位、能力边界、会商面板 |
| **不预设执行方** | 场地自身不带任何执行方；一个都没接入时，界面显示「待接入」，场地**依然可用** |
| **可自带** | 你可以接入自己的 Agent 来使用场地 |
| **所需 DSH 版本** | `>=0.2.0-rc.2 <0.3.0`（见各包 `package.json` 的 `kaipu.dshRange`） |

---

## 安装

**两个包：**

| 包 | 作用 | 必需性 |
|:--|:--|:--|
| **`@shanhai/kaipu-platform`** | **场地能力**：场景 / Agent 目录面 · 运行视图（逐灯 + 判定路由）· 角色位 · 能力边界页 | **必需** |
| **`@shanhai/kaipu-wisdom-team`** | **内置会商组织**：没带自己的 Agent 时开箱即用的样例组织 | **可选 · 可单独摘除** |

```bash
# 安装（把 <your-profile> 换成你的 profile 名）
dsh plugin --profile <your-profile> add @shanhai/kaipu-platform
dsh plugin --profile <your-profile> add @shanhai/kaipu-wisdom-team

# 核对已装
dsh plugin --profile <your-profile> list
```

> **⚠️ 桌面端（Electron）profile 由应用独占** —— 普通 CLI 装不进去。
> 若你用的是 DSH 桌面端：**先启动一次桌面端让它初始化 profile，再完全退出**，然后由桌面端自带的 CLI 安装。

> **两个包相互独立**：`@shanhai/kaipu-wisdom-team` 可以单独摘掉，场地仍完整可用。

---

## 怎么用

> **当前版本为骨架版**：界面与流程可完整体验，数据接入在后续版本（演示数据均在界面上明确标注）。
> 安装方式见上一节；包上架情况以 DSH 插件市场为准。

装上之后，场地即可使用。默认是**未接入状态**（不连任何服务端）：

- 打开插件 → 看到场景与 Agent 目录（未接入时显示「待接入」）
- 发起一轮会商 → 看过程（逐灯进度、判定路由）→ 拿结果
- 任何一步服务端不可达时，场地**不崩、不阻塞**，退化为未接入状态并给出提示

**要把它接到你自己的服务端**，在你的本地 profile 覆盖层里配置即可（覆盖层不进本仓）。
可配置的键有 `baseUrl`（服务端地址）与 `accountId`（账号标识），也可用环境变量
`KAIPU_BASE_URL` / `KAIPU_ACCOUNT`；键的完整形状见 `packages/plugin-platform/cordis.patch.yml`。

---

## 能做什么 / 不能做什么

| ✅ 能做 | ❌ 不做 |
|:--|:--|
| 搭场地：场景目录、Agent 目录、角色位 | 不提供任何执行方（场地零内置可跑） |
| 跑流程：会商编排、逐灯进度、判定路由 | 不含判据库、阈值、业务规则 |
| 留痕迹：过程与结果的完整呈现 | 不含服务端实现与数据存储 |
| 接自己的 Agent 上场 | 不含计费与定价 |
| 服务端不可达时优雅降级 | 不改宿主（DSH）源码 |

> **「本仓是舞台的布景与走位，剧本与后台不在其中。」**
> —— 即：本仓只含**客户端界面与目录能力**，不含**服务端、判据库与业务规则**。
>
> *比喻给感受，落点给边界。*

---

## 目录结构

```
.
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── .gitignore
├── .gitattributes
└── packages/
    ├── plugin-platform/      # 场地能力（必需）
    └── plugin-wisdom/        # 内置会商组织（可选 · 可单独摘除）
```

> 每个包内含 `package.json`、`cordis.patch.yml`、`locale/`、`icon.svg` 与 `src/`。

---

## 本仓的纪律

- **零宿主改动** —— 只用上游自带的 patch 语法与座位，不改 DSH 源码 ⇒ 插件可独立分发。
- **错误不直出** —— 任何错误按 `code` 翻译成用户语言；原始错误码不印给用户。
- **未接入可用** —— 服务端不可达时退化为未接入模式，不崩、不阻塞。

---

## 二、补 · 依赖解析的两条留意

> 本节的由来：源码里引用「根 README §二·补 留意1」处（`src/remote/service.ts`），
> 说明依赖解析有一处**不明显但会致命**的约束。此处补全，供后续维护与复核对照。

### 留意 1 · 契约层是**构建期**依赖，不随用户机

`@shanhai/kaipu-contract` 是**构建期**依赖，**不在用户机上**。

- **host half 不经打包**（tsc 直出 `lib/index.js`），它的裸 `import` 必须能在**用户机的 profile** 里解析得到；
- ⇒ 若 host half 直接 `import` 契约层 ⇒ 发布出去就是一条**解析不到的裸 import**（用户端直接挂）；
- ⇒ 因此 host half **只 `import type`**（类型会被 tsc 擦除，不产生运行时依赖）；
- **运行时值**（错误翻译、常量表等）留在 **client half** —— client bundle 打包时已把契约层内联。

**判据**：改 host half 的 import 时，只允许 `import type`；任何运行时值一律走 client half。

### 留意 2 · 契约包**不参与依赖解析**（故 `pnpm install` 可直接通过）

`@shanhai/kaipu-contract` 是**内部契约包，不随本仓发布**。它以**人读字段**声明在
两包的 `kaipu.devContract` 里（见各 `package.json`），**不放进 `devDependencies`**。

⇒ 因此 `pnpm install` **不会**去解析这个不存在的包，装依赖**直接通过**。

**为什么不放进依赖表**：放进去会让全仓 `pnpm install` 以
`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` 硬失败 —— 而读者手上并没有这个内部包。
放在 `kaipu.*` 人读字段里，边界**看得见**（读者知道有这么个内部契约包存在），
但**不参与解析**（不阻塞安装）。产物里相关代码早已内联，运行时也不需要它。

---

## 许可

MIT

---

## 反馈

Issues / PR 欢迎。若你把它接到了自己的服务端，也欢迎告诉我们你用它跑了什么场景。

---

<sub>山海城邦 · Shanhai City-States</sub>
