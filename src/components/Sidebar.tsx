import React from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { View } from '../App'
import ResizeBar from './ResizeBar'
import { U } from './ui-styles'


interface Props { currentView: View; onNavigate: (v: View) => void }

// 使用 SVG 图标替代 Unicode
const ChatIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
const AgentIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 11 8 11s8-5.6 8-11a8 8 0 0 0-8-8z"/></svg>

const SettingsIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>

const BrowserIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>
const SearchIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
const FolderIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
// 图钉(置顶)图标 —— 与侧边栏其余线性图标风格一致; 置顶时实心高亮
const PinIcon = ({ pinned }: { pinned: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
  </svg>
)

const NAV_ITEMS: { id: View; icon: React.ReactNode; label: string }[] = [
  { id: 'chat', icon: <ChatIcon />, label: '对话' },
  { id: 'agents', icon: <AgentIcon />, label: '角色编队' },
  { id: 'browser', icon: <BrowserIcon />, label: '浏览器' },
  { id: 'files', icon: <FolderIcon />, label: '文件' },
  { id: 'settings', icon: <SettingsIcon />, label: '设置' },
]

export default function Sidebar({ currentView, onNavigate }: Props) {
  const sessions = useChatStore(s => s.sessions)
  const currentId = useChatStore(s => s.cid)
  const switchS = useChatStore(s => s.switchS)
  const create = useChatStore(s => s.create)
  const del = useChatStore(s => s.del)
  const togglePin = useChatStore(s => s.togglePin)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const setMode = useSettingsStore(s => s.setMode)

  // 左侧只显示当前模式(聊天/工作)的历史会话; 切换模式用顶部「聊天/工作」标签
  // 置顶会话永远排最前(组内保持原有顺序)
  const filtered = sessions.filter(s => (s.mode || 'work') === mode).slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))

  const handleSwitch = async (id: string) => {
    const s = sessions.find(x => x.id === id)
    // 先等 setMode 完成再切会话 —— setMode 内部会把 cid 指向该模式第一个会话,
    // 若不等待, 异步结果会晚到并覆盖掉用户点选的会话(历史会话点不进/聊错会话)
    if (s?.mode && s.mode !== mode) await setMode(s.mode)
    await switchS(id)
  }

  // 历史会话搜索框(实时调 sessions:search)
  const [searchQ, setSearchQ] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<{ sid: string; title: string; role: string; snippet: string; ts: number }[] | null>(null)
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
    handleSwitch(sid)
    setSearchQ('')
    setSearchResults(null)
  }

  return (
    <aside className="sidebar" style={{ position: 'relative' }}>
      {/* 品牌区 */}
      <div className="sidebar-top-bar">
        <span className="brand-text">黄泉</span>
        <div className="sidebar-top-actions">
          <button onClick={create} title="新对话" aria-label="新对话" style={{ minWidth: 36, height: 36, padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', background: 'var(--accent)', border: 'none', color: 'var(--on-accent)', borderRadius: 8, fontSize: 'var(--ui-font-size)', fontWeight: 600, transition: 'all .12s' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>

      {/* 导航 */}
      <div className="sidebar-nav">
        <div className="sidebar-section-label">导航</div>
        {NAV_ITEMS.map(item => (
          <div
            key={item.id}
            className={`menu-item ${currentView === item.id ? 'active' : ''}`}
            onClick={() => {
              // 浏览器导航 -> 打开独立浏览器窗口
              if (item.id === 'browser') { try { window.huangquan?.web.showPanel() } catch {} return }
              onNavigate(item.id)
            }}
            role="button"
            tabIndex={0}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onNavigate(item.id)}
          >
            <span className="menu-icon">{item.icon}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      {/* 会话列表 */}
      {currentView === 'chat' && (
        <>
          <div className="sidebar-section-label" style={U.mt6}>
            {(mode === 'chat' ? '聊天会话' : '工作会话') + ' · ' + filtered.length}
          </div>
          <div style={{ position: 'relative', margin: '4px 6px 6px' }}>
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}><SearchIcon /></span>
            <input
              value={searchQ}
              onChange={e => onSearch(e.target.value)}
              placeholder="搜索会话…"
              style={{ width: '100%', padding: '5px 8px 5px 24px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, fontSize: 'calc(var(--ui-font-size) - 2px)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div className="session-list">
            {searchResults !== null && <div className="sidebar-section-label" style={U.mt6}>搜索结果</div>}
            {searchResults !== null ? searchResults.map(r => ({ id: r.sid, title: r.title, snippet: r.snippet, ts: r.ts, mode: undefined, busy: undefined, isSearch: true as const })).map(s => (
              <div key={s.id} className={`session-item ${s.id === currentId ? 'active' : ''}`}
                onClick={() => (searchResults !== null ? pickSearch(s.id) : handleSwitch(s.id))}
                role="button"
                tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (searchResults !== null ? pickSearch(s.id) : handleSwitch(s.id))}
              >
                <span style={U.column1}>
                  <span className="session-title" title={s.title}>{s.title}</span>
                  {s.isSearch && s.snippet
                    ? <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.snippet}>{s.snippet}</span>
                    : null}
                </span>
                {!s.isSearch && <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: (s.mode || 'work') === 'work' ? 'var(--accent)' : 'var(--success)', border: '1px solid currentColor', borderRadius: 4, padding: '0 4px', marginLeft: 6, flexShrink: 0, opacity: 0.85 }}>{(s.mode || 'work') === 'work' ? '工作' : '聊天'}</span>}
                {s.busy && <span className="session-busy" title="该会话正在工作中，可切换到其他会话独立使用">● 工作中</span>}
                {!s.isSearch && <button className="session-delete" onClick={e => { e.stopPropagation(); del(s.id) }}
                  title="删除会话" aria-label="删除会话"
                  style={{ width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 'calc(var(--ui-font-size) + 1px)' }}>
                  ×
                </button>}
              </div>
            )) : filtered.map(s => (
              <div key={s.id} className={`session-item ${s.id === currentId ? 'active' : ''}`}
                onClick={() => handleSwitch(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleSwitch(s.id)}
              >
                <span style={U.column1}>
                  <span className="session-title" title={s.title}>{s.title}</span>
                </span>
                {s.busy && <span className="session-busy" title="该会话正在工作中，可切换到其他会话独立使用">● 工作中</span>}
                <button className="session-pin" onClick={e => { e.stopPropagation(); togglePin(s.id) }}
                  title={s.pinned ? '取消置顶' : '置顶（永久保留，不受数量上限清理）'} aria-label={s.pinned ? '取消置顶' : '置顶'}
                  style={{ width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0, color: s.pinned ? 'var(--accent)' : 'var(--text-muted)', opacity: s.pinned ? 1 : 0.55, transition: 'all .12s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.opacity = '1' }}
                  onMouseLeave={e => { e.currentTarget.style.color = s.pinned ? 'var(--accent)' : 'var(--text-muted)'; e.currentTarget.style.opacity = s.pinned ? '1' : '0.55' }}>
                  <PinIcon pinned={!!s.pinned} />
                </button>
                <button className="session-delete" onClick={e => { e.stopPropagation(); del(s.id) }}
                  title="删除会话" aria-label="删除会话"
                  style={{ width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 'calc(var(--ui-font-size) + 1px)' }}>
                  ×
                </button>
              </div>
            ))}
            {searchResults !== null && searchResults.length === 0 && <div className="empty-tip">没有匹配的会话</div>}
            {searchResults === null && filtered.length === 0 && <div className="empty-tip">暂无记录</div>}
          </div>
        </>
      )}
      <ResizeBar varName="--sidebar-w" storeKey="hq_sidebar_w" min={140} max={420} edge="right" />
    </aside>
  )
}
