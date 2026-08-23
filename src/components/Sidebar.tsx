// Sidebar.tsx —— v0.4.2 会话侧栏：品牌区 / 新对话 / 模式分段 / 搜索 / 日期分组列表 / 底部导航
// 对齐参考 chat/sidebar：置顶区 + 今天/昨天/更早 分区，每区可折叠，行内 hover 操作(置顶/删除)
import React, { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import { resolveDisplay } from '../store/display'
import type { View } from '../App'
import ResizeBar from './ResizeBar'
import { U } from './ui-styles'
import { Search, SquarePen, ChevronRight, Pin, BookOpen, Package, Hourglass, Command, Users, Archive, ArrowDownUp, KeyRound, Activity, LayoutList } from 'lucide-react'

interface Props { currentView: View; onNavigate: (v: View) => void }

const ChatIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
const AgentIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 11 8 11s8-5.6 8-11a8 8 0 0 0-8-8z"/></svg>
const SettingsIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
const BrowserIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>
const FolderIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
const MemoryIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44A2.5 2.5 0 0 1 4 17.5v-2A2.5 2.5 0 0 1 6.5 13a2.5 2.5 0 0 1-2-3.55A2.5 2.5 0 0 1 7.5 5.5H8A2.5 2.5 0 0 1 9.5 2z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44A2.5 2.5 0 0 0 20 17.5v-2a2.5 2.5 0 0 0-2.5-2.5 2.5 2.5 0 0 0 2-3.55A2.5 2.5 0 0 0 16.5 5.5H16A2.5 2.5 0 0 0 14.5 2z"/></svg>

const NAV_ITEMS: { id: View; icon: React.ReactNode; label: string }[] = [
  { id: 'chat', icon: <ChatIcon />, label: '对话' },
  { id: 'agents', icon: <AgentIcon />, label: '子代理' },
  { id: 'memory', icon: <MemoryIcon />, label: '记忆' },
  { id: 'browser', icon: <BrowserIcon />, label: '浏览器' },
  { id: 'files', icon: <FolderIcon />, label: '文件' },
  { id: 'settings', icon: <SettingsIcon />, label: '设置' },
]

// 页面导航：技能/产物为工作区页面，定时任务/命令中心/配置档案为 Overlay
const PAGE_ITEMS: { id: View; icon: React.ReactNode; label: string }[] = [
  { id: 'skills', icon: <BookOpen size={14} />, label: '技能' },
  { id: 'artifacts', icon: <Package size={14} />, label: '产物' },
  { id: 'cron', icon: <Hourglass size={14} />, label: '定时任务' },
  { id: 'command-center', icon: <Command size={14} />, label: '命令中心' },
  { id: 'profiles', icon: <Users size={14} />, label: '配置档案' },
  { id: 'keys', icon: <KeyRound size={14} />, label: 'API Keys' },
]

type GroupKey = 'pinned' | 'today' | 'yesterday' | 'earlier'

const GROUP_LABEL: Record<GroupKey, string> = { pinned: '置顶', today: '今天', yesterday: '昨天', earlier: '更早' }

// 日期分组：按会话 updatedAt 的本地日期划分 今天/昨天/更早
function groupOf(updatedAt?: string): Exclude<GroupKey, 'pinned'> {
  if (!updatedAt) return 'today'
  const d = new Date(updatedAt)
  if (isNaN(d.getTime())) return 'today'
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startYesterday = startToday - 86400000
  const t = d.getTime()
  if (t >= startToday) return 'today'
  if (t >= startYesterday) return 'yesterday'
  return 'earlier'
}

export default function Sidebar({ currentView, onNavigate }: Props) {
  const sessions = useChatStore(s => s.sessions)
  const currentId = useChatStore(s => s.cid)
  const switchS = useChatStore(s => s.switchS)
  const create = useChatStore(s => s.create)
  const del = useChatStore(s => s.del)
  const togglePin = useChatStore(s => s.togglePin)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const setMode = useSettingsStore(s => s.setMode)
  const disp = resolveDisplay(useSettingsStore(s => s.general.uiDisplay))
  const sessTokMap = useChatStore(s => s.sessTok)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [showArchived, setShowArchived] = useState(false)
  const [sortKey, setSortKey] = useState<'updated' | 'tokens'>('updated')
  const [busyOnly, setBusyOnly] = useState(false)
  const [cardRows, setCardRows] = useState(false)
  // v0.4.2: 会话拖拽排序（manual ordering）—— 本地持久化
  const ORDER_KEY = 'hq_session_order'
  const [manualOrder, setManualOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') } catch { return [] }
  })
  const persistOrder = (ids: string[]) => { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)) }
  const dragId = useRef<string | null>(null)
  const [sessionsLimit, setSessionsLimit] = useState(50)
  const [projects, setProjects] = useState<{ name: string; branch: string }[]>([])
  const workDir = useSettingsStore(s => s.general.workDir)
  const setWorkDir = useSettingsStore(s => s.setWorkDir)

  // v0.4.2: 项目区 —— 工作目录下的 git 仓库 + 当前分支
  useEffect(() => {
    let alive = true
    setProjects([])
    if (!workDir) return
    const run = async () => {
      try {
        const list = await window.huangquan.computer.readDir(workDir)
        const dirs = (list || []).filter(i => i.isDirectory).map(i => i.name)
        const repos: { name: string; branch: string }[] = []
        for (const d of dirs.slice(0, 10)) {
          const sub = await window.huangquan.computer.readDir(workDir + '\\' + d).then(l => l || []).catch(() => [])
          if (!sub.some(i => i.name === '.git')) continue
          const branch = await window.huangquan.computer.exec('git -C "' + workDir + '\\' + d + '" branch --show-current').then(r => String(r || '').trim()).catch(() => '')
          repos.push({ name: d, branch })
        }
        if (alive) setProjects(repos)
      } catch { if (alive) setProjects([]) }
    }
    void run()
    return () => { alive = false }
  }, [workDir])

  const tokOf = (id: string) => {
    const m = sessTokMap[id] || {}
    let n = 0
    for (const c of Object.values(m)) n += (c.outputTokens || 0)
    return n
  }
  const allFiltered = sessions
    .filter(s => (s.mode || 'work') === mode && (showArchived ? s.archived : !s.archived) && (!busyOnly || s.busy))
    .slice()
    .sort((a, b) => {
      const ma = manualOrder.indexOf(a.id)
      const mb = manualOrder.indexOf(b.id)
      if (ma >= 0 || mb >= 0) return (ma < 0 ? 999 : ma) - (mb < 0 ? 999 : mb)
      if (sortKey === 'tokens') return tokOf(b.id) - tokOf(a.id)
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    })
  const filtered = allFiltered.slice(0, sessionsLimit)
  const archivedCount = sessions.filter(s => (s.mode || 'work') === mode && s.archived).length
  const groupList: { key: GroupKey; items: typeof filtered }[] = [
    { key: 'pinned', items: filtered.filter(s => !showArchived && s.pinned) },
    { key: 'today', items: filtered.filter(s => !s.pinned && groupOf(s.updatedAt) === 'today') },
    { key: 'yesterday', items: filtered.filter(s => !s.pinned && groupOf(s.updatedAt) === 'yesterday') },
    { key: 'earlier', items: filtered.filter(s => !s.pinned && groupOf(s.updatedAt) === 'earlier') },
  ]
  const groups = groupList.filter(g => g.items.length > 0)

  const handleSwitch = async (id: string) => {
    const s = sessions.find(x => x.id === id)
    if (s?.mode && s.mode !== mode) await setMode(s.mode)
    await switchS(id)
  }

  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<{ sid: string; title: string; role: string; snippet: string; ts: number }[] | null>(null)
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSearch = (v: string) => {
    setSearchQ(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!v.trim()) { setSearchResults(null); return }
    searchTimer.current = setTimeout(async () => {
      try { setSearchResults(await window.huangquan.sessions.search(v.trim(), 10)) }
      catch { setSearchResults([]) }
    }, 300)
  }
  const pickSearch = (sid: string) => {
    void handleSwitch(sid)
    setSearchQ('')
    setSearchResults(null)
  }

  const toggleGroup = (k: string) => setCollapsed(c => ({ ...c, [k]: !c[k] }))

  const setArchived = async (id: string, archived: boolean) => {
    try {
      const ok = await window.huangquan.sessions.setArchived(id, archived)
      if (ok) useChatStore.setState(st => ({ sessions: st.sessions.map(x => x.id === id ? { ...x, archived } : x) }))
    } catch { /* 忽略 */ }
  }

  const row = (id: string, title: string, isSearch: boolean, snippet?: string) => {
    const s = sessions.find(x => x.id === id)
    const tokN = tokOf(id)
    return (
      <div key={id} className={'session-item' + (id === currentId ? ' active' : '') + (cardRows && !isSearch ? ' hq-session-card' : '')}
        onClick={() => (isSearch ? pickSearch(id) : void handleSwitch(id))}
        role="button" tabIndex={0}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (isSearch ? pickSearch(id) : void handleSwitch(id))}
        draggable={!isSearch}
        onDragStart={e => { dragId.current = id; e.dataTransfer.effectAllowed = 'move' }}
        onDragOver={e => { if (!isSearch && dragId.current && dragId.current !== id) e.preventDefault() }}
        onDrop={e => {
          e.preventDefault()
          const from = dragId.current
          dragId.current = null
          if (!from || from === id) return
          const ids = filtered.map(x => x.id)
          const a = ids.indexOf(from)
          const b = ids.indexOf(id)
          if (a < 0 || b < 0) return
          ids.splice(a, 1)
          ids.splice(b, 0, from)
          setManualOrder(ids)
          persistOrder(ids)
        }}
      >
        <span style={U.column1}>
          <span className="session-title" title={title}>{title}</span>
          {isSearch && snippet
            ? <span className="session-snippet" title={snippet}>{snippet}</span>
            : cardRows ? <span className="session-card-meta">{s?.updatedAt ? new Date(s.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}{tokN > 0 ? ' · ' + (tokN >= 1000 ? (tokN / 1000).toFixed(1) + 'k' : tokN) + ' tok' : ''}</span> : null}
        </span>
        {!isSearch && s?.busy && <span className="session-busy" title="该会话正在工作中">●</span>}
        {!isSearch && (
          <button className="session-pin" onClick={e => { e.stopPropagation(); togglePin(id) }}
            title={s?.pinned ? '取消置顶' : '置顶（永久保留）'} aria-label={s?.pinned ? '取消置顶' : '置顶'}>
            <Pin size={12} style={{ fill: s?.pinned ? 'currentColor' : 'none' }} />
          </button>
        )}
        {!isSearch && (
          <button className="session-pin" onClick={e => { e.stopPropagation(); void setArchived(id, !s?.archived) }}
            title={s?.archived ? '恢复会话' : '归档会话'} aria-label={s?.archived ? '恢复会话' : '归档会话'}>
            <Archive size={12} style={{ opacity: s?.archived ? 1 : 0.85 }} />
          </button>
        )}
        {!isSearch && (
          <button className="session-delete" onClick={e => { e.stopPropagation(); del(id) }}
            title="删除会话" aria-label="删除会话">×</button>
        )}
      </div>
    )
  }

  return (
    <aside className="sidebar" style={{ position: 'relative' }}>
      {/* 品牌区(: logo + 名称 + 在线状态) */}
      <div className="sidebar-top-bar">
        <div className="sidebar-brand">
          <img className="sidebar-brand-logo" src="huangquan.png" alt="黄泉" style={{ background: 'var(--bg-elevated)', objectFit: 'cover', objectPosition: 'center 28%' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-row">
              <span className="sidebar-brand-name">Acheron-Agent</span>
              <span className="sidebar-status-dot" title="在线" />
            </div>
          </div>
        </div>
      </div>

      {/* 新对话按钮 */}
      <button className="hq-sb-newchat" onClick={create} title="新对话 (Ctrl+N)" aria-label="新对话">
        <SquarePen size={14} />
        <span>新对话</span>
      </button>

      {/* 页面导航(导航行, 常驻侧栏上部, 底部只留图标导航) */}
      <div className="hq-sb-pages">
        {PAGE_ITEMS.map(item => (
          <button
            key={item.id}
            type="button"
            className={'hq-nav-item hq-sb-page' + (currentView === item.id ? ' active' : '')}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="hq-sb-page-label">{item.label}</span>
          </button>
        ))}
      </div>

      {/* 项目区(projects: git 仓库 + 分支) */}
      {projects.length > 0 && (
        <div className="hq-sb-projects">
          <div className="hq-sb-projects-label">项目</div>
          {projects.map(p => (
            <button key={p.name} type="button" className="hq-nav-item hq-sb-page hq-sb-project" title={'切换到 ' + p.name} onClick={() => setWorkDir(workDir + '\\' + p.name)}>
              <span className="nav-icon"><FolderIcon /></span>
              <span className="hq-sb-page-label">{p.name}</span>
              {p.branch && <span className="hq-sb-branch" title="当前分支">{p.branch}</span>}
            </button>
          ))}
        </div>
      )}

      {currentView === 'chat' && !disp.hideSessionList ? (
        <>
          {/* 聊天/工作模式分段 */}
          <div className="sidebar-section-label" style={{ ...U.mt6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <div className="hq-seg">
              {(['chat', 'work'] as const).map(m => (
                <span
                  key={m}
                  onClick={() => { if (m !== mode) void setMode(m) }}
                  role="button" tabIndex={0}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && m !== mode && void setMode(m)}
                  className={'hq-seg-item' + (mode === m ? ' active' : '')}
                >
                  {m === 'chat' ? '聊天' : '工作'}
                </span>
              ))}
            </div>
            <span className="hq-sb-count">{filtered.length}</span>
            <span className="hq-sb-spacer" />
            <span className="sb-session-tools">
            <button
              type="button"
              className={'hq-sb-mini' + (showArchived ? ' active' : '')}
              title={showArchived ? '隐藏归档会话' : '显示归档会话'}
              aria-label="归档筛选"
              onClick={() => setShowArchived(v => !v)}
            >
              <Archive size={12} />
              {archivedCount > 0 && <span className="hq-sb-mini-badge">{archivedCount}</span>}
            </button>
            <button
              type="button"
              className={'hq-sb-mini' + (sortKey === 'tokens' ? ' active' : '')}
              title={sortKey === 'tokens' ? '按更新时间排序' : '按 Token 用量排序'}
              aria-label="会话排序"
              onClick={() => setSortKey(k => (k === 'updated' ? 'tokens' : 'updated'))}
            >
              <ArrowDownUp size={12} />
            </button>
            <button
              type="button"
              className={'hq-sb-mini' + (busyOnly ? ' active' : '')}
              title={busyOnly ? '显示全部会话' : '只看进行中'}
              aria-label="进行中筛选"
              onClick={() => setBusyOnly(v => !v)}
            >
              <Activity size={12} />
            </button>
            <button
              type="button"
              className={'hq-sb-mini' + (cardRows ? ' active' : '')}
              title={cardRows ? '单行紧凑' : '双行卡片'}
              aria-label="卡片行"
              onClick={() => setCardRows(v => !v)}
            >
              <LayoutList size={12} />
            </button>
            </span>
          </div>

          {/* 会话搜索 */}
          {!disp.hideSessionSearch && (
            <div className="hq-sb-search">
              <Search size={13} />
              <input
                value={searchQ}
                onChange={e => onSearch(e.target.value)}
                placeholder="搜索会话…"
                className="hq-search"
              />
            </div>
          )}

          <div className="session-list">
            {searchResults !== null ? (
              <>
                <div className="sidebar-section-label">搜索结果</div>
                {searchResults.map(r => row(r.sid, r.title, true, r.snippet))}
                {searchResults.length === 0 && <div className="empty-tip">没有匹配的会话</div>}
              </>
            ) : groups.length === 0 ? (
              <div className="empty-tip">暂无记录</div>
            ) : groups.map(g => (
              <div key={g.key} className="hq-sb-group">
                <div className="hq-sb-group-head" role="button" tabIndex={0}
                  onClick={() => toggleGroup(g.key)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleGroup(g.key)}>
                  <ChevronRight size={12} className={'hq-sb-chev' + (collapsed[g.key] ? '' : ' open')} />
                  <span className="hq-sb-group-label">{GROUP_LABEL[g.key]}</span>
                  <span className="hq-sb-count">{g.items.length}</span>
                </div>
                {!collapsed[g.key] && g.items.map(s => row(s.id, s.title, false))}
              </div>
            ))}
            {allFiltered.length > sessionsLimit && (
              <button type="button" className="hq-sb-loadmore" onClick={() => setSessionsLimit(n => n + 50)}>
                加载更多（还有 {allFiltered.length - sessionsLimit} 条）
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="sidebar-nav" />
      )}

      {/* 底部导航() */}
      <div className="sidebar-bottom-nav">
        {NAV_ITEMS.filter(item => item.id === 'chat' || item.id === 'settings' || !disp.hiddenNav.includes(item.id)).map(item => (
          <button
            key={item.id}
            className={'hq-nav-bottom' + (currentView === item.id ? ' active' : '')}
            title={item.label}
            onClick={() => {
              if (item.id === 'browser') { try { window.huangquan?.web.showPanel() } catch { /* 忽略 */ } return }
              onNavigate(item.id)
            }}
          >
            {item.icon}
          </button>
        ))}
      </div>

      <ResizeBar varName="--sidebar-w" storeKey="hq_sidebar_w" min={160} max={380} edge="right" />
    </aside>
  )
}
