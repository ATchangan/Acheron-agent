// electron/ipc/trace.ts — 本地可观测性(v0.3.3 诊断加固)
// 按 requestId/会话 追加 JSONL 轨迹, 保留最近 ~2000 条, 设置页「诊断」Tab 可查/清。
import { ipcMain, dialog } from 'electron'
import * as fs from 'fs'
import { dirname, join } from 'path'
import * as os from 'os'

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
const KEEP_ARCHIVES_MS = 7 * 24 * 60 * 60 * 1000 // v0.3.8: 归档保留 7 天
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
        // v0.3.8: 归档而非丢弃 —— 旧文件改名保留, 再清理超期归档
        try {
          const archive = path + '.old-' + Date.now()
          fs.renameSync(path, archive)
          for (const f of fs.readdirSync(dirname(path))) {
            if (!f.startsWith('agent-trace.jsonl.old-')) continue
            try {
              const fp = join(dirname(path), f)
              if (Date.now() - fs.statSync(fp).mtimeMs > KEEP_ARCHIVES_MS) fs.unlinkSync(fp)
            } catch { /* 单个清理失败忽略 */ }
          }
          return
        } catch { /* 归档失败则回退截断 */ }
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
  // v0.3.9: 导出轨迹 —— 保存对话框选路径, 写 JSONL 原文 + Markdown 摘要
  ipcMain.handle('trace:export', async () => {
    try {
      flushTrace()
      if (!fs.existsSync(tracePath)) return { ok: false, error: '轨迹文件不存在' }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const defaultPath = join(os.homedir(), 'Downloads', 'Acheron-Agent-轨迹-' + stamp + '.jsonl')
      const r = await dialog.showSaveDialog({
        title: '导出引擎轨迹',
        defaultPath,
        filters: [{ name: 'JSONL', extensions: ['jsonl'] }],
      })
      if (r.canceled || !r.filePath) return { ok: false, error: '已取消' }
      const raw = fs.readFileSync(tracePath, 'utf-8')
      fs.writeFileSync(r.filePath, raw, 'utf-8')
      const entries: TraceEntry[] = []
      for (const line of raw.split('\n').filter(Boolean)) {
        try { const o = JSON.parse(line) as TraceEntry; if (o && typeof o === 'object') entries.push(o) } catch { /* 跳过坏行 */ }
      }
      const counts: Record<string, number> = {}
      for (const e of entries) counts[e.event] = (counts[e.event] || 0) + 1
      const summaryPath = r.filePath.replace(/\.jsonl$/i, '.md')
      const md = '# Acheron-Agent 引擎轨迹导出\n\n' +
        '- 导出时间: ' + new Date().toLocaleString('zh-CN') + '\n' +
        '- 事件总数: ' + entries.length + '\n' +
        '- 时间范围: ' + (entries[0]?.ts ? new Date(entries[0].ts).toLocaleString('zh-CN') : '-') + ' → ' + (entries[entries.length - 1]?.ts ? new Date(entries[entries.length - 1].ts).toLocaleString('zh-CN') : '-') + '\n\n' +
        '## 事件统计\n\n' +
        Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => '- ' + k + ': ' + v).join('\n') + '\n'
      fs.writeFileSync(summaryPath, md, 'utf-8')
      return { ok: true, path: r.filePath, summaryPath, entries: entries.length }
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })
}
