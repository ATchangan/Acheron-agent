// KnowledgeDocList.tsx —— 藏书阁文档列表（从 KnowledgeView 拆出，行为不变）
import React from 'react'
import type { DocMeta } from './knowledge-utils'
import { fmtSize } from './knowledge-utils'
import { S } from './knowledge-styles'
import { ScrollMark, DocMark, TrashMark } from './themed-icons'
import { U } from './ui-styles'


export const KnowledgeDocList: React.FC<{
  docs: DocMeta[]
  onDelete: (idx: number) => void
}> = ({ docs, onDelete }) => (
  <div style={S.section}>
    <div style={S.sectionTitle}>
      <span style={S.sectionIcon}><ScrollMark size={13} /></span>卷宗库
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>
        （{docs.length} 份卷宗）
      </span>
    </div>
    {docs.length === 0 ? (
      <div style={S.emptyHint}>暂无卷宗，请先录入文件。</div>
    ) : (
      <div style={S.docList}>
        {docs.map((d, i) => (
          <div
            key={`${d.path}-${d.importedAt}`}
            style={S.docItem}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            <div style={S.docInfo}>
              <span style={S.docName} title={d.path}>
                <span style={U.inlineFlex5}><DocMark size={12} />{d.name}</span>
              </span>
              <span style={S.docMeta}>
                <span>{new Date(d.importedAt).toLocaleString('zh-CN')}</span>
                <span>{fmtSize(d.size)}</span>
              </span>
            </div>
            <button
              className="btn-icon btn-danger"
              onClick={() => onDelete(i)}
              title="删除卷宗"
            >
              <TrashMark size={13} />
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
)
