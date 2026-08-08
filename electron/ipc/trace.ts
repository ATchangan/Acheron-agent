// electron/ipc/trace.ts — 本地可观测性(v0.3.3 诊断加固)
// 按 requestId/会话 追加 JSONL 轨迹, 保留最近 ~2000 条, 设置页「诊断」Tab 可查/清。
import { ipcMain } from 'electron'
import * as fs from 'fs'

export interface TraceEntry {
  ts: number
  level: 'debug' | 'info' | 'warn' | 'error'
  event: string
  detail?: string
  sid?: string
  requestId?: string
}

const MAX_BYTES = 2 * 1024 * 1024
const KEEP_LINES = 1000
const FLUSH_MS = 500
const FLUSH_LINES = 50

// v0.3.3 性能优化: 轨迹改为内存缓冲 + 批量追加, 避免每个事件一次同步写盘
let traceBuf: string[] = []
let tracePathActive = ''
let traceTimer: ReturnType<typeof setTimeout> | null = null

export function flushTrace(): void {
  traceTimer = null
  if (!traceBuf.length) return
  const lines = traceBuf
  traceBuf = []
  const path = tracePathActive
  if (!path) return
  try {
    fs.appendFileSync(path, lines.join(''), 'utf-8')
    try {
      const st = fs.statSync(path)
      if (st.size > MAX_BYTES) {
        const raw = fs.readFileSync(path, 'utf-8')
        fs.writeFileSync(path, raw.split('\n').filter(Boolean).slice(-KEEP_LINES).join('\n') + '\n', 'utf-8')
      }
    } catch { /* 忽略 */ }
  } catch { /* 日志失败不影响主流程 */ }
}

export function logTraceFile(tracePath: string, entry: TraceEntry): void {
  tracePathActive = tracePath
  traceBuf.push(JSON.stringify(entry) + '\n')
  if (traceBuf.length >= FLUSH_LINES) flushTrace()
  else if (!traceTimer) traceTimer = setTimeout(flushTrace, FLUSH_MS)
}

export function registerTraceIpc(deps: { tracePath: string }): void {
  const { tracePath } = deps
  flushTrace()
  ipcMain.handle('trace:log', (_e, entry: TraceEntry) => {
    if (!entry || typeof entry !== 'object') return false
    logTraceFile(tracePath, { ...entry, ts: Date.now(), level: entry.level || 'info' })
    return true
  })
  ipcMain.handle('trace:list', (_e, limit?: number) => {
    try {
      flushTrace()
      if (!fs.existsSync(tracePath)) return []
      const raw = fs.readFileSync(tracePath, 'utf-8')
      const out: TraceEntry[] = []
      for (const line of raw.split('\n').filter(Boolean)) {
        try { const o = JSON.parse(line); if (o && typeof o === 'object') out.push(o) } catch { /* 跳过坏行 */ }
      }
      return out.slice(-(Math.max(1, Math.min(1000, Number(limit) || 200))))
    } catch { return [] }
  })
  ipcMain.handle('trace:clear', () => {
    try { fs.rmSync(tracePath, { force: true }); return true } catch { return false }
  })
}
