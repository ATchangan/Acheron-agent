// PlanCreateForm.tsx —— 计划新建视图（从 PlanningView 拆出，行为不变）
import React from 'react'
import type { PlanStep, PlanTemplate } from './plan-utils'
import { TEMPLATES } from './plan-utils'
import { S } from './plan-styles'

export const PlanCreateForm: React.FC<{
  showTemplates: boolean
  newTitle: string
  newGoal: string
  editingSteps: PlanStep[]
  draftStepTitle: string
  draftStepDesc: string
  onToggleTemplates: () => void
  onApplyTemplate: (tpl: PlanTemplate) => void
  onTitle: (v: string) => void
  onGoal: (v: string) => void
  onMoveStep: (id: string, dir: -1 | 1) => void
  onRemoveStep: (id: string) => void
  onDraftTitle: (v: string) => void
  onDraftDesc: (v: string) => void
  onAddStep: () => void
  onCreate: () => void
  onReset: () => void
}> = ({ showTemplates, newTitle, newGoal, editingSteps, draftStepTitle, draftStepDesc, onToggleTemplates, onApplyTemplate, onTitle, onGoal, onMoveStep, onRemoveStep, onDraftTitle, onDraftDesc, onAddStep, onCreate, onReset }) => (
  <>
    {/* template selection */}
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <span style={S.sectionTitle}>选择模板快速开始</span>
        <button style={S.btn('ghost', true)} onClick={onToggleTemplates}>
          {showTemplates ? '收起' : '展开'}
        </button>
      </div>
      {showTemplates && (
        <div style={S.templateGrid}>
          {TEMPLATES.map(tpl => (
            <div
              key={tpl.id}
              style={S.templateCard}
              onClick={() => onApplyTemplate(tpl)}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}
            >
              <div style={S.templateIcon}>{tpl.icon}</div>
              <div style={S.templateTitle}>{tpl.title}</div>
              <div style={S.templateCount}>{tpl.steps.length} 步 · {tpl.goal}</div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* goal input */}
    <div style={S.card}>
      <label style={S.label}>谋断目标</label>
      <input
        style={S.input}
        value={newTitle}
        onChange={e => onTitle(e.target.value)}
        placeholder="计划名称（可选）"
      />
      <textarea
        style={{ ...S.textarea, marginBottom: '8px' }}
        value={newGoal}
        onChange={e => onGoal(e.target.value)}
        placeholder="输入你的任务目标..."
        rows={2}
      />
    </div>

    {/* step builder */}
    {editingSteps.length > 0 && (
      <div style={S.card}>
        <div style={{ ...S.sectionTitle, marginTop: 0 }}>谋断步骤 ({editingSteps.length})</div>
        {editingSteps.map((step, i) => (
          <div key={step.id} style={{ ...S.stepCard(step.status), marginBottom: '6px' }}>
            <div style={S.stepHeader}>
              <span style={S.stepStatusBadge('pending')}>○ 待开始</span>
              <span style={S.stepTitle('pending')}>{i + 1}. {step.title}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '2px' }}>
                {i > 0 && <span style={S.dragHandle} onClick={() => onMoveStep(step.id, -1)}>▲</span>}
                {i < editingSteps.length - 1 && <span style={S.dragHandle} onClick={() => onMoveStep(step.id, 1)}>▼</span>}
                <span style={{ ...S.dragHandle, color: 'var(--danger)' }} onClick={() => onRemoveStep(step.id)}>✕</span>
              </div>
            </div>
            <div style={S.stepDesc}>{step.description}</div>
          </div>
        ))}

        {/* add step inline */}
        <div style={{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
          <label style={S.label}>添加步骤</label>
          <input
            style={S.input}
            value={draftStepTitle}
            onChange={e => onDraftTitle(e.target.value)}
            placeholder="步骤标题"
            onKeyDown={e => { if (e.key === 'Enter') onAddStep() }}
          />
          <input
            style={S.input}
            value={draftStepDesc}
            onChange={e => onDraftDesc(e.target.value)}
            placeholder="步骤描述"
            onKeyDown={e => { if (e.key === 'Enter') onAddStep() }}
          />
          <button style={S.btn('ghost', true)} onClick={onAddStep}>+ 添加步骤</button>
        </div>
      </div>
    )}

    {/* create button */}
    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
      <button
        style={{
          ...S.btn('primary'),
          opacity: newGoal.trim() && editingSteps.length > 0 ? 1 : 0.5,
          flex: 1,
          padding: '10px 16px',
        }}
        disabled={!newGoal.trim() || editingSteps.length === 0}
        onClick={onCreate}
      >
        🏯 开谋定策
      </button>
      {editingSteps.length > 0 && (
        <button style={S.btn('ghost')} onClick={onReset}>清空</button>
      )}
    </div>
  </>
)
