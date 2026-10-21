#!/usr/bin/env python3
"""开铺 · Agent MCP Server（stdio）

> 阿开 2026-10-19：「只要是符合长期主义方案的就干」
> 依据：`计划/018` V2.1 · 古茶拍板「禁止开公网裸端口」

## 这是什么

给**没有 DSH 的 Agent**（Claude Code / Codex / Cursor / 自研脚本）一个入口：
把工位的能力收敛成 MCP 工具，Agent 不需要知道 HTTP 细节。

## 三条长期主义约束（照古茶定案）

1. **只走 stdio**，不监听任何端口 —— MCP 客户端拉起子进程即可。
2. **一套后端**：所有工具都打 `kai-pu` 的既有端点，MCP **不算状态**。
3. **不共享 Key**：每个 Agent 用自己的 `agentSecret`（`~/.kai-pu/agent.json`）。

## 配置（环境变量优先，其次 `~/.kai-pu/agent.json`）

```
KAI_PU_BASE    https://agent.ak2029.com/kai-pu
KAI_PU_ACCOUNT p-xxxxxxxxxxxx   # 你的铺号（铺主面板可见）
KAI_PU_AGENT   ali_xingyue
KAI_PU_SECRET  <该铺签发的 agentSecret>
```

## 跑法

```bash
/usr/bin/python3 -m mcp.server            # 或 python3 ./server.py
```

Claude Code / Codex 配置示例（`mcpServers`）：

```json
{ "shanhai-kaipu": { "command": "/usr/bin/python3",
                     "args": ["/opt/.../kai-pu/mcp/server.py"] } }
```
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("shanhai-kaipu")

CRED_FILE = Path(os.environ.get("KAI_PU_CRED") or (Path.home() / ".kai-pu" / "agent.json"))


def _cfg() -> dict:
    """凭据：环境变量优先，其次本地文件。★ 不在任何地方打印 secret。"""
    cfg = {}
    if CRED_FILE.exists():
        try:
            cfg = json.loads(CRED_FILE.read_text(encoding="utf-8"))
        except Exception:
            cfg = {}
    return {
        "base": (os.environ.get("KAI_PU_BASE") or cfg.get("base") or "http://127.0.0.1:3560").rstrip("/"),
        "accountId": os.environ.get("KAI_PU_ACCOUNT") or cfg.get("accountId") or "",
        "agentId": os.environ.get("KAI_PU_AGENT") or cfg.get("agentId") or "",
        "secret": os.environ.get("KAI_PU_SECRET") or cfg.get("secret") or "",
    }


def _signed_body(extra: dict | None = None) -> dict:
    """签名域 = `f"{agentId}{ts}"`（与领活/交付同一套，容差 ±300 秒）。"""
    c = _cfg()
    if not (c["accountId"] and c["agentId"] and c["secret"]):
        raise RuntimeError("没配置凭据：设 KAI_PU_ACCOUNT / KAI_PU_AGENT / KAI_PU_SECRET，"
                           f"或写 {CRED_FILE}")
    ts = int(time.time())
    sig = hmac.new(c["secret"].encode(), f"{c['agentId']}{ts}".encode(), hashlib.sha256).hexdigest()
    body = {"accountId": c["accountId"], "agentId": c["agentId"], "ts": ts, "sig": sig}
    if extra:
        body.update(extra)
    return body


def _post(path: str, body: dict | None = None) -> dict:
    c = _cfg()
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(c["base"] + path, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        raise RuntimeError(f"{e.code}: {raw[:300]}") from None


def _get(path: str) -> dict:
    c = _cfg()
    try:
        with urllib.request.urlopen(c["base"] + path, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        raise RuntimeError(f"{e.code}: {raw[:300]}") from None


# ══════════════════════════════════════════════════════════════
# 工具
# ══════════════════════════════════════════════════════════════

@mcp.tool()
def kaipu_whoami() -> str:
    """我是谁：当前配置的铺子 / Agent / 端点，以及服务端是否可达。

    出问题先跑这个 —— 90% 的「连不上」是凭据或 base 写错。
    """
    c = _cfg()
    try:
        h = _get("/health")
        reachable = True
    except Exception as e:
        h, reachable = {"error": str(e)}, False
    return json.dumps({
        "base": c["base"], "accountId": c["accountId"], "agentId": c["agentId"],
        "secretConfigured": bool(c["secret"]), "reachable": reachable, "health": h,
    }, ensure_ascii=False, indent=2)


@mcp.tool()
def kaipu_heartbeat() -> str:
    """报「我在线」。

    ★ 为什么要主动报：服务端把「注册过」和「现在还在」分得很清楚 ——
      注册是曾经来过，心跳是现在还在。插件上那个绿点就是它。
    ★ 建议节奏：每 30 秒一次（90 秒内没有心跳就显示离线）。
    """
    return json.dumps(_post("/agent/heartbeat", _signed_body()), ensure_ascii=False)


@mcp.tool()
def kaipu_poll() -> str:
    """领活：有这个工位派的活就领一条回来，没有就返回 null。

    ★ 返回的 payload 里可能带 `guidance` —— 那是**服务端下发的做法**，
      不是客户端的硬编码。照它做，别自己发明流程。

    ★ Agent 侧不需要「推送」：定时调这个就是心跳式的轮询。
    """
    return json.dumps(_post("/agent/poll", _signed_body()), ensure_ascii=False, indent=2)


@mcp.tool()
def kaipu_submit(task_id: str, detail: str, interaction_id: str = "", filenames: str = "") -> str:
    """交活：把结果交回去。

    ★ 有两条硬规则（服务端校验，绕不过）：
      1. **必须有凭据**：要么 `interaction_id` + `filenames` 指向真的传上来的文件，
         要么 `detail` 写够 100 字（不需要附件时，写一份说明）。
      2. 先上传，再交付 —— 报了文件名但没传，服务端会拒。

    Args:
        task_id: 任务 ID（kaipu_poll 拿到的）
        detail: 结论/说明。带附件时可短，不带附件时必须 ≥100 字。
        interaction_id: 资料区的交互 ID（附件所在目录）
        filenames: 用逗号分隔的文件名，如 "稿.md,数据.csv"
    """
    dels = []
    if interaction_id.strip() and filenames.strip():
        dels = [{"interactionId": interaction_id.strip(), "filename": f.strip()}
                for f in filenames.split(",") if f.strip()]
    body = _signed_body({
        "taskId": task_id,
        "result": {"verdict": "done", "detail": detail},
        "deliverables": dels,
    })
    return json.dumps(_post("/agent/result", body), ensure_ascii=False)


@mcp.tool()
def kaipu_upload(interaction_id: str, filename: str, content: str, seat: str = "") -> str:
    """把一段文本传进资料区（Markdown / JSON / CSV 都可以）。

    ★ 资料按位存：`<铺>/<座位>/<交互ID>/`。不传 seat 时用 Agent 自己的座位。

    Args:
        interaction_id: 一次协作一个 ID
        filename: 文件名（含扩展名）
        content: 文件正文
        seat: 座位（一般留空）
    """
    c = _cfg()
    if not c["secret"]:
        raise RuntimeError("没配置 agentSecret，无法上传")
    data = content.encode("utf-8")
    sha = hashlib.sha256(data).hexdigest()
    ts = int(time.time())
    # ★ 签名域（服务端 `_pack_upload_raw` 逐字）：agentId|ts|accountId|filename|sha256
    msg = f"{c['agentId']}|{ts}|{c['accountId']}|{filename}|{sha}"
    sig = hmac.new(c["secret"].encode(), msg.encode(), hashlib.sha256).hexdigest()
    # ★ seat 不在 URL —— 服务端从凭据库取（唯一来源），Agent 传了也不认
    req = urllib.request.Request(
        f"{c['base']}/packs/{urllib.parse.quote(interaction_id)}/files",
        data=data, method="POST",
        headers={"Content-Type": "application/octet-stream",
                 "X-Filename": urllib.parse.quote(filename),
                 "X-Body-Sha256": sha,
                 "X-Agent-Id": c["agentId"],
                 "X-Account-Id": c["accountId"],
                 "X-Ts": str(ts),
                 "X-Sig": sig})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.dumps(json.loads(r.read().decode() or "{}"), ensure_ascii=False)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{e.code}: {e.read().decode(errors='replace')[:300]}") from None


def main() -> None:
    """默认 stdio（本机）；`--sse` 起 HTTP/SSE（给 WorkBuddy 这类远程客户端）。

    ★ 为什么默认 stdio：不需要端口、不需要防火墙、不需要鉴权网关 —— 最少的暴露面。
    ★ `--sse` 只绑 127.0.0.1，**绝不 0.0.0.0**（古茶定案：禁止开公网裸端口）。
      对公网必须经 Nginx 反代 + Bearer 头（见 deploy/nginx-kai-pu-mcp.conf）。
    """
    import sys
    if "--sse" in sys.argv:
        _run_sse()
    else:
        mcp.run()      # stdio


def _run_sse() -> None:
    """HTTP/SSE 模式：**必须先有 token，否则拒绝启动**。

    ★ 为什么 fail-closed 而不是「没配就放开」：
      MCP 进程手里握着这个 Agent 的 secret。SSE 端点一旦无鉴权，
      **任何知道 URL 的人都能调 poll/submit** ⇒ 等于把密钥借出去。
      没配 token 就不该开这个门，而不是「先开着以后再说」。
    """
    import uvicorn
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse

    token = (os.environ.get("KAI_PU_MCP_TOKEN") or "").strip()
    if not token:
        raise SystemExit(
            "拒绝启动 SSE：未设 KAI_PU_MCP_TOKEN。\n"
            "  MCP 进程持有 Agent 凭据，无鉴权的 SSE 等于把密钥借给任何知道 URL 的人。\n"
            "  生成：python3 -c \"import secrets;print('kp_' + secrets.token_urlsafe(32))\""
        )
    host = os.environ.get("KAI_PU_MCP_HOST", "127.0.0.1")
    port = int(os.environ.get("KAI_PU_MCP_PORT", "3580"))
    if host in ("0.0.0.0", "::"):
        raise SystemExit("拒绝绑定 0.0.0.0：MCP 只绑回环（古茶定案：禁止开公网裸端口）")

    class BearerGate(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            auth = request.headers.get("authorization", "")
            if auth != f"Bearer {token}":
                return JSONResponse({"error": "unauthorized"}, status_code=401)
            return await call_next(request)

    # ★ DNS rebinding 防护（SDK 自带）：只在白名单里的 Host 才放行。
    #   实证：经 Nginx 反代时 Host=agent.ak2029.com ⇒ 421 Misdirected Request。
    #   ★ 不解防护，只加白名单 —— 关掉它等于让任意域名都能打这个端点。
    from mcp.server.transport_security import TransportSecuritySettings
    _hosts = [h.strip() for h in
              (os.environ.get("KAI_PU_MCP_ALLOWED_HOSTS") or "127.0.0.1,localhost,agent.ak2029.com").split(",")
              if h.strip()]
    mcp.settings.transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=_hosts,
        allowed_origins=[f"https://{h}" for h in _hosts if not h.startswith(("127.", "localhost"))],
    )

    # ★ 路径必须带前缀：`/messages/` 已被 059 的 MCP 占用（agent.ak2029.com.conf:403）
    #   抢同一路径会互相打穿 —— 用自己的前缀，Nginx 直接反代，不 rewrite
    mcp.settings.sse_path = "/kai-pu-mcp/sse"
    mcp.settings.message_path = "/kai-pu-mcp/messages/"
    app = mcp.sse_app()
    app.add_middleware(BearerGate)
    print(f"[kai-pu-mcp] SSE on http://{host}:{port}/sse（Bearer 鉴权已启用）", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
