// electron/memory/session-index.ts — 会话 JSON → SQLite FTS5 全文索引(v0.4.0 M2)
// 供 session_search 工具跨会话检索; 按 5 秒防抖刷新, 会话写入后下次检索自动重建
import * as fs from 'fs'
import { join } from 'path'
import { replaceSessionIndex, searchSessionIndex } from '../db'

let lastRefresh = 0

export function refreshSessionIndex(sessionsDir: string, force = false): void {
  const now = Date.now()
  if (!force && now - lastRefresh < 5000) return
  try {
    if (!fs.existsSync(sessionsDir)) return
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')).slice(0, 300)
    const chunks: { sid: string; role: string; snippet: string; ts: number }[] = []
    for (const f of files) {
      try {
        const d = JSON.parse(fs.readFileSync(join(sessionsDir, f), 'utf-8')) as { messages?: { role?: string; content?: unknown; timestamp?: number }[] }
        const sid = f.replace(/\.json$/, '')
        for (const m of (d.messages || []).slice(0, 200)) {
          const text = String(m?.content || '')
          if (text.trim().length > 4) {
            chunks.push({ sid, role: String(m?.role || 'user'), snippet: text.slice(0, 1200), ts: Number(m?.timestamp || 0) })
          }
        }
      } catch { /* 损坏会话跳过 */ }
    }
    replaceSessionIndex(chunks)
    lastRefresh = now
  } catch { /* 索引失败不影响会话功能 */ }
}

export function searchSessions(sessionsDir: string, query: string, limit = 10): { sid: string; role: string; snippet: string; ts: number; score: number }[] {
  refreshSessionIndex(sessionsDir)
  return searchSessionIndex(query, limit)
}
