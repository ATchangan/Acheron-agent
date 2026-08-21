// ArtifactsView.tsx —— v0.4.2 产物页：工作目录中的文件产物，按目录浏览/打开
import React, { useEffect, useState } from 'react'
import { Package, Folder, FileText, Image as ImageIcon, Film, Music, ExternalLink, RefreshCw } from 'lucide-react'
import { useSettingsStore } from '../store/settings'

interface Item { name: string; isDirectory: boolean; size: number }

const EXT_ICON: Record<string, React.ReactNode> = {
  png: <ImageIcon size={14} />, jpg: <ImageIcon size={14} />, jpeg: <ImageIcon size={14} />, webp: <ImageIcon size={14} />, gif: <ImageIcon size={14} />, svg: <ImageIcon size={14} />,
  mp4: <Film size={14} />, webm: <Film size={14} />, mov: <Film size={14} />,
  mp3: <Music size={14} />, wav: <Music size={14} />, flac: <Music size={14} />,
}

const fmtSize = (n: number) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'

export default function ArtifactsView() {
  const workDir = useSettingsStore(s => s.general.workDir)
  const [items, setItems] = useState<Item[]>([])
  const [dir, setDir] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async (path: string) => {
    if (!path) return
    setLoading(true)
    try {
      const list = await window.huangquan.computer.readDir(path)
      setItems(list || [])
      setDir(path)
    } catch { setItems([]) }
    setLoading(false)
  }

  useEffect(() => { if (workDir) void load(workDir) }, [workDir])

  const up = () => {
    const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
    parts.pop()
    const parent = parts.length ? (dir.startsWith('\\\\') ? '\\\\' : '') + parts.join('/') : ''
    if (parent) void load(parent)
  }

  return (
    <div className="hq-page">
      <div className="hq-page-head">
        <h2 className="hq-page-title"><Package size={16} /> 产物</h2>
        <span className="hq-page-subtitle">{workDir ? '工作目录中的文件产物' : '未设置工作目录'}</span>
        <span className="hq-page-spacer" />
        {dir && <button type="button" className="hq-icon-btn" title="刷新" aria-label="刷新" onClick={() => void load(dir)}><RefreshCw size={14} /></button>}
      </div>
      <div className="hq-page-body">
        {!workDir ? (
          <div className="hq-rail-empty" style={{ minHeight: 260 }}>
            <Folder size={30} className="hq-rail-empty-icon" />
            <div className="hq-rail-empty-title">未设置工作目录</div>
            <div className="hq-rail-empty-desc">在设置中配置工作目录后，这里会展示生成的文件产物</div>
          </div>
        ) : (
          <div className="hq-artifacts">
            <div className="hq-artifacts-path" title={dir}>
              {dir && dir !== workDir && <button type="button" className="hq-btn" style={{ padding: '2px 8px' }} onClick={up}>上一级</button>}
              <span className="hq-artifacts-dir">{dir}</span>
            </div>
            {loading ? <div className="hq-ghost">加载中…</div> : items.length === 0 ? (
              <div className="hq-ghost">此目录为空</div>
            ) : (
              <div className="hq-artifacts-grid">
                {items.map(item => {
                  const ext = item.name.split('.').pop()?.toLowerCase() || ''
                  return (
                    <button
                      key={item.name}
                      type="button"
                      className="hq-artifact-card"
                      onClick={() => { if (item.isDirectory) void load(dir + '\\' + item.name); else window.huangquan.computer.openFile(dir + '\\' + item.name).catch(() => {}) }}
                    >
                      <span className="hq-artifact-icon">{item.isDirectory ? <Folder size={18} /> : (EXT_ICON[ext] || <FileText size={18} />)}</span>
                      <span className="hq-artifact-name" title={item.name}>{item.name}</span>
                      <span className="hq-artifact-meta">{item.isDirectory ? '目录' : fmtSize(item.size)}</span>
                      {!item.isDirectory && <ExternalLink size={11} className="hq-artifact-open" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
