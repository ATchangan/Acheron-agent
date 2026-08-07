// electron/engine/memory.ts — 独立内核记忆访问(直接读写 memory.json, 与渲染层共用同一文件)
import * as fs from 'fs'
import { writeFileAtomic } from '../fs-atomic'
import { scoreOverlap, scanMemoryText } from '../shared/memory-utils'
export { scanMemoryText }

export interface EngineMemory {
  facts: string[]
  summaries: { content: string; timestamp: number }[]
  pinnedFacts?: string[]
  episodic?: { op: string; path: string; status: string; ts: number }[]
  goals?: { goal: string; status: string; steps?: unknown[]; created?: number }[]
}

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
      }
    }
  } catch { /* 损坏则重置 */ }
  return { facts: [], summaries: [], pinnedFacts: [], episodic: [], goals: [] }
}

export function saveMemory(memoryPath: string, m: EngineMemory): boolean {
  try { writeFileAtomic(memoryPath, JSON.stringify(m, null, 2)); return true } catch { return false }
}

export function memoryBlockText(mem: EngineMemory, userMsg?: string, trim = true): string {
  const pinned = mem.pinnedFacts || []
  const facts = mem.facts || []
  const summaries = mem.summaries || []
  const parts: string[] = []
  const usageLine = '??? ' + pinned.length + '/10 ? ?? ' + facts.length + '/500 ? ?? ' + summaries.length + '/200?????????????'
  if (pinned.length) parts.push('## ???????????,????????\n' + pinned.slice(-10).map((f, i) => `${i + 1}. ${String(f).slice(0, 300)}`).join('\n'))
  if (facts.length) {
    const scored = trim && userMsg
      ? [...facts].map(f => ({ f: String(f), s: scoreOverlap(String(f), userMsg) })).sort((a, b) => b.s - a.s).map(x => x.f)
      : facts.map(String).slice(-10)
    parts.push('## ????\n' + (trim ? scored.slice(-5) : scored).map((f, i) => `${i + 1}. ${f.slice(0, 200)}`).join('\n'))
  }
  if (summaries.length) parts.push('## ??????\n' + (trim ? summaries.slice(-2) : summaries.slice(-3)).map((s, i) => `${i + 1}. ${(s.content || '').slice(0, 200)}`).join('\n'))
  const tail = '\n(??????????? recall_memory ????, ???????)\n'
  if (trim) {
    const joined = parts.join('\n\n')
    // ???? 6000 ????????? 4000 + ? 1500 + ?????????????
    if (joined.length > 6000) {
      return '\n' + usageLine + '\n\n' + joined.slice(0, 4000) + '\n...[记忆内容过长已截断]...\n' + joined.slice(-1500) + tail
    }
  }
  return parts.length ? '\n' + usageLine + '\n\n' + parts.join('\n\n') + tail : ''
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
