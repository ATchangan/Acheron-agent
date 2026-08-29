// DaySummary.tsx —— v0.4.4 右缘「当日总结」竖排页签 + 抽屉（对齐参考）
// 汇总今天：活跃会话（有更新的）、完成的任务数、今日新建会话等。
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useChatStore } from '../store/chat'
import type { TaskRecord } from '../types/domain'

const startOfToday = (): number => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

export default function DaySummary() {
  const [open, setOpen] = useState(false)
  const sessions = useChatStore(s => s.sessions)
  const sessTokMap = useChatStore(s => s.sessTok)
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [tick, setTick] = useState(0)

  const [hidden, setHidden] = useState(() => localStorage.getItem('hq_daysummary_hidden') === '1')
  useEffect(() => {
    const f = () => setHidden(localStorage.getItem('hq_daysummary_hidden') === '1')
    window.addEventListener('hq-layout-changed', f)
    return () => window.removeEventListener('hq-layout-changed', f)
  }, [])
  useEffect(() => {
    let alive = true
    const load = async () => { try { const l = await window.huangquan.tasks.list(); if (alive) setTasks(l) } catch { /* 忽略 */ } }
    void load()
    const t = setInterval(() => { setTick(x => x + 1); void load() }, 8000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  void tick

  const t0 = startOfToday()
  const todaySessions = useMemo(() => sessions
    .filter(s => !s.archived && (s.updatedAt ? new Date(s.updatedAt).getTime() : Date.now()) >= t0)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))), [sessions, t0])
  const todayTasks = useMemo(() => tasks.filter(t => (t.updatedAt || t.startedAt) >= t0), [tasks, t0])
  const doneTasks = todayTasks.filter(t => t.status === 'done').length
  const failedTasks = todayTasks.filter(t => t.status === 'failed').length
  const tokOf = (sid: string): number => {
    const m = sessTokMap[sid] || {}
    let n = 0
    for (const c of Object.values(m)) n += (c.outputTokens || 0)
    return n
  }
  const totalTok = todaySessions.reduce((n, s) => n + tokOf(s.id), 0)
  const fmtK = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))

  if (hidden) return null
  return (
    <>
      {/* 右缘竖排页签 */}
      <button
        type="button"
        className={'hq-daysummary-tab' + (open ? ' open' : '')}
        title="当日总结"
        onClick={() => setOpen(v => !v)}
      >
        当日总结
      </button>

      {/* 抽屉 */}
      {open && (
        <div className="hq-daysummary-drawer" role="dialog" aria-label="当日总结">
          <div className="hq-daysummary-head">
            <span style={{ fontWeight: 650, color: 'var(--text-primary)' }}>当日总结</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="hq-mini-btn" title="收起" onClick={() => setOpen(false)}><X size={14} /></button>
          </div>
          <div className="hq-daysummary-grid">
            <div className="hq-daysummary-cell">
              <div className="hq-daysummary-num">{todaySessions.length}</div>
              <div className="hq-daysummary-label">活跃会话</div>
            </div>
            <div className="hq-daysummary-cell">
              <div className="hq-daysummary-num">{doneTasks}<span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-muted)' }}> / {todayTasks.length}</span></div>
              <div className="hq-daysummary-label">完成任务</div>
            </div>
            <div className="hq-daysummary-cell">
              <div className="hq-daysummary-num">{fmtK(totalTok)}</div>
              <div className="hq-daysummary-label">今日输出 token</div>
            </div>
          </div>
          {failedTasks > 0 && <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--danger)', margin: '6px 2px 0' }}>今日有 {failedTasks} 个任务失败，可在「任务」页查看。</div>}
          <div className="hq-daysummary-sec">今天动过的会话</div>
          {todaySessions.length === 0 ? (
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', padding: '4px 2px 10px' }}>今天还没有会话动态</div>
          ) : (
            <div className="hq-daysummary-list">
              {todaySessions.map(s => (
                <div key={s.id} className="hq-daysummary-row">
                  <span className="hq-daysummary-name" title={s.title}>{s.title || '（无标题）'}</span>
                  <span className="hq-daysummary-meta">{s.messages.length} 条{tokOf(s.id) > 0 ? ' · ' + fmtK(tokOf(s.id)) + ' tok' : ''}</span>
                </div>
              ))}
            </div>
          )}
          <div className="hq-daysummary-sec">今天的任务</div>
          {todayTasks.length === 0 ? (
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', padding: '4px 2px 10px' }}>今天没有任务记录</div>
          ) : (
            <div className="hq-daysummary-list">
              {todayTasks.slice(0, 12).map(t => (
                <div key={t.id} className="hq-daysummary-row">
                  <span className="hq-daysummary-name" title={t.content}>{t.content.slice(0, 40) || '（无标题）'}</span>
                  <span className="hq-daysummary-meta" style={{ color: t.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {t.status === 'done' ? '完成' : t.status === 'failed' ? '失败' : t.status === 'aborted' ? '中止' : '进行中'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
