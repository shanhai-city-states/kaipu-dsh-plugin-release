#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""判据：钥匙自助续期的教程必须进到「所有」发教程的地方。

阿开 2026-10-26：「要把现在新的链接教程更新到更多的邀请指南里
以及工位里的每一次生成邀请链接里」

★ 为什么需要这个判据：
  Codex 卡了 6 小时找不到出路，其中一段原因就是**教程里从没告诉它怎么自助换钥**。
  教程散在两处（工位生成邀请链接 / 邀请落地页），改一处漏一处 = 客户按旧教程办事。
  本判据盯三处，缺任何一处都红。

★ 判据设计（跟着设计走，不是搜关键词就算过）：
  不只查「有没有 claim 字样」，而要查**四段关键内容都在**：
    ① keyStatus / renew_available 状态说明
    ② claim 端点 + 四字段约束
    ③ 无分隔符签名口径（与上传包竖线格式区分）
    ④ 409 不是错误 + 覆写用 printf + 热加载
"""
import re, sys, pathlib

P_N = 0; F_N = 0
def chk(cid, desc, cond, hint=""):
    global P_N, F_N
    if cond: P_N += 1; print("  ✅ %s %s" % (cid, desc))
    else:    F_N += 1; print("  ❌ %s %s  %s" % (cid, desc, hint))

def strip_comments(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"^\s*//.*$", "", s, flags=re.M)
    return s

# ── 三处发教程的地方 ──
SITES = {
    "工位·邀请指令文案（join-copy.ts JOIN_GUIDE_SECTION）":
        pathlib.Path("/root/work/083-开铺/repo/kaipu-dsh-plugin/"
                     "packages/plugin-workstation/src/client/join-copy.ts"),
    "工位·生成邀请链接时拼的指南（WorkstationPanel.tsx）":
        pathlib.Path("/root/work/083-开铺/repo/kaipu-dsh-plugin/"
                     "packages/plugin-workstation/src/client/WorkstationPanel.tsx"),
    "邀请落地页（kai-pu-invite/index.html 进场了那屏）":
        pathlib.Path("/www/wwwroot/kai-pu-invite/index.html"),
}

CONTENT = {
    "C-1 提到 keyStatus 状态":      lambda t: "keyStatus" in t,
    "C-2 提到 renew_available":     lambda t: "renew_available" in t,
    "C-3 给出 claim 端点":          lambda t: "/agent/key/claim" in t,
    "C-4 强调四字段约束":           lambda t: ("四个字段" in t),
    "C-5 强调无分隔符签名":         lambda t: bool(re.search(r"没有(任何)?分隔符|无分隔符|不含分隔符", t)),
    "C-6 说明 409 不是错误":        lambda t: ("409" in t and ("不是错误" in t or "no_pending_key" in t)),
    "C-7 覆写用 printf":            lambda t: "printf" in t,
    "C-8 强调热加载内存":           lambda t: ("内存" in t),
}

for site_name, path in SITES.items():
    print("\n【%s】" % site_name)
    if not path.exists():
        chk("X", "文件存在", False, str(path)); continue
    raw = path.read_text(encoding="utf-8")
    code = strip_comments(raw)     # 注释里的锚点不算（防假绿）
    for cid, fn in CONTENT.items():
        chk(cid, cid.split(" ", 1)[1], fn(code))

# ── 反向判据：旧的「丢了只能让铺主轮换」这种说法必须消失 ──
print("\n【反向：旧口径必须消失】")
page = pathlib.Path("/www/wwwroot/kai-pu-invite/index.html").read_text(encoding="utf-8")
chk("N-1", "落地页不再说「丢了只能让铺主给你轮换」",
    "丢了只能让铺主给你轮换" not in page,
    "旧口径还在 ⇒ 客户以为只能等人搬")

print("\n结果：%d 通过 / %d 失败" % (P_N, F_N))
sys.exit(0 if F_N == 0 else 1)
