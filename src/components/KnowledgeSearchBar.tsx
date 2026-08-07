// KnowledgeSearchBar.tsx —— 藏书阁寻章检索（从 KnowledgeView 拆出，行为不变）
import React from 'react'
import type { SearchResult } from './knowledge-utils'
import { S } from './knowledge-styles'
import { SearchMark } from './themed-icons'

export const KnowledgeSearchBar: React.FC<{
  q: string
  results: SearchResult[]
  searching: boolean
  onChange: (v: string) => void
  onSearch: () => void
}> = ({ q, results, searching, onChange, onSearch }) => (
  <div style={S.section}>
    <div style={S.sectionTitle}>
      <span style={S.sectionIcon}><SearchMark size={13} /></span>寻章检索
    </div>
    <div style={S.searchRow}>
      <input
        style={S.searchInput}
        placeholder="输入要寻章的内容…"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSearch()}
      />
      <button
        style={S.searchBtn}
        onClick={onSearch}
        disabled={searching || !q.trim()}
      >
        {searching ? '寻章中…' : '寻章'}
      </button>
    </div>
    {results.length > 0 && (
      <div style={S.results}>
        {results.map((r, i) => (
          <div key={i} style={S.resultItem}>
            <div style={S.resultHeader}>
              <span style={{ color: 'var(--text-muted)' }}>结果 {i + 1}</span>
              <span style={S.resultScore}>契合度 {(r.score * 100).toFixed(0)}%</span>
            </div>
            <div style={S.resultContent}>
              {r.content.slice(0, 600)}
              {r.content.length > 600 ? '...' : ''}
            </div>
          </div>
        ))}
      </div>
    )}
    {searching && <div className="empty-hint" style={{ textAlign: 'center' }}>寻章中…</div>}
  </div>
)
