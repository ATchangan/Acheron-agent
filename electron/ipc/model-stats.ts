// electron/ipc/model-stats.ts —— 模型统计域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'

export function registerModelStatsIpc(): void {
  ipcMain.handle('modelStats:recordRequest', (_e, sid: string, model: string, hit: boolean) => { try { require('../cache/model-cache-stats').recordRequest(sid, model, hit) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } return true })
  ipcMain.handle('modelStats:recordTokens', (_e, sid: string, model: string, hitT: number, inputT: number, writeT: number, missT?: number) => { try { require('../cache/model-cache-stats').recordTokens(sid, model, hitT, inputT, writeT, missT) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } return true })
  ipcMain.handle('modelStats:deleteSession', (_e, sid: string) => { try { require('../cache/model-cache-stats').deleteSession(sid) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } return true })
  ipcMain.handle('modelStats:get', () => { try { return require('../cache/model-cache-stats').getAll() } catch { return { sessions: {}, models: {} } } })
  ipcMain.handle('modelStats:getSession', (_e, sid: string) => { try { return require('../cache/model-cache-stats').getSession(sid) } catch { return {} } })
  ipcMain.handle('modelStats:resetAll', () => { try { return { ok: true, cleared: require('../cache/model-cache-stats').resetAll() } } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } } })
  ipcMain.handle('modelStats:resetOne', (_e, model: string) => { try { return { ok: require('../cache/model-cache-stats').resetOne(model) } } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } } })
}
