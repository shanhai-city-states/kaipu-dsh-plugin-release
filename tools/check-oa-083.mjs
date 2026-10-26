#!/usr/bin/env node
/**
 * check-oa-083.mjs —— 「Agent 版 OA」三件套判据（2026-10-26 阿开定）
 *
 * 覆盖：
 *   ① 项目阶段（projects.phase · 六阶 · ±1 步进 · 留痕）
 *   ② 任务依赖（读/加/删 · 双向信息 · 解锁）
 *   ③ 交付版本（version · is_final · 切最终稿）
 *   ④ ★★ 新部署完整性（本轮四个 bug 的防复发）
 *
 * ★ 为什么这批判据要读**源码**而不只跑接口：
 *   本轮四个 bug 全是「新库才炸、生产库看不出来」，接口测试跑在生产库副本上
 *   一律绿 —— 那不是假绿是什么？⇒ 判据必须直接盯「建表语句是否完整」
 *   与「启动自检是否存在」。
 *
 * 用法：node tools/check-oa-083.mjs
 */
import { readFileSync, existsSync } from 'node:fs'

const KAI = '/opt/shanhai-toolkit-opensource/modules/08-workshop/kai-pu/src'
const storePath = `${KAI}/store.py`
const gatewayPath = `${KAI}/gateway.py`

let pass = 0
const fails = []
const ck = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fails.push({ name, got: String(got).slice(0, 200) }); console.log(`  ✗ ${name} ｜ ${String(got).slice(0, 200)}`) }
}

if (!existsSync(storePath) || !existsSync(gatewayPath)) {
  console.error(`✗ 找不到服务端源码：${KAI}`)
  process.exit(1)
}
const store = readFileSync(storePath, 'utf8')
const gateway = readFileSync(gatewayPath, 'utf8')

/* ══ 一、项目阶段 ══ */
console.log('\n【一】项目阶段')
{
  /* ★ 判据要容忍行内注释（`"requirement",   # 立需求`）——
     原正则写 `"archived",\s*\]`，实际是 `"archived",      # 归档\n]` ⇒ 假红。
     ⇒ 判「取出来的六个值对不对」（O-1b 已做），这里只判「定义存在且是 list」。 */
  ck('O-1a PROJECT_PHASES 定义存在',
    /^PROJECT_PHASES = \[/m.test(gateway), 'phases 定义没找到')
  const six = ['requirement', 'plan', 'assignment', 'build', 'review', 'archived']
  const m = gateway.match(/PROJECT_PHASES = \[([\s\S]*?)\]/)
  const got = m ? [...m[1].matchAll(/"(\w+)"/g)].map(x => x[1]) : []
  ck('O-1b 六阶齐全且顺序正确', JSON.stringify(got) === JSON.stringify(six), got.join(','))
  ck('O-1c PHASE_LABEL 六个人话名', ['立需求','出计划书','分工','施工','验收','归档']
    .every(x => gateway.includes(`"${x}"`)), 'label 缺失')
  ck('O-1d 跳阶被拦（phase_skip）', gateway.includes("code=\"phase_skip\""), 'no phase_skip')
  ck('O-1e 非法阶段被拦（invalid_phase）', gateway.includes("code=\"invalid_phase\""), 'no invalid_phase')
  ck('O-1f 阶段变更留痕进 project_events',
    /phase_change/.test(gateway), 'no phase_change event')
  ck('O-1g 路由已注册 PATCH /projects/{id}/phase',
    /PATCH.*\/projects\/\(\?P<id>\[\^\/\]\+\)\/phase/.test(gateway), 'route missing')
  ck('O-1h 项目列表返回 phase（前端要画进度条）',
    gateway.includes('"phase": (r["phase"]'), 'phase not in list payload')
}

/* ══ 二、任务依赖 ══ */
console.log('\n【二】任务依赖')
{
  ck('O-2a GET /tasks/{id}/deps 已注册',
    /GET.*\/tasks\/\(\?P<id>\[\^\/\]\+\)\/deps/.test(gateway), 'GET route missing')
  ck('O-2b DELETE /tasks/{id}/deps/{dep} 已注册',
    /DELETE.*\/tasks\/\(\?P<id>\[\^\/\]\+\)\/deps\/\(\?P<dep>/.test(gateway), 'DELETE route missing')
  ck('O-2c POST /tasks/{id}/deps 仍在（加依赖）',
    /POST.*\/tasks\/\(\?P<id>\[\^\/\]\+\)\/deps\$/.test(gateway), 'POST route missing')
  /* ★ 双向信息：只给 dependsOn 不给 blocks，就看不到「我挡着谁」 */
  ck('O-2d 读依赖返回双向（dependsOn + blocks）',
    gateway.includes('"dependsOn"') && gateway.includes('"blocks"'), 'one-way only')
  ck('O-2e 读依赖给 claimable（唯一判据由服务端算）',
    gateway.includes('"claimable": unmet == 0'), 'claimable missing')
  /* ★ 删依赖后必须级联解锁，否则「依赖没了任务还领不了」 */
  ck('O-2f 删依赖后调 task_cascade_unlock',
    /tasks_deps_delete[\s\S]{0,900}task_cascade_unlock/.test(gateway), 'no unlock after delete')
  /* ★ 环检测两端都在 */
  ck('O-2g 自环与成环都拦（cycle_detected）',
    (gateway.match(/cycle_detected/g) || []).length >= 2, 'cycle check incomplete')
}

/* ══ 三、交付版本 ══ */
console.log('\n【三】交付版本')
{
  ck('O-3a GET /tasks/{id}/deliverables 已注册',
    /GET.*\/tasks\/\(\?P<id>\[\^\/\]\+\)\/deliverables\$/.test(gateway), 'list route missing')
  ck('O-3b POST .../deliverables/{did}/promote 已注册',
    /POST.*deliverables\/\(\?P<did>\[\^\/\]\+\)\/promote/.test(gateway), 'promote route missing')
  ck('O-3c 交付时写 version（MAX+1，不用 COUNT）',
    /COALESCE\(MAX\(version\),0\)/.test(gateway), 'version not MAX+1')
  ck('O-3d 新交付即最终稿（先清旧 is_final 再置 1）',
    /UPDATE task_deliverables SET is_final=0/.test(gateway) &&
    /is_final\)/.test(gateway), 'is_final logic missing')
  ck('O-3e version/is_final 列在 store.py 迁移里',
    store.includes('ADD COLUMN version') && store.includes('ADD COLUMN is_final'),
    'columns not migrated')
  ck('O-3f 库层唯一：一个任务至多一份最终稿',
    /idx_td_one_final[\s\S]{0,160}WHERE is_final=1/.test(store), 'no partial unique index')
  ck('O-3g promote 校验 did 属于该 task（防改错别人的稿）',
    /deliverable_not_found/.test(gateway), 'no ownership check')
}

/* ══ 四、★★ 新部署完整性（本轮四个 bug 的防复发）══ */
console.log('\n【四】新部署完整性（四个真 bug 的防复发）')
{
  /* bug 1：projects 建表缺 frozen_kind/owner_id/visibility/phase */
  const projDdl = store.match(/CREATE TABLE IF NOT EXISTS projects \(([\s\S]*?)\)"/)
  ck('O-4a projects 建表含 frozen_kind', store.includes('" frozen_kind TEXT NOT NULL'), 'frozen_kind 不在建表语句')
  ck('O-4b projects 建表含 owner_id + visibility',
    store.includes('" owner_id TEXT NOT NULL') && store.includes('" visibility TEXT NOT NULL'),
    'owner_id/visibility 不在建表语句')
  ck('O-4c projects 建表含 phase', store.includes('" phase TEXT NOT NULL'), 'phase 不在建表语句')

  /* bug 2：租户发号撞唯一索引 */
  /* ★ 只看「DROP 的行号 < 第一个 UPDATE 的行号」，不用字符跨度 ——
     跨度会随注释增减而假红（本轮实测：中间夹了 30 行设计说明）。 */
  {
    const dropAt = store.indexOf('DROP INDEX IF EXISTS idx_tenants_door_no_v3')
    const updAt = store.indexOf('UPDATE tenants SET door_no=? WHERE account_id=?')
    const createAt = store.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_door_no_v3')
    ck('O-4d 发号顺序：先 DROP → 再 UPDATE → 最后 CREATE',
      dropAt > 0 && updAt > 0 && createAt > 0 && dropAt < updAt && updAt < createAt,
      `drop=${dropAt} update=${updAt} create=${createAt}`)
  }
  ck('O-4e 发号在内存里算（不边查边写）',
    store.includes('taken = set()') && store.includes('while cand in taken'),
    'not computed in memory')

  /* bug 3：migrations 里的表 store.py 不建 */
  ck('O-4f project_members 在 Store 里建', store.includes('CREATE TABLE IF NOT EXISTS project_members'), 'missing')
  ck('O-4g audit_submissions 在 Store 里建', store.includes('CREATE TABLE IF NOT EXISTS audit_submissions'), 'missing')
  ck('O-4h audit_messages 在 Store 里建', store.includes('CREATE TABLE IF NOT EXISTS audit_messages'), 'missing')

  /* bug 4：tasks 建表缺 kind/tags/project_id/interaction_id/notify_agent */
  for (const col of ['project_id', 'interaction_id', 'kind', 'tags', 'notify_agent']) {
    ck(`O-4i 单源 _TASKS_P5_COLS 含 ${col}`,
      new RegExp(`\\("${col}",\\s*"`).test(store), `${col} 不在单源`)
  }

  /* ★★ 最关键的一条：启动自检必须在**建表之后、任何 ALTER 之前**比对
     「代码正在写入的列」—— 光比「建出来的 vs 单源」是假绿（注入实测证实）。 */
  ck('O-4j 有 TASK_WRITE_COLS（代码实际写入列清单）',
    /TASK_WRITE_COLS = \(/.test(store), 'missing')
  /* ★ 同样按行号判：assert 必须出现在 executescript 之后、
     **任何 ALTER TABLE tasks** 之前 —— 中间夹注释不算错。 */
  {
    const execAt = store.indexOf('executescript(SCHEMA)')
    const assertAt = store.indexOf('_assert_tasks_cols(after_create=True)')
    const firstAlter = store.indexOf('ALTER TABLE tasks ADD COLUMN')
    ck('O-4k 建表后立即校验，且卡在任何 ALTER 之前',
      execAt > 0 && assertAt > execAt
        && (firstAlter < 0 || assertAt < firstAlter || firstAlter > assertAt),
      `exec=${execAt} assert=${assertAt} alter=${firstAlter}`)
  }
  ck('O-4l 自检比的是 TASK_WRITE_COLS 而不是只比单源',
    /missing_used = \[c for c in TASK_WRITE_COLS if c not in have\]/.test(store),
    'only compares single-source (假绿形态)')
  ck('O-4m 缺列 ⇒ 拒绝启动（抛 RuntimeError）',
    /tasks 表缺少\*\*代码正在写入\*\*的列/.test(store), 'no fail-closed')
}

/* ══ 输出 ══ */
const total = pass + fails.length
if (fails.length === 0) {
  console.log(`\n✅ OA 三件套判据全绿：${pass}/${total}`)
  process.exit(0)
} else {
  console.log(`\n❌ 失败 ${fails.length}/${total}`)
  for (const f of fails) console.log(`   ${f.name}｜实际="${f.got}"`)
  process.exit(1)
}
