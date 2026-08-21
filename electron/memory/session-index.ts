// electron/memory/session-index.ts — 会话 JSON → SQLite FTS5 全文索引(v0.4.0 M2)
// 供 session_search 工具跨会话检索; 按 5 秒防抖 + 文件 mtime 增量刷新(仅重索引有变化的会话)
import * as fs from 'fs'
import { join } from 'path'
import { replaceSessionChunks, deleteSessionChunks, searchSessionIndex } from '../db'

let lastRefresh = 0
const indexed = new Map<string, number>() // sid -> mtimeMs

export function refreshSessionIndex(sessionsDir: string, force = false): void {
  const now = Date.now()
  if (!force && now - lastRefresh < 5000) return
  try {
    if (!fs.existsSync(sessionsDir)) return
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')).slice(0, 300)
    const live = new Set<string>()
    for (const f of files) {
      const sid = f.replace(/\.json$/, '')
      live.add(sid)
      let mtimeMs = 0
      try { mtimeMs = fs.statSync(join(sessionsDir, f)).mtimeMs } catch { continue }
      if (!force && indexed.get(sid) === mtimeMs) continue
      const chunks: { role: string; snippet: string; ts: number }[] = []
      try {
        const d = JSON.parse(fs.readFileSync(join(sessionsDir, f), 'utf-8')) as { messages?: { role?: string; content?: unknown; timestamp?: number }[] }
        for (const m of (d.messages || []).slice(0, 200)) {
          const text = String(m?.content || '')
          if (text.trim().length > 4) {
            chunks.push({ role: String(m?.role || 'user'), snippet: text.slice(0, 1200), ts: Number(m?.timestamp || 0) })
          }
        }
      } catch { /* 损坏会话跳过 */ }
      replaceSessionChunks(sid, chunks)
      indexed.set(sid, mtimeMs)
    }
    // 已删除/超出 300 个范围的会话, 从索引中移除
    for (const sid of [...indexed.keys()]) {
      if (!live.has(sid)) { deleteSessionChunks(sid); indexed.delete(sid) }
    }
    lastRefresh = now
  } catch { /* 索引失败不影响会话功能 */ }
}

export function searchSessions(sessionsDir: string, query: string, limit = 10): { sid: string; role: string; snippet: string; ts: number; score: number }[] {
  refreshSessionIndex(sessionsDir)
  return searchSessionIndex(query, limit)
}
