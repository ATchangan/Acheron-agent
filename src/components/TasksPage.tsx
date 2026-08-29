// TasksPage.tsx —— v0.6.0 任务列表页（侧栏入口）
// 进行中: 各会话里正在跑的任务(进度/当前工具/耗时, 点击跳转会话); 历史: tasks.list() 记录
import { useEffect, useState } from 'react'
import { Activity, History, Trash2, CornerUpLeft, CircleStop } from 'lucide-react'
import { useChatStore } from '../store/chat'
import type { TaskRecord } from '../types/domain'

const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return s + ' 秒'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' 分 ' + (s % 60) + ' 秒'
  return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分'
}
const fmtWhen = (ts: number) => new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const STATUS_CN: Record<TaskRecord['status'], string> = { running: '进行中', done: '已完成', failed: '失败', aborted: '已中止' }

export default function TasksPage({ onOpenSession }: { onOpenSession: (sid: string) => void }) {
  const sessions = useChatStore(s => s.sessions)
  const progress = useChatStore(s => s.progress)
  const orphanTasks = useChatStore(s => s.orphanTasks)
  const switchS = useChatStore(s => s.switchS)
  const restoreTask = useChatStore(s => s.restoreTask)
  const clearQueued = useChatStore(s => s.clearQueued)
  const [records, setRecords] = useState<TaskRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const busySessions = sessions.filter(s => s.busy)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try { const l = await window.huangquan.tasks.list(); if (alive) setRecords(l) } catch { if (alive) setRecords([]) }
      if (alive) setLoading(false)
    }
    void load()
    const t = setInterval(() => { setTick(x => x + 1); void load() }, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  void tick // 进度耗时随 tick 重算

  const history = records.filter(r => r.status !== 'running').slice(0, 30)
  const sessTitle = (sid: string) => sessions.find(x => x.id === sid)?.title || '（会话已删除）'

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 26px', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 'calc(var(--ui-font-size) + 5px)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>任务</div>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', marginBottom: 18 }}>
        各会话并行执行中的任务与历史记录都在这里；任务在各自会话里互不阻塞。
      </div>

      {/* 进行中 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px' }}>
        <Activity size={15} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 'calc(var(--ui-font-size) + 1px)', fontWeight: 600, color: 'var(--text-primary)' }}>进行中</span>
        <span className="aux-row-badge">{busySessions.length + orphanTasks.length}</span>
      </div>
      {busySessions.length === 0 && orphanTasks.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '40px 0', color: 'var(--text-muted)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Activity size={20} /></div>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)' }}>还没有进行中的任务</span>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 14px' }}>
          {orphanTasks.map(t => (
            <div key={'orphan-' + t.id} className="aux-row">
              <div className="aux-row-main">
                <div className="aux-row-name"><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }} title={t.content}>{t.content.slice(0, 60) || '（无标题）'}</span><span className="aux-row-badge">中断待恢复</span></div>
                <div className="aux-row-sub">上次退出时中断 · {fmtWhen(t.at)}{t.planProgress ? ' · ' + t.planProgress : ''}</div>
              </div>
              <div className="aux-row-actions">
                <button type="button" className="aux-link" onClick={() => { void restoreTask(t.id) }}><CornerUpLeft size={14} /> 恢复</button>
                <button type="button" className="aux-link" onClick={async () => { await window.huangquan.tasks.finish(t.id, 'aborted', '用户忽略').catch(() => {}); useChatStore.setState(s => ({ orphanTasks: s.orphanTasks.filter(x => x.id !== t.id) })) }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {busySessions.map(s => {
            const p = progress[s.id]
            return (
              <div key={s.id} className="aux-row">
                <div className="aux-row-main">
                  <div className="aux-row-name">
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }} title={s.title}>{s.title || '（无标题）'}</span>
                    <span className="aux-row-badge">{p?.currentTool ? p.currentTool : '执行中'}</span>
                  </div>
                  <div className="aux-row-sub">
                    {p ? <>第 {p.round} 轮 · 已完成 {p.stepsDone} 步 · {(p.tokensUsed / 1000).toFixed(1)}k tok · {fmtDur(p.elapsedMs)}</> : '正在启动…'}
                  </div>
                </div>
                <div className="aux-row-actions">
                  <button type="button" className="aux-link" onClick={() => { void switchS(s.id); onOpenSession(s.id) }}>打开会话</button>
                  <button type="button" className="aux-link" title="中止该会话任务" onClick={() => { clearQueued(s.id); stopWith(s.id) }}><CircleStop size={14} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 历史 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '24px 0 10px' }}>
        <History size={15} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 'calc(var(--ui-font-size) + 1px)', fontWeight: 600, color: 'var(--text-primary)' }}>历史任务</span>
        <span className="aux-row-badge">{history.length}</span>
      </div>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 1px)' }}>加载中…</div>
      ) : history.length === 0 ? (
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', padding: '8px 2px' }}>暂无历史任务记录</div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 14px' }}>
          {history.map(r => (
            <div key={r.id} className="aux-row">
              <div className="aux-row-main">
                <div className="aux-row-name">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }} title={r.content}>{r.content.slice(0, 60) || '（无标题）'}</span>
                  <span className="aux-row-badge" style={r.status === 'failed' ? { color: 'var(--danger)' } : undefined}>{STATUS_CN[r.status]}</span>
                </div>
                <div className="aux-row-sub">{sessTitle(r.sid)} · {fmtWhen(r.startedAt)}{r.error ? ' · ' + r.error.slice(0, 60) : ''}</div>
              </div>
              <div className="aux-row-actions">
                <button type="button" className="aux-link" onClick={() => onOpenSession(r.sid)}>打开会话</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // 停指定会话(非当前会话): 直接调引擎 stop
  function stopWith(sid: string) { void window.huangquan.engine.stop(sid).catch(() => {}) }
}
