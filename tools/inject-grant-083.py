# -*- coding: utf-8 -*-
"""inject-grant-083.py · 证明 check-grant-083.mjs 真能变红。

做法：把源码逐条改坏 → 重建（纯函数判据读的是 lib 产物，不重建等于没改）→
跑判据 → 期望红 → 还原 + 重建。

★ 崩溃恢复：改之前把原文写进 `tools/.inject-grant.lock`，进程被 SIGTERM/断电
  打断也能在下次启动先还原（083 那边真踩过：注入留在源码里，后续判据全假红）。

    python tools/inject-grant-083.py
    python tools/inject-grant-083.py --only I-3
"""
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NODE = os.environ.get("KAIPU_NODE") or r"C:/Users/60720/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"

GRANT = os.path.join(ROOT, "packages/plugin-workstation/src/client/grant-copy.ts")
PANEL = os.path.join(ROOT, "packages/plugin-workstation/src/client/WorkstationPanel.tsx")
CHECK = os.path.join(HERE, "check-grant-083.mjs")
BUILD = os.path.join(HERE, "build.mjs")
LOCK = os.path.join(HERE, ".inject-grant.lock")


def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


def recover():
    if not os.path.exists(LOCK):
        return
    with io.open(LOCK, encoding="utf-8") as f:
        data = json.load(f)
    for path, content in data.items():
        write(path, content)
    os.remove(LOCK)
    build()
    print("⚠ 上次注入未还原，已按锁文件恢复并重建：%s"
          % "、".join(os.path.basename(k) for k in data))


def build():
    p = subprocess.run([NODE, BUILD], capture_output=True, text=True, cwd=ROOT)
    return p.returncode == 0, (p.stdout or "") + (p.stderr or "")


def run_check():
    p = subprocess.run([NODE, CHECK], capture_output=True, text=True, cwd=ROOT)
    out = (p.stdout or "") + (p.stderr or "")
    red_ids = []
    for line in out.splitlines():
        s = line.strip()
        if s.startswith("✗"):
            red_ids.append(s.split()[1] if len(s.split()) > 1 else "?")
    return (p.returncode != 0), red_ids, out


# (标题, 文件, 原文, 改坏后, 期望变红的判据 id)
CASES = [
    ("I-1 拿内部 ID 顶名字（需求 A-⑤ 的硬线）", GRANT,
     "  return i.length > 0 ? '对方未填名字' : '未兑换'",
     "  return i.length > 0 ? i : '未兑换'",
     "A-6"),

    ("I-2 空白名字不 trim ⇒ 渲染成空位", GRANT,
     "  const n = String(name ?? '').trim()",
     "  const n = String(name ?? '')",
     "A-3"),

    ("I-3 四段改回默认全展开（阿开明确要收起）", PANEL,
     "    empty: '没有要你处理的。有新任务时，卡片上直接有「领取」，一点就开工。',\n    openByDefault: false,",
     "    empty: '没有要你处理的。有新任务时，卡片上直接有「领取」，一点就开工。',\n    openByDefault: true,",
     "C-1"),

    ("I-4 展开状态退化成单 key（只能开一段）", PANEL,
     "const open = openSec[sec.key] ?? sec.openByDefault",
     "const open = openSec['__single'] ?? sec.openByDefault",
     "C-2"),

    ("I-5 代管恢复裸 granteeName（名字空就留白）", PANEL,
     "                  {granteeLabel(g.granteeName, g.granteeId)}",
     "                  {g.granteeName}",
     "B-2"),

    ("I-6 未兑换的码上撤掉「作废」按钮", PANEL,
     "                    作废\n                  </button>",
     "                    　\n                  </button>",
     "B-5"),

    ("I-7 复制按钮改成只复制码（人类收到看不懂）", PANEL,
     "    const text = grantCopyText(issued.code, issued.ttlHours, issued.codeExpiresAt)",
     "    const text = issued.code",
     "B-6"),

    ("I-8 复制文案里混进接口路径", GRANT,
     "    '把这个码发给你自己的 Agent 就行：',",
     "    '把这个码发给你自己的 Agent 就行（POST /grants/redeem）：',",
     "D-3"),
]


def main():
    recover()
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]

    ok, log = build()
    if not ok:
        print("✗ 基线构建失败，注入没有意义：\n%s" % log[-600:])
        return 1

    red, ids, out = run_check()
    base_ok = not red
    print("基线：%s" % ("✓ 全绿" if base_ok else "✗ 有红 %s" % ids))
    if not base_ok:
        print(out[-1500:])
        return 1

    good = 0
    bad = 0
    for title, path, old, new, expect in CASES:
        if only and not title.startswith(only):
            continue
        src = read(path)
        if old not in src:
            print("✗ %s —— 锚点没找到（源码已变，改脚本）" % title)
            bad += 1
            continue
        with io.open(LOCK, "w", encoding="utf-8") as f:
            json.dump({path: src}, f, ensure_ascii=False)
        try:
            write(path, src.replace(old, new, 1))
            ok2, blog = build()
            if not ok2:
                print("✗ %s —— 改坏后构建失败（说明改法不合法，换一种）\n%s"
                      % (title, blog[-400:]))
                bad += 1
                continue
            is_red, red_ids, _ = run_check()
            hit = expect in red_ids
            print("%s %s → %s" % ("✓" if hit else "✗", title,
                                  ("变红（%s）" % expect) if hit else
                                  "**没红**  红项=%s" % (red_ids or "无")))
            if hit:
                good += 1
            else:
                bad += 1
        finally:
            write(path, src)
            if os.path.exists(LOCK):
                os.remove(LOCK)
            # ★ 这里**不重建**：下一条注入会立刻改源码 + 重建，
            #   每条都还原两次构建会把整轮跑到 100 秒以上、撞进程超时
            #   （第一次跑就真被 SIGTERM 打断，靠锁文件才没把注入留在源码里）。
            #   整轮结束统一重建一次。

    ok3, log3 = build()
    if not ok3:
        print("✗ 还原后重建失败：\n%s" % log3[-600:])
        return 1

    print("\n注入自检：%d 项变红 / %d 项未变红" % (good, bad))
    red, ids, _ = run_check()
    print("还原后复跑：%s" % ("✓ 全绿" if not red else "✗ 仍有红 %s" % ids))
    return 0 if bad == 0 and not red else 1


if __name__ == "__main__":
    sys.exit(main())
