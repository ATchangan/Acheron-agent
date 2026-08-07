// SkillList.tsx —— 技能列表（从 SkillsView 拆出，行为不变）
import React from 'react'
import { CAT_ICON, CAT_COLOR, type SkillWithCategory, type Category } from './skills-utils'
import { S } from './skills-styles'

export const SkillList: React.FC<{
  skills: SkillWithCategory[]
  stats: { category: Category; count: number }[]
  totalSkills: number
  error: string
  loading: boolean
  onView: (skill: SkillWithCategory) => void
  onDelete: (skill: SkillWithCategory) => void
  onClearError: () => void
}> = ({ skills, stats, totalSkills, error, loading, onView, onDelete, onClearError }) => (
  <>
    {/* Stats bar */}
    <div style={S.statsBar}>
      {stats.map((s) => (
        <div key={s.category} style={S.statItem}>
          <span>{CAT_ICON[s.category]}</span>
          <span style={S.statLabel}>{s.category}</span>
          <span style={{ ...S.statCount, color: CAT_COLOR[s.category] }}>{s.count}</span>
        </div>
      ))}
    </div>

    {/* Error */}
    {error && (
      <div style={S.errorBar}>
        <span>{error}</span>
        <button className="btn-icon" onClick={onClearError}>✕</button>
      </div>
    )}

    {/* Skills grid */}
    {loading ? (
      <div className="empty-hint" style={{ textAlign: 'center' }}>🕯️ 加载法术中...</div>
    ) : skills.length === 0 ? (
      <div style={S.empty}>
        <span style={S.emptyIcon}>📜</span>
        <p style={{ margin: '8px 0 4px', color: 'var(--text-secondary)' }}>尚未收录任何法术</p>
        <p className="empty-hint" style={{ margin: 0 }}>
          点击「新建技能」创建第一个技能，或从对话中提取
        </p>
      </div>
    ) : (
      <div style={S.grid}>
        {skills.map((skill) => (
          <div key={skill.path} style={S.card}>
            <div style={S.cardHeader}>
              <span style={S.cardIcon}>{CAT_ICON[skill.category]}</span>
              <span style={{ ...S.badge, color: CAT_COLOR[skill.category], borderColor: CAT_COLOR[skill.category] }}>
                {skill.category}
              </span>
            </div>
            <h3 style={S.cardTitle}>{skill.name}</h3>
            <p style={S.cardDesc}>{skill.description || '暂无描述'}</p>
            <div style={S.cardPath} title={skill.path}>{skill.path}</div>
            <div style={S.cardActions}>
              <button className="btn-small" onClick={() => onView(skill)}>📖 查看</button>
              <button className="btn-small" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => onDelete(skill)}>🗑 删除</button>
            </div>
          </div>
        ))}
      </div>
    )}
  </>
)
