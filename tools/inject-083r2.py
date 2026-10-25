#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""083-r2 · 反向注入自检（证明判据能变红，不是摆设）

做法：逐条「弄坏」源码 → 重新 build → 跑 check-083r2.mjs → 必须至少红一条 → 还原。
★ 为什么必须重新 build：判据 A 段跑的是**编译产物** lib/client/*.js，
  不重建等于没改（这一点 083-r1 就踩过：改了 .ts 判据不动，白高兴）。

用法：python tools/inject-083r2.py            # 跑全部注入
      python tools/inject-083r2.py --only A-9 # 只跑某一条
"""
import io
import json
import re
import subprocess
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = r'C:\Users\60720\.workbuddy\binaries\node\versions\22.22.2-6\node.exe'
CODE = os.path.join(ROOT, 'packages/plugin-workstation/src/client/invite-code.ts')
NODE_PICK = os.path.join(ROOT, 'packages/plugin-workstation/src/client/node-pick.ts')
PANEL = os.path.join(ROOT, 'packages/plugin-workstation/src/client/WorkstationPanel.tsx')

# (标签, 文件, 原文, 改成, 应该红哪条)
CASES = [
    ('A-2 让已用也能操作', CODE,
     "  return state === 'pending'\n",
     "  return state === 'pending' || state === 'used'\n",
     'A-2'),
    ('A-4 无明文时留空', CODE,
     "  return hash.length > 0 ? '已生成 · 明文未保存在本机' : '（缺 codeHash）'",
     "  return ''",
     'A-4'),
    ('A-6 把已作废也算进额度', CODE,
     "  for (const r of rows) if (r.state === 'pending') n += 1",
     "  for (const r of rows) if (r.state === 'pending' || r.state === 'revoked') n += 1",
     'A-6'),
    ('A-9 失效也不清明文（全不清）', CODE,
     "    if (r.state === 'used' || r.state === 'revoked' || r.state === 'expired' || expiredByTime) {\n      out.push(h)\n    }",
     "    if (false) {\n      out.push(h)\n    }",
     'A-9'),
    ('A-10 续期错误落到 default（照作业抄的写法）', CODE,
     "    case 'code_not_renewable':\n      return '这张码已经用过或作废了，续不了期'\n",
     "",
     'A-10'),
    ('A-12 已用的也给剩余时间', CODE,
     "  remainText: isActionable(row.state) ? remainingText(row.expiresAt, nowMs) : ''",
     "  remainText: remainingText(row.expiresAt, nowMs)",
     'A-12'),
    ('C-1 缺 joinState 当成 invited', NODE_PICK,
     "  return holder.online === true ? 'present' : 'joined'",
     "  return 'invited'",
     'C-1'),
    ('C-4 holders 非空也算受邀', NODE_PICK,
     "  if (holders.length > 0) return false\n",
     "",
     'C-4'),
    ('B-4 明文键改用批次号（猜）', PANEL,
     "        const h = codeHashOf(p)",
     "        const h = String(plains.indexOf(p))",
     'B-4'),
    ('B-7 作废后不抹明文', PANEL,
     "      safeRemove(plainStoreKey(hash))",
     "      /* 注入：不清 */",
     'B-7'),
    ('B-8 生成按钮不看额度', PANEL,
     "          disabled={busy || (owner === true && !canCreateMore(pendingCodes))}",
     "          disabled={busy}",
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
    return r.returncode == 0, (r.stdout or '')[-400:] + (r.stderr or '')[-400:]


def check():
    r = subprocess.run([NODE, 'tools/check-083r2.mjs'], cwd=ROOT, capture_output=True, text=True)
    out = r.stdout or ''
    reds = [ln.split()[1] for ln in out.splitlines() if ln.startswith('✗ ')]
    return r.returncode, reds, out.strip().splitlines()[-1] if out.strip() else ''


def main():
    recover('r2')
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]

    ok, tail = build()
    if not ok:
        raise SystemExit('基线构建失败：\n' + tail)
    rc, reds, last = check()
    print('基线：%s' % last)
    if rc != 0:
        raise SystemExit('基线不是全绿，先修基线再注入：%s' % reds)

    cases = [c for c in CASES if only is None or c[0].startswith(only)]
    bad = 0
    for label, path, old, new, want in cases:
        src = read(path)
        if old not in src:
            print('✗ %s —— 锚点找不到（源码已变），本条注入无效' % label)
            bad += 1
            continue
        save_lock('r2', path, src)
        write(path, src.replace(old, new, 1))
        try:
            ok2, tail2 = build()
            if not ok2:
                print('✓ %s → 编译就失败（等价于红）\n    %s' % (label, tail2.strip().splitlines()[0]))
                continue
            _, reds2, last2 = check()
            hit = [x for x in reds2 if x.startswith(want)]
            if hit:
                print('✓ %s → %s 变红（%s）' % (label, want, last2))
            else:
                print('✗ %s → 没红！期望 %s 红，实际红的：%s' % (label, want, reds2 or '无'))
                bad += 1
        finally:
            write(path, src)
            drop_lock('r2')

    ok3, tail3 = build()
    if not ok3:
        raise SystemExit('还原后构建失败：\n' + tail3)
    rc3, reds3, last3 = check()
    print('还原后：%s · 残留红：%s' % (last3, reds3 or '无'))
    return 1 if (bad > 0 or rc3 != 0) else 0


if __name__ == '__main__':
    sys.exit(main())
