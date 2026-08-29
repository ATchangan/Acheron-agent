// Sidebar.tsx —— v0.5.0 侧栏改版：页签(聊天/工作) + 菜单行(新建会话/技能与工具/产物/定时任务) + 会话列表 + 底部图标排
// 保留: 置顶/归档/搜索/拖拽排序/日期分组/项目区; 对齐参考: 深色工作台侧栏
import React, { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import { resolveDisplay } from '../store/display'
import type { View } from '../App'
import ResizeBar from './ResizeBar'
import { U } from './ui-styles'
import { Search, SquarePen, ChevronRight, Pin, Archive, ArrowDownUp, Activity, LayoutList, Wrench, FileOutput, Timer, Home, MessageSquare, Globe, Folder, Settings as SettingsIcon, FolderPlus, MoreHorizontal, ListTodo, Store, MessagesSquare } from 'lucide-react'
import BotsList from './BotsList'
import ProfileStrip from './ProfileStrip'

interface Props { currentView: View; onNavigate: (v: View) => void }

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
          // 安全: 目录名拼进 shell 前检查元字符, 含命令字符的目录名直接跳过(不显示分支)
          const full = workDir + '\\' + d
          if (/[&|<>^"%!]/.test(full)) continue
          const branch = await window.huangquan.computer.exec('git -C "' + full + '" branch --show-current').then(r => String(r || '').trim()).catch(() => '')
          repos.push({ name: d, branch })
        }
        if (alive) setProjects(repos)
      } catch { if (alive) setProjects([]) }
    }
    void run()
    return () => { alive = false }
  }, [workDir])

  // v0.5.0: 新建项目 —— 选择一个文件夹作为工作目录
  const newProject = async () => {
    try {
      const dir = await window.huangquan.computer.selectDir()
      if (dir) await setWorkDir(dir)
    } catch { /* 用户取消或失败可忽略 */ }
  }

  // v0.4.4 BOTS 页签: 与聊天/工作并排的第三页签, 展示预设角色助手
  const [botTab, setBotTab] = useState(false)

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

  const menuBtn = (label: string, icon: React.ReactNode, onClick: () => void, active?: boolean, right?: React.ReactNode, title?: string) => (
    <button type="button" className={'sb-menu-item' + (active ? ' active' : '')} title={title || label} onClick={onClick}>
      <span className="sm-icon">{icon}</span>
      <span className="sm-label">{label}</span>
      {right && <span className="sm-label-right">{right}</span>}
    </button>
  )

  return (
    <aside className="sidebar" style={{ position: 'relative' }}>
      {/* 顶部页签（对齐参考: SESSIONS / BOTS 两页签; 聊天/工作模式段落在会话列表内部） */}
      <div className="sb-mode-tabs">
        <button
          type="button"
          className={'sb-mode-tab' + (!botTab ? ' active' : '')}
          onClick={() => setBotTab(false)}
        >
          会话
          {!botTab && <span className="sb-mode-count">{filtered.length}</span>}
        </button>
        <button
          type="button"
          className={'sb-mode-tab' + (botTab ? ' active' : '')}
          title="预设角色助手"
          onClick={() => setBotTab(true)}
        >
          BOTS
        </button>
      </div>

      {/* 菜单区 */}
      <div className="sb-menu">
        {menuBtn('新建会话', <SquarePen size={15} />, create, false,
          <span style={{ display: 'inline-flex', gap: 3 }}><span className="sb-kbd">Ctrl</span><span className="sb-kbd">N</span></span>,
          '新建会话 (Ctrl+N)')}
        {menuBtn('技能与工具', <Wrench size={15} />, () => onNavigate('capability'), currentView === 'capability')}
        {menuBtn('插件市场', <Store size={15} />, () => onNavigate('plugins'), currentView === 'plugins')}
        {menuBtn('消息平台', <MessagesSquare size={15} />, () => onNavigate('messages'), currentView === 'messages', undefined, 'QQ 官方机器人接入')}
        {menuBtn('产物', <FileOutput size={15} />, () => onNavigate('artifact'), currentView === 'artifact', undefined, '工作目录产物浏览')}
        {menuBtn('定时任务', <Timer size={15} />, () => onNavigate('cron'), currentView === 'cron')}
        {menuBtn('任务', <ListTodo size={15} />, () => onNavigate('tasks'), currentView === 'tasks', undefined, '进行中任务与历史')}
      </div>

      {/* 项目区(projects: git 仓库 + 分支) */}
      {projects.length > 0 && (
        <div className="hq-sb-projects">
          {projects.map(p => (
            <button key={p.name} type="button" className="hq-nav-item hq-sb-page hq-sb-project" title={'切换到 ' + p.name} onClick={() => setWorkDir(workDir + '\\' + p.name)}>
              <span className="nav-icon"><Folder size={14} /></span>
              <span className="hq-sb-page-label">{p.name}</span>
              {p.branch && <span className="hq-sb-branch" title="当前分支">{p.branch}</span>}
            </button>
          ))}
        </div>
      )}

      {botTab ? (
        /* v0.4.4 BOTS: 聊天式 Bot 会话列表（对齐参考） */
        <BotsList onNavigate={onNavigate} />
      ) : currentView === 'chat' && !disp.hideSessionList ? (
        <>
          {/* 聊天/工作模式段落 + 会话筛选工具 */}
          <div className="sb-mode-tabs" style={{ paddingTop: 2 }}>
            {(['chat', 'work'] as const).map(m => (
              <button
                key={m}
                type="button"
                className={'sb-mode-tab sb-mode-sub' + (mode === m ? ' active' : '')}
                onClick={() => { if (m !== mode) void setMode(m) }}
              >
                {m === 'chat' ? '聊天' : '工作'}
                {mode === m && <span className="sb-mode-count">{filtered.length}</span>}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <span className="sb-session-tools" style={{ opacity: 1, pointerEvents: 'auto' }}>
              <button type="button" className={'hq-sb-mini' + (showArchived ? ' active' : '')} title={showArchived ? '隐藏归档会话' : '显示归档会话'} aria-label="归档筛选" onClick={() => setShowArchived(v => !v)}>
                <Archive size={12} />
                {archivedCount > 0 && <span className="hq-sb-mini-badge">{archivedCount}</span>}
              </button>
              <button type="button" className={'hq-sb-mini' + (sortKey === 'tokens' ? ' active' : '')} title={sortKey === 'tokens' ? '按更新时间排序' : '按 Token 用量排序'} aria-label="会话排序" onClick={() => setSortKey(k => (k === 'updated' ? 'tokens' : 'updated'))}>
                <ArrowDownUp size={12} />
              </button>
              <button type="button" className={'hq-sb-mini' + (busyOnly ? ' active' : '')} title={busyOnly ? '显示全部会话' : '只看进行中'} aria-label="进行中筛选" onClick={() => setBusyOnly(v => !v)}>
                <Activity size={12} />
              </button>
              <button type="button" className={'hq-sb-mini' + (cardRows ? ' active' : '')} title={cardRows ? '单行紧凑' : '双行卡片'} aria-label="卡片行" onClick={() => setCardRows(v => !v)}>
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
              /* v0.5.0 空态: 幽灵图标 + 暂无会话 + 新建项目 */
              <div className="sb-session-empty">
                <div className="sse-icon"><MessageSquare size={19} /></div>
                <span className="sse-text">暂无会话</span>
                <button type="button" className="sb-newproject-btn" title="选择一个文件夹作为工作目录" onClick={() => { void newProject() }}>
                  <FolderPlus size={14} />新建项目
                </button>
              </div>
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

      {/* 底部图标排: 对话 / 浏览器 / 文件 / 更多(命令面板) / 设置 */}
      {/* v0.4.4 配置档案条（对齐参考 侧栏底部） */}
      <ProfileStrip />

      <div className="sidebar-bottom-nav">
        <button type="button" className={'hq-nav-bottom' + (currentView === 'chat' ? ' active' : '')} title="对话" onClick={() => onNavigate('chat')}><Home size={15} /></button>
        <button type="button" className="hq-nav-bottom" title="浏览器" onClick={() => { try { window.huangquan?.web.showPanel() } catch { /* 忽略 */ } }}><Globe size={15} /></button>
        <button type="button" className="hq-nav-bottom" title="文件（右栏）" onClick={() => onNavigate('files')}><Folder size={15} /></button>
        <span className="hq-nav-bottom hq-nav-spacer" />
        <button type="button" className="hq-nav-bottom" title="命令面板 (Ctrl+K)" onClick={() => window.dispatchEvent(new CustomEvent('hq-open-palette'))}><MoreHorizontal size={15} /></button>
        <button type="button" className={'hq-nav-bottom' + (currentView === 'settings' ? ' active' : '')} title="设置" onClick={() => onNavigate('settings')}><SettingsIcon size={15} /></button>
      </div>

      <ResizeBar varName="--sidebar-w" storeKey="hq_sidebar_w" min={160} max={380} edge="right" />
    </aside>
  )
}

