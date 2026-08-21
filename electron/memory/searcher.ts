// electron/memory/searcher.ts — 双路检索 RRF 融合(v0.4.0 M2)
// 关键词路(FTS5 trigram+BM25) 与 向量路(embedding 余弦) 按 rank 融合, level 加权
import { getMemoryById, searchFts } from '../db'

export interface FtsHit { id: number; score: number; content: string }
export interface VecHit { content: string; score: number }
export interface FusedHit { content: string; score: number; confidence: number; layer: string; level: string }

// RRF: score = Σ 1/(60 + rank), rank 从 0 起
export function rrfFuse(fts: FtsHit[], vec: VecHit[], opts?: { ftsWeight?: number; vecWeight?: number; limit?: number }): FusedHit[] {
  const map = new Map<string, { content: string; score: number; id: number | null }>()
  const ftsW = opts?.ftsWeight ?? 1
  const vecW = opts?.vecWeight ?? 1
  fts.slice(0, 20).forEach((h, i) => {
    const key = h.content
    const cur = map.get(key) || { content: h.content, score: 0, id: h.id }
    cur.score += (ftsW / (60 + i))
    map.set(key, cur)
  })
  vec.slice(0, 20).forEach((h, i) => {
    if (!h.content) return
    const cur = map.get(h.content) || { content: h.content, score: 0, id: null }
    cur.score += (vecW / (60 + i))
    map.set(h.content, cur)
  })
  const out: FusedHit[] = [...map.values()].map(x => {
    const row = x.id != null ? getMemoryById(x.id) : null
    return {
      content: x.content,
      score: x.score,
      confidence: row?.confidence ?? 1,
      layer: row?.layer ?? 'L1',
      level: row?.level ?? 'normal',
    }
  })
  out.sort((a, b) => {
    const wa = weightLevel(a.level)
    const wb = weightLevel(b.level)
    if (Math.abs(wb - wa) > 0.001) return wb - wa
    return b.score - a.score
  })
  return out.slice(0, Math.max(1, Math.min(20, opts?.limit ?? 5)))
}

function weightLevel(level: string): number {
  return level === 'pinned' ? 3 : level === 'important' ? 2 : 1
}

// 关键词路入口(带 2 字 query 的向量兜底提示)
export function ftsHits(query: string, limit = 20): FtsHit[] {
  return searchFts(query, limit)
}

// 展示格式化: 带溯源层与置信度(命中多次的结论标注"被确认过 N 次")
export function formatFusedHits(hits: FusedHit[]): string {
  if (!hits.length) return '(empty)'
  return hits.map((h, i) => {
    const layerTag = h.layer === 'L3' ? '[核心结论]' : h.layer === 'L2' ? '[场景]' : h.layer === 'L0' ? '[原始记录]' : ''
    const conf = h.confidence > 1 ? `（被确认过 ${h.confidence} 次）` : ''
    return `${i + 1}. ${h.content}${layerTag ? ' ' + layerTag : ''}${conf}`
  }).join('\n---\n')
}
