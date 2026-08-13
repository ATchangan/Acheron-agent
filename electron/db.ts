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

export interface MemoryRow {
  id?: number
  agent: string
  scope: 'global' | 'private'
  level: 'normal' | 'important' | 'pinned'
  layer: 'L0' | 'L1' | 'L2' | 'L3'
  content: string
  subject: string | null
  relation: string | null
  object: string | null
  embedding?: number[] | null
  sourceId?: number | null
  ts: number
  lastAccess: number
  accessCount: number
  superseded: 0 | 1
  confidence: number
}

export interface AuditRow {
  ts: number
  agent?: string | null
  tool?: string | null
  argsSummary?: string | null
  resultSummary?: string | null
  durationMs?: number | null
  tokens?: number | null
}

export interface AuditFilter { agent?: string; tool?: string; from?: number; to?: number; limit?: number }

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
  try { db?.close() } catch { /* 忽略 */ }
  db = null
}

// ─── 记忆 ───────────────────────────────────────────
const MEMORY_COLS = 'id, agent, scope, level, layer, content, subject, relation, object, embedding, source_id, ts, last_access, access_count, superseded, confidence'

function rowToMemory(r: Record<string, unknown>): MemoryRow {
  let embedding: number[] | null = null
  try { if (typeof r.embedding === 'string' && r.embedding) embedding = JSON.parse(r.embedding) as number[] } catch { /* 坏向量忽略 */ }
  const levelRaw = String(r.level || 'normal')
  const layerRaw = String(r.layer || 'L1')
  return {
    id: Number(r.id),
    agent: String(r.agent || '黄泉'),
    scope: (r.scope === 'private' ? 'private' : 'global') as 'global' | 'private',
    level: (levelRaw === 'important' || levelRaw === 'pinned' ? levelRaw : 'normal') as 'normal' | 'important' | 'pinned',
    layer: (layerRaw === 'L0' || layerRaw === 'L2' || layerRaw === 'L3' ? layerRaw : 'L1') as 'L0' | 'L1' | 'L2' | 'L3',
    content: String(r.content || ''),
    subject: r.subject ? String(r.subject) : null,
    relation: r.relation ? String(r.relation) : null,
    object: r.object ? String(r.object) : null,
    embedding,
    sourceId: r.source_id ? Number(r.source_id) : null,
    ts: Number(r.ts || 0),
    lastAccess: Number(r.last_access || 0),
    accessCount: Number(r.access_count || 0),
    superseded: r.superseded === 1 ? 1 : 0,
    confidence: Number(r.confidence || 1),
  }
}

export function insertMemory(m: MemoryRow): number {
  if (!db) return 0
  try {
    const r = db.prepare(`INSERT INTO memories(agent, scope, level, layer, content, subject, relation, object, embedding, source_id, ts, last_access, access_count, superseded, confidence)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(m.agent, m.scope, m.level, m.layer, m.content, m.subject, m.relation, m.object,
        m.embedding && m.embedding.length ? JSON.stringify(m.embedding) : null, m.sourceId ?? null,
        m.ts, m.lastAccess, m.accessCount, m.superseded, m.confidence)
    return lastId(r)
  } catch { return 0 }
}

export function setMemoryEmbedding(id: number, vec: number[]): void {
  if (!db || !vec?.length) return
  try { db.prepare('UPDATE memories SET embedding=? WHERE id=?').run(JSON.stringify(vec), id) } catch { /* 忽略 */ }
}

export function updateMemoryAccess(id: number): void {
  if (!db) return
  try {
    db.prepare('UPDATE memories SET last_access=?, access_count=access_count+1 WHERE id=?').run(Date.now(), id)
  } catch { /* 忽略 */ }
}

export function softDeleteMemory(id: number): void {
  if (!db) return
  try { db.prepare('UPDATE memories SET superseded=1 WHERE id=?').run(id) } catch { /* 忽略 */ }
}

export function markSuperseded(id: number): void {
  if (!db) return
  try { db.prepare('UPDATE memories SET superseded=1 WHERE id=?').run(id) } catch { /* 忽略 */ }
}

export function bumpConfidence(id: number): void {
  if (!db) return
  try { db.prepare('UPDATE memories SET confidence=confidence+1 WHERE id=?').run(id) } catch { /* 忽略 */ }
}

export function setConfidenceValue(id: number, confidence: number): void {
  if (!db) return
  try { db.prepare('UPDATE memories SET confidence=? WHERE id=?').run(Math.max(1, confidence), id) } catch { /* 忽略 */ }
}

export function getMemoryById(id: number): MemoryRow | null {
  if (!db) return null
  try {
    const r = db.prepare('SELECT ' + MEMORY_COLS + ' FROM memories WHERE id=?').get(id) as Record<string, unknown> | undefined
    return r ? rowToMemory(r) : null
  } catch { return null }
}

export function listMemories(filter?: { agent?: string; scope?: 'global' | 'private'; layer?: string; includeSuperseded?: boolean; limit?: number }): MemoryRow[] {
  if (!db) return []
  try {
    const conds: string[] = []
    const args: unknown[] = []
    if (filter?.agent) { conds.push('agent=?'); args.push(filter.agent) }
    if (filter?.scope) { conds.push('scope=?'); args.push(filter.scope) }
    if (filter?.layer) { conds.push('layer=?'); args.push(filter.layer) }
    if (!filter?.includeSuperseded) conds.push('superseded=0')
    const where = conds.length ? ' WHERE ' + conds.join(' AND ') : ''
    const rows = db.prepare('SELECT ' + MEMORY_COLS + ' FROM memories' + where + ' ORDER BY ts DESC LIMIT ?').all(...args, Math.max(1, Math.min(2000, Number(filter?.limit) || 1000))) as Record<string, unknown>[]
    return rows.map(rowToMemory)
  } catch { return [] }
}

export function getMemoriesForDecay(): MemoryRow[] {
  return listMemories({ includeSuperseded: false, limit: 2000 })
}

// FTS5 trigram 关键词检索(≥3 字符走 MATCH+BM25; 2 字符走 LIKE 前缀兜底)
export function searchFts(query: string, limit = 20): { id: number; score: number; content: string }[] {
  if (!db || !query) return []
  const q = String(query).trim()
  try {
    if (q.length >= 3) {
      const safe = q.replace(/["*:()^\-+]/g, ' ').replace(/\s+/g, ' ').trim()
      if (safe) {
        const rows = db.prepare('SELECT rowid, bm25(memories_fts) AS score FROM memories_fts WHERE memories_fts MATCH ? ORDER BY score LIMIT ?').all(safe, limit) as { rowid: number; score: number }[]
        const out: { id: number; score: number; content: string }[] = []
        for (const r of rows) {
          const m = getMemoryById(r.rowid)
          if (m && !m.superseded) out.push({ id: m.id as number, score: Math.abs(Number(r.score) || 0), content: m.content })
        }
        return out
      }
    }
    const rows = db.prepare('SELECT id, content FROM memories WHERE superseded=0 AND content LIKE ? ORDER BY ts DESC LIMIT ?').all('%' + q + '%', limit) as { id: number; content: string }[]
    return rows.map(r => ({ id: r.id, score: 0.5, content: r.content }))
  } catch { return [] }
}

// 向量余弦检索: 对库内已存 embedding 逐条计算(记忆量级 ≤2000, 内存内计算足够快)
export function searchVector(queryVec: number[], limit = 20): { id: number; score: number; content: string }[] {
  if (!db || !Array.isArray(queryVec) || queryVec.length === 0) return []
  try {
    const rows = db.prepare('SELECT id, content, embedding FROM memories WHERE superseded=0 AND embedding IS NOT NULL').all() as { id: number; content: string; embedding: string }[]
    const scored: { id: number; score: number; content: string }[] = []
    for (const r of rows) {
      try {
        const vec = JSON.parse(r.embedding) as number[]
        if (!Array.isArray(vec) || vec.length !== queryVec.length) continue
        let dot = 0
        let na = 0
        let nb = 0
        for (let i = 0; i < vec.length; i++) { dot += vec[i] * queryVec[i]; na += vec[i] * vec[i]; nb += queryVec[i] * queryVec[i] }
        if (na === 0 || nb === 0) continue
        const score = dot / (Math.sqrt(na) * Math.sqrt(nb))
        if (score > 0.0001) scored.push({ id: r.id, score, content: r.content })
      } catch { /* 坏向量跳过 */ }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit)
  } catch { return [] }
}

// 溯源链: 沿 source_id 向下钻取 L3→L2→L1→L0
export function traceSourceChain(id: number): MemoryRow[] {
  const chain: MemoryRow[] = []
  const seen = new Set<number>()
  let cur: MemoryRow | null = getMemoryById(id)
  while (cur && !seen.has(cur.id as number)) {
    seen.add(cur.id as number)
    chain.push(cur)
    cur = cur.sourceId ? getMemoryById(cur.sourceId) : null
  }
  return chain
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
    db.prepare('INSERT INTO audit(ts, agent, tool, args_summary, result_summary, duration_ms, tokens) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(a.ts || Date.now(), a.agent ?? null, a.tool ?? null, a.argsSummary ?? null, a.resultSummary ?? null, a.durationMs ?? null, a.tokens ?? null)
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
}

export function queryAudit(filter: AuditFilter = {}): AuditResult[] {
  if (!db) return []
  try {
    const conds: string[] = []
    const args: unknown[] = []
    if (filter.agent) { conds.push('agent=?'); args.push(filter.agent) }
    if (filter.tool) { conds.push('tool=?'); args.push(filter.tool) }
    if (filter.from) { conds.push('ts>=?'); args.push(filter.from) }
    if (filter.to) { conds.push('ts<=?'); args.push(filter.to) }
    const where = conds.length ? ' WHERE ' + conds.join(' AND ') : ''
    const rows = db.prepare('SELECT id, ts, agent, tool, args_summary, result_summary, duration_ms, tokens FROM audit' + where + ' ORDER BY ts DESC LIMIT ?')
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
    }))
  } catch { return [] }
}

// ─── 会话索引(供 session_search FTS 后端) ───────────
export function replaceSessionIndex(chunks: { sid: string; role: string; snippet: string; ts: number }[]): void {
  if (!db) return
  try {
    db.exec('DELETE FROM session_chunks')
    db.exec("INSERT INTO session_chunks_fts(session_chunks_fts) VALUES('delete-all')")
    const insChunk = db.prepare('INSERT INTO session_chunks(sid, role, snippet, ts) VALUES(?, ?, ?, ?)')
    const insFts = db.prepare('INSERT INTO session_chunks_fts(rowid, snippet) VALUES(?, ?)')
    for (const c of chunks.slice(0, 5000)) {
      const r = insChunk.run(c.sid, c.role, c.snippet.slice(0, 1200), c.ts)
      insFts.run(lastId(r), c.snippet.slice(0, 1200))
    }
  } catch { /* 索引失败不影响会话功能 */ }
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

// legacy 导入标记(供 migrate-legacy 使用, 避免每次启动重复导入)
export function isLegacyImported(): boolean { return getMeta('legacy_imported') === '1' }
export function markLegacyImported(): void { setMeta('legacy_imported', '1') }
