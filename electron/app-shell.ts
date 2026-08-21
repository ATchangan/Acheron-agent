// electron/app-shell.ts — 窗口/托盘/菜单/浏览器面板/崩溃上下文(0.3.9 结构清理: 从 main.ts 抽出)
import { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification } from 'electron'
import * as fs from 'fs'
import { join } from 'path'

export interface AppShellDeps {
  settingsPath: string
  resourcesDir: string
  tracePath: string
  userDataPath: string
  rendererMode: string
  serverPort: () => number
  isQuitting: () => boolean
  setQuitting: (v: boolean) => void
  appendCrashLog: (line: string) => void
  initBrowserViews: (win: BrowserWindow, opts: { live: boolean }) => void
  getBrowserWin: () => { webContents: Electron.WebContents } | null
}

export class AppShell {
  private mainWindow: BrowserWindow | null = null
  private tray: Tray | null = null
  private floatHideTimer: ReturnType<typeof setTimeout> | null = null
  private reloadTimer: ReturnType<typeof setTimeout> | null = null
  private browserCurUrl = 'about:blank'
  // 渲染进程崩溃上下文 —— 环形缓冲最近的渲染层错误, 崩溃时连同引擎轨迹一起落盘定位
  private crashContext: string[] = []

  constructor(private deps: AppShellDeps) {}

  getWindow(): BrowserWindow | null { return this.mainWindow }

  trayEnabled(): boolean {
    try {
      if (fs.existsSync(this.deps.settingsPath)) {
        const d = JSON.parse(fs.readFileSync(this.deps.settingsPath, 'utf-8'))
        // 最小化/关闭缩至托盘默认开启(undefined 视为开启)
        return d?.general?.trayEnabled !== false
      }
    } catch (e) { /* ignore */ console.debug('[swallow]', e) }
    return false
  }

  createMenu(): void {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: 'Acheron-agent', submenu: [
          { label: '关于Acheron-agent', role: 'about' }, { type: 'separator' },
          { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { this.deps.setQuitting(true); app.quit() } },
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

  private titleBarOverlayForTheme(theme?: string): { color: string; symbolColor: string; height: number } {
    switch (theme) {
      // 与渲染层 --bg-surface 严格一致(标题栏背景), 消除右上角窗口按钮区色差
      case 'light': return { color: '#fcfbfe', symbolColor: '#1a1a1f', height: 32 }
      case 'black': return { color: '#0a0a0b', symbolColor: '#c8c8cc', height: 32 }
      case 'violet': return { color: '#0a0d12', symbolColor: '#c8c8cc', height: 32 }
      case 'bloodmoon': return { color: '#1d1519', symbolColor: '#fecaca', height: 32 }
      case 'dawn': return { color: '#fdfbf6', symbolColor: '#2b2b2b', height: 32 }
      default: return { color: '#0a0d12', symbolColor: '#c8c8cc', height: 32 }
    }
  }

  private pushCrashContext(line: string): void {
    this.crashContext.push(new Date().toISOString() + ' [renderer] ' + line)
    if (this.crashContext.length > 200) this.crashContext.splice(0, this.crashContext.length - 200)
  }

  private countRecentCrashes(days = 7): number {
    try {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      let count = 0
      for (const f of [join(this.deps.userDataPath, 'crash.log'), join(this.deps.userDataPath, 'crash.log.old')]) {
        try {
          const raw = fs.readFileSync(f, 'utf-8')
          count += raw.split('\n').filter(l => l.includes('renderer crashed')).filter(l => {
            const m = l.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
            return m ? new Date(m[1]).getTime() >= cutoff : false
          }).length
        } catch { /* 单个文件缺失/损坏跳过 */ }
      }
      return count
    } catch { return 0 }
  }

  createWindow(): void {
    let savedTheme: string | undefined
    try {
      const s = JSON.parse(fs.readFileSync(this.deps.settingsPath, 'utf-8'))
      savedTheme = s?.general?.theme || s?.general?.themePreset
    } catch { /* ignore */ }
    const win = new BrowserWindow({
      width: 1280, height: 860, minWidth: 900, minHeight: 600,
      title: 'Acheron-agent', icon: join(this.deps.resourcesDir, 'icon.png'),
      webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
      backgroundColor: '#08080f', show: false, frame: false,
      titleBarStyle: 'hidden',
      titleBarOverlay: this.titleBarOverlayForTheme(savedTheme),
    })
    this.mainWindow = win
    // 聊天 Markdown 外链/任何 window.open 都不能让主窗口离开本地应用页, 一律交给系统默认浏览器打开
    win.webContents.on('will-navigate', (e, url) => {
      const local = 'http://127.0.0.1:' + this.deps.serverPort()
      if (url.startsWith(local)) return
      e.preventDefault()
      if (/^https?:/i.test(url)) void shell.openExternal(url).catch(() => {})
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url).catch(() => {})
      return { action: 'deny' }
    })
    // 收集渲染层错误/警告, 崩溃时写入 crash.log 帮助定位根因
    win.webContents.on('console-message' as never, ((...args: unknown[]) => {
      const ev = args[0] as { details?: { level?: string | number; message?: string; lineNumber?: number; sourceId?: string } }
      const d = ev?.details
      const level = d?.level ?? args[1]
      if (level === 'error' || level === 'warning' || level === 2 || level === 3) {
        const msg = d?.message ?? args[2]
        const src = d?.sourceId ?? args[4]
        const line = d?.lineNumber ?? args[3]
        this.pushCrashContext(String(msg || '').slice(0, 300) + (src ? ' (' + src + ':' + line + ')' : ''))
      }
    }) as never)
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[FATAL] renderer crashed:', details.reason, details.exitCode)
      try {
        const lines: string[] = []
        lines.push(new Date().toISOString() + ' renderer crashed: ' + details.reason + ' ' + details.exitCode)
        if (this.crashContext.length) lines.push('--- renderer context (last ' + Math.min(this.crashContext.length, 40) + ') ---', ...this.crashContext.slice(-40))
        try {
          const traceTail = fs.readFileSync(this.deps.tracePath, 'utf-8').trim().split('\n').slice(-8)
          if (traceTail.length) lines.push('--- engine trace tail ---', ...traceTail)
        } catch { /* 无轨迹文件 */ }
        this.deps.appendCrashLog(lines.join('\n') + '\n')
      } catch (e) { console.debug('[swallow]', e) }
      this.crashContext.length = 0
      // 崩溃观察 —— 近 7 天 >=3 次时提示切换 CPU 渲染
      const recent = this.countRecentCrashes()
      if (recent >= 3) {
        try {
          new Notification({ title: 'Acheron-agent 渲染进程频繁崩溃', body: '近 7 天已崩溃 ' + recent + ' 次。建议在 设置→外观 中将渲染方式切换为 CPU 模式。' }).show()
        } catch { /* 忽略 */ }
      }
      // 延迟重载: 等旧渲染进程完全退出后再起新进程, 规避快速连续 reload 时
      // sandboxed preload startupData 为空的竞态崩溃(CI Server 会话下可稳定复现 -36861)
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        if (this.reloadTimer) clearTimeout(this.reloadTimer)
        this.reloadTimer = setTimeout(() => {
          try {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.loadURL('http://127.0.0.1:' + this.deps.serverPort() + '/index.html')
            }
          } catch { /* 窗口已关闭则忽略 */ console.debug('[swallow]', 'reload after crash skipped') }
        }, 1200)
      }
    })
    win.loadURL('http://127.0.0.1:' + this.deps.serverPort() + '/index.html')
    win.once('ready-to-show', () => this.mainWindow?.show())
    win.on('closed', () => {
      if (this.reloadTimer) { clearTimeout(this.reloadTimer); this.reloadTimer = null }
      this.mainWindow = null
    })
    // 关闭 → 设置开启时缩至托盘，否则正常退出
    win.on('close', (e: Electron.Event) => { if (this.trayEnabled() && !this.deps.isQuitting()) { e.preventDefault(); this.mainWindow?.hide() } })
  }

  createTray(): void {
    const icon = nativeImage.createFromPath(join(this.deps.resourcesDir, 'icon.png'))
    this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    this.tray.setToolTip('Acheron-agent')
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开主窗口', click: () => this.mainWindow?.show() },
      { type: 'separator' },
      { label: '退出', click: () => { this.deps.setQuitting(true); app.quit() } },
    ]))
    this.tray.on('click', () => this.mainWindow?.show())
  }

  // ─── 内嵌浏览器面板 + 使用中悬浮提示 ───
  showBrowserPanel(): void {
    try {
      // 默认主页从设置读取（设置 → 工具 → 浏览器设置 → 默认主页）
      let homeUrl = 'https://example.com'
      try {
        const s = JSON.parse(fs.readFileSync(this.deps.settingsPath, 'utf-8'))
        const hu = s?.general?.browserHomeUrl
        if (typeof hu === 'string' && hu.trim()) homeUrl = /^https?:\/\//i.test(hu.trim()) ? hu.trim() : 'https://' + hu.trim()
      } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      const bw = this.deps.getBrowserWin()
      const wc = bw?.webContents
      if (wc && (!wc.getURL() || wc.getURL() === 'about:blank' || wc.isLoading())) {
        this.browserCurUrl = homeUrl
        wc.loadURL(homeUrl).catch(() => {})
      }
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    // 浏览器面板改为内嵌主窗口 WebContentsView 实时画面(替代独立窗口截图轮询)
    try { this.mainWindow?.webContents.send('browser:embed', { show: true }) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  }

  hideBrowserFloat(): void {
    if (this.floatHideTimer) { clearTimeout(this.floatHideTimer); this.floatHideTimer = null }
    try { this.mainWindow?.webContents.send('browser:float', { show: false }) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  }

  showBrowserFloat(): void {
    // 提示时长从设置读取（browserFloatTimeout, 默认 30s）
    let timeoutMs = 30000
    try {
      const s = JSON.parse(fs.readFileSync(this.deps.settingsPath, 'utf-8'))
      const tv = parseInt(s?.general?.browserFloatTimeout)
      if (!isNaN(tv) && tv > 0) timeoutMs = tv * 1000
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    try { this.mainWindow?.webContents.send('browser:float', { show: true }) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    if (this.floatHideTimer) clearTimeout(this.floatHideTimer)
    this.floatHideTimer = setTimeout(() => this.hideBrowserFloat(), timeoutMs)
  }

  getBrowserCurUrl(): string { return this.browserCurUrl }
  setBrowserCurUrl(u: string): void { this.browserCurUrl = u }
}
