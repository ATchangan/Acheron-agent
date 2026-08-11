// electron/engine/memory.ts — 独立内核记忆访问(直接读写 memory.json, 与渲染层共用同一文件)
import * as fs from 'fs'
import { dirname, join } from 'path'
import { writeFileAtomic } from '../fs-atomic'
import { scoreOverlap, scanMemoryText } from '../shared/memory-utils'
export { scanMemoryText }

export interface EngineMemory {
  facts: string[]
  summaries: { content: string; timestamp: number }[]
  pinnedFacts?: string[]
  episodic?: { op: string; path: string; status: string; ts: number }[]
  goals?: { goal: string; status: string; steps?: unknown[]; created?: number }[]
  // v0.3.9: 失败教训(自动复盘沉淀, 按时效注入)
  lessons?: { content: string; ts: number }[]
}

const PINNED_CAP = 10
const FACTS_CAP = 500
const SUMMARIES_CAP = 200
const LESSONS_CAP = 50
const MEMORY_DEFAULT_MAX = 6000

export function loadMemory(memoryPath: string): EngineMemory {
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

export function saveMemory(memoryPath: string, m: EngineMemory): boolean {
  try { writeFileAtomic(memoryPath, JSON.stringify(m, null, 2)); return true } catch { return false }
}

// v0.3.9: 私有记忆命名空间 —— memoryScope=private 的角色使用独立 memory-<角色>.json
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
    // 有相关命中时只取命中项, 避免零相关事实占满预算; 无命中时回退最近 5 条
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
