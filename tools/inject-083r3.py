#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""083-r3 · 反向注入自检（证明判据能变红）

逐条弄坏源码 → 重建 → 跑 check-083r3.mjs → 必须红 → 还原。
★ 必须重建：A 段断言的是编译产物 lib/client/node-pick.js。

用法：python tools/inject-083r3.py [--only A-1]
"""
import io
import json
import subprocess
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = r'C:\Users\60720\.workbuddy\binaries\node\versions\22.22.2-6\node.exe'
NODE_PICK = os.path.join(ROOT, 'packages/plugin-workstation/src/client/node-pick.ts')
PANEL = os.path.join(ROOT, 'packages/plugin-workstation/src/client/WorkstationPanel.tsx')
LIVE = os.path.join(ROOT, 'packages/plugin-workstation/src/client/live.ts')

CASES = [
    ('A-1 序号自己编号（不认 seq）', NODE_PICK,
     "  return typeof node.seq === 'number' && Number.isFinite(node.seq) ? `#${node.seq}` : ''",
     "  return `#${(node.name ?? '').length}`",
     'A-1'),
    ('A-3 姓名用截断后的首字（自己加工）', NODE_PICK,
     "  if (names.length > 0) return names.join('·')",
     "  if (names.length > 0) return names.map((n) => n.slice(0, 1)).join('·')",
     'A-3'),
    ('A-4 空位与受邀显示成同一句', NODE_PICK,
     "  if (invited !== null && invited !== undefined) return invitedLabel(invited)\n  return '空'",
     "  return '空'",
     'A-4'),
    ('A-5 排序改按数组下标（不排序）', NODE_PICK,
     "  withSeq.sort((a, b) => (a.seq as number) - (b.seq as number))",
     "  withSeq.sort(() => 0)",
     'A-5'),
    ('A-6 toast 退回写死一句', NODE_PICK,
     "  return who.length > 0\n    ? `✅ 已发布到「${nodeLabel}」· 指派给 ${who}`\n    : `✅ 已发布到「${nodeLabel}」`",
     "  return '✅ 已发布'",
     'A-6'),
    ('A-8 任务卡不区分公共池', NODE_PICK,
     "  if (label.length === 0 && who.length === 0) return '公共池 · 谁都能领'",
     "  if (label.length === 0 && who.length === 0) return ''",
     'A-8'),
    ('B-1 发布不带 nodeId（工位选了也白选）', PANEL,
     "        notifyId || undefined, nodeId || undefined,",
     "        notifyId || undefined,",
     'B-1'),
    ('B-3 service 丢掉 node_id', os.path.join(ROOT, 'packages/plugin-workstation/src/remote/service.ts'),
     "    if (typeof query.nodeId === 'string' && query.nodeId.length > 0) body.node_id = query.nodeId",
     "    /* 注入：丢掉 */",
     'B-3'),
    ('B-7 toast 退回写死「任务已发布」', PANEL,
     "    }, okText)",
     "    }, '任务已发布')",
     'B-7'),
    ('B-8 任务卡不显示工位', PANEL,
     " nodeLabel={nodeLabelOf(t.node_id)} />",
     " />",
     'B-8'),
]


def read(p):
    return io.open(p, encoding='utf-8').read()


def write(p, s):
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)


# ── ★ 崩溃恢复（2026-10-24 实踩）：注入是「改源码 → 重建 → 跑判据 → 还原」，
#    如果进程被 SIGTERM/断电打断，finally 不会执行，注入就**留在源码里**了。
#    本文件用一把锁记录「改之前长什么样」，下次启动先恢复再干活。
#    （真踩过：一次后台任务被杀，node-pick.ts 的 A-3 注入残留，后续判据全红。）
LOCK = os.path.join(ROOT, 'tools', '.inject-%s.lock')


def lock_path(tag):
    return LOCK % tag


def recover(tag):
    p = lock_path(tag)
    if not os.path.exists(p):
        return
    data = json.loads(io.open(p, encoding='utf-8').read())
    for path, content in data.items():
        write(path, content)
    os.remove(p)
    print('⚠ 发现上次注入未还原，已按锁文件恢复：%s' % '、'.join(os.path.basename(k) for k in data))


def save_lock(tag, path, content):
    io.open(lock_path(tag), 'w', encoding='utf-8').write(json.dumps({path: content}, ensure_ascii=False))


def drop_lock(tag):
    p = lock_path(tag)
    if os.path.exists(p):
        os.remove(p)


def build():
    r = subprocess.run([NODE, 'tools/build.mjs'], cwd=ROOT, capture_output=True, text=True)
    return r.returncode == 0, ((r.stdout or '')[-300:] + (r.stderr or '')[-300:])


def check():
    r = subprocess.run([NODE, 'tools/check-083r3.mjs'], cwd=ROOT, capture_output=True, text=True)
    out = r.stdout or ''
    reds = [ln.split()[1] for ln in out.splitlines() if ln.startswith('✗ ')]
    return r.returncode, reds, (out.strip().splitlines()[-1] if out.strip() else '')


def main():
    recover('r3')
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    ok, tail = build()
    if not ok:
        raise SystemExit('基线构建失败：\n' + tail)
    rc, reds, last = check()
    print('基线：%s' % last)
    if rc != 0:
        raise SystemExit('基线不是全绿，先修基线：%s' % reds)

    bad = 0
    for label, path, old, new, want in CASES:
        if only is not None and not label.startswith(only):
            continue
        src = read(path)
        if old not in src:
            print('✗ %s —— 锚点找不到（源码已变），本条注入无效' % label)
            bad += 1
            continue
        save_lock('r3', path, src)
        write(path, src.replace(old, new, 1))
        try:
            ok2, tail2 = build()
            if not ok2:
                print('✓ %s → 编译失败（等价于红）\n    %s' % (label, tail2.strip().splitlines()[0]))
                continue
            _, reds2, last2 = check()
            if any(x.startswith(want) for x in reds2):
                print('✓ %s → %s 变红（%s）' % (label, want, last2))
            else:
                print('✗ %s → 没红！期望 %s，实际红的：%s' % (label, want, reds2 or '无'))
                bad += 1
        finally:
            write(path, src)
            drop_lock('r3')

    ok3, tail3 = build()
    if not ok3:
        raise SystemExit('还原后构建失败：\n' + tail3)
    rc3, reds3, last3 = check()
    print('还原后：%s · 残留红：%s' % (last3, reds3 or '无'))
    return 1 if (bad > 0 or rc3 != 0) else 0


if __name__ == '__main__':
    sys.exit(main())
