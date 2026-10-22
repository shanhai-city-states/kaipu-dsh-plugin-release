#!/usr/bin/env node
/**
 * 山海·开铺 · 场地插件 · **错误码文案判据**（Step 7 · 静态层）
 * =====================================================================
 * 断言「14 条码 → 用户语言」真的接通了，且**不允许裸 code 外泄**。
 *
 * ★★ 两条设计纪律
 *
 *   1. **期望值从 `contracts/v1.1/errors.json` 读**，不在本文件里抄一遍。
 *      抄一遍 = 多一个事实源 = 改契约时这里悄悄过期，而"测试全绿"。
 *      （本仓已有机器生成 + 漂移断言的先例，这里沿用同一套姿势。）
 *
 *   2. **导入契约的 ESM 产物**（`lib/index.js`）。为什么不导 `lib-cjs`：
 *      契约包 `"type": "module"` ⇒ Node 会把 `lib-cjs/*.js` 当 ESM 解析，
 *      里面全是 `exports.x =` ⇒ 一执行就炸。**`lib-cjs` 只给 bundler 当文本读**。
 *
 * 用法：node tools/check-error-copy.mjs
 * 退出码：0 = 全过；1 = 有 FAIL
 */
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const JSON_PATH = join(ROOT, 'contracts/v1.1/errors.json')
const LIB_ENTRY = join(ROOT, 'packages/contract/lib/index.js')

const spec = JSON.parse(readFileSync(JSON_PATH, 'utf8'))
const contract = await import(pathToFileURL(LIB_ENTRY).href)
const { translateError, isReroutableError, extractErrorCode, duplicatePollPath, ERROR_CODES, ERROR_FALLBACK } = contract

let failed = 0
const say = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failed++
}

console.log(`错误码文案判据（期望值读自 ${relative(ROOT, JSON_PATH)}）\n`)

/* ── ① 条数对账：生成产物与 JSON **不许有一处差异** ── */
console.log('── ① 对账：契约 JSON ↔ 生成产物 ──')
say(ERROR_CODES.length === spec.codes.length, `码条数一致（JSON ${spec.codes.length} / 产物 ${ERROR_CODES.length}）`)
const jsonCodes = spec.codes.map((c) => c.code).sort()
const libCodes = ERROR_CODES.map((c) => c.code).sort()
say(JSON.stringify(jsonCodes) === JSON.stringify(libCodes), '码名集合一致（顺序无关）')

/* ── ② 14 条逐条翻译 ── */
console.log('\n── ② 逐条翻译（14 条，期望值来自 JSON 的 uiText）──')
for (const c of spec.codes) {
  const got = translateError(c.code)
  const same = got === c.uiText
  say(same, `${c.code.padEnd(20)} → ${same ? `「${got}」` : `≠ 期望「${c.uiText}」（实际「${got}」）`}`)
}

/* ── ③ ★ 裸 code 不许外泄（001 §4.2 客户端纪律） ── */
console.log('\n── ③ 裸 code 外泄检查（不许把技术报错印给用户）──')
const leaks = spec.codes.filter((c) => translateError(c.code).includes(c.code))
say(leaks.length === 0, `没有任何一条译后文案里含它自己的 code${leaks.length > 0 ? `（泄漏：${leaks.map((l) => l.code).join(', ')}）` : ''}`)
const snakey = spec.codes.filter((c) => /[a-z]+_[a-z]+/.test(translateError(c.code).replace(/[（(].*?[)）]/g, '')))
say(snakey.length === 0, `译后文案里不含 snake_case 形态的裸码${snakey.length > 0 ? `（命中：${snakey.map((s) => s.code).join(', ')}）` : ''}`)

/* ── ④ 兜底：未知码 / undefined / 畸形入参 ── */
console.log('\n── ④ 兜底（未知码不许把裸码回显）──')
const unknown = 'some_unmapped_code_xyz'
say(translateError(unknown) === spec.fallback.uiText, `未知码 → 兜底文案「${spec.fallback.uiText}」`)
say(!translateError(unknown).includes(unknown), '  且兜底文案里**没有**回显那个未知码')
say(translateError(undefined) === spec.fallback.uiText, 'undefined → 兜底文案（不抛）')
say(ERROR_FALLBACK.uiText === spec.fallback.uiText, '产物里的 ERROR_FALLBACK 与 JSON 一致')

/* ── ⑤ "另走一条路"的两个码：必须与契约的 clientAction 对齐 ── */
console.log('\n── ⑤ 可改道的码（契约 clientAction：不弹错，另走一条路）──')
const withAction = spec.codes.filter((c) => typeof c.clientAction === 'string').map((c) => c.code).sort()
const reroutable = spec.codes.filter((c) => isReroutableError(c.code)).map((c) => c.code).sort()
say(
  JSON.stringify(withAction) === JSON.stringify(reroutable),
  `isReroutableError 与"契约里写了 clientAction 的码"完全一致（${reroutable.join(', ') || '无'}）`,
)
for (const code of withAction) {
  say(isReroutableError(code), `  ${code} 被标为可改道`)
}

/* ── ⑥ 错误体解析的容错（代理返回 HTML / 空体 / 畸形体都不许抛）── */
console.log('\n── ⑥ 错误体解析容错 ──')
const cases = [
  ['正常体', { error: { code: 'not_found' } }, 'not_found'],
  ['无 code', { error: { message: 'x' } }, undefined],
  ['不是对象', 'plain text from a proxy', undefined],
  ['HTML', '<html>502 Bad Gateway</html>', undefined],
  ['null', null, undefined],
  ['空对象', {}, undefined],
]
for (const [label, body, want] of cases) {
  let got
  try {
    got = extractErrorCode(body)
  } catch (err) {
    say(false, `${label} → 抛了异常（不该抛）：${err.message}`)
    continue
  }
  say(got === want, `${label} → ${String(got)}`)
}
say(duplicatePollPath({ poll: '/scene/run/req-1' }) === '/scene/run/req-1', 'duplicate_request 的 detail.poll 能取到')
say(duplicatePollPath({}) === undefined, '没有 poll 时返回 undefined（不抛）')

/* ── ⑦ ★ 待确认文案要显式提醒（不许把"待确认"当"已定稿"）── */
const pending = spec.codes.filter((c) => c.textStatus !== 'confirmed')
if (pending.length > 0) {
  console.log('\n── ⑦ 提醒：以下文案的 textStatus **不是 confirmed** ──')
  for (const c of pending) console.log(`  ! ${c.code.padEnd(20)} textStatus=${c.textStatus}（${c.textSource}）`)
  console.log('  ⇒ 它们可以先用，但**提 PR / 对外前需星月确认**（文案是产品口径，不是技术细节）。')
}

console.log(`\n${failed === 0 ? '✓ 全绿' : `✗ ${failed} 项未过`}`)
process.exit(failed === 0 ? 0 : 1)
