// electron/ipc/window.ts —— 窗口域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, app } from 'electron'

export function registerWindowIpc(deps: {
  getMainWindow: () => Electron.BrowserWindow | null
  trayEnabled: () => boolean
  setQuitting: (v: boolean) => void
}): void {
  const { getMainWindow, trayEnabled, setQuitting } = deps
  ipcMain.handle('window:setOpacity', (_e, opacity: number) => {
    const mainWindow = getMainWindow()
    if (mainWindow) mainWindow.setOpacity(Math.max(0.3, Math.min(1, opacity)))
  })
  // 主题切换时同步系统窗口按钮(最小化/最大化/关闭)的配色, 避免深色按钮条停在浅色主题上
  ipcMain.handle('window:setTitleBarOverlay', (_e, opts: { color?: string; symbolColor?: string; height?: number }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return false
    try {
      mainWindow.setTitleBarOverlay({
        color: opts.color || '#101014',
        symbolColor: opts.symbolColor || '#c8c8cc',
        height: opts.height || 32,
      })
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('window:minimize', () => getMainWindow()?.minimize())
  ipcMain.handle('window:show', () => {
    const w = getMainWindow()
    if (!w) return false
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
    return true
  })
  ipcMain.handle('window:maximize', () => {
    const mainWindow = getMainWindow()
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => { if (trayEnabled() && getMainWindow()) { getMainWindow()!.hide() } else { setQuitting(true); app.quit() } })
}
