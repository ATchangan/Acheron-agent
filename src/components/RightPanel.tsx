import React, { useEffect, useState } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'

export default function RightPanel() {
  const terminal = useChatStore(s => s.terminal)
  const streaming = useChatStore(s => s.streaming)
  const workDir = useSettingsStore(s => s.general.workDir)
  const [sys, setSys] = useState<any>(null)
  const [memCount, setMemCount] = useState(0)

  useEffect(() => {
    window.huangquan.computer.systemInfo().then(setSys).catch(() => {})
    window.huangquan.memory.load().then(m => setMemCount(m.facts?.length || 0)).catch(() => {})
  }, [])

  // Refresh memory count when terminal changes (tool calls may add memory)
  useEffect(() => {
    if (terminal.length > 0) {
      window.huangquan.memory.load().then(m => setMemCount(m.facts?.length || 0)).catch(() => {})
    }
  }, [terminal.length])

  const fmt = (b: number) => b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'K' : (b / 1048576).toFixed(1) + 'M'
  const memUsed = sys ? sys.totalMemory - sys.freeMemory : 0
  const memPct = sys ? (memUsed / sys.totalMemory * 100).toFixed(0) : '0'

  return (
    <aside className="sidebar-right">
      <div className="right-top-name"><h3>黄泉</h3></div>

      {/* 状态指示器 */}
      {streaming && (
        <div className="right-status-bar" style={{ color: 'var(--accent-green)', fontSize: 11, marginBottom: 8 }}>
          ◉ 执行中...
        </div>
      )}

      {sys && (
        <div className="sys-bar">
          <div className="sys-item"><span className="sys-label">CPU</span><span>{sys.cpus}核</span></div>
          <div className="sys-item"><span className="sys-label">RAM</span><span>{fmt(memUsed)}/{fmt(sys.totalMemory)} ({memPct}%)</span></div>
          <div className="sys-item"><span className="sys-label">平台</span><span>{sys.platform} · {sys.arch}</span></div>
        </div>
      )}
      {workDir && (
        <div className="sys-bar" style={{ marginTop: 4 }}>
          <div className="sys-item" style={{ flex: 1 }}>
            <span className="sys-label">📁 工作目录</span>
            <span style={{ fontSize: 10, color: '#9999AA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={workDir}>{workDir}</span>
          </div>
        </div>
      )}

      {/* 记忆统计 */}
      <div className="sys-bar" style={{ marginTop: 4 }}>
        <div className="sys-item">
          <span className="sys-label">◇ 记忆</span>
          <span style={{ color: 'var(--accent-purple)' }}>{memCount} 条记忆</span>
        </div>
        <div className="sys-item">
          <span className="sys-label">◆ 工具调用</span>
          <span style={{ color: 'var(--accent-green)' }}>{terminal.length} 次</span>
        </div>
      </div>

      {/* 工具调用日志 */}
      <div className="terminal-log">
        <div className="sidebar-section-label" style={{ padding: '8px 0 4px' }}>◆ 工具日志</div>
        {terminal.length === 0 && <div className="empty-hint" style={{ padding: 8 }}>等待操作...</div>}
        {terminal.slice(-20).reverse().map(t => (
          <div key={t.id} className="terminal-line">
            <span className="terminal-time">{new Date(t.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className="terminal-cmd" style={{ color: t.result.startsWith('E:') ? '#ff4466' : (t as any).risk==='high' ? '#ffaa00' : 'var(--accent-green)' }}>{t.name}{(t as any).risk==='high'?' ⚡':''}</span>
            <span className="terminal-args">{JSON.stringify(t.args).slice(0, 60)}</span>
            <pre className="terminal-out" style={{ color: t.result.startsWith('E:') ? '#ff4466' : 'var(--text-secondary)' }}>{(t.result || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 300)}</pre>
          </div>
        ))}
      </div>
    </aside>
  )
}
