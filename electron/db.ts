// electron/db.ts — SQLite 存储基座(主进程单例, v0.4.0 M1)
// 后端: node:sqlite(Electron 43 内置, 零新增依赖; 不可用时自动降级为空实现, 应用照常启动)
// 职责: 四层记忆 / 工具输出 side-channel / 审计 / 会话索引 / 技能命中统计 / 元数据
import * as fs from 'fs'
import { join } from 'path'
import { migrate } from './db/migrate'

type SqliteModule = typeof import('node:sqlite')

interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface AuditRow {
  ts: number
  agent?: string | null
  tool?: string | null
  argsSummary?: string | null
  resultSummary?: string | null
  durationMs?: number | null
  tokens?: number | null
  sid?: string | null
  taskId?: string | null
}

export interface AuditFilter { agent?: string; tool?: string; sid?: string; taskId?: string; from?: number; to?: number; limit?: number }

export interface SessionMetaRow { sid: string; agent?: string | null; title?: string | null; stateJson?: string | null; createdAt?: number | null; updatedAt?: number | null }

export interface SkillHitRow { name: string; description: string; hits: number }

let sqlite: SqliteModule | null = null
try {
  sqlite = require('node:sqlite') as SqliteModule
} catch {
  sqlite = null
}

let db: SqliteDb | null = null
let inMemory = false
let dbPath = ''

function lastId(r: { lastInsertRowid: number | bigint }): number {
  return Number(r.lastInsertRowid)
}

export function getMeta(key: string): string | null {
  if (!db) return null
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value?: string } | undefined
    return row?.value ?? null
  } catch { return null }
}

export function setMeta(key: string, value: string): boolean {
  if (!db) return false
  try {
    db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)').run(key, value)
    return true
  } catch { return false }
}

export function initDb(path: string): { ok: boolean; inMemory: boolean } {
  if (!sqlite) return { ok: false, inMemory: false }
  const mk = (dbInstance: SqliteDb): void => {
    dbInstance.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;')
    migrate(dbInstance)
  }
  try {
    const dir = join(path, '..')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const { DatabaseSync } = sqlite
    db = new DatabaseSync(path) as unknown as SqliteDb
    inMemory = false
    mk(db)
    dbPath = path
    return { ok: true, inMemory: false }
  } catch (e) {
    console.warn('[db] 文件库初始化失败, 降级内存模式(记忆将不持久化):', e instanceof Error ? e.message : String(e))
    try {
      const { DatabaseSync } = sqlite
      db = new DatabaseSync(':memory:') as unknown as SqliteDb
      inMemory = true
      mk(db)
      dbPath = ':memory:'
      return { ok: true, inMemory: true }
    } catch (e2) {
      console.warn('[db] 内存库也初始化失败, 记忆功能降级为纯 JSON:', e2 instanceof Error ? e2.message : String(e2))
      db = null
      return { ok: false, inMemory: false }
    }
  }
}

export function getDb(): SqliteDb | null { return db }
export function isInMemory(): boolean { return inMemory }
export function getDbPath(): string { return dbPath }

export function closeDb(): void {
  try { db?.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* 忽略 */ }
  try { db?.close() } catch { /* 忽略 */ }
  db = null
}

// ─── 工具输出 side-channel ──────────────────────────
export function saveToolOutput(sid: string, tool: string, content: string): number {
  if (!db) return 0
  try {
    const r = db.prepare('INSERT INTO tool_outputs(sid, tool, content, ts) VALUES(?, ?, ?, ?)').run(sid, tool, content, Date.now())
    return lastId(r)
  } catch { return 0 }
}

export function getToolOutput(id: number): string | null {
  if (!db) return null
  try {
    const r = db.prepare('SELECT content FROM tool_outputs WHERE id=?').get(id) as { content?: string } | undefined
    return r?.content ?? null
  } catch { return null }
}

// ─── 审计 ───────────────────────────────────────────
export function insertAudit(a: AuditRow): void {
  if (!db) return
  try {
    db.prepare('INSERT INTO audit(ts, agent, tool, args_summary, result_summary, duration_ms, tokens, sid, task_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.ts || Date.now(), a.agent ?? null, a.tool ?? null, a.argsSummary ?? null, a.resultSummary ?? null, a.durationMs ?? null, a.tokens ?? null, a.sid ?? null, a.taskId ?? null)
  } catch { /* 忽略 */ }
}

export interface AuditResult {
  id: number
  ts: number
  agent: string
  tool: string
  argsSummary: string
  resultSummary: string
  durationMs: number | null
  tokens: number | null
  sid: string
  taskId: string
}

export function queryAudit(filter: AuditFilter = {}): AuditResult[] {
  if (!db) return []
  try {
    const conds: string[] = []
    const args: unknown[] = []
    if (filter.agent) { conds.push('agent=?'); args.push(filter.agent) }
    if (filter.tool) { conds.push('tool=?'); args.push(filter.tool) }
    if (filter.sid) { conds.push('sid=?'); args.push(filter.sid) }
    if (filter.taskId) { conds.push('task_id=?'); args.push(filter.taskId) }
    if (filter.from) { conds.push('ts>=?'); args.push(filter.from) }
    if (filter.to) { conds.push('ts<=?'); args.push(filter.to) }
    const where = conds.length ? ' WHERE ' + conds.join(' AND ') : ''
    const rows = db.prepare('SELECT id, ts, agent, tool, args_summary, result_summary, duration_ms, tokens, sid, task_id FROM audit' + where + ' ORDER BY ts DESC LIMIT ?')
      .all(...args, Math.max(1, Math.min(2000, Number(filter.limit) || 100))) as Record<string, unknown>[]
    return rows.map(r => ({
      id: Number(r.id),
      ts: Number(r.ts || 0),
      agent: String(r.agent || ''),
      tool: String(r.tool || ''),
      argsSummary: String(r.args_summary || ''),
      resultSummary: String(r.result_summary || ''),
      durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
      tokens: r.tokens == null ? null : Number(r.tokens),
      sid: String(r.sid || ''),
      taskId: String(r.task_id || ''),
    }))
  } catch { return [] }
}

// ─── 会话索引(供 session_search FTS 后端) ───────────
export function replaceSessionChunks(sid: string, chunks: { role: string; snippet: string; ts: number }[]): void {
  if (!db) return
  try {
    db.exec('BEGIN')
    try {
      // contentless FTS5: 删除行必须提供旧 content, 先取旧片段再从两表删除
      const old = db.prepare('SELECT rowid, snippet FROM session_chunks WHERE sid=?').all(sid) as { rowid: number; snippet: string }[]
      const delFts = db.prepare("INSERT INTO session_chunks_fts(session_chunks_fts, rowid, snippet) VALUES('delete', ?, ?)")
      for (const r of old) delFts.run(r.rowid, r.snippet)
      db.prepare('DELETE FROM session_chunks WHERE sid=?').run(sid)
      const insChunk = db.prepare('INSERT INTO session_chunks(sid, role, snippet, ts) VALUES(?, ?, ?, ?)')
      const insFts = db.prepare('INSERT INTO session_chunks_fts(rowid, snippet) VALUES(?, ?)')
      for (const c of chunks.slice(0, 200)) {
        const r = insChunk.run(sid, c.role, c.snippet.slice(0, 1200), c.ts)
        insFts.run(lastId(r), c.snippet.slice(0, 1200))
      }
      db.exec('COMMIT')
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
      throw e
    }
  } catch { /* 索引失败不影响会话功能 */ }
}

export function deleteSessionChunks(sid: string): void {
  if (!db) return
  try {
    db.exec('BEGIN')
    try {
      const old = db.prepare('SELECT rowid, snippet FROM session_chunks WHERE sid=?').all(sid) as { rowid: number; snippet: string }[]
      const delFts = db.prepare("INSERT INTO session_chunks_fts(session_chunks_fts, rowid, snippet) VALUES('delete', ?, ?)")
      for (const r of old) delFts.run(r.rowid, r.snippet)
      db.prepare('DELETE FROM session_chunks WHERE sid=?').run(sid)
      db.exec('COMMIT')
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
      throw e
    }
  } catch { /* 忽略 */ }
}

export interface SessionHit { sid: string; role: string; snippet: string; ts: number; score: number }

export function searchSessionIndex(query: string, limit = 10): SessionHit[] {
  if (!db || !query) return []
  const q = String(query).trim()
  try {
    if (q.length >= 3) {
      const safe = q.replace(/["*:()^\-+]/g, ' ').replace(/\s+/g, ' ').trim()
      if (safe) {
        const rows = db.prepare('SELECT rowid, bm25(session_chunks_fts) AS score FROM session_chunks_fts WHERE session_chunks_fts MATCH ? ORDER BY score LIMIT ?').all(safe, limit) as { rowid: number; score: number }[]
        const out: SessionHit[] = []
        for (const r of rows) {
          const c = db.prepare('SELECT sid, role, snippet, ts FROM session_chunks WHERE rowid=?').get(r.rowid) as { sid: string; role: string; snippet: string; ts: number } | undefined
          if (c) out.push({ sid: c.sid, role: c.role, snippet: c.snippet, ts: c.ts, score: Math.abs(Number(r.score) || 0) })
        }
        return out
      }
    }
    const rows = db.prepare('SELECT sid, role, snippet, ts FROM session_chunks WHERE snippet LIKE ? ORDER BY ts DESC LIMIT ?').all('%' + q + '%', limit) as { sid: string; role: string; snippet: string; ts: number }[]
    return rows.map(r => ({ sid: r.sid, role: r.role, snippet: r.snippet, ts: r.ts, score: 0.5 }))
  } catch { return [] }
}

// ─── 技能命中统计 ───────────────────────────────────
export function upsertSkill(name: string, description: string): void {
  if (!db) return
  try {
    db.prepare('INSERT INTO skills(name, description, hits, updated_at) VALUES(?, ?, 0, ?) ON CONFLICT(name) DO UPDATE SET description=excluded.description, updated_at=excluded.updated_at')
      .run(name, description.slice(0, 200), Date.now())
  } catch { /* 忽略 */ }
}

export function recordSkillHit(name: string): void {
  if (!db) return
  try { db.prepare('UPDATE skills SET hits=hits+1 WHERE name=?').run(name) } catch { /* 忽略 */ }
}

export function listSkillsStats(): SkillHitRow[] {
  if (!db) return []
  try {
    const rows = db.prepare('SELECT name, description, hits FROM skills ORDER BY hits DESC LIMIT 200').all() as { name: string; description: string; hits: number }[]
    return rows.map(r => ({ name: r.name, description: String(r.description || ''), hits: Number(r.hits || 0) }))
  } catch { return [] }
}

export interface SkillStatRow { name: string; hit: number; trigger: number; ok: number; triggerRate: number; okRate: number }
// v0.4.3 命中统计: 按日聚合(service 0.7.0 评估数据源)。统计只增不改历史。
export function recordSkillStat(name: string, field: 'hit' | 'trigger' | 'ok'): void {
  if (!db) return
  try {
    const d = new Date()
    const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const col = field === 'trigger' ? 'trigger' : field === 'ok' ? 'ok' : 'hit'
    db.prepare(`INSERT INTO skill_stats(name, ts, ${col}) VALUES(?, ?, 1) ON CONFLICT(name, ts) DO UPDATE SET ${col}=${col}+1`).run(name, ts)
  } catch { /* 忽略 */ }
}
export function skillStats(days = 30): SkillStatRow[] {
  if (!db) return []
  try {
    const cutoff = Date.now() - Number(days) * 86400 * 1000
    const rows = db.prepare('SELECT name, SUM(hit) AS hit, SUM(trigger) AS trigger, SUM(ok) AS ok FROM skill_stats WHERE ts>=? GROUP BY name ORDER BY hit DESC').all(cutoff) as { name: string; hit: number; trigger: number; ok: number }[]
    return rows.map(r => {
      const hit = Number(r.hit || 0); const trigger = Number(r.trigger || 0); const ok = Number(r.ok || 0)
      return { name: String(r.name || ''), hit, trigger, ok, triggerRate: hit ? trigger / hit : 0, okRate: hit ? ok / hit : 0 }
    })
  } catch { return [] }
}

// ─── 会话元数据 ─────────────────────────────────────
export function upsertSessionMeta(row: SessionMetaRow): void {
  if (!db) return
  try {
    db.prepare('INSERT INTO sessions(sid, agent, title, state_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(sid) DO UPDATE SET agent=excluded.agent, title=excluded.title, state_json=excluded.state_json, updated_at=excluded.updated_at')
      .run(row.sid, row.agent ?? null, row.title ?? null, row.stateJson ?? null, row.createdAt ?? Date.now(), row.updatedAt ?? Date.now())
  } catch { /* 忽略 */ }
}

export function getSessionMeta(sid: string): SessionMetaRow | null {
  if (!db) return null
  try {
    const r = db.prepare('SELECT sid, agent, title, state_json, created_at, updated_at FROM sessions WHERE sid=?').get(sid) as Record<string, unknown> | undefined
    if (!r) return null
    return { sid: String(r.sid), agent: r.agent ? String(r.agent) : null, title: r.title ? String(r.title) : null, stateJson: r.state_json ? String(r.state_json) : null, createdAt: Number(r.created_at || 0), updatedAt: Number(r.updated_at || 0) }
  } catch { return null }
}

export function listSessionMetas(): SessionMetaRow[] {
  if (!db) return []
  try {
    const rows = db.prepare('SELECT sid, agent, title, state_json, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 1000').all() as Record<string, unknown>[]
    return rows.map(r => ({ sid: String(r.sid), agent: r.agent ? String(r.agent) : null, title: r.title ? String(r.title) : null, stateJson: r.state_json ? String(r.state_json) : null, createdAt: Number(r.created_at || 0), updatedAt: Number(r.updated_at || 0) }))
  } catch { return [] }
}

// ─── 保留期清理与数据库维护 ─────────────────────────
// side-channel 与审计是纯追加表: 不设保留期会随使用无限增长, 每日维护时按时间+条数双上限清理。
export function pruneToolOutputs(olderThanMs: number, keepMax = 10000): number {
  if (!db) return 0
  try {
    const cutoff = Date.now() - olderThanMs
    let removed = Number((db.prepare('DELETE FROM tool_outputs WHERE ts < ?').run(cutoff) as { changes: number }).changes)
    const row = db.prepare('SELECT COUNT(*) AS c FROM tool_outputs').get() as { c?: number } | undefined
    const over = Math.max(0, Number(row?.c || 0) - keepMax)
    if (over > 0) {
      removed += Number((db.prepare('DELETE FROM tool_outputs WHERE id IN (SELECT id FROM tool_outputs ORDER BY ts ASC LIMIT ?)').run(over) as { changes: number }).changes)
    }
    return removed
  } catch { return 0 }
}

export function pruneAudit(olderThanMs: number, keepMax = 50000): number {
  if (!db) return 0
  try {
    const cutoff = Date.now() - olderThanMs
    let removed = Number((db.prepare('DELETE FROM audit WHERE ts < ?').run(cutoff) as { changes: number }).changes)
    const row = db.prepare('SELECT COUNT(*) AS c FROM audit').get() as { c?: number } | undefined
    const over = Math.max(0, Number(row?.c || 0) - keepMax)
    if (over > 0) {
      removed += Number((db.prepare('DELETE FROM audit WHERE id IN (SELECT id FROM audit ORDER BY ts ASC LIMIT ?)').run(over) as { changes: number }).changes)
    }
    return removed
  } catch { return 0 }
}

// 会话全文索引(搜索缓存)按时间 + 总量双重上限清理(它只在删会话时按 sid 删, 此前无增长治理)
export function pruneSessionChunks(olderThanMs: number, keepMax = 50000): number {
  if (!db) return 0
  try {
    const cutoff = Date.now() - olderThanMs
    const delFts = db.prepare("INSERT INTO session_chunks_fts(session_chunks_fts, rowid, snippet) VALUES('delete', ?, ?)")
    const del = db.prepare('DELETE FROM session_chunks WHERE rowid=?')
    let removed = 0
    db.exec('BEGIN')
    try {
      const old = db.prepare('SELECT rowid, snippet FROM session_chunks WHERE ts < ?').all(cutoff) as { rowid: number; snippet: string }[]
      for (const r of old) { try { delFts.run(r.rowid, r.snippet) } catch { /* 忽略 */ } try { del.run(r.rowid) } catch { /* 忽略 */ } removed++ }
      const row = db.prepare('SELECT COUNT(*) AS c FROM session_chunks').get() as { c?: number } | undefined
      const over = Math.max(0, Number(row?.c || 0) - keepMax)
      if (over > 0) {
        const rows = db.prepare('SELECT rowid, snippet FROM session_chunks ORDER BY ts ASC LIMIT ?').all(over) as { rowid: number; snippet: string }[]
        for (const r of rows) { try { delFts.run(r.rowid, r.snippet) } catch { /* 忽略 */ } try { del.run(r.rowid) } catch { /* 忽略 */ } removed++ }
      }
      db.exec('COMMIT')
    } catch (e) { try { db.exec('ROLLBACK') } catch { /* 忽略 */ } throw e }
    return removed
  } catch { return 0 }
}

export function optimizeDb(): void {
  if (!db) return
  try { db.exec('PRAGMA optimize') } catch { /* 忽略 */ }
}

export function checkpointDb(): void {
  if (!db) return
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* 忽略 */ }
}

export function vacuumDb(): void {
  if (!db) return
  try { db.exec('VACUUM') } catch { /* 忽略 */ }
}
