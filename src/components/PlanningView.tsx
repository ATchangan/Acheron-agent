import React, { useState, useEffect, useCallback, useMemo } from 'react'

// ═══════════════════════════════════════════════════════════════
// 黄泉谋断阁 · Autonomous Planning View
// ═══════════════════════════════════════════════════════════════

// ─── types ─────────────────────────────────────────────────
type StepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked'
type PlanStatus = 'active' | 'paused' | 'completed' | 'archived'
type ViewMode = 'create' | 'edit' | 'history'

interface PlanStep {
  id: string
  title: string
  description: string
  status: StepStatus
  dependencies: string[]
  notes: string
}

interface Plan {
  id: string
  title: string
  goal: string
  steps: PlanStep[]
  status: PlanStatus
  createdAt: number
  updatedAt: number
}

interface PlanTemplate {
  id: string
  title: string
  icon: string
  goal: string
  steps: Omit<PlanStep, 'id' | 'status' | 'notes'>[]
}

// ─── template library ──────────────────────────────────────
const TEMPLATES: PlanTemplate[] = [
  {
    id: 'code-project',
    title: '代码项目创建',
    icon: '💻',
    goal: '从零搭建一个完整的代码项目',
    steps: [
      { title: '项目需求分析', description: '明确项目目标、功能需求和技术约束，编写需求文档', dependencies: [] },
      { title: '技术栈选型', description: '根据需求选择编程语言、框架、数据库和工具链', dependencies: ['step_0'] },
      { title: '项目脚手架搭建', description: '初始化项目结构、配置构建工具和依赖管理', dependencies: ['step_1'] },
      { title: '核心模块开发', description: '实现核心业务逻辑、API接口和数据结构', dependencies: ['step_2'] },
      { title: '测试与质量保障', description: '编写单元测试、集成测试，进行代码审查', dependencies: ['step_3'] },
      { title: '部署与文档', description: '配置 CI/CD、编写 README 和 API 文档，部署上线', dependencies: ['step_4'] },
    ],
  },
  {
    id: 'doc-writing',
    title: '文档撰写',
    icon: '📝',
    goal: '撰写一份高质量的技术文档或文章',
    steps: [
      { title: '选题与大纲', description: '确定文档主题、目标读者和内容大纲', dependencies: [] },
      { title: '资料收集', description: '收集相关资料、参考文档和示例代码', dependencies: ['step_0'] },
      { title: '初稿撰写', description: '按照大纲完成初稿，先求完整再求完美', dependencies: ['step_1'] },
      { title: '审阅修订', description: '检查逻辑、语法和格式，补充遗漏，优化表达', dependencies: ['step_2'] },
      { title: '发布与反馈', description: '排版发布，收集读者反馈，持续迭代', dependencies: ['step_3'] },
    ],
  },
  {
    id: 'data-analysis',
    title: '数据分析',
    icon: '📊',
    goal: '完成一个端到端的数据分析任务',
    steps: [
      { title: '问题定义', description: '明确分析目标、关键指标和预期产出', dependencies: [] },
      { title: '数据采集与清洗', description: '收集原始数据，处理缺失值、异常值和格式问题', dependencies: ['step_0'] },
      { title: '探索性分析', description: '通过可视化和统计方法发现数据特征和规律', dependencies: ['step_1'] },
      { title: '建模与验证', description: '选择合适的模型进行分析，交叉验证结果', dependencies: ['step_2'] },
      { title: '结论与报告', description: '整理分析结论，制作可视化报告和行动建议', dependencies: ['step_3'] },
    ],
  },
  {
    id: 'study-plan',
    title: '学习计划',
    icon: '📚',
    goal: '系统学习一门新技术或知识领域',
    steps: [
      { title: '学习目标设定', description: '明确学习范围、时间投入和期望达到的水平', dependencies: [] },
      { title: '资源筛选', description: '挑选优质教材、课程、文档和实践项目', dependencies: ['step_0'] },
      { title: '基础概念掌握', description: '系统学习核心概念、原理和基础技能', dependencies: ['step_1'] },
      { title: '实战练习', description: '通过项目、习题或案例分析巩固所学知识', dependencies: ['step_2'] },
      { title: '总结与输出', description: '整理学习笔记、撰写总结文章或分享演示', dependencies: ['step_3'] },
    ],
  },
]

const STATUS_LABELS: Record<StepStatus, string> = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
}
const STATUS_ICONS: Record<StepStatus, string> = {
  pending: '○',
  in_progress: '◉',
  completed: '✔',
  blocked: '⊘',
}
const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
}

// ─── helpers ──────────────────────────────────────────────
let _idCounter = 0
function uid(): string {
  _idCounter++
  return `step_${Date.now()}_${_idCounter}_${Math.random().toString(36).slice(2, 8)}`
}

function planUid(): string {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function tsLabel(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${day} ${hh}:${mm}`
}

function progressPct(steps: PlanStep[]): number {
  if (steps.length === 0) return 0
  const done = steps.filter(s => s.status === 'completed').length
  return Math.round((done / steps.length) * 100)
}

const PLAN_PREFIX = '[plan]'

// ─── styles ───────────────────────────────────────────────
const S = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#17181c',
    color: 'var(--text-primary)',
    overflow: 'hidden',
  },
  // header
  header: { padding: '20px 24px 0', flexShrink: 0 },
  titleRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  icon: { fontSize: '28px' },
  title: { fontSize: '20px', fontWeight: 600 as const, color: 'var(--text-primary)', margin: 0 },
  subtitle: { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' },
  // tabs
  navRow: {
    display: 'flex',
    gap: '4px',
    marginTop: '14px',
    borderBottom: '1px solid #3a3c46',
    paddingBottom: '8px',
  },
  navBtn: (active: boolean) => ({
    padding: '5px 14px',
    borderRadius: '6px',
    border: 'none',
    background: active ? 'rgba(124,111,168,.15)' : 'transparent',
    color: active ? '#7c6fa8' : '#9999AA',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: active ? (600 as const) : (400 as const),
    transition: 'all .12s',
  }),
  // body
  body: { flex: 1, overflowY: 'auto' as const, padding: '0 24px 24px' },
  // cards
  card: {
    background: '#23252b',
    border: '1px solid #3a3c46',
    borderRadius: '10px',
    padding: '16px',
    marginBottom: '10px',
  },
  cardSm: {
    background: '#23252b',
    border: '1px solid #3a3c46',
    borderRadius: '8px',
    padding: '10px 14px',
    marginBottom: '6px',
    cursor: 'pointer',
    transition: 'border-color .15s',
  },
  // inputs
  input: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#1d1e24',
    border: '1px solid #3a3c46',
    borderRadius: '6px',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    fontSize: '13px',
    outline: 'none',
    marginBottom: '8px',
  } as React.CSSProperties,
  textarea: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#1d1e24',
    border: '1px solid #3a3c46',
    borderRadius: '6px',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    fontSize: '12px',
    outline: 'none',
    resize: 'vertical' as const,
    minHeight: '80px',
    fontFamily: 'inherit',
  },
  // buttons
  btn: (variant: 'primary' | 'danger' | 'ghost' | 'green', small?: boolean) => ({
    padding: small ? '4px 10px' : '7px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: small ? '11px' : '12px',
    fontWeight: 600 as const,
    transition: 'all .12s',
    background:
      variant === 'primary' ? '#7c6fa8'
      : variant === 'danger' ? '#C23B22'
      : variant === 'green' ? '#2D6A4F'
      : 'transparent',
    color:
      variant === 'ghost' ? '#9999AA' : '#E8E8F0',
    border: variant === 'ghost' ? '1px solid #3a3c46' : 'none',
  }),
  // progress bar
  progressBarOuter: {
    height: '6px',
    background: '#3a3c46',
    borderRadius: '3px',
    margin: '8px 0',
    overflow: 'hidden',
  },
  progressBarInner: (pct: number) => ({
    height: '100%',
    width: `${pct}%`,
    background: pct < 100 ? '#7c6fa8' : '#2D6A4F',
    borderRadius: '3px',
    transition: 'width .3s ease',
  }),
  // step card
  stepCard: (status: StepStatus) => ({
    background: '#23252b',
    border: `1px solid ${
      status === 'completed' ? '#2D6A4F'
      : status === 'in_progress' ? '#7c6fa8'
      : status === 'blocked' ? '#C23B22'
      : '#3a3c46'
    }`,
    borderRadius: '8px',
    padding: '12px 14px',
    marginBottom: '8px',
    transition: 'border-color .2s',
    position: 'relative' as const,
  }),
  stepHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  stepStatusBadge: (status: StepStatus) => ({
    fontSize: '10px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontWeight: 600 as const,
    background:
      status === 'completed' ? 'rgba(45,106,79,.20)'
      : status === 'in_progress' ? 'rgba(124,111,168,.25)'
      : status === 'blocked' ? 'rgba(194,59,34,.20)'
      : 'rgba(153,153,170,.12)',
    color:
      status === 'completed' ? '#48c98a'
      : status === 'in_progress' ? '#9488bc'
      : status === 'blocked' ? '#e05540'
      : '#9999AA',
    flexShrink: 0,
  }),
  stepTitle: (status: StepStatus) => ({
    fontSize: '13px',
    fontWeight: 600 as const,
    color: status === 'completed' ? '#9999AA' : '#E8E8F0',
    textDecoration: status === 'completed' ? 'line-through' : 'none',
  }),
  stepDesc: { fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.5 },
  stepActions: {
    display: 'flex',
    gap: '4px',
    marginTop: '8px',
    flexWrap: 'wrap' as const,
  },
  // timeline connector
  timelineDot: (status: StepStatus) => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
    background:
      status === 'completed' ? '#2D6A4F'
      : status === 'in_progress' ? '#7c6fa8'
      : status === 'blocked' ? '#C23B22'
      : '#3a3c46',
    border: `2px solid ${
      status === 'completed' ? '#48c98a'
      : status === 'in_progress' ? '#9488bc'
      : status === 'blocked' ? '#e05540'
      : '#555'
    }`,
    transition: 'all .25s',
  }),
  timelineLine: { width: '2px', height: '24px', background: '#3a3c46', marginLeft: '4px' },
  // labels
  label: { fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' } as React.CSSProperties,
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600 as const,
    color: 'var(--text-primary)',
    margin: '16px 0 8px',
  },
  // notes
  notesArea: {
    background: '#1d1e24',
    border: '1px solid #3a3c46',
    borderRadius: '4px',
    padding: '6px 8px',
    fontSize: '11px',
    color: 'var(--text-secondary)',
    marginTop: '6px',
    fontStyle: 'italic' as const,
  },
  // empty
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 24px',
    color: 'var(--text-secondary)',
    gap: '12px',
  },
  emptyIcon: { fontSize: '48px', opacity: 0.4 },
  emptyText: { fontSize: '13px', textAlign: 'center' as const, lineHeight: 1.6 },
  // template grid
  templateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '10px',
  },
  templateCard: {
    background: '#23252b',
    border: '1px solid #3a3c46',
    borderRadius: '8px',
    padding: '14px',
    cursor: 'pointer',
    transition: 'border-color .15s, background .15s',
  },
  templateIcon: { fontSize: '24px', marginBottom: '6px' },
  templateTitle: { fontSize: '13px', fontWeight: 600 as const, color: 'var(--text-primary)' },
  templateCount: { fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' },
  // plan card in history
  planCardStatus: (status: PlanStatus) => ({
    fontSize: '10px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontWeight: 600 as const,
    background:
      status === 'active' ? 'rgba(124,111,168,.25)'
      : status === 'paused' ? 'rgba(153,153,170,.15)'
      : status === 'completed' ? 'rgba(45,106,79,.20)'
      : 'rgba(153,153,170,.10)',
    color:
      status === 'active' ? '#9488bc'
      : status === 'paused' ? '#9999AA'
      : status === 'completed' ? '#48c98a'
      : '#666',
    flexShrink: 0,
  }),
  // reorder indicators
  dragHandle: {
    cursor: 'grab',
    color: '#555',
    fontSize: '14px',
    padding: '0 4px',
    userSelect: 'none' as const,
  },
  confirmOverlay: {
    background: '#23252b',
    border: '1px solid #C23B22',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '8px',
  },
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

// ─── StepCard ──────────────────────────────────────────────
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
              <span style={{ ...S.dragHandle, color: '#C23B22' }} onClick={() => onDelete(step.id)} title="删除">✕</span>
            </div>
          )}
        </div>

        {/* description */}
        <div style={S.stepDesc}>{step.description}</div>

        {/* dependencies */}
        {step.dependencies.length > 0 && (
          <div style={{ marginTop: '6px' }}>
            <span style={{ fontSize: '10px', color: 'var(--accent)' }}>
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

// ─── ProgressHeader ────────────────────────────────────────
const ProgressHeader: React.FC<{ steps: PlanStep[]; status: PlanStatus }> = ({ steps, status }) => {
  const pct = progressPct(steps)
  const done = steps.filter(s => s.status === 'completed').length
  const inProg = steps.filter(s => s.status === 'in_progress').length
  const blocked = steps.filter(s => s.status === 'blocked').length

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
          {PLAN_STATUS_LABELS[status]} · 进度 {pct}%
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
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
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

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
    } catch { /* ignore */ }
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
          } catch { /* skip corrupted */ }
        }
      }
      parsed.sort((a, b) => b.updatedAt - a.updatedAt)
      setPlans(parsed)
    } catch { /* ignore */ }
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
                        <span style={{ ...S.dragHandle, color: '#C23B22' }} onClick={() => removeStep(step.id)}>✕</span>
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
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {activePlan.goal}
                  </div>
                  <div style={{ fontSize: '10px', color: '#555', marginTop: '4px' }}>
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
                  <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginBottom: '8px' }}>
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
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '8px' }}>
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
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        🏯 {plan.title}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {plan.goal}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                        <div style={{ flex: 1, ...S.progressBarOuter, margin: 0, height: '4px' }}>
                          <div style={{ ...S.progressBarInner(pct), height: '4px' }} />
                        </div>
                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)', flexShrink: 0 }}>
                          {done}/{plan.steps.length}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, marginLeft: '12px' }}>
                      <span style={S.planCardStatus(plan.status)}>
                        {PLAN_STATUS_LABELS[plan.status]}
                      </span>
                      <span style={{ fontSize: '10px', color: '#555' }}>{tsLabel(plan.updatedAt)}</span>
                      <button
                        style={{ ...S.btn('danger', true), padding: '2px 6px', fontSize: '10px' }}
                        onClick={e => { e.stopPropagation(); setDeleteConfirm(plan.id) }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* delete confirm inline */}
                  {deleteConfirm === plan.id && (
                    <div style={{ ...S.confirmOverlay, marginTop: '8px', marginBottom: 0 }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-primary)', marginBottom: '6px' }}>
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
