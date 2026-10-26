#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check-export-tree-083.py —— 归档包树状结构 + 两张清单 判据（2026-10-26）

★★ 判据纪律（本项目反复栽的坑，逐条对应本文件的设计）：
  · **真跑函数**，不对源码 grep 关键词 —— grep 命中 ≠ 算对了
  · 每条都要能真跑出红/绿；**写完必须注入一次看它真变红**
  · 反向用例必须有：空项目 / 无交付物 / 垃圾文件名 / 中文名

★★ 本判据的存在理由（阿开 2026-10-26 的问题链）：
  ① 「导出下载归档文件用户做不到归类」 ⇒ 要按 任务/附件/交付物 分层
  ② 「附件是需求任务的附件是吗？可能是 Excel/Word/PPT/PDF/dwg/图片」
  ③ 「按Agent工位编号+工位类型+Agent的名字或者ID」 分目录
  ④ 「上传时间可以记录吗？要不要导出一份任务清单…按甲（两张 CSV）」
  ⇒ 每一条都要有断言守着，否则明天改一版就悄悄丢了。

跑法：python3 tools/check-export-tree-083.py
"""
import csv
import io
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

PASS = 0
FAILS = []


def ck(name, cond, got=None):
    got = "" if got is None else got
    global PASS
    if cond:
        PASS += 1
        print(f"  \033[32m✓\033[0m {name}")
    else:
        FAILS.append(f"{name}｜实际={got}")
        print(f"  \033[31m✗\033[0m {name} ｜ 实际={got}")


# ══════════════════════════════════════════════════════════════
# 被测函数：packs.export_project_zip（纯文件层，不连库）
# ══════════════════════════════════════════════════════════════
KAI = "/opt/shanhai-toolkit-opensource/modules/08-workshop/kai-pu"
sys.path.insert(0, os.path.join(KAI, "src"))


def _try_import():
    try:
        import packs  # noqa
        return packs, None
    except Exception as e:                                    # pragma: no cover
        return None, e


packs, _imp_err = _try_import()

if packs is None:
    print(f"✗ 无法 import packs：{_imp_err}")
    sys.exit(1)


# ── 造一个假的 packs root（不碰生产目录）────────────────────
import tempfile

TMP = tempfile.mkdtemp(prefix="chk-export-")


def _mkfile(root, acct, seat, iid, name, content=b"x"):
    d = os.path.join(root, acct, seat, iid)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name)
    with open(p, "wb") as f:
        f.write(content)
    return p


class FakeStore:
    """只提供 _station_label 需要的两个方法（导出是只读路径，不需要真库）"""

    def __init__(self, nodes=None):
        self.nodes = nodes or {}

    def seat_workstation_label(self, account_id, node_id, seat, agent_id):
        # 简化：返回固定形态，验证 slug 拼接逻辑
        return {"seq": "6", "kind": "执行位", "agent": agent_id or "未知",
                "slug": "06-执行位-x"}

    def q1(self, sql, params=()):
        # node_id 查询：返回 org_nodes 形态
        nid = params[0] if params else ""
        if nid in self.nodes:
            return self.nodes[nid]
        return None


ACCT = "acct-test"
P1 = "task-aaa"
P2 = "task-bbb"
_mkfile(TMP, ACCT, "management", P1, "报价单.xlsx", b"excel-bytes")
_mkfile(TMP, ACCT, "management", P1, "合同.pdf", b"pdf-bytes")
_mkfile(TMP, ACCT, "execution", P1, "结案报告.docx", b"docx-bytes")
_mkfile(TMP, ACCT, "execution", P2, "图纸.dwg", b"dwg-bytes")
_mkfile(TMP, ACCT, "execution", P2, "_journal.log", b"internal")   # 内部记账，不该进包
_mkfile(TMP, ACCT, "execution", P2, "照片.jpg", b"jpg-bytes")

TASKS = [
    {"taskId": "aaa", "title": "整理报价", "status": "accepted",
     "detail": "## 要求\n\n把报价单整理成 Excel", "kind": "requirement",
     "created_by": "owner", "claimed_by": "azhou2",
     "created_at": "2026-10-20T01:00:00Z", "done_at": "2026-10-22T02:00:00Z",
     "result": "已完成", "blocked_reason": "",
     "interactionIds": [P1]},
    {"taskId": "bbb", "title": "画施工图", "status": "in_progress",
     "detail": "", "kind": "task", "created_by": "owner", "claimed_by": "",
     "created_at": "2026-10-21T01:00:00Z", "done_at": "", "result": "",
     "blocked_reason": "等客户确认", "interactionIds": [P2]},
]
PROJ = {"project_id": "prj_t", "name": "测试项目", "status": "active",
        "archived_at": "2026-10-26T00:00:00Z"}
PACK_FILES = [
    {"interaction_id": P1, "filename": "报价单.xlsx", "uploaded_by": "owner",
     "uploaded_at": "2026-10-20T01:30:00Z", "node_id": "", "seat": "management"},
    {"interaction_id": P1, "filename": "合同.pdf", "uploaded_by": "owner",
     "uploaded_at": "2026-10-20T01:31:00Z", "node_id": "", "seat": "management"},
    {"interaction_id": P1, "filename": "结案报告.docx", "uploaded_by": "azhou2",
     "uploaded_at": "2026-10-22T01:59:00Z", "node_id": "", "seat": "execution"},
    {"interaction_id": P2, "filename": "图纸.dwg", "uploaded_by": "azhou2",
     "uploaded_at": "2026-10-21T03:00:00Z", "node_id": "", "seat": "execution"},
    {"interaction_id": P2, "filename": "照片.jpg", "uploaded_by": "owner",
     "uploaded_at": "2026-10-21T03:10:00Z", "node_id": "", "seat": "execution"},
]
# 交付物正本：只有「结案报告.docx」是干出来的
DELIV = [{"task_id": "aaa", "interaction_id": P1, "filename": "结案报告.docx",
          "size": 10, "sha256": "x"}]

data, n, total, manifest = packs.export_project_zip(
    TMP, ACCT, PROJ, TASKS, store_like=FakeStore(),
    pack_files=PACK_FILES, deliverables=DELIV)
zf = zipfile.ZipFile(io.BytesIO(data))
NAMES = zf.namelist()


def find(suffix):
    return [x for x in NAMES if x.endswith(suffix)]


# ── E-1 树状结构（不是老的 <任务>/<座位>/ 扁平） ──
ck("E-1a 包内有一级项目目录（按项目名）",
   any(x.startswith("测试项目/") for x in NAMES),
   NAMES[:3])

ck("E-1b ★layout 标记 tree-v2（老包是扁平，靠这个区分）",
   manifest.get("layout") == "tree-v2", manifest.get("layout"))

ck("E-1c 任务目录带 `NN-` 序号前缀（文件管理器能按序排）",
   any("/01-" in x for x in NAMES) and any("/02-" in x for x in NAMES),
   [x for x in NAMES if "/0" in x][:3])

# ── E-2 需求.md：任务正文必须进包（原来完全丢了）──
reqs = find("/需求.md")
ck("E-2a 每个任务一份 需求.md", len(reqs) == 2, len(reqs))

if reqs:
    req1 = zf.read([r for r in reqs if "/01-" in r][0]).decode("utf-8")
    ck("E-2b ★需求.md 含任务正文原文（detail 不再丢）",
       "把报价单整理成 Excel" in req1, req1[:120])
    ck("E-2c 需求.md 含发布/完成时间（可追溯）",
       "2026-10-20T01:00:00Z" in req1 and "2026-10-22T02:00:00Z" in req1, req1[:200])
    req2 = zf.read([r for r in reqs if "/02-" in r][0]).decode("utf-8")
    ck("E-2d 没有正文时给一句人话（不留空段）",
       "没有正文" in req2, req2[-120:])
    ck("E-2e 阻塞原因进需求.md（阿开口径：备注要能看见）",
       "等客户确认" in req2, req2[-200:])

# ── E-3 附件 / 交付物 分流（阿开问题的核心）──
ck("E-3a ★交付物目录存在（取 task_deliverables 正本）",
   any("/交付物/" in x for x in NAMES),
   [x for x in NAMES if "/交付物/" in x][:2])

ck("E-3b ★附件目录存在（pack_files 里不在交付物表的）",
   any("/附件/" in x for x in NAMES),
   [x for x in NAMES if "/附件/" in x][:2])

ck("E-3c ★交付物表里有的 → 进 交付物/（不是附件/）",
   any("结案报告.docx" in x and "/交付物/" in x for x in NAMES),
   [x for x in NAMES if "结案报告" in x])

ck("E-3d ★交付物表里没有的 → 进 附件/（Excel/PDF 是客户给的原始资料）",
   any("报价单.xlsx" in x and "/附件/" in x for x in NAMES)
   and any("合同.pdf" in x and "/附件/" in x for x in NAMES),
   [x for x in NAMES if "报价单" in x or "合同" in x])

ck("E-3e ★同一个任务里附件与交付物**分开**（不是混一个目录）",
   len([x for x in NAMES if "/01-" in x and "/附件/" in x]) >= 2
   and len([x for x in NAMES if "/01-" in x and "/交付物/" in x]) >= 1,
   [x for x in NAMES if "/01-" in x])

# ── E-4 工位目录形态：编号-类型-Agent ──
ck("E-4a ★工位目录是「编号-类型-Agent」三段式",
   any("/附件/06-执行位-" in x for x in NAMES)
   or any("/交付物/06-执行位-" in x for x in NAMES),
   [x for x in NAMES if "/附件/" in x or "/交付物/" in x][:3])

ck("E-4b 编号补零两位（01/02… 便于排序）",
   any("/0" in x and "-执行位-" in x for x in NAMES),
   [x for x in NAMES if "执行位" in x][:2])

# ── E-5 内部记账文件不进包 ──
ck("E-5a ★`_journal.log` 等内部文件不进用户包",
   not any("_journal" in x for x in NAMES),
   [x for x in NAMES if "_journal" in x])

ck("E-5b `_meta.json` 同样不进包",
   not any("_meta.json" in x for x in NAMES),
   [x for x in NAMES if "_meta" in x])

# ── E-6 两张清单（阿开选甲：两张 CSV）──
task_csvs = find("任务清单.csv")
up_csvs = find("上传清单.csv")
ck("E-6a ★任务清单.csv 存在", len(task_csvs) == 1, task_csvs)
ck("E-6b ★上传清单.csv 存在", len(up_csvs) == 1, up_csvs)

if task_csvs:
    raw = zf.read(task_csvs[0])
    ck("E-6c ★CSV 带 UTF-8 BOM（Excel 双击打开中文不乱码）",
       raw.startswith(b"\xef\xbb\xbf"), raw[:6])
    txt = raw.decode("utf-8-sig")
    ck("E-6d ★任务清单含阿开要的列（序号/项目/任务/正文/发布时间）",
       all(k in txt for k in ["序号", "project", "task", "正文内容", "发布时间"]),
       txt.splitlines()[0][:150])
    ck("E-6e 任务清单含附件数/交付物数（一眼看出资料齐不齐）",
       "附件数" in txt and "交付物数" in txt, txt.splitlines()[0][:200])
    # ★★ 判据写错过一次（2026-10-26）：用 splitlines() 数行，
    #   而「正文内容」列里有真实换行（被 CSV 引号包住）⇒ 2 个任务数出 5 行 ⇒ 假红。
    #   ⇒ 必须用 csv 解析器数**记录数**，不能数字符流里的换行。
    _rows = list(csv.reader(io.StringIO(txt)))
    ck("E-6f 每个任务一行（2 个任务 ⇒ 表头 + 2 记录）",
       len(_rows) == 3, len(_rows))

if up_csvs:
    utxt = zf.read(up_csvs[0]).decode("utf-8-sig")
    ck("E-6g ★上传清单含上传时间列（阿开：「上传时间可以记录吗」）",
       "上传时间" in utxt and "2026-10-20T01:30:00Z" in utxt, utxt[:200])
    ck("E-6h ★上传清单含格式列（Excel/Word/PPT/PDF/dwg/图片都要能看出来）",
       "格式" in utxt and "xlsx" in utxt and "pdf" in utxt and "dwg" in utxt,
       utxt[:300])
    ck("E-6i ★上传清单含工位列（编号-类型-Agent）",
       "工位(编号-类型-Agent)" in utxt, utxt.splitlines()[0])
    ck("E-6j 上传清单含 sha256（可独立验原件）",
       "sha256" in utxt, utxt.splitlines()[0])
    ck("E-6k 上传清单含分类列（附件/交付物）",
       "分类" in utxt, utxt.splitlines()[0])

# ── E-7 中文文件名 / 特殊格式 ──
# ★★ 注入 7 漏抓（2026-10-26）：原来只查 `flag_bits & 0x800`，
#    而 Python 的 zipfile 在写**字符串**文件名时会**自动**打 0x800 ⇒ 判据等价于永远为真。
#    ⇒ 真正该验的是**往包里写的那个对象是不是 ZipInfo**（只有显式 ZipInfo 才需要自己打标志）。
ck("E-7a ★中文名用 ZipInfo 写入（zipfile 才会保留我们设的 UTF-8 标志位）",
   # 直接读源码切片太脆；改验**结果**：解回来名字完全一致（含中文与全角括号）
   all(any(info.filename.endswith(nm) for info in zf.infolist())
       for nm in ["结案报告.docx", "报价单.xlsx", "图纸.dwg"]),
   [i.filename for i in zf.infolist()][:4])

ck("E-7a2 ★所有条目都带 UTF-8 标志位（0x800）或纯 ASCII 名（两者都合法）",
   all((i.flag_bits & 0x800) or i.filename.isascii() for i in zf.infolist()),
   [(i.filename, hex(i.flag_bits)) for i in zf.infolist()][:3])

import inspect as _inspect
ck("E-7a3 ★源码里显式构造 ZipInfo 并设 0x800（去掉这行 Windows 解压会乱码）",
   "zi.flag_bits |= 0x800" in _inspect.getsource(packs.export_project_zip),
   "未找到 zi.flag_bits |= 0x800")

ck("E-7b ★dwg / jpg 等二进制格式原样进包（不转码）",
   any("图纸.dwg" in x for x in NAMES) and any("照片.jpg" in x for x in NAMES),
   [x for x in NAMES if "图纸" in x or "照片" in x])

# 二进制内容一字节都不能变
if any("图纸.dwg" in x for x in NAMES):
    got = zf.read([x for x in NAMES if "图纸.dwg" in x][0])
    ck("E-7c ★dwg 内容逐字节一致（归档包不能改客户原件）",
       got == b"dwg-bytes", got[:20])

# ── E-8 manifest 自证 ──
ck("E-8a manifest 含逐文件 sha256（第三方可独立验）",
   all("sha256" in f and len(f["sha256"]) == 64 for f in manifest.get("files", [])),
   [f.get("sha256", "")[:8] for f in manifest.get("files", [])][:3])

ck("E-8b ★manifest.files 数 == 业务文件数（附件+交付物，不含生成的说明件）",
   len(manifest.get("files", [])) == n
   and n == manifest["totals"]["attachments"] + manifest["totals"]["deliverables"],
   (len(manifest.get("files", [])), n, manifest["totals"]))

ck("E-8b2 ★包内总条目 = 业务文件 + 需求.md + 两张清单 + 说明 + manifest（可对数）",
   len(NAMES) == manifest["totals"]["files"] + manifest["totals"]["generatedDocs"] + 4,
   (len(NAMES), manifest["totals"]))

ck("E-8c manifest 记录 attachments / deliverables 分项计数",
   "attachments" in manifest.get("totals", {})
   and "deliverables" in manifest.get("totals", {}),
   manifest.get("totals"))

# ── E-9 空项目不炸（反向用例）──
empty_data, en, et, em = packs.export_project_zip(
    TMP, ACCT, {"project_id": "prj_e", "name": "空项目", "status": "active"},
    [], store_like=FakeStore(), pack_files=[], deliverables=[])
ezf = zipfile.ZipFile(io.BytesIO(empty_data))
enames = ezf.namelist()
ck("E-9a ★空项目也能出包（不抛异常）", en == 0, en)
ck("E-9b ★空项目的两张清单照样有（表头在，不空文件）",
   any(x.endswith("任务清单.csv") for x in enames)
   and any(x.endswith("上传清单.csv") for x in enames), enames)
ck("E-9c 空项目清单只有表头一行",
   len([l for l in ezf.read([x for x in enames if x.endswith("任务清单.csv")][0])
        .decode("utf-8-sig").splitlines() if l.strip()]) == 1, "多行")

# ── E-10 磁盘有、索引无（孤儿件）──
_mkfile(TMP, ACCT, "execution", "task-ccc", "野文件.txt", b"orphan")
d2, n2, t2, m2 = packs.export_project_zip(
    TMP, ACCT, PROJ,
    [{"taskId": "ccc", "title": "孤儿测试", "status": "posted", "detail": "",
      "created_by": "owner", "claimed_by": "", "created_at": "", "done_at": "",
      "result": "", "blocked_reason": "", "interactionIds": ["task-ccc"]}],
    store_like=FakeStore(), pack_files=[], deliverables=[])
z2 = zipfile.ZipFile(io.BytesIO(d2))
# ── E-11 孤儿件如实标「未登记」（阿开 2026-10-26 拍甲）──
#   ★ 为什么必须标：孤儿件没有 pack_files 记录 ⇒ 上传人/上传时间都不知道。
#     编一个（比如拿文件 mtime 当上传时间）就是假信息 ——
#     客户会以为这个文件是某人在某时传的。宁可写「未登记」。
ck("E-11a ★孤儿件归附件（无交付物记录 ⇒ 不是干出来的东西）",
   any("野文件.txt" in x and "/附件/" in x for x in z2.namelist()),
   [x for x in z2.namelist() if "野文件" in x])

ck("E-11b ★孤儿件在上传清单里上传人写「未登记」（不编造）",
   "（未登记）" in z2.read([x for x in z2.namelist() if x.endswith("上传清单.csv")][0])
   .decode("utf-8-sig"),
   z2.read([x for x in z2.namelist() if x.endswith("上传清单.csv")][0]).decode("utf-8-sig")[:300])

# ── E-12 重复 sha256 标「重复于」（阿开 2026-10-26 拍乙）──
#   造两份内容相同的文件（不同位置），验证清单里第二份标了「重复于」
_mkfile(TMP, ACCT, "execution", "task-ddd", "同一份A.txt", b"same-bytes")
_mkfile(TMP, ACCT, "management", "task-ddd", "同一份B.txt", b"same-bytes")
_pf3 = [
    {"interaction_id": "task-ddd", "filename": "同一份A.txt", "uploaded_by": "a",
     "uploaded_at": "2026-10-25T01:00:00Z", "node_id": "", "seat": "execution"},
    {"interaction_id": "task-ddd", "filename": "同一份B.txt", "uploaded_by": "b",
     "uploaded_at": "2026-10-25T02:00:00Z", "node_id": "", "seat": "management"},
]
d3, n3, t3, m3 = packs.export_project_zip(
    TMP, ACCT, PROJ,
    [{"taskId": "ddd", "title": "重复测试", "status": "posted", "detail": "",
      "created_by": "o", "claimed_by": "", "created_at": "", "done_at": "",
      "result": "", "blocked_reason": "", "interactionIds": ["task-ddd"]}],
    store_like=FakeStore(), pack_files=_pf3, deliverables=[])
z3 = zipfile.ZipFile(io.BytesIO(d3))
_up3 = z3.read([x for x in z3.namelist() if x.endswith("上传清单.csv")][0]).decode("utf-8-sig")
_up3_rows = list(csv.reader(io.StringIO(_up3)))

ck("E-12a ★上传清单有「重复于」列",
   "重复于" in _up3.splitlines()[0], _up3.splitlines()[0])

ck("E-12b ★同 sha256 的第二份标出「与第 N 行同一份文件」",
   any("同一份文件" in c for r in _up3_rows for c in r),
   [r[-1] for r in _up3_rows[1:]])

ck("E-12c ★两份**都保留**（不去重：谁传的、何时传的是两份事实）",
   len([x for x in z3.namelist() if "同一份" in x]) == 2,
   [x for x in z3.namelist() if "同一份" in x])

ck("E-12d 第一份不标「重复于」（不指成环）",
   _up3_rows[1][-1] == "", _up3_rows[1][-1] if len(_up3_rows) > 1 else "无行")

ck("E-10a ★磁盘有、索引无的孤儿件**也要进包**（完整性优先于归类）",
   any("野文件.txt" in x for x in z2.namelist()),
   z2.namelist()[:5])

# ══ 汇总 ══
print("\n" + "─" * 58)
if not FAILS:
    print(f"\033[32m✅ 归档包结构判据全绿：{PASS}/{PASS}\033[0m")
    sys.exit(0)
else:
    print(f"\033[31m❌ 失败 {len(FAILS)}/{PASS + len(FAILS)}\033[0m")
    for f in FAILS:
        print(f"   · {f}")
    sys.exit(1)
