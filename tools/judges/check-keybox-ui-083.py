#!/usr/bin/env python3
"""钥匙保险箱 · 前端判据（R-1 ~ R-8）

★ 判据要跟设计走：设计是「铺主侧多一个『重置连接』按钮，与『请出』并列但语义不同」。
  所以判据不只验「有按钮」，还要验**两者没被搞混**（按钮文案、回调、提示语都不同）。

★ 常踩的假绿：全文 includes 命中注释里的字样也算通过。
  ⇒ 本判据**先剥注释再匹配**（v3Code 的教训）。
"""
import re
import sys

PANEL = "/root/work/083-开铺/repo/kaipu-dsh-plugin/packages/plugin-workstation/src/client/WorkstationPanel.tsx"
LIVE = "/root/work/083-开铺/repo/kaipu-dsh-plugin/packages/plugin-workstation/src/client/live.ts"
BRIDGE = "/root/work/083-开铺/repo/kaipu-dsh-plugin/packages/plugin-workstation/src/client/bridge.ts"
SERVICE = "/root/work/083-开铺/repo/kaipu-dsh-plugin/packages/plugin-workstation/src/remote/service.ts"

PASS, FAIL = 0, []


def check(name, cond, detail=""):
    global PASS
    if cond:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL.append(name)
        print(f"  ❌ {name} {detail}")


def strip_comments(src: str) -> str:
    """剥掉 // 与 /* */ 注释 —— 防「注释里有字样就绿」的假绿"""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
    return src


panel = strip_comments(open(PANEL, encoding="utf-8").read())
live = strip_comments(open(LIVE, encoding="utf-8").read())
bridge = strip_comments(open(BRIDGE, encoding="utf-8").read())
service = strip_comments(open(SERVICE, encoding="utf-8").read())

print("\n=== R-1：按钮存在（剥注释后仍在）===")
check("界面有「🔑 重置连接」按钮", "🔑 重置连接" in panel)
check("按钮文案是重置连接不是重置加入码", "重置加入码" not in panel)

print("\n=== R-2：与请出并列，且语义不混 ===")
check("请出按钮仍在（没被替换掉）", "请出" in panel)
check("有 onResetKey 回调", "onResetKey" in panel)
check("有 onEvict 回调（没被重置顶掉）", "onEvict" in panel)
# ★ 关键：两个回调必须指向不同实现
check("onResetKey 调 resetAgentKey", "resetAgentKey(" in panel)
check("onEvict 调 evictSeat", "evictSeat(" in panel)

print("\n=== R-3：二次确认存在且提示「不会断线」===")
check("有 resetArm 状态", "resetArm" in panel)
check("有「确认重置」按钮", "确认重置" in panel)
check("二次确认里写明不会当场断开", "不会当场断开" in panel)

print("\n=== R-4：live.ts 导出函数 ===")
check("导出 resetAgentKey", "export async function resetAgentKey" in live)
check("调用 agentResetConnection", "'agentResetConnection'" in live)
check("★ 返回类型不含 agentSecret（人不搬密钥）",
      "agentSecret" not in live.split("resetAgentKey")[1].split("export async function")[0])

print("\n=== R-5：bridge 白名名单 ===")
check("bridge 登记 agentResetConnection", "agentResetConnection" in bridge)

print("\n=== R-6：remote service 实现 ===")
check("service 有 @Remote('agentResetConnection')", "@Remote('agentResetConnection')" in service)
check("service 打到 reset-connection 端点", "/reset-connection" in service)
check("★ service 返回不含 agentSecret",
      "agentSecret" not in service.split("@Remote('agentResetConnection')")[1].split("@Remote")[0])

print("\n=== R-7：账号维度（重置的是 Agent 不是位）===")
check("resetAgentKey 参数是 agentId", "resetAgentKey(agentId" in live)
check("onResetKey 传 agentId（不是 seat）",
      "onResetKey: (agentId: string)" in panel)
# ★★ 关键补强（注入 I-5 抓出来的漏）：
#   光验「函数签名参数叫 agentId」不够 —— 传错字段名照样能绿。
#   必须验**实际发给后端的 JSON 键就是 agentId**，且那个调用里没有 seat。
#   ★ 切片必须止于**下一个函数定义**，不能止于 '/** ' ——
#     注释被剥掉后 '/** ' 已不存在 ⇒ split 落空 ⇒ 整份文件都被当成函数体（误报实证）。
import re as _re
_m = _re.search(r"export async function resetAgentKey[\s\S]*?\n\}", live)
_reset_call = _m.group(0) if _m else ""
check("★ 能截出 resetAgentKey 函数体（前置）", _reset_call != "")
check("★ 发给后端的键是 { agentId }", "{ agentId }" in _reset_call,
      _reset_call[:200].replace("\n", " "))
check("★★ 重置调用里不得出现 seat 字段（发错字段=重置错人）",
      _re.search(r"\bseat\b", _reset_call) is None,
      _reset_call[:200].replace("\n", " "))

print("\n=== R-8：状态提示说清宽限期 ===")
check("成功提示含 graceHours", "graceHours" in panel)

print("\n" + "=" * 50)
print(f"通过 {PASS} 项 · 失败 {len(FAIL)} 项")
if FAIL:
    for f in FAIL:
        print("  -", f)
    sys.exit(1)
print("前端判据全绿 ✅")
