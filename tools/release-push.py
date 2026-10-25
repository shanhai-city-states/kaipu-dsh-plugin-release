#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""release 仓发布助手 · 083-r1

做三件事，都可以单独跑：
    python tools/release-push.py status                    # 看现有 release
    python tools/release-push.py verify  <tag>             # 逐字节核对线上资产 == 本地 dist
    python tools/release-push.py push    <tag>             # 建/更新 release 并上传三件

★ 为什么要这个脚本（星月上一轮的验收教训）：
  「0.2.81/0.2.82 出现过仓库版本 ≠ 线上资产」—— 只看 CI 绿没有意义，
  **必须把线上资产拉回来重算 sha256，与本地 dist 逐字一致**才算发出去。
  verify 子命令就是干这个：`releases/latest/download/...` 实际下载 → sha256 → 比对。

★ 凭据：走 git-credential-manager（Windows 凭据管理器），不在任何文件里落盘、不打印。
"""
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import pathlib

REPO = 'shanhai-city-states/kaipu-dsh-plugin-release'
ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
ASSETS = ['kaipu-platform.tgz', 'kaipu-workstation.tgz', 'kaipu-wisdom-team.tgz']


def token() -> str:
    p = subprocess.run(
        ['git', 'credential', 'fill'],
        input='protocol=https\nhost=github.com\n\n',
        capture_output=True, text=True,
    )
    for line in p.stdout.splitlines():
        if line.startswith('password='):
            return line[len('password='):]
    raise SystemExit('拿不到 GitHub 凭据（git-credential-manager 没返回 password）')


def api(path, method='GET', body=None, raw=None, ctype=None):
    """path 可以是 `/repos/...` 相对路径，也可以是完整 URL（资产上传必须走 uploads.github.com）。"""
    headers = {
        'Authorization': 'Bearer ' + token(),
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'kaipu-release-083r1',
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if raw is not None:
        data = raw
        headers['Content-Type'] = ctype or 'application/octet-stream'
    url = path if path.startswith('http') else 'https://api.github.com' + path
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            txt = r.read()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:400].decode('utf-8', 'replace')


def sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def cmd_status():
    st, rel = api('/repos/%s/releases?per_page=5' % REPO)
    print('GET releases ->', st)
    if not isinstance(rel, list):
        print(rel)
        return
    for r in rel:
        print('  tag=%s  draft=%s prerelease=%s  assets=%s'
              % (r.get('tag_name'), r.get('draft'), r.get('prerelease'),
                 [a['name'] for a in r.get('assets', [])]))


def fetch(url, tries=4):
    """下载线上资产。★ 不用系统代理：本机 127.0.0.1:61830 常拦 GitHub 大文件，
    实测报 `SSL: UNEXPECTED_EOF_WHILE_READING`。直连 + 重试更稳。"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'kaipu-release-083r1'})
            with opener.open(req, timeout=180) as r:
                return r.read()
        except Exception as e:      # noqa: BLE001 —— 网络层什么都可能抛，统一重试
            last = e
            import time
            time.sleep(1.5 * (i + 1))
    raise last


def cmd_verify(tag):
    """把线上资产拉回来重算 sha256 —— 这才是「发没发对」的唯一证据。"""
    base = 'https://github.com/%s/releases/latest/download/' % REPO
    ok = True
    for name in ASSETS:
        local = DIST / name
        if not local.exists():
            print('  ✗ 本地缺 %s' % name)
            ok = False
            continue
        lh = sha256(local)
        try:
            body = fetch(base + name)
        except Exception as e:      # noqa: BLE001
            print('  ✗ %-26s 下载失败：%s' % (name, str(e)[:110]))
            ok = False
            continue
        rh = hashlib.sha256(body).hexdigest()
        same = rh == lh
        ok = ok and same
        lsize = local.stat().st_size
        print('  %s %-26s 线上 %8d B  %s…  本地 %8d B  %s…'
              % ('✓' if same else '✗', name, len(body), rh[:16], lsize, lh[:16]))
    print('\n%s' % ('✓ 线上资产与本地 dist 逐字一致' if ok else '✗ 不一致 —— 这就是星月说的「漏发」，别当发成功了'))
    return 0 if ok else 1


def cmd_push(tag):
    st, rel = api('/repos/%s/releases/tags/%s' % (REPO, tag))
    if st == 404:
        st, rel = api('/repos/%s/releases' % REPO, method='POST', body={
            'tag_name': tag,
            'name': tag,
            'body': '083-r1 · 派活可点名 Agent（0.2.85）\n\n'
                    '- workstation 0.2.84 → 0.2.85：新建任务表单「顺手通知谁」+ 卡片 ＋N 徽标\n'
                    '- platform / wisdom 同批重打（内容未变，sha256 与上一版一致）',
            'draft': False,
            'prerelease': False,
        })
        if st not in (200, 201):
            print('建 release 失败', st, rel)
            return 1
        print('✓ 新建 release %s' % tag)
    elif st == 200:
        print('· release %s 已存在，改为覆盖资产' % tag)
    else:
        print('查 release 失败', st, rel)
        return 1

    upload_url = rel['upload_url'].split('{')[0]
    for name in ASSETS:
        local = DIST / name
        # 同名资产先删（GitHub 不允许重名上传）
        for a in rel.get('assets', []):
            if a['name'] == name:
                api('/repos/%s/releases/assets/%s' % (REPO, a['id']), method='DELETE')
                print('   · 删旧资产 %s' % name)
        body = local.read_bytes()
        st2, out = api(upload_url + '?name=' + urllib.parse.quote(name), method='POST',
                       raw=body, ctype='application/gzip')
        print('   %s 上传 %-26s %8d B  %s'
              % ('✓' if st2 in (200, 201) else '✗', name, len(body),
                 '' if st2 in (200, 201) else out))
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == 'status':
        cmd_status()
    elif cmd == 'verify':
        sys.exit(cmd_verify(sys.argv[2] if len(sys.argv) > 2 else ''))
    elif cmd == 'push':
        sys.exit(cmd_push(sys.argv[2]))
    else:
        raise SystemExit(__doc__)
