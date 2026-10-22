#!/usr/bin/env node
/**
 * kai-pu-upload —— Agent 侧资料上传 CLI（补 UI 里「大文件请用 CLI」的空承诺）
 * ==========================================================================
 * 为什么要有它：工位界面对大文件只显示「请用 CLI 上传」，但此前**没有 CLI**。
 * 本工具走 Agent HMAC 通路（与服务端 `POST /packs/{iid}/files` 的 Agent 分支逐字对齐）：
 *
 *   msg = "{agentId}|{ts}|{accountId}|{filename}|{sha256(body)}"
 *   X-Sig = HMAC-SHA256(agentSecret, msg)
 *
 * 用法：
 *   node tools/kai-pu-upload.mjs --file ./报告.md --task <taskId> [--agent azhou]
 *   node tools/kai-pu-upload.mjs --file ./大包.tar.gz --iid task-<taskId> --name 交付包.tar.gz
 *   node tools/kai-pu-upload.mjs --file ./x.pdf --task <taskId> --base https://agent.ak2029.com/kai-pu
 *
 * 约定：`--task <taskId>` 等价于 `--iid task-<taskId>`（与工位客户端历史约定一致）。
 * 凭据默认从 `~/.kai-pu/<agent>.json` 读（字段 base/accountId/agentId/secret|agentSecret）。
 *
 * ★ 只做上传（Agent 身份读列表在服务端是 401 —— 列表走铺主 Bearer / 界面）。
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, resolve } from 'node:path'

const args = process.argv.slice(2)
const get = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const die = (msg, code = 2) => { console.error(`✗ ${msg}`); process.exit(code) }

const file = get('file')
if (!file) die('缺 --file <路径>')
const abs = isAbsolute(file) ? file : resolve(process.cwd(), file)
let st
try { st = statSync(abs) } catch { die(`文件不存在：${abs}`) }
if (!st.isFile()) die(`不是文件：${abs}`)

const taskId = get('task')
const iidArg = get('iid')
if (!taskId && !iidArg) die('缺 --task <taskId> 或 --iid <interactionId>')
const iid = iidArg || `task-${taskId}`

const agentArg = get('agent', '')
const credPath = get('cred') || (agentArg
  ? `${homedir()}/.kai-pu/${agentArg}.json`
  : '')
if (!credPath) die('缺 --agent <id>（或 --cred <凭据路径>）')

let cred
try { cred = JSON.parse(readFileSync(credPath, 'utf8')) }
catch (e) { die(`读不到凭据 ${credPath}：${e.message}`) }

const base = (get('base') || cred.base || '').replace(/\/+$/, '')
const accountId = cred.accountId || cred.account_id || ''
const agentId = cred.agentId || cred.agent_id || ''
const secret = cred.agentSecret || cred.secret || ''
if (!base || !accountId || !agentId || !secret) {
  die('凭据缺字段（base/accountId/agentId/secret 或 agentSecret）')
}

const buf = readFileSync(abs)
const sha = createHash('sha256').update(buf).digest('hex')
const name = get('name') || basename(abs)
const ts = Math.floor(Date.now() / 1000)
const msg = `${agentId}|${ts}|${accountId}|${name}|${sha}`
const sig = createHmac('sha256', secret).update(msg).digest('hex')

const url = `${base}/packs/${encodeURIComponent(iid)}/files`
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/octet-stream',
    'X-Agent-Id': agentId,
    'X-Account-Id': accountId,
    'X-Ts': String(ts),
    'X-Filename': encodeURIComponent(name),
    'X-Body-Sha256': sha,
    'X-Sig': sig,
  },
  body: buf,
})

const text = await res.text()
let body
try { body = JSON.parse(text) } catch { body = text }
if (!res.ok) {
  console.error(`✗ 上传失败 ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  process.exit(1)
}
console.log(JSON.stringify({
  ok: true, agentId, interactionId: iid, filename: name,
  bytes: buf.length, sha256: sha, response: body,
}, null, 2))
