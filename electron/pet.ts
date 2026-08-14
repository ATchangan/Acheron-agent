// electron/pet.ts — 桌宠(式神伴身)窗口生命周期 + 状态广播 + 位置持久化(v0.4.0 M9)
// 只监听既有任务事件, 与其他模块零耦合; 设置关闭/应用退出即销毁窗口, 禁止常驻后台
// v0.4.0 M10(参照 MateEngine): 锚定模式 anchor —— float 自由 / window 坐视窗 / taskbar 坐任务栏
import { BrowserWindow, screen } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { WinProbe, type WinRect } from './win32-windows'
import { PetUnityManager } from './pet-unity'

export type PetAnchor = 'float' | 'window' | 'taskbar'

export interface PetSettings {
  enabled?: boolean
  engine?: 'web' | 'unity'
  agent?: string
  form?: 'normal' | 'ultimate'
  action?: 'idle' | 'dance1' | 'dance2' | 'dance3'
  anchor?: PetAnchor
  scale?: number
  opacity?: number
  topmost?: boolean
  bubble?: boolean
  look?: boolean
  physics?: boolean
  breath?: 'light' | 'normal' | 'strong'
  gesture?: 'low' | 'normal' | 'high'
  chibi?: number
  fps?: number
  transition?: number
  modelFormat?: 'vrm' | 'pmx'
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

// 坐视窗时, 臀部落在视窗上沿以下这个比例处(占桌宠窗口高度的比例, 自上而下)
const SIT_FRAC = 0.42
const FOLLOW_POLL_MS = 380
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const numOr = (v: unknown, def: number) => (Number.isFinite(Number(v)) ? Number(v) : def)

export class PetManager {
  private win: BrowserWindow | null = null
  private unity: PetUnityManager | null = null
  private chatBuf = ''
  private chatLastSend = 0
  private probe = new WinProbe()
  private followTimer: ReturnType<typeof setInterval> | null = null
  private moveTimer: ReturnType<typeof setInterval> | null = null
  private targetPos: { x: number; y: number } | null = null
  private curPos: { x: number; y: number } | null = null
  private lastWinRect: WinRect | null = null
  private ownHwnd = 0
  private dragging = false
  // 窗口不可缩放, 基准尺寸只在创建时计算一次; 高频 setBounds 必须传这两个常量,
  // 不能用 getSize()(每次 DWM 取整 +1 会不断放大窗口)
  private winW = 200
  private winH = 300
  private shapeRect: Electron.Rectangle | null = null

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

  getAction(): 'idle' | 'dance1' | 'dance2' | 'dance3' {
    const a = this.readSettings().action
    return a === 'dance1' || a === 'dance2' || a === 'dance3' ? a : 'idle'
  }

  setAction(action: 'idle' | 'dance1' | 'dance2' | 'dance3'): 'idle' | 'dance1' | 'dance2' | 'dance3' {
    const next = action === 'dance1' || action === 'dance2' || action === 'dance3' ? action : 'idle'
    this.writeSettings({ action: next })
    this.win?.webContents.send('pet:action', next)
    return next
  }

  // 设置页自由调节(大小/透明度/置顶/气泡/目光/物理/呼吸/小动作/Q版程度), 实时生效
  applyOptions(patch: Partial<PetSettings>): void {
    this.writeSettings(patch)
    const s = this.readSettings()
    const scale = Math.max(0.3, Math.min(2.5, Number(s.scale) || 1))
    if (typeof patch.scale === 'number') {
      this.winW = Math.round(200 * scale)
      this.winH = Math.round(300 * scale)
      const win = this.getWindow()
      if (win) {
        const [x, y] = win.getPosition()
        try { win.setBounds({ x, y, width: this.winW, height: this.winH }, false) } catch { /* 忽略 */ }
      }
    }
    const win = this.getWindow()
    if (typeof patch.topmost === 'boolean' && win) {
      try { win.setAlwaysOnTop(patch.topmost, 'floating') } catch { /* 忽略 */ }
    }
    win?.webContents.send('pet:options', {
      scale,
      opacity: Math.max(0.2, Math.min(1, Number(s.opacity) || 0.9)),
      bubble: s.bubble !== false,
      look: s.look !== false,
      physics: s.physics !== false,
      breath: s.breath === 'light' || s.breath === 'strong' ? s.breath : 'normal',
      gesture: s.gesture === 'low' || s.gesture === 'high' ? s.gesture : 'normal',
      chibi: Math.max(0, Math.min(1.5, Number(s.chibi ?? 1))),
      fps: clamp(Math.round(numOr(s.fps, 60)), 0, 240),
      transition: clamp(Math.round(numOr(s.transition, 450)), 100, 3000),
      modelFormat: s.modelFormat === 'pmx' ? 'pmx' : 'vrm',
      topmost: s.topmost !== false,
    })
  }

  getAnchor(): PetAnchor {
    const a = this.readSettings().anchor
    return a === 'window' || a === 'taskbar' ? a : 'float'
  }

  setAnchor(anchor: PetAnchor): PetAnchor {
    const next: PetAnchor = anchor === 'window' || anchor === 'taskbar' ? anchor : 'float'
    this.writeSettings({ anchor: next })
    this.win?.webContents.send('pet:anchor', next)
    if (next === 'float') {
      this.stopFollow()
      this.clearShape()
      this.persistPos()
    } else if (this.win) {
      this.startFollow()
      this.applyShape(this.shapeRect)
    }
    return next
  }

  create(): void {
    if (this.win) return
    const s = this.readSettings()
    const engine: 'web' | 'unity' = s.engine === 'web' ? 'web' : 'unity'
    if (engine === 'unity') {
      this.createUnity(s)
      return
    }
    const vrmFiles = {
      normal: fs.existsSync(join(this.opts.petDir, 'models', 'vrm', 'index.vrm')),
      ultimate: fs.existsSync(join(this.opts.petDir, 'models', 'vrm', 'ultimate.vrm')),
    }
    const scale = Math.max(0.3, Math.min(2.5, Number(s.scale) || 1))
    // v0.4.0: 3D 建模为竖版全身像, 基准窗改为 200×300
    const w = Math.round(200 * scale)
    const h = Math.round(300 * scale)
    this.winW = w
    this.winH = h
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
    try {
      const raw = win.getNativeWindowHandle()
      this.ownHwnd = raw.length >= 8 ? Number(raw.readBigUInt64LE(0)) : Number(raw.readUInt32LE(0))
    } catch { this.ownHwnd = 0 }
    this.place(win, s)
    void win.loadFile(join(this.opts.petDir, 'index.html'))
    // 首次加载与渲染页 reload 都重新下发配置(热迭代依赖这一行为)
    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.send('pet:config', {
          agent: s.agent || '黄泉',
          form: s.form === 'ultimate' ? 'ultimate' : 'normal',
          action: this.getAction(),
          anchor: this.getAnchor(),
          scale,
          opacity: Math.max(0.2, Math.min(1, Number(s.opacity) || 0.9)),
          bubble: s.bubble !== false,
          look: s.look !== false,
          physics: s.physics !== false,
          breath: s.breath === 'light' || s.breath === 'strong' ? s.breath : 'normal',
          gesture: s.gesture === 'low' || s.gesture === 'high' ? s.gesture : 'normal',
          chibi: Math.max(0, Math.min(1.5, Number(s.chibi ?? 1))),
          fps: clamp(Math.round(numOr(s.fps, 60)), 0, 240),
          transition: clamp(Math.round(numOr(s.transition, 450)), 100, 3000),
          modelFormat: s.modelFormat === 'pmx' ? 'pmx' : 'vrm',
          vrm: vrmFiles,
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
    if (process.env.HQ_PET_DEBUG === '1') {
      win.on('resize', () => { console.debug('[pet-win] resize ->', JSON.stringify(win.getBounds()), 'scaleFactor=', screen.getPrimaryDisplay().scaleFactor) })
      win.on('moved', () => { console.debug('[pet-win] moved ->', JSON.stringify(win.getBounds())) })
    }
    this.win = win
    if (process.env.HQ_PET_DEBUG === '1') {
      setTimeout(() => {
        if (!win.isDestroyed()) console.debug('[pet-win] bounds=', JSON.stringify(win.getBounds()), 'size=', JSON.stringify(win.getSize()), 'content=', JSON.stringify(win.getContentBounds()))
      }, 2500)
    }
    if (this.getAnchor() !== 'float') this.startFollow()
  }

  // Unity 桌宠: 不建 BrowserWindow, 拉起独立进程 + WS 桥接
  private createUnity(s: PetSettings): void {
    if (this.unity) return
    const exe = join(this.opts.petDir, '..', 'pet-unity', 'HuangquanPet', 'HuangquanPet.exe')
    if (!fs.existsSync(exe)) {
      // Unity 桌宠尚未构建: 静默回退旧 web 桌宠, 不打断主流程
      this.createWeb(s)
      return
    }
    this.unity = new PetUnityManager(
      exe,
      {
        dataDir: join(this.opts.petDir, 'unity-data'),
        vrmNormal: join(this.opts.petDir, 'models', 'vrm', 'index.vrm'),
        vrmUltimate: join(this.opts.petDir, 'models', 'vrm', 'ultimate.vrm'),
      },
      {
        onEvent: (evt, payload) => {
          if (evt === 'chat-input' && typeof payload.text === 'string') this.relayChat(payload.text)
          else if (evt === 'dragend' && typeof payload.x === 'number' && typeof payload.y === 'number') {
            this.writeSettings({ pos: { x: payload.x, y: payload.y } })
          }
        },
        onExit: () => {
          this.unity = null
        },
      },
    )
    this.unity.start()
    this.unity.sendConfig({
      form: s.form === 'ultimate' ? 'ultimate' : 'normal',
      action: this.getAction(),
      anchor: this.getAnchor(),
      scale: Math.max(0.3, Math.min(2.5, Number(s.scale) || 1)),
      opacity: Math.max(0.2, Math.min(1, Number(s.opacity) || 0.9)),
      topmost: s.topmost !== false,
      chibi: Math.max(0, Math.min(1.5, Number(s.chibi ?? 1))),
      physics: s.physics !== false,
      breath: s.breath === 'light' || s.breath === 'strong' ? s.breath : 'normal',
      fps: clamp(Math.round(numOr(s.fps, 60)), 0, 240),
    })
  }

  // 旧 three.js 桌宠路径(原 create 的窗口逻辑)
  private createWeb(s: PetSettings): void {
    if (this.win) return
    const vrmFiles = {
      normal: fs.existsSync(join(this.opts.petDir, 'models', 'vrm', 'index.vrm')),
      ultimate: fs.existsSync(join(this.opts.petDir, 'models', 'vrm', 'ultimate.vrm')),
    }
    const scale = Math.max(0.3, Math.min(2.5, Number(s.scale) || 1))
    const w = Math.round(200 * scale)
    const h = Math.round(300 * scale)
    this.winW = w
    this.winH = h
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
        webSecurity: false,
        preload: join(this.opts.petDir, 'preload.js'),
      },
    })
    win.setAlwaysOnTop(s.topmost !== false, 'floating')
    try {
      const raw = win.getNativeWindowHandle()
      this.ownHwnd = raw.length >= 8 ? Number(raw.readBigUInt64LE(0)) : Number(raw.readUInt32LE(0))
    } catch { this.ownHwnd = 0 }
    this.place(win, s)
    void win.loadFile(join(this.opts.petDir, 'index.html'))
    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.send('pet:config', {
          agent: s.agent || '黄泉',
          form: s.form === 'ultimate' ? 'ultimate' : 'normal',
          action: this.getAction(),
          anchor: this.getAnchor(),
          scale,
          opacity: Math.max(0.2, Math.min(1, Number(s.opacity) || 0.9)),
          bubble: s.bubble !== false,
          look: s.look !== false,
          physics: s.physics !== false,
          breath: s.breath === 'light' || s.breath === 'strong' ? s.breath : 'normal',
          gesture: s.gesture === 'low' || s.gesture === 'high' ? s.gesture : 'normal',
          chibi: Math.max(0, Math.min(1.5, Number(s.chibi ?? 1))),
          fps: clamp(Math.round(numOr(s.fps, 60)), 0, 240),
          transition: clamp(Math.round(numOr(s.transition, 450)), 100, 3000),
          modelFormat: s.modelFormat === 'pmx' ? 'pmx' : 'vrm',
          vrm: vrmFiles,
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
    if (process.env.HQ_PET_DEBUG === '1') {
      win.on('resize', () => { console.debug('[pet-win] resize ->', JSON.stringify(win.getBounds()), 'scaleFactor=', screen.getPrimaryDisplay().scaleFactor) })
      win.on('moved', () => { console.debug('[pet-win] moved ->', JSON.stringify(win.getBounds())) })
    }
    this.win = win
    if (process.env.HQ_PET_DEBUG === '1') {
      setTimeout(() => {
        if (!win.isDestroyed()) console.debug('[pet-win] bounds=', JSON.stringify(win.getBounds()), 'size=', JSON.stringify(win.getSize()), 'content=', JSON.stringify(win.getContentBounds()))
      }, 2500)
    }
    if (this.getAnchor() !== 'float') this.startFollow()
  }

  private place(win: BrowserWindow, s: PetSettings): void {
    if (s.anchor === 'window' || s.anchor === 'taskbar') {
      this.placeFollowFallback(win)
      return
    }
    const pos = s.pos
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      this.setWinBounds(win, Math.round(pos.x), Math.round(pos.y))
      return
    }
    const area = screen.getPrimaryDisplay().workArea
    this.setWinBounds(win, area.x + area.width - win.getBounds().width - 24, area.y + area.height - win.getBounds().height - 24)
  }

  private placeFollowFallback(win: BrowserWindow): void {
    const [w, h] = win.getSize()
    const work = screen.getPrimaryDisplay().workArea
    const tray = this.probe.getLatest().tray
    if (tray) {
      this.setWinBounds(win, clamp(Math.round(tray.l + (tray.r - tray.l) / 2 - w / 2), work.x, work.x + work.width - w), clamp(tray.t - Math.round(h * SIT_FRAC), work.y, work.y + work.height - h))
    } else {
      this.setWinBounds(win, clamp(Math.round(work.x + work.width / 2 - w / 2), work.x, work.x + work.width - w), Math.round(work.y + work.height * 0.25))
    }
  }

  // Windows 11 + 透明无边框窗口在 150% DPI 下, setPosition 每次调用会 +1px(DWM 取整 bug);
  // 高频循环必须用带显式尺寸的 setBounds, 否则桌宠会肉眼可见地持续膨胀
  private setWinBounds(win: BrowserWindow, x: number, y: number): void {
    const px = Math.round(x)
    const py = Math.round(y)
    // 坐标/尺寸一旦被 NaN 污染, 透明窗口会在 Windows 上被 DWM 收敛成异常小窗口且无法恢复
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(this.winW) || !Number.isFinite(this.winH)) return
    try { win.setBounds({ x: px, y: py, width: this.winW, height: this.winH }, false) } catch { /* 忽略 */ }
  }

  destroy(): void {
    this.stopFollow()
    this.probe.stop()
    try { this.win?.destroy() } catch { /* 忽略 */ }
    this.win = null
  }

  send(event: string, payload?: Record<string, unknown>): void {
    if (!this.win || this.win.isDestroyed()) return
    try { this.win.webContents.send('pet:event', { event, payload: payload || {} }) } catch { /* 忽略 */ }
  }

  // 聊天流走独立通道(与状态事件 pet:event 分开, 避免被状态机丢弃)
  sendChat(payload: Record<string, unknown>): void {
    if (!this.win || this.win.isDestroyed()) return
    try { this.win.webContents.send('pet:chat', payload) } catch { /* 忽略 */ }
  }

  getWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  focusInput(): void {
    const win = this.getWindow()
    if (!win) return
    // 输入框浮在角色上方, 命中区域要临时扩回整窗才能点中
    try { win.setShape([]) } catch { /* 忽略 */ }
    try { win.setFocusable(true); win.show(); win.focus(); win.webContents.focus() } catch { /* 忽略 */ }
  }

  unfocusInput(): void {
    try { this.win?.setFocusable(false) } catch { /* 忽略 */ }
    this.applyShape(this.shapeRect)
  }

  // 桌宠窗口命中区域收缩到角色轮廓(透明区域点击穿透到下层窗口)
  applyShape(rect: { x: number; y: number; width: number; height: number } | null): void {
    if (this.getAnchor() === 'float') { this.clearShape(); return }
    if (rect && Number(rect.width) > 8 && Number(rect.height) > 8) {
      this.shapeRect = {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
      }
      try { this.win?.setShape([this.shapeRect]) } catch { /* 忽略 */ }
      if (process.env.HQ_PET_DEBUG === '1') console.debug('[pet-shape]', JSON.stringify(this.shapeRect))
    } else {
      this.shapeRect = null
      try { this.win?.setShape([]) } catch { /* 忽略 */ }
      if (process.env.HQ_PET_DEBUG === '1') console.debug('[pet-shape] cleared')
    }
  }

  clearShape(): void {
    this.shapeRect = null
    try { this.win?.setShape([]) } catch { /* 忽略 */ }
    if (process.env.HQ_PET_DEBUG === '1') console.debug('[pet-shape] cleared')
  }

  // 桌宠输入的消息转发给主窗口渲染层, 复用现有会话/历史/人设管线
  relayChat(content: string): void {
    const main = this.opts.getMain()
    if (main && !main.isDestroyed()) main.webContents.send('pet:chat', { content })
    this.chatBuf = ''
    this.sendChat({ thinking: true })
  }

  persistPos(): void {
    if (this.getAnchor() !== 'float') return
    const win = this.getWindow()
    if (!win) return
    const [x, y] = win.getPosition()
    this.writeSettings({ pos: { x, y } })
  }

  openMain(): void {
    const main = this.opts.getMain()
    if (main) { main.show(); main.focus() }
  }

  move(x: number, y: number): void {
    this.writeSettings({ pos: { x, y } })
  }

  resetPosition(): void {
    if (this.getAnchor() === 'float') {
      this.writeSettings({ pos: { x: null, y: null } })
      if (this.win) this.place(this.win, this.readSettings())
      return
    }
    // 锚定模式: 清空上次窗口记忆, 立刻重新吸附
    this.lastWinRect = null
    if (this.win) this.placeFollowFallback(this.win)
    void this.tickFollow()
  }

  // 拖动开始: 若正锚在视窗/任务栏上, 拖起即脱离锚定回到自由模式(MateEngine 交互习惯)
  dragStart(): void {
    this.dragging = true
    if (this.getAnchor() !== 'float') this.setAnchor('float')
    else this.stopFollow()
  }

  dragEnd(): void {
    this.dragging = false
    this.persistPos()
  }

  private startFollow(): void {
    this.stopFollow()
    this.probe.start()
    const win = this.getWindow()
    if (!win) return
    const [x, y] = win.getPosition()
    this.curPos = { x, y }
    this.targetPos = { x, y }
    this.moveTimer = setInterval(() => this.smoothStep(), 16)
    this.followTimer = setInterval(() => { void this.tickFollow() }, FOLLOW_POLL_MS)
    void this.tickFollow()
  }

  private stopFollow(): void {
    if (this.followTimer) { clearInterval(this.followTimer); this.followTimer = null }
    if (this.moveTimer) { clearInterval(this.moveTimer); this.moveTimer = null }
    this.targetPos = null
    this.curPos = null
  }

  private smoothStep(): void {
    const win = this.getWindow()
    if (!win || !this.targetPos || this.dragging) return
    if (!this.curPos) this.curPos = { ...this.targetPos }
    const c = this.curPos
    const t = this.targetPos
    c.x += (t.x - c.x) * 0.26
    c.y += (t.y - c.y) * 0.26
    if (Math.abs(t.x - c.x) < 0.6 && Math.abs(t.y - c.y) < 0.6) { c.x = t.x; c.y = t.y }
    this.setWinBounds(win, c.x, c.y)
  }

  private async tickFollow(): Promise<void> {
    if (this.dragging) return
    const anchor = this.getAnchor()
    const win = this.getWindow()
    if (!win || anchor === 'float') return
    const [w, h] = win.getSize()
    const work = screen.getPrimaryDisplay().workArea
    if (anchor === 'taskbar') {
      const snap = await this.probe.poll()
      if (snap.tray) {
        const t = snap.tray
        this.targetPos = {
          x: clamp(Math.round(t.l + (t.r - t.l) / 2 - w / 2), work.x, work.x + work.width - w),
          y: clamp(t.t - Math.round(h * SIT_FRAC), work.y, work.y + work.height - h),
        }
        if (process.env.HQ_PET_DEBUG === '1') console.debug('[pet-follow] taskbar', JSON.stringify(this.targetPos), 'tray=', JSON.stringify(t))
      }
      return
    }
    const snap = await this.probe.poll()
    const fgWin = snap.wins.find(x => x.h === snap.fg)
    // 前台窗口是桌宠自己(聊天输入时短暂获得焦点) → 保持上次锚点不动
    if (fgWin && fgWin.h !== this.ownHwnd && fgWin.h !== 0) {
      this.lastWinRect = { l: fgWin.l, t: fgWin.tp, r: fgWin.r, b: fgWin.b }
    }
    const r = this.lastWinRect
    if (!r) return
    this.targetPos = {
      x: clamp(Math.round(r.l + (r.r - r.l) / 2 - w / 2), work.x, work.x + work.width - w),
      y: clamp(r.t - Math.round(h * SIT_FRAC), work.y, work.y + work.height - h),
    }
    if (process.env.HQ_PET_DEBUG === '1') console.debug('[pet-follow] window', JSON.stringify(this.targetPos), 'fgWin=', fgWin ? JSON.stringify({ l: fgWin.l, tp: fgWin.tp, t: fgWin.t }) : 'none', 'last=', JSON.stringify(r))
  }

  // 引擎事件 → 桌宠状态机(只转发, 不新增语义)
  onEngineEvent(ev: { type: string; sid?: string; busy?: boolean; content?: string | null; delta?: string; status?: string; error?: string }): void {
    switch (ev.type) {
      case 'busy':
        if (ev.busy) { this.chatBuf = ''; this.send('state', { state: 'working', text: '这就去办' }) }
        else {
          if (this.chatBuf) this.sendChat({ text: this.chatBuf.slice(-220), streaming: false })
          this.send('state', { state: 'done', text: this.chatBuf ? '' : '办妥了' })
        }
        break
      case 'assistant-chunk': {
        // 流式回复 → 桌宠气泡(节流 120ms), 只保留尾部 220 字避免气泡过高
        if (typeof ev.delta === 'string') this.chatBuf += ev.delta
        else if (typeof ev.content === 'string') this.chatBuf = ev.content
        const now = Date.now()
        if (now - this.chatLastSend >= 120) {
          this.chatLastSend = now
          this.sendChat({ text: this.chatBuf.slice(-220), streaming: true })
        }
        break
      }
      case 'final':
        this.chatBuf = typeof ev.content === 'string' ? ev.content : this.chatBuf
        this.sendChat({ text: this.chatBuf.slice(-220), streaming: false })
        break
      case 'step':
        this.send('state', { state: 'thinking', text: String(ev.content || '思考中…').slice(0, 40) })
        break
      case 'task-done':
        if (ev.status === 'done' && this.chatBuf) this.sendChat({ text: this.chatBuf.slice(-220), streaming: false })
        this.send('state', { state: ev.status === 'done' ? 'done' : 'error', text: ev.status === 'done' ? (this.chatBuf ? '' : '办妥了') : '出岔子了，看看诊断？' })
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
