// PlanListView.tsx —— 计划历史列表（从 PlanningView 拆出，行为不变）
import React from 'react'
import type { Plan } from './plan-utils'
import { tsLabel, progressPct, PLAN_STATUS_LABELS } from './plan-utils'
import { S } from './plan-styles'

export const PlanListView: React.FC<{
  plans: Plan[]
  loading: boolean
  activePlanId: string | null
  deleteConfirm: string | null
  onViewPlan: (id: string) => void
  onDelete: (id: string) => void
  onSetDeleteConfirm: (v: string | null) => void
  onGoCreate: () => void
}> = ({ plans, loading, activePlanId, deleteConfirm, onViewPlan, onDelete, onSetDeleteConfirm, onGoCreate }) => (
  <>
    <div style={{ ...S.sectionTitle, marginTop: 0 }}>📜 谋断录 · 往昔之计</div>
    {loading && (
      <div style={S.empty}>
        <span>加载中...</span>
      </div>
    )}
    {!loading && plans.length === 0 && (
      <div style={S.empty}>
        <div style={S.emptyIcon}>📜</div>
        <div style={S.emptyText}>
          尚无谋断记录<br />
          请先创建你的第一个计划
        </div>
        <button style={S.btn('primary')} onClick={onGoCreate}>
          🆕 开始谋断
        </button>
      </div>
    )}
    {!loading && plans.map(plan => {
      const pct = progressPct(plan.steps)
      const done = plan.steps.filter(s => s.status === 'completed').length
      return (
        <div key={plan.id} style={{
          ...S.cardSm,
          cursor: 'pointer',
          borderColor: plan.id === activePlanId ? 'var(--accent)' : 'var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ flex: 1, minWidth: 0 }} onClick={() => onViewPlan(plan.id)}>
              <div style={{ fontSize: 'var(--ui-font-size)', fontWeight: 600, color: 'var(--text-primary)' }}>
                🏯 {plan.title}
              </div>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {plan.goal}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                <div style={{ flex: 1, ...S.progressBarOuter, margin: 0, height: '4px' }}>
                  <div style={{ ...S.progressBarInner(pct), height: '4px' }} />
                </div>
                <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {done}/{plan.steps.length}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, marginLeft: '12px' }}>
              <span style={S.planCardStatus(plan.status)}>
                {PLAN_STATUS_LABELS[plan.status]}
              </span>
              <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: '#555' }}>{tsLabel(plan.updatedAt)}</span>
              <button
                style={{ ...S.btn('danger', true), padding: '2px 6px', fontSize: 'calc(var(--ui-font-size) - 3px)' }}
                onClick={e => { e.stopPropagation(); onSetDeleteConfirm(plan.id) }}
              >
                🗑
              </button>
            </div>
          </div>

          {/* delete confirm inline */}
          {deleteConfirm === plan.id && (
            <div style={{ ...S.confirmOverlay, marginTop: '8px', marginBottom: 0 }}>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-primary)', marginBottom: '6px' }}>
                确定删除「{plan.title}」？
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button style={S.btn('danger', true)} onClick={e => { e.stopPropagation(); onDelete(plan.id) }}>确认</button>
                <button style={S.btn('ghost', true)} onClick={e => { e.stopPropagation(); onSetDeleteConfirm(null) }}>取消</button>
              </div>
            </div>
          )}
        </div>
      )
    })}
  </>
)
