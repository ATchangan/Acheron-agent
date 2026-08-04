// electron/ipc/browser.ts —— 浏览器域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, BrowserWindow } from 'electron'

export function registerBrowserIpc(deps: {
  getBrowserWin: () => BrowserWindow
  waitLoad: (wc: Electron.WebContents) => Promise<void>
  getCurUrl: () => string
  setCurUrl: (u: string) => void
  showBrowserPanel: () => void
  showBrowserFloat: () => void
  hideBrowserFloat: () => void
}): void {
  const { getBrowserWin, waitLoad, getCurUrl, setCurUrl, showBrowserPanel, showBrowserFloat, hideBrowserFloat } = deps

  ipcMain.handle('browser:showPanel', () => { showBrowserPanel(); hideBrowserFloat(); return true })
  // 窗口诊断
  ipcMain.handle('browser:debug', () => {
    const out: Record<string, unknown> = {}
    const bwAll = BrowserWindow.getAllWindows()
    out.all = bwAll.map((w: BrowserWindow) => {
      const p = w.getParentWindow()
      return { id: w.id, title: w.getTitle(), visible: w.isVisible(), bounds: w.getBounds(), parent: p ? p.id : null, alwaysOnTop: w.isAlwaysOnTop() }
    })
    return out
  })
  ipcMain.handle('browser:showFloat', () => { showBrowserFloat(); return true })
  ipcMain.handle('browser:hideFloat', () => { hideBrowserFloat(); return true })

  ipcMain.handle('browser:navigate', async (_e, url: string) => {
    const bw = getBrowserWin(); const wc = bw.webContents
    try {
      if (wc.getURL() === url) return 'ok'
      ;(wc as unknown as { __loadStart: number }).__loadStart = Date.now()
      await wc.loadURL(url)
    } catch (e) { /* 继续 */ console.debug('[swallow]', e) }
    setCurUrl(wc.getURL() || url)
    return 'ok'
  })
  ipcMain.handle('browser:back', async () => {
    const bw = getBrowserWin(); const wc = bw.webContents
    if (wc.canGoBack()) wc.goBack()
    setCurUrl(wc.getURL() || getCurUrl())
    return getCurUrl()
  })
  ipcMain.handle('browser:forward', async () => {
    const bw = getBrowserWin(); const wc = bw.webContents
    if (wc.canGoForward()) wc.goForward()
    setCurUrl(wc.getURL() || getCurUrl())
    return getCurUrl()
  })
  ipcMain.handle('browser:reload', async () => {
    const bw = getBrowserWin(); const wc = bw.webContents
    wc.reload()
    return wc.getURL() || getCurUrl()
  })
  ipcMain.handle('browser:current', () => {
    const bw = getBrowserWin()
    if (bw && !bw.isDestroyed()) setCurUrl(bw.webContents.getURL() || getCurUrl())
    return getCurUrl()
  })
  // 实时快照 —— 前端轮询此接口显示 agent 正在看的页面
  // Windows 上隐藏窗口 capturePage 返回空 —— 截图时临时显示窗口再隐藏
  ipcMain.handle('browser:snapshot', async () => {
    let bw: BrowserWindow | null = null
    try {
      bw = getBrowserWin(); const wc = bw.webContents
      if (!wc || wc.isDestroyed()) return { url: getCurUrl(), img: '', loading: false }
      const curUrl = wc.getURL() || getCurUrl()
      if (wc.isLoading() && Date.now() - (wc as unknown as { __loadStart: number }).__loadStart < 15000) return { url: curUrl, img: '', loading: true }
      if (wc.isLoading()) return { url: curUrl, img: '', loading: false }
      const wasVisible = bw.isVisible()
      if (!wasVisible) { bw.showInactive(); await new Promise(r => setTimeout(r, 120)) }
      const img = await wc.capturePage()
      if (!wasVisible) bw.hide()
      let title = ''
      try { title = await wc.executeJavaScript('document.title') } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      return { url: curUrl, img: img.toDataURL(), loading: false, title: title || '' }
    } catch { if (bw && !bw.isDestroyed()) bw.hide(); return { url: getCurUrl(), img: '', loading: false, title: '' } }
  })
  // agent 工具调用 —— 打开页面并返回文本内容（保持旧 browse 语义）
  ipcMain.handle('browser:open', async (_e, url: string) => {
    showBrowserFloat() // agent 使用浏览器时弹出悬浮提示
    const bw = getBrowserWin(); const wc = bw.webContents
    try { await wc.loadURL(url) } catch (e) { /* 继续 */ console.debug('[swallow]', e) }
    await waitLoad(wc)
    setCurUrl(wc.getURL() || url)
    try {
      const title = await wc.executeJavaScript('document.title')
      const text = await wc.executeJavaScript('document.body.innerText')
      return `${title}\n\n${String(text || '').slice(0, 10000)}`
    } catch { return '(load error)' }
  })
  // agent 工具调用 —— 截取当前页面（保持旧 browse_screenshot 语义）
  ipcMain.handle('browser:screenshot', async (_e, url?: string) => {
    showBrowserFloat() // agent 使用浏览器时弹出悬浮提示
    const bw = getBrowserWin(); const wc = bw.webContents
    if (url && url !== 'about:blank') { try { await wc.loadURL(url) } catch (e) { /* 继续 */ console.debug('[swallow]', e) } await waitLoad(wc) }
    setCurUrl(wc.getURL() || url || getCurUrl())
    try {
      const img = await wc.capturePage()
      return img.toDataURL()
    } catch { return '' }
  })
}
