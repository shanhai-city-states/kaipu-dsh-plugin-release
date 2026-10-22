#!/usr/bin/env node
/**
 * G2 补件「越线核查」—— 按星月给出的三条判据，对 src/** 与两个 patch 逐条自查。
 * =====================================================================
 * ★ 星月三条判据（G2 第 1 轮 §六，逐字）：
 *   1. 服务端调用路径 —— 只暴露"调哪个接口、传什么参数" ⇒ **不算越线**（这本就是公开契约）
 *   2. 三个可替换位 + 签名位 —— 写死了商业设计 ⇒ **越线**
 *   3. 数据流向与判据 —— 暴露"数据从哪来、判据是什么、收费点在哪" ⇒ **越线**
 *
 * ★ 为什么我自己先跑一遍：星月明说"不用你说它只是壳"——
 *   我会被当作被审对象，不能既当被告又当法官。所以这份是**自查（自报）**，
 *   目的是①把我方读数交出去供对方独立复核 ②自己先把问题找出来，
 *   而不是等对方挑出来（那才是"被审出问题"）。
 *
 * 用法：node tools/probe/g2-src-line-audit.mjs [--json]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const asJson = process.argv.includes('--json')

/** 收集待审文件：两个包的 src/** + 两个 cordis.patch.yml */
const collect = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else out.push(p)
  }
  return out
}
const files = [
  ...collect(join(ROOT, 'packages/plugin-platform/src')),
  ...collect(join(ROOT, 'packages/plugin-wisdom/src')),
  join(ROOT, 'packages/plugin-platform/cordis.patch.yml'),
  join(ROOT, 'packages/plugin-wisdom/cordis.patch.yml'),
].sort()

/**
 * 三条判据的检测规则。
 * ★ 设计原则：**命中 ≠ 越线** —— 很多命中是"引用了公开契约里的名字"，
 *   那不算越线（判据 1 明说"这本就是公开契约"）。
 *   ⇒ 分两级：`hit`（出现）与 `verdict`（我方定性），且**定性必须写理由**。
 */
const RULES = [
  {
    id: 2,
    name: '三个可替换位 + 签名位',
    re: /replaceable|执行位|审计位|管理位|签名位|holderType|holder_type|seatHolders|MOCK_SIGNATURE|SeatChangeRecord/,
    // ★ 定性的关键：这些名字是否**本就在公开契约里**
    //   若在 ⇒ 引用契约名 = 判据1 说的"公开契约"，不算越线；
    //   若 src 里**额外写出**契约没有的设计（如承担方名字、替换原因、收费与否）⇒ 越线。
    adjudicate: (file, line) => {
      // 契约里有的机械字段（seat 值域 / holderType 值域）⇒ 引用契约，不算越线
      if (/holderType|holder_type|seatHolders/.test(line)) {
        return { verdict: 'not-crossed', why: '引用契约字段名（§23.3 已公开）' }
      }
      if (/replaceable/.test(line)) {
        return { verdict: 'not-crossed', why: '引用契约字段名（seats.json 已公开）' }
      }
      // ★ mock 数据里写出**承担方名字 / 替换原因 / 变更留痕**⇒ 这是契约没有的内容
      if (file.includes('mock/data.ts') && /执行位|审计位|管理位|签名位|MOCK_SIGNATURE|SeatChangeRecord/.test(line)) {
        return { verdict: 'CROSSED?', why: '★ 写出承担方名/替换原因/留痕样本 —— 契约无此内容' }
      }
      if (/执行位|审计位|管理位|签名位/.test(line)) {
        // 界面文案（"这个执行位待接入"）是对用户的话，不是商业设计
        return { verdict: 'not-crossed', why: '界面文案（对用户说的话，非设计）' }
      }
      return { verdict: 'not-crossed', why: '引用契约名' }
    },
  },
  {
    id: 3,
    name: '数据流向与判据（含收费点）',
    re: /收费|计费|价格|定价|费用|积分|额度|billing|charge|credits|balance|判据库|阈值/,
    adjudicate: (file, line) => {
      // 契约明定 `usage` 是唯一可信计费口径 ⇒ 客户端**存与显示**不算越线；自己算才算
      if (/credits|balance/.test(line) && file.includes('run-reducer')) {
        return { verdict: 'not-crossed', why: '契约 §20.2：usage 是唯一口径，客户端只存/显不计算' }
      }
      if (/积分不足/.test(line)) return { verdict: 'not-crossed', why: '错误文案（服务端下发）' }
      if (/不收费|拒收/.test(line)) return { verdict: 'not-crossed', why: '业务规则文案（契约明示）' }
      // ★ mock 里写死了具体 credits / balance 数值 ⇒ 是演示数据，但要对方判
      if (file.includes('mock/data.ts') && /credits:\s*\d|balanceAfter/.test(line)) {
        return { verdict: 'note', why: 'mock 演示数值（非真实计价规则）—— 供对方判' }
      }
      if (/阈值/.test(line)) return { verdict: 'not-crossed', why: 'UI 布局阈值（折叠宽度），与判据无关' }
      return { verdict: 'note', why: '需人工判读' }
    },
  },
  {
    id: 1,
    name: '服务端调用路径',
    re: /ENDPOINTS|endpointOf|callKaipu|baseUrl|\/kai-pu|REMOTE_CHANNEL|REMOTE_NS/,
    adjudicate: () => ({
      // 判据 1 明说：只暴露"调哪个接口、传什么参数" ⇒ 不算越线
      verdict: 'not-crossed',
      why: '判据1 原文：只暴露接口名与参数 ⇒ 不算越线（本就是公开契约）',
    }),
  },
]

const rows = []
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  const lines = readFileSync(f, 'utf8').split('\n')
  for (const r of RULES) {
    lines.forEach((line, i) => {
      if (r.re.test(line)) {
        const a = r.adjudicate(rel, line)
        rows.push({ file: rel, line: i + 1, rule: r.id, ruleName: r.name, verdict: a.verdict, why: a.why, text: line.trim().slice(0, 110) })
      }
    })
  }
}

if (asJson) {
  console.log(JSON.stringify({ files: files.length, rows }, null, 2))
} else {
  console.log(`G2 补件越线核查 · 待审 ${files.length} 个文件（src ${files.length - 2} + patch 2）`)
  console.log(`  命中总数：${rows.length}`)
  for (const r of RULES) {
    const n = rows.filter((x) => x.rule === r.id).length
    const crossed = rows.filter((x) => x.rule === r.id && x.verdict === 'CROSSED?').length
    const note = rows.filter((x) => x.rule === r.id && x.verdict === 'note').length
    console.log(`  判据${r.id} ${r.name}：命中 ${n}｜★越线待定 ${crossed}｜待判 ${note}`)
  }
  console.log('')
  console.log('── ★ 判为「越线待定」的行（我方主动交出，供星月独立判）──')
  const crossed = rows.filter((x) => x.verdict === 'CROSSED?')
  if (crossed.length === 0) console.log('  （无）')
  for (const x of crossed) console.log(`  ${x.file}:${x.line}  [判据${x.rule}]\n      ${x.text}\n      ⇒ ${x.why}`)
  console.log('')
  console.log('── 判为「待判」（需人工读上下文）──')
  const notes = rows.filter((x) => x.verdict === 'note')
  if (notes.length === 0) console.log('  （无）')
  for (const x of notes.slice(0, 20)) console.log(`  ${x.file}:${x.line}  [判据${x.rule}]  ${x.text}`)
}
