// KnowledgeQaPanel.tsx —— 藏书阁典籍问答（从 KnowledgeView 拆出，行为不变）
import React from 'react'
import { S } from './knowledge-styles'
import { AskMark, DocMark } from './themed-icons'

export const KnowledgeQaPanel: React.FC<{
  q: string
  a: string
  loading: boolean
  onChange: (v: string) => void
  onAsk: () => void
}> = ({ q, a, loading, onChange, onAsk }) => (
  <div style={S.section}>
    <div style={S.sectionTitle}>
      <span style={S.sectionIcon}><AskMark size={13} /></span>典籍问答
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>
        依据卷宗作答
      </span>
    </div>
    <div style={S.qaInputRow}>
      <input
        style={S.qaInput}
        placeholder="输入问题…"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onAsk()}
      />
      <button
        style={S.qaBtn}
        onClick={onAsk}
        disabled={loading || !q.trim()}
      >
        {loading ? '寻章中…' : '发问'}
      </button>
    </div>
    {a && (
      <div style={S.qaContextBox}>
        <div style={{ ...S.qaLabel, display: 'flex', alignItems: 'center', gap: 5 }}><DocMark size={12} />参考回答</div>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{a}</div>
      </div>
    )}
  </div>
)
