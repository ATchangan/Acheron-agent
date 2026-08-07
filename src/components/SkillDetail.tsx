// SkillDetail.tsx —— 技能查看弹窗（从 SkillsView 拆出，行为不变）
import React from 'react'
import { CAT_COLOR, renderMarkdown, type SkillWithCategory } from './skills-utils'
import { S } from './skills-styles'
import { U } from './ui-styles'


export const SkillDetail: React.FC<{
  skill: SkillWithCategory
  content: string
  loading: boolean
  onClose: () => void
}> = ({ skill, content, loading, onClose }) => (
  <div style={S.overlay} onClick={onClose}>
    <div style={{ ...S.modal, maxWidth: '720px' }} onClick={(e) => e.stopPropagation()}>
      <div style={S.modalHeader}>
        <h2 style={{ ...S.modalTitle, flex: 1 }}>📖 {skill.name}</h2>
        <span style={{ ...S.badge, color: CAT_COLOR[skill.category], borderColor: CAT_COLOR[skill.category] }}>
          {skill.category}
        </span>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>
      <div style={S.modalBody}>
        <div style={S.viewerPath}>📁 {skill.path}</div>
        {loading ? (
          <div className="empty-hint" style={U.center}>加载法术内容…</div>
        ) : (
          <div
            style={S.viewerContent}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        )}
      </div>
      <div style={S.modalFooter}>
        <button className="btn-small" onClick={onClose}>关闭</button>
      </div>
    </div>
  </div>
)
