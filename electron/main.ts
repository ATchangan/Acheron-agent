import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, net, safeStorage } from 'electron'
import { registerSessionIpc } from './ipc/sessions'
import { registerSettingsIpc } from './ipc/settings'
import { registerMemoryIpc } from './ipc/memory'
import { registerSkillsIpc } from './ipc/skills'
import { registerPluginsIpc } from './ipc/plugins'
import { registerModelStatsIpc } from './ipc/model-stats'
import { registerMcpIpc } from './ipc/mcp'
import { registerCronIpc } from './ipc/cron'
import { registerWindowIpc } from './ipc/window'
import { registerWebIpc } from './ipc/web'
import { registerCacheIpc } from './ipc/cache'
import { registerMiscIpc } from './ipc/misc'
import { registerModelsIpc } from './ipc/models'
import { registerUpdateIpc } from './ipc/update'
import { registerMediaIpc } from './ipc/media'
import { registerBrowserIpc } from './ipc/browser'
import { registerComputerIpc } from './ipc/computer'
import { join, extname, dirname } from 'path'
import * as fs from 'fs'
import * as http from 'http'
import { exec } from 'child_process'
import * as os from 'os'

// v0.2.2-fix: 使用 Electron net.fetch（Chromium 网络栈，自动跟随 Windows 系统代理）——
// Node 全局 fetch(undici) 不读系统代理，导致浏览器能访问的 API 在应用内超时
const netFetch: typeof fetch = ((...args: Parameters<typeof fetch>) => net.fetch(args[0] as string, args[1] as never)) as typeof fetch

// v0.2.1: 全局崩溃捕获
// v0.2.3-fix(P22): 崩溃日志异步追加, 不再同步阻塞主进程
function appendCrashLog(line: string) { try { fs.promises.appendFile(join(app.getPath('userData'), 'crash.log'), line).catch(() => {}) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } }
process.on('uncaughtException', (err) => { console.error('[FATAL] uncaughtException:', err); appendCrashLog(new Date().toISOString() + ' uncaughtException: ' + err.stack + '\n') })
process.on('unhandledRejection', (reason) => { console.error('[FATAL] unhandledRejection:', reason); appendCrashLog(new Date().toISOString() + ' unhandledRejection: ' + reason + '\n') })

// v0.3.0 M5: LLM 调用参数结构
interface LLMMsg { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string; reasoning_content?: unknown }
interface LLMChatParams {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  messages: LLMMsg[]
  temperature?: number
  tools?: unknown[]
  headers?: string
  requestId?: string
  customHeaders?: string
  sid?: string // v0.3.1 C3: 会话级中止过滤
}
interface VisionParams {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  imageDataUrl: string
  prompt?: string
}
// v0.3.0 M5: 本地设置数据结构(electron 不依赖渲染层类型)
interface MainProvider { id: string; type: string; name: string; apiKey?: string; baseUrl?: string; customHeaders?: string }
interface MainSettingsData { providers: MainProvider[]; mediaProviders?: (MediaProvider & { apiKey?: string })[]; general?: Record<string, unknown> }

// ─── v0.2.1: 安全序列化——消除循环引用和不可序列化对象导致的 IPC 报错 ──
function safeClone(obj: unknown, seen = new WeakSet()): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  // 防止循环引用
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)
  // 处理数组
  if (Array.isArray(obj)) return obj.map(item => safeClone(item, seen))
  // 处理普通对象
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    try {
      const val = (obj as Record<string, unknown>)[key]
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
    } catch (e) { /* skip unreadable properties */ console.debug('[swallow]', e) }
  }
  return result
}

// ─── v0.2.3: API Key 加密存储(Windows DPAPI via safeStorage) ──
// 加密不可用(如无 keyring 的环境)时自动回退明文, 旧明文数据兼容读取
function encKey(v: string): string {
  if (!v || v.startsWith('__ENC__')) return v
  try { if (safeStorage.isEncryptionAvailable()) return '__ENC__' + safeStorage.encryptString(v).toString('base64') } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  return v
}
function decKey(v: string): string {
  if (!v || !v.startsWith('__ENC__')) return v
  try { return safeStorage.decryptString(Buffer.from(v.slice(7), 'base64')) } catch { return v }
}
// v0.2.3-fix(N27): 敏感字段全覆盖 —— apiKey + customHeaders(可含 Authorization) + webReadCookies(登录态)
function encProviders(data: MainSettingsData): MainSettingsData {
  if (!data || typeof data !== 'object') return data
  const out = { ...data, general: data.general ? { ...data.general } : data.general }
  if (Array.isArray(out.providers)) out.providers = out.providers.map((p: MainProvider) => (p && p.apiKey) ? { ...p, apiKey: encKey(p.apiKey), customHeaders: p.customHeaders ? encKey(String(p.customHeaders)) : p.customHeaders } : p)
  if (Array.isArray((out as { mediaProviders?: unknown }).mediaProviders)) (out as { mediaProviders: (MediaProvider & { apiKey?: string })[] }).mediaProviders = (out as { mediaProviders: (MediaProvider & { apiKey?: string })[] }).mediaProviders.map((p: MediaProvider & { apiKey?: string }) => (p && p.apiKey) ? { ...p, apiKey: encKey(p.apiKey) } : p)
  if (out.general && typeof out.general.webReadCookies === 'string' && out.general.webReadCookies.trim()) out.general.webReadCookies = encKey(out.general.webReadCookies)
  if (out.general && typeof out.general.embeddingApiKey === 'string' && out.general.embeddingApiKey.trim()) out.general.embeddingApiKey = encKey(out.general.embeddingApiKey)
  return out
}
function decProviders(data: MainSettingsData): MainSettingsData {
  if (!data || typeof data !== 'object') return data
  const out = { ...data, general: data.general ? { ...data.general } : data.general }
  if (Array.isArray(out.providers)) out.providers = out.providers.map((p: MainProvider) => (p && p.apiKey) ? { ...p, apiKey: decKey(p.apiKey), customHeaders: p.customHeaders ? decKey(String(p.customHeaders)) : p.customHeaders } : p)
  if (Array.isArray((out as { mediaProviders?: unknown }).mediaProviders)) (out as { mediaProviders: (MediaProvider & { apiKey?: string })[] }).mediaProviders = (out as { mediaProviders: (MediaProvider & { apiKey?: string })[] }).mediaProviders.map((p: MediaProvider & { apiKey?: string }) => (p && p.apiKey) ? { ...p, apiKey: decKey(p.apiKey) } : p)
  if (out.general && typeof out.general.webReadCookies === 'string' && out.general.webReadCookies.startsWith('__ENC__')) out.general.webReadCookies = decKey(out.general.webReadCookies)
  if (out.general && typeof out.general.embeddingApiKey === 'string' && out.general.embeddingApiKey.startsWith('__ENC__')) out.general.embeddingApiKey = decKey(out.general.embeddingApiKey)
  return out
}

// ─── v0.2.6: 渲染加速 —— GPU 优先, 无 GPU 自动回退 CPU ─────────
// 模式(settings.general.rendererMode): auto(默认, GPU可用则GPU) / gpu(强制GPU) / cpu(强制CPU软件渲染)
let rendererMode = 'auto'
try {
  const raw0 = fs.readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf-8')
  rendererMode = JSON.parse(raw0)?.general?.rendererMode || 'auto'
} catch (e) { /* 首次运行无设置文件 */ console.debug('[swallow]', e) }
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
  // v0.2.3: 直接退出, 不再 throw(避免触发 uncaughtException 写 crash.log 噪音)
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } })

// ─── 路径 ───────────────────────────────────────────
const ROOT = join(__dirname, '..')
const resourcesDir = join(ROOT, 'resources')
const distDir = join(ROOT, 'dist')
const userDataPath = app.getPath('userData')
const sessionsDir = join(userDataPath, 'sessions')
const settingsPath = join(userDataPath, 'settings.json')
registerSettingsIpc({ settingsPath, userDataPath, decProviders: decProviders as unknown as (d: unknown) => Record<string, unknown>, encProviders: encProviders as unknown as (d: unknown) => Record<string, unknown> })
const memoryPath = join(userDataPath, 'memory.json')
registerMemoryIpc({ memoryPath, settingsPath, userDataPath, safeClone, decKey })
const workspaceDir = join(userDataPath, 'workspace')
// v0.2.3-pack(SOP红线): skillsDir 必须在 userData —— 安装版 app.asar 内只读, mkdir 抛 ENOTDIR 导致启动崩溃
const skillsDir = join(userDataPath, 'skills')
registerSkillsIpc({ skillsDir, resourcesDir })

// v0.2.3-pack(SOP红线): mkdir 循环全部 try-catch —— resources/skills 在 asar 内只读, 失败不能崩溃
for (const d of [sessionsDir, workspaceDir, skillsDir, join(resourcesDir, 'skills')]) {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) } catch (e) { /* 只读目录(asar 内)或权限受限: 跳过 */ console.debug('[swallow]', e) }
}

// 启动时初始向量记忆
import('./memory/vector').then(m => { m.initMemory(join(userDataPath, 'memory-vector.json')); m.startAutoSave() }).catch(() => {})
// 启动定时任务
import('./scheduler/cron').then(m => m.initCron(join(userDataPath, 'cron.json'), (prompt: string) => {
  mainWindow?.webContents.send('cron:trigger', prompt)
})).catch(() => {})
// v0.2.3: 多Agent体系已统一为前端实现(chat.ts AGENTS), 主进程 agent 模块已移除
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
        // v0.2.3-fix(P23): 静态资源缓存头(HTML 不缓存, 其余资源 1h)
        const isHtml = reqPath.endsWith('.html') || reqPath === '/'
        res.writeHead(200, {
          'Content-Type': mime[extname(fp)] || 'application/octet-stream',
          'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
        })
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
  } catch (e) { /* ignore */ console.debug('[swallow]', e) }
  return false
}
// ─── v0.2.3: 独立浏览器窗口 + 使用中悬浮窗 ─────────────────
let browserPanelWin: BrowserWindow | null = null
let floatHideTimer: ReturnType<typeof setTimeout> | null = null

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
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    const bw = getBrowserWin()
    const wc = bw.webContents
    if (!wc.getURL() || wc.getURL() === 'about:blank' || wc.isLoading()) {
      browserCurUrl = homeUrl
      wc.loadURL(homeUrl).catch(() => {})
    }
  } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  // v0.2.5: 窗口尺寸从设置读取(浏览器设置 → 实时面板 → 窗口尺寸)
  let winW = 1280, winH = 860
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const w = parseInt(s?.general?.browserWinW), h = parseInt(s?.general?.browserWinH)
    if (!isNaN(w) && w >= 600) winW = w
    if (!isNaN(h) && h >= 400) winH = h
  } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
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
  try { mainWindow?.webContents.send('browser:float', { show: false }) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
}
// v0.2.4: 悬浮提示改为"主窗口内横幅" —— 通过事件推送到主窗口渲染, 不再创建系统悬浮窗
function showBrowserFloat() {
  // 提示时长从设置读取（browserFloatTimeout, 默认 30s）
  let timeoutMs = 30000
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const tv = parseInt(s?.general?.browserFloatTimeout)
    if (!isNaN(tv) && tv > 0) timeoutMs = tv * 1000
  } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  try { mainWindow?.webContents.send('browser:float', { show: true }) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  if (floatHideTimer) clearTimeout(floatHideTimer)
  floatHideTimer = setTimeout(hideBrowserFloat, timeoutMs)
}
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: '黄泉Agent', icon: join(resourcesDir, 'icon.png'),
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    backgroundColor: '#08080f', show: false, frame: false,
  })
  mainWindow = win
  win.webContents.on('render-process-gone', (_e, details) => { console.error('[FATAL] renderer crashed:', details.reason, details.exitCode); try { fs.appendFileSync(join(app.getPath('userData'), 'crash.log'), new Date().toISOString() + ' renderer crashed: ' + details.reason + ' ' + details.exitCode + '\n') } catch (e) { console.debug('[swallow]', e) }; if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.loadURL('http://127.0.0.1:' + serverPort + '/index.html') } })
  win.loadURL('http://127.0.0.1:' + serverPort + '/index.html')
  win.once('ready-to-show', () => mainWindow?.show())
  win.on('closed', () => { mainWindow = null })
  // v0.2.1: 关闭 → 设置开启时缩至托盘，否则正常退出
  win.on('close', (e: Electron.Event) => { if (trayEnabled() && !isQuitting) { e.preventDefault(); mainWindow?.hide() } })
  // v0.2.1: 最小化 → 设置开启时缩至托盘
  win.on('minimize', () => { if (trayEnabled()) { mainWindow?.hide() } })
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
// ─── 设置/会话 ─────────────────────────────────────
function dirSize(dir: string): number {
  let total = 0
  try {
    if (!fs.existsSync(dir)) return 0
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name)
      if (f.isDirectory()) total += dirSize(p)
      else if (f.isFile()) total += fs.statSync(p).size
    }
  } catch (e) { console.debug('[swallow]', e) }
  return total
}
function fmtSize(b: number): string {
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'
  return (b / 1073741824).toFixed(2) + ' GB'
}

// v0.2.3: 会话元数据缓存 —— 避免 list 时全量解析大会话文件(大会话含图片可达数 MB)
const sessionMeta = new Map<string, { title: string; messageCount: number; updatedAt: string }>()
registerSessionIpc({ sessionsDir, userDataPath, sessionMeta, buildSessionMeta, safeClone })
function buildSessionMeta() {
  sessionMeta.clear()
  if (!fs.existsSync(sessionsDir)) return
  for (const f of fs.readdirSync(sessionsDir)) {
    if (!f.endsWith('.json')) continue
    try {
      const d = JSON.parse(fs.readFileSync(join(sessionsDir, f), 'utf-8'))
      sessionMeta.set(f.replace('.json', ''), { title: d.title || f, messageCount: d.messages?.length || 0, updatedAt: d.updatedAt || '' })
    } catch (e) { /* 损坏文件跳过 */ console.debug('[swallow]', e) }
  }
}

// ─── Skills 系统 ───────────────────────────────────
// ─── 记忆系统 ──────────────────────────────────────
// ─── 电脑控制 ──────────────────────────────────────
// v0.2.4: 危险命令拦截统一走 security/permission.ts 风险分级(L4 拒绝), 消除双份列表漂移
const { assessRisk } = require('./security/permission')
registerComputerIpc({ assertInsideWorkDir, assessRisk, getEffectiveWorkDir, getWorkDirOverride: () => workDirOverride, setWorkDirOverride: (d) => { workDirOverride = d }, netFetch, workspaceDir, userDataPath })
registerPluginsIpc({ userDataPath, settingsPath, assertInsideWorkDir, assessRisk, getEffectiveWorkDir })
registerModelStatsIpc()
registerMcpIpc()
registerCacheIpc()
registerMiscIpc({ settingsPath, userDataPath, resourcesDir, skillsDir, workspaceDir, dirSize, fmtSize })
registerModelsIpc({ netFetch })
registerUpdateIpc({ netFetch })
registerMediaIpc({ settingsPath, userDataPath, netFetch, getEffectiveWorkDir })
registerWebIpc({ settingsPath, netFetch, decKey })
registerWindowIpc({ getMainWindow: () => mainWindow, trayEnabled, setQuitting: (v) => { isQuitting = v } })
registerCronIpc()

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
// v0.2.3-opt: readFile 缓存 —— 按 mtime+size 校验, 内容未变直接复用(整文件读取路径)
const readFileCache = new Map<string, { mtimeMs: number; size: number; content: string }>()
// ─── v0.2.6: 文件浏览器操作(写操作限定工作目录内, 防误删) ──
// v0.2.3-fix: set_workdir 只改内存(不持久化污染用户设置), 重启/应用重载后恢复用户设置的工作目录
let workDirOverride: string | null = null
// v0.3.0: 有效工作目录 = 会话覆盖(如有) || 用户设置(可自定义, 设置→引擎→工作目录)
function getEffectiveWorkDir(): string | undefined {
  try {
    if (workDirOverride) return workDirOverride
    const wd = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general?.workDir
    return wd ? String(wd) : undefined
  } catch { return undefined }
}
function assertInsideWorkDir(p: string): boolean {
  try {
    const wd = getEffectiveWorkDir()
    if (!wd) return false
    const rp = require('path').resolve(p)
    const rw = require('path').resolve(wd)
    return rp === rw || rp.startsWith(rw + require('path').sep)
  } catch { return false }
}
// v0.2.3-opt: 检索提速 —— 并行遍历(16 路并发) + 扩展忽略目录 + 大文件跳过
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'dist-electron', 'build', 'release', 'out', 'target', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.next', '.nuxt', '.cache', 'coverage', '.gradle', '.tox', 'site-packages'])



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
registerBrowserIpc({ getBrowserWin, waitLoad, getCurUrl: () => browserCurUrl, setCurUrl: (u) => { browserCurUrl = u }, showBrowserPanel, showBrowserFloat, hideBrowserFloat })

const activeRequests = new Map<string, { ctrl: AbortController; sid?: string }>()

// v0.3.1 C3: abort 双语义 —— 参数为 requestId 时中止该请求; 为 sid 时中止该会话全部请求; 空则全部
ipcMain.handle('llm:abort', (_e, id?: string) => {
  if (!id) {
    for (const [rid, rec] of activeRequests) { try { rec.ctrl.abort() } catch (e) { /* ok */ console.debug('[swallow]', e) } }
    activeRequests.clear()
    return
  }
  if (activeRequests.has(id)) {
    const rec = activeRequests.get(id)!
    try { rec.ctrl.abort() } catch (e) { /* ok */ console.debug('[swallow]', e) }
    activeRequests.delete(id)
    return
  }
  // 会话级中止(该 sid 的全部请求)
  for (const [rid, rec] of activeRequests) {
    if (rec.sid === id) { try { rec.ctrl.abort() } catch (e) { /* ok */ console.debug('[swallow]', e) } activeRequests.delete(rid) }
  }
})

ipcMain.handle('llm:chat', async (event, params: LLMChatParams) => {
  // v0.2.3: 多会话并发 —— requestId 由调用方传入，用于把流式事件路由回对应会话
  const { provider, model, apiKey, baseUrl, messages, temperature = 0.7, tools, headers: customHeaders, sid } = params
  const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }
  // 合并自定义 Headers（JSON 或 key=value 多行格式）
  if (customHeaders) {
    try { const extra = JSON.parse(customHeaders); Object.assign(reqHeaders, extra) } catch {
      customHeaders.split('\n').forEach((line: string) => { const idx = line.indexOf('='); if (idx > 0) reqHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim() })
    }
  }
  const body: Record<string, unknown> = { model, messages, temperature, stream: true }
  // v0.2.3-fix: 官方要求 include_usage 才保证流式返回完整 usage(prompt_cache_hit/miss_tokens), 否则缓存统计缺失
  body.stream_options = { include_usage: true }
  // v0.2.3-debug: 打印首个 assistant(tool_calls) 完整结构(排查 reasoning_content 400)
  if ((messages || []).some((m: LLMMsg) => m.role === 'assistant' && m.tool_calls)) {
    const atc = (messages as LLMMsg[]).find((m: LLMMsg) => m.role === 'assistant' && m.tool_calls)
    const toolMsgs = (messages as { role: string }[]).filter((m: { role: string }) => m.role === 'tool').length
    console.log('[LLM] ATC:', JSON.stringify({ keys: atc ? Object.keys(atc) : [], content: atc?.content, rc: atc?.reasoning_content, tcId: (atc?.tool_calls as { id?: string }[] | undefined)?.[0]?.id, tools: toolMsgs }))
  }
  // v0.2.3-debug: 打印消息 role 序列(排查 tool 消息格式问题)
  if ((messages || []).length > 20) console.log('[LLM] roles:', (messages as { role: string }[]).map((m: { role: string }) => m.role).join(','), '| tc:', (messages as { tool_calls?: unknown }[]).filter((m: { tool_calls?: unknown }) => m.tool_calls).length)
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

  const requestId = params.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const abortCtrl = new AbortController()
  activeRequests.set(requestId, { ctrl: abortCtrl, sid: params.sid })
  // v0.2.3: 请求结束后自动从活跃表移除（防止泄漏 + 精确中止）
  const removeReq = () => { activeRequests.delete(requestId); event.sender.removeListener('destroyed', removeReq) }
  event.sender.once('destroyed', removeReq)
  // v0.2.3: 请求结束(成功/失败)立即清理 listener, 防止 WebContents 监听器累积(修复 MaxListenersExceededWarning)
  const doneClean = () => { removeReq(); event.sender.removeListener('destroyed', removeReq) }

  try {
    console.log('[LLM]', provider, model, url, 'msgs:', messages?.length, 'tools:', tools?.length || 0)
    const res = await netFetch(url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(body),
      signal: abortCtrl.signal,
    })
    if (!res.ok) { const e = await res.text().catch(() => ''); console.error('[LLM] FAIL', res.status, e.slice(0, 400)); doneClean(); console.error('[LLM] FAIL-MSGS:', JSON.stringify((messages || []).slice(0, 6).map((m: LLMMsg) => ({ role: m.role, tc: Array.isArray(m.tool_calls) ? m.tool_calls.length : 0, tcid: m.tool_call_id || null, c: typeof m.content === 'string' ? m.content.slice(0, 60) : null })))); event.sender.send('llm:error', { requestId, error: `API ${res.status}: ${e.slice(0, 400)}` }); return }
    console.log('[LLM] stream ok'); doneClean()
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
      } catch (readErr: unknown) {
        // reader 被 abort 取消时会抛出，视为正常结束
        if ((readErr as Error)?.name === 'AbortError' || abortCtrl.signal.aborted) { sendDone(); break }
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
        } catch (e) { /* ignore malformed JSON lines */ console.debug('[swallow]', e) }
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
ipcMain.handle('llm:chatOnce', async (_e, params: LLMChatParams) => {
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
  } catch (e: unknown) { return 'E:' + ((e instanceof Error ? e.message : String(e)) || String(e)) }
})

// v0.2.1: 视觉辅助模型 —— 主模型不支持多模态时，用此接口分析图片（非流式一次性调用）
ipcMain.handle('llm:vision', async (_e, params: VisionParams) => {
  const { provider, model, apiKey, baseUrl, imageDataUrl, prompt } = params
  try {
    let base = (baseUrl || '').replace(/\/+$/, '')
    const url = /\/v\d+$/i.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions'
    const body = {
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
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content
    return (typeof text === 'string' && text.trim()) ? text.trim() : 'E:视觉模型返回空'
  } catch (e: unknown) { return 'E:' + ((e instanceof Error ? e.message : String(e))) }
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
        const gst = app.getGPUFeatureStatus() as unknown as Record<string, string | undefined>
        console.log('[RENDER] mode=' + rendererMode + ' gpuAcceleration=' + (gst?.gpuAcceleration || 'unknown') + ' webgl=' + gst?.webgl)
      } catch (e2: unknown) { console.error('[RENDER] gpu detect error:', e2 instanceof Error ? e2.message : String(e2)) }
    }, 3000)
  } catch (e: unknown) { console.error('[RENDER] gpu detect error:', e instanceof Error ? e.message : String(e)) }
  serverPort = await startServer()
  createAppMenu()
  createWindow()
  createTray()
  app.on('activate', () => mainWindow?.show())
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !isQuitting) { isQuitting = true; app.quit() } })
app.on('before-quit', () => { isQuitting = true })
