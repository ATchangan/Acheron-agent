import React, { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../store/settings'
import FileTree from './FileTree'
import { Folder, FolderPlus, FilePlus, RefreshCw, MoreHorizontal, FileText } from 'lucide-react'

// 文件视图 —— 原右侧面板的工作目录/文件树/系统信息迁入左侧导航
export default function FilesView() {
  const workDir = useSettingsStore(s => s.general.workDir)
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

  // 工作目录变化时文件树立即刷新
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

  // CPU/RAM/GPU 实时占用 —— 2.5s 轮询
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try { const p = await window.huangquan.computer.sysPerf(); if (alive) setPerf(p) } catch { /* 静默 */ }
    }
    tick()
    const iv = setInterval(tick, 2500)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  const fmt = (b: number) => b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'K' : (b / 1048576).toFixed(1) + 'M'

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="right-top-name"><h3>文件</h3></div>

      {/* 系统信息 */}
      {perf && (
        <div className="sys-bar">
          <div className="sys-item"><span className="sys-label">处理器</span><span style={{ color: perf.cpuPct > 80 ? 'var(--danger)' : 'var(--text-primary)' }}>{perf.cpuPct}%</span></div>
          <div className="sys-item"><span className="sys-label">内存</span><span>{fmt(perf.memUsed)}/{fmt(perf.memTotal)} ({perf.memPct}%)</span></div>
          <div className="sys-item" title={perf.gpuName ? '当前显卡：' + perf.gpuName : ''}><span className="sys-label">显卡</span><span style={{ color: (perf.gpuPct || 0) > 80 ? 'var(--danger)' : 'var(--text-primary)' }}>{perf.gpuPct == null ? '—' : perf.gpuPct + '%'}</span></div>
        </div>
      )}

      {/* 工作目录 + 文件树 */}
      {workDir && <div className="sys-bar" style={{ display: 'block', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span className="sys-label" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={workDir}><Folder size={12} style={{ marginRight: 2, flexShrink: 0 }} />工作目录</span>
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
              style={{ flex: 1, fontSize: 'calc(var(--ui-font-size) - 3px)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 4, padding: '2px 6px', outline: 'none' }} />
            <button onClick={doCreate} style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', cursor: 'pointer', background: 'var(--border)', border: 'none', borderRadius: 4, color: 'var(--text-primary)' }}>✓</button>
          </div>
        )}
        <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto', borderTop: '1px solid #1A1A30', paddingTop: 4 }}
          onContextMenu={(e) => { if ((e.target as HTMLElement) === e.currentTarget) { e.preventDefault(); window.huangquan.computer.contextMenu({ path: workDir, isDir: true, isWorkDir: true }).then((action: string) => { if (action === 'mkdir') { setCreating('dir'); setCreateName('') } else if (action === 'createFile') { setCreating('file'); setCreateName('') } else if (action === 'refresh') setTreeKey(k => k + 1) }) } }}>
          <FileTree key={treeKey} root={workDir} onChanged={() => setTreeKey(k => k + 1)}
            onNewDir={() => { setCreating('dir'); setCreateName('') }}
            onNewFile={() => { setCreating('file'); setCreateName('') }} />
        </div>
      </div>}
    </div>
  )
}
