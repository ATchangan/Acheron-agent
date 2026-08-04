// electron/ipc/computer.ts —— 电脑控制域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, shell, dialog, BrowserWindow, clipboard } from 'electron'
import * as fs from 'fs'
import { join, dirname, extname } from 'path'
import * as os from 'os'
import { exec } from 'child_process'

export function registerComputerIpc(deps: {
  assertInsideWorkDir: (p: string) => boolean
  assessRisk: (e: { type: string; command: string }) => string
  getEffectiveWorkDir: () => string | undefined
  getWorkDirOverride: () => string | null
  setWorkDirOverride: (d: string | null) => void
  netFetch: typeof fetch
  workspaceDir: string
  userDataPath: string
}): void {
  const { assertInsideWorkDir, assessRisk, getEffectiveWorkDir, getWorkDirOverride, setWorkDirOverride, netFetch, workspaceDir, userDataPath } = deps

ipcMain.handle('computer:exec', async (_e, cmd: string) => {
  const cmdS = String(cmd || '')
  if (assessRisk({ type: 'terminal', command: cmdS }) === 'L4') {
    const hit = ['rm -rf', 'rm -fr', 'format ', 'mkfs', 'dd if=', 'shutdown', 'restart', 'reg delete', 'chmod 777', 'curl | bash', 'wget | sh', '> /dev/sda', 'taskkill /f /im', 'del /f /s /q c:\\', 'rd /s /q c:\\'].find(d => cmdS.toLowerCase().includes(d.toLowerCase()))
    return 'E:permission denied: 危险命令已被拦截 (' + (hit || '').trim() + ')。如需执行请手动在终端操作。'
  }
  return new Promise<string>((resolve) => {
    // v0.2.1: 更可靠的 PowerShell 检测——检查 powershell 关键字和常见 cmdlet 模式
    const trimmed = cmd.trim()
    const isPS = /^(powershell|pwsh)\b/i.test(trimmed) ||
      /\b(Get-|Set-|New-|Invoke-|Write-|Select-|Where-|ForEach-|Start-Process)\b/i.test(trimmed) ||
      /\$(?:env:|[a-zA-Z_]\w*)/.test(trimmed)
    let finalCmd
    if (isPS) {
      finalCmd = `powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${cmd.replace(/"/g, '\\"')}"`
    } else {
      finalCmd = `cmd /c "${cmd.replace(/"/g, '\\"')}"`
    }
    // v0.2.1: maxBuffer 从 10MB → 50MB; v0.3.0: cwd 跟随自定义工作目录(设置→引擎→工作目录)
    exec(finalCmd, { timeout: 300000, maxBuffer: 50 * 1024 * 1024, encoding: 'utf-8', cwd: getEffectiveWorkDir() }, (err, stdout, stderr) => {
      const out = err ? (stderr || err.message) : (stdout || '')
      const truncated = out.length > 8000 ? out.slice(0, 8000) + '\n...(已截断，共' + out.length + '字符)' : out
      resolve(truncated)
    })
  })
})

// v0.2.3-opt: 实时性能采样 —— CPU(os.cpus 两次采样差) + RAM + GPU(Windows 性能计数器), 2s 缓存
let perfCache: { cpuPct: number; memPct: number; memUsed: number; memTotal: number; gpuPct: number; gpuName: string; cpus: number } | null = null; let perfCacheAt = 0
let lastCpuSample: { idle: number; total: number } | null = null; let lastCpuAt = 0
// v0.2.3-opt: GPU 采样 —— 优先 nvidia-smi(正在使用的 NVIDIA GPU, 准确), 失败回退性能计数器各引擎最大值
let gpuViaNvidia = true
function sampleGpu(): Promise<{ pct: number | null; name: string | null }> {
  return new Promise((resolve) => {
    if (gpuViaNvidia) {
      exec('nvidia-smi --query-gpu=name,utilization.gpu --format=csv,noheader,nounits', { timeout: 3000, windowsHide: true }, (err, stdout) => {
        if (err) { gpuViaNvidia = false; sampleGpuWin(resolve); return }
        const line = String(stdout).trim().split('\n')[0] || ''
        const m = line.match(/(.+),\s*(\d+)/)
        if (m) resolve({ pct: Math.max(0, Math.min(100, parseInt(m[2]))), name: m[1].trim() })
        else resolve({ pct: null, name: null })
      })
    } else sampleGpuWin(resolve)
  })
}
function sampleGpuWin(resolve: (v: { pct: number | null; name: string | null }) => void) {
  const script = "try { $s = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop).CounterSamples; if ($s -and $s.Count -gt 0) { ($s | Measure-Object -Property CookedValue -Maximum).Maximum } else { -1 } } catch { -1 }"
  exec('powershell.exe -NoProfile -NonInteractive -Command "' + script.replace(/"/g, '\"') + '"', { timeout: 4000, windowsHide: true }, (err, stdout) => {
    if (err) return resolve({ pct: null, name: null })
    const v = parseFloat(String(stdout).trim().split('\n').pop() || '')
    resolve({ pct: isFinite(v) && v >= 0 ? Math.min(100, Math.round(v)) : null, name: null })
  })
}
ipcMain.handle('computer:sysPerf', async () => {
  const now = Date.now()
  if (perfCache && now - perfCacheAt < 2000) return perfCache
  // CPU 占用: 两次 os.cpus() 采样差
  const cpus = os.cpus()
  let idle = 0, total = 0
  for (const c of cpus) {
    idle += c.times.idle
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
  }
  let cpuPct = 0
  if (lastCpuSample && now - lastCpuAt > 300) {
    const dIdle = idle - lastCpuSample.idle
    const dTotal = total - lastCpuSample.total
    cpuPct = dTotal > 0 ? Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100))) : 0
  }
  lastCpuSample = { idle, total }; lastCpuAt = now
  const memTotal = os.totalmem(), memFree = os.freemem()
  const memUsed = memTotal - memFree
  const memPct = Math.round(memUsed / memTotal * 100)
  const gpu = await sampleGpu()
  perfCache = { cpuPct, memPct, memUsed, memTotal, gpuPct: gpu.pct ?? 0, gpuName: gpu.name ?? '', cpus: cpus.length }
  perfCacheAt = now
  return perfCache
})
ipcMain.handle('computer:stat', async (_e, filePath: string) => {
  const st = fs.statSync(filePath)
  return { mtimeMs: st.mtimeMs, size: st.size, isFile: st.isFile(), isDirectory: st.isDirectory() }
})
// v0.2.3-opt: readFile 缓存 —— 按 mtime+size 校验, 内容未变直接复用(整文件读取路径)
const readFileCache = new Map<string, { mtimeMs: number; size: number; content: string }>()
ipcMain.handle('computer:readFile', async (_e, filePath: string, offset?: number, limit?: number) => {
  if (!fs.existsSync(filePath)) throw new Error('文件不存在')
  const stat = fs.statSync(filePath)
  // 分段读取：传 offset/limit 时不限制文件大小
  if (offset !== undefined) {
    const fd = fs.openSync(filePath, 'r')
    // v0.2.1: 确保不从 UTF-8 多字节字符中间截断
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
  // v0.2.3-opt: 命中缓存且文件未变 → 零磁盘读
  const hit = readFileCache.get(filePath)
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.content
  const content = fs.readFileSync(filePath, 'utf-8')
  readFileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, content })
  if (readFileCache.size > 500) { const k = readFileCache.keys().next().value; if (k !== undefined) readFileCache.delete(k) }
  return content
})
ipcMain.handle('computer:writeFile', async (_e, filePath: string, content: string) => {
  fs.mkdirSync(dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
  return true
})
ipcMain.handle('computer:readDir', async (_e, dirPath: string) => {
  const items = fs.readdirSync(dirPath, { withFileTypes: true })
  return items.map(item => ({ name: item.name, isDirectory: item.isDirectory(), size: item.isFile() ? fs.statSync(join(dirPath, item.name)).size : 0 }))
})
// ─── v0.2.6: 文件浏览器操作(写操作限定工作目录内, 防误删) ──
// v0.3.1 块G: getEffectiveWorkDir/assertInsideWorkDir 由 deps 注入(main.ts 单一来源)
ipcMain.handle('computer:setWorkDir', (_e, dir: string) => { setWorkDirOverride(dir || null); return true })
ipcMain.handle('computer:mkdir', async (_e, dirPath: string) => {
  try {
    if (!assertInsideWorkDir(dirPath)) return { ok: false, error: '仅允许在工作目录内创建' }
    fs.mkdirSync(dirPath, { recursive: true })
    return { ok: true }
  } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
})
ipcMain.handle('computer:remove', async (_e, targetPath: string) => {
  try {
    if (!assertInsideWorkDir(targetPath)) return { ok: false, error: '仅允许删除工作目录内的文件' }
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
// ─── v0.2.6: 原生右键菜单(文件浏览器) ──
ipcMain.handle('computer:contextMenu', (_e, opts: { path: string; isDir: boolean; isWorkDir?: boolean }) => {
  return new Promise<string>((resolve) => {
    try {
      const { Menu, clipboard } = require('electron')
      const { path, isDir, isWorkDir } = opts
      let done = false
      const pick = (a: string) => { if (!done) { done = true; resolve(a) } }
      const template: Electron.MenuItemConstructorOptions[] = [
        { label: isDir ? '打开文件夹' : '打开文件', click: () => pick('open') },
        { label: '复制路径', click: () => { clipboard.writeText('"' + path + '"'); pick('copy') } },
        { type: 'separator' },
        { label: '重命名', click: () => pick('rename') },
        { label: '删除', click: () => pick('delete') },
      ]
      if (isWorkDir) {
        template.push({ type: 'separator' })
        template.push({ label: '新建文件夹', click: () => pick('mkdir') })
        template.push({ label: '新建文件', click: () => pick('createFile') })
      }
      template.push({ type: 'separator' })
      template.push({ label: '刷新', click: () => pick('refresh') })
      const menu = Menu.buildFromTemplate(template)
      menu.on('menu-will-close', () => setTimeout(() => pick('none'), 200))
      menu.popup({ window: BrowserWindow.getFocusedWindow() || undefined })
    } catch { resolve('none') }
  })
})
ipcMain.handle('computer:systemInfo', () => ({
  platform: os.platform(), arch: os.arch(), hostname: os.hostname(),
  cpus: os.cpus().length, totalMemory: os.totalmem(), freeMemory: os.freemem(),
  uptime: os.uptime(), homeDir: os.homedir(), workspaceDir,
}))
ipcMain.handle('computer:openFile', async (_e, filePath: string) => { await shell.openPath(filePath); return true })
ipcMain.handle('computer:selectFile', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('computer:selectDir', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
// v0.3.0 图片调度修复 FIX-A: 纯文件读取为 dataURL(不解码, 归一化压缩在渲染层 utils/image.ts)
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
  // v0.2.1: 限制图片大小 20MB，防止大图撑爆内存
  const stat = fs.statSync(filePath)
  if (stat.size > 20 * 1024 * 1024) throw new Error('图片文件过大 (>20MB)')
  const buf = fs.readFileSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const mm: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
  return 'data:' + (mm[ext] || 'image/png') + ';base64,' + buf.toString('base64')
})
// v0.2.3-opt: 检索提速 —— 并行遍历(16 路并发) + 扩展忽略目录 + 大文件跳过
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'dist-electron', 'build', 'release', 'out', 'target', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.next', '.nuxt', '.cache', 'coverage', '.gradle', '.tox', 'site-packages'])

ipcMain.handle('computer:grep', async (_e, dirPath: string, pattern: string) => {
  // v0.2.3-opt: 并行遍历 + 忽略大目录 + 大文件跳过
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
  // v0.2.3-opt: 并行遍历 + 忽略大目录
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
ipcMain.handle('computer:clipboardRead', () => { try{return require('electron').clipboard.readText()}catch{return''} })
ipcMain.handle('computer:clipboardWrite', (_e,text:string) => { try{require('electron').clipboard.writeText(text);return true}catch{return false} })

// ─── 代码沙箱 ───────────────────────────────────
ipcMain.handle('computer:codebox', async (_e, lang:string, code:string) => {
  return new Promise<string>(resolve => {
    const tmpDir = join(userDataPath, 'codebox')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const ext = lang === 'python' ? '.py' : lang === 'node' ? '.js' : '.txt'
    // 随机后缀防并发冲突; 顺带清理 60s 前残留的临时文件
    const fp = join(tmpDir, 'codebox_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + ext)
    try { for (const f of fs.readdirSync(tmpDir)) { if (f.startsWith('codebox_') && Date.now() - fs.statSync(join(tmpDir, f)).mtimeMs > 60000) { try { fs.unlinkSync(join(tmpDir, f)) } catch (e) { console.debug('[swallow]', e) } } } } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    fs.writeFileSync(fp, code, 'utf-8')
    const cmd = lang === 'python' ? `python "${fp}"` : lang === 'node' ? `node "${fp}"` : `echo "unsupported: ${lang}"`
    exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve(err ? (stderr || err.message) : stdout)
      try { fs.unlinkSync(fp) } catch (e) { console.debug('[swallow]', e) }
    })
  })
})
ipcMain.handle('computer:processList', async () => {
  return new Promise<string>(resolve=>{ exec('tasklist /FO CSV /NH',{timeout:5000},(e,o)=>resolve(o||'')) })
})
ipcMain.handle('computer:killProcess', async (_e,pid:string) => {
  return new Promise<string>(resolve=>{ exec(`taskkill /PID ${pid} /F`,{timeout:5000},(e,o)=>resolve(o||e?.message||'')) })
})

const activeRequests = new Map<string, { ctrl: AbortController; sid?: string }>()

// v0.3.1 C3: abort 双语义 —— 参数为 requestId 时中止该请求; 为 sid 时中止该会话全部请求; 空则全部

}
