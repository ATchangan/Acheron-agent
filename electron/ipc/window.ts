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
  ipcMain.handle('window:minimize', () => getMainWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const mainWindow = getMainWindow()
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => { if (trayEnabled() && getMainWindow()) { getMainWindow()!.hide() } else { setQuitting(true); app.quit() } })
}
