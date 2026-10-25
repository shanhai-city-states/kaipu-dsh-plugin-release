#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""校验 dist 里三个 tgz：内容是否吃到 HEAD 改动 + 资产 sha256。
★ 为什么要解码 \\uXXXX：tsc 产物把中文转义成 \\u 序列，直接查中文永远 0 命中（本项目老坑）。"""
import re
import sys
import tarfile
import hashlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'

KW = {
    'platform': ['\u26e8 \u5f85\u7b7e', '\u26e8 \u5c71\u6d77\u5df2\u7b7e', 'INVITE_SEATS'],
}


def decode(text: str) -> str:
    return re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), text)


def read_member(tgz: pathlib.Path, member: str):
    with tarfile.open(tgz) as tf:
        try:
            f = tf.extractfile(member)
        except KeyError:
            return None
        return None if f is None else f.read().decode('utf-8', 'replace')


def main() -> int:
    ok = True
    checks = [
        ('kaipu-platform.tgz', 'package/lib/client/SeatLampPanel.js'),
        ('kaipu-platform.tgz', 'package/lib/client.js'),
        ('kaipu-workstation.tgz', 'package/lib/client.js'),
    ]
    for asset, member in checks:
        tgz = DIST / asset
        raw = read_member(tgz, member)
        if raw is None:
            print('[MISS] %s :: %s' % (asset, member))
            ok = False
            continue
        text = decode(raw)
        m = re.search(r'SEAT_ORDER\s*=\s*\[[^\]]*\]', text)
        line = ['  %s :: %s (%d bytes)' % (asset, member, len(raw))]
        if m:
            line.append('    SEAT_ORDER = %s' % m.group(0).split('=', 1)[1].strip())
            if "'signature'" not in m.group(0).split(',')[0]:
                ok = False
                line.append('    !! signature 不在首位')
        for kw in KW.get('platform', []):
            line.append('    %s x%d' % (kw, text.count(kw)))
        line.append('    \u5f85\u6307\u6d3e x%d' % text.count('\u5f85\u6307\u6d3e'))
        print('\n'.join(line))

    print('\n--- assets ---')
    for p in sorted(DIST.glob('*.tgz')):
        b = p.read_bytes()
        print('  %-24s %8d bytes  sha256=%s' % (p.name, len(b), hashlib.sha256(b).hexdigest()))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
