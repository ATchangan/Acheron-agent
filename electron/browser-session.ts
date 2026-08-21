// electron/browser-session.ts —— v0.3.4: agent 浏览器会话双引擎
// GPU/自动模式: WebContentsView 内嵌主窗口实时画面(与 agent 同一 webContents, 零额外体积)
// CPU 兼容模式: 离屏隐藏 BrowserWindow 截图显示(不挂主窗口, 不闪烁)
import { BrowserWindow, WebContentsView, type NativeImage, type WebContents } from 'electron'

interface ViewState {
  view?: WebContentsView
  win?: BrowserWindow
  visible: boolean
  attached: boolean
}

const sessions = new Map<string, ViewState>()
let shared: ViewState | null = null
let mainWindow: BrowserWindow | null = null
let liveMode = true
let embedBounds = { x: 0, y: 0, width: 800, height: 600 }
let embeddedOpen = false

export function initBrowserViews(win: BrowserWindow, opts?: { live?: boolean }): void {
  mainWindow = win
  if (opts && typeof opts.live === 'boolean') liveMode = opts.live
  win.on('closed', () => { disposeBrowserViews() })
}

export function disposeBrowserViews(): void {
  for (const st of sessions.values()) {
    try { if (st.win) st.win.destroy(); else if (st.view) st.view.webContents.close() } catch { /* 忽略 */ }
  }
  sessions.clear()
  if (shared) {
    try { if (shared.win) shared.win.destroy(); else if (shared.view) shared.view.webContents.close() } catch { /* 忽略 */ }
    shared = null
  }
  mainWindow = null
}

function createView(key?: string): ViewState {
  const st: ViewState = { visible: false, attached: false }
  if (liveMode) {
    st.view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
  } else {
    // CPU 兼容模式: 离屏隐藏窗口(位置在屏幕外, 截图不闪到可见区域)
    st.win = new BrowserWindow({
      x: -10000, y: -10000, width: 1280, height: 800, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    st.win.on('closed', () => { if (key) sessions.delete(key) })
  }
  if (key) sessions.set(key, st)
  return st
}

function getState(key?: string): ViewState {
  if (key) {
    const existing = sessions.get(key)
    if (existing) return existing
    return createView(key)
  }
  if (shared) return shared
  shared = createView()
  return shared
}

function attach(st: ViewState, offscreen = false): void {
  if (!liveMode) return
  if (!mainWindow || mainWindow.isDestroyed() || !st.view || st.attached) return
  const cv = mainWindow.contentView
  cv.addChildView(st.view)
  if (offscreen) st.view.setBounds({ x: -10000, y: -10000, width: 1280, height: 800 })
  else st.view.setBounds({ x: embedBounds.x, y: embedBounds.y, width: Math.max(1, embedBounds.width), height: Math.max(1, embedBounds.height) })
  st.view.setVisible(true)
  st.attached = true
  st.visible = true
}

function detach(st: ViewState): void {
  if (!liveMode) return
  if (!mainWindow || mainWindow.isDestroyed() || !st.view || !st.attached) return
  st.view.setVisible(false)
  mainWindow.contentView.removeChildView(st.view)
  st.attached = false
  st.visible = false
}

export interface BrowserSessionHandle {
  webContents: WebContents
  isDestroyed(): boolean
  showInactive(): void
  hide(): void
  isVisible(): boolean
  capturePage(): Promise<NativeImage>
  canGoBack(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  getURL(): string
  loadURL(u: string): Promise<void>
}

function handleFor(st: ViewState): BrowserSessionHandle {
  const wc = st.view ? st.view.webContents : st.win!.webContents
  return {
    webContents: wc,
    isDestroyed: () => wc.isDestroyed(),
    showInactive: () => { if (liveMode) attach(st) },
    hide: () => detach(st),
    isVisible: () => liveMode ? st.visible : st.win!.isVisible(),
    // 隐藏时截图: GPU 走屏幕外挂载, CPU 走离屏窗口显示(都不闪到可见区域)
    capturePage: async () => {
      if (liveMode) {
        if (!st.visible) {
          const direct = await wc.capturePage().catch(() => null)
          if (direct && !direct.isEmpty()) return direct
          attach(st, true)
          await new Promise(r => setTimeout(r, 120))
          try { return await wc.capturePage() } finally { if (!st.visible) detach(st) }
        }
        return wc.capturePage()
      }
      const w = st.win!
      const wasVisible = w.isVisible()
      if (!wasVisible) { w.showInactive(); await new Promise(r => setTimeout(r, 120)) }
      try { return await wc.capturePage() } finally { if (!wasVisible) w.hide() }
    },
    canGoBack: () => wc.canGoBack(),
    goBack: () => wc.goBack(),
    goForward: () => wc.goForward(),
    reload: () => wc.reload(),
    getURL: () => wc.getURL(),
    loadURL: (u) => wc.loadURL(u),
  }
}

export function getBrowserSession(key?: string): BrowserSessionHandle {
  return handleFor(getState(key))
}

export function getBrowserSessionIfExists(key?: string): BrowserSessionHandle | null {
  const st = key ? sessions.get(key) : shared
  if (!st) return null
  const wc = st.view ? st.view.webContents : st.win!.webContents
  return wc.isDestroyed() ? null : handleFor(st)
}

export function closeBrowserSession(key: string): void {
  const st = sessions.get(key)
  if (st) {
    try { if (st.win) st.win.destroy(); else if (st.view) st.view.webContents.close() } catch { /* 忽略 */ }
    sessions.delete(key)
  }
}

export function layoutLiveView(b: { x: number; y: number; width: number; height: number }): void {
  embedBounds = { x: Math.round(b.x || 0), y: Math.round(b.y || 0), width: Math.round(b.width || 0), height: Math.round(b.height || 0) }
  if (!liveMode) return
  const st = shared
  if (st && st.visible && st.view) st.view.setBounds({ x: embedBounds.x, y: embedBounds.y, width: Math.max(1, embedBounds.width), height: Math.max(1, embedBounds.height) })
  for (const s of sessions.values()) {
    if (s.visible && s.view) s.view.setBounds({ x: embedBounds.x, y: embedBounds.y, width: Math.max(1, embedBounds.width), height: Math.max(1, embedBounds.height) })
  }
}

export function showLiveView(key?: string): void {
  if (!liveMode) return
  const st = key ? sessions.get(key) : shared
  if (!st) return
  embeddedOpen = true
  attach(st)
}

export function hideLiveView(): void {
  embeddedOpen = false
  if (!liveMode) return
  if (shared && shared.visible) detach(shared)
  for (const s of sessions.values()) if (s.visible) detach(s)
}

export function isEmbeddedOpen(): boolean {
  return liveMode && embeddedOpen
}
