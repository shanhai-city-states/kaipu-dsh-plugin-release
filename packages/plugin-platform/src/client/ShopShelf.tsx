/**
 * 山海·开铺 · 场地插件 · client half —— **铺子资料**（本机目录）
 * =====================================================================
 * 用户自己的资料放在哪儿、放进去了什么、怎么拿出来用 —— 这一块只回答这三个问题。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 为什么它**自取数据**，不从面板快照那条链上拿
 * ══════════════════════════════════════════════════════════════════
 * 它读写的是**本机目录**，与"接没接上服务端"毫无关系。
 * 若把它挂到快照链上，就会出现最荒唐的一种状态：
 *   **未接入服务端 ⇒ 连自己的文件都看不见了**。
 * ⇒ 它自己经 `currentConnection()` 调 host（与本仓 `run.ts` 同款做法），
 *   自成一体：服务端挂了、演示模式下，它**照常工作**。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 为什么把「数据根路径」摆在界面上
 * ══════════════════════════════════════════════════════════════════
 * 用户有权知道自己的东西存在哪里 —— 能自己去打开、去备份、去拷走。
 * "我们知道但不告诉你"是这一层最不该有的姿态。
 * ⇒ 路径以小字常驻，配一个「复制」。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 拖放的**两处** `preventDefault` 都是必须的（少一处就废）
 * ══════════════════════════════════════════════════════════════════
 *   · `onDragOver` 不拦 ⇒ 浏览器**不认这是落点**，`drop` 根本不触发；
 *   · `onDrop`     不拦 ⇒ 浏览器会「导航到该文件」，**整个页面被换掉**。
 * 两者症状完全不同，但都会被当成"拖放没做"。写在这里省下一次排查。
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type {
  OpenShopDirResult,
  ReadShopTextResult,
  ShopFileEntry,
  ShopFilesPayload,
  ShopSubdir,
  WriteShopFilesResult,
} from '@shanhai/kaipu-contract'
import { SHOP_SUBDIRS } from '@shanhai/kaipu-contract'
import { ENDPOINTS, callKaipu } from './bridge.js'
import { currentConnection } from './live.js'
import { C, FS, LH } from './theme.js'

/* ─────────────────────── 小工具 ─────────────────────── */

function fmtSize(n: number): string {
  if (n < 1024) return `${String(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * `ArrayBuffer` → base64。
 * ★ 分块拼串：`String.fromCharCode(...bytes)` 一次摊开几 MB 会**爆栈**
 *   （`Maximum call stack size exceeded`）—— 而拖进来的文件经常不止几百 KB。
 */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/* ─────────────────────── 主体 ─────────────────────── */

export interface ShopShelfProps {
  /** 把一份文本交出去（供"填入待审内容"）。`null` = 当前没有可填的落点 */
  onFill: ((text: string, name: string) => void) | null
  /**
   * 折叠状态**由装配层持有**（2026-10-07 加）。
   *
   * ★ 为什么抬上去：面板**顶部**现在也有一个入口（「铺子资料 ↓」= 展开 + 滚到底）。
   *   顶部按钮与底部抽屉说的是**同一件事** ⇒ 状态只能有一个来源，
   *   否则会出现"顶部按钮说已展开、抽屉自己觉得是收起的"这种两处各说各话。
   *   （与 `PlatformPanel` 里 `fill` 那条同一条理由：两个组件要对话，状态要抬到共同祖先。）
   *
   * ★ 它**不影响本块的自洽**：数据仍然自己取（见文件头），
   *   折叠只是个显示位，抬出去不产生任何对服务端/快照链的依赖。
   */
  open: boolean
  onToggleOpen: () => void
}

/**
 * ★★ 三个抽屉**一次性全列**（一次调用拿全部，不是三次往返）：
 *   抽屉只有三个，用户一眼看完比"点一下等一次"强。
 */
export function ShopShelf({ onFill, open, onToggleOpen }: ShopShelfProps): ReactElement {
  const [payload, setPayload] = useState<ShopFilesPayload | null>(null)
  /** 读失败的原因（★ 与"读到了但是空的"必须分开表达） */
  const [loadErr, setLoadErr] = useState<string | null>(null)
  /** 正在做什么（上传/删除/读取时的提示）。`null` = 空闲 */
  const [busy, setBusy] = useState<string | null>(null)
  /** 本次动作的结果提示（成功与失败都往这里写，**如实说**） */
  const [note, setNote] = useState<string | null>(null)
  /** 当前被拖到哪个抽屉上方（高亮用） */
  const [over, setOver] = useState<ShopSubdir | null>(null)
  /* ★ 折叠状态**不在这里** —— 它由装配层持有（见 ShopShelfProps.open 的注释）。
     这里只留"正在忙什么/提示什么"这类**本块私有**的状态。 */

  const reload = useCallback(async (): Promise<void> => {
    const conn = currentConnection()
    if (conn === null) {
      setLoadErr('没取到宿主的数据通道，这一块暂时读不了。这是环境问题，不是文件坏了。')
      return
    }
    const r = await callKaipu<ShopFilesPayload>(conn, ENDPOINTS.listShopFiles, {})
    if (r.ok === true) {
      setPayload(r.data)
      setLoadErr(null)
    } else {
      setLoadErr('business' in r ? r.business.message : r.error.detail)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * 打开系统文件管理器（2026-10-06）。
   *
   * ★ 本机操作，与"接没接上服务端"无关 —— 未接入时它**照常可用**
   *   （与这一层其它能力同一条口径：没接入服务端从来不是"自己不能用"的理由）。
   *
   * ★★ 措辞是「**已请**系统打开」，**不是「已打开」** —— host 只回"已发起"，
   *   文件管理器窗口是否真的弹出，这一层无法确证。
   *   说"已打开"就是在陈述一件没被验证的事。
   *
   * ★ 打不开时**降级到「复制」那条路**，并把原因如实说出来 ——
   *   用户永远留着"自己拿路径去资源管理器打开"的出路，不会卡死在这儿。
   */
  const openDir = useCallback(async (): Promise<void> => {
    const conn = currentConnection()
    if (conn === null) {
      setNote('这个环境打不开文件管理器（没取到宿主通道）—— 用「复制」把路径粘到资源管理器里打开即可。')
      return
    }
    setNote(null)
    const r = await callKaipu<OpenShopDirResult>(conn, ENDPOINTS.openShopDir, {})
    if (r.ok === true) {
      setNote(`已请系统打开：${r.data.path}`)
    } else {
      const why = 'business' in r ? r.business.message : r.error.detail
      setNote(`打不开文件管理器（${why}）—— 用「复制」把路径粘到资源管理器里打开即可。`)
    }
  }, [])

  /* ── 放进文件 ── */
  const put = useCallback(
    async (sub: ShopSubdir, list: FileList | null): Promise<void> => {
      const conn = currentConnection()
      if (conn === null || list === null || list.length === 0) return
      const picked = Array.from(list)
      setBusy(`正在放进「${sub}」（${String(picked.length)} 个）…`)
      setNote(null)
      try {
        const files: { name: string; base64: string }[] = []
        for (const f of picked) {
          // ★ 逐个读，读完才发一次请求 —— 请求体是**一元**的（一次调用一次响应）
          files.push({ name: f.name, base64: toBase64(await f.arrayBuffer()) })
        }
        const r = await callKaipu<WriteShopFilesResult>(conn, ENDPOINTS.writeShopFiles, { sub, files })
        if (r.ok === true) {
          const { written, failed } = r.data
          const okPart = written.length > 0 ? `放进去了 ${String(written.length)} 个` : ''
          // ★ 失败的**逐个列出来**（含原因），不折成"部分成功"一句空话
          const badPart = failed.map((f) => `${f.name}：${f.error}`).join('；')
          setNote([okPart, badPart].filter((s) => s !== '').join(' ｜ ') || '没有文件被放进')
        } else {
          setNote(`没能放进去：${'business' in r ? r.business.message : r.error.detail}`)
        }
      } catch (e) {
        setNote(`没能放进去：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setBusy(null)
        setOver(null)
        await reload()
      }
    },
    [reload],
  )

  /* ── 删除 ── */
  const drop = useCallback(
    async (sub: ShopSubdir, name: string): Promise<void> => {
      const conn = currentConnection()
      if (conn === null) return
      setBusy(`正在删除 ${name}…`)
      setNote(null)
      try {
        const r = await callKaipu<{ name: string }>(conn, ENDPOINTS.removeShopFile, { sub, name })
        setNote(r.ok === true ? `已删除 ${name}` : `没删掉：${'business' in r ? r.business.message : r.error.detail}`)
      } finally {
        setBusy(null)
        await reload()
      }
    },
    [reload],
  )

  /* ── 读成文本（填入待审内容） ── */
  const pick = useCallback(
    async (sub: ShopSubdir, name: string): Promise<void> => {
      const conn = currentConnection()
      if (conn === null || onFill === null) return
      setBusy(`正在读 ${name}…`)
      setNote(null)
      try {
        const r = await callKaipu<ReadShopTextResult>(conn, ENDPOINTS.readShopTextFile, { sub, name })
        if (r.ok === true) {
          onFill(r.data.text, name)
          setNote(
            r.data.truncated
              ? `已填入待审内容（★ 这份文件较大，只读回了前 ${fmtSize(r.data.text.length)} —— 完整文件仍在抽屉里）`
              : `已填入待审内容（${fmtSize(r.data.size)}）`,
          )
        } else {
          setNote('business' in r ? r.business.message : r.error.detail)
        }
      } finally {
        setBusy(null)
      }
    },
    [onFill],
  )

  const files = payload?.files ?? []
  const bySub = (sub: ShopSubdir): ShopFileEntry[] => files.filter((f) => f.sub === sub)

  /* ── 读不到时：**如实说**，且不摆出"空抽屉"的样子骗人 ── */
  if (loadErr !== null) {
    return (
      <section data-kaipu-shop="1" style={{ marginTop: 16, fontSize: FS.small, lineHeight: LH.normal }}>
        <div style={{ color: C.dim }}>铺子资料</div>
        <div style={{ marginTop: 4, color: '#b45309' }}>这一块暂时读不了：{loadErr}</div>
      </section>
    )
  }

  return (
    <section data-kaipu-shop="1" style={{ marginTop: 16, fontSize: FS.small, lineHeight: LH.normal }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: C.dim }}>铺子资料</span>
        <button
          type="button"
          // ★ 锚点（判据用）：顶部那个「铺子资料 ↓」要验"点一下真把三个抽屉展开了"，
          //   而**能否失败**靠这条可证伪的初态 —— 探针先用**本按钮**收起 ⇒ 抽屉数必须为 0。
          //   （锚结构属性、不锚文案：文案会改，"收起/展开"这套词已经在别处改过两次。）
          data-kaipu-shop-toggle="1"
          aria-label={open ? '收起铺子资料' : '展开铺子资料'}
          aria-expanded={open}
          onClick={onToggleOpen}
          style={{
            marginLeft: 'auto',
            fontSize: FS.small,
            padding: '1px 8px',
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            background: 'transparent',
            color: C.dim,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          {open ? '收起' : '展开'}
        </button>
      </div>

      {/* ★★ 这句是这一块的「身份声明」，用户点名要它**在顶部、且不被淡化**（2026-10-06）：
          放在折叠开关**外面** ⇒ 收起后它还在 —— 身份声明不跟着内容一起收。 */}
      <div style={{ marginTop: 4, color: C.text }}>
        这三个抽屉就是「你自己的资料」——它们存在本机，不随插件装卸而消失。
      </div>

      {!open ? null : (
        <>
          {/* ★ 如实展示数据根 —— 用户能**自己去打开**这个目录。
              ★ 2026-10-06 补「打开目录」：路径能看见还不够，得能一键走进去。
                （003 有同款能力，做法与安全口径见 host 侧 `shop-files.ts` 的 `openShopDir`。） */}
          {payload !== null && payload.root !== '' && (
            <div style={{ marginTop: 4, color: C.dim, wordBreak: 'break-all' }}>
              存在本机：{payload.root}
              {/* ★ 「打开目录」用正文色（它是主操作）；「复制」仍用淡色（备选出路） */}
              <button
                type="button"
                data-kaipu-shop-opendir="1"
                onClick={() => {
                  void openDir()
                }}
                style={{
                  marginLeft: 6,
                  fontSize: FS.small,
                  padding: '0 6px',
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  background: 'transparent',
                  color: C.text,
                  cursor: 'pointer',
                  font: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                打开目录
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(payload.root)
                  setNote('路径已复制')
                }}
                style={{
                  marginLeft: 4,
                  fontSize: FS.small,
                  padding: '0 6px',
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  background: 'transparent',
                  color: C.dim,
                  cursor: 'pointer',
                  font: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                复制
              </button>
            </div>
          )}

          {/* ★ 本地不可用（运行时没给文件能力）⇒ 说清是哪一块不行，不笼统说"加载失败" */}
          {payload?.unavailable !== undefined && (
            <div style={{ marginTop: 4, color: '#b45309' }}>有一处读不了：{payload.unavailable}</div>
          )}

          {busy !== null && <div style={{ marginTop: 6, color: C.dim }}>{busy}</div>}
          {note !== null && <div style={{ marginTop: 6, color: C.dim }}>{note}</div>}

          {SHOP_SUBDIRS.map((sub) => {
            const rows = bySub(sub)
            const hot = over === sub
            return (
              <div
                key={sub}
                // ★ 抽屉的锚点（判据数它来断"三个抽屉都展开了"）。
                //   值就是抽屉名 —— 判据既能数个数，也能核对是**哪三个**，
                //   不至于"数对了 3 个、但其实是同一个画了三遍"。
                data-kaipu-shop-drawers={sub}
                // ★★ 两处 preventDefault 缺一不可（见文件头）
                onDragOver={(e) => {
                  e.preventDefault()
                  if (over !== sub) setOver(sub)
                }}
                onDragLeave={() => {
                  if (over === sub) setOver(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  void put(sub, e.dataTransfer?.files ?? null)
                }}
                style={{
                  marginTop: 8,
                  padding: '8px 10px',
                  border: `1px ${hot ? 'dashed' : 'solid'} ${hot ? '#2563eb' : C.border}`,
                  borderRadius: 4,
                  background: hot ? 'rgba(37,99,235,0.06)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span>{sub}</span>
                  <span style={{ color: C.dim }}>{rows.length > 0 ? `${String(rows.length)} 个` : ''}</span>
                  <span style={{ marginLeft: 'auto', color: C.dim }}>拖文件到这里</span>
                </div>

                {/* ★ 空抽屉照实说"还没有"，不拿一句"暂无数据"糊过去 */}
                {rows.length === 0 && (
                  <div style={{ marginTop: 3, color: C.dim }}>
                    {sub === '待审材料'
                      ? '要审的东西放这儿 —— 拖进来就行。'
                      : sub === '审校报告'
                        ? '这里放审过之后留下的结论。'
                        : '断网也照样能写的东西放这儿。'}
                  </div>
                )}

                {rows.map((f) => (
                  <div
                    key={f.name}
                    style={{ marginTop: 5, display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}
                  >
                    <span style={{ wordBreak: 'break-all' }}>{f.name}</span>
                    <span style={{ color: C.dim }}>
                      {fmtSize(f.size)} · {fmtTime(f.mtimeMs)}
                    </span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      {/* ★ 只对能读成文本的类型给"填入" —— 二进制读回来是乱码，
                          给了按钮才是骗人。不给按钮 ≠ 不可用：它照样能列表、能删。 */}
                      {f.readable && onFill !== null && (
                        <button
                          type="button"
                          onClick={() => {
                            void pick(f.sub, f.name)
                          }}
                          style={{
                            fontSize: FS.small,
                            padding: '0 6px',
                            border: `1px solid ${C.border}`,
                            borderRadius: 4,
                            background: 'transparent',
                            color: 'inherit',
                            cursor: 'pointer',
                            font: 'inherit',
                          }}
                        >
                          填入待审内容
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          void drop(f.sub, f.name)
                        }}
                        style={{
                          fontSize: FS.small,
                          padding: '0 6px',
                          border: `1px solid ${C.border}`,
                          borderRadius: 4,
                          background: 'transparent',
                          color: C.dim,
                          cursor: 'pointer',
                          font: 'inherit',
                        }}
                      >
                        删除
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}
