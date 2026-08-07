// SkillCreateForm.tsx —— 技能新建弹窗（从 SkillsView 拆出，行为不变）
import React from 'react'
import { CATEGORIES, CAT_ICON, type Category } from './skills-utils'
import { S } from './skills-styles'

export interface SkillCreateState {
  name: string
  desc: string
  category: Category
  content: string
}

export const SkillCreateForm: React.FC<{
  state: SkillCreateState
  saving: boolean
  onChange: (patch: Partial<SkillCreateState>) => void
  onSave: () => void
  onCancel: () => void
}> = ({ state, saving, onChange, onSave, onCancel }) => (
  <div style={S.overlay} onClick={onCancel}>
    <div style={S.modal} onClick={(e) => e.stopPropagation()}>
      <div style={S.modalHeader}>
        <h2 style={S.modalTitle}>🪄 铭刻新法术</h2>
        <button className="btn-icon" onClick={onCancel}>✕</button>
      </div>
      <div style={S.modalBody}>
        <div className="form-row">
          <label>法术名称</label>
          <input
            value={state.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="输入技能名称…"
            autoFocus
          />
        </div>
        <div className="form-row">
          <label>简述</label>
          <input
            value={state.desc}
            onChange={(e) => onChange({ desc: e.target.value })}
            placeholder="一句话描述这个技能的用途…"
          />
        </div>
        <div className="form-row">
          <label>法术类别</label>
          <select value={state.category} onChange={(e) => onChange({ category: e.target.value as Category })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CAT_ICON[c]} {c}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>法术内容 <span className="form-hint">（富文本）</span></label>
          <textarea
            style={S.textarea}
            value={state.content}
            onChange={(e) => onChange({ content: e.target.value })}
            placeholder={'# 技能名称\n\n## 用途\n描述这个技能的作用…\n\n## 步骤\n1. 第一步\n2. 第二步\n\n## 注意事项\n- 要点一'}
            rows={10}
          />
        </div>
      </div>
      <div style={S.modalFooter}>
        <button className="btn-small" onClick={onCancel}>取消</button>
        <button
          className="btn-primary"
          onClick={onSave}
          disabled={saving || !state.name.trim() || !state.content.trim()}
        >
          {saving ? '铭刻中…' : '💾 保存'}
        </button>
      </div>
    </div>
  </div>
)
