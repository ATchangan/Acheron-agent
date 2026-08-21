// electron/memory/facts.ts — 结构化事实抽取与去重(v0.4.0 M4)
// 中文启发式: 谓词词典 + 正则切分(subject/relation/object); 解析失败降级纯 content 存储
import { insertMemory, listMemories, markSuperseded, updateMemoryAccess, bumpConfidence, type MemoryRow } from '../db'

export interface FactTriple { subject: string | null; relation: string | null; object: string | null }

const PREDICATES = ['是', '喜欢', '讨厌', '使用', '在', '要', '擅长', '从事', '毕业于', '住在', '想要', '计划', '去过']
const NEGATION = /(不|没|讨厌)/

export function parseFact(sentence: string): FactTriple {
  const s = String(sentence || '').trim()
  if (!s || s.length > 120) return { subject: null, relation: null, object: null }
  // 谓词按长度降序匹配, 避免 "想要" 被 "要" 提前命中
  const preds = [...PREDICATES].sort((a, b) => b.length - a.length)
  for (const p of preds) {
    const idx = s.indexOf(p)
    if (idx <= 0 || idx >= s.length - 1) continue
    const subject = s.slice(0, idx).trim()
    const object = s.slice(idx + p.length).trim()
    if (!subject || !object || subject.length > 30 || object.length > 30) return { subject: null, relation: null, object: null }
    let relation = p
    if (NEGATION.test(s)) relation = '不' + p
    return { subject, relation, object }
  }
  return { subject: null, relation: null, object: null }
}

// 查询同 (subject, relation) 的未淘汰事实行(容量 ≤2000, JS 过滤即可)
function findFactRows(subject: string | null, relation: string | null): MemoryRow[] {
  if (!subject || !relation) return []
  return listMemories({ layer: 'L1', includeSuperseded: false, limit: 2000 })
    .filter(m => m.subject === subject && m.relation === relation)
}

export type StoreFactResult =
  | { action: 'new'; id: number }
  | { action: 'repeat' | 'half-dup'; id: number }
  | { action: 'conflict'; id: number; supersededId: number }

// 事实落库: 精确重复→置信度+1; 半重复(同三元组不同内容)→置信度+1并更新; 冲突(同主谓不同宾)→旧行淘汰
export function storeFact(m: MemoryRow): StoreFactResult {
  const triples = findFactRows(m.subject, m.relation)
  const exact = triples.find(t => t.content === m.content && t.object === m.object)
  if (exact) {
    bumpConfidence(exact.id as number)
    updateMemoryAccess(exact.id as number)
    return { action: 'repeat', id: exact.id as number }
  }
  const half = triples.find(t => t.subject === m.subject && t.relation === m.relation && t.object === m.object)
  if (half) {
    bumpConfidence(half.id as number)
    return { action: 'half-dup', id: half.id as number }
  }
  const conflict = triples.find(t => t.object !== m.object)
  const id = insertMemory(m)
  if (conflict) {
    markSuperseded(conflict.id as number)
    return { action: 'conflict', id, supersededId: conflict.id as number }
  }
  return { action: 'new', id }
}
