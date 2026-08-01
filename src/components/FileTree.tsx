import React, { useState } from 'react'

// v0.2.6: 工作目录文件浏览器 —— 展开/折叠 + Electron 原生右键菜单 + 文件操作

interface FsItem { name: string; isDirectory: boolean; size: number }

function fmtSize(n: number): string {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
const iconFor = (name: string): string => {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const map: Record<string, string> = { ts: '🟦', tsx: '🟦', js: '🟨', jsx: '🟨', json: '🟩', md: '📝', txt: '📄', py: '🐍', html: '🌐', css: '🎨', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', webp: '🖼️', gif: '🖼️', svg: '🖼️', pdf: '📕', docx: '📘', xlsx: '📗', zip: '🗜️', exe: '⚙️' }
  return map[ext] || '📄'
}

const C = { text: '#E8E8F0', muted: '#78789A', border: '#2A2D48', hover: '#1A1A30', green: '#48c98a', red: '#ff6b6b', blue: '#6ba8ff' }

export default function FileTree({ root, depth = 0, onChanged, onNewDir, onNewFile }: {
  root: string; depth?: number; onChanged?: () => void; onNewDir?: () => void; onNewFile?: () => void
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const [items, setItems] = useState<FsItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [hovered, setHovered] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const list = await window.huangquan.computer.readDir(root)
      list.sort((a: FsItem, b: FsItem) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
      setItems(list)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }

  const toggle = async () => {
    const next = !expanded
    setExpanded(next)
    if (next && !items) await load()
  }

  const doRename = async (path: string) => {
    if (!renameVal.trim()) { setRenaming(null); return }
    const r = await window.huangquan.computer.rename(path, renameVal.trim())
    if (!r.ok) alert('重命名失败: ' + r.error)
    else { setRenaming(null); await load(); onChanged?.() }
  }
  const doDelete = async (path: string, name: string, isDir: boolean) => {
    if (!confirm('确定删除 ' + (isDir ? '文件夹' : '文件') + '「' + name + '」?此操作不可恢复')) return
    const r = await window.huangquan.computer.remove(path)
    if (!r.ok) { alert('删除失败: ' + r.error) } else { await load(); onChanged?.() }
  }
  const doOpen = async (path: string) => { try { await window.huangquan.computer.openFile(path) } catch { /* 忽略 */ } }

  // v0.2.6: Electron 原生右键菜单
  const onCtx = async (e: React.MouseEvent, path: string, name: string, isDir: boolean) => {
    e.preventDefault(); e.stopPropagation()
    const action = await window.huangquan.computer.contextMenu({ path, isDir, isWorkDir: depth === 0 })
    if (action === 'open') doOpen(path)
    else if (action === 'rename') { setRenaming(path); setRenameVal(name) }
    else if (action === 'delete') doDelete(path, name, isDir)
    else if (action === 'mkdir') onNewDir?.()
    else if (action === 'createFile') onNewFile?.()
    else if (action === 'refresh') { setItems(null); await load() }
  }

  const isWorkDir = depth === 0

  const renderRenameBox = (path: string) => (
    <div style={{ padding: '2px 4px 2px 28px', display: 'flex', gap: 4 }}>
      <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') doRename(path); if (e.key === 'Escape') setRenaming(null) }}
        onClick={e => e.stopPropagation()}
        style={{ flex: 1, fontSize: 11, background: '#0F0F22', border: '1px solid ' + C.border, color: C.text, borderRadius: 4, padding: '2px 6px', outline: 'none' }} />
      <button onClick={() => doRename(path)} style={{ fontSize: 10, cursor: 'pointer', background: C.border, border: 'none', borderRadius: 4, color: C.text }}>✓</button>
    </div>
  )

  return (
    <div style={{ fontSize: 11 }}>
      <div
        onClick={toggle}
        onContextMenu={(e) => onCtx(e, root, root.split(/[\\/]/).pop() || root, true)}
        onMouseEnter={() => setHovered(root)} onMouseLeave={() => setHovered('')}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px', borderRadius: 4, cursor: 'pointer', background: hovered === root ? C.hover : 'transparent' }}
      >
        <span style={{ color: C.muted, fontSize: 9, width: 12, display: 'inline-block' }}>{loading ? '⏳' : (expanded ? '▼' : '▶')}</span>
        <span>{isWorkDir ? '📁' : (expanded ? '📂' : '📁')}</span>
        <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={root}>{root.split(/[\\/]/).pop() || root}</span>
        {hovered === root && !isWorkDir && (
          <span style={{ display: 'flex', gap: 6, marginLeft: 4 }}>
            <span title="重命名" style={{ color: C.blue, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setRenaming(root); setRenameVal(root.split(/[\\/]/).pop() || '') }}>✏️</span>
            <span title="删除" style={{ color: C.red, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); doDelete(root, root.split(/[\\/]/).pop() || '', true) }}>🗑️</span>
          </span>
        )}
      </div>

      {renaming === root && renderRenameBox(root)}

      {expanded && (
        <div style={{ paddingLeft: 16 }}>
          {err && <div style={{ color: C.red, padding: 2 }}>读取失败: {err.slice(0, 60)}</div>}
          {items?.map((it) => (
            <div key={it.name}>
              {it.isDirectory ? (
                <FileTree root={root.replace(/[\\/]+$/, '') + '\\' + it.name} depth={depth + 1} onChanged={onChanged} onNewDir={onNewDir} onNewFile={onNewFile} />
              ) : (
                <div
                  onMouseEnter={() => setHovered(root + '\\' + it.name)} onMouseLeave={() => setHovered('')}
                  onDoubleClick={() => doOpen(root + '\\' + it.name)}
                  onContextMenu={(e) => onCtx(e, root + '\\' + it.name, it.name, false)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px', borderRadius: 4, cursor: 'pointer', background: hovered === root + '\\' + it.name ? C.hover : 'transparent' }}
                >
                  <span style={{ width: 12, display: 'inline-block' }} />
                  <span>{iconFor(it.name)}</span>
                  <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={it.name}>{it.name}</span>
                  <span style={{ color: C.muted, fontSize: 9 }}>{fmtSize(it.size)}</span>
                  {hovered === root + '\\' + it.name && (
                    <span style={{ display: 'flex', gap: 6, marginLeft: 4 }}>
                      <span title="打开" style={{ color: C.green, cursor: 'pointer' }} onClick={() => doOpen(root + '\\' + it.name)}>📂</span>
                      <span title="重命名" style={{ color: C.blue, cursor: 'pointer' }} onClick={() => { setRenaming(root + '\\' + it.name); setRenameVal(it.name) }}>✏️</span>
                      <span title="删除" style={{ color: C.red, cursor: 'pointer' }} onClick={() => doDelete(root + '\\' + it.name, it.name, false)}>🗑️</span>
                    </span>
                  )}
                </div>
              )}
              {renaming === root + '\\' + it.name && renderRenameBox(root + '\\' + it.name)}
            </div>
          ))}
          {!items && !loading && !err && <div style={{ color: C.muted, padding: 2 }}>点击展开…</div>}
        </div>
      )}
    </div>
  )
}
