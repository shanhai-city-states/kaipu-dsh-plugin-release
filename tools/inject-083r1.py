"""反向注入：证明 check-notify-083r1 的判据真能变红（不是关键词命中式的假绿）。

★ 星月每轮的原话都是「全绿不算证据，能变红才算」。
★ 与 inject-083b.py 的一个区别：**每次注入后都要重新 build**。
  本轮判据里的纯函数组是直接 import `lib/client/notify-copy.js`（编译产物），
  只改源码不 build ⇒ 产物没变 ⇒ 判据当然不红，那是假证据。
   本轮跑完自动还原 + 重新 build，源码与产物都不留改动。
"""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
COPY = ROOT / 'packages/plugin-workstation/src/client/notify-copy.ts'
PANEL = ROOT / 'packages/plugin-workstation/src/client/WorkstationPanel.tsx'
SERVICE = ROOT / 'packages/plugin-workstation/src/remote/service.ts'
NODE = r'C:/Users/60720/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
BUILD = ROOT / 'tools/build.mjs'
JUDGE = ROOT / 'tools/check-notify-083r1.mjs'

FILES = [COPY, PANEL, SERVICE]
orig = {p: p.read_text(encoding='utf-8') for p in FILES}


def build():
    r = subprocess.run([NODE, str(BUILD)], capture_output=True, text=True, encoding='utf-8')
    return r.returncode == 0


def judge():
    r = subprocess.run([NODE, str(JUDGE)], capture_output=True, text=True, encoding='utf-8')
    lines = [l for l in (r.stdout or '').split('\n') if l.strip()]
    red = [l for l in lines if l.startswith('✗')]
    tail = [l for l in lines if l.startswith('全绿') or l.startswith('有行') or l.startswith('有红')]
    return red, (tail[0] if tail else '(无结论)')


def restore():
    for p, t in orig.items():
        p.write_text(t, encoding='utf-8')


# ── 注入清单：(名字, 改哪个文件, 原文片段, 替换成) ─────────────────────────
CASES = [
    ('agentChoices 不再过滤离场成员',
     COPY,
     'if (m.membershipActive === false) continue',
     'if (false) continue'),
    ('extraHolderBadge 报总数而不是多出来的',
     COPY,
     'return `＋${extra}`',
     'return `＋${holderCount}`'),
    ('isNotifyUnsupported 只判 code（不看字段名）',
     COPY,
     'return /notifyAgent|notify_agent/i.test(message)',
     'return true'),
    ('holderUnknownText 对空位也报「有人」',
     COPY,
     "if (!Number.isFinite(seatCount) || seatCount <= 0) return ''",
     'if (!Number.isFinite(seatCount)) return \'\''),
    ('请求体改回 snake_case（实测会被后端 400）',
     SERVICE,
     'body.notifyAgent = query.notifyAgent',
     'body.notify_agent = query.notifyAgent'),
    ('降级重发时仍然带上 notifyAgent',
     PANEL,
     'r = await createTask(t, detail.trim(), projId || undefined, `task-${tid}`, newKind || undefined)',
     'r = await createTask(t, detail.trim(), projId || undefined, `task-${tid}`, newKind || undefined, notifyId || undefined)'),
]

assert build(), '基线 build 失败，先修构建'
red0, tail0 = judge()
print(f'基线：{tail0}')
for l in red0:
    print(f'    {l}')

for name, path, old, new in CASES:
    text = orig[path]
    assert old in text, f'注入「{name}」未命中片段：{old[:60]}'
    path.write_text(text.replace(old, new, 1), encoding='utf-8')
    built = build()
    red, tail = judge()
    print(f'\n注入「{name}」→ {tail}{"" if built else "（build 失败）"}')
    if red:
        for l in red:
            print(f'    {l}')
    else:
        print('    ⚠ 没有任何判据变红 —— 这条判据是假绿，必须补')
    restore()

assert build(), '还原后 build 失败'
red1, tail1 = judge()
print(f'\n还原后 → {tail1}')
print('残留红：', red1 or '无')
