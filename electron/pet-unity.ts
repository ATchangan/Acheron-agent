// electron/pet-unity.ts — Unity 桌宠进程守护 + 本地 WebSocket 桥接
// 协议见 docs/0.4.0-mate-parity/集成架构.md；Unity 侧对应 HqBridgeClient。
// 设计原则: Electron 只做"大脑", 桌宠渲染/交互全在 Unity 进程内完成。
import { ChildProcess, spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { createServer, Server } from 'http'
import { WebSocket, WebSocketServer } from 'ws'

export interface PetUnityConfig {
  form?: 'normal' | 'ultimate'
  action?: 'idle' | 'dance1' | 'dance2' | 'dance3'
  anchor?: 'float' | 'window' | 'taskbar'
  scale?: number
  opacity?: number
  topmost?: boolean
  fps?: number
  chibi?: number
  physics?: boolean
  breath?: 'light' | 'normal' | 'strong'
}

export interface PetUnityCallbacks {
  onEvent: (evt: string, payload: Record<string, unknown>) => void
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void
}

export class PetUnityManager {
  private proc: ChildProcess | null = null
  private httpServer: Server | null = null
  private wss: WebSocketServer | null = null
  private socket: WebSocket | null = null
  private token = randomBytes(16).toString('hex')
  private port = 0
  private stopped = false

  constructor(
    private readonly exePath: string,
    private readonly opts: {
      dataDir: string
      vrmNormal: string
      vrmUltimate: string
    },
    private readonly cb: PetUnityCallbacks,
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  /** 启动 WS 服务并拉起 Unity 桌宠进程; Unity 侧连上后发 ready 事件。 */
  start(): void {
    if (this.httpServer) return
    this.stopped = false
    this.httpServer = createServer()
    this.wss = new WebSocketServer({ server: this.httpServer, host: '127.0.0.1' })
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.searchParams.get('token') !== this.token) {
        ws.close(1008, 'bad token')
        return
      }
      if (this.socket) {
        // 只保留最新一条连接(旧进程残留则断开)
        try { this.socket.close(1000, 'replaced') } catch { /* 忽略 */ }
      }
      this.socket = ws
      ws.on('message', data => this.onRaw(data.toString('utf-8')))
      ws.on('close', () => { if (this.socket === ws) this.socket = null })
      ws.on('error', () => { /* 连接层错误由心跳兜底 */ })
    })
    this.httpServer.on('error', err => {
      // 端口被占等异常: 透传给上层, 上层回退到 web 桌宠
      console.warn('[pet-unity] WS server error:', err.message)
    })
    this.httpServer.listen(0, '127.0.0.1', () => {
      const addr = this.httpServer?.address()
      if (typeof addr === 'object' && addr) this.port = addr.port
      this.spawnProc()
    })
  }

  private spawnProc(): void {
    if (!this.port) return
    const connect = `ws://127.0.0.1:${this.port}?token=${this.token}`
    const args = [
      '-connect', connect,
      '--datadir', this.opts.dataDir,
      '-vrm', this.opts.vrmNormal,
      '-vrm-ultimate', this.opts.vrmUltimate,
    ]
    this.proc = spawn(this.exePath, args, { windowsHide: true, stdio: 'ignore' })
    this.proc.on('exit', (code, signal) => {
      if (this.stopped) return
      this.cb.onExit(code, signal)
    })
    this.proc.on('error', err => {
      // exe 不存在/被杀软拦: 上层检查后回退 web 桌宠
      console.warn('[pet-unity] spawn error:', err.message)
      this.cb.onExit(null, null)
    })
  }

  private onRaw(raw: string): void {
    for (const line of raw.split('\n')) {
      const text = line.trim()
      if (!text) continue
      try {
        const msg = JSON.parse(text) as { type?: string; payload?: Record<string, unknown> }
        if (msg.type === 'event' && msg.payload) {
          const inner = (msg.payload as { event?: string; payload?: Record<string, unknown> }).payload
          const evt = (msg.payload as { event?: string }).event
          if (evt) this.cb.onEvent(evt, inner || {})
        }
      } catch { /* 单条坏消息忽略 */ }
    }
  }

  send(type: string, payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    try { this.socket.send(JSON.stringify({ type, payload }) + '\n') } catch { /* 忽略 */ }
  }

  sendConfig(config: PetUnityConfig): void {
    this.send('config', config)
  }

  sendAction(action: string): void {
    this.send('action', { action })
  }

  sendChat(payload: Record<string, unknown>): void {
    this.send('chat', payload)
  }

  sendState(payload: Record<string, unknown>): void {
    this.send('state', payload)
  }

  stop(): void {
    this.stopped = true
    try { this.socket?.close(1000, 'app quit') } catch { /* 忽略 */ }
    this.socket = null
    try { this.proc?.kill() } catch { /* 忽略 */ }
    this.proc = null
    try { this.wss?.close() } catch { /* 忽略 */ }
    this.wss = null
    try { this.httpServer?.close() } catch { /* 忽略 */ }
    this.httpServer = null
  }
}
