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

// 向量缓存: 避免每次检索都 JSON.parse 全库 embedding, 并预存模长。
// 记忆量级 ≤2000 时内积检索足够快; 缓存把重复解析成本降为一次, 量再大再考虑 sqlite-vec/ANN。
interface VecCore { vec: Float32Array; norm: number }
interface VecEntry extends VecCore { agent: string; scope: 'global' | 'private' }
const vectorCache = new Map<number, VecEntry>()
let vectorCacheLoaded = false
const VECTOR_CACHE_MAX = 5000

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
  vectorCache.clear()
  vectorCacheLoaded = false
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
  vectorCache.clear()
  vectorCacheLoaded = false
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
    agent: String(r.agent || '助手'),
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
    const id = lastId(r)
    if (m.embedding && m.embedding.length) vectorCacheLoaded = false // 新向量下次检索时补进缓存
    return id
  } catch { return 0 }
}

export function setMemoryEmbedding(id: number, vec: number[]): void {
  if (!db || !vec?.length) return
  try { db.prepare('UPDATE memories SET embedding=? WHERE id=?').run(JSON.stringify(vec), id) } catch { /* 忽略 */ }
  vectorCache.delete(id)
  vectorCacheLoaded = false
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
  vectorCache.delete(id)
}

export function markSuperseded(id: number): void {
  if (!db) return
  try { db.prepare('UPDATE memories SET superseded=1 WHERE id=?').run(id) } catch { /* 忽略 */ }
  vectorCache.delete(id)
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
    const rows = db.prepare('SELECT ' + MEMORY_COLS + ' FROM memories' + where + ' ORDER BY ts DESC, id DESC LIMIT ?').all(...args, Math.max(1, Math.min(2000, Number(filter?.limit) || 1000))) as Record<string, unknown>[]
    return rows.map(rowToMemory)
  } catch { return [] }
}

export function getMemoriesForDecay(): MemoryRow[] {
  return listMemories({ includeSuperseded: false, limit: 2000 })
}

// FTS5 trigram 关键词检索(≥3 字符走 MATCH+BM25; 2 字符走 LIKE 前缀兜底)
export function searchFts(query: string, limit = 20, filter?: { agent?: string; scope?: 'global' | 'private' }): { id: number; score: number; content: string }[] {
  if (!db || !query) return []
  const q = String(query).trim()
  try {
    if (q.length >= 3) {
      const safe = q.replace(/["*:()^\-+]/g, ' ').replace(/\s+/g, ' ').trim()
      if (safe) {
        const conds = ['memories_fts MATCH ?']
        const args: unknown[] = [safe]
        if (filter?.agent) { conds.push('m.agent=?'); args.push(filter.agent) }
        if (filter?.scope) { conds.push('m.scope=?'); args.push(filter.scope) }
        const rows = db.prepare(`SELECT f.rowid, bm25(memories_fts) AS score FROM memories_fts f JOIN memories m ON m.id=f.rowid WHERE ${conds.join(' AND ')} AND m.superseded=0 ORDER BY score LIMIT ?`).all(...args, limit) as { rowid: number; score: number }[]
        const out: { id: number; score: number; content: string }[] = []
        for (const r of rows) {
          const m = getMemoryById(r.rowid)
          if (m && !m.superseded) out.push({ id: m.id as number, score: Math.abs(Number(r.score) || 0), content: m.content })
        }
        return out
      }
    }
    const conds = ['superseded=0', 'content LIKE ?']
    const args: unknown[] = ['%' + q + '%']
    if (filter?.agent) { conds.push('agent=?'); args.push(filter.agent) }
    if (filter?.scope) { conds.push('scope=?'); args.push(filter.scope) }
    const rows = db.prepare('SELECT id, content FROM memories WHERE ' + conds.join(' AND ') + ' ORDER BY ts DESC LIMIT ?').all(...args, limit) as { id: number; content: string }[]
    return rows.map(r => ({ id: r.id, score: 0.5, content: r.content }))
  } catch { return [] }
}

function parseVec(text: unknown): VecCore | null {
  if (typeof text !== 'string' || !text) return null
  try {
    const arr = JSON.parse(text) as unknown
    if (!Array.isArray(arr) || !arr.length) return null
    const vec = new Float32Array(arr.length)
    let norm = 0
    for (let i = 0; i < arr.length; i++) {
      const v = Number(arr[i])
      if (!Number.isFinite(v)) return null
      vec[i] = v
      norm += v * v
    }
    norm = Math.sqrt(norm)
    if (norm === 0) return null
    return { vec, norm }
  } catch { return null }
}

function ensureVectorCache(): void {
  if (!db || vectorCacheLoaded) return
  try {
    const rows = db.prepare('SELECT id, agent, scope, embedding FROM memories WHERE superseded=0 AND embedding IS NOT NULL').all() as { id: number; agent: string; scope: string; embedding: string }[]
    for (const r of rows) {
      if (vectorCache.has(r.id)) continue
      const e = parseVec(r.embedding)
      if (e) vectorCache.set(r.id, { ...e, agent: String(r.agent || '助手'), scope: r.scope === 'private' ? 'private' : 'global' })
    }
  } catch { /* 缓存加载失败时本函数仍标记完成, 检索端返回空避免误报 */ }
  vectorCacheLoaded = true
  while (vectorCache.size > VECTOR_CACHE_MAX) {
    const oldest = vectorCache.keys().next().value as number | undefined
    if (oldest === undefined) break
    vectorCache.delete(oldest)
  }
}

// 向量余弦检索: embedding 解析一次后缓存在内存(含预存模长), 每次查询只做 O(n) 内积
export function searchVector(queryVec: number[], limit = 20, filter?: { agent?: string; scope?: 'global' | 'private' }): { id: number; score: number; content: string }[] {
  if (!db || !Array.isArray(queryVec) || queryVec.length === 0) return []
  ensureVectorCache()
  let qNorm = 0
  for (let i = 0; i < queryVec.length; i++) {
    const v = Number(queryVec[i])
    if (!Number.isFinite(v)) return []
    qNorm += v * v
  }
  qNorm = Math.sqrt(qNorm)
  if (qNorm === 0) return []
  const scored: { id: number; score: number }[] = []
  for (const [id, e] of vectorCache) {
    if (filter?.agent && e.agent !== filter.agent) continue
    if (filter?.scope && e.scope !== filter.scope) continue
    if (e.vec.length !== queryVec.length) continue
    let dot = 0
    for (let i = 0; i < e.vec.length; i++) dot += e.vec[i] * Number(queryVec[i])
    const score = dot / (e.norm * qNorm)
    if (score > 0.0001) scored.push({ id, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const take = Math.max(1, Math.min(200, Number(limit) || 20))
  const out: { id: number; score: number; content: string }[] = []
  for (const s of scored.slice(0, take)) {
    const m = getMemoryById(s.id)
    if (m && !m.superseded) out.push({ id: s.id, score: s.score, content: m.content })
  }
  return out
}

// 溯源链: 递归 CTE 一次取整条 L3→L2→L1→L0, 替代逐层 getMemoryById 的 N+1 查询
export function traceSourceChain(id: number): MemoryRow[] {
  if (!db) return []
  try {
    const rows = db.prepare(`
      WITH RECURSIVE chain(id, depth) AS (
        SELECT ?, 0
        UNION ALL
        SELECT m.source_id, chain.depth + 1
        FROM memories m JOIN chain ON m.id = chain.id
        WHERE m.source_id IS NOT NULL AND chain.depth < 100
      )
      SELECT m.id, m.agent, m.scope, m.level, m.layer, m.content, m.subject, m.relation, m.object,
             m.embedding, m.source_id, m.ts, m.last_access, m.access_count, m.superseded, m.confidence
      FROM chain JOIN memories m ON m.id = chain.id
    `).all(id) as Record<string, unknown>[]
    const out: MemoryRow[] = []
    const seen = new Set<number>()
    for (const r of rows) {
      const m = rowToMemory(r)
      if (seen.has(m.id as number)) continue
      seen.add(m.id as number)
      out.push(m)
    }
    return out
  } catch { return [] }
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

// ─── 教训 / 目标 / 情景(0.4.0 定稿: 从 memory.json 并入 SQLite) ─────────
export interface LessonRow { id: number; content: string; ts: number }
export interface GoalRow { goal: string; status: string; created: number; updated: number }
export interface EpisodicRow { op: string; path: string; status: string; ts: number }

export function listLessons(agent: string, scope: 'global' | 'private', limit = 50): LessonRow[] {
  if (!db) return []
  try {
    const rows = db.prepare('SELECT id, content, ts FROM lessons WHERE agent=? AND scope=? ORDER BY ts DESC LIMIT ?').all(agent, scope, Math.max(1, Math.min(500, limit))) as Record<string, unknown>[]
    return rows.map(r => ({ id: Number(r.id), content: String(r.content || ''), ts: Number(r.ts || 0) }))
  } catch { return [] }
}

export function insertLesson(agent: string, scope: 'global' | 'private', content: string, ts = Date.now()): boolean {
  if (!db || !content) return false
  try {
    const existing = db.prepare('SELECT id FROM lessons WHERE agent=? AND scope=? AND content=?').get(agent, scope, content)
    if (existing) return false
    db.prepare('INSERT INTO lessons(agent, scope, content, ts) VALUES(?, ?, ?, ?)').run(agent, scope, content.slice(0, 500), ts)
    return true
  } catch { return false }
}

export function deleteLessonByContent(agent: string, scope: 'global' | 'private', content: string): void {
  if (!db) return
  try { db.prepare('DELETE FROM lessons WHERE agent=? AND scope=? AND content=?').run(agent, scope, content) } catch { /* 忽略 */ }
}

export function listGoals(agent: string, scope: 'global' | 'private'): GoalRow[] {
  if (!db) return []
  try {
    const rows = db.prepare('SELECT goal, status, created, updated FROM goals WHERE agent=? AND scope=? ORDER BY updated DESC LIMIT 500').all(agent, scope) as Record<string, unknown>[]
    return rows.map(r => ({ goal: String(r.goal || ''), status: String(r.status || 'open'), created: Number(r.created || 0), updated: Number(r.updated || 0) }))
  } catch { return [] }
}

export function replaceGoals(agent: string, scope: 'global' | 'private', goals: GoalRow[]): void {
  if (!db) return
  try {
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM goals WHERE agent=? AND scope=?').run(agent, scope)
      const ins = db.prepare('INSERT INTO goals(agent, scope, goal, status, created, updated) VALUES(?, ?, ?, ?, ?, ?)')
      for (const g of goals.slice(0, 500)) {
        ins.run(agent, scope, String(g.goal || '').slice(0, 1000), String(g.status || 'open').slice(0, 40), Number(g.created || Date.now()), Number(g.updated || Date.now()))
      }
      db.exec('COMMIT')
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
      throw e
    }
  } catch { /* 忽略 */ }
}

export function insertEpisodic(agent: string, scope: 'global' | 'private', e: { op: string; path: string; status: string }, ts = Date.now()): void {
  if (!db) return
  try { db.prepare('INSERT INTO episodic(agent, scope, op, path, status, ts) VALUES(?, ?, ?, ?, ?, ?)').run(agent, scope, String(e.op || '').slice(0, 80), String(e.path || '').slice(0, 500), String(e.status || '').slice(0, 40), ts) } catch { /* 忽略 */ }
}

export function listEpisodic(agent: string, scope: 'global' | 'private', limit = 20): EpisodicRow[] {
  if (!db) return []
  try {
    const rows = db.prepare('SELECT op, path, status, ts FROM episodic WHERE agent=? AND scope=? ORDER BY ts DESC LIMIT ?').all(agent, scope, Math.max(1, Math.min(1000, limit))) as Record<string, unknown>[]
    return rows.map(r => ({ op: String(r.op || ''), path: String(r.path || ''), status: String(r.status || ''), ts: Number(r.ts || 0) }))
  } catch { return [] }
}

export function setMemoryLevel(id: number, level: 'normal' | 'important' | 'pinned'): void {
  if (!db) return
  try { db.prepare('UPDATE memories SET level=? WHERE id=?').run(level, id) } catch { /* 忽略 */ }
}

// legacy 导入标记(供 migrate-legacy 使用, 避免每次启动重复导入)
export function isLegacyImported(): boolean { return getMeta('legacy_imported') === '1' }
export function markLegacyImported(): void { setMeta('legacy_imported', '1') }

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
