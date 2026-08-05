import React, { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import FileTree from './FileTree'
import ResizeBar from './ResizeBar'
import { Folder, FolderPlus, FilePlus, RefreshCw, MoreHorizontal, FileText } from 'lucide-react'


export default function RightPanel() {
  const terminal = useChatStore(s => s.terminal)
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const activeAgents = useChatStore(s => s.activeAgents)
  const workDir = useSettingsStore(s => s.general.workDir)
  // memUsed/memPct 由 sysPerf 实时提供(perf.memUsed/perf.memPct)
  const [perf, setPerf] = useState<{ cpuPct: number; memPct: number; memUsed: number; memTotal: number; gpuPct: number; gpuName: string } | null>(null)


  // 文件浏览器状态
  const [treeKey, setTreeKey] = useState(0)
  const [creating, setCreating] = useState<'dir' | 'file' | null>(null)
  const [createName, setCreateName] = useState('')
  // 项目约定状态 —— 工作目录变化时重新探测
  const [projectCtx, setProjectCtx] = useState<{ file: string; content: string; path: string }>({ file: '', content: '', path: '' })
  useEffect(() => {
    window.huangquan.projectContext().then(setProjectCtx).catch(() => setProjectCtx({ file: '', content: '', path: '' }))
  }, [workDir])

  // v0.3.0: 工作目录变化时文件树立即刷新(设置页修改实时生效, 不依赖 5s 轮询)
  const firstWd = useRef(true)
  useEffect(() => {
    if (firstWd.current) { firstWd.current = false; return }
    setTreeKey(k => k + 1)
  }, [workDir])

  const doCreate = async () => {
    if (!creating || !createName.trim()) { setCreating(null); return }
    const target = workDir + '\\' + createName.trim()
    const r = creating === 'dir'
      ? await window.huangquan.computer.mkdir(target)
      : await window.huangquan.computer.createFile(target)
    if (!r.ok) alert('创建失败: ' + r.error)
    else { setCreating(null); setCreateName(''); setTreeKey(k => k + 1) }
  }

  // CPU/RAM/GPU 实时占用 —— 2.5s 轮询(主进程 2s 缓存, GPU 性能计数器)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try { const p = await window.huangquan.computer.sysPerf(); if (alive) setPerf(p) } catch (e) { /* 静默 */ console.debug('[swallow]', e) }
    }
    tick()
    const iv = setInterval(tick, 2500)
    return () => { alive = false; clearInterval(iv) }
  }, [])


  const fmt = (b: number) => b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'K' : (b / 1048576).toFixed(1) + 'M'

  return (
    <aside className="sidebar-right" style={{ position: 'relative' }}>
      <div className="right-top-name"><h3>黄泉</h3></div>

      {/* 多角色协作实时面板 —— 常驻置顶，显示当前正在调用的角色（多个并发时全部显示） */}
      <div className="sys-bar" style={{ marginBottom: 8, border: '1px solid rgba(var(--skin-accent),.4)', background: 'rgba(var(--skin-accent),.08)', borderRadius: 8, padding: '8px 10px' }}>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', fontWeight: 700, color: 'var(--accent)', marginBottom: 6, letterSpacing: 1 }}>协作调度</div>
        {streaming || executing ? (
          activeAgents.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {activeAgents.map(a => (
                <span key={a} style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 'calc(var(--ui-font-size) - 1px)', background: 'rgba(var(--skin-accent),.15)', border: '1px solid rgba(var(--skin-accent),.3)', borderRadius: 10, padding: '2px 10px' }}>◉ {a}</span>
              ))}
            </div>
          ) : (
            <span style={{ color: 'var(--accent-green)', fontSize: 'calc(var(--ui-font-size) - 2px)' }}>调度中…</span>
          )
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 3px)' }}>待命</span>
        )}
      </div>

      {/* 状态指示器 */}
      {streaming && (
        <div className="right-status-bar" style={{ color: 'var(--accent-green)', fontSize: 'calc(var(--ui-font-size) - 2px)', marginBottom: 8 }}>
          ◉ 执行中...
        </div>
      )}

      {/* 系统信息: CPU/RAM/GPU 实时占用 */}
      {perf && (
        <div className="sys-bar">
          <div className="sys-item"><span className="sys-label">处理器</span><span style={{ color: perf.cpuPct > 80 ? 'var(--danger)' : 'var(--text-primary)' }}>{perf.cpuPct}%</span></div>
          <div className="sys-item"><span className="sys-label">内存</span><span>{fmt(perf.memUsed)}/{fmt(perf.memTotal)} ({perf.memPct}%)</span></div>
          <div className="sys-item" title={perf.gpuName ? '当前显卡：' + perf.gpuName : ''}><span className="sys-label">显卡</span><span style={{ color: (perf.gpuPct || 0) > 80 ? 'var(--danger)' : 'var(--text-primary)' }}>{perf.gpuPct == null ? '—' : perf.gpuPct + '%'}</span></div>
        </div>
      )}
      {workDir && (
        <div className="sys-bar" style={{ marginTop: 4, display: 'block', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span className="sys-label" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={workDir}><Folder size={12} style={{ marginRight: 2, flexShrink: 0 }} />工作目录</span>
            {/* v0.3.0: ⋯ 点一次直接打开系统选目录界面(选中即切换并实时刷新文件树) */}
            <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', cursor: 'pointer' }} title="选择工作目录" onClick={async () => { const path = await window.huangquan.computer.selectDir(); if (path) useSettingsStore.getState().setWorkDir(path) }}><MoreHorizontal size={13} /></span>
            <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--accent)', cursor: 'pointer' }} title="新建文件夹" onClick={() => { setCreating('dir'); setCreateName('') }}><FolderPlus size={12} /></span>
            <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--success)', cursor: 'pointer' }} title="新建文件" onClick={() => { setCreating('file'); setCreateName('') }}><FilePlus size={12} /></span>
            <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', cursor: 'pointer' }} title="刷新" onClick={() => setTreeKey(k => k + 1)}><RefreshCw size={12} /></span>
            {/* 项目约定状态(点击打开编辑) */}
            <span
              style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: projectCtx.file ? 'var(--success)' : 'var(--text-muted)', cursor: projectCtx.file ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center' }}
              title={projectCtx.file ? `项目约定已加载，点击打开编辑\n\n${projectCtx.content.slice(0, 300)}` : '工作目录没有项目约定文件'}
              onClick={() => { if (projectCtx.path) { try { window.huangquan.computer.openFile(projectCtx.path) } catch { /* 忽略 */ } } }}
            ><FileText size={12} />{projectCtx.file ? ' ✓' : ''}</span>
          </div>
          {creating && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <input autoFocus value={createName} placeholder={creating === 'dir' ? '文件夹名称' : '文件名.txt'} onChange={e => setCreateName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') setCreating(null) }}
                style={{ flex: 1, fontSize: 'calc(var(--ui-font-size) - 3px)', background: '#1b1c22', border: '1px solid #3a3c46', color: 'var(--text-primary)', borderRadius: 4, padding: '2px 6px', outline: 'none' }} />
              <button onClick={doCreate} style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', cursor: 'pointer', background: '#3a3c46', border: 'none', borderRadius: 4, color: 'var(--text-primary)' }}>✓</button>
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


      {/* 工具调用日志 */}
      <div className="terminal-log">
        <div className="sidebar-section-label" style={{ padding: '8px 0 4px' }}>工具日志</div>
        {terminal.length === 0 && <div className="empty-hint" style={{ padding: 8 }}>等待操作...</div>}
        {terminal.slice(-20).reverse().map(t => (
          <div key={t.id} className="terminal-line">
            <span className="terminal-time">{new Date(t.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className="terminal-cmd" style={{ color: t.result.startsWith('E:') ? 'var(--danger)' : (t as { risk?: string }).risk === 'high' ? 'var(--warning)' : 'var(--accent-green)' }}>{t.name}{(t as { risk?: string }).risk === 'high' ? ' ⚡' : ''}</span>
            <span className="terminal-args">{JSON.stringify(t.args).slice(0, 60)}</span>
            <pre className="terminal-out" style={{ color: t.result.startsWith('E:') ? 'var(--danger)' : 'var(--text-secondary)' }}>{(t.result || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 300)}</pre>
          </div>
        ))}
      </div>
      <ResizeBar varName="--right-w" storeKey="hq_right_w" min={180} max={480} edge="left" />
    </aside>
  )
}
