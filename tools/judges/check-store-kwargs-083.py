#!/usr/bin/env python3
"""check-store-kwargs-083.py —— `self.store.*(...)` 传的参数，Store 方法签名里都有吗

═══ 为什么要有这条判据 ═══
2026-10-26 事故：给导出包加「工位编号」分目录时，`node_id` 四处该改：
    ① 表列 `pack_files.node_id`          ✅ 改了
    ② INSERT 语句                         ✅ 改了
    ③ 调用方 `gateway._pack_upload_raw`   ✅ 改了
    ④ Store 方法签名                      ❌ **漏了**
⇒ `TypeError: Store.insert_pack_file_checked() got an unexpected keyword argument 'node_id'`
⇒ **`POST /packs/*/files` 整条写路径 500**（阿舟传四个文件、试七个 iid 全挂，一个字节没上去）

★★ 为什么 py_compile / import 都抓不到
   Python 的关键字参数不匹配是**运行时**错误，不是编译错误。语法完全合法。
   只有真的发出一次请求，才会炸。而「真发一次请求」正是最容易漏的一步 ——
   所以我改了 DB、改了 SQL、改了调用方，就以为改完了。
★★ 为什么不能靠 grep `node_id`
   全仓 `node_id` 出现 117 次，grep 出来一片，看不出哪处断了。
   必须做**静态签名-调用配对分析**：解析 AST，拿 Store 的真实参数表去核每个调用点。

═══ 判据口径 ═══
  对 gateway.py（及其它后端模块）里每个 `<expr>.store.<method>(...)` 调用：
    · 取 Store 类里该 method 的参数名集合（含 kwonly）
    · 若该 method 有 **kwargs ⇒ 放行（签名开放，不判）
    · 否则每个 keyword 实参名必须在参数集合里，否则 **红**
  另核 `store.py` 内部：方法体里用到的、既不是参数也不是局部/全局名的裸标识符
  —— 这一半留给人工（静态推断局部变量易误报），本判据只做**参数配对**这一件确定的坏事。

═══════════════════════════════════════════════════════════════
用法：
  python3 tools/judges/check-store-kwargs-083.py            # 查，全绿 exit 0
  python3 tools/judges/check-store-kwargs-083.py --backend=<dir>   # 指定后端目录
退出码：0 = 全绿；1 = 有「传了签名没有的参数」；2 = 判据自身无法判定（口径不明，拒绝给结论）
"""
import argparse
import ast
import os
import sys

DEFAULT_BACKEND = "/opt/shanhai-toolkit-opensource/modules/08-workshop/kai-pu"

# 后端里凡是「持有 Store 实例」的属性名，都要核（self.store / self._store / ...）
STORE_ATTRS = {"store", "_store"}


def parse_store_sigs(store_path):
    """→ {method_name: (param_set, has_kwargs, class_name, lineno)}"""
    with open(store_path, encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=store_path)
    sigs = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        if "Store" not in node.name:          # 只收 Store 系类（Store / PackStore / ...）
            continue
        for fn in node.body:
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            a = fn.args
            params = [x.arg for x in a.args] + [x.arg for x in a.kwonlyargs]
            if a.vararg is not None:
                continue                       # *args 存在 ⇒ 位置参数名不可靠，跳过
            sigs[fn.name] = (set(params), a.kwarg is not None, node.name, fn.lineno)
    return sigs


def scan_calls(py_path, sigs):
    """→ [(method, bad_kw, call_lineno, def_class, def_line)]"""
    with open(py_path, encoding="utf-8") as f:
        src = f.read()
    tree = ast.parse(src, filename=py_path)
    bad = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not isinstance(fn, ast.Attribute):
            continue
        owner = fn.value
        if not isinstance(owner, ast.Attribute) or owner.attr not in STORE_ATTRS:
            continue
        m = fn.attr
        if m not in sigs:
            continue
        params, has_kwarg, cls, def_line = sigs[m]
        if has_kwarg:
            continue
        for kw in node.keywords:
            if kw.arg is None:                 # **dict 展开，静态无法判定
                continue
            if kw.arg not in params:
                bad.append((m, kw.arg, node.lineno, cls, def_line))
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default=DEFAULT_BACKEND)
    args = ap.parse_args()

    store_path = os.path.join(args.backend, "src", "store.py")
    if not os.path.exists(store_path):
        print(f"✗ 判据口径不明：找不到 {store_path}", file=sys.stderr)
        return 2

    sigs = parse_store_sigs(store_path)
    if not sigs:
        print("✗ 判据口径不明：Store 系类里一个方法都没解析到（类名规则变了？）", file=sys.stderr)
        return 2

    targets = []
    src_dir = os.path.join(args.backend, "src")
    for name in sorted(os.listdir(src_dir)):
        if name.endswith(".py") and name != "store.py":
            targets.append(os.path.join(src_dir, name))

    print("Store 方法签名 ↔ 调用点 参数一致性")
    print(f"  后端：{args.backend}")
    print(f"  Store 方法：{len(sigs)} 个 · 待核调用文件：{len(targets)} 个")

    total_bad = 0
    checked_calls = 0
    for p in targets:
        try:
            bad = scan_calls(p, sigs)
        except SyntaxError as e:
            print(f"  ⚠ {os.path.basename(p)} 语法错，跳过（{e}）")
            continue
        checked_calls += 1
        for m, kw, call_line, cls, def_line in bad:
            total_bad += 1
            print(f"\n  ✗ {os.path.basename(p)}:{call_line}  "
                  f".store.{m}(… {kw}=… )")
            print(f"      但 {cls}.{m} 的签名里没有 `{kw}`（store.py:{def_line}）")
            print(f"      ⇒ 运行时会 `TypeError: unexpected keyword argument '{kw}'`")
            print(f"      ⇒ 整个接口 500。py_compile 完全看不出（语法合法）。")

    print(f"\n  · 核了 {checked_calls} 个文件")
    if total_bad:
        print(f"\n✗ {total_bad} 处「调用方传了、签名没有」—— 这些接口现在一调就 500")
        print("  修：在 store.py 对应方法签名里补上该参数（别忘了 INSERT/SELECT 里也用上它）")
        return 1
    print("\n✓ 全部一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
