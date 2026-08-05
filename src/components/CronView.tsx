import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { CronJob, MemoryData } from '../global'

// ─── 型 ──────────────────────────────────────────────


interface TaskMeta {
  [id: string]: { name: string; lastRun: number | null }
}

type FilterTab = 'all' | 'enabled' | 'disabled' | 'today'

// ─── 常数 ────────────────────────────────────────────
const EXPR_PRESETS = [
  { label: '每分钟', value: 'every 1m' },
  { label: '每5分钟', value: 'every 5m' },
  { label: '每30分钟', value: 'every 30m' },
  { label: '每小时', value: 'every 1h' },
  { label: '每天 9:00', value: 'at 09:00' },
  { label: '每天 18:00', value: 'at 18:00' },
  { label: '每周一 9:00', value: 'at 09:00' },
]

const TEMPLATES = [
  { name: '每日早报', expr: 'at 08:00', prompt: '生成今日早报，包含天气、新闻摘要、日程提醒和建议。' },
  { name: '系统巡检', expr: 'every 30m', prompt: '执行系统巡检：检查CPU、内存、磁盘使用率，报告异常指标。' },
  { name: '邮件摘要', expr: 'every 1h', prompt: '检查收件箱新邮件，生成简要摘要并按重要程度排序。' },
  { name: '知识复习', expr: 'at 18:00', prompt: '从记忆库中随机抽取3条知识条目进行复习回顾。' },
  { name: '备份提醒', expr: 'at 17:00', prompt: '检查最新备份时间，如超过24小时未备份则发出提醒。' },
]

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已禁用' },
  { value: 'today', label: '今天执行过' },
]

// ─── helper ──────────────────────────────────────────
const api = () => window.huangquan

function exprLabel(expr: string): string {
  const p = EXPR_PRESETS.find((e) => e.value === expr)
  if (p) return p.label
  if (expr.startsWith('every ')) {
    const rest = expr.slice(6)
    const n = parseInt(rest)
    if (rest.endsWith('m')) return `每${n}分钟`
    if (rest.endsWith('h')) return `每${n}小时`
  }
  if (expr.startsWith('at ')) return `每日 ${expr.slice(3)}`
  return expr
}

function relativeTime(ts: number): string {
  if (!ts) return '—'
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const sign = diff >= 0 ? '' : '前'
  const mins = Math.floor(abs / 60000)
  const hrs = Math.floor(abs / 3600000)
  const days = Math.floor(abs / 86400000)
  if (days > 0) return `${days}天${sign}`
  if (hrs > 0) return `${hrs}小时${mins % 60}分${sign}`
  if (mins > 0) return `${mins}分${sign}`
  return `刚刚`
}

function countdown(ts: number): string {
  if (!ts) return '—'
  const diff = ts - Date.now()
  if (diff <= 0) return '即将执行'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (h > 0) return `${h}时${m}分${s}秒`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

function fmtTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const time = `${hh}:${mm}:${ss}`
  if (isToday) return `今日 ${time}`
  const MM = String(d.getMonth() + 1).padStart(2, '0')
  const DD = String(d.getDate()).padStart(2, '0')
  return `${MM}/${DD} ${time}`
}

function isToday(ts: number): boolean {
  if (!ts) return false
  return new Date(ts).toDateString() === new Date().toDateString()
}

// ─── style ───────────────────────────────────────────
const S = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#17181c',
    color: 'var(--text-primary)',
    overflow: 'hidden',
  },
  header: {
    padding: '20px 24px 0',
    flexShrink: 0,
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '4px',
  },
  icon: { fontSize: '28px' },
  title: { fontSize: '20px', fontWeight: 600 as const, color: 'var(--text-primary)', margin: 0 },
  subtitle: { fontSize: '12px', color: 'var(--text-secondary)' },
  // body
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px 24px 24px',
  },
  // create section
  createCard: {
    background: '#23252b',
    border: '1px solid #3a3c46',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '16px',
  },
  createTitle: {
    fontSize: '14px',
    fontWeight: 600 as const,
    color: 'var(--warning)',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  createRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '10px',
    flexWrap: 'wrap' as const,
  },
  input: {
    background: '#1d1e24',
    border: '1px solid #3a3c46',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '13px',
    outline: 'none',
    flex: 1,
    minWidth: '120px',
  },
  inputSmall: {
    background: '#1d1e24',
    border: '1px solid #3a3c46',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '13px',
    outline: 'none',
    flex: 2,
    minWidth: '150px',
  },
  select: {
    background: '#1d1e24',
    border: '1px solid #3a3c46',
    color: 'var(--text-primary)',
    padding: '8px 10px',
    borderRadius: '6px',
    fontSize: '13px',
    outline: 'none',
    cursor: 'pointer',
    minWidth: '130px',
  },
  btnPrimary: {
    padding: '8px 20px',
    borderRadius: '6px',
    border: 'none',
    background: '#7c6fa8',
    color: 'var(--text-primary)',
    fontSize: '13px',
    fontWeight: 600 as const,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  btnGhost: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #3a3c46',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '11px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  // preset chips
  presetRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap' as const,
    marginBottom: '12px',
  },
  presetChip: (active: boolean) => ({
    padding: '4px 10px',
    borderRadius: '14px',
    border: active ? '1px solid #7c6fa8' : '1px solid #3a3c46',
    background: active ? 'rgba(124,111,168,0.2)' : 'transparent',
    color: active ? '#E8E8F0' : '#9999AA',
    fontSize: '11px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'all .12s',
  }),
  // template section
  templateSection: {
    marginBottom: '12px',
  },
  templateLabel: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    marginBottom: '6px',
  },
  templateRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap' as const,
  },
  templateChip: {
    padding: '5px 12px',
    borderRadius: '14px',
    border: '1px solid #4a4c58',
    background: 'rgba(212, 175, 55, 0.08)',
    color: 'var(--warning)',
    fontSize: '11px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  // filter tabs
  filterRow: {
    display: 'flex',
    gap: '4px',
    marginBottom: '12px',
    borderBottom: '1px solid #3a3c46',
    paddingBottom: '8px',
  },
  filterTab: (active: boolean) => ({
    padding: '5px 14px',
    borderRadius: '6px',
    border: 'none',
    background: active ? 'rgba(var(--skin-accent),.15)' : 'transparent',
    color: active ? '#7c6fa8' : '#9999AA',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: active ? (600 as const) : (400 as const),
    transition: 'all .12s',
  }),
  // stats
  statsBar: {
    display: 'flex',
    gap: '12px',
    marginBottom: '12px',
    flexWrap: 'wrap' as const,
  },
  statChip: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    background: '#262830',
    border: '1px solid #3a3c46',
    borderRadius: '6px',
    padding: '5px 12px',
  },
  statNum: { fontWeight: 700 as const, color: 'var(--accent)', marginRight: '4px' },
  // task card
  card: (enabled: boolean) => ({
    background: '#23252b',
    border: enabled ? '2px solid #2D6A4F' : '1px solid #3a3c46',
    borderRadius: '10px',
    padding: '12px 16px',
    marginBottom: '8px',
    opacity: enabled ? 1 : 0.55,
    transition: 'all .15s',
  }),
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  cardName: {
    fontSize: '15px',
    fontWeight: 600 as const,
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusDot: (enabled: boolean) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: enabled ? 'var(--success)' : '#555',
    flexShrink: 0,
  }),
  cardActions: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  btnIcon: {
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    border: '1px solid #3a3c46',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDanger: {
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    border: '1px solid rgba(220,53,69,0.3)',
    background: 'transparent',
    color: 'var(--danger)',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // toggle switch
  toggle: (on: boolean) => ({
    position: 'relative' as const,
    width: '42px',
    height: '24px',
    borderRadius: '12px',
    background: on ? 'var(--success)' : '#4a4c58',
    cursor: 'pointer',
    transition: 'background .15s',
    border: 'none',
    flexShrink: 0,
  }),
  toggleKnob: (on: boolean) => ({
    position: 'absolute' as const,
    top: '2px',
    left: on ? '20px' : '2px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: '#E8E8F0',
    transition: 'left .15s',
  }),
  // meta row
  metaRow: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap' as const,
    marginBottom: '6px',
  },
  metaItem: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  metaLabel: { color: 'var(--text-muted)' },
  metaValue: { color: 'var(--text-primary)' },
  // countdown
  countdownBadge: {
    fontSize: '12px',
    fontWeight: 600 as const,
    color: 'var(--warning)',
    background: 'rgba(212,175,55,0.1)',
    border: '1px solid rgba(212,175,55,0.25)',
    borderRadius: '4px',
    padding: '2px 8px',
  },
  // prompt preview
  promptPreview: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: '100%',
  },
  // empty / loading
  empty: {
    textAlign: 'center' as const,
    padding: '40px 20px',
    color: 'var(--text-muted)',
    fontSize: '13px',
  },
  // confirm
  confirmOverlay: {
    background: '#23252b',
    border: '1px solid #3a3c46',
    borderRadius: '10px',
    padding: '16px',
    marginBottom: '12px',
    textAlign: 'center' as const,
  },
  confirmText: { fontSize: '13px', color: 'var(--text-primary)', marginBottom: '10px' },
  confirmBtns: { display: 'flex', gap: '8px', justifyContent: 'center' },
  btnConfirm: {
    padding: '6px 18px',
    borderRadius: '6px',
    border: 'none',
    background: 'var(--danger)',
    color: 'var(--on-accent)',
    fontSize: '12px',
    fontWeight: 600 as const,
    cursor: 'pointer',
  },
  btnCancel: {
    padding: '6px 18px',
    borderRadius: '6px',
    border: '1px solid #3a3c46',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
  },
}

// ─── component ───────────────────────────────────────
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

  // ── tick for countdown ──
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(iv)
  }, [])

  // ── load ──
  const load = useCallback(async () => {
    try {
      setLoading(true)
      const jobs: CronJob[] = await api().cron.list()
      setTasks(jobs || [])

      // load meta from memory
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

  // ── persist meta ──
  const persistMeta = useCallback(async (next: TaskMeta) => {
    setMeta(next)
    try {
      const mem = await api().memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [], episodic: [], goals: [] }))
      const facts: string[] = (mem.facts || []).filter((f: string) => !f.startsWith('[cron_meta]'))
      facts.push('[cron_meta]' + JSON.stringify(next))
      await api().memory.save({ facts, summaries: mem.summaries || [] })
    } catch (e) { /* silent */ console.debug('[swallow]', e) }
  }, [])

  // ── add ──
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
    } catch {
      // silently fail
    } finally {
      setAdding(false)
    }
  }, [newName, newPrompt, newExpr, customExpr, showCustom, meta, persistMeta, load])

  // ── toggle ──
  const toggleTask = useCallback(async (id: string) => {
    try {
      await api().cron.toggle(id)
      await load()
    } catch (e) { /* silent */ console.debug('[swallow]', e) }
  }, [load])

  // ── remove ──
  const removeTask = useCallback(async (id: string) => {
    try {
      await api().cron.remove(id)
      const nextMeta = { ...meta }
      delete nextMeta[id]
      await persistMeta(nextMeta)
      setDelId(null)
      await load()
    } catch (e) { /* silent */ console.debug('[swallow]', e) }
  }, [meta, persistMeta, load])

  // ── apply template ──
  const applyTemplate = useCallback((tpl: typeof TEMPLATES[number]) => {
    setNewName(tpl.name)
    setNewExpr(tpl.expr)
    setNewPrompt(tpl.prompt)
    setShowCustom(false)
    setCustomExpr('')
    nameRef.current?.focus()
  }, [])

  // ── filtered ──
  const filtered = tasks.filter((t) => {
    const m = meta[t.id]
    if (filter === 'enabled') return t.enabled
    if (filter === 'disabled') return !t.enabled
    if (filter === 'today') return m && m.lastRun ? isToday(m.lastRun) : false
    return true
  })

  const stats = {
    total: tasks.length,
    enabled: tasks.filter((t) => t.enabled).length,
    disabled: tasks.filter((t) => !t.enabled).length,
    today: tasks.filter((t) => {
      const m = meta[t.id]
      return m && m.lastRun ? isToday(m.lastRun) : false
    }).length,
  }

  // ── render ──
  return (
    <div style={S.root}>
      {/* header */}
      <div style={S.header}>
        <div style={S.titleRow}>
          <span style={S.icon}>🪷</span>
          <h2 style={S.title}>↻ 更漏</h2>
        </div>
        <p style={S.subtitle}>时辰更漏 · 到点即行</p>
      </div>

      {/* body */}
      <div style={S.body}>
        {/* ── create section ── */}
        <div style={S.createCard}>
          <div style={S.createTitle}>
            <span>📯</span> 新增轮回
          </div>

          {/* templates */}
          <div style={S.templateSection}>
            <div style={S.templateLabel}>📋 快速模板</div>
            <div style={S.templateRow}>
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  style={S.templateChip}
                  onClick={() => applyTemplate(tpl)}
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
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTask() }}
            />
          </div>

          {/* expression presets */}
          <div style={S.presetRow}>
            {EXPR_PRESETS.map((p) => (
              <button
                key={p.value}
                style={S.presetChip(!showCustom && newExpr === p.value)}
                onClick={() => { setNewExpr(p.value); setShowCustom(false) }}
              >
                {p.label}
              </button>
            ))}
            <button
              style={S.presetChip(showCustom)}
              onClick={() => setShowCustom(!showCustom)}
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
                onChange={(e) => setCustomExpr(e.target.value)}
              />
            </div>
          )}

          {/* prompt input */}
          <div style={S.createRow}>
            <input
              style={S.inputSmall}
               placeholder="任务内容（到点自动执行）"
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTask() }}
            />
            <button
              style={{ ...S.btnPrimary, opacity: adding ? 0.6 : 1 }}
              disabled={adding}
              onClick={addTask}
            >
              {adding ? '添加中...' : '＋ 添加任务'}
            </button>
          </div>
        </div>

        {/* ── stats ── */}
        <div style={S.statsBar}>
          <span style={S.statChip}><span style={S.statNum}>{stats.total}</span>总计</span>
          <span style={S.statChip}><span style={S.statNum}>{stats.enabled}</span>已启用</span>
          <span style={S.statChip}><span style={S.statNum}>{stats.disabled}</span>已禁用</span>
          <span style={S.statChip}><span style={S.statNum}>{stats.today}</span>今日执行</span>
        </div>

        {/* ── filter tabs ── */}
        <div style={S.filterRow}>
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              style={S.filterTab(filter === tab.value)}
              onClick={() => setFilter(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── task cards ── */}
        {loading && (
          <div style={S.empty}>加载中...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={S.empty}>
            {filter === 'all'
              ? '🌑 轮回台中尚无任务，渡一叶扁舟入轮回吧'
              : '🌑 此筛选下空空如也'}
          </div>
        )}

        {/* delete confirmation */}
        {delId && (() => {
          const t = tasks.find((x) => x.id === delId)
          return (
            <div style={S.confirmOverlay}>
              <div style={S.confirmText}>
                确认删除「{meta[delId]?.name || t?.expression || delId}」？此操作不可撤销。
              </div>
              <div style={S.confirmBtns}>
                <button style={S.btnConfirm} onClick={() => removeTask(delId)}>确认删除</button>
                <button style={S.btnCancel} onClick={() => setDelId(null)}>取消</button>
              </div>
            </div>
          )
        })()}

        {!loading && filtered.map((t) => {
          const m = meta[t.id] || { name: t.expression, lastRun: null as number | null }
          const displayName = m.name || t.expression
          const isEnabled = t.enabled

          return (
            <div key={t.id} style={S.card(isEnabled)}>
              {/* header row */}
              <div style={S.cardHeader}>
                <div style={S.cardName}>
                  <span style={S.statusDot(isEnabled)} />
                  {displayName}
                  {isEnabled && t.nextRun && (
                    <span style={S.countdownBadge}>
                      ⏳ {countdown(Number(t.nextRun) || 0)}
                    </span>
                  )}
                </div>
                <div style={S.cardActions}>
                  {/* toggle */}
                  <button
                    style={S.toggle(isEnabled)}
                    onClick={() => toggleTask(t.id)}
                    title={isEnabled ? '禁用' : '启用'}
                  >
                    <div style={S.toggleKnob(isEnabled)} />
                  </button>
                  {/* delete */}
                  <button
                    style={S.btnDanger}
                    onClick={() => setDelId(t.id)}
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* meta row */}
              <div style={S.metaRow}>
                <div style={S.metaItem}>
                  <span style={S.metaLabel}>表达式</span>
                  <span style={S.metaValue}>{exprLabel(t.expression)}</span>
                </div>
                <div style={S.metaItem}>
                  <span style={S.metaLabel}>下次</span>
                  <span style={S.metaValue}>{t.nextRun ? fmtTime(Number(t.nextRun)) : '—'}</span>
                  {t.nextRun && (
                    <span style={{ fontSize: '10px', color: 'var(--warning)' }}>
                      ({relativeTime(Number(t.nextRun) || 0)})
                    </span>
                  )}
                </div>
                <div style={S.metaItem}>
                  <span style={S.metaLabel}>上次</span>
                  <span style={S.metaValue}>
                    {m.lastRun ? fmtTime(m.lastRun) : '未执行'}
                  </span>
                </div>
                <div style={S.metaItem}>
                  <span style={S.metaLabel}>状态</span>
                  <span style={{ color: isEnabled ? 'var(--success)' : '#9999AA', fontWeight: 600 }}>
                    {isEnabled ? '⚡ 运行中' : '⏸ 已停用'}
                  </span>
                </div>
              </div>

              {/* prompt preview */}
              <div style={S.promptPreview} title={t.prompt}>
                💬 {t.prompt}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
