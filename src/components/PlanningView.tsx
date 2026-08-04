import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { PlanStep, StepStatus, PlanStatus, ViewMode, Plan, PlanTemplate } from './plan-utils'
import { TEMPLATES, PLAN_PREFIX, uid, planUid, tsLabel, progressPct, STATUS_ICONS, STATUS_LABELS, PLAN_STATUS_LABELS } from './plan-utils'
import { S } from './plan-styles'
import StepCard from './PlanStepCard'
import ProgressHeader from './PlanProgressHeader'

// v0.3.1 块 K: 计划视图主组件(子组件已拆分, 行为零变化)
const PlanningView: React.FC = () => {
  // ── state ──
  const [mode, setMode] = useState<ViewMode>('create')
  const [plans, setPlans] = useState<Plan[]>([])
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // create state
  const [newGoal, setNewGoal] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [editingSteps, setEditingSteps] = useState<PlanStep[]>([])
  const [draftStepTitle, setDraftStepTitle] = useState('')
  const [draftStepDesc, setDraftStepDesc] = useState('')

  // confirm delete
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // ── persistence helpers ──
  const persistPlan = useCallback(async (plan: Plan) => {
    try {
      const mem = await window.huangquan.memory.load()
      // Replace existing plan fact
      const planFactPrefix = `${PLAN_PREFIX}${plan.id}:`
      const stripped = mem.facts.filter(f => !f.startsWith(`${PLAN_PREFIX}${plan.id}:`))
      stripped.push(planFactPrefix + JSON.stringify(plan))
      await window.huangquan.memory.save({ ...mem, facts: stripped })
    } catch {
      // silently fail persistence
    }
  }, [])

  const deletePlanFromMemory = useCallback(async (planId: string) => {
    try {
      const mem = await window.huangquan.memory.load()
      const stripped = mem.facts.filter(f => !f.startsWith(`${PLAN_PREFIX}${planId}:`))
      await window.huangquan.memory.save({ ...mem, facts: stripped })
    } catch (e) { /* ignore */ console.debug('[swallow]', e) }
  }, [])

  // ── load plans from memory ──
  const loadPlans = useCallback(async () => {
    setLoading(true)
    try {
      const mem = await window.huangquan.memory.load()
      const parsed: Plan[] = []
      for (const fact of mem.facts) {
        if (fact.startsWith(PLAN_PREFIX)) {
          try {
            const json = fact.slice(PLAN_PREFIX.length)
            const colonIdx = json.indexOf(':')
            if (colonIdx > 0) {
              const planJson = json.slice(colonIdx + 1)
              const plan = JSON.parse(planJson) as Plan
              if (plan.id && plan.steps) parsed.push(plan)
            }
          } catch (e) { /* skip corrupted */ console.debug('[swallow]', e) }
        }
      }
      parsed.sort((a, b) => b.updatedAt - a.updatedAt)
      setPlans(parsed)
    } catch (e) { /* ignore */ console.debug('[swallow]', e) }
    setLoading(false)
  }, [])

  useEffect(() => { loadPlans() }, [loadPlans])

  // ── active plan ──
  const activePlan = useMemo(() => {
    if (!activePlanId) return null
    return plans.find(p => p.id === activePlanId) ?? null
  }, [plans, activePlanId])

  // ── plan creation: apply template ──
  const applyTemplate = useCallback((tpl: PlanTemplate) => {
    setNewTitle(tpl.title)
    setNewGoal(tpl.goal)
    const steps: PlanStep[] = tpl.steps.map((s, i) => ({
      id: `step_${i}`,
      title: s.title,
      description: s.description,
      status: 'pending' as StepStatus,
      dependencies: s.dependencies,
      notes: '',
    }))
    setEditingSteps(steps)
    setShowTemplates(false)
  }, [])

  // ── plan creation: manual step management ──
  const addStep = useCallback(() => {
    if (!draftStepTitle.trim()) return
    setEditingSteps(prev => [...prev, {
      id: uid(),
      title: draftStepTitle.trim(),
      description: draftStepDesc.trim(),
      status: 'pending',
      dependencies: [],
      notes: '',
    }])
    setDraftStepTitle('')
    setDraftStepDesc('')
  }, [draftStepTitle, draftStepDesc])

  const removeStep = useCallback((id: string) => {
    setEditingSteps(prev => prev.filter(s => s.id !== id))
  }, [])

  const moveStep = useCallback((id: string, dir: -1 | 1) => {
    setEditingSteps(prev => {
      const idx = prev.findIndex(s => s.id === id)
      if (idx < 0) return prev
      const target = idx + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }, [])

  // ── create plan from editing steps ──
  const createPlan = useCallback(async () => {
    if (!newGoal.trim() || editingSteps.length === 0) return
    const plan: Plan = {
      id: planUid(),
      title: newTitle.trim() || newGoal.trim().slice(0, 40),
      goal: newGoal.trim(),
      steps: editingSteps,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await persistPlan(plan)
    setPlans(prev => [plan, ...prev])
    setActivePlanId(plan.id)
    setMode('edit')
    setNewGoal('')
    setNewTitle('')
    setEditingSteps([])
  }, [newGoal, newTitle, editingSteps, persistPlan])

  // ── plan execution mutations ──
  const updatePlanSteps = useCallback(async (planId: string, updater: (steps: PlanStep[]) => PlanStep[]) => {
    setPlans(prev => prev.map(p => {
      if (p.id !== planId) return p
      const updated = { ...p, steps: updater(p.steps), updatedAt: Date.now() }
      // auto-complete plan
      if (updated.steps.every(s => s.status === 'completed')) {
        updated.status = 'completed'
      }
      // Persist
      persistPlan(updated)
      return updated
    }))
  }, [persistPlan])

  const changeStepStatus = useCallback((planId: string, stepId: string, status: StepStatus) => {
    updatePlanSteps(planId, steps => steps.map(s => s.id === stepId ? { ...s, status } : s))
  }, [updatePlanSteps])

  const changeStepNotes = useCallback((planId: string, stepId: string, notes: string) => {
    updatePlanSteps(planId, steps => steps.map(s => s.id === stepId ? { ...s, notes } : s))
  }, [updatePlanSteps])

  const moveStepInPlan = useCallback((planId: string, stepId: string, dir: -1 | 1) => {
    updatePlanSteps(planId, steps => {
      const idx = steps.findIndex(s => s.id === stepId)
      if (idx < 0) return steps
      const target = idx + dir
      if (target < 0 || target >= steps.length) return steps
      const next = [...steps];
      [next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }, [updatePlanSteps])

  const deleteStepFromPlan = useCallback((planId: string, stepId: string) => {
    updatePlanSteps(planId, steps => steps.filter(s => s.id !== stepId))
  }, [updatePlanSteps])

  const changePlanStatus = useCallback(async (planId: string, status: PlanStatus) => {
    setPlans(prev => prev.map(p => {
      if (p.id !== planId) return p
      const updated = { ...p, status, updatedAt: Date.now() }
      persistPlan(updated)
      return updated
    }))
  }, [persistPlan])

  // ── delete plan ──
  const deletePlan = useCallback(async (planId: string) => {
    await deletePlanFromMemory(planId)
    setPlans(prev => prev.filter(p => p.id !== planId))
    if (activePlanId === planId) {
      setActivePlanId(null)
      setMode('create')
    }
    setDeleteConfirm(null)
  }, [deletePlanFromMemory, activePlanId])

  // ── view plan ──
  const viewPlan = useCallback((planId: string) => {
    setActivePlanId(planId)
    setMode('edit')
  }, [])

  // ── reset create form ──
  const resetCreate = useCallback(() => {
    setNewGoal('')
    setNewTitle('')
    setEditingSteps([])
    setShowTemplates(false)
  }, [])

  // ═════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════
  return (
    <div style={S.root}>
      {/* ── HEADER ── */}
      <div style={S.header}>
        <div style={S.titleRow}>
          <span style={S.icon}>🏯</span>
          <div>
            <h1 style={S.title}>◬ 任务规划</h1>
            <p style={S.subtitle}>谋定而后动 · 知止而有得</p>
          </div>
        </div>

        {/* navigation */}
        <div style={S.navRow}>
          {([
            { m: 'create' as ViewMode, label: '🆕 新谋' },
            { m: 'edit' as ViewMode, label: '📋 当前计划' },
            { m: 'history' as ViewMode, label: '📜 谋断录' },
          ]).map(nav => (
            <button
              key={nav.m}
              style={S.navBtn(mode === nav.m)}
              onClick={() => {
                if (nav.m === 'edit' && !activePlanId) {
                  // if no active plan, go to create
                  setMode('create')
                  return
                }
                setMode(nav.m)
              }}
            >
              {nav.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={S.body}>
        {/* ─── CREATE MODE ─── */}
        {mode === 'create' && (
          <>
            {/* template selection */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={S.sectionTitle}>选择模板快速开始</span>
                <button
                  style={S.btn('ghost', true)}
                  onClick={() => setShowTemplates(!showTemplates)}
                >
                  {showTemplates ? '收起' : '展开'}
                </button>
              </div>
              {showTemplates && (
                <div style={S.templateGrid}>
                  {TEMPLATES.map(tpl => (
                    <div
                      key={tpl.id}
                      style={S.templateCard}
                      onClick={() => applyTemplate(tpl)}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#7c6fa8' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#3a3c46' }}
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
                onChange={e => setNewTitle(e.target.value)}
                placeholder="计划名称（可选）"
              />
              <textarea
                style={{ ...S.textarea, marginBottom: '8px' }}
                value={newGoal}
                onChange={e => setNewGoal(e.target.value)}
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
                        {i > 0 && <span style={S.dragHandle} onClick={() => moveStep(step.id, -1)}>▲</span>}
                        {i < editingSteps.length - 1 && <span style={S.dragHandle} onClick={() => moveStep(step.id, 1)}>▼</span>}
                        <span style={{ ...S.dragHandle, color: 'var(--danger)' }} onClick={() => removeStep(step.id)}>✕</span>
                      </div>
                    </div>
                    <div style={S.stepDesc}>{step.description}</div>
                  </div>
                ))}

                {/* add step inline */}
                <div style={{ marginTop: '10px', borderTop: '1px solid #3a3c46', paddingTop: '10px' }}>
                  <label style={S.label}>添加步骤</label>
                  <input
                    style={S.input}
                    value={draftStepTitle}
                    onChange={e => setDraftStepTitle(e.target.value)}
                    placeholder="步骤标题"
                    onKeyDown={e => { if (e.key === 'Enter') addStep() }}
                  />
                  <input
                    style={S.input}
                    value={draftStepDesc}
                    onChange={e => setDraftStepDesc(e.target.value)}
                    placeholder="步骤描述"
                    onKeyDown={e => { if (e.key === 'Enter') addStep() }}
                  />
                  <button style={S.btn('ghost', true)} onClick={addStep}>+ 添加步骤</button>
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
                onClick={createPlan}
              >
                🏯 开谋定策
              </button>
              {editingSteps.length > 0 && (
                <button style={S.btn('ghost')} onClick={resetCreate}>清空</button>
              )}
            </div>
          </>
        )}

        {/* ─── EDIT/VIEW MODE ─── */}
        {mode === 'edit' && activePlan && (
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
                  <button style={S.btn('ghost', true)} onClick={() => changePlanStatus(activePlan.id, 'paused')}>⏸ 暂停计划</button>
                )}
                {activePlan.status === 'paused' && (
                  <button style={S.btn('primary', true)} onClick={() => changePlanStatus(activePlan.id, 'active')}>▶ 继续计划</button>
                )}
                {activePlan.status === 'active' && (
                  <button style={S.btn('green', true)} onClick={() => changePlanStatus(activePlan.id, 'completed')}>✔ 全部完成</button>
                )}
                {(activePlan.status === 'completed' || activePlan.status === 'paused') && (
                  <button style={S.btn('ghost', true)} onClick={() => changePlanStatus(activePlan.id, 'archived')}>📦 归档</button>
                )}
                {activePlan.status === 'archived' && (
                  <button style={S.btn('ghost', true)} onClick={() => changePlanStatus(activePlan.id, 'active')}>📂 恢复</button>
                )}
                <button
                  style={{ ...S.btn('danger', true), marginLeft: 'auto' }}
                  onClick={() => setDeleteConfirm(activePlan.id)}
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
                    <button style={S.btn('danger', true)} onClick={() => deletePlan(activePlan.id)}>确认删除</button>
                    <button style={S.btn('ghost', true)} onClick={() => setDeleteConfirm(null)}>取消</button>
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
                  onStatusChange={(sid, st) => changeStepStatus(activePlan.id, sid, st)}
                  onNotesChange={(sid, notes) => changeStepNotes(activePlan.id, sid, notes)}
                  onMoveUp={(sid) => moveStepInPlan(activePlan.id, sid, -1)}
                  onMoveDown={(sid) => moveStepInPlan(activePlan.id, sid, 1)}
                  onDelete={(sid) => deleteStepFromPlan(activePlan.id, sid)}
                  readOnly={activePlan.status === 'archived'}
                />
              ))}
            </div>
          </>
        )}

        {/* ─── edit fallback (no plan selected) ─── */}
        {mode === 'edit' && !activePlan && (
          <div style={S.empty}>
            <div style={S.emptyIcon}>📋</div>
            <div style={S.emptyText}>
              尚未选择计划<br />
              <button style={{ ...S.btn('primary', true), marginTop: '12px' }} onClick={() => setMode('create')}>
                🆕 创建新谋断
              </button>
              <span style={{ margin: '0 8px', color: '#555' }}>或者</span>
              <button style={{ ...S.btn('ghost', true), marginTop: '12px' }} onClick={() => setMode('history')}>
                📜 浏览谋断录
              </button>
            </div>
          </div>
        )}

        {/* ─── HISTORY MODE ─── */}
        {mode === 'history' && (
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
                <button style={S.btn('primary')} onClick={() => setMode('create')}>
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
                  borderColor: plan.id === activePlanId ? '#7c6fa8' : '#3a3c46',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1, minWidth: 0 }} onClick={() => viewPlan(plan.id)}>
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
                        onClick={e => { e.stopPropagation(); setDeleteConfirm(plan.id) }}
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
                        <button style={S.btn('danger', true)} onClick={(e) => { e.stopPropagation(); deletePlan(plan.id) }}>确认</button>
                        <button style={S.btn('ghost', true)} onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null) }}>取消</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

export default PlanningView
