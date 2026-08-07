// electron/ipc/computer-files.ts —— 文件域 IPC（从 computer.ts 拆出，行为不变）
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join, dirname, extname } from 'path'
import { writeFileAtomic } from '../fs-atomic'

export function registerComputerFiles(deps: {
  assertInsideWorkDir: (p: string) => boolean
  assessRisk: (e: { type: string; command?: string; operation?: string; path?: string }) => string
  confirmRisk: (level: string | undefined, kind: string, detail: string, sid?: string, taskId?: string) => Promise<string>
  getEffectiveWorkDir: () => string | undefined
  userDataPath: string
}): void {
  const { assertInsideWorkDir, assessRisk, confirmRisk, getEffectiveWorkDir, userDataPath } = deps
ipcMain.handle('computer:stat', async (_e, filePath: string) => {
  const st = fs.statSync(filePath)
  return { mtimeMs: st.mtimeMs, size: st.size, isFile: st.isFile(), isDirectory: st.isDirectory() }
})
// readFile 缓存 —— 按 mtime+size 校验, 内容未变直接复用(整文件读取路径)
  // v0.3.3 性能优化: 文件读取缓存 —— 总字节上限 + TTL + 按体积淘汰(原只按条数, 大文件可吃几百 MB)
  const READ_CACHE_MAX_BYTES = 32 * 1024 * 1024
  const READ_CACHE_MAX_ENTRIES = 500
  const READ_CACHE_TTL_MS = 10 * 60 * 1000
  const readFileCache = new Map<string, { mtimeMs: number; size: number; content: string; at: number }>()
  let readCacheBytes = 0
  const dropReadCacheEntry = (k: string): void => {
    const e = readFileCache.get(k)
    if (e) { readCacheBytes -= e.content.length; readFileCache.delete(k) }
  }
  const sweepReadCache = (): void => {
    const now = Date.now()
    for (const [k, e] of readFileCache) if (now - e.at > READ_CACHE_TTL_MS) dropReadCacheEntry(k)
    while (readCacheBytes > READ_CACHE_MAX_BYTES || readFileCache.size > READ_CACHE_MAX_ENTRIES) {
      const k = readFileCache.keys().next().value
      if (!k) break
      dropReadCacheEntry(k)
    }
  }
ipcMain.handle('computer:readFile', async (_e, filePath: string, offset?: number, limit?: number) => {
  if (!fs.existsSync(filePath)) throw new Error('文件不存在')
  const stat = fs.statSync(filePath)
  // 分段读取：传 offset/limit 时不限制文件大小
  if (offset !== undefined) {
    const fd = fs.openSync(filePath, 'r')
    // 确保不从 UTF-8 多字节字符中间截断
    let start = offset
    if (start > 0) {
      const probe = Buffer.alloc(4)
      const probeBytes = fs.readSync(fd, probe, 0, 4, Math.max(0, start - 3))
      // 从 start 位置向前扫描，找到 UTF-8 序列边界
      for (let i = start - Math.max(0, start - 3); i <= start; i++) {
        const b = probe[i - Math.max(0, start - 3)]
        if (b === undefined) break
        // UTF-8 起始字节：0xxxxxxx (0x00-0x7F) 或 11xxxxxx (0xC0-0xFF)
        // 非起始字节：10xxxxxx (0x80-0xBF)
        if ((b & 0xC0) !== 0x80) {
          if (i > start) break // 下一个起始字节，用当前 start
          start = i
          break
        }
      }
      // 如果全是续字节（不太可能），使用原始 offset
      if (start < 0) start = offset
    }
    const readSize = limit || 65536
    // 多读 3 字节以确保不截断末尾字符
    const buf = Buffer.alloc(readSize + 3)
    const bytes = fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    // 截断到有效 UTF-8 边界
    let validLen = bytes
    while (validLen > 0) {
      const b = buf[validLen - 1]
      // UTF-8 起始字节（包括 ASCII）标志着前一个字符结束
      if ((b & 0x80) === 0 || (b & 0xC0) === 0xC0) break
      validLen--
    }
    return buf.toString('utf-8', 0, Math.min(validLen, readSize))
  }
  if (stat.size > 5 * 1024 * 1024) throw new Error('文件过大 (>5MB)，请使用 offset/limit 分段读取')
  // 命中缓存且文件未变 → 零磁盘读
  const hit = readFileCache.get(filePath)
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size && Date.now() - hit.at <= READ_CACHE_TTL_MS) return hit.content
  if (hit) dropReadCacheEntry(filePath)
  const content = fs.readFileSync(filePath, 'utf-8')
  const bytes = Buffer.byteLength(content, 'utf-8')
  if (bytes <= READ_CACHE_MAX_BYTES) {
    if (readCacheBytes + bytes > READ_CACHE_MAX_BYTES || readFileCache.size >= READ_CACHE_MAX_ENTRIES) sweepReadCache()
    readFileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, content, at: Date.now() })
    readCacheBytes += bytes
  }
  return content
})
ipcMain.handle('computer:writeFile', async (_e, filePath: string, content: string, sid?: string, taskId?: string) => {
  try {
  if ((await confirmRisk(assessRisk({ type: 'filesystem', operation: 'write', path: filePath }), '写入文件', filePath, sid, taskId)) !== 'allow') return false
    fs.mkdirSync(dirname(filePath), { recursive: true })
    writeFileAtomic(filePath, content)
    return true
  } catch { return false }
})
ipcMain.handle('computer:readDir', async (_e, dirPath: string) => {
  const items = fs.readdirSync(dirPath, { withFileTypes: true })
  return items.map(item => ({ name: item.name, isDirectory: item.isDirectory(), size: item.isFile() ? fs.statSync(join(dirPath, item.name)).size : 0 }))
})
// ─── 文件浏览器操作(写操作限定工作目录内, 防误删) ──
// v0.3.1 块G: getEffectiveWorkDir/assertInsideWorkDir 由 deps 注入(main.ts 单一来源)

ipcMain.handle('computer:mkdir', async (_e, dirPath: string) => {
  try {
    if (!assertInsideWorkDir(dirPath)) return { ok: false, error: '仅允许在工作目录内创建' }
    fs.mkdirSync(dirPath, { recursive: true })
    return { ok: true }
  } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
})
ipcMain.handle('computer:remove', async (_e, targetPath: string, sid?: string, taskId?: string) => {
  try {
    if (!assertInsideWorkDir(targetPath)) return { ok: false, error: '仅允许删除工作目录内的文件' }
  const delCr = await confirmRisk('L3', '删除文件/目录', targetPath, sid, taskId)
  if (delCr !== 'allow') return { ok: false, error: delCr === 'timeout' ? '确认超时（60 秒未操作，已自动拒绝）' : '已取消' }
    const st = fs.statSync(targetPath)
    if (st.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true })
    else fs.unlinkSync(targetPath)
    return { ok: true }
  } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
})
ipcMain.handle('computer:rename', async (_e, oldPath: string, newName: string) => {
  try {
    if (!assertInsideWorkDir(oldPath)) return { ok: false, error: '仅允许重命名工作目录内的文件' }
    if (!newName || newName.includes('/') || newName.includes('\\') || newName.includes(':')) return { ok: false, error: '名称不合法' }
    const newPath = join(dirname(oldPath), newName)
    fs.renameSync(oldPath, newPath)
    return { ok: true }
  } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
})
ipcMain.handle('computer:createFile', async (_e, filePath: string, content?: string) => {
  try {
    if (!assertInsideWorkDir(filePath)) return { ok: false, error: '仅允许在工作目录内创建' }
    if (fs.existsSync(filePath)) return { ok: false, error: '文件已存在' }
    fs.writeFileSync(filePath, content || '', 'utf-8')
    return { ok: true }
  } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
})
// ─── 原生右键菜单(文件浏览器) ──

ipcMain.handle('computer:readFileAsDataUrl', async (_e, path: string) => {
  try {
    if (typeof path !== 'string' || !path.trim()) return 'E:empty-path'
    const ext = path.split('.').pop()?.toLowerCase() || ''
    if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif', 'heic'].includes(ext)) {
      return 'E:unsupported-format: ' + ext + '（支持 png/jpg/jpeg/webp/gif/bmp/svg/avif/heic）'
    }
    const buf = await fs.promises.readFile(path)
    if (buf.length > 50 * 1024 * 1024) return 'E:file-too-large: ' + (buf.length / 1024 / 1024).toFixed(1) + 'MB（上限 50MB）'
    const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', heic: 'image/heic' }
    return 'data:' + (mime[ext] || 'application/octet-stream') + ';base64,' + buf.toString('base64')
  } catch (e) {
    return 'E:read-failed: ' + (e instanceof Error ? e.message : String(e))
  }
})
ipcMain.handle('computer:readImageBase64', async (_e, filePath: string) => {
  // 限制图片大小 20MB，防止大图撑爆内存
  const stat = fs.statSync(filePath)
  if (stat.size > 20 * 1024 * 1024) throw new Error('图片文件过大 (>20MB)')
  const buf = fs.readFileSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const mm: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
  return 'data:' + (mm[ext] || 'image/png') + ';base64,' + buf.toString('base64')
})
// 检索提速 —— 并行遍历(16 路并发) + 扩展忽略目录 + 大文件跳过
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'dist-electron', 'build', 'release', 'out', 'target', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.next', '.nuxt', '.cache', 'coverage', '.gradle', '.tox', 'site-packages'])

ipcMain.handle('computer:grep', async (_e, dirPath: string, pattern: string) => {
  // 并行遍历 + 忽略大目录 + 大文件跳过
  const results: string[] = []
  const scanned = { n: 0 }
  async function walkGrep(dir: string): Promise<void> {
    if (scanned.n > 8000 || results.length >= 100) return
    let entries
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
    const tasks: Promise<void>[] = []
    for (const entry of entries) {
      if (scanned.n > 8000 || results.length >= 100) break
      const fp = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
        tasks.push((async () => { await walkGrep(fp) })())
        if (tasks.length >= 16) { await Promise.all(tasks); tasks.length = 0 }
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx|json|md|css|html|py|rs|go|java|c|cpp|txt|yml|yaml)$/.test(entry.name)) {
        scanned.n++
        try {
          const st = await fs.promises.stat(fp)
          if (st.size > 2 * 1024 * 1024) continue
          const content = await fs.promises.readFile(fp, 'utf-8')
          content.split('\n').forEach((line, idx) => { if (line.includes(pattern)) results.push(fp + ':' + (idx + 1) + ':' + line.trim().slice(0, 200)) })
        } catch (e) { /* binary skip */ console.debug('[swallow]', e) }
      }
    }
    if (tasks.length) await Promise.all(tasks)
  }
  try { await walkGrep(dirPath) } catch (e) { /* ok */ console.debug('[swallow]', e) }
  return results.slice(0, 100).join('\n')
})

ipcMain.handle('computer:find', async (_e, dirPath: string, glob: string) => {
  // 并行遍历 + 忽略大目录
  const results: string[] = []
  const scanned = { n: 0 }
  let regex: RegExp
  try {
    const escSeg = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    regex = new RegExp(String(glob || '').split('*').map(escSeg).join('.*'))
  } catch { return '' }
  async function walkFind(dir: string): Promise<void> {
    if (scanned.n > 8000 || results.length >= 200) return
    let entries
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
    const tasks: Promise<void>[] = []
    for (const entry of entries) {
      if (scanned.n > 8000 || results.length >= 200) break
      const fp = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
        tasks.push((async () => { await walkFind(fp) })())
        if (tasks.length >= 16) { await Promise.all(tasks); tasks.length = 0 }
      } else if (entry.isFile()) { scanned.n++; if (regex.test(entry.name)) results.push(fp) }
    }
    if (tasks.length) await Promise.all(tasks)
  }
  try { await walkFind(dirPath) } catch (e) { /* ok */ console.debug('[swallow]', e) }
  return results.slice(0, 200).join('\n')
})

// ─── 剪贴板 ─────────────────────────────────────
}
