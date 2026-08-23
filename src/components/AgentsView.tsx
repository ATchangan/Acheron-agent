// AgentsView.tsx —— v0.4.2 子代理活动面板（对齐参考 app/agents/index.tsx）
// 默认单 Agent 直接执行：没有分派活动时显示空状态；有 dispatch/任务时按行展示
// 状态图标 / 目标 / 副标题(角色·耗时·步数·更新) / 可展开步骤流
import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '../store/chat'
import { Bot, CheckCircle2, AlertCircle, ChevronRight, Loader2, Activity, Eye } from 'lucide-react'
import { fmtDur } from './work-steps'

interface TaskRecordLite {
  id: string
  sid?: string
  content: string
  model?: string
  status: 'running' | 'done' | 'failed' | 'aborted'
  startedAt: number
  updatedAt: number
  error?: string
  checkpoint?: { planSteps?: { id: string; label: string; status: string; tool?: string; detail?: string; ms?: number }[] }
}

const fmtAgo = (ts: number, now: number) => {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 2) return '刚刚'
  if (s < 60) return s + '秒前'
  const m = Math.floor(s / 60)
  if (m < 60) return m + '分钟前'
  return Math.floor(m / 60) + '小时前'
}

function StatusGlyph({ status }: { status: TaskRecordLite['status'] }) {
  if (status === 'running') return <Loader2 size={14} className="hq-spin hq-agents-status-running" />
  if (status === 'failed' || status === 'aborted') return <AlertCircle size={14} className="hq-agents-status-failed" />
  return <CheckCircle2 size={14} className="hq-agents-status-done" />
}

function StepGlyph({ status }: { status: string }) {
  if (status === 'running') return <Loader2 size={11} className="hq-spin" />
  if (status === 'failed' || status === 'aborted') return <AlertCircle size={11} />
  if (status === 'done') return <CheckCircle2 size={11} />
  return <span className={'hq-agents-step-dot' + (status === 'pending' ? ' hq-agents-step-pending' : '')} />
}

function TaskRow({ task, nowMs }: { task: TaskRecordLite; nowMs: number }) {
  const [open, setOpen] = useState(task.status === 'running')
  const running = task.status === 'running'
  const steps = task.checkpoint?.planSteps || []
  const doneSteps = steps.filter(s => s.status === 'done').length
  const duration = Math.max(0, Math.round((task.updatedAt - task.startedAt) / 1000))
  const subtitle = [
    task.model || '子代理',
    duration > 0 ? fmtDur(duration * 1000) : '',
    steps.length ? `${doneSteps}/${steps.length} 步` : '',
    fmtAgo(task.updatedAt, nowMs),
  ].filter(Boolean).join(' · ')
  const errorText = task.error ? String(task.error).slice(0, 160) : ''

  return (
    <div className="hq-agents-row">
      <button type="button" className="hq-agents-row-head" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span className="hq-agents-row-status"><StatusGlyph status={task.status} /></span>
        <span className="hq-agents-row-main">
          <span className={'hq-agents-row-goal' + (running ? ' hq-shimmer' : '')}>{task.content || '(无描述任务)'}</span>
          {subtitle && <span className="hq-agents-row-sub">{subtitle}</span>}
        </span>
        <ChevronRight size={13} className={'hq-agents-chev' + (open ? ' open' : '')} />
      </button>
      {running && task.sid && (
        <div className="hq-agents-watch">
          <button type="button" className="hq-icon-btn" title="打开任务监视窗" aria-label="打开任务监视窗" onClick={() => { if (task.sid) window.huangquan.watch.open(task.sid).catch(() => {}) }}>
            <Eye size={13} />
          </button>
        </div>
      )}
      {open && (
        <div className="hq-agents-row-detail">
          {steps.length > 0 && (
            <div className="hq-agents-steps">
              {steps.slice(-12).map(s => (
                <div key={s.id} className="hq-agents-step">
                  <span className="hq-agents-step-glyph"><StepGlyph status={s.status} /></span>
                  <span className="hq-agents-step-label">{s.label}</span>
                  {s.tool && <span className="hq-agents-step-tool">{s.tool}</span>}
                  {s.ms != null && <span className="hq-agents-step-dur">{fmtDur(s.ms)}</span>}
                </div>
              ))}
            </div>
          )}
          {steps.length === 0 && running && <div className="hq-agents-step-wait">正在启动子代理…</div>}
          {errorText && <div className="hq-agents-error">{errorText}</div>}
        </div>
      )}
    </div>
  )
}

export default function AgentsView() {
  const activeAgents = useChatStore(s => s.activeAgents)
  const [tasks, setTasks] = useState<TaskRecordLite[]>([])
  const [nowMs, setNowMs] = useState(Date.now())

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const list = await window.huangquan.tasks.list()
        if (alive) setTasks(list as TaskRecordLite[])
      } catch { /* 忽略 */ }
    }
    void load()
    const id = window.setInterval(load, 4000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  const runningCount = tasks.filter(t => t.status === 'running').length + activeAgents.length
  useEffect(() => {
    if (runningCount <= 0) return
    const id = window.setInterval(() => setNowMs(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [runningCount])

  const recent = useMemo(() => tasks.slice(0, 12), [tasks])
  const runningTasks = recent.filter(t => t.status === 'running')
  const finishedTasks = recent.filter(t => t.status !== 'running')
  const failedCount = recent.filter(t => t.status === 'failed' || t.status === 'aborted').length
  const stepTotal = recent.reduce((sum, t) => sum + (t.checkpoint?.planSteps?.length || 0), 0)

  const empty = activeAgents.length === 0 && recent.length === 0
  const summary = [
    `${recent.length} 个任务`,
    runningCount > 0 ? `${runningCount} 进行中` : '',
    failedCount > 0 ? `${failedCount} 失败` : '',
    stepTotal > 0 ? `${stepTotal} 步` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className="hq-agents">
      <div className="hq-agents-head">
        <h2 className="hq-agents-title"><Bot size={16} /> 子代理</h2>
        <span className="hq-agents-subtitle">协作任务与分派活动 · 默认由主 Agent 直接执行</span>
      </div>

      {empty ? (
        <div className="hq-agents-empty">
          <Activity size={34} className="hq-agents-empty-icon" />
          <p className="hq-agents-empty-title">暂无子代理活动</p>
          <p className="hq-agents-empty-desc">
            当前为单 Agent 直接执行，所有工作都由主助手完成。
            需要并行协作时，在对话中让助手使用 dispatch 分派子任务，这里会实时展示子代理的运行状态。
          </p>
        </div>
      ) : (
        <>
          {summary && <p className="hq-agents-summary">{summary}</p>}
          <div className="hq-agents-list">
            {activeAgents.length > 0 && (
              <div className="hq-agents-section">
                <div className="hq-agents-section-label">并行角色</div>
                <div className="hq-agents-chips">
                  {activeAgents.map(a => (
                    <span key={a} className="hq-agents-chip"><span className="hq-agents-chip-dot" />{a}</span>
                  ))}
                </div>
              </div>
            )}
            {runningTasks.length > 0 && (
              <div className="hq-agents-section">
                <div className="hq-agents-section-label">进行中</div>
                {runningTasks.map(t => <TaskRow key={t.id} task={t} nowMs={nowMs} />)}
              </div>
            )}
            {finishedTasks.length > 0 && (
              <div className="hq-agents-section">
                <div className="hq-agents-section-label">最近完成</div>
                {finishedTasks.map(t => <TaskRow key={t.id} task={t} nowMs={nowMs} />)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
