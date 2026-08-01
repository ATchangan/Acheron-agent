import React, { useEffect, useState } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import FileTree from './FileTree'

function platformName(p: string): string {
  const map: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux', freebsd: 'FreeBSD' }
  return map[p] || p
}

export default function RightPanel() {
  const terminal = useChatStore(s => s.terminal)
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const activeAgents = useChatStore(s => s.activeAgents)
  const curModel = useChatStore(s => s.curModel)
  const cid = useChatStore(s => s.cid)
  const sessCache = useChatStore(s => s.sessCache)
  const sessTok = useChatStore(s => s.sessTok)
  const workDir = useSettingsStore(s => s.general.workDir)
  const [sys, setSys] = useState<any>(null)
  const [memCount, setMemCount] = useState(0)
  const [cacheStats, setCacheStats] = useState<any>(null)

  const loadMemCount = async () => {
    try {
      const m = await window.huangquan.memory.load()
      // 统一使用 pinnedFacts（与 MemoryView、save_memory 工具一致）
      const facts = (m as any).pinnedFacts || m.facts || []
      setMemCount(facts.length)
    } catch { /* ignore */ }
  }

  // v0.2.6: 文件浏览器状态
  const [treeKey, setTreeKey] = useState(0)
  const [creating, setCreating] = useState<'dir' | 'file' | null>(null)
  const [createName, setCreateName] = useState('')

  const doCreate = async () => {
    if (!creating || !createName.trim()) { setCreating(null); return }
    const target = workDir + '\\' + createName.trim()
    const r = creating === 'dir'
      ? await window.huangquan.computer.mkdir(target)
      : await window.huangquan.computer.createFile(target)
    if (!r.ok) alert('创建失败: ' + r.error)
    else { setCreating(null); setCreateName(''); setTreeKey(k => k + 1) }
  }

  useEffect(() => {
    window.huangquan.computer.systemInfo().then(setSys).catch(() => {})
    loadMemCount()
    window.huangquan.cacheStats().then(setCacheStats).catch(() => {})

  }, [])

  // 工具调用后刷新记忆计数
  useEffect(() => {
    if (terminal.length > 0) loadMemCount()
  }, [terminal.length])

  const fmt = (b: number) => b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'K' : (b / 1048576).toFixed(1) + 'M'
  const memUsed = sys ? sys.totalMemory - sys.freeMemory : 0
  const memPct = sys ? (memUsed / sys.totalMemory * 100).toFixed(0) : '0'
  const uptime = sys ? Math.floor(sys.uptime / 3600) + 'h' : '...'

  return (
    <aside className="sidebar-right">
      <div className="right-top-name"><h3>黄泉</h3></div>

      {/* v0.2.1: 多Agent 协作实时面板 —— 常驻置顶，显示当前正在调用的 Agent（多个并发时全部显示） */}
      <div className="sys-bar" style={{ marginBottom: 8, border: '1px solid rgba(124,92,191,.4)', background: 'rgba(124,92,191,.08)', borderRadius: 8, padding: '8px 10px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', marginBottom: 6, letterSpacing: 1 }}>◈ 协作调度</div>
        {streaming || executing ? (
          activeAgents.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {activeAgents.map(a => (
                <span key={a} style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12, background: 'rgba(124,92,191,.15)', border: '1px solid rgba(124,92,191,.3)', borderRadius: 10, padding: '2px 10px' }}>◉ {a}</span>
              ))}
            </div>
          ) : (
            <span style={{ color: 'var(--accent-green)', fontSize: 11 }}>调度中…</span>
          )
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>待命</span>
        )}
      </div>

      {/* 状态指示器 */}
      {streaming && (
        <div className="right-status-bar" style={{ color: 'var(--accent-green)', fontSize: 11, marginBottom: 8 }}>
          ◉ 执行中...
        </div>
      )}

      {/* 系统信息 */}
      {sys && (
        <div className="sys-bar">
          <div className="sys-item"><span className="sys-label">CPU</span><span>{sys.cpus}核 · {uptime}</span></div>
          <div className="sys-item"><span className="sys-label">RAM</span><span>{fmt(memUsed)}/{fmt(sys.totalMemory)} ({memPct}%)</span></div>
          <div className="sys-item"><span className="sys-label">平台</span><span>{platformName(sys.platform)} {sys.arch === 'x64' ? '· 64位' : sys.arch === 'arm64' ? '· ARM64' : '· ' + sys.arch}</span></div>
        </div>
      )}
      {workDir && (
        <div className="sys-bar" style={{ marginTop: 4, display: 'block' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span className="sys-label" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={workDir}>📁 工作目录</span>
            <span style={{ fontSize: 10, color: '#6ba8ff', cursor: 'pointer' }} title="新建文件夹" onClick={() => { setCreating('dir'); setCreateName('') }}>📂+</span>
            <span style={{ fontSize: 10, color: '#48c98a', cursor: 'pointer' }} title="新建文件" onClick={() => { setCreating('file'); setCreateName('') }}>📄+</span>
            <span style={{ fontSize: 10, color: '#9999AA', cursor: 'pointer' }} title="刷新" onClick={() => setTreeKey(k => k + 1)}>⟳</span>
          </div>
          {creating && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <input autoFocus value={createName} placeholder={creating === 'dir' ? '文件夹名称' : '文件名.txt'} onChange={e => setCreateName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') setCreating(null) }}
                style={{ flex: 1, fontSize: 10, background: '#0F0F22', border: '1px solid #2A2D48', color: '#E8E8F0', borderRadius: 4, padding: '2px 6px', outline: 'none' }} />
              <button onClick={doCreate} style={{ fontSize: 10, cursor: 'pointer', background: '#2A2D48', border: 'none', borderRadius: 4, color: '#E8E8F0' }}>✓</button>
            </div>
          )}
          <div style={{ maxHeight: 200, overflowY: 'auto', borderTop: '1px solid #1A1A30', paddingTop: 4 }}
            onContextMenu={(e) => { if ((e.target as HTMLElement) === e.currentTarget) { e.preventDefault(); window.huangquan.computer.contextMenu({ path: workDir, isDir: true, isWorkDir: true }).then((action: string) => { if (action === 'mkdir') { setCreating('dir'); setCreateName('') } else if (action === 'createFile') { setCreating('file'); setCreateName('') } else if (action === 'refresh') setTreeKey(k => k + 1) }) } }}>
            <FileTree key={treeKey} root={workDir} onChanged={() => setTreeKey(k => k + 1)}
              onNewDir={() => { setCreating('dir'); setCreateName('') }}
              onNewFile={() => { setCreating('file'); setCreateName('') }} />
          </div>
        </div>
      )}

      {/* 统计摘要 */}
      <div className="sys-bar" style={{ marginTop: 4 }}>
        <div className="sys-item">
          <span className="sys-label">◇ 记忆</span>
          <span style={{ color: 'var(--accent-purple)' }}>{memCount} 条</span>
        </div>
        <div className="sys-item">
          <span className="sys-label">◆ 工具调用</span>
          <span style={{ color: 'var(--accent-green)' }}>{terminal.length} 次</span>
        </div>
        <div className="sys-item">
          <span className="sys-label">🤖 当前模型</span>
          <span style={{ color: 'var(--accent-purple)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }} title={curModel}>{curModel || '—'}</span>
        </div>
        {/* v0.2.6: 本次会话的 TOKEN 缓存命中率(规格: readTokens÷inputTokens, 不钳制; 按模型独立) */}
        {(() => {
          const ss = cid ? sessTok[cid] : null
          const models = ss ? Object.keys(ss) : []
          if (!models.length) return <div className="sys-item"><span className="sys-label">🔧 缓存命中</span><span style={{ color: '#48c98a' }}>—</span></div>
          const rows = models.map(m => {
            const c = ss[m]
            // token 口径命中率 = 缓存读取 ÷ 输入总(有区分度; 请求级在 DeepSeek 自动缓存下恒 100%)
            const rate = (c.inputTokens || 0) > 0 ? ((c.readTokens || 0) / c.inputTokens * 100).toFixed(1) + '%' : '—'
            return (
              <div key={m} className="sys-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                <span className="sys-label" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m}>{m}</span>
                <span style={{ color: '#48c98a', fontSize: 11, fontWeight: 600 }}>🔧 {rate}</span>
              </div>
            )
          })
          return <>{rows}</>
        })()}
      </div>

      {/* 工具调用日志 */}
      <div className="terminal-log">
        <div className="sidebar-section-label" style={{ padding: '8px 0 4px' }}>◆ 工具日志</div>
        {terminal.length === 0 && <div className="empty-hint" style={{ padding: 8 }}>等待操作...</div>}
        {terminal.slice(-20).reverse().map(t => (
          <div key={t.id} className="terminal-line">
            <span className="terminal-time">{new Date(t.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className="terminal-cmd" style={{ color: t.result.startsWith('E:') ? '#ff4466' : (t as any).risk === 'high' ? '#ffaa00' : 'var(--accent-green)' }}>{t.name}{(t as any).risk === 'high' ? ' ⚡' : ''}</span>
            <span className="terminal-args">{JSON.stringify(t.args).slice(0, 60)}</span>
            <pre className="terminal-out" style={{ color: t.result.startsWith('E:') ? '#ff4466' : 'var(--text-secondary)' }}>{(t.result || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 300)}</pre>
          </div>
        ))}
      </div>
    </aside>
  )
}
