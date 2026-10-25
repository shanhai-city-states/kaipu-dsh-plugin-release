"""反向注入：证明 check-join-083b 的判据真能变红（不是关键词命中式的假绿）。

★ 为什么要单独一份：星月每次的原话都是「全绿不算证据，能变红才算」。
   跑完自动还原，源码不应留下任何改动。
"""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = ROOT / 'packages/plugin-workstation/src/client/WorkstationPanel.tsx'
NODE = r'C:/Users/60720/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
JUDGE = ROOT / 'tools/check-join-083b.mjs'

orig = P.read_text(encoding='utf-8')


def run():
    r = subprocess.run([NODE, str(JUDGE)], capture_output=True, text=True, encoding='utf-8')
    lines = (r.stdout or '').split('\n')
    red = [l for l in lines if l.startswith('✗')]
    tail = [l for l in lines if l.startswith('全绿') or l.startswith('有红')]
    return red, (tail[0] if tail else '(无结论)')


cases = []

# 1 · 去掉「拿到就当场落盘」——这是阅后即焚的核心，去掉后第二轮就走丢了
s1 = orig.replace(
    "      if (serverCode.length > 0) safeSet(codeStoreKey(rid), serverCode)\n", ''
)
assert s1 != orig, '注入 1 未命中'
cases.append(('去掉「当场落盘」', s1))

# 2 · 字段名改回 id（星月实测：按 id 取会拿到 undefined）
s2 = orig.replace(
    "const rid = typeof r.data.requestId === 'string' ? r.data.requestId : ''",
    "const rid = typeof r.data.id === 'string' ? r.data.id : ''",
)
assert s2 != orig, '注入 2 未命中'
cases.append(('requestId 改成 id', s2))

# 3 · 删掉 lost 分支（取过没存时界面就没话了，等于让人对着空白发呆）
i = orig.index('{/* ★ lost：approved 但服务端不回码')
j = orig.index('{/* pending：灰色不可点', i)
cases.append(('删掉 lost 分支', orig[:i] + orig[j:]))

# 4 · 申请号用无后缀兼容键（换铺会串台）
s4 = orig.replace(
    'safeSet(reqStoreKey(me.data.accountId, applicantId()), rid)',
    'safeSet(JOIN_REQ_KEY, rid)',
)
assert s4 != orig, '注入 4 未命中'
cases.append(('申请号只写兼容键', s4))

for name, content in cases:
    P.write_text(content, encoding='utf-8')
    red, tail = run()
    print(f'注入「{name}」→ {tail}')
    for l in red:
        print(f'    {l}')

P.write_text(orig, encoding='utf-8')
red, tail = run()
print(f'\n还原后 → {tail}')
print('残留红：', red or '无')
