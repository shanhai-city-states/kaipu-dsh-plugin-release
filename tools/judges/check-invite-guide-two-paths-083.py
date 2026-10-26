#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""判据：邀请的两条路径都必须有「📋 复制给新同事的指令」。

阿开 2026-10-26：「工位没有你说的『📋 复制给新同事的指令』」
根因：这个按钮原来只挂在**加入码**路径（`code.code`）上，
      而邀请**链接**路径（`made.url`）只有「复制链接」。
      两条都是「发给新同事的入口」，凭什么一条有一份没有？

本判据盯：
  L-1 链接路径有该按钮（且挂的是 made.url，不是 code.code）
  L-2 加入码路径有该按钮
  L-3 两条路径的 guide 都包含第五节钥匙教程（不只是有按钮）
  L-4 「已复制」状态必须是两个独立 state（否则点指令后链接按钮也变 ✓，会误导）
"""
import re, sys, pathlib

P = pathlib.Path("/root/work/083-开铺/repo/kaipu-dsh-plugin/"
                 "packages/plugin-workstation/src/client/WorkstationPanel.tsx")
src = P.read_text(encoding="utf-8")

def strip_comments(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"^\s*//.*$", "", s, flags=re.M)
    return s

code = strip_comments(src)

P_N = 0; F_N = 0
def chk(cid, desc, cond, hint=""):
    global P_N, F_N
    if cond: P_N += 1; print("  ✅ %s %s" % (cid, desc))
    else:    F_N += 1; print("  ❌ %s %s  %s" % (cid, desc, hint))

# 按钮（剥注释后）在哪些位置
idxs = [m.start() for m in re.finditer(r"复制给新同事的指令", code)]
chk("L-0", "剥注释后按钮出现 2 次（两条路径各一）",
    len(idxs) == 2, "实际 %d 次" % len(idxs))

def ctx(i: int, back: int = 6000) -> str:
    """从一个按钮位置往前取「这段 guide 的源码」。

    ★ 判据自身修正（2026-10-26）：第一版只往前取 3000 字符，
      而链接路径的 guide 有 80+ 行（≈4000+ 字符）⇒ `made.url`
      落在窗口之外 ⇒ 假红。
    ★ 正确做法：从最近的 `joinGuideText([` 起点取到按钮位置，
      这样取到的就是**这段 guide 本身**，与 guide 长短无关。
    """
    start = code.rfind("joinGuideText([", 0, i)
    if start < 0:
        return code[max(0, i - back): i]
    return code[start: i]

# L-1 链接路径：按钮所在 guide 里必须出现 made.url
link_found = False
for i in idxs:
    c = ctx(i)
    if "made.url" in c:
        link_found = True
        break
chk("L-1", "链接路径有该按钮（guide 里带 made.url）", link_found,
    "链接路径没有 ⇒ 生成邀请链接后仍然找不到指令按钮")

# L-2 加入码路径
code_found = False
for i in idxs:
    c = ctx(i)
    if "code.code" in c:
        code_found = True
        break
chk("L-2", "加入码路径有该按钮（guide 里带 code.code）", code_found,
    "加入码路径没有 ⇒ 原来那份没了")

# L-3 两条路径的 guide 都必须含第五节钥匙教程
#     判据：每个按钮往前 4000 字符内必须同时出现 renew_available 与 /agent/key/claim
for n, i in enumerate(idxs, 1):
    c = ctx(i, 4000)
    chk("L-3.%d" % n, "第 %d 个按钮的 guide 含钥匙教程" % n,
        "renew_available" in c and "/agent/key/claim" in c,
        "guide 里缺 keyStatus/claim 教程")

# L-4 两个独立 state
chk("L-4", "「已复制」用两个独立 state（copied / guideCopied）",
    code.count("const [copied, setCopied] = useState(false)") >= 1
    and code.count("const [guideCopied, setGuideCopied] = useState(false)") >= 1,
    "共用一个 state ⇒ 点指令后链接按钮也变 ✓")

print("\n结果：%d 通过 / %d 失败" % (P_N, F_N))
sys.exit(0 if F_N == 0 else 1)
