import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, net } from 'electron'
import { join, extname, dirname } from 'path'
import * as fs from 'fs'
import * as http from 'http'
import { exec } from 'child_process'
import * as os from 'os'

// v0.2.2-fix: 使用 Electron net.fetch（Chromium 网络栈，自动跟随 Windows 系统代理）——
// Node 全局 fetch(undici) 不读系统代理，导致浏览器能访问的 API 在应用内超时
const netFetch: typeof fetch = ((...args: Parameters<typeof fetch>) => net.fetch(args[0] as any, args[1] as any)) as any

// v0.2.1: 全局崩溃捕获
process.on('uncaughtException', (err) => { console.error('[FATAL] uncaughtException:', err); fs.appendFileSync(join(app.getPath('userData'), 'crash.log'), new Date().toISOString() + ' uncaughtException: ' + err.stack + '\n') })
process.on('unhandledRejection', (reason) => { console.error('[FATAL] unhandledRejection:', reason); fs.appendFileSync(join(app.getPath('userData'), 'crash.log'), new Date().toISOString() + ' unhandledRejection: ' + reason + '\n') })

// ─── v0.2.1: 安全序列化——消除循环引用和不可序列化对象导致的 IPC 报错 ──
function safeClone(obj: any, seen = new WeakSet()): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  // 防止循环引用
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)
  // 处理数组
  if (Array.isArray(obj)) return obj.map(item => safeClone(item, seen))
  // 处理普通对象
  const result: Record<string, any> = {}
  for (const key of Object.keys(obj)) {
    try {
      const val = obj[key]
      // 跳过函数、Symbol、DOM 节点等不可序列化类型
      const t = typeof val
      if (t === 'function' || t === 'symbol' || t === 'undefined') continue
      if (val instanceof Error) { result[key] = { message: val.message, name: val.name }; continue }
      if (val && typeof val === 'object') {
        // 跳过 Buffer、Stream、Electron 内部对象等
        if (val.constructor?.name === 'BrowserWindow' || val.constructor?.name === 'WebContents') continue
        if (Buffer.isBuffer(val)) { result[key] = '[Buffer ' + val.length + ' bytes]'; continue }
        result[key] = safeClone(val, seen)
      } else {
        result[key] = val
      }
    } catch { /* skip unreadable properties */ }
  }
  return result
}

// ─── v0.2.6: 渲染加速 —— GPU 优先, 无 GPU 自动回退 CPU ─────────
// 模式(settings.general.rendererMode): auto(默认, GPU可用则GPU) / gpu(强制GPU) / cpu(强制CPU软件渲染)
let rendererMode = 'auto'
try {
  const raw0 = fs.readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf-8')
  rendererMode = JSON.parse(raw0)?.general?.rendererMode || 'auto'
} catch { /* 首次运行无设置文件 */ }
if (rendererMode === 'cpu') {
  // 兼容模式: 关闭 GPU, 全 CPU 软件渲染
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
} else {
  // v0.2.6-fix: GPU 模式(auto/gpu) —— 完全自动识别。
  // 不强制指定/不无视黑名单(移除 ignore-gpu-blocklist), 由 Chromium 自动探测 GPU 并决定是否硬件加速:
  //   检测到可用 GPU → 自动启用硬件加速; 无 GPU / 驱动有问题的 GPU → 自动降级软件渲染。
  app.commandLine.appendSwitch('enable-gpu-rasterization')  // 尽力而为: GPU 可用时栅格化走 GPU
  app.commandLine.appendSwitch('enable-zero-copy')          // 尽力而为: 零拷贝合成
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas') // Canvas 2D 加速(可用时)
  app.commandLine.appendSwitch('enable-accelerated-video-decode') // 视频硬解(可用时)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let serverPort = 0

// ─── v0.2.3-fix: 单实例锁 —— 防止多实例并行导致悬浮窗/窗口互相干扰 ──
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  throw new Error('Another instance is running')
}
app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } })

// ─── 路径 ───────────────────────────────────────────
const ROOT = join(__dirname, '..')
const resourcesDir = join(ROOT, 'resources')
const distDir = join(ROOT, 'dist')
const skillsDir = join(ROOT, 'skills')
const userDataPath = app.getPath('userData')
const sessionsDir = join(userDataPath, 'sessions')
const settingsPath = join(userDataPath, 'settings.json')
const memoryPath = join(userDataPath, 'memory.json')
const workspaceDir = join(userDataPath, 'workspace')

for (const d of [sessionsDir, workspaceDir, skillsDir, join(resourcesDir, 'skills')]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

// 启动时初始向量记忆
import('./memory/vector').then(m => { m.initMemory(join(userDataPath, 'memory-vector.json')); m.startAutoSave() }).catch(() => {})
// 启动定时任务
import('./scheduler/cron').then(m => m.initCron(join(userDataPath, 'cron.json'), (prompt: string) => {
  mainWindow?.webContents.send('cron:trigger', prompt)
})).catch(() => {})
// v0.2: 初始化多Agent系统
import('./agent').then(m => { m.initAgentSystemSync() }).catch(() => {})
// v0.2: 启动时加载MCP SSE
import('./mcp/sse-transport').catch(() => {})
import('./cache/tool-cache').catch(() => {})

// ─── HTTP 服务器 ──────────────────────────────────
function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
      '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
    }
    const s = http.createServer((req, res) => {
      const reqPath = (req.url || '/').split('?')[0].replace(/\/$/, '') || '/index.html'
      const fp = join(distDir, reqPath)
      if (!fp.startsWith(distDir)) { res.writeHead(403); res.end('403'); return }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('404'); return }
        res.writeHead(200, { 'Content-Type': mime[extname(fp)] || 'application/octet-stream' })
        res.end(data)
      })
    })
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address(); resolve(typeof addr === 'object' ? addr!.port : 0)
    })
    s.on('error', reject)
  })
}

// ─── 菜单 ──────────────────────────────────────────
function createAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '黄泉Agent', submenu: [
        { label: '关于黄泉Agent', role: 'about' }, { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit() } },
      ],
    },
    {
      label: '编辑', submenu: [
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
        { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图', submenu: [
        { label: '重新加载', role: 'reload' }, { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { label: '实际大小', role: 'resetZoom' },
      ],
    },
    { label: '窗口', submenu: [{ label: '最小化', role: 'minimize' }, { label: '关闭', role: 'close' }] },
  ]))
}

// ─── 窗口 / 托盘 ────────────────────────────────────
// v0.2.1: 读取"最小化/关闭缩至托盘"设置
function trayEnabled(): boolean {
  try {
    if (fs.existsSync(settingsPath)) {
      const d = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      return d?.general?.trayEnabled === true
    }
  } catch { /* ignore */ }
  return false
}
// ─── v0.2.3: 独立浏览器窗口 + 使用中悬浮窗 ─────────────────
let browserPanelWin: BrowserWindow | null = null
let floatHideTimer: any = null

function showBrowserPanel() {
  if (browserPanelWin && !browserPanelWin.isDestroyed()) { browserPanelWin.show(); browserPanelWin.focus(); return }
  // v0.2.3-fix: 若无头浏览器从未导航过, 先加载默认页, 避免面板一直空白/加载
  try {
    // v0.2.4: 默认主页从设置读取（设置 → 工具 → 浏览器设置 → 默认主页）
    let homeUrl = 'https://example.com'
    try {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      const hu = s?.general?.browserHomeUrl
      if (typeof hu === 'string' && hu.trim()) homeUrl = /^https?:\/\//i.test(hu.trim()) ? hu.trim() : 'https://' + hu.trim()
    } catch { /* 忽略 */ }
    const bw = getBrowserWin()
    const wc = bw.webContents
    if (!wc.getURL() || wc.getURL() === 'about:blank' || wc.isLoading()) {
      browserCurUrl = homeUrl
      wc.loadURL(homeUrl).catch(() => {})
    }
  } catch { /* 忽略 */ }
  // v0.2.5: 窗口尺寸从设置读取(浏览器设置 → 实时面板 → 窗口尺寸)
  let winW = 1280, winH = 860
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const w = parseInt(s?.general?.browserWinW), h = parseInt(s?.general?.browserWinH)
    if (!isNaN(w) && w >= 600) winW = w
    if (!isNaN(h) && h >= 400) winH = h
  } catch { /* 忽略 */ }
  browserPanelWin = new BrowserWindow({
    width: winW, height: winH, minWidth: 800, minHeight: 500,
    title: '黄泉Agent · 无头浏览器',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    backgroundColor: '#08080f', show: false,
  })
  browserPanelWin.loadURL('http://127.0.0.1:' + serverPort + '/index.html#browser')
  browserPanelWin.once('ready-to-show', () => browserPanelWin?.show())
  browserPanelWin.on('closed', () => { browserPanelWin = null })
}
function hideBrowserFloat() {
  if (floatHideTimer) { clearTimeout(floatHideTimer); floatHideTimer = null }
  try { mainWindow?.webContents.send('browser:float', { show: false }) } catch { /* 忽略 */ }
}
// v0.2.4: 悬浮提示改为"主窗口内横幅" —— 通过事件推送到主窗口渲染, 不再创建系统悬浮窗
function showBrowserFloat() {
  // 提示时长从设置读取（browserFloatTimeout, 默认 30s）
  let timeoutMs = 30000
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const tv = parseInt(s?.general?.browserFloatTimeout)
    if (!isNaN(tv) && tv > 0) timeoutMs = tv * 1000
  } catch { /* 忽略 */ }
  try { mainWindow?.webContents.send('browser:float', { show: true }) } catch { /* 忽略 */ }
  if (floatHideTimer) clearTimeout(floatHideTimer)
  floatHideTimer = setTimeout(hideBrowserFloat, timeoutMs)
}
ipcMain.handle('browser:showPanel', () => { showBrowserPanel(); hideBrowserFloat(); return true })
// v0.2.3-debug: 窗口诊断
ipcMain.handle('browser:debug', () => {
  const out: any = {}
  const bwAll = BrowserWindow.getAllWindows()
  out.all = bwAll.map((w: any) => {
    const p = w.getParentWindow()
    return { id: w.id, title: w.getTitle(), visible: w.isVisible(), bounds: w.getBounds(), parent: p ? p.id : null, alwaysOnTop: w.isAlwaysOnTop() }
  })
  return out
})
ipcMain.handle('browser:showFloat', () => { showBrowserFloat(); return true })
ipcMain.handle('browser:hideFloat', () => { hideBrowserFloat(); return true })

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: '黄泉Agent', icon: join(resourcesDir, 'icon.png'),
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    backgroundColor: '#08080f', show: false, frame: false,
  })
  mainWindow = win
  win.webContents.on('render-process-gone', (_e, details) => { console.error('[FATAL] renderer crashed:', details.reason, details.exitCode); try { fs.appendFileSync(join(app.getPath('userData'), 'crash.log'), new Date().toISOString() + ' renderer crashed: ' + details.reason + ' ' + details.exitCode + '\n') } catch {}; if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.loadURL('http://127.0.0.1:' + serverPort + '/index.html') } })
  win.loadURL('http://127.0.0.1:' + serverPort + '/index.html')
  win.once('ready-to-show', () => mainWindow?.show())
  win.on('closed', () => { mainWindow = null })
  // v0.2.1: 关闭 → 设置开启时缩至托盘，否则正常退出
  win.on('close', (e) => { if (trayEnabled() && !isQuitting) { e.preventDefault(); mainWindow?.hide() } })
  // v0.2.1: 最小化 → 设置开启时缩至托盘
  ;(win as any).on('minimize', (e: any) => { if (trayEnabled()) { e.preventDefault(); mainWindow?.hide() } })
}

function createTray() {
  const icon = nativeImage.createFromPath(join(resourcesDir, 'icon.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('黄泉Agent')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on('click', () => mainWindow?.show())
}

// ─── 窗口控制 IPC ─────────────────────────────────
// v0.2.6: 渲染状态查询(设置 → 引擎 → 渲染加速)
ipcMain.handle('renderer:status', () => {
  try {
    const st: any = app.getGPUFeatureStatus()
    return {
      mode: rendererMode,
      gpuAcceleration: st?.gpuAcceleration || (st?.webgl === 'enabled' ? 'hardware_accelerated' : 'software_only'),
      webgl: st?.webgl || 'unknown',
      canvas2d: st?.['2d_canvas'] || 'unknown',
    }
  } catch { return { mode: rendererMode, gpuAcceleration: 'unknown', webgl: 'unknown', canvas2d: 'unknown' } }
})
ipcMain.handle('window:setOpacity', (_e, opacity: number) => {
  if (mainWindow) mainWindow.setOpacity(Math.max(0.3, Math.min(1, opacity)))
})
ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window:close', () => { if (trayEnabled() && mainWindow) { mainWindow.hide() } else { isQuitting = true; app.quit() } })

// ─── 设置/会话 ─────────────────────────────────────
ipcMain.handle('settings:load', () => {
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      if (raw.trim()) {
        const data = JSON.parse(raw)
        // v0.2.5-opt: 从独立文件读回大字段
        const g: any = data?.general || {}
        for (const [key, file] of [['agentAvatarImage', 'avatar.dat'], ['bgImage', 'bgimage.dat']] as [string, string][]) {
          const v = g[key]
          if (typeof v === 'string' && v.startsWith('__FILE__')) {
            try { const fv = fs.readFileSync(join(userDataPath, file), 'utf-8'); g[key] = fv } catch { delete g[key] }
          }
        }
        if (g !== data?.general) data.general = g
        console.log('[SETTINGS] loaded providers:', data?.providers?.length)
        return data
      }
    }
  } catch (e) { console.error('settings load error:', e) }
  return { providers: [], general: { theme: 'dark' } }
})
ipcMain.handle('settings:save', (_e, s) => {
  try {
    fs.mkdirSync(userDataPath, { recursive: true })
    // v0.2.5-opt: 大字段(头像/背景图 base64)剥离到独立文件, 避免每次保存全量写 2.8MB 阻塞
    const g = s?.general || {}
    const bigKeys: [string, string][] = [['agentAvatarImage', 'avatar.dat'], ['bgImage', 'bgimage.dat']]
    const g2: any = { ...g }
    for (const [key, file] of bigKeys) {
      const v = (g2 as any)[key]
      if (typeof v === 'string' && v.length > 1024) {
        try { fs.writeFileSync(join(userDataPath, file), v, 'utf-8') } catch { /* 忽略 */ }
        ;(g2 as any)[key] = '__FILE__' + file
      } else if (v === undefined || v === null) {
        try { fs.rmSync(join(userDataPath, file), { force: true }) } catch { /* 忽略 */ }
      }
    }
    const slim = { ...s, general: g2 }
    fs.writeFileSync(settingsPath, JSON.stringify(slim), 'utf-8')
    return true
  } catch (e) { console.error('[SETTINGS] save error:', e); return false }
})

// v0.2.1: 真实存储统计
function dirSize(dir: string): number {
  let total = 0
  try {
    if (!fs.existsSync(dir)) return 0
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name)
      if (f.isDirectory()) total += dirSize(p)
      else if (f.isFile()) total += fs.statSync(p).size
    }
  } catch {}
  return total
}
function fmtSize(b: number): string {
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'
  return (b / 1073741824).toFixed(2) + ' GB'
}
ipcMain.handle('storage:stats', () => {
  try {
    return {
      sessions: fmtSize(dirSize(join(userDataPath, 'sessions'))),
      memory: fmtSize(fs.existsSync(join(userDataPath, 'memory.json')) ? fs.statSync(join(userDataPath, 'memory.json')).size : 0),
      plugins: fmtSize(dirSize(join(userDataPath, 'plugins'))),
      cache: fmtSize(dirSize(join(userDataPath, 'cache'))),
      workspace: fmtSize(dirSize(join(userDataPath, 'workspace'))),
      settings: fmtSize(fs.existsSync(settingsPath) ? fs.statSync(settingsPath).size : 0),
    }
  } catch { return { sessions: '0 B', memory: '0 B', plugins: '0 B', cache: '0 B', workspace: '0 B', settings: '0 B' } }
})

ipcMain.handle('sessions:list', () => {
  try {
    if (!fs.existsSync(sessionsDir)) return []
    return fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')).map(f => {
      const d = JSON.parse(fs.readFileSync(join(sessionsDir, f), 'utf-8'))
      return { id: f.replace('.json', ''), title: d.title || f, messageCount: d.messages?.length || 0, updatedAt: d.updatedAt || '' }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch { return [] }
})
ipcMain.handle('sessions:load', (_e, id: string) => {
  try { const p = join(sessionsDir, id + '.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : { id, title: '新对话', messages: [] } }
  catch { return { id, title: '新对话', messages: [] } }
})
ipcMain.handle('sessions:save', (_e, s) => {
  // v0.2.1: 安全序列化防止循环引用导致 IPC 克隆报错
  // v0.2.5-opt: 异步写盘避免阻塞主进程(大会话含图片 base64 可达数 MB)
  const safe = safeClone(s)
  const content = JSON.stringify({ ...safe, updatedAt: new Date().toISOString() })
  fs.promises.writeFile(join(sessionsDir, safe.id + '.json'), content, 'utf-8').catch((e: any) => console.error('[SESSIONS] save error:', e?.message))
  return true
})
ipcMain.handle('sessions:delete', (_e, id: string) => { try { fs.unlinkSync(join(sessionsDir, id + '.json')) } catch { /* ok */ }; return true })
// v0.2.1: 清空全部对话历史
ipcMain.handle('sessions:clearAll', () => {
  try {
    if (!fs.existsSync(sessionsDir)) return true
    for (const f of fs.readdirSync(sessionsDir)) { if (f.endsWith('.json')) fs.unlinkSync(join(sessionsDir, f)) }
    return true
  } catch { return false }
})
// v0.2.1: 导出对话历史（md/json/txt）到工作目录
ipcMain.handle('sessions:export', async (_e, format: string, workDir?: string) => {
  try {
    const dir = workDir && fs.existsSync(workDir) ? workDir : userDataPath
    const files = fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')) : []
    const all = files.map(f => { try { return JSON.parse(fs.readFileSync(join(sessionsDir, f), 'utf-8')) } catch { return null } }).filter(Boolean)
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'json') {
      const out = join(dir, `huangquan-history-${stamp}.json`)
      fs.writeFileSync(out, JSON.stringify(all, null, 2), 'utf-8')
      return out
    }
    if (format === 'txt') {
      const lines: string[] = []
      for (const s of all) { lines.push(`=== ${s.title || '对话'} ===`); for (const m of s.messages || []) { if (m.role === 'user' || (m.role === 'assistant' && m.content)) lines.push(`[${m.role === 'user' ? '用户' : '黄泉'}] ${(m.content || '').replace(/\n+/g, ' ')}`) } lines.push('') }
      const out = join(dir, `huangquan-history-${stamp}.txt`)
      fs.writeFileSync(out, lines.join('\n'), 'utf-8')
      return out
    }
    // md
    const lines: string[] = ['# 黄泉Agent 对话历史', '']
    for (const s of all) { lines.push(`## ${s.title || '对话'}`, ''); for (const m of s.messages || []) { if (m.role === 'user' || (m.role === 'assistant' && m.content)) lines.push(`**${m.role === 'user' ? '用户' : '黄泉'}**：${(m.content || '').replace(/\n+/g, '\n\n')}`, '') } }
    const out = join(dir, `huangquan-history-${stamp}.md`)
    fs.writeFileSync(out, lines.join('\n'), 'utf-8')
    return out
  } catch (e: any) { return 'E:' + (e.message || String(e)) }
})
// v0.2.1: 恢复出厂设置 —— 重置 settings.json 为默认
ipcMain.handle('settings:reset', () => {
  try {
    const defaults = { providers: [], mediaProviders: [], general: { mode: 'work', theme: 'dark', agentName: '黄泉' } }
    fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2), 'utf-8')
    return true
  } catch { return false }
})

// ─── 人格定义 ──────────────────────────────────────
ipcMain.handle('ishiki:load', () => {
  try { const p = join(resourcesDir, 'ishiki.md'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '' }
  catch { return '' }
})

// ─── Skills 系统 ───────────────────────────────────
ipcMain.handle('skills:list', () => {
  try {
    const dirs = [join(resourcesDir, 'skills')]
    if (fs.existsSync(skillsDir)) dirs.push(skillsDir)
    const skills: { name: string; path: string; description: string }[] = []
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir)) {
        const skillDir = join(dir, entry)
        const mdPath = join(skillDir, 'SKILL.md')
        if (fs.existsSync(mdPath)) {
          const content = fs.readFileSync(mdPath, 'utf-8')
          const desc = (content.match(/description:\s*(.+)/i)?.[1] || entry).trim()
          skills.push({ name: entry, path: mdPath, description: desc })
        }
      }
    }
    return skills
  } catch { return [] }
})
ipcMain.handle('skills:load', (_e, path: string) => {
  try { return fs.readFileSync(path, 'utf-8') }
  catch { return '' }
})

// ─── 记忆系统 ──────────────────────────────────────
ipcMain.handle('memory:load', () => {
  try { return fs.existsSync(memoryPath) ? JSON.parse(fs.readFileSync(memoryPath, 'utf-8')) : { facts: [], summaries: [] } }
  catch { return { facts: [], summaries: [] } }
})
ipcMain.handle('memory:save', (_e, memory) => {
  // v0.2.1: 安全序列化防止循环引用
  fs.writeFileSync(memoryPath, JSON.stringify(safeClone(memory), null, 2), 'utf-8')
  return true
})

// ─── 语义记忆 ───────────────────────────────────
let _vm: any = null
function getVM() {
  if (!_vm) {
    const m = require('./memory/vector')
    m.initMemory(join(userDataPath, 'memory-vector.json'))
    _vm = m
  }
  return _vm
}
ipcMain.handle('memory:search', async (_e, query: string) => {
  try { return getVM().searchMemory(query, 5) } catch { return [] }
})
ipcMain.handle('memory:addVector', async (_e, content: string) => {
  try { getVM().addMemory(content); getVM().saveMemory(); return true } catch { return false }
})
ipcMain.handle('memory:importFile', async (_e, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return false
    const content = fs.readFileSync(filePath, 'utf-8')
    for (const chunk of content.split('\n\n').filter((c:string) => c.trim().length > 50).slice(0, 20)) {
      getVM().addMemory(chunk.trim())
    }
    getVM().saveMemory()
    return true
  } catch { return false }
})
ipcMain.handle('memory:clearVector', async () => {
  try { getVM().clearMemory(); getVM().saveMemory(); return true } catch { return false }
})

// ─── 电脑控制 ──────────────────────────────────────
ipcMain.handle('computer:exec', async (_e, cmd: string) => {
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
    // v0.2.1: maxBuffer 从 10MB → 50MB
    exec(finalCmd, { timeout: 300000, maxBuffer: 50 * 1024 * 1024, encoding: 'utf-8' }, (err, stdout, stderr) => {
      const out = err ? (stderr || err.message) : (stdout || '')
      const truncated = out.length > 8000 ? out.slice(0, 8000) + '\n...(已截断，共' + out.length + '字符)' : out
      resolve(truncated)
    })
  })
})

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
  return fs.readFileSync(filePath, 'utf-8')
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
function assertInsideWorkDir(p: string): boolean {
  try {
    const wd = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general?.workDir
    if (!wd) return false
    const rp = require('path').resolve(p)
    const rw = require('path').resolve(wd)
    return rp === rw || rp.startsWith(rw + require('path').sep)
  } catch { return false }
}
ipcMain.handle('computer:mkdir', async (_e, dirPath: string) => {
  try {
    if (!assertInsideWorkDir(dirPath)) return { ok: false, error: '仅允许在工作目录内创建' }
    fs.mkdirSync(dirPath, { recursive: true })
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
})
ipcMain.handle('computer:remove', async (_e, targetPath: string) => {
  try {
    if (!assertInsideWorkDir(targetPath)) return { ok: false, error: '仅允许删除工作目录内的文件' }
    const st = fs.statSync(targetPath)
    if (st.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true })
    else fs.unlinkSync(targetPath)
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
})
ipcMain.handle('computer:rename', async (_e, oldPath: string, newName: string) => {
  try {
    if (!assertInsideWorkDir(oldPath)) return { ok: false, error: '仅允许重命名工作目录内的文件' }
    if (!newName || newName.includes('/') || newName.includes('\\') || newName.includes(':')) return { ok: false, error: '名称不合法' }
    const newPath = join(dirname(oldPath), newName)
    fs.renameSync(oldPath, newPath)
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
})
ipcMain.handle('computer:createFile', async (_e, filePath: string, content?: string) => {
  try {
    if (!assertInsideWorkDir(filePath)) return { ok: false, error: '仅允许在工作目录内创建' }
    if (fs.existsSync(filePath)) return { ok: false, error: '文件已存在' }
    fs.writeFileSync(filePath, content || '', 'utf-8')
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
})
// ─── v0.2.6: 原生右键菜单(文件浏览器) ──
ipcMain.handle('computer:contextMenu', (_e, opts: { path: string; isDir: boolean; isWorkDir?: boolean }) => {
  return new Promise<string>((resolve) => {
    try {
      const { Menu, clipboard } = require('electron')
      const { path, isDir, isWorkDir } = opts
      let done = false
      const pick = (a: string) => { if (!done) { done = true; resolve(a) } }
      const template: any[] = [
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
ipcMain.handle('computer:readImageBase64', async (_e, filePath: string) => {
  // v0.2.1: 限制图片大小 20MB，防止大图撑爆内存
  const stat = fs.statSync(filePath)
  if (stat.size > 20 * 1024 * 1024) throw new Error('图片文件过大 (>20MB)')
  const buf = fs.readFileSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const mm: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
  return 'data:' + (mm[ext] || 'image/png') + ';base64,' + buf.toString('base64')
})
ipcMain.handle('computer:grep', async (_e, dirPath: string, pattern: string) => {
  const results: string[] = []
  let scanned = 0
  // v0.2.1: 限制深度与扫描文件数，防止大目录阻塞主进程
  function walk(dir: string, depth: number) {
    if (depth > 8 || scanned > 5000 || results.length >= 100) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= 100) return
      const fp = join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') walk(fp, depth + 1)
      else if (entry.isFile() && entry.name.match(/\.(ts|tsx|js|jsx|json|md|css|html|py|rs|go|java|c|cpp)$/)) {
        scanned++
        try {
          const content = fs.readFileSync(fp, 'utf-8')
          const lines = content.split('\n')
          lines.forEach((line, idx) => {
            if (line.includes(pattern)) results.push(`${fp}:${idx + 1}:${line.trim()}`)
          })
        } catch { /* binary skip */ }
      }
    }
  }
  try { walk(dirPath, 0) } catch { /* ok */ }
  return results.slice(0, 100).join('\n')
})
ipcMain.handle('computer:find', async (_e, dirPath: string, glob: string) => {
  const results: string[] = []
  let scanned = 0
  const regex = new RegExp(glob.replace(/\*/g, '.*').replace(/\./g, '\\.'))
  // v0.2.1: 限制深度与扫描文件数
  function walk(dir: string, depth: number) {
    if (depth > 8 || scanned > 5000 || results.length >= 200) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= 200) return
      const fp = join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') walk(fp, depth + 1)
      else if (entry.isFile()) { scanned++; if (regex.test(entry.name)) results.push(fp) }
    }
  }
  try { walk(dirPath, 0) } catch { /* ok */ }
  return results.slice(0, 200).join('\n')
})

// ─── 浏览器自动化 ───────────────────────────────
// v0.2.3: 常驻无头浏览器 —— agent 浏览时页面保持打开，前端可实时截图查看
let browserWin: BrowserWindow | null = null
let browserCurUrl = 'about:blank'
function getBrowserWin(): BrowserWindow {
  if (browserWin && !browserWin.isDestroyed()) return browserWin
  browserWin = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  browserWin.on('closed', () => { browserWin = null })
  return browserWin
}
const waitLoad = (wc: Electron.WebContents, ms = 15000): Promise<void> =>
  new Promise(resolve => {
    const to = setTimeout(() => { cleanup(); resolve() }, ms)
    const cleanup = () => { clearTimeout(to); wc.removeListener('did-finish-load', onLoad); wc.removeListener('did-fail-load', onFail) }
    const onLoad = () => { cleanup(); resolve() }
    const onFail = () => { cleanup(); resolve() }
    wc.once('did-finish-load', onLoad)
    wc.once('did-fail-load', onFail)
  })

ipcMain.handle('browser:navigate', async (_e, url: string) => {
  const bw = getBrowserWin(); const wc = bw.webContents
  try {
    if (wc.getURL() === url) return 'ok'
    ;(wc as any).__loadStart = Date.now()
    await wc.loadURL(url)
  } catch { /* 继续 */ }
  browserCurUrl = wc.getURL() || url
  return 'ok'
})
ipcMain.handle('browser:back', async () => {
  const bw = getBrowserWin(); const wc = bw.webContents
  if (wc.canGoBack()) wc.goBack()
  browserCurUrl = wc.getURL() || browserCurUrl
  return browserCurUrl
})
ipcMain.handle('browser:forward', async () => {
  const bw = getBrowserWin(); const wc = bw.webContents
  if (wc.canGoForward()) wc.goForward()
  browserCurUrl = wc.getURL() || browserCurUrl
  return browserCurUrl
})
ipcMain.handle('browser:reload', async () => {
  const bw = getBrowserWin(); const wc = bw.webContents
  wc.reload()
  return wc.getURL() || browserCurUrl
})
ipcMain.handle('browser:current', () => {
  const bw = getBrowserWin()
  if (bw && !bw.isDestroyed()) browserCurUrl = bw.webContents.getURL() || browserCurUrl
  return browserCurUrl
})
// v0.2.3: 实时快照 —— 前端轮询此接口显示 agent 正在看的页面
// v0.2.3-fix: Windows 上隐藏窗口 capturePage 返回空 —— 截图时临时显示窗口再隐藏
ipcMain.handle('browser:snapshot', async () => {
  let bw: BrowserWindow | null = null
  try {
    bw = getBrowserWin(); const wc = bw.webContents
    if (!wc || wc.isDestroyed()) return { url: browserCurUrl, img: '', loading: false }
    const curUrl = wc.getURL() || browserCurUrl
    if (wc.isLoading() && Date.now() - (wc as any).__loadStart < 15000) return { url: curUrl, img: '', loading: true }
    if (wc.isLoading()) return { url: curUrl, img: '', loading: false }
    const wasVisible = bw.isVisible()
    if (!wasVisible) { bw.showInactive(); await new Promise(r => setTimeout(r, 120)) }
    const img = await wc.capturePage()
    if (!wasVisible) bw.hide()
    let title = ''
    try { title = await wc.executeJavaScript('document.title') } catch { /* 忽略 */ }
    return { url: curUrl, img: img.toDataURL(), loading: false, title: title || '' }
  } catch { if (bw && !bw.isDestroyed()) bw.hide(); return { url: browserCurUrl, img: '', loading: false, title: '' } }
})
// v0.2.3: agent 工具调用 —— 打开页面并返回文本内容（保持旧 browse 语义）
ipcMain.handle('browser:open', async (_e, url: string) => {
  showBrowserFloat() // v0.2.3: agent 使用浏览器时弹出悬浮提示
  const bw = getBrowserWin(); const wc = bw.webContents
  try { await wc.loadURL(url) } catch { /* 继续 */ }
  await waitLoad(wc)
  browserCurUrl = wc.getURL() || url
  try {
    const title = await wc.executeJavaScript('document.title')
    const text = await wc.executeJavaScript('document.body.innerText')
    return `${title}\n\n${String(text || '').slice(0, 10000)}`
  } catch { return '(load error)' }
})
// v0.2.3: agent 工具调用 —— 截取当前页面（保持旧 browse_screenshot 语义）
ipcMain.handle('browser:screenshot', async (_e, url?: string) => {
  showBrowserFloat() // v0.2.3: agent 使用浏览器时弹出悬浮提示
  const bw = getBrowserWin(); const wc = bw.webContents
  if (url && url !== 'about:blank') { try { await wc.loadURL(url) } catch { /* 继续 */ } await waitLoad(wc) }
  browserCurUrl = wc.getURL() || url || browserCurUrl
  try {
    const img = await wc.capturePage()
    return img.toDataURL()
  } catch { return '' }
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
    const fp = join(tmpDir, 'codebox_' + Date.now() + ext)
    fs.writeFileSync(fp, code, 'utf-8')
    const cmd = lang === 'python' ? `python "${fp}"` : lang === 'node' ? `node "${fp}"` : `echo "unsupported: ${lang}"`
    exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve(err ? (stderr || err.message) : stdout)
      try { fs.unlinkSync(fp) } catch {}
    })
  })
})
ipcMain.handle('computer:processList', async () => {
  return new Promise<string>(resolve=>{ exec('tasklist /FO CSV /NH',{timeout:5000},(e,o)=>resolve(o||'')) })
})
ipcMain.handle('computer:killProcess', async (_e,pid:string) => {
  return new Promise<string>(resolve=>{ exec(`taskkill /PID ${pid} /F`,{timeout:5000},(e,o)=>resolve(o||e?.message||'')) })
})

// ─── 浏览器 / 搜索 / 模型探测 ──────────────────────
ipcMain.handle('models:detect', async (_e, baseUrl: string, apiKey: string, opts?: { anthropic?: boolean }) => {
  try {
    let base = (baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')
    // v0.2.2-fix: Anthropic(Claude) 鉴权是 x-api-key 而非 Bearer —— 按 baseUrl / key 前缀自动识别
    const isAnthropic = !!(opts?.anthropic || /anthropic/i.test(base) || (apiKey || '').startsWith('sk-ant-'))
    let url: string
    const headers: Record<string, string> = {}
    if (isAnthropic) {
      url = base.replace(/\/v\d+$/i, '') + '/v1/models'
      headers['x-api-key'] = apiKey || ''
      headers['anthropic-version'] = '2023-06-01'
    } else {
      url = /\/v\d+$/i.test(base) ? base + '/models' : base + '/v1/models'
      headers['Authorization'] = 'Bearer ' + (apiKey || '')
    }
    const res = await netFetch(url, { headers, signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      const hint = res.status === 401 ? 'API Key 无效或未授权'
        : res.status === 403 ? '禁止访问（Key 无权限或地区限制）'
        : res.status === 404 ? '接口路径不存在，请检查 Base URL'
        : res.status === 410 ? '接口已废弃，请更新 Base URL'
        : ''
      return { ok: false, error: 'HTTP ' + res.status + (hint ? '：' + hint : '') }
    }
    const data: any = JSON.parse(await res.text())
    const ids = (data.data || []).map((m: any) => m.id).filter((id: string) => !id.includes('embedding') && !id.includes('rerank'))
    return { ok: true, models: ids }
  } catch (e: any) {
    const msg = String(e?.message || e)
    const hint = /getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(msg) ? '域名无法解析，请检查 Base URL 是否填写正确'
      : /timeout|abort/i.test(msg) ? '请求超时（网络不通或需要代理）'
      : /ECONNREFUSED/i.test(msg) ? '连接被拒绝（地址或端口错误）'
      : /fetch failed/i.test(msg) ? '网络请求失败'
      : ''
    return { ok: false, error: (hint || msg).slice(0, 200) }
  }
})

// v0.2.2: 测试连接 —— 轻量探测 baseUrl + apiKey 是否可用（不拉全量模型）
ipcMain.handle('models:test', async (_e, baseUrl: string, apiKey: string, opts?: { anthropic?: boolean }) => {
  const t0 = Date.now()
  try {
    let base = (baseUrl || '').replace(/\/+$/, '')
    if (!base) return { ok: false, status: 0, latency: 0, message: '请先填写 Base URL' }
    const isAnthropic = !!(opts?.anthropic || /anthropic/i.test(base) || (apiKey || '').startsWith('sk-ant-'))
    let url: string
    const headers: Record<string, string> = {}
    if (isAnthropic) {
      url = base.replace(/\/v\d+$/i, '') + '/v1/models'
      headers['x-api-key'] = apiKey || ''
      headers['anthropic-version'] = '2023-06-01'
    } else {
      url = /\/v\d+$/i.test(base) ? base + '/models' : base + '/v1/models'
      headers['Authorization'] = 'Bearer ' + (apiKey || '')
    }
    const res = await netFetch(url, { headers, signal: AbortSignal.timeout(10000) })
    const latency = Date.now() - t0
    if (res.status === 200) {
      return { ok: true, status: 200, latency, message: '连接成功，API Key 有效' }
    }
    if (res.status === 401) return { ok: false, status: 401, latency, message: '已连接，但 API Key 无效或未授权 (401)' }
    if (res.status === 403) return { ok: false, status: 403, latency, message: '已连接，但无权限 (403)，请检查 Key 或地区限制' }
    if (res.status === 404 || res.status === 410) return { ok: false, status: res.status, latency, message: '服务器可达，但该接口不存在 (' + res.status + ')，此平台可能不支持模型列表接口' }
    return { ok: false, status: res.status, latency, message: '服务器响应异常 (HTTP ' + res.status + ')' }
  } catch (e: any) {
    const latency = Date.now() - t0
    const msg = String(e?.message || e)
    const hint = /getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(msg) ? '域名无法解析，请检查 Base URL 是否填写正确'
      : /timeout|abort/i.test(msg) ? '连接超时（网络不通或需要代理）'
      : /ECONNREFUSED/i.test(msg) ? '连接被拒绝（地址或端口错误）'
      : /fetch failed/i.test(msg) ? '网络请求失败'
      : msg.slice(0, 120)
    return { ok: false, status: 0, latency, message: hint }
  }
})

ipcMain.handle('web:search', async (_e, query: string) => {
  try {
    const u = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)
    const r = await netFetch(u, { signal: AbortSignal.timeout(10000) })
    const h = await r.text()
    // v0.2.1: 多层正则 fallback 以应对 DDG 页面结构变化
    let out: string[] = []
    // 尝试主解析模式
    const re1 = /<a[^>]*class="result__a"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*?>([^<]+)<\/a>/gi
    let m
    while ((m = re1.exec(h)) && out.length < 5) {
      out.push(`${out.length + 1}. ${m[1].trim()}: ${m[2].trim().replace(/<[^>]+>/g, '')}`)
    }
    // fallback: 尝试更宽松的匹配
    if (!out.length) {
      const re2 = /class="result__title"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/gi
      const re2b = /class="result__snippet"[^>]*>([^<]+)/gi
      const titles: string[] = []; const snippets: string[] = []
      while ((m = re2.exec(h))) titles.push(m[1].trim().replace(/<[^>]+>/g, ''))
      while ((m = re2b.exec(h))) snippets.push(m[1].trim().replace(/<[^>]+>/g, ''))
      for (let i = 0; i < Math.min(titles.length, snippets.length, 5); i++) {
        out.push(`${i + 1}. ${titles[i]}: ${snippets[i]}`)
      }
    }
    return out.length ? out.join('\n') : '(无结果)'
  } catch { return '(搜索失败)' }
})

ipcMain.handle('web:fetch', async (_e, url: string) => {
  try {
    const res = await netFetch(url, { signal: AbortSignal.timeout(15000) })
    return await res.text().then(t => t.slice(0, 50000))
  } catch (err: unknown) {
    return 'Error: ' + (err instanceof Error ? err.message : String(err))
  }
})

// ─── v0.2.5: 无头浏览器网页解析工具 web_read (Playwright + 系统 Edge/Chrome) ──
ipcMain.handle('web:read', async (_e, url: string, mode?: string) => {
  try {
    const { webRead } = require('./webtools')
    // 读取设置中的浏览器解析配置(双向绑定全局配置文件)
    let cfg: any = {}
    try { cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general || {} } catch { /* 忽略 */ }
    // 总开关: 关闭后 Agent 无法调用 web_read
    if (cfg.webReadEnabled === false) {
      return JSON.stringify({ ok: false, error: 'web_read 已被禁用', advice: '请在 设置 → 工具 → 无头浏览器网页解析工具 中开启总开关' })
    }
    const timeoutMs = parseInt(cfg.webReadTimeout) || 15000
    const result = await webRead({
      url,
      mode: (mode as any) || 'text',
      headless: cfg.webReadHeadless !== false,
      timeoutMs,
      userAgent: cfg.webReadUA || '',
      proxy: cfg.webReadProxy || '',
      ignoreHTTPSErrors: true,
      cleanAds: cfg.webReadCleanAds !== false,
      autoClose: cfg.webReadAutoClose !== false,
      cookies: cfg.webReadCookies || '',
    })
    return JSON.stringify(result)
  } catch (e: any) {
    return JSON.stringify({ ok: false, error: 'web_read 调用异常: ' + String(e?.message || e), advice: '请查看应用日志或稍后重试' })
  }
})

// ─── 定时任务 ───────────────────────────────────
ipcMain.handle('cron:add', async (_e, expr:string, prompt:string) => {
  try { return require('./scheduler/cron').addJob(expr, prompt) } catch(e:any) { return 'Error: ' + e.message }
})
ipcMain.handle('cron:list', () => { try { return require('./scheduler/cron').listJobs() } catch { return [] } })
ipcMain.handle('cron:remove', (_e, id:string) => { try { require('./scheduler/cron').removeJob(id); return true } catch { return false } })

ipcMain.handle('mcp:connect', async (_e, name, cmd, args) => {
  try { return await require('./mcp/client').connectServer(name, cmd, args||[]) } catch(e:any) { return { error: e.message } }
})
ipcMain.handle('mcp:call', async (_e, server, tool, a) => {
  try { return await require('./mcp/client').callMCPTool(server, tool, a) } catch(e:any) { return 'Error: ' + e.message }
})
ipcMain.handle('mcp:list', () => { try { return require('./mcp/client').listServers() } catch { return [] } })
ipcMain.handle('get:paths', () => ({ skillsDir, pluginsDir: join(userDataPath, 'plugins'), workDir: workspaceDir }))
ipcMain.handle('skills:create', (_e, name: string, content: string) => {
  try {
    const dir = join(skillsDir, name)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')
    return true
  } catch (e: any) { return 'Error: ' + e.message }
})
ipcMain.handle('skills:install', (_e, url: string) => {
  return new Promise<string>(resolve => {
    const name = url.split('/').pop()?.replace('.git','') || 'skill'
    const dir = join(skillsDir, name)
    exec('git clone ' + url + ' "' + dir + '"', { timeout: 30000 }, (err, stdout, stderr) => {
      resolve(err ? ('Error: ' + (stderr || err.message)) : 'ok')
    })
  })
})
ipcMain.handle('skills:delete', (_e, name: string) => {
  try {
    const dir = join(skillsDir, name)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    }
    // 也尝试删除 resources/skills 下的
    const altDir = join(resourcesDir, 'skills', name)
    if (fs.existsSync(altDir)) {
      fs.rmSync(altDir, { recursive: true, force: true })
      return true
    }
    return 'Error: skill not found'
  } catch (e: any) { return 'Error: ' + e.message }
})
ipcMain.handle('plugins:install', (_e, url: string) => {
  return new Promise<string>(resolve => {
    const dir = join(userDataPath, 'plugins')
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (e: any) { resolve('Error: cannot create plugins dir: ' + e.message); return }
    const name = (url.split('/').pop() || 'plugin').replace('.git', '')
    const target = join(dir, name)
    if (fs.existsSync(target)) { resolve('Error: plugin already exists: ' + name); return }
    exec('git clone ' + url + ' "' + target + '"', { timeout: 30000 }, (err, _stdout, stderr) => {
      if (err) { resolve('Error: ' + (stderr || err.message).slice(0, 200)) }
      else { resolve('Plugin installed: ' + name) }
    })
  })
})
ipcMain.handle('plugins:scan', () => {
  try { return require('./plugins/loader').scanPlugins(join(userDataPath, 'plugins')) } catch {
    // fallback: read directory
    try {
      const dir = join(userDataPath, 'plugins')
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => ({ name: d.name, version: 'unknown' }))
    } catch { return [] }
  }
})
ipcMain.handle('plugins:tools', () => { try { return require('./plugins/loader').getPluginTools() } catch { return [] } })
ipcMain.handle('plugins:delete', (_e, name: string) => {
  try {
    const dir = join(userDataPath, 'plugins', name)
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); return true }
    return 'Error: plugin not found'
  } catch (e: any) { return 'Error: ' + e.message }
})
ipcMain.handle('cron:toggle', (_e, id:string) => { try { require('./scheduler/cron').toggleJob(id); return true } catch { return false } })
// ─── v0.2.1: 使用 AbortController 替代全局标志位，支持并发请求 ──────
const activeRequests = new Map<string, AbortController>()

ipcMain.handle('llm:abort', (_e, requestId?: string) => {
  // v0.2.3: 多会话并发 —— 传入 requestId 只中止该请求；不传则中止全部
  if (requestId) {
    const ctrl = activeRequests.get(requestId)
    if (ctrl) { try { ctrl.abort() } catch { /* ok */ } activeRequests.delete(requestId) }
    return
  }
  for (const [rid, ctrl] of activeRequests) {
    try { ctrl.abort() } catch { /* ok */ }
  }
  activeRequests.clear()
})

ipcMain.handle('llm:chat', async (event, params: any) => {
  // v0.2.3: 多会话并发 —— requestId 由调用方传入，用于把流式事件路由回对应会话
  const { provider, model, apiKey, baseUrl, messages, temperature = 0.7, tools, headers: customHeaders } = params
  const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }
  // 合并自定义 Headers（JSON 或 key=value 多行格式）
  if (customHeaders) {
    try { const extra = JSON.parse(customHeaders); Object.assign(reqHeaders, extra) } catch {
      customHeaders.split('\n').forEach((line: string) => { const idx = line.indexOf('='); if (idx > 0) reqHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim() })
    }
  }
  const body: any = { model, messages, temperature, stream: true }
  if (tools?.length) { body.tools = tools }

  let url: string
  // v0.2.1: 兼容设置界面保存的显示名类型（OpenAI Compatible 等），修复非 DeepSeek provider 全部报"不支持的 Provider"
  switch (provider) {
    case 'openai': url = (baseUrl || 'https://api.openai.com') + '/v1/chat/completions'; break
    case 'deepseek': url = (baseUrl || 'https://api.deepseek.com') + '/v1/chat/completions'; break
    case 'OpenAI Compatible':
    case 'custom': {
      let base = (baseUrl || '').replace(/\/+$/, '')
      // baseUrl 可能含 /v1（如 https://api.openai.com/v1）也可能不含（如 https://api.deepseek.com）
      url = /\/v\d+$/i.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions'
      break
    }
    default: event.sender.send('llm:error', '不支持的 Provider: ' + provider + '（请在设置中将类型改为 OpenAI Compatible）'); return
  }

  const requestId = (params as any).requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const abortCtrl = new AbortController()
  activeRequests.set(requestId, abortCtrl)
  // v0.2.3: 请求结束后自动从活跃表移除（防止泄漏 + 精确中止）
  const removeReq = () => activeRequests.delete(requestId)
  event.sender.once('destroyed', removeReq)

  try {
    console.log('[LLM]', provider, model, url, 'msgs:', messages?.length, 'tools:', tools?.length || 0)
    const res = await netFetch(url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(body),
      signal: abortCtrl.signal,
    })
    if (!res.ok) { const e = await res.text().catch(() => ''); console.error('[LLM] FAIL', res.status, e.slice(0, 400)); event.sender.send('llm:error', { requestId, error: `API ${res.status}: ${e.slice(0, 400)}` }); return }
    console.log('[LLM] stream ok')
    const reader = res.body?.getReader(); if (!reader) { event.sender.send('llm:error', { requestId, error: '无流' }); return }

    const dec = new TextDecoder(); let buf = ''
    let streamEnded = false // 防止重复发送 done
    // 累积工具调用参数 — v0.2.1: 支持多工具调用
    const tcAccum: Map<number, { id: string; name: string; args: string }> = new Map()

    const flushToolCalls = () => {
      for (const [idx, tc] of tcAccum) {
        event.sender.send('llm:toolCall', { requestId, index: idx, id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })
      }
      tcAccum.clear()
    }

    const sendDone = () => {
      if (streamEnded) return
      streamEnded = true
      flushToolCalls()
      event.sender.send('llm:chunk', { requestId, content: '', done: true })
      removeReq()
    }

    while (true) {
      let done = false, value: Uint8Array | undefined
      try {
        const result = await reader.read()
        done = result.done; value = result.value
      } catch (readErr: any) {
        // reader 被 abort 取消时会抛出，视为正常结束
        if (readErr?.name === 'AbortError' || abortCtrl.signal.aborted) { sendDone(); break }
        throw readErr
      }
      if (done) { sendDone(); break }
      buf += dec.decode(value!, { stream: true })
      // 修复: 使用正确的 SSE 行解析 — 先 split，保留不完整行在 buf 中
      const rawLines = buf.split('\n')
      buf = rawLines.pop() || ''
      for (const rawLine of rawLines) {
        const t = rawLine.trim(); if (!t.startsWith('data: ')) continue
        const d = t.slice(6); if (d === '[DONE]') { sendDone(); continue }
        try {
          const p = JSON.parse(d), choice = p.choices?.[0]
          // 累积工具调用参数片段 — v0.2.1: 支持多工具调用
          const deltaTcs = choice?.delta?.tool_calls
          if (deltaTcs) {
            for (const deltaTc of deltaTcs) {
              const idx = deltaTc.index ?? 0
              if (!tcAccum.has(idx)) tcAccum.set(idx, { id: '', name: '', args: '' })
              const cur = tcAccum.get(idx)!
              if (deltaTc.id) cur.id = deltaTc.id
              if (deltaTc.function?.name) cur.name = deltaTc.function.name
              if (deltaTc.function?.arguments !== undefined) cur.args += deltaTc.function.arguments
            }
          }
          if (choice?.finish_reason) {
            // 仅刷新 tool calls + usage，done 由 sendDone() 统一处理（外层 done 或 [DONE] 触发）
            flushToolCalls()
            if (p.usage) event.sender.send('llm:usage', { requestId, ...p.usage })
            continue
          }
          const c = choice?.delta?.content || ''
          if (c) event.sender.send('llm:chunk', { requestId, content: c, done: false })
        } catch { /* ignore malformed JSON lines */ }
      }
    }
  } catch (err: unknown) {
    removeReq()
    if (err instanceof Error && (err.name === 'AbortError' || abortCtrl.signal.aborted)) {
      // 用户主动取消，不报错
    } else {
      event.sender.send('llm:error', { requestId, error: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    // 确保 reader 被释放
    activeRequests.delete(requestId)
  }
})

// v0.2.1: 非流式单次 LLM 调用 —— 多 Agent 分发时子 Agent 独立执行
ipcMain.handle('llm:chatOnce', async (_e, params: any) => {
  const { provider, model, apiKey, baseUrl, messages } = params
  try {
    let base = (baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')
    const url = base.endsWith('/v1') ? base + '/chat/completions' : base + '/v1/chat/completions'
    const res = await netFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 4096 }),
      signal: AbortSignal.timeout(120000),
    })
    const data = await res.json()
    if (!res.ok) return 'E:' + (data.error?.message || ('HTTP ' + res.status))
    return data.choices?.[0]?.message?.content || '(empty)'
  } catch (e: any) { return 'E:' + (e.message || String(e)) }
})

// v0.2.1: 视觉辅助模型 —— 主模型不支持多模态时，用此接口分析图片（非流式一次性调用）
ipcMain.handle('llm:vision', async (_e, params: any) => {
  const { provider, model, apiKey, baseUrl, imageDataUrl, prompt } = params
  try {
    let base = (baseUrl || '').replace(/\/+$/, '')
    const url = /\/v\d+$/i.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions'
    const body: any = {
      model,
      max_tokens: 800,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt || '请描述这张图片的内容' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ] }],
    }
    const res = await netFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
    if (!res.ok) { const e = await res.text().catch(() => ''); return 'E:视觉API ' + res.status + ' ' + e.slice(0, 200) }
    const data: any = await res.json()
    const text = data.choices?.[0]?.message?.content
    return (typeof text === 'string' && text.trim()) ? text.trim() : 'E:视觉模型返回空'
  } catch (e: any) { return 'E:' + (e?.message || String(e)) }
})

// v0.2.1: 多媒体能力查询 —— media_describe-options 对应实现
// ① 探测本地 LM Studio 视觉模型（http://localhost:1234/v1/models）
// ② 探测已安装的媒体生成 CLI（jimeng-cli / agnes 等）
ipcMain.handle('media:describe', async (_e, opts?: { local?: boolean }) => {
  const out: string[] = []
  // 本地视觉模型探测
  try {
    const url = ((opts as any)?.localUrl || 'http://localhost:1234') + '/v1/models'
    const r = await netFetch(url, { signal: AbortSignal.timeout(5000) })
    if (r.ok) {
      const d: any = await r.json()
      const ids = (d.data || []).map((m: any) => m.id)
      out.push('本地视觉 (LM Studio): ' + (ids.length ? ids.join(', ') : '无已加载模型'))
      out.push('  API: ' + url)
    } else out.push('本地视觉 (LM Studio): 服务未就绪 (' + r.status + ')')
  } catch { out.push('本地视觉 (LM Studio): 连接失败，请确认服务已启动') }
  if ((opts as any)?.local) return out.join('\n')
  // 媒体生成 CLI 探测
  const cliProbe = (cmd: string) => new Promise<string>(resolve => {
    exec(cmd, { timeout: 4000 }, (_e, stdout) => resolve((stdout || '').slice(0, 200).trim()))
  })
  const jimeng = await cliProbe('jimeng --version 2>&1')
  const agnes = await cliProbe('agnes --version 2>&1')
  const kling = await cliProbe('kling --version 2>&1')
  // 从 settings.json 读取多媒体默认配置（主进程无渲染端 store）
  let g: any = {}
  try { g = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).general || {} } catch {}
  out.push('媒体生成适配器:')
  out.push(jimeng ? '  - 即梦 jimeng-cli ✓ ' + jimeng : '  - 即梦 jimeng-cli ✗ 未安装')
  out.push(agnes ? '  - Agnes ✓ ' + agnes : '  - Agnes ✗ 未安装')
  out.push(kling ? '  - 可灵 Kling ✓ ' + kling : '  - 可灵 Kling ✗ 未安装')
  out.push('图片生成默认: ' + (g.mediaImgProvider || '自动探测') + ' / ' + (g.mediaImgMode || 'text2image') + ' / ' + (g.mediaImgRatio || '1:1'))
  out.push('视频生成默认: ' + (g.mediaVideoModel || '自动探测') + ' / ' + (g.mediaVideoMode || 'text2video') + ' / ' + (g.mediaVideoDuration || 5) + 's')
  return out.join('\n')
})

// ─── v0.2: MCP SSE 传输 ─────────────────────────────
ipcMain.handle('mcp:sse:connect', async (_e, name: string, url: string, headers?: Record<string,string>) => {
  try { const tools = await require('./mcp/sse-transport').connectSSE({ name, type:'sse', url, headers }); return tools }
  catch(e:any) { return { error: e.message } }
})
ipcMain.handle('mcp:sse:call', async (_e, server:string, tool:string, args:any) => {
  try { return await require('./mcp/sse-transport').callSSETool(server, tool, args) }
  catch(e:any) { return 'Error: ' + e.message }
})
ipcMain.handle('mcp:sse:list', () => { try { return require('./mcp/sse-transport').listSSEServers() } catch { return [] } })

// ─── v0.2: Agent 系统 ──────────────────────────────
ipcMain.handle('agent:list', () => {
  try { return require('./agent').BUILTIN_AGENTS.map((a:any) => ({ name:a.name, role:a.role, icon:a.icon, tools:a.tools, handoff_to:a.handoff_to })) }
  catch { return [] }
})
ipcMain.handle('agent:route', (_e, msg:string) => {
  try { return require('./agent').routeIntent(msg)?.name || '阎罗王' }
  catch { return '阎罗王' }
})

// ─── v0.2: 工具缓存 ────────────────────────────────
ipcMain.handle('cache:stats', () => {
  try { return require('./cache/tool-cache').getCacheStats() }
  catch { return { size:0, hits:0, misses:0, hit_rate:'0%' } }
})
ipcMain.handle('cache:clear', () => {
  try { return require('./cache/tool-cache').invalidateCache() }
  catch { return 0 }
})
// v0.2.1: 写操作时同步失效主进程缓存
ipcMain.handle('cache:invalidate:write', () => {
  try {
    const tc = require('./cache/tool-cache')
    tc.invalidateCache('read'); tc.invalidateCache('ls')
    tc.invalidateCache('grep'); tc.invalidateCache('find')
    return true
  } catch { return false }
})

// ─── 启动 ──────────────────────────────────────────
app.whenReady().then(async () => {
  // v0.2.6-fix: GPU 状态检测(仅日志/状态查询, 不做运行时禁用)。
  // auto 模式下 GPU 不可用时 Chromium 原生自动降级为软件渲染, 无需手动调用
  // disableHardwareAcceleration(该 API 只能在 app ready 之前调用)。
  try {
    // v0.2.6-fix: 延迟 3s 等 GPU 进程完成初始化后再读取(立即读取会得到 disabled_off 等不准确初始值)
    setTimeout(() => {
      try {
        const gst: any = app.getGPUFeatureStatus()
        console.log('[RENDER] mode=' + rendererMode + ' gpuAcceleration=' + (gst?.gpuAcceleration || 'unknown') + ' webgl=' + gst?.webgl)
      } catch (e2: any) { console.error('[RENDER] gpu detect error:', e2?.message) }
    }, 3000)
  } catch (e: any) { console.error('[RENDER] gpu detect error:', e?.message) }
  serverPort = await startServer()
  createAppMenu()
  createWindow()
  createTray()
  app.on('activate', () => mainWindow?.show())
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !isQuitting) { isQuitting = true; app.quit() } })
app.on('before-quit', () => { isQuitting = true })
