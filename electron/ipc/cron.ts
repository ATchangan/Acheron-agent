// electron/ipc/cron.ts —— 定时任务域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'

export function registerCronIpc(): void {
  ipcMain.handle('cron:add', async (_e, expr: string, prompt: string) => {
    try { return require('../scheduler/cron').addJob(expr, prompt) } catch (e: unknown) { return 'Error: ' + (e instanceof Error ? e.message : String(e)) }
  })
  ipcMain.handle('cron:list', () => { try { return require('../scheduler/cron').listJobs() } catch { return [] } })
  ipcMain.handle('cron:remove', (_e, id: string) => { try { require('../scheduler/cron').removeJob(id); return true } catch { return false } })
  ipcMain.handle('cron:toggle', (_e, id: string) => { try { require('../scheduler/cron').toggleJob(id); return true } catch { return false } })
}
