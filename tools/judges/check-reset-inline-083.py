#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""判据：重置确认区必须是「卡片底部独占一行」，不许塞进按钮行。

阿开 2026-10-26：「重置按钮现在的方式不好，字太多工位卡座直接变形了，
建议改成跟生成链接一样在卡片下面展开显示，保持卡片的长宽」

★ 判据设计要点（为什么这样锚）：
  · 锚「结构关系」而不是「文案」—— 文案改了不该让判据红
  · 必须能抓住回归：如果把确认块搬回按钮行（`marginTop:'auto'` 那个 flex 容器内），
    判据要变红
"""
import re, sys, pathlib

P = pathlib.Path("/root/work/083-开铺/repo/kaipu-dsh-plugin/"
                 "packages/plugin-workstation/src/client/WorkstationPanel.tsx")
src = P.read_text(encoding="utf-8")

# ★★ 2026-10-26 判据坑：bundle 里的中文是 `\uXXXX` 转义形式，
#    直接 grep 中文会得 0 ⇒ 假红。本判据读的是**源码**（源码是明文），
#    但若将来有人把判据改成读 bundle，必须先 decode unicode_escape。
#    （实证：bundle 里搜「确认重置」= 0，搜「取消」= 20 —— 因为前者被转义、后者没被转义）

# 剥注释（JS 块注释 + 行注释），避免注释里的锚点造成假绿
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

# 定位 OrgNodeCard 的按钮行容器（marginTop:'auto' 那个 flex）
m_btnrow = re.search(r"<div style=\{\{ display: 'flex', gap: 6, marginTop: 'auto', alignItems: 'center' \}\}>", code)
chk("K-1", "找到按钮行容器（flex + marginTop:auto）", m_btnrow is not None)

# 找到 OrgNodeCard 组件体范围
m_comp = re.search(r"function OrgNodeCard\(props[\s\S]*?\n\}\n", code)
chk("K-2", "找到 OrgNodeCard 组件体", m_comp is not None)

if m_btnrow and m_comp:
    comp_start = m_comp.start()
    btnrow_start = m_btnrow.start()

    # K-3：确认区文案「换一把新钥匙给」必须出现在按钮行**之后**
    #      （btnrow_start 之后的第一个大 div 收尾之后才算「卡片底部」）
    idx_confirm = code.find("换一把新钥匙给", btnrow_start)
    chk("K-3", "确认区出现在按钮行之后（卡片底部）",
        idx_confirm > btnrow_start,
        "确认区在按钮行之前或找不到 ⇒ 又塞回去了")

    # K-4：按钮行容器内部**不得**包含「确认重置」按钮
    #      取按钮行容器的区间：从 btnrow_start 到下一个 `marginTop: 8` 风格的结构块
    seg_end = code.find("marginTop: 8", btnrow_start)
    if seg_end == -1:
        seg_end = btnrow_start + 3000
    btnrow_seg = code[btnrow_start:seg_end]
    chk("K-4", "「确认重置」不在按钮行容器内",
        "确认重置" not in btnrow_seg,
        "确认按钮还在按钮行 ⇒ 卡座会变形")

    # K-5：确认区必须是 flexDirection:'column'（独占竖排），不是横向挤
    #      ★ 判据自身修正：`换一把新钥匙给` 是**容器内部**的文字，
    #        容器属性在它**之前** ⇒ 必须从容器开头往后取，不能从文字开始取
    #        （第一版从这里往后 900 字符，取不到容器属性 ⇒ 假红）
    open_tag = code.rfind("marginTop: 8", 0, idx_confirm)
    seg_confirm = code[open_tag: idx_confirm + 900] if open_tag > 0 else ""
    chk("K-5", "确认区竖排（flexDirection: 'column'）",
        "flexDirection: 'column'" in seg_confirm,
        "确认区没有竖排 ⇒ 可能还是横挤")

    # K-6：resetArm 展开时「请出」按钮要隐藏（防止两个红色危险动作并排）
    chk("K-6", "展开时隐藏「请出」（{resetArm ? null : ...}）",
        bool(re.search(r"\{resetArm \? null : \(", code)),
        "展开时「请出」还在 ⇒ 一慌点错")

    # K-7：卡片宽度不许被撑 —— 确认区不得设固定 width / minWidth
    chk("K-7", "确认区不设固定宽度（保持卡片长宽）",
        "width:" not in seg_confirm and "minWidth:" not in seg_confirm,
        "确认区设了宽度 ⇒ 可能撑变形")

print("\n结果：%d 通过 / %d 失败" % (P_N, F_N))
sys.exit(0 if F_N == 0 else 1)
