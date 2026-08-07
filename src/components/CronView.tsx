// CronView.tsx —— 定时任务页（状态编排；表单/过滤/列表已拆至子组件）
import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { CronJob, MemoryData } from '../global'
import { HourglassMark } from './themed-icons'
import { isToday, type TaskMeta, type FilterTab } from './cron-utils'
import { S } from './cron-styles'
import { CronTaskForm } from './CronTaskForm'
import { CronFilterBar } from './CronFilterBar'
import { CronTaskList } from './CronTaskList'

const api = () => window.huangquan

export default function CronView() {
  const [tasks, setTasks] = useState<CronJob[]>([])
  const [meta, setMeta] = useState<TaskMeta>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [tick, setTick] = useState(0)

  // create form
  const [newName, setNewName] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newExpr, setNewExpr] = useState('every 30m')
  const [customExpr, setCustomExpr] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [adding, setAdding] = useState(false)

  // delete confirm
  const [delId, setDelId] = useState<string | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)

  // tick for countdown
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(iv)
  }, [])

  // load
  const load = useCallback(async () => {
    try {
      setLoading(true)
      const jobs: CronJob[] = await api().cron.list()
      setTasks(jobs || [])
      const mem = await api().memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [], episodic: [], goals: [] }))
      const metaFact = (mem.facts || []).find((f: string) => f.startsWith('[cron_meta]'))
      if (metaFact) {
        try {
          const parsed = JSON.parse(metaFact.slice('[cron_meta]'.length))
          setMeta(parsed || {})
        } catch { setMeta({}) }
      } else {
        setMeta({})
      }
    } catch {
      setTasks([])
      setMeta({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // persist meta
  const persistMeta = useCallback(async (next: TaskMeta) => {
    setMeta(next)
    try {
      const mem = await api().memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [], episodic: [], goals: [] }))
      const facts: string[] = (mem.facts || []).filter((f: string) => !f.startsWith('[cron_meta]'))
      facts.push('[cron_meta]' + JSON.stringify(next))
      await api().memory.save({ facts, summaries: mem.summaries || [] })
    } catch (e) { console.debug('[swallow]', e) }
  }, [])

  // add
  const addTask = useCallback(async () => {
    const name = newName.trim()
    const prompt = newPrompt.trim()
    const expr = showCustom ? customExpr.trim() : newExpr
    if (!name || !prompt || !expr) return
    setAdding(true)
    try {
      const cr = await api().cron.add(expr, prompt); const id: string = cr?.id || ''
      const nextMeta = { ...meta, [id]: { name, lastRun: null } }
      await persistMeta(nextMeta)
      setNewName('')
      setNewPrompt('')
      setShowCustom(false)
      setCustomExpr('')
      await load()
    } catch { /* silent */ } finally {
      setAdding(false)
    }
  }, [newName, newPrompt, newExpr, customExpr, showCustom, meta, persistMeta, load])

  // toggle
  const toggleTask = useCallback(async (id: string) => {
    try {
      await api().cron.toggle(id)
      await load()
    } catch (e) { console.debug('[swallow]', e) }
  }, [load])

  // remove
  const removeTask = useCallback(async (id: string) => {
    try {
      await api().cron.remove(id)
      const nextMeta = { ...meta }
      delete nextMeta[id]
      await persistMeta(nextMeta)
      setDelId(null)
      await load()
    } catch (e) { console.debug('[swallow]', e) }
  }, [meta, persistMeta, load])

  // apply template
  const applyTemplate = useCallback((tpl: { name: string; expr: string; prompt: string }) => {
    setNewName(tpl.name)
    setNewExpr(tpl.expr)
    setNewPrompt(tpl.prompt)
    setShowCustom(false)
    setCustomExpr('')
    nameRef.current?.focus()
  }, [])

  const stats = {
    total: tasks.length,
    enabled: tasks.filter((t) => t.enabled).length,
    disabled: tasks.filter((t) => !t.enabled).length,
    today: tasks.filter((t) => {
      const m = meta[t.id]
      return m && m.lastRun ? isToday(m.lastRun) : false
    }).length,
  }

  return (
    <div style={S.root}>
      {/* header */}
      <div style={S.header}>
        <div style={S.titleRow}>
          <span style={S.icon}><HourglassMark size={28} /></span>
          <h2 style={S.title}>定时任务</h2>
        </div>
        <p style={S.subtitle}>定时任务 · 到点即行</p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>设定名称、时距与内容，到点自动执行；可一键套用下方模板</p>
      </div>

      {/* body */}
      <div style={S.body}>
        <CronTaskForm
          state={{ name: newName, prompt: newPrompt, expr: newExpr, customExpr, showCustom, adding }}
          nameRef={nameRef}
          onChange={(patch) => {
            if (patch.name !== undefined) setNewName(patch.name)
            if (patch.prompt !== undefined) setNewPrompt(patch.prompt)
            if (patch.expr !== undefined) setNewExpr(patch.expr)
            if (patch.customExpr !== undefined) setCustomExpr(patch.customExpr)
            if (patch.showCustom !== undefined) setShowCustom(patch.showCustom)
            if (patch.adding !== undefined) setAdding(patch.adding)
          }}
          onAdd={addTask}
          onApplyTemplate={applyTemplate}
        />
        <CronFilterBar filter={filter} stats={stats} onFilter={setFilter} />
        <CronTaskList
          tasks={tasks}
          meta={meta}
          filter={filter}
          loading={loading}
          delId={delId}
          onToggle={toggleTask}
          onDelete={setDelId}
          onCancelDelete={() => setDelId(null)}
          onConfirmDelete={removeTask}
        />
      </div>
    </div>
  )
}
