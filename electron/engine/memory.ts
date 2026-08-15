// electron/engine/memory.ts — 记忆访问统一入口(v0.4.0 定稿)
// SQLite 为主存储(facts/pinned/summaries/lessons/goals/episodic 全部落库), 建库失败自动回退 JSON。
import * as fs from 'fs'
import { dirname, join } from 'path'
import { writeFileAtomic } from '../fs-atomic'
import { scoreOverlap, scanMemoryText, normalizeMemory } from '../shared/memory-utils'
import {
  getDb, listMemories, insertMemory, softDeleteMemory, setMemoryLevel,
  listLessons, insertLesson, deleteLessonByContent,
  listGoals, replaceGoals, listEpisodic, insertEpisodic,
  searchFts, searchVector, type MemoryRow,
} from '../db'
import { parseFact, storeFact } from '../memory/facts'
import { embedText } from '../memory/embeddings'
import { rrfFuse, type FusedHit } from '../memory/searcher'
export { scanMemoryText }

export interface EngineMemory {
  facts: string[]
  summaries: { content: string; timestamp: number }[]
  pinnedFacts?: string[]
  episodic?: { op: string; path: string; status: string; ts: number }[]
  goals?: { goal: string; status: string; steps?: unknown[]; created?: number }[]
  lessons?: { content: string; ts: number }[]
}

const PINNED_CAP = 10
const FACTS_CAP = 500
const SUMMARIES_CAP = 200
const LESSONS_CAP = 50
const MEMORY_DEFAULT_MAX = 6000

export interface MemoryScopeOpts { agent?: string; scope?: 'global' | 'private' }

function resolveOpts(memoryPath: string, opts?: MemoryScopeOpts): { agent: string; scope: 'global' | 'private' } {
  const base = memoryPath.split(/[\\/]/).pop() || ''
  const priv = /^memory-(.+)\.json$/.exec(base)
  if (opts?.scope) return { agent: String(opts.agent || '黄泉'), scope: opts.scope }
  if (priv) return { agent: priv[1], scope: 'private' }
  return { agent: String(opts?.agent || '黄泉'), scope: opts?.scope || 'global' }
}

export function loadMemory(memoryPath: string, opts?: MemoryScopeOpts): EngineMemory {
  const { agent, scope } = resolveOpts(memoryPath, opts)
  if (getDb()) {
    try {
      // 列表均按 ts DESC 返回; JSON 旧语义是"旧在前新在后", 统一反转为旧→新以兼容内存块选取逻辑
      const facts = listMemories({ agent, scope, layer: 'L1', includeSuperseded: false, limit: FACTS_CAP })
        .filter(m => m.level !== 'pinned').map(m => m.content).reverse()
      const pinned = listMemories({ agent, scope, includeSuperseded: false, limit: 2000 })
        .filter(m => m.level === 'pinned').map(m => m.content)
        .filter((v, i, a) => a.indexOf(v) === i).reverse().slice(-PINNED_CAP)
      const summaries = listMemories({ agent, scope, layer: 'L3', includeSuperseded: false, limit: SUMMARIES_CAP })
        .filter(m => m.level !== 'pinned').map(m => ({ content: m.content, timestamp: m.ts })).reverse()
      const lessons = listLessons(agent, scope, LESSONS_CAP).map(l => ({ content: l.content, ts: l.ts }))
      const goals = listGoals(agent, scope).map(g => ({ goal: g.goal, status: g.status, created: g.created }))
      const episodic = listEpisodic(agent, scope, 100).reverse().map(e => ({ op: e.op, path: e.path, status: e.status, ts: e.ts }))
      return { facts, summaries, pinnedFacts: pinned, episodic, goals, lessons }
    } catch { /* db 读取失败回退 JSON */ }
  }
  try {
    if (fs.existsSync(memoryPath)) {
      const d = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'))
      return {
        facts: Array.isArray(d.facts) ? d.facts : [],
        summaries: Array.isArray(d.summaries) ? d.summaries : [],
        pinnedFacts: Array.isArray(d.pinnedFacts) ? d.pinnedFacts : [],
        episodic: Array.isArray(d.episodic) ? d.episodic : [],
        goals: Array.isArray(d.goals) ? d.goals : [],
        lessons: Array.isArray(d.lessons) ? d.lessons : [],
      }
    }
  } catch { /* 损坏则重置 */ }
  return { facts: [], summaries: [], pinnedFacts: [], episodic: [], goals: [], lessons: [] }
}

// 事实落库: 精确去重置信度累计、同主谓冲突旧行淘汰; pinned 额外生成 L3 置顶副本(与旧 save_memory 行为一致)
export function upsertFactDb(agent: string, scope: 'global' | 'private', content: string, pinned: boolean, sourceText?: string): number {
  if (!getDb()) return 0
  try {
    const fact = content.slice(0, 1000)
    const now = Date.now()
    const triple = parseFact(fact)
    let sourceId: number | null = null
    if (sourceText) {
      sourceId = insertMemory({
        agent, scope, level: 'normal', layer: 'L0', content: String(sourceText).slice(0, 2000),
        subject: null, relation: null, object: null, embedding: null, sourceId: null,
        ts: now, lastAccess: now, accessCount: 0, superseded: 0, confidence: 1,
      }) || null
    }
    const l1: MemoryRow = {
      agent, scope, level: pinned ? 'pinned' : 'normal', layer: 'L1', content: fact,
      subject: triple.subject, relation: triple.relation, object: triple.object, embedding: null,
      sourceId, ts: now, lastAccess: now, accessCount: 0, superseded: 0, confidence: 1,
    }
    const stored = triple.subject ? storeFact(l1) : { action: 'new' as const, id: insertMemory(l1) }
    if (stored.id > 0 && pinned) {
      setMemoryLevel(stored.id, 'pinned')
      const hasCopy = listMemories({ agent, scope, layer: 'L3', includeSuperseded: false, limit: 2000 })
        .some(x => x.level === 'pinned' && x.content === fact)
      if (!hasCopy) insertMemory({ ...l1, layer: 'L3', sourceId: stored.id, level: 'pinned' })
    }
    return stored.id
  } catch { return 0 }
}

function reconcileFacts(agent: string, scope: 'global' | 'private', facts: string[], pinnedFacts: string[]): void {
  const cur = listMemories({ agent, scope, layer: 'L1', includeSuperseded: false, limit: 2000 })
  const curNorm = cur.filter(m => m.level !== 'pinned')
  const normSet = new Set(curNorm.map(m => m.content))
  for (const f of facts) if (!normSet.has(f)) upsertFactDb(agent, scope, f, false)
  for (const c of curNorm) if (!facts.includes(c.content)) softDeleteMemory(c.id as number)
  const curPin = cur.filter(m => m.level === 'pinned')
  const pinSet = new Set(curPin.map(m => m.content))
  for (const p of pinnedFacts) if (!pinSet.has(p)) upsertFactDb(agent, scope, p, true)
  const all = listMemories({ agent, scope, includeSuperseded: false, limit: 2000 })
  for (const c of curPin) {
    if (pinnedFacts.includes(c.content)) continue
    for (const row of all.filter(m => m.level === 'pinned' && m.content === c.content)) softDeleteMemory(row.id as number)
  }
}

function reconcileSummaries(agent: string, scope: 'global' | 'private', summaries: { content: string; timestamp: number }[]): void {
  const cur = listMemories({ agent, scope, layer: 'L3', includeSuperseded: false, limit: 2000 }).filter(m => m.level !== 'pinned')
  const set = new Set(cur.map(m => m.content))
  const now = Date.now()
  for (const s of summaries) {
    if (set.has(s.content)) continue
    insertMemory({
      agent, scope, level: 'normal', layer: 'L3', content: String(s.content || '').slice(0, 1000),
      subject: null, relation: null, object: null, embedding: null, sourceId: null,
      ts: Number(s.timestamp || now), lastAccess: now, accessCount: 0, superseded: 0, confidence: 1,
    })
  }
  for (const c of cur) if (!summaries.some(s => s.content === c.content)) softDeleteMemory(c.id as number)
}

function reconcileLessons(agent: string, scope: 'global' | 'private', lessons: { content: string; ts: number }[]): void {
  const cur = listLessons(agent, scope, 500)
  const set = new Set(cur.map(l => l.content))
  for (const l of lessons) if (!set.has(l.content)) insertLesson(agent, scope, l.content, Number(l.ts || Date.now()))
  for (const c of cur) if (!lessons.some(l => l.content === c.content)) deleteLessonByContent(agent, scope, c.content)
}

export function saveMemory(memoryPath: string, m: EngineMemory, opts?: MemoryScopeOpts): boolean {
  const { agent, scope } = resolveOpts(memoryPath, opts)
  if (getDb()) {
    try {
      // 字段缺失时跳过对应 reconcile, 防止"只带部分字段的保存"误清库(如渲染层降级兜底对象)
      if (Array.isArray(m.facts) || Array.isArray(m.pinnedFacts)) {
        const cur = listMemories({ agent, scope, layer: 'L1', includeSuperseded: false, limit: 2000 })
        const curFacts = cur.filter(x => x.level !== 'pinned').map(x => x.content)
        const curPinned = [...new Set(cur.filter(x => x.level === 'pinned').map(x => x.content))]
        reconcileFacts(agent, scope, Array.isArray(m.facts) ? m.facts : curFacts, Array.isArray(m.pinnedFacts) ? m.pinnedFacts : curPinned)
      }
      if (Array.isArray(m.summaries)) reconcileSummaries(agent, scope, m.summaries)
      if (Array.isArray(m.lessons)) reconcileLessons(agent, scope, m.lessons)
      if (Array.isArray(m.goals)) {
        replaceGoals(agent, scope, m.goals.map(g => ({
          goal: String(g.goal || ''), status: String(g.status || 'open'),
          created: Number(g.created || Date.now()), updated: Date.now(),
        })))
      }
      if (Array.isArray(m.episodic)) {
        const existing = new Set(listEpisodic(agent, scope, 1000).map(e => e.op + '|' + e.path + '|' + e.ts))
        for (const e of m.episodic.slice(-100)) {
          const key = String(e.op) + '|' + String(e.path) + '|' + Number(e.ts || Date.now())
          if (!existing.has(key)) insertEpisodic(agent, scope, { op: String(e.op), path: String(e.path), status: String(e.status) }, Number(e.ts || Date.now()))
        }
      }
      return true
    } catch { /* 回退 JSON */ }
  }
  try { writeFileAtomic(memoryPath, JSON.stringify(normalizeMemory(m), null, 2)); return true } catch { return false }
}

// v0.3.9: 私有记忆命名空间(保留: JSON 降级路径与旧备份兼容; SQLite 主路径用 scope 列)
export function memoryPathFor(memoryPath: string, scope: string | undefined, agent: string | undefined): string {
  if (scope !== 'private' || !agent) return memoryPath
  const safe = String(agent).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'agent'
  return join(dirname(memoryPath), 'memory-' + safe + '.json')
}

// v0.3.9: 失败教训沉淀 —— 去重 + 容量上限(最新优先)
export function addLesson(mem: EngineMemory, content: string, max = LESSONS_CAP): boolean {
  const t = String(content || '').trim().slice(0, 500)
  if (!t) return false
  const list = mem.lessons || []
  if (list.some(x => x.content === t)) return false
  mem.lessons = [{ content: t, ts: Date.now() }, ...list].slice(0, max)
  return true
}

// 记忆注入块: 置顶全量 + 事实按相关度 Top5 + 摘要/教训按时效, 带容量头与预算护栏
export function memoryBlockText(mem: EngineMemory, userMsg?: string, opts: boolean | { trim?: boolean; maxChars?: number } = true): string {
  const o = typeof opts === 'boolean' ? { trim: opts } : opts
  const trim = o?.trim !== false
  const maxChars = Math.max(1200, Number(o?.maxChars) || MEMORY_DEFAULT_MAX)
  const pinned = mem.pinnedFacts || []
  const facts = mem.facts || []
  const summaries = mem.summaries || []
  const lessons = mem.lessons || []
  const parts: string[] = []
  const usageLine = '【记忆容量】置顶 ' + pinned.length + '/' + PINNED_CAP + ' · 事实 ' + facts.length + '/' + FACTS_CAP + ' · 摘要 ' + summaries.length + '/' + SUMMARIES_CAP + '（超出后按重要度与时效自动整理）'
  if (pinned.length) parts.push('## 置顶事实（重要，长期保留）\n' + pinned.slice(-PINNED_CAP).map((f, i) => `${i + 1}. ${String(f).slice(0, 300)}`).join('\n'))
  if (facts.length) {
    const q = trim && userMsg ? String(userMsg) : ''
    const scored = q
      ? [...facts].map(f => ({ f: String(f), s: scoreOverlap(String(f), q) })).sort((a, b) => b.s - a.s)
      : facts.map(String)
    const picked = typeof scored[0] === 'string' ? (scored as string[]).slice(-5) : (() => {
      const arr = scored as { f: string; s: number }[]
      const positive = arr.filter(x => x.s > 0)
      return (positive.length ? positive : arr.slice(-5)).slice(0, 5)
    })()
    parts.push('## 事实\n' + picked.map((x, i) => `${i + 1}. ${(typeof x === 'string' ? x : x.f).slice(0, 200)}`).join('\n'))
  }
  if (summaries.length) {
    const chosen = trim ? summaries.slice(-3).reverse() : summaries.slice(-5).reverse()
    parts.push('## 摘要（近期）\n' + chosen.map((s, i) => `${i + 1}. ${(s.content || '').slice(0, 200)}`).join('\n'))
  }
  if (lessons.length) {
    parts.push('## 经验教训（失败复盘）\n' + lessons.slice(0, trim ? 3 : 5).map((l, i) => `${i + 1}. ${String(l.content || '').slice(0, 240)}`).join('\n'))
  }
  if (!parts.length) return ''
  const tail = '\n(更多历史记忆请用 recall_memory 检索；置顶/事实按相关度选取，摘要与教训按时效选取)\n'
  const joined = parts.join('\n\n')
  const head = '\n' + usageLine + '\n\n'
  if (joined.length > maxChars) {
    const keepHead = Math.floor(maxChars * 0.65)
    const keepTail = Math.floor(maxChars * 0.25)
    return head + joined.slice(0, keepHead) + '\n...[记忆内容过长已截断]...\n' + joined.slice(-keepTail) + tail
  }
  return head + joined + tail
}

// SQLite 检索入口: FTS5 + 查询向量 RRF 融合(带 agent/scope 过滤); db 不可用返回 null 由调用方走 JSON 降级
export async function recallMemoryDb(agent: string, scope: 'global' | 'private', query: string, limit = 5): Promise<FusedHit[] | null> {
  if (!getDb()) return null
  try {
    const fts = searchFts(query, 20, { agent, scope })
    const qvec = await embedText(query)
    const vec = qvec ? searchVector(qvec, 20, { agent, scope }).map(h => ({ content: h.content, score: h.score })) : []
    return rrfFuse(fts, vec, { limit })
  } catch { return null }
}

// JSON 降级通道的关键词+向量合并召回(0.4.0 定稿后仅 db 不可用时使用)
export function recallFromMemory(mem: EngineMemory, query: string, vecHits: { content: string; score: number }[]): string {
  const pinned = mem.pinnedFacts || []
  const facts = mem.facts || []
  const summaries = mem.summaries || []
  const q = query.toLowerCase()
  const kwItems = [...pinned.map(f => ({ content: String(f), score: 1.5 })), ...facts.map(f => ({ content: String(f), score: String(f).toLowerCase().includes(q) ? 1.0 : 0 })), ...summaries.map(s => ({ content: String(s.content || ''), score: (s.content || '').toLowerCase().includes(q) ? 0.8 : 0 }))]
  const kwHits = q ? kwItems.filter(r => r.content.toLowerCase().includes(q)).sort((a, b) => b.score - a.score) : kwItems
  const seen = new Set<string>()
  const merged = [...vecHits, ...kwHits].filter(r => {
    if (!r.content || seen.has(r.content)) return false
    seen.add(r.content)
    return true
  }).slice(0, 10)
  return merged.length ? merged.map((r, i) => (i + 1) + '. ' + r.content).join('\n---\n') : '(empty)'
}
