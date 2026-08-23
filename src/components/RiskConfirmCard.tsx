import { useCallback, useEffect, useRef, useState } from 'react'

// v0.3.3: 风险操作确认 —— 软件内右下角卡片(替代原生 Windows 弹窗)
// 支持「本次任务都批准」(主进程按 sid+taskId 记录, 新任务自动失效)
interface Pending {
  requestId: string
  kind: string
  detail: string
  level: string
  sid?: string
  taskId?: string
  taskKey?: string
  expiresAt: number
}

export default function RiskConfirmCard() {
  const [queue, setQueue] = useState<Pending[]>([])
  const [approveTask, setApproveTask] = useState(false)
  const [approveAlways, setApproveAlways] = useState(false)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const off = window.huangquan.risk.onConfirm((raw) => {
      const d = raw as Pending
      if (!d?.requestId) return
      setQueue(q => (q.some(x => x.requestId === d.requestId) ? q : [...q, d]))
      // 超时自动移除卡片(主进程同样 60s 自动拒绝)
      const t = setTimeout(() => {
        timers.current.delete(d.requestId)
        setQueue(q => q.filter(x => x.requestId !== d.requestId))
      }, Math.max(0, d.expiresAt - Date.now()))
      timers.current.set(d.requestId, t)
    })
    return () => {
      off()
      for (const t of timers.current.values()) clearTimeout(t)
      timers.current.clear()
    }
  }, [])

  const respond = useCallback((decision: 'allow' | 'deny') => {
    const cur = queue[0]
    if (!cur) return
    window.huangquan.risk.respond(cur.requestId, decision, approveTask, cur.taskKey, approveAlways).catch(() => {})
    const t = timers.current.get(cur.requestId)
    if (t) clearTimeout(t)
    timers.current.delete(cur.requestId)
    setQueue(q => q.filter(x => x.requestId !== cur.requestId))
    setApproveTask(false)
    setApproveAlways(false)
  }, [queue, approveTask])

  const cur = queue[0]
  if (!cur) return null

  return (
    <div className="risk-confirm-card" role="alertdialog" aria-label="风险操作确认">
      <div className="risk-confirm-head">
  <span className="risk-confirm-icon">!</span>
        <span className="risk-confirm-title">风险操作确认 · {cur.kind}</span>
        {queue.length > 1 && <span className="risk-confirm-count">{queue.length} 个待确认</span>}
      </div>
      <div className="risk-confirm-detail" title={cur.detail}>{cur.detail}</div>
      <div className="risk-confirm-approves">
        <label className="risk-confirm-approve">
          <input type="checkbox" checked={approveTask} onChange={e => setApproveTask(e.target.checked)} />
          <span>本次任务都批准</span>
        </label>
        <label className="risk-confirm-approve">
          <input type="checkbox" checked={approveAlways} onChange={e => setApproveAlways(e.target.checked)} />
          <span>以后都批准（该操作不再询问）</span>
        </label>
      </div>
      <div className="risk-confirm-actions">
        <button className="tab-btn" onClick={() => respond('deny')}>拒绝</button>
        <button className="tab-btn active" onClick={() => respond('allow')}>允许</button>
      </div>
    </div>
  )
}
