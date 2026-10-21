# MCP 接入（5 分钟）

> 给**不用 DSH（DeepSeek Harness）**的 Agent 一个入口：Claude Code / Codex / Cursor / 自研脚本都能直接接工位。
> 只走 **stdio**，不监听任何端口 —— MCP 客户端拉起子进程即可。

---

## 一、等你需要的三样东西

| 东西 | 从哪拿 |
|:--|:--|
| **铺号**（`p-xxxxxxxxxxxx`） | 铺主面板 → 资料 → 高级 |
| **Agent ID**（如 `my_agent`） | 铺主在「工位」里注册 Agent 时填的名字 |
| **agentSecret** | 注册 Agent 时**只显示一次**，请立刻存好 |

存到 `~/.kai-pu/agent.json`：

```json
{
  "base": "https://agent.ak2029.com/kai-pu",
  "accountId": "p-xxxxxxxxxxxx",
  "agentId": "my_agent",
  "secret": "<agentSecret>"
}
```

```bash
chmod 600 ~/.kai-pu/agent.json
```

> ⚠️ `secret` 是 Agent 的**身份**。不要提交进 git，不要贴群里。
> 用环境变量也行：`KAI_PU_BASE` / `KAI_PU_ACCOUNT` / `KAI_PU_AGENT` / `KAI_PU_SECRET`（环境变量优先）。

---

## 二、配到 MCP 客户端

**Claude Code / Codex / Cursor**（`mcpServers` 段）：

```json
{
  "mcpServers": {
    "shanhai-kaipu": {
      "command": "python3",
      "args": ["/绝对路径/到/server.py"]
    }
  }
}
```

依赖：`pip install mcp`（Python MCP SDK）。

---

## 三、先自检，再干活

装完先让 Agent 调一次 **`kaipu_whoami`**：

```
我是谁：当前配置的铺子 / Agent / 端点，以及服务端是否可达。
```

- ✅ 返回铺号 + Agent 名 + `reachable: true` ⇒ 通了
- ❌ 报错 ⇒ 90% 是 `base` 或凭据写错（先看 `base` 有没有漏 `/kai-pu`）

**判活口诀**：`curl -s <base>/health` 必须看到 `"service": "shanhai-kai-pu"`。
看到 `agent-api` ⇒ base 少了 `/kai-pu`，那是另一个服务。

---

## 四、然后就能干什么

| 工具 | 做什么 |
|:--|:--|
| `kaipu_whoami` | 自检：铺号 / Agent / 端点 / 服务端是否可达 |
| `kaipu_heartbeat` | 报「我在线」（建议 30 秒一次；90 秒没心跳就显示离线） |
| `kaipu_poll` | **领活**：有活就领一条回来，没有返回 `null`；payload 里可能带 `guidance`（服务端下发的做法，照它做） |
| `kaipu_upload` | 把文本传进资料区（Markdown / JSON / CSV）——资料按位存 `<铺>/<座位>/<交互ID>/` |
| `kaipu_submit` | **交活**：要么带 `interaction_id` + `filenames` 指向真传上来的文件，要么 `detail` 写够 100 字（服务端硬校验，绕不过） |

**典型一条活**：`kaipu_poll` 领 → 干活 → `kaipu_upload` 传结果 → `kaipu_submit` 交。

---

## 五、常见坑

| 现象 | 原因 | 怎么办 |
|:--|:--|:--|
| `401` | secret 错 / 不是这个铺的 | 用 `kaipu_whoami` 看是不是铺号填错 |
| `403 device_join_required` | ✅ 这不是 MCP 的问题 —— 那是**人**走设备令牌的接口 | MCP 用 HMAC，不需要加入码 |
| `404` / 返回 HTML | `base` 漏了 `/kai-pu` | 补上 |
| `403` 且 `curl -I` | Nginx 只放 GET | 判活用 `curl -s -o /dev/null -w "%{http_code}"` |

---

*山海 · 开铺 · 2026-10*
