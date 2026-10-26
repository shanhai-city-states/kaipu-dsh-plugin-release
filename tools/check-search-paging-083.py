#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check-search-paging-083.py —— 台阶⑤ 判据（搜索框 + 分页接口）

★ 阿开 2026-10-26 定的纪律：**判据先红后绿** —— 施工前就写好，未实现项保持红，
  实现后转绿。不许做完再补判据（那是循环论证）。

★ 教训（台阶④ 三次假绿）：
  1. 判据**不许全文 includes** —— 一个字符串在全文件出现 N 次时，改掉一处仍匹配别处。
     ⇒ 必须先用结构边界切出区域，只在区域内验。
  2. 切片**不许用固定字符数** —— 会越界到别的组件。
     ⇒ 必须用结构边界（函数定义、块起止）。
  3. 判据**必须先剥注释** —— 注释里写了同样的关键字，会匹配到注释而放过真代码。
     ⇒ 用 strip_comments() 后的代码验。

跑法：python3 check-search-paging-083.py
退出码：0 = 全绿；1 = 有红
"""
import re
import sys

GW = '/opt/shanhai-toolkit-opensource/modules/08-workshop/kai-pu/src/gateway.py'
CL = '/root/work/083-开铺/repo/kaipu-dsh-plugin/packages/plugin-workstation/src/client/WorkstationPanel.tsx'
LIVE = '/root/work/083-开铺/repo/kaipu-dsh-plugin/packages/plugin-workstation/src/client/live.ts'

results = []


def chk(pid, name, ok, detail=''):
    results.append((pid, name, bool(ok), detail))


def strip_comments(src):
    """剥掉 JS/TS/Python 通用注释，只留代码。
    ★ 台阶④ 教训：注释里的关键字会骗过判据。"""
    out = []
    i, n = 0, len(src)
    in_s, in_d, in_t = False, False, False   # ' " `
    in_lc, in_bc = False, False
    while i < n:
        c = src[i]
        nx = src[i + 1] if i + 1 < n else ''
        if in_lc:
            if c == '\n':
                in_lc = False
                out.append(c)
            i += 1
            continue
        if in_bc:
            if c == '*' and nx == '/':
                in_bc = False
                i += 2
                continue
            if c == '\n':
                out.append(c)
            i += 1
            continue
        if in_s:
            out.append(c)
            if c == '\\':
                out.append(nx)
                i += 2
                continue
            if c == "'":
                in_s = False
            i += 1
            continue
        if in_d:
            out.append(c)
            if c == '\\':
                out.append(nx)
                i += 2
                continue
            if c == '"':
                in_d = False
            i += 1
            continue
        if in_t:
            out.append(c)
            if c == '\\':
                out.append(nx)
                i += 2
                continue
            if c == '`':
                in_t = False
            i += 1
            continue
        # 非字符串
        if c == '/' and nx == '/':
            in_lc = True
            i += 2
            continue
        if c == '/' and nx == '*':
            in_bc = True
            i += 2
            continue
        if c == '#':          # Python 行注释（本文件里 # 只可能是注释）
            in_lc = True
            i += 1
            continue
        if c == "'":
            in_s = True
            out.append(c)
            i += 1
            continue
        if c == '"':
            in_d = True
            out.append(c)
            i += 1
            continue
        if c == '`':
            in_t = True
            out.append(c)
            i += 1
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def region(src, start_pat, end_pat, end_after=True):
    """按结构边界切区域：从 start_pat 匹配处起，到 end_pat 第一次匹配处止。
    ★ 台阶④ 教训：不许用固定字符数切片，会越界到别的组件。"""
    m = re.search(start_pat, src)
    if not m:
        return None
    tail = src[m.start():]
    if end_pat:
        m2 = re.search(end_pat, tail)
        if not m2:
            return None
        return tail[:m2.end()] if end_after else tail[:m2.start()]
    return tail

# ═══════════════════════════════════════════════════════
# A 组 · 后端分页接口（S-1 ~ S-5）
# ═══════════════════════════════════════════════════════

gw = open(GW, encoding='utf-8').read()
gw_code = strip_comments(gw)

# S-1 解析 limit/offset 参数
chk('S-1', '后端解析 limit / offset 参数',
    re.search(r'qs\.get\(\s*["\']limit["\']', gw_code) and
    re.search(r'qs\.get\(\s*["\']offset["\']', gw_code),
    'tasks_list 里要有 limit 与 offset 的取参')

# S-2 切片在 visible 定稿之后（不是 SQL 层）——★ 核心判据
#     做法：定位 visible 的最终定稿点（tags 过滤块之后）与 return 之间，
#     切片必须落在这段里；且 SELECT 语句里不许出现 LIMIT
m_sql = re.search(r'sql = \(\s*["\']SELECT task_id[^)]*?\)', gw_code, re.S)
sql_has_limit = bool(m_sql and re.search(r'LIMIT', m_sql.group(0), re.I))
chk('S-2a', '★ SQL 层不许出现 LIMIT（否则 required_tags/tags 过滤会让分页错位）',
    m_sql is not None and not sql_has_limit,
    'SQL 里发现 LIMIT' if sql_has_limit else '')

# S-2b 切片用 visible[offset:offset+limit]
chk('S-2b', '★ 切片用 visible[offset : offset+limit]（在 Python 侧定稿后）',
    bool(re.search(r'\[\s*offset\s*:\s*offset\s*\+\s*limit\s*\]', gw_code)) or
    bool(re.search(r'\[\s*_?off\s*:\s*_?off\s*\+\s*_?lim\s*\]', gw_code)),
    '没找到 visible 的切片表达式')

# S-2c total = 切片前的 visible 长度
#     ★★ 这条判据我第一版写错了（要求 len(rows)），实现时才发现：
#       `rows` 是 SQL 全量（含 required_tags 过滤掉的、该 agent 看不到的），
#       `total` 必须取 `visible`（过滤后）—— 否则 total 大于实际可翻条数，
#       前端以为有下一页、点了却是空。**判据跟着设计走，不反过来绑设计。**
m_tl = region(gw_code, r'def tasks_list\(self, req, m\)', r'def task_files\(self, req, m\)', end_after=False)
chk('S-2c', '★ total 取切片前的 visible 长度（不是 rows）',
    bool(m_tl and re.search(r'total\s*=\s*len\(\s*visible\s*\)', m_tl)
         and not re.search(r'total\s*=\s*len\(\s*rows\s*\)', m_tl)),
    'tasks_list 里没找到 total = len(visible)')

# S-3 counts 仍从 rows 算，不从切片后的 visible 算
m_counts_region = region(gw_code, r'counts = \{"open"', r'return 200')
chk('S-3', 'counts 仍从 rows 遍历（不受分页影响）',
    bool(m_counts_region and re.search(r'for\s+r\s+in\s+rows\s*:', m_counts_region)),
    'counts 计算区里没有 for r in rows')

# S-4 返回体带 total（★ 用「整段 return 字典」取，不用 ) 截断 —— 会跨行截错）
m_ret = None
if m_tl:
    m_ret = region(m_tl, r'return 200, \{"tasks"', r'"groups": groups\}')
chk('S-4', 'tasks_list 返回体带 total 字段',
    bool(m_ret and re.search(r'["\']total["\']', m_ret)),
    'tasks_list 的 return 体里没有 total')

# S-5 上限保护（limit 不许无限大）
chk('S-5', 'limit 有上限保护（防一次拉全库）',
    bool(re.search(r'min\(\s*(?:max\()?\s*limit', gw_code)) or
    bool(re.search(r'limit\s*=\s*min\(', gw_code)) or
    bool(re.search(r'if\s+limit\s*>\s*\d+', gw_code)),
    '没有 min(limit, N) 之类的上限')

# ═══════════════════════════════════════════════════════
# B 组 · live.ts 传参（L-1 ~ L-2）
# ═══════════════════════════════════════════════════════

live = open(LIVE, encoding='utf-8').read()
live_code = strip_comments(live)
m_live = region(live_code, r'export async function loadTasks', r'\n\}')
#     ★ 修正：只验「有 limit 字样」会假绿 —— `page?: {limit?...}` 形参声明里就有。
#       必须验**真的把值写进 query**那一步（`query.limit = page.limit`）。
chk('L-1', 'loadTasks 真的把 limit 写进 query（不只是声明形参）',
    bool(m_live and re.search(r'query\.limit\s*=\s*page\.limit', m_live)),
    'loadTasks 里没有 query.limit = page.limit')
chk('L-2', 'loadTasks 默认不带 limit（前端默认全量，零行为变化）',
    bool(m_live and not re.search(r'limit\s*[:=]\s*\d+\s*(?:,|\})', m_live)),
    'loadTasks 里出现硬编码默认 limit')

# ═══════════════════════════════════════════════════════
# C 组 · 前端搜索框（C-1 ~ C-6）
# ═══════════════════════════════════════════════════════

cl = open(CL, encoding='utf-8').read()
cl_code = strip_comments(cl)

# C-1 有搜索框 input
#     ★ 正则必须认 `placeholder={...}` 这种**表达式**写法（本项目就是这么写的），
#       只认 `placeholder="..."` 会漏 —— 第一版判据栽在这。
#     ★ 修正：全文件有 10 处「关键词」（别的输入框的说明文字也有），全文搜必假绿。
#       必须锚定**搜索框那一处**：placeholder 由 searchMode 三元决定、且两个分支都含关键词。
#     ★★ 2026-10-26 改判据（跟着设计走）：项目模式的 placeholder 已从「关键词」改成
#        「🔍 项目名…」（0.2.106 起）—— 因为项目模式搜的就是**项目名**，不是关键词。
#        ⇒ 判据改为「两分支确实分别对应项目/任务」，不再要求两分支都含「关键词」。
#        ★ 不许放宽成「有 placeholder 就算过」：那样删掉任务分支也绿（等于不判）。
chk('C-1', '有搜索输入框（placeholder 按 searchMode 分别给项目/任务）',
    bool(re.search(r"placeholder=\{searchMode === 'project' \?\s*'[^']*(项目名|关键词)[^']*'\s*:\s*'[^']*关键词", cl_code)),
    '没找到按 searchMode 分别给项目/任务的搜索框 placeholder')

# C-2 两个单选（项目 / 任务）
chk('C-2', '有项目/任务两个单选（radio 或等价按钮）',
    bool(re.search(r'["\']项目["\']', cl_code)) and bool(re.search(r'["\']任务["\']', cl_code))
    and bool(re.search(r'searchMode|searchScope|scope.*project|mode.*task', cl_code)),
    '没找到 searchMode/searchScope 之类的模式状态')

# C-3 任务模式跨全部项目搜（不受 projFilter 限制）——★ 核心判据
#     做法：定位任务模式的过滤表达式，它必须用的是 tasks 而不是 visibleTasks
m_taskmode = region(cl_code, r'searchMode\s*===\s*["\']task["\']', r'\n\s*\}\s*else', end_after=False)
chk('C-3', '★ 任务模式不受当前项目限制（从 tasks 过滤，不从 visibleTasks）',
    bool(m_taskmode and re.search(r'\btasks\b', m_taskmode)
         and not re.search(r'visibleTasks\s*\.\s*filter', m_taskmode)),
    '任务模式区里没从 tasks 过滤，或仍在用 visibleTasks')

# C-4 切换模式时关键词保留（kw 状态独立于模式）
chk('C-4', '★ 关键词状态独立存（切模式不清空）',
    bool(re.search(r'const\s*\[\s*(?:kw|keyword|q)\w*\s*,\s*set\w+\s*\]\s*=\s*useState', cl_code)),
    '没找到独立的 kw/keyword useState')

# C-5 任务模式结果仍按四段组织（TASK_SECTIONS 生效）
chk('C-5', '任务模式结果仍按四段组织',
    bool(re.search(r'TASK_SECTIONS', cl_code)),
    '没有 TASK_SECTIONS')

# C-6 卡片带项目名（★ 任务模式与项目模式**共用同一个四段渲染区**）
#     ★ 查实：本项目没有「另起一份搜索结果渲染」，任务模式只是换数据源（searchedTasks），
#       渲染仍是同一处 TASK_SECTIONS 卡片区 ⇒ 项目名在那里传过一次就够。
#     ★ 判据因此要验三件事，缺一不可：
#       ① 卡片区传了 projectName
#       ② 该卡片区喂的是 searchedTasks（否则任务模式搜了也不生效）
#     ③ 任务模式有「全部项目范围」的提示（否则跨项目搜索会让人以为串项目）
#     ★ 切法：定位**第二个** TASK_SECTIONS.map（卡片区；第一个是段头区），
#       从它起取到 `<CardBoundary` 之后的 TaskCard 那一段。
_idx_secs = [m.start() for m in re.finditer(r'TASK_SECTIONS\.map\(\(sec\)', cl_code)]
m_cardarea = None
if len(_idx_secs) >= 2:
    _seg = cl_code[_idx_secs[1]:]
    _m_end = re.search(r'<CardBoundary[^>]*>\s*<TaskCard[^>]*/>', _seg, re.S)
    m_cardarea = _seg[: _m_end.end()] if _m_end else _seg[:6000]
chk('C-6a', '★ 卡片区传 projectName（任务模式才能看出属于哪个项目）',
    bool(m_cardarea and re.search(r'projectName\s*=\s*\{\s*projectNameOf', m_cardarea)),
    '卡片区没传 projectName')
#     ★ 修正：`searchedTasks.filter(...)` 在文件里有**两处文本完全相同**
#       （6310 段头区 / 6377 卡片区）⇒ 全文搜或取第一处都会假绿/假红。
#       必须锚定：m_cardarea 本身是「从第二个 TASK_SECTIONS.map 起」切出来的，
#       再验它内部**既有** searchedTasks 又有 TaskCard（两者同时在场才是卡片区）。
chk('C-6b', '★ 卡片区数据源是 searchedTasks（搜索对四段生效）',
    bool(m_cardarea and re.search(r'const list = searchedTasks\.filter', m_cardarea)
         and re.search(r'<TaskCard\b', m_cardarea)),
    '卡片区仍用 visibleTasks，或切片没锚到卡片区')
chk('C-6c', '任务模式显示「全部项目范围」提示（防误以为串项目）',
    bool(re.search(r'全部项目(范围|)', cl_code) and re.search(r'searchMode === [\'"]task[\'"]', cl_code)),
    '没有范围提示')

# ═══════════════════════════════════════════════════════
# 汇总
# ═══════════════════════════════════════════════════════
green = sum(1 for r in results if r[2])
total = len(results)
print('=' * 66)
print('台阶⑤ 判据 · 搜索框 + 分页接口（check-search-paging-083）')
print('=' * 66)
for pid, name, ok, detail in results:
    mark = '🟢' if ok else '🔴'
    print(f'{mark} {pid:6s} {name}')
    if not ok and detail:
        print(f'         ↳ {detail}')
print('-' * 66)
print(f'  通过 {green}/{total}')
if green < total:
    print(f'  🔴 还有 {total - green} 条未绿')
print('=' * 66)
sys.exit(0 if green == total else 1)
