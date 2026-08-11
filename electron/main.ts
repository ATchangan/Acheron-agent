import { app, net } from 'electron'
import { registerSessionIpc } from './ipc/sessions'
import { registerSettingsIpc } from './ipc/settings'
import { registerMemoryIpc } from './ipc/memory'
import { registerSkillsIpc } from './ipc/skills'
import { registerPluginsIpc } from './ipc/plugins'
import { registerModelStatsIpc } from './ipc/model-stats'
import { registerMcpIpc } from './ipc/mcp'
import { registerCronIpc } from './ipc/cron'
import { registerBackupIpc } from './ipc/backup'
import { registerRollbackIpc } from './ipc/rollback'
import { registerDiagnosticsIpc } from './ipc/diagnostics'
import { setCustomAgentsDir } from './engine/agents'
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
import { safeClone, decKey, encProviders, decProviders, dirSize, fmtSize, startServer } from './main-utils'
import { join } from 'path'
import { AppShell } from './app-shell'
import * as fs from 'fs'

// 固定 userData 路径 —— app.setName 会改变 Electron 默认 userData 目录(huangquan-agent → 黄泉Agent),
// 不显式指回原目录会丢失全部配置/会话
// 自省整改: 支持 HQ_USER_DATA 环境变量做测试隔离(测试数据不污染真实用户数据)
app.setPath('userData', process.env.HQ_USER_DATA ? process.env.HQ_USER_DATA : join(app.getPath('appData'), 'huangquan-agent'))
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
// v0.3.8: crash.log 超过 5MB 自动轮转为 crash.log.old(覆盖旧档), 防止无限增长
const CRASH_LOG_MAX = 5 * 1024 * 1024
function rotateCrashLogIfNeeded(): void {
  try {
    const p = join(app.getPath('userData'), 'crash.log')
    if (!fs.existsSync(p) || fs.statSync(p).size < CRASH_LOG_MAX) return
    const old = p + '.old'
    try { fs.rmSync(old, { force: true }) } catch { /* 忽略 */ }
    try { fs.renameSync(p, old) } catch { /* 忽略 */ }
  } catch { /* 忽略 */ }
}
function appendCrashLog(line: string) { try { rotateCrashLogIfNeeded(); fs.appendFileSync(join(app.getPath('userData'), 'crash.log'), line) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } }
process.on('uncaughtException', (err: unknown) => {
  // stdout/stderr 被关闭导致的 EPIPE 不记 FATAL(避免刷 crash.log 噪音), 其余真实错误照常记录
  if ((err as NodeJS.ErrnoException)?.code === 'EPIPE') return
  console.error('[FATAL] uncaughtException:', err)
  appendCrashLog(new Date().toISOString() + ' uncaughtException: ' + (err as Error)?.stack + '\n')
})
process.on('unhandledRejection', (reason) => { console.error('[FATAL] unhandledRejection:', reason); appendCrashLog(new Date().toISOString() + ' unhandledRejection: ' + reason + '\n') })

// v0.3.0 M5: LLM 调用参数结构
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

let isQuitting = false
let serverPort = 0

// ─── 单实例锁 —— 防止多实例并行导致悬浮窗/窗口互相干扰 ──
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 直接退出, 不再 throw(避免触发 uncaughtException 写 crash.log 噪音)
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => { const w = appShell.getWindow(); if (w) { w.show(); w.focus() } })

// ─── 路径 ───────────────────────────────────────────
const ROOT = join(__dirname, '..')
const resourcesDir = join(ROOT, 'resources')
const distDir = join(ROOT, 'dist')
const userDataPath = app.getPath('userData')
const sessionsDir = join(userDataPath, 'sessions')
const settingsPath = join(userDataPath, 'settings.json')
const tasksPath = join(userDataPath, 'tasks.json')
const tracePath = join(userDataPath, 'agent-trace.jsonl')
// v0.3.7: 崩溃防护 —— 渲染模式设为 cpu 时禁用 GPU 硬件加速(Electron 渲染进程崩溃的常见来源)
try {
  const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
  if (String(s?.general?.rendererMode || '') === 'cpu') app.disableHardwareAcceleration()
} catch { /* 设置不可读时保持默认 */ }
const appShell = new AppShell({
  settingsPath,
  resourcesDir,
  tracePath,
  userDataPath,
  rendererMode,
  serverPort: () => serverPort,
  isQuitting: () => isQuitting,
  setQuitting: (v: boolean) => { isQuitting = v },
  appendCrashLog,
  initBrowserViews,
  getBrowserWin: () => getBrowserSession(),
})
registerSettingsIpc({ settingsPath, userDataPath, decProviders: decProviders as unknown as (d: unknown) => Record<string, unknown>, encProviders: encProviders as unknown as (d: unknown) => Record<string, unknown> })
registerTaskIpc({ tasksPath })
registerTraceIpc({ tracePath })
const memoryPath = join(userDataPath, 'memory.json')
registerMemoryIpc({ memoryPath, settingsPath, userDataPath, safeClone, decKey })
const workspaceDir = join(userDataPath, 'workspace')
// v0.3.8: 自定义子代理目录(用户放 *.json 即注册自定义角色)
setCustomAgentsDir(join(userDataPath, 'agents'))
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
  appShell.getWindow()?.webContents.send('cron:trigger', prompt)
})).catch(() => {})
// 多角色体系已统一为前端实现(chat.ts AGENTS), 主进程 agent 模块已移除
// v0.2: 启动时加载MCP SSE
import('./mcp/sse-transport').catch(() => {})
import('./cache/tool-cache').catch(() => {})

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
  getSender: () => appShell.getWindow()?.webContents || null,
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
registerWindowIpc({ getMainWindow: () => appShell.getWindow(), trayEnabled: () => appShell.trayEnabled(), setQuitting: (v) => { isQuitting = v } })
registerRiskConfirm({ getMainWindow: () => appShell.getWindow(), settingsPath })
registerCronIpc()
registerBackupIpc({
  userDataPath,
  getWorkDir: () => getEffectiveWorkDir() || userDataPath,
  getWindow: () => appShell.getWindow(),
})
registerRollbackIpc({ userDataPath })
registerDiagnosticsIpc({
  settingsPath,
  userDataPath,
  getWorkDir: () => getEffectiveWorkDir() || userDataPath,
  netFetch,
  getServerPort: () => serverPort,
})

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
// ─── 浏览器自动化 ───────────────────────────────
// v0.3.4: agent 浏览器会话为 WebContentsView —— 同一 webContents 可内嵌主窗口实时显示, 零额外体积
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
registerBrowserIpc({ getBrowserWin, getBrowserWinIfExists, closeBrowserSession, waitLoad, getCurUrl: () => appShell.getBrowserCurUrl(), setCurUrl: (u) => { appShell.setBrowserCurUrl(u) }, showBrowserPanel: () => appShell.showBrowserPanel(), showBrowserFloat: () => appShell.showBrowserFloat(), hideBrowserFloat: () => appShell.hideBrowserFloat(), layoutLiveView, showLiveView, hideLiveView, isEmbeddedOpen })


// v0.3.1 C3: abort 双语义 —— 参数为 requestId 时中止该请求; 为 sid 时中止该会话全部请求; 空则全部
// ─── 启动 ──────────────────────────────────────────
// v0.3.8: 计划文档治理 —— 保留 30 天, 防止无限堆积
function cleanOldPlanDocs(): void {
  try {
    const dir = join(userDataPath, 'plans')
    if (!fs.existsSync(dir)) return
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      try {
        const p = join(dir, f)
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p)
      } catch { /* 单个文件失败不影响其余 */ }
    }
  } catch { /* 忽略 */ }
}

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
  appShell.createMenu()
  cleanOldPlanDocs()
  // v0.3.3: Chromium 缓存自动清理(设置→高级→缓存管理可关/改阈值, 默认开启)
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const g = s?.general || {}
    if (g.autoCleanCache !== false) {
      const r = cleanChromiumCaches(userDataPath, Number(g.autoCleanCacheSize) || 200)
      if (r.freedMb > 0) safeLog('[cache] 启动自动清理 Chromium 缓存: 释放 ' + r.freedMb + 'MB')
    }
  } catch (e: unknown) { /* 设置缺失/损坏时跳过清理 */ console.debug('[swallow]', e) }
  appShell.createWindow()
  const win0 = appShell.getWindow()
  if (win0) initBrowserViews(win0, { live: rendererMode !== 'cpu' })
  appShell.createTray()
  app.on('activate', () => appShell.getWindow()?.show())
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !isQuitting) { isQuitting = true; app.quit() } })
app.on('before-quit', () => { isQuitting = true })
