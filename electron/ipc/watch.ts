// electron/ipc/watch.ts —— v0.4.2 任务监视窗：独立置顶小窗实时查看指定会话
import { ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'

export function registerWatchIpc(deps: { serverPort: () => number }): void {
  ipcMain.handle('watch:open', (_e, sid: string) => {
    try {
      const watch = new BrowserWindow({
        width: 440,
        height: 600,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        title: '任务监视',
        backgroundColor: '#0e0e0e',
        webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
      })
      watch.loadURL('http://127.0.0.1:' + deps.serverPort() + '/index.html#watch?sid=' + encodeURIComponent(String(sid || '')))
      return true
    } catch { return false }
  })
}
