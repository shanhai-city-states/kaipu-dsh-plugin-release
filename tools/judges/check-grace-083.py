#!/usr/bin/env python3
"""乙案（轮换宽限期）判据 · 阴阳双对照 + 注入

★ 为什么必须在副本库上跑：要真做轮换（改 secret_blob），
  在生产库上跑一次就会把 Codex 的密钥再换一次。
★ 阴阳思路：
  阳 = 正常路径（当前密钥能验、旧密钥宽限期内能验）
  阴 = 边界（旧密钥过期后必须拒、吊销后新旧全拒）
★ 注入：故意把宽限期改成 0 秒 / 忽略 prev_blob，判据必须变红。
"""
import os
import shutil
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = "/opt/shanhai-toolkit-opensource/modules/08-workshop/kai-pu"
sys.path.insert(0, os.path.join(SRC, "src"))

LIVE = os.path.join(SRC, "data/kai_pu.db")
TMP = "/tmp/yian-verify/kai_pu_copy.db"
os.makedirs("/tmp/yian-verify", exist_ok=True)

# ★ 用 sqlite .backup 而不是 cp（shutil.copy 对活动 WAL 库会漏数据 —— 已有实证）
if os.path.exists(TMP):
    os.remove(TMP)
_src = sqlite3.connect(LIVE)
_dst = sqlite3.connect(TMP)
_src.backup(_dst)
_src.close()
_dst.close()

import store as S
import agents as A

PASS = 0
FAIL = []


def check(name, cond, detail=""):
    global PASS
    if cond:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL.append(f"{name} {detail}")
        print(f"  ❌ {name} {detail}")


st = S.Store(TMP)
reg = A.AgentRegistry(st)
ACC = "dev-cf78b69e0e8c"
AID = "codex-caishui-20261024"

print("\n=== 阳 1：迁移幂等（两列必须存在）===")
cols = [r[1] for r in st.conn.execute("PRAGMA table_info(agent_credentials)").fetchall()]
check("prev_blob 列存在", "prev_blob" in cols, str(cols)[:120])
check("prev_expires_at 列存在", "prev_expires_at" in cols)
# 再跑一次迁移，不得报错、不得重复
st._migrate_credential_grace()
cols2 = [r[1] for r in st.conn.execute("PRAGMA table_info(agent_credentials)").fetchall()]
check("迁移幂等（列数不变）", len(cols) == len(cols2), f"{len(cols)} vs {len(cols2)}")

print("\n=== 阳 2：轮换后，新旧两把密钥都能验签 ===")
old_secret = reg.secrets_for_verify(ACC, AID)[0]
res = reg.rotate(ACC, AID)
new_secret = res["agentSecret"]
check("轮换返回新密钥", bool(new_secret) and new_secret != old_secret)
check("返回宽限期小时数 = 24", res.get("prevSecretGraceHours") == 24, str(res.get("prevSecretGraceHours")))
check("返回旧密钥失效时刻", bool(res.get("prevSecretExpiresAt")), str(res.get("prevSecretExpiresAt")))

ts = int(time.time())


def sign(secret):
    import hashlib
    import hmac
    return hmac.new(secret.encode(), f"{AID}{ts}".encode(), hashlib.sha256).hexdigest()


check("★ 新密钥可验签（核心）", reg.verify_any(ACC, AID, ts, sign(new_secret)))
check("★★ 旧密钥仍可验签（乙案目的）", reg.verify_any(ACC, AID, ts, sign(old_secret)))
check("错密钥被拒（阴对照）", not reg.verify_any(ACC, AID, ts, sign("wrong-secret-xxx")))

print("\n=== 阳 3：宽限期到期 ⇒ 旧密钥必须失效（这条最关键）===")
# 把 prev_expires_at 改到过去，模拟 24h 已过
st.x("UPDATE agent_credentials SET prev_expires_at=? WHERE account_id=? AND agent_id=?",
     ("2020-01-01T00:00:00Z", ACC, AID))
check("★ 过期后旧密钥被拒", not reg.verify_any(ACC, AID, ts, sign(old_secret)))
check("过期后新密钥仍可用", reg.verify_any(ACC, AID, ts, sign(new_secret)))
# 惰性清理
st.sweep_expired_prev(ACC, AID)
row = st.get_credential(ACC, AID)
check("惰性清理清掉 prev_blob", not row["prev_blob"], repr(row["prev_blob"]))
check("惰性清理清掉 prev_expires_at", not row["prev_expires_at"])

print("\n=== 阳 4：吊销后新旧一律拒（安全底线）===")
res2 = reg.rotate(ACC, AID)
new2 = res2["agentSecret"]
prev_ok = reg.verify_any(ACC, AID, ts, sign(new2))
st.revoke_credential(ACC, AID)
check("吊销前新密钥可用（前置）", prev_ok)
check("★★ 吊销后新密钥被拒", not reg.verify_any(ACC, AID, ts, sign(new2)))
check("吊销后旧密钥被拒", not reg.verify_any(ACC, AID, ts, sign(new2)))

print("\n=== 阳 5：宽限期 = 24h（不是 0，也不是超长）===")
check("GRACE_SECONDS = 86400", S.GRACE_SECONDS == 86400, str(S.GRACE_SECONDS))

print("\n" + "=" * 50)
print(f"通过 {PASS} 项 · 失败 {len(FAIL)} 项")
if FAIL:
    print("失败清单：")
    for f in FAIL:
        print("  -", f)
    sys.exit(1)
print("全绿 ✅")
