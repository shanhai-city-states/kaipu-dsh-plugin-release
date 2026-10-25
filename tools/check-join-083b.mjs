#!/usr/bin/env node
/**
 * 083 第一批 · 补充件（任务 6f093831）· 前端判据
 * =====================================================================
 * 三件事 + 一条硬规矩：
 *   ① 申请号显式显示 + 复制（Agent 用 curl 提交时 requestId 只在那一次响应里）
 *   ② `joinGuideText` 第五节加「把 requestId 抄下来」
 *   ③ requestId 存本地（按「铺号 + 申请人」分键），重进面板自动查一次
 *   ★ 新码**阅后即焚**：服务端只回一次明文 ⇒ 读到就必须当场落盘，且第二次空了不许报错。
 *
 * 写法沿用 `check-join-083.mjs`（星月 R-6 的教训：同一张关键词表 = 逻辑必然 0 命中）：
 *   · 纯逻辑**直接 import 编译产物**喂输入看输出，每条配反向对照
 *   · 接线层面才查源码/产物文本，且**先剥注释、先解 \uXXXX**
 *
 * 跑法：node tools/build.mjs && node tools/check-join-083b.mjs   （期望退出码 0）
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const WS = join(ROOT, 'packages/plugin-workstation')
const SRC_PANEL = join(WS, 'src/client/WorkstationPanel.tsx')
const SRC_COPY = join(WS, 'src/client/join-copy.ts')
const LIB_COPY = join(WS, 'lib/client/join-copy.js')
const LIB_BUNDLE = join(WS, 'lib/client.js')

let pass = 0
let fail = 0

function check(id, title, ok, detail) {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '✓' : '✗'} ${id} ${title}${detail === undefined ? '' : `\n    ${detail}`}`)
}

/** ts 产物把中文转成 \uXXXX —— 断言中文前必须解码（本项目老坑） */
function decodeEscapes(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
}
/** 剥注释：新注释里常引用旧代码，直接断言「不得包含」会被自己的注释判红 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

for (const f of [SRC_PANEL, SRC_COPY, LIB_COPY, LIB_BUNDLE]) {
  if (!existsSync(f)) {
    console.error(`缺文件：${f}\n（先跑 node tools/build.mjs）`)
    process.exit(2)
  }
}

const panelAll = stripComments(readFileSync(SRC_PANEL, 'utf8'))
/* ★ 判据范围要收到 JoinCodeCard 这一段：本文件别处（审计送审）也有 `r.data.id`，
   全文件断言会把它算进来 —— 这不是本补充件的对象（第一版就栽在这儿）。 */
const joinStart = panelAll.indexOf('function JoinCodeCard(')
const panelCode = joinStart >= 0 ? panelAll.slice(joinStart) : ''
const libText = decodeEscapes(readFileSync(LIB_BUNDLE, 'utf8'))

/* lib/client/*.js 是 tsc 的 CommonJS 产物，而仓是 "type":"module" —— 直接 import 会
   报 `exports is not defined`。用 5 行壳执行，零依赖。 */
const mod = (() => {
  const code = readFileSync(LIB_COPY, 'utf8')
  const shell = { exports: {} }
  const fn = new Function('exports', 'module', 'require', code)
  fn(shell.exports, shell, () => { throw new Error('join-copy 不该 require 任何东西') })
  return shell.exports
})()
const {
  REQ_ID_KEEP_LINE,
  JOIN_GUIDE_SECTION,
  joinGuideText,
  applicantCodeState,
  codeStoreKey,
  reqStoreKey,
  looksLikeRequestId,
  CODE_ONCE_TIP,
  CODE_STORED_TIP,
  CODE_LOST_TIP,
  humanizeJoinError,
} = mod

console.log('083 补充件 · requestId 显示 + 阅后即焚取码 · 判据\n')

/* ══════════════════════════════════════════════════════════════════
 * A · 申请号的形态与键口径（纯函数）
 * ══════════════════════════════════════════════════════════════════ */
check('A-1', 'looksLikeRequestId：认 jr_ 前缀，undefined / 空 / "undefined" 一律 false',
  looksLikeRequestId('jr_HmaNlg4i4cZabKlP') === true &&
    looksLikeRequestId(undefined) === false &&
    looksLikeRequestId('') === false &&
    looksLikeRequestId('undefined') === false &&
    looksLikeRequestId('id') === false,
  `jr_=${looksLikeRequestId('jr_HmaNlg4i4cZabKlP')} · undefined=${looksLikeRequestId(undefined)} · ""=${looksLikeRequestId('')} · "undefined"=${looksLikeRequestId('undefined')}`)

check('A-2', 'reqStoreKey：按「铺号 + 申请人」分键；缺一项退回兼容键（129 存量读得到）',
  reqStoreKey('dev-cf78', 'human-abc') === 'kaipu.join.requestId.dev-cf78.human-abc' &&
    reqStoreKey('', 'human-abc') === 'kaipu.join.requestId' &&
    reqStoreKey('dev-cf78', '') === 'kaipu.join.requestId' &&
    reqStoreKey('dev-cf78', 'human-abc') !== reqStoreKey('dev-other', 'human-abc'),
  `全键=${reqStoreKey('dev-cf78', 'human-abc')} · 缺铺=${reqStoreKey('', 'x')} · 换铺不同=${reqStoreKey('a', 'b') !== reqStoreKey('c', 'b')}`)

check('A-3', 'codeStoreKey：一条申请一个键（两个 requestId 不互相覆盖）',
  codeStoreKey('jr_aaa') === 'kaipu.join.code.jr_aaa' &&
    codeStoreKey('jr_aaa') !== codeStoreKey('jr_bbb'),
  `jr_aaa→${codeStoreKey('jr_aaa')}`)

/* ══════════════════════════════════════════════════════════════════
 * B · 阅后即焚状态机（纯函数 · 这是 §二 的核心）
 * ══════════════════════════════════════════════════════════════════ */
check('B-1', '服务端回明文 ⇒ fresh（无论本地有没有旧码）',
  applicantCodeState('approved', 'ABC123', '') === 'fresh' &&
    applicantCodeState('approved', 'ABC123', 'OLD') === 'fresh',
  `空本地=${applicantCodeState('approved', 'ABC123', '')} · 有旧码=${applicantCodeState('approved', 'ABC123', 'OLD')}`)

check('B-2', 'approved + 服务端不回码 + 本地有 ⇒ stored',
  applicantCodeState('approved', '', 'OLD') === 'stored',
  `实际=${applicantCodeState('approved', '', 'OLD')}`)

check('B-3', 'approved + 服务端不回码 + 本地也没 ⇒ lost（唯一出路是找铺主重发）',
  applicantCodeState('approved', '', '') === 'lost' &&
    applicantCodeState('approved', '   ', '  ') === 'lost',
  `实际=${applicantCodeState('approved', '', '')} · 全空格=${applicantCodeState('approved', '   ', '  ')}`)

check('B-4', '非 approved 一律 none（pending / rejected / expired 都不提示取码）',
  ['pending', 'rejected', 'expired', ''].every((s) => applicantCodeState(s, '', '') === 'none'),
  ['pending', 'rejected', 'expired', ''].map((s) => `${s || '(空)'}=${applicantCodeState(s, '', '')}`).join(' · '))

check('B-5', '反向对照：lost ≠ stored（差一张本地码就必须分开说，不能一句话糊过去）',
  applicantCodeState('approved', '', '') !== applicantCodeState('approved', '', 'X'),
  `无本地=${applicantCodeState('approved', '', '')} · 有本地=${applicantCodeState('approved', '', 'X')}`)

/* ══════════════════════════════════════════════════════════════════
 * C · 三句提示互不相同（一句 catch-all 蒙不过去）
 * ══════════════════════════════════════════════════════════════════ */
check('C-1', 'fresh / stored / lost 三句互不相同，且各自说清下一步',
  new Set([CODE_ONCE_TIP, CODE_STORED_TIP, CODE_LOST_TIP]).size === 3 &&
    CODE_ONCE_TIP.includes('只显示一次') &&
    CODE_STORED_TIP.includes('只回一次') &&
    CODE_LOST_TIP.includes('铺主'),
  `去重后=${new Set([CODE_ONCE_TIP, CODE_STORED_TIP, CODE_LOST_TIP]).size} · fresh含「只显示一次」=${CODE_ONCE_TIP.includes('只显示一次')} · lost含「铺主」=${CODE_LOST_TIP.includes('铺主')}`)

/* ══════════════════════════════════════════════════════════════════
 * D · 接线（源码层：改了但不接线 = 功能不存在）
 * ══════════════════════════════════════════════════════════════════ */
check('D-1', '取申请号用 requestId 字段，不用 id（按 id 取会拿到 undefined）',
  panelCode.includes('r.data.requestId') && !/r\.data\.id\b/.test(panelCode),
  `有 requestId=${panelCode.includes('r.data.requestId')} · 出现 r.data.id=${/r\.data\.id\b/.test(panelCode)}`)

check('D-2', '★ 拿到的明文当场落盘（不是等下一轮轮询）',
  /if \(serverCode\.length > 0\)\s*safeSet\(codeStoreKey\(rid\), serverCode\)/.test(panelCode),
  `命中=${/if \(serverCode\.length > 0\)\s*safeSet\(codeStoreKey\(rid\), serverCode\)/.test(panelCode)}`)

check('D-3', '提交成功后按「铺 + 人」键存申请号，兼容键同时写一份',
  panelCode.includes('safeSet(reqStoreKey(me.data.accountId, applicantId()), rid)') &&
    panelCode.includes('safeSet(JOIN_REQ_KEY, rid)'),
  `正式键=${panelCode.includes('safeSet(reqStoreKey(me.data.accountId, applicantId()), rid)')} · 兼容键=${panelCode.includes('safeSet(JOIN_REQ_KEY, rid)')}`)

check('D-4', '重进面板会触发一次查询（开场 effect 里 refreshMine）',
  /let rid = safeGet\(key\)[\s\S]{0,400}refreshMine\(rid\)/.test(panelCode),
  `命中=${/let rid = safeGet\(key\)[\s\S]{0,400}refreshMine\(rid\)/.test(panelCode)}`)

check('D-5', '申请号显式渲染原值 + 复制按钮（有守卫，不会渲染 undefined）',
  panelCode.includes('looksLikeRequestId(myId)') &&
    panelCode.includes('>{myId}</code>') &&
    panelCode.includes('复制申请号'),
  `守卫=${panelCode.includes('looksLikeRequestId(myId)')} · 原值直出=${panelCode.includes('>{myId}</code>')} · 复制按钮=${panelCode.includes('复制申请号')}`)

check('D-6', '空码不出空白格：码区以 myCode.length > 0 为前提，lost 单独给说明',
  panelCode.includes("myStatus === 'approved' && myCode.length > 0") &&
    panelCode.includes("myCodeState === 'lost'") &&
    panelCode.includes('CODE_LOST_TIP'),
  `码区条件=${panelCode.includes("myStatus === 'approved' && myCode.length > 0")} · lost 分支=${panelCode.includes("myCodeState === 'lost'")}`)

/* ══════════════════════════════════════════════════════════════════
 * E · 第五节课文
 * ══════════════════════════════════════════════════════════════════ */
check('E-1', '第五节含「把 requestId 抄下来」，且句子能被人直接照做',
  JOIN_GUIDE_SECTION.some((l) => l === REQ_ID_KEEP_LINE) &&
    REQ_ID_KEEP_LINE.includes('requestId') &&
    REQ_ID_KEEP_LINE.includes('抄下来') &&
    REQ_ID_KEEP_LINE.includes('查状态') &&
    REQ_ID_KEEP_LINE.includes('取码'),
  `在数组里=${JOIN_GUIDE_SECTION.some((l) => l === REQ_ID_KEEP_LINE)} · 原句=${REQ_ID_KEEP_LINE}`)

check('E-2', '前四节逐字未动（拼接后前 N 行 === 传入的 baseLines，长度也对得上）',
  (() => {
    const base = ['一、装', '', '二、进', '', '三、技能', '', '四、传']
    const out = joinGuideText(base).split('\n')
    const sameHead = base.every((l, i) => out[i] === l)
    return sameHead && out.length === base.length + JOIN_GUIDE_SECTION.length
  })(),
  `片段数=${joinGuideText(['一', '二']).split('\n').length}（应 = 2 + ${JOIN_GUIDE_SECTION.length}）`)

/* ══════════════════════════════════════════════════════════════════
 * F · 产物层（防「改了源码但漏跑 build、发的是旧包」）
 * ══════════════════════════════════════════════════════════════════ */
check('F-1', 'client.js 里打包进了补充件的三句关键文案',
  libText.includes('复制申请号') &&
    libText.includes('只显示一次') &&
    libText.includes('请找铺主再补一张'),
  `复制申请号=${libText.includes('复制申请号')} · 只显示一次=${libText.includes('只显示一次')} · 找铺主补=${libText.includes('请找铺主再补一张')}`)

/* ★ F-2 第一版写错了：`no_credential` 在 join-copy 里是**映射表的键**（`no_credential: '人话'`），
   键后跟冒号是合法的；真正要挡的是**渲染层出现内部码**。
   ⇒ 断言两条：① 面板代码里没有 `no_credential` 字面；② 查询失败那次返回不含内部码。 */
check('F-2', '反向对照：渲染层不出现内部错误码（AC-10 不因本轮回退）',
  !panelCode.includes('no_credential') &&
    !humanizeJoinError('no_credential').includes('no_credential') &&
    !humanizeJoinError('not_owner').includes('not_owner'),
  `面板含 no_credential=${panelCode.includes('no_credential')} · 译文含码=${humanizeJoinError('no_credential').includes('no_credential')}`)

console.log(`\n${fail === 0 ? '全绿' : '有红'}：${pass} / ${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
