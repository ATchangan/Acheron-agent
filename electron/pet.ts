// electron/pet.ts — 桌宠(式神伴身)窗口生命周期 + 状态广播 + 位置持久化(v0.4.0 M9)
// 只监听既有任务事件, 与其他模块零耦合; 设置关闭/应用退出即销毁窗口, 禁止常驻后台
import { BrowserWindow, screen } from 'electron'
import * as fs from 'fs'
import { join } from 'path'

export interface PetSettings {
  enabled?: boolean
  agent?: string
  form?: 'normal' | 'ultimate'
  scale?: number
  opacity?: number
  topmost?: boolean
  bubble?: boolean
  pos?: { x: number | null; y: number | null }
}

export const PET_AGENTS = ['黄泉', '姬子', '三月七', '银狼', '艾丝妲', '知更鸟', '黑天鹅', '螺丝咕姆']

export const PET_LINES: Record<string, string[]> = {
  黄泉: ['主人，任务办妥了', '有些事，即便没有意义，也依然值得去做', '需要我出手吗？'],
  姬子: ['主人，咖啡已经煮好了', '任务交给我，您放心', '出发吧，向着下一站'],
  三月七: ['有什么新鲜事吗？', '记录完成，快来看看', '别急，我马上好'],
  银狼: ['系统已上线', '这局稳了', '让我查一下'],
  艾丝妲: ['到点了，该开工了', '日程已安排', '数据整理完毕'],
  知更鸟: ['需要我唱首歌吗？', '为您播报最新进度', '一切尽在掌握'],
  黑天鹅: ['预言已经显现', '命运的丝线正在编织', '我看见了新的可能'],
  螺丝咕姆: ['计算完成，误差为零', '按计划执行', '我来检修一下'],
}

export class PetManager {
  private win: BrowserWindow | null = null

  constructor(private opts: { petDir: string; settingsPath: string; getMain: () => BrowserWindow | null }) {}

  private readSettings(): PetSettings {
    try {
      const d = JSON.parse(fs.readFileSync(this.opts.settingsPath, 'utf-8')) as { general?: { pet?: PetSettings } }
      return d?.general?.pet || {}
    } catch { return {} }
  }

  private writeSettings(patch: Partial<PetSettings>): void {
    try {
      const raw = fs.existsSync(this.opts.settingsPath) ? JSON.parse(fs.readFileSync(this.opts.settingsPath, 'utf-8')) : {}
      raw.general = raw.general || {}
      raw.general.pet = { ...(raw.general.pet || {}), ...patch }
      fs.writeFileSync(this.opts.settingsPath, JSON.stringify(raw, null, 2), 'utf-8')
    } catch { /* 忽略 */ }
  }

  isEnabled(): boolean { return this.readSettings().enabled === true }

  toggle(enable?: boolean): boolean {
    const next = enable ?? !this.isEnabled()
    this.writeSettings({ enabled: next })
    if (next) this.create()
    else this.destroy()
    return next
  }

  sync(): void {
    if (this.isEnabled() && !this.win) this.create()
    if (!this.isEnabled() && this.win) this.destroy()
  }

  getForm(): 'normal' | 'ultimate' {
    const f = this.readSettings().form
    return f === 'ultimate' ? 'ultimate' : 'normal'
  }

  toggleForm(): 'normal' | 'ultimate' {
    return this.setForm(this.getForm() === 'ultimate' ? 'normal' : 'ultimate')
  }

  setForm(form: 'normal' | 'ultimate'): 'normal' | 'ultimate' {
    const next: 'normal' | 'ultimate' = form === 'ultimate' ? 'ultimate' : 'normal'
    this.writeSettings({ form: next })
    this.win?.webContents.send('pet:form', next)
    return next
  }

  create(): void {
    if (this.win) return
    const s = this.readSettings()
    const scale = Math.max(0.5, Math.min(2, Number(s.scale) || 1))
    // v0.4.1: 3D 建模为竖版全身像, 基准窗改为 200×300
    const w = Math.round(200 * scale)
    const h = Math.round(300 * scale)
    const win = new BrowserWindow({
      width: w,
      height: h,
      transparent: true,
      frame: false,
      alwaysOnTop: s.topmost !== false,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      focusable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        // 纯本地静态页(无远程内容): 允许 FileLoader fetch(file://) 读取 PMX/贴图/wasm;
        // contextIsolation/nodeIntegration 防护保持不变
        webSecurity: false,
        preload: join(this.opts.petDir, 'preload.js'),
      },
    })
    win.setAlwaysOnTop(s.topmost !== false, 'floating')
    this.place(win, s)
    void win.loadFile(join(this.opts.petDir, 'index.html'))
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.send('pet:config', {
          agent: s.agent || '黄泉',
          form: s.form === 'ultimate' ? 'ultimate' : 'normal',
          scale,
          opacity: Math.max(0.3, Math.min(1, Number(s.opacity) || 0.9)),
          bubble: s.bubble !== false,
          lines: PET_LINES[s.agent || '黄泉'] || PET_LINES['黄泉'],
        })
      }
    })
    if (process.env.HQ_PET_DEBUG === '1') {
      win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
        console.debug(`[pet-renderer:${level}] ${message} (${sourceId}:${line})`)
      })
      win.webContents.on('did-fail-load', (_e, code, desc) => {
        console.debug(`[pet-renderer] did-fail-load ${code} ${desc}`)
      })
    }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('closed', () => { if (this.win === win) this.win = null })
    this.win = win
  }

  private place(win: BrowserWindow, s: PetSettings): void {
    const pos = s.pos
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      win.setPosition(Math.round(pos.x), Math.round(pos.y))
      return
    }
    const area = screen.getPrimaryDisplay().workArea
    win.setPosition(area.x + area.width - win.getBounds().width - 24, area.y + area.height - win.getBounds().height - 24)
  }

  destroy(): void {
    try { this.win?.destroy() } catch { /* 忽略 */ }
    this.win = null
  }

  send(event: string, payload?: Record<string, unknown>): void {
    if (!this.win || this.win.isDestroyed()) return
    try { this.win.webContents.send('pet:event', { event, payload: payload || {} }) } catch { /* 忽略 */ }
  }

  openMain(): void {
    const main = this.opts.getMain()
    if (main) { main.show(); main.focus() }
  }

  move(x: number, y: number): void {
    this.writeSettings({ pos: { x, y } })
  }

  resetPosition(): void {
    this.writeSettings({ pos: { x: null, y: null } })
    if (this.win) this.place(this.win, this.readSettings())
  }

  // 引擎事件 → 桌宠状态机(只转发, 不新增语义)
  onEngineEvent(ev: { type: string; sid?: string; busy?: boolean; content?: string | null; status?: string; error?: string }): void {
    switch (ev.type) {
      case 'busy':
        if (ev.busy) this.send('state', { state: 'working', text: '这就去办' })
        else this.send('state', { state: 'done', text: '办妥了' })
        break
      case 'step':
        this.send('state', { state: 'thinking', text: String(ev.content || '思考中…').slice(0, 40) })
        break
      case 'task-done':
        this.send('state', { state: ev.status === 'done' ? 'done' : 'error', text: ev.status === 'done' ? '办妥了' : '出岔子了，看看诊断？' })
        break
      case 'error':
        this.send('state', { state: 'error', text: '出岔子了，看看诊断？' })
        break
      default:
        break
    }
  }

  cronFire(taskName: string): void {
    this.send('state', { state: 'working', text: '到点了：' + String(taskName || '定时任务').slice(0, 40) })
  }
}
