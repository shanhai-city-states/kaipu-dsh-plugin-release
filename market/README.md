# `market/` —— DSH 插件市场投稿件

> 这里的每一份 `.yml` 都是要**原样丢进上游仓库**的文件。
> 生成与校验：`node tools/market-entry.mjs` ／ `node tools/market-entry.mjs --check`

## 一、市场没有上传入口

`dsh-market` 读的是一份目录 JSON（`plugins.json`），而目录由
[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
仓库构建。收录方式只有一个：

> **提一个 PR，只加一个文件** —— `data/plugins/<slug>.yml`。

上游 `scripts/lib/entries.mjs` 的注释写明了为什么是"一条一个文件"：
原来所有条目都追加在 README 的同一个锚点，每次提交都冲突；
一文件一条，"两次提交永远不会碰同一个文件"。

## 二、提交步骤

**★ 仓库身份（2026-10-05 星月 `009` 定；**2026-10-08 更正**）**：投稿对象是**公开仓**
`shanhai-city-states/kaipu-dsh-plugin-release`（2026-10-06 建，**Public**）。
开发仓 `shanhai-city-states/kaipu-dsh-plugin`（Private）**不是投稿对象** —— 上游 CI 会从条目
`url` 抓 `package.json` 读 `dsh.bundle`，私有仓公开取不到；`url` 同时是给用户点的链接。
默认值已写进 `tools/market-entry.mjs`，**平时不用再传环境变量**。

### ⚠️ 前置门槛：仓库已 Public，但 **Release 还没发**

| 项 | 状态 |
|:--|:--|
| 公开仓存在、`dsh.bundle` 公开可取 | ✅ 2026-10-08 核实（两个子包都声明了，topic `dsh-plugin` 也在） |
| 条目 `tarball:` 指向的那个 Release | ❌ **尚未创建**（`releases` 为空）⇒ 安装命令会 404 |

⇒ **别在这个状态下提 PR**：CI 会过，但用户点"一键安装"会 404。

### 完整动作（顺序不能反）

```bash
# 0) 先把公开面刷成最新（本脚本只复制 + 自检，不做任何 git 操作；推仓人工确认后单独执行）
node tools/emit-release-snapshot.mjs <空的目标目录>

# 1) 生成 / 刷新投稿件
node tools/market-entry.mjs
node tools/market-entry.mjs --check

# 2) 发预构建资产（资产名必须与 tarball URL 逐字一致）
KAIPU_PNPM=<pnpm.cjs 路径> node tools/pack-release.mjs
#    ★ 本仓 origin 是**私有开发仓**，gh 必须显式指向公开仓：
gh release create v0.1.0 dist/kaipu-platform.tgz dist/kaipu-wisdom-team.tgz \
  -R shanhai-city-states/kaipu-dsh-plugin-release

# 3) 验两个 URL 真能下（200 才算过）
curl -I https://github.com/shanhai-city-states/kaipu-dsh-plugin-release/releases/latest/download/kaipu-platform.tgz

# 4) 把 market/*.yml 复制进上游仓库的 data/plugins/ 下，提 PR
```

★ **顺序不能反**：第 2 步的资产必须先存在，否则市场给用户的安装命令会 404。

### License 口径（星月 009 §一 #2）

- `package.json` 写 `"license": "MIT"`，**暂不添加 `LICENSE` 文件**（审核看元数据）。
  ⇒ `check-market-ready.mjs` 对"无 LICENSE 文件"只报 **WARN**，不 FAIL。
- ⚠️ **保留开关（星月方拍板项）**：若最终决定**不允许商用**，改
  `"license": "UNLICENSED"` + `"private": true`，并重跑 `check-market-ready.mjs`。


## 三、官方规则（本仓已逐条实现为断言）

来源：上游 `scripts/lib/entries.mjs` 的 `validateEntries` / `slugFor` / `tarballProblem`，
以及 `scripts/probe-npm.mjs` 的 npm 归属判定。**逐字抄的，不是猜的。**

| # | 规则 | 违反后果 |
|:-:|:--|:--|
| 1 | 条目**只能有 5 个键**：`url` / `name` / `category` / `description` / `tarball` | 多一个键 ⇒ 校验失败 |
| 2 | `url` 必须是 `https://github.com/owner/repo[／tree/ref/子目录]` | 校验失败 |
| 3 | **文件名 = url 的 slug**（`o__r--packages-x.yml`） | 校验失败 |
| 4 | `name` 必填；**若写成 `owner/repo` 形态，必须与 url 指向的仓库一致** | 校验失败（上游抓过 6 个"标签与链接指向不同仓库"的条目） |
| 5 | `category` 必须是**闭集** 23 个之一（`workflow` / `tools` / …） | 校验失败 |
| 6 | `description.en` 必填、**单行**；只渲染 `en` / `zh` 两种 | 校验失败 |
| 7 | `tarball` 必须是 https、**GitHub 自家** release 资产、`.tgz` / `.tar.gz` 结尾 | 校验失败 |
| 8 | ★ **npm 包名不在条目里声明** —— 上游 `probe-npm.mjs` 会去读你仓库根的 `package.json`，**只有包自己的 `repository` 指向被收录的仓库**时才自动填 npm 映射 | 映射不上 ⇒ 用户只能走 tarball/github 路线 |
| 9 | 一个 url 不能收录两条 | 校验失败 |

## 四、两条本仓自己立的纪律

**① 一律给 `description` 的值加引号。**
上游点名过最常见的坏法：`en: Foo bar: baz` —— 未加引号的标量里出现 `": "`
会被 YAML 当成映射，报错信息还指不到真凶。本仓的写出端一律加引号，
**读回端也会主动拒绝**"未加引号却含 `": "`"的值，不让假信心过关。

**② 资产名不带版本号，且由 `SPECS` 说了算。**
写的是 `.../releases/latest/download/kaipu-platform.tgz`。
好处：下次发版**不必改投稿件**（上游有个 `probe-tarballs.mjs` 会把 404 的 tarball 丢掉并回退到 `github:` 命令）。
代价：每次发版要**用同一个资产名覆盖上传**（`gh release upload ... --clobber`）。
`tools/pack-release.mjs` 负责把 `pnpm pack` 的产物改成这个资产名 —— 手改最容易错一个字，
而**错了以后投稿件看起来完全正常**，只有用户点安装才会 404。

## 五、本地预览（不联网也能看到卡片长什么样）

`dev/market-preview/` 能起一份"真实市场界面 + 我们两条条目"的预览：
市场支持用 `DSHM_REGISTRY_URL` 整个替换目录源，所以本地起个静态服务指过去就行。
其条目内容**由 `tools/market-entry.mjs` 派生** —— 预览与将要提的 PR 不可能分叉。
