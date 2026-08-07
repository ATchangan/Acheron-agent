import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { PlanStep, StepStatus, PlanStatus, ViewMode, Plan, PlanTemplate } from './plan-utils'
import { TEMPLATES, PLAN_PREFIX, uid, planUid, tsLabel, progressPct, PLAN_STATUS_LABELS } from './plan-utils'
import { S } from './plan-styles'
import { PlanCreateForm } from './PlanCreateForm'
import { PlanRunView } from './PlanRunView'
import { PlanListView } from './PlanListView'

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
  return (
    <div style={S.root}>
      {/* HEADER */}
      <div style={S.header}>
        <div style={S.titleRow}>
          <span style={S.icon}>??</span>
          <div>
            <h1 style={S.title}>? ????</h1>
            <p style={S.subtitle}>????? ? ?????</p>
          </div>
        </div>

        {/* navigation */}
        <div style={S.navRow}>
          {([
            { m: 'create' as ViewMode, label: '?? ??' },
            { m: 'edit' as ViewMode, label: '?? ????' },
            { m: 'history' as ViewMode, label: '?? ???' },
          ]).map(nav => (
            <button
              key={nav.m}
              style={S.navBtn(mode === nav.m)}
              onClick={() => {
                if (nav.m === 'edit' && !activePlanId) {
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

      {/* BODY */}
      <div style={S.body}>
        {mode === 'create' && (
          <PlanCreateForm
            showTemplates={showTemplates}
            newTitle={newTitle}
            newGoal={newGoal}
            editingSteps={editingSteps}
            draftStepTitle={draftStepTitle}
            draftStepDesc={draftStepDesc}
            onToggleTemplates={() => setShowTemplates(v => !v)}
            onApplyTemplate={applyTemplate}
            onTitle={setNewTitle}
            onGoal={setNewGoal}
            onMoveStep={moveStep}
            onRemoveStep={removeStep}
            onDraftTitle={setDraftStepTitle}
            onDraftDesc={setDraftStepDesc}
            onAddStep={addStep}
            onCreate={createPlan}
            onReset={resetCreate}
          />
        )}

        {mode === 'edit' && (
          <PlanRunView
            activePlan={activePlan}
            deleteConfirm={deleteConfirm}
            onChangeStatus={(status) => activePlan && changePlanStatus(activePlan.id, status)}
            onDelete={() => activePlan && deletePlan(activePlan.id)}
            onSetDeleteConfirm={setDeleteConfirm}
            onStepStatusChange={(sid, st) => activePlan && changeStepStatus(activePlan.id, sid, st)}
            onNotesChange={(sid, notes) => activePlan && changeStepNotes(activePlan.id, sid, notes)}
            onMoveUp={(sid) => activePlan && moveStepInPlan(activePlan.id, sid, -1)}
            onMoveDown={(sid) => activePlan && moveStepInPlan(activePlan.id, sid, 1)}
            onDeleteStep={(sid) => activePlan && deleteStepFromPlan(activePlan.id, sid)}
            onGoCreate={() => setMode('create')}
            onGoHistory={() => setMode('history')}
          />
        )}

        {mode === 'history' && (
          <PlanListView
            plans={plans}
            loading={loading}
            activePlanId={activePlanId}
            deleteConfirm={deleteConfirm}
            onViewPlan={viewPlan}
            onDelete={deletePlan}
            onSetDeleteConfirm={setDeleteConfirm}
            onGoCreate={() => setMode('create')}
          />
        )}
      </div>
    </div>
  )
}

export default PlanningView
