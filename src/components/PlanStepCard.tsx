import React, { useState, useEffect } from 'react'
import type { PlanStep, StepStatus } from './plan-utils'
import { STATUS_ICONS, STATUS_LABELS } from './plan-utils'
import { S } from './plan-styles'

// v0.3.1 块 K: 步骤卡片(从 PlanningView 拆出, 行为零变化)
const StepCard: React.FC<{
  step: PlanStep
  index: number
  total: number
  isLast: boolean
  connected: boolean
  onStatusChange: (id: string, status: StepStatus) => void
  onNotesChange: (id: string, notes: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  onDelete: (id: string) => void
  readOnly?: boolean
}> = React.memo(({ step, index, total, isLast, connected, onStatusChange, onNotesChange, onMoveUp, onMoveDown, onDelete, readOnly }) => {
  const [showNotes, setShowNotes] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [draftNotes, setDraftNotes] = useState(step.notes)

  useEffect(() => { setDraftNotes(step.notes) }, [step.notes])

  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      {/* timeline */}
      {connected && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '16px' }}>
          <div style={S.timelineDot(step.status)} />
          {!isLast && <div style={S.timelineLine} />}
        </div>
      )}

      <div style={{ ...S.stepCard(step.status), flex: 1 }}>
        {/* header */}
        <div style={S.stepHeader}>
          <span style={S.stepStatusBadge(step.status)}>
            {STATUS_ICONS[step.status]} {STATUS_LABELS[step.status]}
          </span>
          <span style={S.stepTitle(step.status)}>{index + 1}. {step.title}</span>
          {!readOnly && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '2px' }}>
              {index > 0 && <span style={S.dragHandle} onClick={() => onMoveUp(step.id)} title="上移">▲</span>}
              {index < total - 1 && <span style={S.dragHandle} onClick={() => onMoveDown(step.id)} title="下移">▼</span>}
              <span style={{ ...S.dragHandle, color: 'var(--danger)' }} onClick={() => onDelete(step.id)} title="删除">✕</span>
            </div>
          )}
        </div>

        {/* description */}
        <div style={S.stepDesc}>{step.description}</div>

        {/* dependencies */}
        {step.dependencies.length > 0 && (
          <div style={{ marginTop: '6px' }}>
            <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--accent)' }}>
              依赖: {step.dependencies.map((d, i) => <span key={d}>{i > 0 ? ', ' : ''}{d.replace('step_', '#')}</span>)}
            </span>
          </div>
        )}

        {/* notes */}
        {step.notes && !showNotes && (
          <div style={S.notesArea} onClick={() => setShowNotes(true)}>
            📌 {step.notes.length > 80 ? step.notes.slice(0, 80) + '...' : step.notes}
          </div>
        )}
        {showNotes && !editingNotes && (
          <div style={S.notesArea}>
            📌 {step.notes}
            {!readOnly && (
              <div style={{ marginTop: '4px', display: 'flex', gap: '6px' }}>
                <button style={S.btn('ghost', true)} onClick={() => setEditingNotes(true)}>编辑</button>
                <button style={S.btn('ghost', true)} onClick={() => setShowNotes(false)}>收起</button>
              </div>
            )}
          </div>
        )}
        {editingNotes && (
          <div style={{ marginTop: '6px' }}>
            <textarea
              style={S.textarea}
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
              rows={2}
              placeholder="添加备注..."
            />
            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              <button style={S.btn('primary', true)} onClick={() => { onNotesChange(step.id, draftNotes); setEditingNotes(false) }}>保存</button>
              <button style={S.btn('ghost', true)} onClick={() => { setDraftNotes(step.notes); setEditingNotes(false) }}>取消</button>
            </div>
          </div>
        )}

        {/* actions */}
        {!readOnly && (
          <div style={S.stepActions}>
            {step.status === 'pending' && (
              <button style={S.btn('primary', true)} onClick={() => onStatusChange(step.id, 'in_progress')}>▶ 开始</button>
            )}
            {step.status === 'in_progress' && (
              <>
                <button style={S.btn('green', true)} onClick={() => onStatusChange(step.id, 'completed')}>✔ 完成</button>
                <button style={S.btn('ghost', true)} onClick={() => onStatusChange(step.id, 'pending')}>⏸ 搁置</button>
                <button style={S.btn('danger', true)} onClick={() => onStatusChange(step.id, 'blocked')}>⊘ 阻塞</button>
              </>
            )}
            {step.status === 'completed' && (
              <button style={S.btn('ghost', true)} onClick={() => onStatusChange(step.id, 'in_progress')}>↩ 重做</button>
            )}
            {step.status === 'blocked' && (
              <>
                <button style={S.btn('primary', true)} onClick={() => onStatusChange(step.id, 'in_progress')}>▶ 解除阻塞</button>
                <button style={S.btn('ghost', true)} onClick={() => onStatusChange(step.id, 'pending')}>⏸ 搁置</button>
              </>
            )}
            {!step.notes && !showNotes && (
              <button style={S.btn('ghost', true)} onClick={() => { setShowNotes(true); setEditingNotes(true) }}>📌 备注</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
export default StepCard
