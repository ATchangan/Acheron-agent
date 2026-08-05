import React from 'react'
import type { PlanStep, PlanStatus } from './plan-utils'
import { progressPct, PLAN_STATUS_LABELS } from './plan-utils'
import { S } from './plan-styles'

// v0.3.1 块 K: 进度头部(从 PlanningView 拆出, 行为零变化)
// ─── ProgressHeader ────────────────────────────────────────
const ProgressHeader: React.FC<{ steps: PlanStep[]; status: PlanStatus }> = ({ steps, status }) => {
  const pct = progressPct(steps)
  const done = steps.filter(s => s.status === 'completed').length
  const inProg = steps.filter(s => s.status === 'in_progress').length
  const blocked = steps.filter(s => s.status === 'blocked').length

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {PLAN_STATUS_LABELS[status]} · 进度 {pct}%
        </span>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)' }}>
          ✔ {done} / {steps.length}
          {inProg > 0 && <>  ◉ {inProg}</>}
          {blocked > 0 && <>  ⊘ {blocked}</>}
        </span>
      </div>
      <div style={S.progressBarOuter}>
        <div style={S.progressBarInner(pct)} />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════

export default ProgressHeader
