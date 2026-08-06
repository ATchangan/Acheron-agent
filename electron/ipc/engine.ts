// electron/ipc/engine.ts — 独立内核 IPC 桥
// 渲染层只发 start/stop/interject/approve/reject/resume, 结果全部走 engine:event 事件流。
import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { AgentEngine } from '../engine/engine'
import type { EngineProvider, EngineSettings } from '../engine/types'
import { clearApprovedForSid } from './risk-confirm'

export function registerEngineIpc(deps: {
  settingsPath: string
  userDataPath: string
  memoryPath: string
  tracePath: string
  resourcesDir: string
  netFetch: typeof fetch
  decProviders: (d: unknown) => Record<string, unknown>
  getSender: () => Electron.WebContents | null
}): void {
  const { settingsPath, userDataPath, memoryPath, tracePath, resourcesDir, netFetch, decProviders, getSender } = deps

  const loadSettings = (): { providers: EngineProvider[]; general: EngineSettings } => {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      const data = Object.assign(raw, decProviders(raw))
      const providers: EngineProvider[] = Array.isArray(data.providers) ? data.providers.map((p: Record<string, unknown>) => ({
        id: String(p.id || ''),
        name: String(p.name || ''),
        type: String(p.type || 'OpenAI Compatible'),
        apiKey: String(p.apiKey || ''),
        baseUrl: String(p.baseUrl || ''),
        models: Array.isArray(p.models) ? p.models.map(String) : [],
        selectedModel: p.selectedModel ? String(p.selectedModel) : undefined,
        headers: p.headers ? String(p.headers) : undefined,
      })) : []
      return { providers, general: (data.general || {}) as EngineSettings }
    } catch { return { providers: [], general: {} } }
  }

  const engine = new AgentEngine({
    settingsPath,
    userDataPath,
    memoryPath,
    tracePath,
    netFetch,
    loadSettings,
    loadIshiki: () => {
      try {
        const p = join(resourcesDir, 'ishiki.md')
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : ''
      } catch { return '' }
    },
    sendEvent: ev => {
      for (const w of BrowserWindow.getAllWindows()) {
        try { w.webContents.send('engine:event', ev) } catch { /* 忽略 */ }
      }
    },
    getSender,
  })

  ipcMain.handle('engine:start', (_e, p: unknown) => {
    // 新任务开始时清除「本次任务都批准」记录(上一任务的批准不延续)
    try { clearApprovedForSid(String((p as { sid?: unknown })?.sid || '')) } catch { /* 忽略 */ }
    engine.start(p as never)
    return true
  })
  ipcMain.handle('engine:stop', (_e, sid: string) => { engine.stop(sid); return true })
  ipcMain.handle('engine:interject', (_e, sid: string, content: string, images?: string[], attachments?: unknown, kind?: string, prefix?: string) => {
    engine.interject(sid, content, images, attachments as never, (kind as 'supplement' | 'retarget') || 'supplement', prefix || '')
    return true
  })
  ipcMain.handle('engine:approve', (_e, sid: string) => { engine.approve(sid); return true })
  ipcMain.handle('engine:reject', (_e, sid: string) => { engine.reject(sid); return true })
  ipcMain.handle('engine:resume', (_e, taskId: string) => { engine.resume(taskId); return true })
}
