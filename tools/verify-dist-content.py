r"""核对 dist 三个包的内部身份：包名、版本、以及关键改动是否真的打进去了。

为什么单独写成文件而不是 bash heredoc：
  heredoc 里写 `\\u` 会被 shell 吞成 `\u`，`re` 直接报
  `PatternError: incomplete escape \u`。本项目已经踩过两次，固定用具名脚本。
"""
import json
import re
import tarfile
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'

BASE_PKGS = ['kaipu-workstation.tgz', 'kaipu-platform.tgz', 'kaipu-wisdom-team.tgz']
WANT = {
    'kaipu-workstation.tgz': ['notifyAgent', '谁在岗谁领', 'agentChoices', 'holderUnknownText'],
    'kaipu-platform.tgz': ['山海已签', 'INVITE_SEATS'],
    'kaipu-wisdom-team.tgz': [],
}

for name in BASE_PKGS:
    f = DIST / name
    raw = f.read_bytes()
    with tarfile.open(f) as t:
        pj = json.loads(t.extractfile('package/package.json').read().decode('utf-8'))
        # 把所有 js 拼起来查（client.js 是 tsc 产物，中文是 \uXXXX）
        blob = ''
        for m in t.getmembers():
            if m.name.endswith('.js'):
                blob += t.extractfile(m).read().decode('utf-8', 'replace')
    # 解 unicode 转义（用 chr 拼，避免在正则里写反斜杠 u）
    blob = re.sub('\\\\u([0-9a-fA-F]{4})', lambda x: chr(int(x.group(1), 16)), blob)
    hunks = []
    for kw in WANT[name]:
        hunks.append('%s=%s' % (kw, '有' if kw in blob else '无'))
    print('%-26s %-30s %-7s %8d B  sha256=%s  %s' % (
        name, pj.get('name'), pj.get('version'), len(raw),
        hashlib.sha256(raw).hexdigest()[:16], ' · '.join(hunks)))
