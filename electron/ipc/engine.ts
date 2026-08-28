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
  onEngineEvent?: (ev: unknown) => void
}): void {
  const { settingsPath, userDataPath, memoryPath, tracePath, resourcesDir, netFetch, decProviders, getSender, onEngineEvent } = deps

  const loadSettings = (): { providers: EngineProvider[]; general: EngineSettings } => {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      const data = Object.assign(raw, decProviders(raw))
      const providers: EngineProvider[] = Array.isArray(data.providers) ? data.providers.map((p: Record<string, unknown>) => {
        let apiKey = String(p.apiKey || '')
        // 自省整改: 解密失败的 __ENC__ 密钥不发给 API —— 置空并在控制台提示重新填写
        if (apiKey.startsWith('__ENC__')) {
          console.warn('[settings] 密钥解密失败，已置空待重新填写: ' + String(p.name || p.id || ''))
          apiKey = ''
        }
        return {
          id: String(p.id || ''),
          name: String(p.name || ''),
          type: String(p.type || 'OpenAI Compatible'),
          apiKey,
          baseUrl: String(p.baseUrl || ''),
          models: Array.isArray(p.models) ? p.models.map(String) : [],
          selectedModel: p.selectedModel ? String(p.selectedModel) : undefined,
          headers: p.headers ? String(p.headers) : undefined,
        }
      }) : []
      return { providers, general: (data.general || {}) as EngineSettings }
    } catch { return { providers: [], general: {} } }
  }

  // v0.3.6 P1-6: 事件订阅集合 —— 渲染层注册后只向订阅者广播, 不再遍历所有窗口
  const eventSubscribers = new Set<Electron.WebContents>()

  const engine = new AgentEngine({
    settingsPath,
    userDataPath,
    memoryPath,
    tracePath,
    skillsDirs: [join(resourcesDir, 'skills'), join(userDataPath, 'skills')],
    netFetch,
    loadSettings,
    loadIshiki: () => {
      try {
        const p = join(resourcesDir, 'ishiki.md')
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : ''
      } catch { return '' }
    },
    sendEvent: ev => {
      try { onEngineEvent?.(ev) } catch { /* 忽略 */ }
      if (eventSubscribers.size > 0) {
        for (const wc of eventSubscribers) {
          try {
            if (!wc.isDestroyed()) wc.send('engine:event', ev)
            else eventSubscribers.delete(wc)
          } catch { eventSubscribers.delete(wc) }
        }
        return
      }
      // 无订阅者时回退全窗口广播(兼容早期启动/测试环境)
      for (const w of BrowserWindow.getAllWindows()) {
        try { w.webContents.send('engine:event', ev) } catch { /* 忽略 */ }
      }
    },
    getSender,
  })

  ipcMain.handle('engine:subscribe', (e) => {
    const wc = e.sender
    eventSubscribers.add(wc)
    wc.once('destroyed', () => { eventSubscribers.delete(wc) })
    return true
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
  ipcMain.handle('engine:continue', (_e, sid: string) => { engine.continue(sid); return true })
  ipcMain.handle('engine:clarifyRespond', (_e, sid: string, answer: string) => { engine.clarifyRespond(sid, String(answer ?? '')); return true })
  ipcMain.handle('engine:resume', (_e, taskId: string) => { engine.resume(taskId); return true })
  ipcMain.handle('engine:contextSnapshot', (_e, sid: string) => engine.getContextSnapshot(String(sid || '')))
}
