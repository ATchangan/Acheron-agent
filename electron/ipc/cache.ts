// electron/ipc/cache.ts —— 缓存统计域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'

export function registerCacheIpc(): void {
  ipcMain.handle('cache:stats', () => {
    try { return require('../cache/tool-cache').getCacheStats() }
    catch { return { size: 0, hits: 0, misses: 0, hit_rate: '0%' } }
  })
  ipcMain.handle('cache:clear', () => {
    try { return require('../cache/tool-cache').invalidateCache() }
    catch { return 0 }
  })
  // v0.2.1: 写操作时同步失效主进程缓存
  ipcMain.handle('cache:invalidate:write', () => {
    try {
      const tc = require('../cache/tool-cache')
      tc.invalidateCache('read'); tc.invalidateCache('ls')
      tc.invalidateCache('grep'); tc.invalidateCache('find')
      return true
    } catch { return false }
  })
}
