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
import { registerMiscIpc, cleanChromiumCaches } from './ipc/misc'
import { registerModelsIpc } from './ipc/models'
import { registerUpdateIpc } from './ipc/update'
import { registerMediaIpc } from './ipc/media'
import { registerBrowserIpc } from './ipc/browser'
import { registerComputerIpc } from './ipc/computer'
import { registerLlmIpc } from './ipc/llm'
import { registerTaskIpc } from './ipc/tasks'
import { registerTraceIpc, flushTrace } from './ipc/trace'
import { registerEngineIpc } from './ipc/engine'
import { registerRiskConfirm } from './ipc/risk-confirm'
import { getBrowserSession, getBrowserSessionIfExists, closeBrowserSession, layoutLiveView, showLiveView, hideLiveView, isEmbeddedOpen, initBrowserViews } from './browser-session'
import { safeClone, encKey, decKey, encProviders, decProviders, dirSize, fmtSize, startServer, type MainProvider, type MainSettingsData } from './main-utils'
import { join, extname, dirname } from 'path'
import * as fs from 'fs'
import * as http from 'http'
import { exec } from 'child_process'
import * as os from 'os'

// 固定 userData 路径 —— app.setName 会改变 Electron 默认 userData 目录(huangquan-agent → 黄泉Agent),
// 不显式指回原目录会丢失全部配置/会话
app.setPath('userData', join(app.getPath('appData'), 'huangquan-agent'))
// 任务栏/系统托盘显示应用名与 AppUserModelID —— 不设置时 Windows 任务栏右键显示 "Electron"
app.setName('黄泉Agent')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.huangquan.agent')
}
// v0.3.6 修复: stdout/stderr 被关闭时 console 写入会抛 EPIPE, 被下方既有兜底处理器记录成 FATAL 噪音。
// 日志统一走安全包装; 未捕获异常仅对 EPIPE 静默, 其余交给既有兜底处理器(记录 crash.log)。
function safeLog(...args: unknown[]): void { try { console.log(...args) } catch { /* 管道已关闭 */ } }
function safeError(...args: unknown[]): void { try { console.error(...args) } catch { /* 管道已关闭 */ } }
// 退出前把缓冲中的诊断轨迹写盘(否则最后 ~500ms 的轨迹可能丢失)
app.on('will-quit', () => { try { flushTrace() } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } })

// 使用 Electron net.fetch（Chromium 网络栈，自动跟随 Windows 系统代理）——
// Node 全局 fetch(undici) 不读系统代理，导致浏览器能访问的 API 在应用内超时
const netFetch: typeof fetch = ((...args: Parameters<typeof fetch>) => net.fetch(args[0] as string, args[1] as never)) as typeof fetch

// 全局崩溃捕获
// 崩溃日志异步追加, 不再同步阻塞主进程
function appendCrashLog(line: string) { try { fs.promises.appendFile(join(app.getPath('userData'), 'crash.log'), line).catch(() => {}) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } }
process.on('uncaughtException', (err: unknown) => {
  // stdout/stderr 被关闭导致的 EPIPE 不记 FATAL(避免刷 crash.log 噪音), 其余真实错误照常记录
  if ((err as NodeJS.ErrnoException)?.code === 'EPIPE') return
  console.error('[FATAL] uncaughtException:', err)
  appendCrashLog(new Date().toISOString() + ' uncaughtException: ' + (err as Error)?.stack + '\n')
})
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
  // GPU 模式(auto/gpu) —— 完全自动识别。
  // 不强制指定/不无视黑名单(移除 ignore-gpu-blocklist), 由 Chromium 自动探测 GPU 并决定是否硬件加速:
  // 检测到可用 GPU → 自动启用硬件加速; 无 GPU / 驱动有问题的 GPU → 自动降级软件渲染。
  app.commandLine.appendSwitch('enable-gpu-rasterization')  // 尽力而为: GPU 可用时栅格化走 GPU
  app.commandLine.appendSwitch('enable-zero-copy')          // 尽力而为: 零拷贝合成
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas') // Canvas 2D 加速(可用时)
  app.commandLine.appendSwitch('enable-accelerated-video-decode') // 视频硬解(可用时)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let serverPort = 0

// ─── 单实例锁 —— 防止多实例并行导致悬浮窗/窗口互相干扰 ──
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 直接退出, 不再 throw(避免触发 uncaughtException 写 crash.log 噪音)
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
const tasksPath = join(userDataPath, 'tasks.json')
const tracePath = join(userDataPath, 'agent-trace.jsonl')
registerSettingsIpc({ settingsPath, userDataPath, decProviders: decProviders as unknown as (d: unknown) => Record<string, unknown>, encProviders: encProviders as unknown as (d: unknown) => Record<string, unknown> })
registerTaskIpc({ tasksPath })
registerTraceIpc({ tracePath })
const memoryPath = join(userDataPath, 'memory.json')
registerMemoryIpc({ memoryPath, settingsPath, userDataPath, safeClone, decKey })
const workspaceDir = join(userDataPath, 'workspace')
// skillsDir 必须在 userData —— 安装版 app.asar 内只读, mkdir 抛 ENOTDIR 导致启动崩溃
const skillsDir = join(userDataPath, 'skills')
registerSkillsIpc({ skillsDir, resourcesDir })

// mkdir 循环全部 try-catch —— resources/skills 在 asar 内只读, 失败不能崩溃
for (const d of [sessionsDir, workspaceDir, skillsDir, join(resourcesDir, 'skills')]) {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) } catch (e) { /* 只读目录(asar 内)或权限受限: 跳过 */ console.debug('[swallow]', e) }
}

// 启动时初始向量记忆
import('./memory/vector').then(m => { m.initMemory(join(userDataPath, 'memory-vector.json')); m.startAutoSave() }).catch(() => {})
// 启动定时任务
import('./scheduler/cron').then(m => m.initCron(join(userDataPath, 'cron.json'), (prompt: string) => {
  mainWindow?.webContents.send('cron:trigger', prompt)
})).catch(() => {})
// 多角色体系已统一为前端实现(chat.ts AGENTS), 主进程 agent 模块已移除
// v0.2: 启动时加载MCP SSE
import('./mcp/sse-transport').catch(() => {})
import('./cache/tool-cache').catch(() => {})

// ─── HTTP 服务器 ──────────────────────────────────
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
// 读取"关闭缩至托盘"设置(最小化固定为常规最小化到任务栏)
function trayEnabled(): boolean {
  try {
    if (fs.existsSync(settingsPath)) {
      const d = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      // 最小化/关闭缩至托盘默认开启(undefined 视为开启)
      return d?.general?.trayEnabled !== false
    }
  } catch (e) { /* ignore */ console.debug('[swallow]', e) }
  return false
}
// ─── 内嵌浏览器面板 + 使用中悬浮窗 ─────────────────
let floatHideTimer: ReturnType<typeof setTimeout> | null = null

function showBrowserPanel() {
  // 若无头浏览器从未导航过, 先加载默认页, 避免面板一直空白/加载
  try {
    // 默认主页从设置读取（设置 → 工具 → 浏览器设置 → 默认主页）
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
  // v0.3.4: 浏览器面板改为内嵌主窗口 WebContentsView 实时画面(替代独立窗口截图轮询)
  try { mainWindow?.webContents.send('browser:embed', { show: true }) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
}
function hideBrowserFloat() {
  if (floatHideTimer) { clearTimeout(floatHideTimer); floatHideTimer = null }
  try { mainWindow?.webContents.send('browser:float', { show: false }) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
}
// 悬浮提示改为"主窗口内横幅" —— 通过事件推送到主窗口渲染, 不再创建系统悬浮窗
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
// 系统窗口按钮配色与主题匹配: 亮色主题用浅色底+深色图标, 深色主题反之
function titleBarOverlayForTheme(theme?: string): { color: string; symbolColor: string; height: number } {
  switch (theme) {
    case 'light': return { color: '#f4f2ec', symbolColor: '#1a1a1f', height: 32 }
    case 'black': return { color: '#0e0e0e', symbolColor: '#d0d0d8', height: 32 }
    case 'huangquan': return { color: '#121014', symbolColor: '#e9d5ff', height: 32 }
    case 'bloodmoon': return { color: '#171013', symbolColor: '#fecaca', height: 32 }
    case 'dawn': return { color: '#f6f1e8', symbolColor: '#2b2b2b', height: 32 }
    default: return { color: '#15171c', symbolColor: '#c8c8cc', height: 32 }
  }
}
function createWindow() {
  let savedTheme: string | undefined
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    savedTheme = s?.general?.theme || s?.general?.themePreset
  } catch { /* ignore */ }
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: '黄泉Agent', icon: join(resourcesDir, 'icon.png'),
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    backgroundColor: '#08080f', show: false, frame: false,
    // v0.3.3: 原生标题栏控制按钮(最小化/最大化/关闭)由 OS 绘制与命中,
    // 彻底避免自定义 HTML 按钮被拖拽区/命中层吞掉点击
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayForTheme(savedTheme),
  })
  mainWindow = win
  // v0.3.6 修复: 聊天 Markdown 外链/任何 window.open 都不能让主窗口离开本地应用页,
  // 否则整个窗口被外部网页占满且没有返回入口。一律交给系统默认浏览器打开。
  win.webContents.on('will-navigate', (e, url) => {
    const local = 'http://127.0.0.1:' + serverPort
    if (url.startsWith(local)) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url).catch(() => {})
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  win.webContents.on('render-process-gone', (_e, details) => { console.error('[FATAL] renderer crashed:', details.reason, details.exitCode); try { fs.appendFileSync(join(app.getPath('userData'), 'crash.log'), new Date().toISOString() + ' renderer crashed: ' + details.reason + ' ' + details.exitCode + '\n') } catch (e) { console.debug('[swallow]', e) }; if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.loadURL('http://127.0.0.1:' + serverPort + '/index.html') } })
  win.loadURL('http://127.0.0.1:' + serverPort + '/index.html')
  win.once('ready-to-show', () => mainWindow?.show())
  win.on('closed', () => { mainWindow = null })
  // 关闭 → 设置开启时缩至托盘，否则正常退出
  win.on('close', (e: Electron.Event) => { if (trayEnabled() && !isQuitting) { e.preventDefault(); mainWindow?.hide() } })
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
const sessionMeta = new Map<string, { title: string; messageCount: number; updatedAt: string; mode?: string; pinned?: boolean }>()
registerSessionIpc({ sessionsDir, userDataPath, sessionMeta, buildSessionMeta })
function buildSessionMeta() {
  sessionMeta.clear()
  if (!fs.existsSync(sessionsDir)) return
  for (const f of fs.readdirSync(sessionsDir)) {
    if (!f.endsWith('.json')) continue
    try {
      const d = JSON.parse(fs.readFileSync(join(sessionsDir, f), 'utf-8'))
      sessionMeta.set(f.replace('.json', ''), { title: d.title || f, messageCount: d.messages?.length || 0, updatedAt: d.updatedAt || '', mode: d.mode || 'work', pinned: d.pinned === true })
    } catch (e) { /* 损坏文件跳过 */ console.debug('[swallow]', e) }
  }
}

// ─── Skills 系统 ───────────────────────────────────
// ─── 记忆系统 ──────────────────────────────────────
// ─── 电脑控制 ──────────────────────────────────────
// 危险命令拦截统一走 security/permission.ts 风险分级(L4 拒绝), 消除双份列表漂移
const { assessRisk } = require('./security/permission')
registerComputerIpc({ assertInsideWorkDir, assessRisk, getEffectiveWorkDir, getWorkDirOverride: () => workDirOverride, setWorkDirOverride: (d) => { workDirOverride = d }, netFetch, workspaceDir, userDataPath })
registerLlmIpc({ netFetch })
registerEngineIpc({
  settingsPath,
  userDataPath,
  memoryPath,
  tracePath,
  resourcesDir,
  netFetch,
  decProviders: decProviders as unknown as (d: unknown) => Record<string, unknown>,
  getSender: () => mainWindow?.webContents || null,
})
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
registerRiskConfirm({ getMainWindow: () => mainWindow, settingsPath })
registerCronIpc()

// 实时性能采样 —— CPU(os.cpus 两次采样差) + RAM + GPU(Windows 性能计数器), 2s 缓存
let perfCache: { cpuPct: number; memPct: number; memUsed: number; memTotal: number; gpuPct: number; gpuName: string; cpus: number } | null = null; let perfCacheAt = 0
let lastCpuSample: { idle: number; total: number } | null = null; let lastCpuAt = 0
// GPU 采样 —— 优先 nvidia-smi(正在使用的 NVIDIA GPU, 准确), 失败回退性能计数器各引擎最大值
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
// readFile 缓存 —— 按 mtime+size 校验, 内容未变直接复用(整文件读取路径)
const readFileCache = new Map<string, { mtimeMs: number; size: number; content: string }>()
// ─── 文件浏览器操作(写操作限定工作目录内, 防误删) ──
// set_workdir 只改内存(不持久化污染用户设置), 重启/应用重载后恢复用户设置的工作目录
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
// 检索提速 —— 并行遍历(16 路并发) + 扩展忽略目录 + 大文件跳过
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'dist-electron', 'build', 'release', 'out', 'target', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.next', '.nuxt', '.cache', 'coverage', '.gradle', '.tox', 'site-packages'])



// ─── 浏览器自动化 ───────────────────────────────
// v0.3.4: agent 浏览器会话为 WebContentsView —— 同一 webContents 可内嵌主窗口实时显示, 零额外体积
let browserCurUrl = 'about:blank'
const getBrowserWin = (key?: string) => getBrowserSession(key)
const getBrowserWinIfExists = (key?: string) => getBrowserSessionIfExists(key)
const waitLoad = (wc: Electron.WebContents, ms = 15000): Promise<void> =>
  new Promise(resolve => {
    const to = setTimeout(() => { cleanup(); resolve() }, ms)
    const cleanup = () => { clearTimeout(to); wc.removeListener('did-finish-load', onLoad); wc.removeListener('did-fail-load', onFail) }
    const onLoad = () => { cleanup(); resolve() }
    const onFail = () => { cleanup(); resolve() }
    wc.once('did-finish-load', onLoad)
    wc.once('did-fail-load', onFail)
  })
registerBrowserIpc({ getBrowserWin, getBrowserWinIfExists, closeBrowserSession, waitLoad, getCurUrl: () => browserCurUrl, setCurUrl: (u) => { browserCurUrl = u }, showBrowserPanel, showBrowserFloat, hideBrowserFloat, layoutLiveView, showLiveView, hideLiveView, isEmbeddedOpen })


// v0.3.1 C3: abort 双语义 —— 参数为 requestId 时中止该请求; 为 sid 时中止该会话全部请求; 空则全部
// ─── 启动 ──────────────────────────────────────────
app.whenReady().then(async () => {
  // GPU 状态检测(仅日志/状态查询, 不做运行时禁用)。
  // auto 模式下 GPU 不可用时 Chromium 原生自动降级为软件渲染, 无需手动调用
  // disableHardwareAcceleration(该 API 只能在 app ready 之前调用)。
  try {
    // 延迟 3s 等 GPU 进程完成初始化后再读取(立即读取会得到 disabled_off 等不准确初始值)
    setTimeout(() => {
      try {
        const gst = app.getGPUFeatureStatus() as unknown as Record<string, string | undefined>
        safeLog('[RENDER] mode=' + rendererMode + ' gpuAcceleration=' + (gst?.gpuAcceleration || 'unknown') + ' webgl=' + gst?.webgl)
      } catch (e2: unknown) { safeError('[RENDER] gpu detect error:', e2 instanceof Error ? e2.message : String(e2)) }
    }, 3000)
  } catch (e: unknown) { safeError('[RENDER] gpu detect error:', e instanceof Error ? e.message : String(e)) }
  serverPort = await startServer(distDir)
  createAppMenu()
  // v0.3.3: Chromium 缓存自动清理(设置→高级→缓存管理可关/改阈值, 默认开启)
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const g = s?.general || {}
    if (g.autoCleanCache !== false) {
      const r = cleanChromiumCaches(userDataPath, Number(g.autoCleanCacheSize) || 200)
      if (r.freedMb > 0) safeLog('[cache] 启动自动清理 Chromium 缓存: 释放 ' + r.freedMb + 'MB')
    }
  } catch (e: unknown) { /* 设置缺失/损坏时跳过清理 */ console.debug('[swallow]', e) }
  createWindow()
  if (mainWindow) initBrowserViews(mainWindow, { live: rendererMode !== 'cpu' })
  createTray()
  app.on('activate', () => mainWindow?.show())
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !isQuitting) { isQuitting = true; app.quit() } })
app.on('before-quit', () => { isQuitting = true })
