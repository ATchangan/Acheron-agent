// CronPage.tsx —— v0.5.0 定时任务页（侧栏入口）
// 后端: electron/cron.ts（30s 对钟调度, cron:add/list/remove/toggle/addWatch, 触发走 cron:fire → 标准会话流）
import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Power, Timer, FolderClock } from 'lucide-react'
import { useSettingsStore } from '../store/settings'

interface CronJob {
  id: string
  trigger?: 'cron' | 'watch'
  expression?: string
  watchPath?: string
  prompt: string
  enabled: boolean
  createdAt: number
  lastRun?: number
}

const PRESETS: { label: string; expr: string }[] = [
  { label: '每小时', expr: '@hourly' },
  { label: '每天 9 点', expr: '0 9 * * *' },
  { label: '每周一 9 点', expr: '0 9 * * 1' },
  { label: '每 30 分钟', expr: '*/30 * * * *' },
]

const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '从未运行')

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'cron' | 'watch'>('cron')
  const [expr, setExpr] = useState('')
  const [watchPath, setWatchPath] = useState('')
  const [prompt, setPrompt] = useState('')
  const [err, setErr] = useState('')
  const workDir = useSettingsStore(s => s.general.workDir)

  const refresh = useCallback(async () => {
    try { setJobs(await window.huangquan.cron.list()) } catch { setJobs([]) }
    setLoading(false)
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const add = async () => {
    setErr('')
    const p = prompt.trim()
    if (!p) { setErr('请填写要执行的任务内容'); return }
    const r = mode === 'cron'
      ? await window.huangquan.cron.add(expr.trim(), p)
      : await window.huangquan.cron.addWatch(watchPath.trim(), p)
    if (!r.ok) { setErr(r.error || '添加失败'); return }
    setExpr(''); setWatchPath(''); setPrompt('')
    void refresh()
  }

  const toggle = async (id: string) => { await window.huangquan.cron.toggle(id); void refresh() }
  const remove = async (id: string) => { await window.huangquan.cron.remove(id); void refresh() }
  const pickWatch = async () => {
    const dir = await window.huangquan.computer.selectDir()
    if (dir) setWatchPath(dir)
  }

  const inputStyle: React.CSSProperties = {
    height: 34, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    color: 'var(--text-primary)', fontSize: 'calc(var(--ui-font-size) - 1px)', padding: '0 10px', outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 26px', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 'calc(var(--ui-font-size) + 5px)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>定时任务</div>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', marginBottom: 18 }}>
        到点后自动创建一条消息并按当前模式执行；应用缩到托盘时照常触发，完全退出则不触发。
      </div>

      {/* 新建任务 */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Plus size={14} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: 'var(--text-primary)' }}>新建任务</span>
          <span style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-elevated)', borderRadius: 8, padding: 2 }}>
            {(['cron', 'watch'] as const).map(m => (
              <button key={m} type="button" onClick={() => setMode(m)} style={{
                border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 2px)',
                background: mode === m ? 'var(--bg-hover-strong)' : 'transparent', color: mode === m ? 'var(--text-primary)' : 'var(--text-muted)',
              }}>{m === 'cron' ? '定时触发' : '文件监控'}</button>
            ))}
          </div>
        </div>
        {mode === 'cron' ? (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input style={{ ...inputStyle, fontFamily: 'JetBrains Mono, Consolas, monospace', flex: 1 }} placeholder="cron 表达式（分 时 日 月 周，如 0 9 * * *）" value={expr} onChange={e => setExpr(e.target.value)} />
              {PRESETS.map(p => (
                <button key={p.expr} type="button" className="hq-btn" style={{ height: 32, padding: '0 12px', fontSize: 'calc(var(--ui-font-size) - 2px)' }} onClick={() => setExpr(p.expr)}>{p.label}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 10, display: 'flex', gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder="监控的文件 / 目录路径" value={watchPath} onChange={e => setWatchPath(e.target.value)} readOnly />
            <button type="button" className="hq-btn" style={{ height: 34, padding: '0 14px' }} onClick={pickWatch}>选择路径</button>
          </div>
        )}
        <textarea rows={2} style={{
          ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical', minHeight: 56, lineHeight: 1.5,
        }} placeholder="要执行的任务内容（例：总结今天的会话进展，生成一份日报）" value={prompt} onChange={e => setPrompt(e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <button type="button" className="hq-btn hq-btn-accent" style={{ height: 32, padding: '0 18px' }} onClick={() => { void add() }}>添加任务</button>
          {mode === 'cron' && !workDir && <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-muted)' }}>提示：任务在新会话中执行，与当前会话互不影响</span>}
          {err && <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--danger)' }}>{err}</span>}
        </div>
      </div>

      {/* 任务列表 */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 1px)' }}>加载中…</div>
      ) : jobs.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '48px 0', color: 'var(--text-muted)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Timer size={20} /></div>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)' }}>还没有定时任务</span>
        </div>
      ) : (
        <div>
          {jobs.map(j => (
            <div key={j.id} className="aux-row">
              <span className="sm-icon aux-icon" style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
                {j.trigger === 'watch' ? <FolderClock size={16} /> : <Timer size={16} />}
              </span>
              <div className="aux-row-main">
                <div className="aux-row-name">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }} title={j.prompt}>{j.prompt}</span>
                  <span className="aux-row-badge">{j.trigger === 'watch' ? '文件监控' : (j.expression || '')}</span>
                </div>
                <div className="aux-row-sub">
                  {j.trigger === 'watch' ? '监控 ' + (j.watchPath || '') : '定时 ' + (j.expression || '')} · 上次运行 {fmtTime(j.lastRun)}
                </div>
              </div>
              <div className="aux-row-actions">
                <button type="button" className="aux-link" title={j.enabled ? '停用' : '启用'} onClick={() => { void toggle(j.id) }}>
                  <Power size={14} style={{ color: j.enabled ? 'var(--success)' : 'var(--text-muted)' }} />
                </button>
                <button type="button" className="aux-link" title="删除" onClick={() => { void remove(j.id) }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
