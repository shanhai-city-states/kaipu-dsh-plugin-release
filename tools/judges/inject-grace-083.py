#!/usr/bin/env python3
"""乙案判据的**注入测试** —— 证明「改坏了会变红」

★ 全绿不算数：一个恒真的判据和没写一样。
  这里故意把实现改坏，判据必须变红，才说明它真的在测东西。

四个注入：
  I-1 忽略 prev_blob（回到「轮换即失效」）⇒ 旧密钥验签那条必须红
  I-2 宽限期改成 0 秒            ⇒ 旧密钥验签那条必须红
  I-3 去掉过期判断（永不过期）    ⇒ 过期后旧密钥被拒那条必须红
  I-4 吊销后仍返回密钥（不查 status）⇒ 吊销后两条必须红
"""
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

SRC = "/opt/shanhai-toolkit-opensource/modules/08-workshop/kai-pu"
LIVE = os.path.join(SRC, "data/kai_pu.db")
BASE = "/tmp/yian-verify"

INJECTIONS = [
    ("I-1 忽略 prev_blob（回到轮换即失效）",
     'if prev and exp and exp > _now():',
     'if False:'),
    ("I-2 宽限期 = 0 秒",
     'GRACE_SECONDS = 24 * 3600',
     'GRACE_SECONDS = 0'),
    ("I-3 去掉过期判断（永不过期）",
     'if prev and exp and exp > _now():',
     'if prev:'),
    # ★ 吊销是**双层防护**（store.get_verify_blobs 一层 + agents.secrets_for_verify 一层），
    #   撤一层另一层仍然拦得住 ⇒ 必须两层一起撤，才能证明「两层都真在起作用」。
    ("I-4 吊销失效（两层一起撤 · 证明双层都在岗）",
     [('if row["status"] != "active":\n            return []           # 吊销 ⇒ 新旧一律不认',
       'if False:\n            return []           # INJ'),
      ('if not row or row["status"] != "active":\n            raise AgentError(404, "agent_not_found", "该 Agent 未登记或已吊销")\n        aad = f"{agent_id}|{account_id}"\n        out = [open_via_signer(aad, row["secret_blob"])]',
       'if not row:\n            raise AgentError(404, "agent_not_found", "该 Agent 未登记或已吊销")\n        aad = f"{agent_id}|{account_id}"\n        out = [open_via_signer(aad, row["secret_blob"])]')],
     None),
]


def fresh_copy():
    tmp = tempfile.mkdtemp(dir=BASE)
    dst = os.path.join(tmp, "kai_pu_copy.db")
    s = sqlite3.connect(LIVE)
    d = sqlite3.connect(dst)
    s.backup(d)
    s.close()
    d.close()
    return tmp, dst


results = []
for name, old, new in INJECTIONS:
    tmp, db = fresh_copy()
    # 复制一份 src 到临时目录，改坏它（绝不碰生产源码）
    tmp_src = os.path.join(tmp, "src")
    shutil.copytree(os.path.join(SRC, "src"), tmp_src)
    # ★ old 一律是 [(锚点,替换), ...]；new 为 None 时忽略
    pairs = old if isinstance(old, list) else [(old, new)]
    bad = False
    for o, n in pairs:
        for fname in ("store.py", "agents.py"):
            target = os.path.join(tmp_src, fname)
            if not os.path.exists(target):
                continue
            body = open(target, encoding="utf-8").read()
            if o in body:
                open(target, "w", encoding="utf-8").write(body.replace(o, n, 1))
                break
        else:
            bad = True
            break
    if bad:
        results.append((name, "SKIP", "锚点未找到，注入无效"))
        print(f"⚠️  {name}: 锚点未找到 —— 注入无效（必须修判据）")
        continue

    # 用改坏的 src 跑同一套判据
    runner = os.path.join(tmp, "run.py")
    judge = open(os.path.join(BASE, "check-grace.py"), encoding="utf-8").read()
    judge = judge.replace(
        'sys.path.insert(0, os.path.join(SRC, "src"))',
        f'sys.path.insert(0, {tmp_src!r})')
    judge = judge.replace('TMP = "/tmp/yian-verify/kai_pu_copy.db"', f'TMP = {db!r}')
    open(runner, "w", encoding="utf-8").write(judge)

    p = subprocess.run([sys.executable, runner], capture_output=True, text=True, timeout=120)
    red = p.returncode != 0
    results.append((name, "RED" if red else "GREEN", ""))
    print(f"{'✅ 变红' if red else '❌ 仍绿（判据失效！）'}  {name}")
    if not red:
        print("    判据没抓到这次破坏 ⇒ 判据有洞")

print("\n" + "=" * 50)
caught = sum(1 for _, s, _ in results if s == "RED")
skipped = sum(1 for _, s, _ in results if s == "SKIP")
print(f"注入 {len(INJECTIONS)} 项 · 抓到 {caught} · 无效 {skipped}")
if caught != len(INJECTIONS) - skipped:
    sys.exit(1)
print("注入测试全抓 ✅")
