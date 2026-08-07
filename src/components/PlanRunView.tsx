// PlanRunView.tsx —— 计划执行/编辑视图（从 PlanningView 拆出，行为不变）
import React from 'react'
import type { Plan, PlanStatus, StepStatus } from './plan-utils'
import { tsLabel, PLAN_STATUS_LABELS } from './plan-utils'
import { S } from './plan-styles'
import StepCard from './PlanStepCard'
import ProgressHeader from './PlanProgressHeader'

export const PlanRunView: React.FC<{
  activePlan: Plan | null
  deleteConfirm: string | null
  onChangeStatus: (status: PlanStatus) => void
  onDelete: () => void
  onSetDeleteConfirm: (v: string | null) => void
  onStepStatusChange: (sid: string, st: StepStatus) => void
  onNotesChange: (sid: string, notes: string) => void
  onMoveUp: (sid: string) => void
  onMoveDown: (sid: string) => void
  onDeleteStep: (sid: string) => void
  onGoCreate: () => void
  onGoHistory: () => void
}> = ({ activePlan, deleteConfirm, onChangeStatus, onDelete, onSetDeleteConfirm, onStepStatusChange, onNotesChange, onMoveUp, onMoveDown, onDeleteStep, onGoCreate, onGoHistory }) => {
  if (!activePlan) {
    return (
      <div style={S.empty}>
        <div style={S.emptyIcon}>📋</div>
        <div style={S.emptyText}>
          尚未选择计划<br />
          <button style={{ ...S.btn('primary', true), marginTop: '12px' }} onClick={onGoCreate}>
            🆕 创建新谋断
          </button>
          <span style={{ margin: '0 8px', color: '#555' }}>或者</span>
          <button style={{ ...S.btn('ghost', true), marginTop: '12px' }} onClick={onGoHistory}>
            📜 浏览谋断录
          </button>
        </div>
      </div>
    )
  }
  return (
    <>
      {/* plan header */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
              🏯 {activePlan.title}
            </div>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {activePlan.goal}
            </div>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: '#555', marginTop: '4px' }}>
              创建于 {tsLabel(activePlan.createdAt)} · 更新于 {tsLabel(activePlan.updatedAt)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <span style={S.planCardStatus(activePlan.status)}>
              {PLAN_STATUS_LABELS[activePlan.status]}
            </span>
          </div>
        </div>

        {/* plan controls */}
        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
          {activePlan.status === 'active' && (
            <button style={S.btn('ghost', true)} onClick={() => onChangeStatus('paused')}>⏸ 暂停计划</button>
          )}
          {activePlan.status === 'paused' && (
            <button style={S.btn('primary', true)} onClick={() => onChangeStatus('active')}>▶ 继续计划</button>
          )}
          {activePlan.status === 'active' && (
            <button style={S.btn('green', true)} onClick={() => onChangeStatus('completed')}>✔ 全部完成</button>
          )}
          {(activePlan.status === 'completed' || activePlan.status === 'paused') && (
            <button style={S.btn('ghost', true)} onClick={() => onChangeStatus('archived')}>📦 归档</button>
          )}
          {activePlan.status === 'archived' && (
            <button style={S.btn('ghost', true)} onClick={() => onChangeStatus('active')}>📂 恢复</button>
          )}
          <button
            style={{ ...S.btn('danger', true), marginLeft: 'auto' }}
            onClick={() => onSetDeleteConfirm(activePlan.id)}
          >
            🗑 删除
          </button>
        </div>

        {/* delete confirm */}
        {deleteConfirm === activePlan.id && (
          <div style={S.confirmOverlay}>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-primary)', marginBottom: '8px' }}>
              确定要删除这个计划吗？此操作不可撤销。
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button style={S.btn('danger', true)} onClick={onDelete}>确认删除</button>
              <button style={S.btn('ghost', true)} onClick={() => onSetDeleteConfirm(null)}>取消</button>
            </div>
          </div>
        )}
      </div>

      {/* progress header */}
      <ProgressHeader steps={activePlan.steps} status={activePlan.status} />

      {/* timeline steps */}
      <div style={{ marginTop: '4px' }}>
        <div style={S.sectionTitle}>
          📍 谋断步骤流程
          {activePlan.status !== 'archived' && (
            <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '8px' }}>
              ({activePlan.steps.filter(s => s.status === 'completed').length}/{activePlan.steps.length} 完成)
            </span>
          )}
        </div>
        {activePlan.steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            index={i}
            total={activePlan.steps.length}
            isLast={i === activePlan.steps.length - 1}
            connected={true}
            onStatusChange={(sid, st) => onStepStatusChange(sid, st)}
            onNotesChange={(sid, notes) => onNotesChange(sid, notes)}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onDelete={onDeleteStep}
            readOnly={activePlan.status === 'archived'}
          />
        ))}
      </div>
    </>
  )
}
