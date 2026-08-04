// electron/ipc/misc.ts —— 杂项域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { exec } from 'child_process'

export function registerMiscIpc(deps: {
  settingsPath: string
  userDataPath: string
  resourcesDir: string
  skillsDir: string
  workspaceDir: string
  dirSize: (dir: string) => number
  fmtSize: (b: number) => string
}): void {
  const { settingsPath, userDataPath, resourcesDir, skillsDir, workspaceDir, dirSize, fmtSize } = deps

  ipcMain.handle('renderer:status', () => {
    try {
      const st = app.getGPUFeatureStatus()
      return { gpu: st.gpu_compositing, renderer: st.webgl, ok: true }
    } catch { return { ok: false } }
  })
  ipcMain.handle('storage:stats', () => {
    try {
      return {
        sessions: fmtSize(dirSize(join(userDataPath, 'sessions'))),
        memory: fmtSize(fs.existsSync(join(userDataPath, 'memory.json')) ? fs.statSync(join(userDataPath, 'memory.json')).size : 0),
        plugins: fmtSize(dirSize(join(userDataPath, 'plugins'))),
        cache: fmtSize(dirSize(join(userDataPath, 'cache'))),
        workspace: fmtSize(dirSize(join(userDataPath, 'workspace'))),
        settings: fmtSize(fs.existsSync(settingsPath) ? fs.statSync(settingsPath).size : 0),
      }
    } catch { return {} }
  })
  ipcMain.handle('settings:reset', () => {
    try {
      const defaults = { providers: [], mediaProviders: [], general: { mode: 'work', theme: 'dark', agentName: '黄泉' } }
      fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2), 'utf-8')
      return true
    } catch { return false }
  })
  ipcMain.handle('ishiki:load', () => {
    try { const p = join(resourcesDir, 'ishiki.md'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '' }
    catch { return '' }
  })
  ipcMain.handle('tts:speak', async (_e, text: string, rate?: number) => {
    const t = String(text || '').trim().replace(/['"\\]/g, '').slice(0, 300)
    if (!t) return false
    const r = Math.max(0.5, Math.min(3, Number(rate) || 1))
    const speed = Math.round((r - 1) * 10) // SAPI Rate: -10..10
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = ${speed}; $s.Speak('${t}'); $s.Dispose()`
    return new Promise<boolean>(resolve => {
      exec(`powershell -NoProfile -Command "${ps}"`, { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 64 }, (err) => resolve(!err))
    })
  })
  ipcMain.handle('get:paths', () => ({ skillsDir, pluginsDir: join(userDataPath, 'plugins'), workDir: workspaceDir }))
  // ─── Codex 吸收: 项目指令文件(AGENTS.md)注入 ───
  // 工作目录存在 AGENTS.md / .agents.md 时, 其约定自动进入 Agent 上下文(限长 4000 字符)
  ipcMain.handle('get:projectContext', () => {
    try {
      for (const name of ['AGENTS.md', '.agents.md']) {
        const p = join(workspaceDir, name)
        if (fs.existsSync(p)) {
          const c = fs.readFileSync(p, 'utf-8')
          return { file: name, content: c.slice(0, 4000) }
        }
      }
      return { file: '', content: '' }
    } catch { return { file: '', content: '' } }
  })
  // 应用版本信息 —— 关于页动态读取, 杜绝硬编码版本号漂移
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron || '',
    node: process.versions.node || '',
  }))
}
