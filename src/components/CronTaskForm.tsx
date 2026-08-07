// CronTaskForm.tsx —— 定时任务新建表单（从 CronView 拆出，行为不变）
import React from 'react'
import { TEMPLATES, EXPR_PRESETS } from './cron-utils'
import { S } from './cron-styles'
import { PlusMark, TemplateMark } from './themed-icons'

interface CronFormState {
  name: string
  prompt: string
  expr: string
  customExpr: string
  showCustom: boolean
  adding: boolean
}

export const CronTaskForm: React.FC<{
  state: CronFormState
  nameRef: React.RefObject<HTMLInputElement>
  onChange: (patch: Partial<CronFormState>) => void
  onAdd: () => void
  onApplyTemplate: (tpl: (typeof TEMPLATES)[number]) => void
}> = ({ state, nameRef, onChange, onAdd, onApplyTemplate }) => {
  const { name, prompt, expr, customExpr, showCustom, adding } = state
  return (
    <div style={S.createCard}>
      <div style={S.createTitle}>
        <PlusMark size={14} /> 新增轮回
      </div>

      {/* templates */}
      <div style={S.templateSection}>
        <div style={{ ...S.templateLabel, display: 'inline-flex', alignItems: 'center', gap: 5 }}><TemplateMark size={12} />快速模板</div>
        <div style={S.templateRow}>
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.name}
              style={S.templateChip}
              onClick={() => onApplyTemplate(tpl)}
            >
              {tpl.name}
            </button>
          ))}
        </div>
      </div>

      {/* name input */}
      <div style={S.createRow}>
        <input
          ref={nameRef}
          style={S.input}
          placeholder="任务名称"
          value={name}
          onChange={(e) => onChange({ name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') onAdd() }}
        />
      </div>

      {/* expression presets */}
      <div style={S.presetRow}>
        {EXPR_PRESETS.map((p) => (
          <button
            key={p.value}
            style={S.presetChip(!showCustom && expr === p.value)}
            onClick={() => onChange({ expr: p.value, showCustom: false })}
          >
            {p.label}
          </button>
        ))}
        <button
          style={S.presetChip(showCustom)}
          onClick={() => onChange({ showCustom: !showCustom })}
        >
          自定义
        </button>
      </div>

      {/* custom expression */}
      {showCustom && (
        <div style={S.createRow}>
          <input
            style={{ ...S.input, flex: 1 }}
            placeholder="自定义表达式（例如：every 10m 或 at 14:30）"
            value={customExpr}
            onChange={(e) => onChange({ customExpr: e.target.value })}
          />
        </div>
      )}

      {/* prompt input */}
      <div style={S.createRow}>
        <input
          style={S.inputSmall}
          placeholder="任务内容（到点即行）"
          value={prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') onAdd() }}
        />
        <button
          style={{ ...S.btnPrimary, opacity: adding ? 0.6 : 1 }}
          disabled={adding}
          onClick={onAdd}
        >
          {adding ? '添加中...' : '＋ 添加任务'}
        </button>
      </div>
    </div>
  )
}
