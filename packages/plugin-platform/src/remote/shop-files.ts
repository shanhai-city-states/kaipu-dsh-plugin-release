/**
 * 山海·开铺 · 场地插件 · 铺子资料目录（host 侧本地文件层）
 * =====================================================================
 * 只干一件事：把「用户自己的资料」落在**本机一个可查的目录**里。
 * 它不发任何 HTTP，也不碰会商运行的后台泵 —— 与网侧完全解耦。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 为什么是「目录」而不是「一张表」
 * ══════════════════════════════════════════════════════════════════
 * 资料本来就长在文件系统上：用户拖进来的是文件，拿出去的也是文件。
 * 为它在本地再建一份索引表，只会多出**第二事实源**，而两份必然漂移：
 * 文件被手工删了、表还在 ⇒ 界面显示一个点不开的文件，且没人知道谁是对的。
 * ⇒ **目录即事实源**：`readdir` 读到的就是真的，没有对账问题。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 数据根：DSH home 下的插件私有数据区
 * ══════════════════════════════════════════════════════════════════
 *   <DSH_HOME>/plugins-data/kaipu-platform/shops/<shopKey>/
 *     ├── 待审材料/   ← 用户放进来「要审的东西」
 *     ├── 审校报告/   ← 运行产生的结论
 *     └── 草稿/       ← 断网也照样能写的东西
 *
 * ★ 为什么挂 `plugins-data/`：本仓的装机工具把它定为**插件私有数据区**，
 *   并配了一条纪律 —— **卸载只删代码、数据保留**（`tools/plugin.mjs`
 *   的 uninstall 会显式打印"数据保留"）。
 *   ⇒ 用户的资料放在这里，装卸/升级插件都不会把它带走。
 *
 * ★ `DSH_HOME` 的取法**照抄底座的默认值**（`process.env.DSH_HOME ?? ~/.dsh`），
 *   不自造一个路径 —— 换机器、换 profile 才不会断。
 * ★ 允许 `KAI_SHOP_DATA_ROOT` 显式覆盖（多实例并行 / 测试隔离用）。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 隔离：按「铺子」分目录 + 路径收敛，**不假设宿主替我们做了隔离**
 * ══════════════════════════════════════════════════════════════════
 * `shopKey` 由接入身份派生 ⇒ 换一个接入地址，就是一个**物理上不同的目录**，
 * 天然不串味。任何写/删/读的路径都要过 `isPathInShop()` 收敛
 * （`..` 穿越、跨铺子、绝对路径一律拒），**fail-closed**。
 *
 * ★ 为什么不把"隔离"寄托在宿主身上：宿主提供的是**进程与 profile** 级别的
 *   隔离，而"这个文件属于哪个铺子"是**业务语义**，只有我们定义得了。
 *   ⇒ 自己这道闸门必须有，且必须能被打出来（配套探针会喂穿越样本断言拒绝）。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 零依赖取内置模块（本文件跑在 host，但不引 `@types/node`）
 * ══════════════════════════════════════════════════════════════════
 * host 侧 tsconfig 是 `"types": []` —— 这是**故意的**（防误用 window / DOM）。
 * 代价是 `node:fs` 的类型拿不到，所以这里照本仓既有做法：
 * 用 `process.getBuiltinModule()` 取真身 + **手写最小形状**。
 * ⇒ 类型安全靠我们自己维护，收益是**不为一个 mkdir 拖进整套 node 类型**。
 */

// ★★ 只 `import type`。host half **不经打包**（tsc 直出），它的裸 import 必须
//   能在**用户机的 profile** 里解析得到；而 `@shanhai/kaipu-contract` 是
//   **构建期依赖**，用户机上没有。类型会被 tsc 擦除 ⇒ 不产生运行时依赖。
//   ⚠️ 一旦有人在这里 import 一个「值」，发布包当场解析失败。
//   ⇒ 由 `tools/check-remote-bridge.mjs` 的裸 import 扫描看护。
import type { ShopFileEntry, ShopSubdir } from '@shanhai/kaipu-contract'

/* ══════════════════════════════════════════════════════════════════
   一、内置模块最小形状（零 @types/node）
   ══════════════════════════════════════════════════════════════════ */

interface StatsLike {
  size: number
  mtimeMs: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

interface DirentLike {
  name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

interface FsLike {
  existsSync(p: string): boolean
  mkdirSync(p: string, opts: { recursive: boolean }): string | undefined
  readdirSync(p: string, opts: { withFileTypes: true }): DirentLike[]
  statSync(p: string): StatsLike
  lstatSync(p: string): StatsLike
  writeFileSync(p: string, data: unknown): void
  readFileSync(p: string): { toString(enc: string): string; readonly length: number }
  unlinkSync(p: string): void
}

interface PathLike {
  resolve(...parts: string[]): string
  join(...parts: string[]): string
  relative(from: string, to: string): string
  isAbsolute(p: string): boolean
  basename(p: string): string
  extname(p: string): string
  readonly sep: string
}

interface OsLike {
  homedir(): string
}

interface BufferLike {
  readonly length: number
  toString(enc: string): string
}

/**
 * `node:buffer` 的最小形状。
 *
 * ★★ 取的是 **`Buffer` 类**（`mod.Buffer`），**不是模块顶层** ——
 *   `from` / `byteLength` 都是 `Buffer` 的**静态成员**，模块顶层没有它们。
 *   （2026-10-06 实测踩到：写成 `mod.from(...)` ⇒ 编译期全绿，**运行时才炸**，
 *     而且症状是"每个文件都写不进去" —— 看上去像"文件内容有问题"，方向全错。
 *     配套的隔离判据当场抓到，见 `tools/probe/shop-isolation-probe.mjs` D 组。）
 */
interface BufferModuleLike {
  Buffer: {
    from(data: string, enc: string): BufferLike
  }
}

/** base64 形态校验 —— ★ 见 `writeShopFiles` 里的用法说明（这是**能失败**的那条判据） */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/u

type ProcLike = {
  env?: Record<string, string | undefined>
  getBuiltinModule?: (id: string) => unknown
  platform?: string
}

function proc(): ProcLike | undefined {
  return (globalThis as { process?: ProcLike }).process
}

/** 取一个 Node 内置模块。★ 取不到就**如实抛**，不假装拿到了 */
function builtin<T>(id: string): T {
  const p = proc()
  const get = p?.getBuiltinModule
  if (typeof get !== 'function') {
    throw new Error(`运行时未暴露内置模块（${id}）`)
  }
  const mod = get.call(p, id) as T | undefined
  if (mod === undefined || mod === null) {
    throw new Error(`无法载入内置模块（${id}）`)
  }
  return mod
}

/* ══════════════════════════════════════════════════════════════════
   二、目录规范
   ══════════════════════════════════════════════════════════════════ */

/**
 * 三个固定子目录。
 *
 * ★★ 为什么这里**又写了一份**（契约包里也有一份同值的）：
 *   host half 不能从契约包 import **值**（见文件头那条约束），而两端 tsconfig
 *   的 module 格式不同又不能共用一个源文件 ⇒ 只能各写一份。
 *   这与本仓 `REMOTE_NS` 的两份是同一个模式，**同由判据强制一致**
 *   （`tools/check-remote-bridge.mjs` 会扫两处字面量并断言相等）。
 *   ⇒ 改一处漏一处 = 判据 FAIL，不会静默漂移。
 */
export const SHOP_SUBDIRS: readonly ShopSubdir[] = ['待审材料', '审校报告', '草稿']

/** 单文件上限（base64 走一元通道，太大就不是"拖一下"的场景了） */
export const MAX_FILE_BYTES = 5 * 1024 * 1024
/** 读回文本时的上限 —— 超了**截断并如实标注**，不假装读全 */
export const MAX_TEXT_BYTES = 256 * 1024

/**
 * 允许「读成文本」的扩展名白名单。
 * ★ 白名单而非黑名单：二进制读出来是一堆乱码，与其让用户以为文件坏了，
 *   不如**明确说这类文件不支持读回**（它照样能存、能列、能删）。
 */
const TEXT_EXTS: readonly string[] = [
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log',
  '.yml', '.yaml', '.xml', '.html', '.htm', '.ini', '.conf',
  '.ts', '.js', '.py', '.sql', '.sh',
]

/* ══════════════════════════════════════════════════════════════════
   三、数据根与铺子 key
   ══════════════════════════════════════════════════════════════════ */

const PLUGIN_DATA_DIR = 'kaipu-platform'
const SHOPS_DIR = 'shops'

/**
 * 铺子资料的数据根（`…/shops` 的上级 = 插件的私有数据区）。
 * 优先级：显式覆盖 → `DSH_HOME` → `~/.dsh`（与底座默认值一致）。
 */
export function pluginDataRoot(): string {
  const p = builtin<PathLike>('node:path')
  const env = proc()?.env ?? {}

  const override = (env['KAI_SHOP_DATA_ROOT'] ?? '').trim()
  if (override !== '') return p.resolve(override)

  const home = (env['DSH_HOME'] ?? '').trim()
  if (home !== '') return p.join(p.resolve(home), 'plugins-data', PLUGIN_DATA_DIR)

  const os = builtin<OsLike>('node:os')
  return p.join(os.homedir(), '.dsh', 'plugins-data', PLUGIN_DATA_DIR)
}

/** `…/shops` 目录（各铺子目录的父级） */
export function shopsRoot(): string {
  return builtin<PathLike>('node:path').join(pluginDataRoot(), SHOPS_DIR)
}

/**
 * 铺子 key —— 由接入身份派生的**目录名**。
 *
 * ★ 规则：能直接用作目录名就直用（人可读，用户打开文件管理器能认出来）；
 *   凡是需要转义的一律加**内容哈希后缀**，避免两种身份被折叠成一个目录：
 *     `A/B` 与 `A-B` 若都转义成 `a-b` ⇒ 两个铺子会共用目录（串味）。
 *   ⇒ 加了哈希，它们必然分叉。
 * ★ 统一小写：本客户端跑在 Windows 上，文件系统**不区分大小写**，
 *   不全小写的话 `ABC` 与 `abc` 会落进同一个目录。
 */
export function shopKeyOf(accountId: string): string {
  const raw = accountId.trim()
  if (raw === '') return 'default'

  const lower = raw.toLowerCase()
  const slug = lower
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40)

  // 无需转义（slug 与原文小写逐字一致）且非空 ⇒ 直接用
  const clean = slug !== '' && slug === lower
  if (clean) return slug

  const h = hash8(raw)
  return slug === '' ? `shop-${h}` : `${slug}-${h}`
}

/**
 * 8 位十六进制内容哈希（FNV-1a 32 位）。
 * ★ 为什么自己写而不取 `node:crypto`：这里只需要"两种不同输入别撞进同一目录"，
 *   不是安全用途；少载一个内置模块，判据也少一处运行环境依赖。
 */
function hash8(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // FNV 质数 16777619 的乘法，用移位避免 32 位溢出
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 某个铺子（某个子目录）的绝对路径 */
export function shopDirOf(accountId: string, sub: ShopSubdir): string {
  const p = builtin<PathLike>('node:path')
  return p.join(shopsRoot(), shopKeyOf(accountId), sub)
}

/* ══════════════════════════════════════════════════════════════════
   四、闸门：路径收敛 + 文件名安全
   ══════════════════════════════════════════════════════════════════ */

/**
 * `target` 是否落在 `root` **之内**（含 root 本身）。
 *
 * ★★ 为什么不用"字符串前缀"比较：`…\shop` 与 `…\shop-evil` 只差一个分隔符，
 *   前缀比较会把后者判成"在里面"。⇒ 用 `relative()` 逐段判更稳。
 * ★ 逐段查 `..` 而不是 `startsWith('..')`：`..foo` 是**合法文件名**，
 *   用前缀判会把它误杀。
 * ★ 大小写：Windows 路径不区分大小写 ⇒ 比较前统一小写（否则同一路径被判越界）。
 *   只影响比较，不影响返回的真实路径。
 */
export function isPathInShop(shopRoot: string, target: string): boolean {
  const p = builtin<PathLike>('node:path')
  const win = (proc()?.platform ?? '') === 'win32'

  const a = p.resolve(shopRoot)
  const b = p.resolve(target)
  const from = win ? a.toLowerCase() : a
  const to = win ? b.toLowerCase() : b

  const rel = p.relative(from, to)
  if (rel === '') return true
  if (p.isAbsolute(rel)) return false

  const segs = rel.split(/[\\/]+/u).filter((s) => s !== '' && s !== '.')
  return !segs.includes('..')
}

/** 一个子目录名是否合法（**只有**那三个固定的） */
export function isShopSubdir(v: unknown): v is ShopSubdir {
  return typeof v === 'string' && (SHOP_SUBDIRS as readonly string[]).includes(v)
}

/**
 * 把用户给的文件名收敛成一个**安全的单段文件名**。
 * 返回 `null` = 这个名字不能用。
 *
 * ★ 这里做的是**防御性剥离**（只取最后一段），**不是"替用户改名"**：
 *   浏览器拖放给的 `File.name` 本来就是**纯文件名**（不含目录），
 *   正常路径下这一步不改变任何东西。
 *   但接口层可能被喂 `..\..\x` 这类名字 —— 那是**越界尝试**，
 *   剥离后它只剩 `x`，落点仍在抽屉里。**拦的是路径，不是名字。**
 * ★ 真正非法的名字（空 / `.` / `..` / 含保留字符 / 以点或空格结尾）**明确拒绝**，
 *   并由调用方**逐个报出原因**，不静默换成别的名字 ——
 *   用户找不到自己那份文件时，最怕的是没人告诉他。
 */
export function safeFileName(input: string): string | null {
  const p = builtin<PathLike>('node:path')
  const name = p.basename(input.trim())
  if (name === '' || name === '.' || name === '..') return null
  if (name.length > 160) return null
  // Windows 保留字符 + 控制字符
  // eslint-disable-next-line no-control-regex
  if (/[<>:"/\\|?*\u0000-\u001f]/u.test(name)) return null
  if (/[. ]$/u.test(name)) return null // Windows 不许以点或空格结尾
  return name
}

/** 能否读成文本（按扩展名白名单） */
export function isReadableText(name: string): boolean {
  const p = builtin<PathLike>('node:path')
  return TEXT_EXTS.includes(p.extname(name).toLowerCase())
}

/* ══════════════════════════════════════════════════════════════════
   五、结果类型
   ══════════════════════════════════════════════════════════════════ */

export type ShopResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; error: string }

function fail<T>(code: string, error: string): ShopResult<T> {
  return { ok: false, code, error }
}

/** 确保三个抽屉都在。★ 幂等：每次调用都补齐，用户手工删了也会回来 */
export function ensureShop(accountId: string): ShopResult<{ root: string; shopKey: string }> {
  try {
    const fs = builtin<FsLike>('node:fs')
    const a = shopKeyOf(accountId)
    for (const sub of SHOP_SUBDIRS) {
      fs.mkdirSync(shopDirOf(accountId, sub), { recursive: true })
    }
    return { ok: true, value: { root: shopsRoot(), shopKey: a } }
  } catch (e) {
    return fail('fs-unavailable', e instanceof Error ? e.message : String(e))
  }
}

/* ══════════════════════════════════════════════════════════════════
   六、四个操作
   ══════════════════════════════════════════════════════════════════ */

/**
 * 列出一个抽屉里的文件。
 * ★ 不跟随符号链接（`isSymbolicLink()` 直接跳过）：链接可以指向铺子外面，
 *   跟随它等于把上面那道收敛闸门绕过去。这里不需要它，就不开这个口子。
 */
export function listShopFiles(accountId: string, sub: ShopSubdir): ShopResult<ShopFileEntry[]> {
  let fs: FsLike
  try {
    fs = builtin<FsLike>('node:fs')
  } catch (e) {
    return fail('fs-unavailable', e instanceof Error ? e.message : String(e))
  }

  const dir = shopDirOf(accountId, sub)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const out: ShopFileEntry[] = []
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.isSymbolicLink()) continue
      if (!d.isFile()) continue
      const abs = builtin<PathLike>('node:path').join(dir, d.name)
      // ★ 双保险：即便 readdir 给了越界名字，也在这里再收敛一次
      if (!isPathInShop(dir, abs)) continue
      const st = fs.statSync(abs)
      out.push({
        name: d.name,
        sub,
        size: st.size,
        mtimeMs: st.mtimeMs,
        readable: isReadableText(d.name),
      })
    }
    out.sort((x, y) => y.mtimeMs - x.mtimeMs)
    return { ok: true, value: out }
  } catch (e) {
    return fail('list-failed', e instanceof Error ? e.message : String(e))
  }
}

/** 写入一批文件（内容为 base64）。★ 逐文件报结果，不搞"整体成败" */
export function writeShopFiles(
  accountId: string,
  sub: ShopSubdir,
  files: readonly { name: string; base64: string }[],
): ShopResult<{ written: { name: string; size: number }[]; failed: { name: string; error: string }[] }> {
  let fs: FsLike
  let Buf: BufferModuleLike['Buffer']
  try {
    fs = builtin<FsLike>('node:fs')
    // ★ 取的是 `Buffer` **类**（静态成员 from/…）—— 见 `BufferModuleLike` 的注释
    Buf = builtin<BufferModuleLike>('node:buffer').Buffer
  } catch (e) {
    return fail('fs-unavailable', e instanceof Error ? e.message : String(e))
  }

  const dir = shopDirOf(accountId, sub)
  const written: { name: string; size: number }[] = []
  const failed: { name: string; error: string }[] = []

  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {
    return fail('mkdir-failed', e instanceof Error ? e.message : String(e))
  }

  for (const f of files) {
    const name = safeFileName(f.name)
    if (name === null) {
      failed.push({ name: f.name, error: '这个文件名在本机不合法，换一个再试' })
      continue
    }
    const abs = builtin<PathLike>('node:path').join(dir, name)
    if (!isPathInShop(dir, abs)) {
      failed.push({ name, error: '文件名越出了这个抽屉' })
      continue
    }
    // ★★ 先校验形态、**再**解码 —— 顺序不能反。
    //   `Buffer.from(x, 'base64')` 对非法字符是**静默忽略**的（不抛、不报错），
    //   所以"能不能解码"这件事永远测不出问题；真正**能失败**的判据是形态正则。
    //   少了这一步，前端递进来一段坏数据，就会静默写出一份"看不出错"的歪文件。
    if (!BASE64_RE.test(f.base64)) {
      failed.push({ name, error: '内容不是 base64（编码不对）' })
      continue
    }
    const bytes = Buf.from(f.base64, 'base64')
    if (bytes.length > MAX_FILE_BYTES) {
      failed.push({
        name,
        error: `文件 ${(bytes.length / 1024 / 1024).toFixed(1)} MB，超过单次 ${MAX_FILE_BYTES / 1024 / 1024} MB 上限`,
      })
      continue
    }
    try {
      fs.writeFileSync(abs, bytes)
      written.push({ name, size: bytes.length })
    } catch (e) {
      failed.push({ name, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { ok: true, value: { written, failed } }
}

/** 删一个文件。★ 不给"整目录清空"这种口子 —— 一个动作对应一个文件 */
export function removeShopFile(accountId: string, sub: ShopSubdir, name: string): ShopResult<null> {
  const safe = safeFileName(name)
  if (safe === null) return fail('bad-name', '这个名字在本机不合法')

  let fs: FsLike
  let p: PathLike
  try {
    fs = builtin<FsLike>('node:fs')
    p = builtin<PathLike>('node:path')
  } catch (e) {
    return fail('fs-unavailable', e instanceof Error ? e.message : String(e))
  }

  const dir = shopDirOf(accountId, sub)
  const abs = p.join(dir, safe)
  if (!isPathInShop(dir, abs)) return fail('out-of-shop', '这个路径不在当前铺子里')

  try {
    if (!fs.existsSync(abs)) return fail('not-found', '这个文件已经不在了（刷新看看）')
    // ★ 符号链接一律不删：它指向别处，删链接与"删掉看到的那个文件"是两回事
    if (fs.lstatSync(abs).isSymbolicLink()) return fail('is-link', '这是一个快捷方式，本层不动它')
    fs.unlinkSync(abs)
    return { ok: true, value: null }
  } catch (e) {
    return fail('remove-failed', e instanceof Error ? e.message : String(e))
  }
}

/** 读回一个文本文件（供"填入待审内容"这类动作）。超长**截断并标注** */
export function readShopTextFile(
  accountId: string,
  sub: ShopSubdir,
  name: string,
): ShopResult<{ name: string; text: string; size: number; truncated: boolean }> {
  const safe = safeFileName(name)
  if (safe === null) return fail('bad-name', '这个名字在本机不合法')
  if (!isReadableText(safe)) {
    return fail('not-text', '这类文件不能直接读回文本（它照样存在，也照样能删）')
  }

  let fs: FsLike
  let p: PathLike
  try {
    fs = builtin<FsLike>('node:fs')
    p = builtin<PathLike>('node:path')
  } catch (e) {
    return fail('fs-unavailable', e instanceof Error ? e.message : String(e))
  }

  const dir = shopDirOf(accountId, sub)
  const abs = p.join(dir, safe)
  if (!isPathInShop(dir, abs)) return fail('out-of-shop', '这个路径不在当前铺子里')

  try {
    if (!fs.existsSync(abs)) return fail('not-found', '这个文件已经不在了（刷新看看）')
    const st = fs.lstatSync(abs)
    if (!st.isFile() || st.isSymbolicLink()) return fail('not-file', '这不是一个普通文件')
    const raw = fs.readFileSync(abs)
    const truncated = st.size > MAX_TEXT_BYTES
    const text = truncated ? raw.toString('utf8').slice(0, MAX_TEXT_BYTES) : raw.toString('utf8')
    return { ok: true, value: { name: safe, text, size: st.size, truncated } }
  } catch (e) {
    return fail('read-failed', e instanceof Error ? e.message : String(e))
  }
}

/* ══════════════════════════════════════════════════════════════════
   七、在系统文件管理器里打开铺子目录（2026-10-06）
   ══════════════════════════════════════════════════════════════════ */

/** `node:child_process` 的最小形状 —— ★ 只要 `spawn`，**不要 `exec`**（理由见下） */
interface ChildProcessLike {
  spawn(
    cmd: string,
    args: readonly string[],
    opts: { detached: boolean; stdio: 'ignore' },
  ): { unref?: () => void }
}

/**
 * 在系统文件管理器里打开**铺子资料目录**（界面上「存在本机：…」旁边那个按钮）。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 为什么在 host 做，而不是让桌面壳（Tauri command）去做
 * ══════════════════════════════════════════════════════════════════
 *   壳那条路**实测走不通**：报 `Command open_local_path not allowed by ACL`
 *   —— Tauri v2 的 ACL 默认**只给 bundled 页面** Tauri API 权限，
 *   而插件界面是**侧车提供的 http 页面**（属 remote source）。
 *   ⇒ 放 host，三条理由：
 *     ① host 本来就是**本地运行时**，"打开本机目录"是它的本职
 *     ② **浏览器版也能用**（不依赖桌面壳的存在）
 *     ③ 复用现成的 RPC 通道 —— 零新机制
 *   （早先那处 `openPath` —— 同款做法；差别在两处"更严"，见下一条。
 *     ★ 只留先例名，**不写它的仓内路径**：本仓的消毒判据把内部路径与业务标识
 *       一律算作 FAIL，而"某仓的某个文件"这种信息对读这段注释毫无必要。）
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 两处比那个先例**更严**（不是照抄，是收紧）
 * ══════════════════════════════════════════════════════════════════
 *   ① **只接受枚举 `sub`，不接受路径**：那边收 `path` 再 `resolve()` 收敛；
 *      这里**路径一律由 host 自己算** ⇒ 外面**根本传不进任意路径**。
 *   ② 与其它铺子资料端点同口径：**不看接入状态** —— 本机操作，
 *      断网 / 未接入服务端时照常可用（两者不是一回事）。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 两个必须照做的细节（都是别人踩出来的，不照做就出"看不见的错"）
 * ══════════════════════════════════════════════════════════════════
 *   · **必须 `path.resolve()` 规范化**：Windows 的 `explorer.exe` **不认正斜杠**。
 *     实测表现：传正斜杠它**不报错**，而是**默默打开「文档」** ——
 *     看起来成功了，其实打开了错的地方，**比报错更难发现**。
 *   · **以参数传路径、不经 shell**：`spawn(cmd, args)` 不经过命令解释器 ⇒ 无法注入；
 *     对比 `exec('explorer ' + path)` 是典型注入面 ⇒ 所以这里**只要 `spawn`**。
 *
 * ★ 语义边界：这是**打开目录**，不是"用默认程序打开某个文件"。
 *   后者是"我们替你执行了一份内容"，含义完全不同 —— 本函数只开目录。
 */
export function openShopDir(
  accountId: string,
  sub: string | undefined,
): ShopResult<{ opened: boolean; path: string; opener: string }> {
  // ★ 路径**只由这里算**：默认铺子资料根；给了 sub 才算到那个抽屉
  let dir = shopsRoot()
  if (sub !== undefined && String(sub).trim() !== '') {
    if (!isShopSubdir(sub)) return fail('bad-subdir', '没有这个抽屉')
    dir = shopDirOf(accountId, sub)
  }

  let fs: FsLike
  let p: PathLike
  let cp: ChildProcessLike
  try {
    fs = builtin<FsLike>('node:fs')
    p = builtin<PathLike>('node:path')
    cp = builtin<ChildProcessLike>('node:child_process')
  } catch (e) {
    return fail('fs-unavailable', e instanceof Error ? e.message : String(e))
  }

  // ★ 规范化（Windows explorer 不认正斜杠 —— 见函数头那条实测）
  const abs = p.resolve(dir)
  // ★ 再收敛一次：只允许开**插件数据根之内**的路径（与写/删/读同一条闸门，fail-closed）
  if (!isPathInShop(p.resolve(pluginDataRoot()), abs)) {
    return fail('out-of-shop', '这个路径不在铺子资料区里')
  }
  if (!fs.existsSync(abs)) {
    return fail('not-found', '这个目录还没建出来（先放一个文件进去就会出现）')
  }

  const platform = proc()?.platform ?? ''
  const opener = platform === 'win32' ? 'explorer' : platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    // ★ detached + stdio:'ignore' + unref：
    //   文件管理器窗口**不该绑在宿主进程的生命周期上**，而且 explorer 的退出码常非 0，
    //   等它没有意义。★ 顺带避开本机已知的「同步子进程接管道就 EBUSY」陷阱 ——
    //   这里是**异步 spawn 且不接任何管道**，不触发那个问题。
    const child = cp.spawn(opener, [abs], { detached: true, stdio: 'ignore' })
    child.unref?.()
  } catch (e) {
    return fail('open-failed', `打不开系统文件管理器：${e instanceof Error ? e.message : String(e)}`)
  }

  // ★ 只回"已发起"：**不保证**文件管理器窗口一定弹出（这在 host 侧无法确证，
  //   不编一个"已打开"的确定结论 —— 界面据此如实措辞）。
  return { ok: true, value: { opened: true, path: abs, opener } }
}
