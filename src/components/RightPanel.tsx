import React, { useEffect, useState } from 'react'
import { useChatStore } from '../store/chat'

export default function RightPanel() {
  const terminal = useChatStore(s => s.terminal)
  const [sys, setSys] = useState<any>(null)

  useEffect(() => { window.huangquan.computer.systemInfo().then(setSys).catch(() => {}) }, [])
  const fmt = (b: number) => b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'K' : (b / 1048576).toFixed(1) + 'M'
  const memUsed = sys ? sys.totalMemory - sys.freeMemory : 0

  return (
    <aside className="sidebar-right">
      <div className="right-top-name"><h3>黄泉</h3><span className="right-top-link">Agent</span></div>

      {sys && (
        <div className="sys-bar">
          <div className="sys-item"><span className="sys-label">CPU</span><span>{sys.cpus}核</span></div>
          <div className="sys-item"><span className="sys-label">GPU</span><span>N/A</span></div>
          <div className="sys-item"><span className="sys-label">RAM</span><span>{fmt(memUsed)}/{fmt(sys.totalMemory)}</span></div>
        </div>
      )}

      <div className="terminal-log">
        {terminal.length === 0 && <div className="empty-hint" style={{ padding: 8 }}>等待操作...</div>}
        {terminal.map(t => (
          <div key={t.id} className="terminal-line">
            <span className="terminal-time">{new Date(t.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className="terminal-cmd" style={{ color: t.result.startsWith('E:') ? '#ff4466' : 'var(--accent-green)' }}>{t.name}</span>
            <span className="terminal-args">{JSON.stringify(t.args).slice(0, 60)}</span>
            <pre className="terminal-out" style={{ color: t.result.startsWith('E:') ? '#ff4466' : 'var(--text-secondary)' }}>{t.result.slice(0, 200)}</pre>
          </div>
        ))}
      </div>
    </aside>
  )
}
