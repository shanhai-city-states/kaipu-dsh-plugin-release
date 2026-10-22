# contracts/ · 契约的机器可读层

> ★ **本目录是契约的单一事实源（single source of truth）。**
> `packages/contract/src/generated.ts` 由本目录的 JSON **生成**，**不得手改**。

## 为什么这么摆

| 问题 | 解法 |
|:--|:--|
| 契约散在文档里 ⇒ 代码与文档漂移 | 契约落在**机器可读 JSON**，代码**从它生成** |
| 多人手抄错误码 ⇒ 漏一条、写错文案 | 只有一份表，`gen-contract.mjs` 生成 |
| 上游改了契约我不知道 | `node tools/gen-contract.mjs --check` ⇒ **漂移即失败** |

## 文件

| 文件 | 内容 | 来源 |
|:--|:--|:--|
| `v1.1/errors.json` | **14 条错误码** + HTTP 状态 + 中文文案 + `detail` 形状 + 客户端动作 | 001-开发包 §4.2（12 条）+ 004 #8（`426`）+ 阿舟补拟 4 条文案 |
| `v1.1/sse-events.json` | SSE 事件名 / 字段 / 顺序 / 渲染规则 / 恢复接口 | 001-开发包 §4.3 + 004 #2 #4 #5 |
| `v1.1/features.json` | `/me` 的 `features` 六位语义 + 读法 `wisdomTeam ?? expertTeam` | 006 §3.1 + 004 #16 |
| `v1.1/seats.json` | 三个可替换位 + 签名位（不可替换） | 001-A §5.1 + 立项纪要 决议 3 |

## 使用

```bash
node tools/gen-contract.mjs          # 重新生成 packages/contract/src/generated.ts
node tools/gen-contract.mjs --check  # 只校验：有漂移即非 0 退出（Step 1 判据 #3）
```

## ★ 与 `007-阿舟-契约工作基线` 的关系

`../007-阿舟-契约工作基线-v1.1-merged-2026-10-04.md` 是**人读的对账件**（含裁决、理由、编号索引）；
**本目录是它对机器的那一面**。两者不一致时：**以本目录为准修 007，或以 007 为准修本目录，
但绝不允许"两处各写一版"**。

## ★ 上游升版时怎么办

星月发 `客户端包 v1.2`（含 v1.1 全 16 项 + `#3…#6` 形状）后：
1. 逐项对 `007` §二/§三/§四/§五/§六
2. 差异改本目录 JSON
3. 跑 `node tools/gen-contract.mjs`
4. 差异开差异单回给星月（**我不单方改契约**——契约冻结、改走变更单）
