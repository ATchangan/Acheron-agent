// RightRail.tsx —— v0.4.2 右侧面板：文件 / 预览 双 tab，可拖拽调宽
import React, { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useSettingsStore } from '../store/settings'
import FileTree from './FileTree'
import ResizeBar from './ResizeBar'
import { Folder, Eye, RefreshCw, FileText, Terminal as TerminalIcon, GitPullRequest, Columns2 } from 'lucide-react'

// 终端 pane：工作目录执行命令，输出滚动日志
function TerminalPane() {
  const workDir = useSettingsStore(s => s.general.workDir)
  const [lines, setLines] = useState<{ kind: 'cmd' | 'out'; text: string }[]>([
    { kind: 'out', text: '输入命令后回车执行，命令在工作目录运行。' },
  ])
  const [cmd, setCmd] = useState('')
  const [busy, setBusy] = useState(false)
  const histIdx = useRef(-1)
  const histRef = useRef<string[]>([])

  const run = async () => {
    const c = cmd.trim()
    if (!c || busy) return
    setCmd('')
    setLines(prev => [...prev.slice(-200), { kind: 'cmd', text: '$ ' + c }])
    histRef.current = [c, ...histRef.current].slice(0, 50)
    histIdx.current = -1
    setBusy(true)
    try {
      const out = await window.huangquan.computer.exec(c)
      setLines(prev => [...prev.slice(-200), { kind: 'out', text: out || '（无输出）' }])
    } catch (e) {
      setLines(prev => [...prev.slice(-200), { kind: 'out', text: '执行失败: ' + String(e) }])
    }
    setBusy(false)
  }

  return (
    <div className="hq-terminal-pane">
      <div className="hq-terminal-log" ref={el => { if (el) el.scrollTop = el.scrollHeight }}>
        {lines.map((l, i) => (
          <div key={i} className={'hq-term-line' + (l.kind === 'cmd' ? ' cmd' : '')}>{l.text}</div>
        ))}
      </div>
      <div className="hq-terminal-input">
        <span className="hq-term-prompt">{workDir ? workDir.split(/[/\\]/).pop() : '?'} $</span>
        <input
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void run()
            else if (e.key === 'ArrowUp') {
              e.preventDefault()
              if (!histRef.current.length) return
              histIdx.current = histIdx.current < histRef.current.length - 1 ? histIdx.current + 1 : histRef.current.length - 1
              setCmd(histRef.current[histIdx.current] ?? '')
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              histIdx.current = histIdx.current > 0 ? histIdx.current - 1 : -1
              setCmd(histIdx.current >= 0 ? histRef.current[histIdx.current] : '')
            }
          }}
          placeholder="输入命令…"
          disabled={busy}
        />
        {busy && <span className="hq-term-busy">执行中…</span>}
        <button type="button" className="hq-icon-btn" title="清空输出" aria-label="清空输出" onClick={() => setLines([])}>
          <RefreshCw size={12} />
        </button>
      </div>
    </div>
  )
}

// 评审 pane：git status / git diff 高亮
function ReviewPane() {
  const workDir = useSettingsStore(s => s.general.workDir)
  const [status, setStatus] = useState('')
  const [diff, setDiff] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (cmd: string) => {
    if (!workDir || busy) return ''
    setBusy(true)
    try {
      const out = await window.huangquan.computer.exec(cmd)
      return String(out || '')
    } catch (e) { return '执行失败: ' + String(e) }
    finally { setBusy(false) }
  }

  const gitStatus = async () => {
    setDiff('')
    setStatus(await run('git status --short'))
  }
  const gitDiff = async () => {
    setStatus('')
    setDiff(await run('git diff'))
  }

  const diffLines = diff.split('\n')
  return (
    <div className="hq-review">
      <div className="hq-review-toolbar">
        <button type="button" className="hq-btn" disabled={!workDir || busy} onClick={() => void gitStatus()}>文件状态</button>
        <button type="button" className="hq-btn" disabled={!workDir || busy} onClick={() => void gitDiff()}>差异 diff</button>
        <button type="button" className="hq-btn" disabled={!workDir || busy} onClick={() => { setStatus(''); setDiff('') }}>清空</button>
      </div>
      {!workDir ? (
        <div className="hq-rail-empty">
          <GitPullRequest size={28} className="hq-rail-empty-icon" />
          <div className="hq-rail-empty-title">评审面板</div>
          <div className="hq-rail-empty-desc">尚未配置工作目录</div>
        </div>
      ) : status ? (
        <pre className="hq-review-status">{status}</pre>
      ) : diff ? (
        <div className="hq-review-diff">
          {diffLines.map((l, i) => (
            <div key={i} className={'hq-diff-line' + (l.startsWith('+') && !l.startsWith('+++') ? ' add' : l.startsWith('-') && !l.startsWith('---') ? ' del' : l.startsWith('@@') ? ' hunk' : '')}>{l || ' '}</div>
          ))}
        </div>
      ) : (
        <div className="hq-rail-empty">
          <GitPullRequest size={28} className="hq-rail-empty-icon" />
          <div className="hq-rail-empty-title">评审面板</div>
          <div className="hq-rail-empty-desc">查看工作目录 {workDir.split(/[/\\]/).pop()} 的 git 状态与差异</div>
        </div>
      )}
      {busy && <div className="hq-review-busy">执行中…</div>}
    </div>
  )
}

// 文件面板(自持状态, 双面板模式下可独立实例化)
function FilesPaneBody(): JSX.Element {
  const workDir = useSettingsStore(s => s.general.workDir)
  const [treeKey, setTreeKey] = useState(0)
  const [projectCtx, setProjectCtx] = useState<{ file: string; content: string; path: string }>({ file: '', content: '', path: '' })
  useEffect(() => {
    window.huangquan.projectContext().then(setProjectCtx).catch(() => setProjectCtx({ file: '', content: '', path: '' }))
  }, [workDir])
  return (
    <>
            <div className="hq-rail-toolbar">
              <span className="hq-rail-dir" title={workDir || '未设置工作目录'}>
                <Folder size={12} style={{ flexShrink: 0 }} />
                <span className="hq-rail-dir-name">{workDir ? workDir.split(/[/\\]/).pop() : '工作目录'}</span>
              </span>
              <button type="button" className="hq-icon-btn" title="刷新文件树" aria-label="刷新文件树" onClick={() => setTreeKey(k => k + 1)}>
                <RefreshCw size={12} />
              </button>
              <button
                type="button"
                className="hq-icon-btn"
                title={projectCtx.file ? '项目约定已加载，点击打开' : '无项目约定文件'}
                aria-label="项目约定"
                style={{ color: projectCtx.file ? 'var(--success)' : undefined }}
                onClick={() => { if (projectCtx.path) { try { window.huangquan.computer.openFile(projectCtx.path) } catch { /* 忽略 */ } } }}
              >
                <FileText size={12} />
              </button>
            </div>
            {workDir ? (
              <div className="hq-rail-tree">
                <FileTree
                  key={treeKey}
                  root={workDir}
                  onChanged={() => setTreeKey(k => k + 1)}
                  onNewDir={() => { /* 右栏不做内联新建 */ }}
                  onNewFile={() => { /* 右栏不做内联新建 */ }}
                />
              </div>
            ) : (
              <div className="hq-rail-empty">
                <div className="hq-rail-empty-icon"><Folder size={30} /></div>
                <div className="hq-rail-empty-title">未设置工作目录</div>
                <div className="hq-rail-empty-desc">在设置中配置工作目录后，这里会显示项目文件树</div>
              </div>
            )}
    </>
  )
}

// 文件预览阅读器：文本 / 图片 / PDF
function PreviewPane() {
  const workDir = useSettingsStore(s => s.general.workDir)
  const [items, setItems] = useState<{ name: string; isDirectory: boolean; size: number }[]>([])
  const [path, setPath] = useState('')
  const [text, setText] = useState('')
  const [img, setImg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!workDir) { setItems([]); return }
    window.huangquan.computer.readDir(workDir).then(l => setItems(l || [])).catch(() => setItems([]))
  }, [workDir])

  const open = async (name: string) => {
    if (!workDir) return
    const p = workDir + '\\' + name
    setPath(p); setText(''); setImg(''); setErr('')
    const ext = name.split('.').pop()?.toLowerCase() || ''
    try {
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
        const b = await window.huangquan.computer.readImageBase64(p)
        setImg(b || '')
      } else if (ext === 'pdf') {
        // 修复: window.open(dataURL) 会被主进程 setWindowOpenHandler 一律拒绝(静默无效),
        // 改为调用系统默认程序打开该文件(文件本就在工作目录)
        setImg(''); setText('')
        try { await window.huangquan.computer.openFile(p) } catch (e) { setErr('PDF 打开失败: ' + String(e)) }
      } else {
        const t = await window.huangquan.computer.readFile(p, 0, 200000)
        setText(String(t ?? ''))
      }
    } catch (e) { setErr(String(e)) }
  }

  return (
    <div className="hq-preview-pane">
      {!path ? (
        <>
          <div className="hq-preview-dir" title={workDir || '未设置工作目录'}>
            <Folder size={12} style={{ flexShrink: 0 }} />
            <span className="hq-rail-dir-name">{workDir ? workDir.split(/[/\\]/).pop() : '工作目录'}</span>
          </div>
          <div className="hq-preview-files">
            {items.filter(i => !i.isDirectory).map(i => (
              <button key={i.name} type="button" className="hq-preview-file" onClick={() => void open(i.name)}>
                <FileText size={12} />
                <span className="hq-preview-file-name" title={i.name}>{i.name}</span>
              </button>
            ))}
            {items.filter(i => !i.isDirectory).length === 0 && <div className="hq-rail-empty-desc">工作目录没有可预览的文件</div>}
          </div>
        </>
      ) : (
        <div className="hq-preview-viewer">
          <div className="hq-preview-head">
            <span className="hq-preview-path" title={path}>{path.split(/[/\\]/).pop()}</span>
            <button type="button" className="hq-icon-btn" title="返回文件列表" aria-label="返回" onClick={() => setPath('')}>×</button>
          </div>
          {img ? <img src={img} alt="预览" className="hq-preview-img" />
            : err ? <div className="hq-preview-err">{err}</div>
            : <pre className="hq-preview-text">{text || '（空文件）'}</pre>}
        </div>
      )}
    </div>
  )
}

export type RailTab = 'files' | 'preview' | 'terminal' | 'review'
const RAIL_TABS: { key: RailTab; label: string; icon: React.ReactNode }[] = [
  { key: 'files', label: '文件', icon: <Folder size={13} /> },
  { key: 'preview', label: '预览', icon: <Eye size={13} /> },
  { key: 'terminal', label: '终端', icon: <TerminalIcon size={13} /> },
  { key: 'review', label: '评审', icon: <GitPullRequest size={13} /> },
]

function railPaneBody(tab: RailTab): JSX.Element {
  if (tab === 'files') return <FilesPaneBody />
  if (tab === 'preview') return <PreviewPane />
  if (tab === 'terminal') return <TerminalPane />
  return <ReviewPane />
}

// 单个面板单元: 迷你 tab 行 + 内容体(双面板模式每格独立切页)
const RailPaneUnit: React.FC<{ tab: RailTab; onTab: (t: RailTab) => void; style?: React.CSSProperties }> = ({ tab, onTab, style }) => (
  <div className="hq-rail-pane" style={style}>
    <div className="hq-rail-pane-tabs">
      {RAIL_TABS.map(x => (
        <button key={x.key} type="button" className={'hq-rail-tab-sm' + (tab === x.key ? ' active' : '')} onClick={() => onTab(x.key)} title={x.label}>
          {x.icon}
        </button>
      ))}
    </div>
    <div className="hq-rail-pane-body">{railPaneBody(tab)}</div>
  </div>
)

export default function RightRail() {
  const [tab, setTab] = useState<RailTab>('files')
  // v0.4.5 多窗格工作区(一期): 右栏双面板 —— 可同时看 文件+终端 等组合, 分隔条可拖
  const [dual, setDual] = useState(() => localStorage.getItem('hq_rail_dual') === '1')
  const [tabA, setTabA] = useState<RailTab>(() => (localStorage.getItem('hq_rail_tabA') as RailTab) || 'files')
  const [tabB, setTabB] = useState<RailTab>(() => (localStorage.getItem('hq_rail_tabB') as RailTab) || 'terminal')
  const [splitPct, setSplitPct] = useState(() => Math.min(80, Math.max(20, Number(localStorage.getItem('hq_rail_split')) || 55)))
  const dualBodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { localStorage.setItem('hq_rail_dual', dual ? '1' : '0') }, [dual])
  useEffect(() => { localStorage.setItem('hq_rail_tabA', tabA) }, [tabA])
  useEffect(() => { localStorage.setItem('hq_rail_tabB', tabB) }, [tabB])
  useEffect(() => { localStorage.setItem('hq_rail_split', String(splitPct)) }, [splitPct])

  const onSplitterDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = dualBodyRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const pct = Math.min(80, Math.max(20, ((ev.clientY - rect.top) / rect.height) * 100))
      setSplitPct(Math.round(pct))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <aside className="hq-right-rail" style={{ position: 'relative' }}>
      {/* 栏头: 单面板模式显示大 tab; 双面板模式每格有自己的迷你 tab */}
      <div className="hq-right-rail-head">
        {!dual && RAIL_TABS.map(x => (
          <button
            key={x.key}
            type="button"
            className={'hq-rail-tab' + (tab === x.key ? ' active' : '')}
            onClick={() => setTab(x.key)}
          >
            {x.icon}
            <span>{x.label}</span>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className={'hq-rail-tab' + (dual ? ' active' : '')}
          title={dual ? '切回单面板' : '双面板工作区'}
          aria-label="切换双面板"
          onClick={() => setDual(v => !v)}
        >
          <Columns2 size={13} />
        </button>
      </div>

      {dual ? (
        <div className="hq-right-rail-body hq-rail-dual" ref={dualBodyRef}>
          <RailPaneUnit tab={tabA} onTab={setTabA} style={{ flex: '0 0 calc(' + splitPct + '% - 3px)' }} />
          <div className="hq-rail-splitter" onPointerDown={onSplitterDown} role="separator" aria-orientation="horizontal" />
          <RailPaneUnit tab={tabB} onTab={setTabB} style={{ flex: '1 1 auto' }} />
        </div>
      ) : (
        <div className="hq-right-rail-body">
          {railPaneBody(tab)}
        </div>
      )}

      <ResizeBar varName="--right-w" storeKey="hq_right_w" min={220} max={420} edge="left" />
    </aside>
  )
}
