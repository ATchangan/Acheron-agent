import React, { useMemo } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { View } from '../App'
import ResizeBar from './ResizeBar'

interface Props { currentView: View; onNavigate: (v: View) => void }

// 使用 SVG 图标替代 Unicode
const ChatIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
const AgentIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 11 8 11s8-5.6 8-11a8 8 0 0 0-8-8z"/></svg>
const MemoryIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
const SettingsIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>

const BrowserIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>
const SearchIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>

const NAV_ITEMS: { id: View; icon: React.ReactNode; label: string }[] = [
  { id: 'chat', icon: <ChatIcon />, label: '对话' },
  { id: 'agents', icon: <AgentIcon />, label: 'Agent 编队' },
  { id: 'browser', icon: <BrowserIcon />, label: '浏览器' },
  { id: 'settings', icon: <SettingsIcon />, label: '设置' },
]

export default function Sidebar({ currentView, onNavigate }: Props) {
  const sessions = useChatStore(s => s.sessions)
  const currentId = useChatStore(s => s.cid)
  const switchS = useChatStore(s => s.switchS)
  const create = useChatStore(s => s.create)
  const del = useChatStore(s => s.del)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const setMode = useSettingsStore(s => s.setMode)

  // 显示全部会话(不按模式过滤) —— 删除会话后聊天框不再"残留"其他模式的会话消息(删光=空白)
  const filtered = sessions

  const handleSwitch = (id: string) => {
    const s = sessions.find(x => x.id === id)
    if (s?.mode && s.mode !== mode) setMode(s.mode)
    switchS(id)
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
          <div className="sidebar-section-label" style={{ marginTop: 6 }}>
            {searchResults !== null ? '搜索结果' : (mode === 'chat' ? '聊天会话' : '工作会话') + ' · ' + filtered.length}
          </div>
          <div style={{ position: 'relative', margin: '4px 6px 6px' }}>
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}><SearchIcon /></span>
            <input
              value={searchQ}
              onChange={e => onSearch(e.target.value)}
              placeholder="搜索会话…"
              style={{ width: '100%', padding: '5px 8px 5px 24px', background: 'rgba(20,20,40,0.8)', border: '1px solid #3a3c46', color: 'var(--text-primary)', borderRadius: 6, fontSize: 'calc(var(--ui-font-size) - 2px)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div className="session-list">
            {(searchResults !== null ? searchResults.map(r => ({ id: r.sid, title: r.title, snippet: r.snippet, ts: r.ts, mode: undefined, busy: undefined })) : filtered).map(s => (
              <div key={s.id} className={`session-item ${s.id === currentId ? 'active' : ''}`}
                onClick={() => (searchResults !== null ? pickSearch(s.id) : handleSwitch(s.id))}
                role="button"
                tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (searchResults !== null ? pickSearch(s.id) : handleSwitch(s.id))}
              >
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span className="session-title" title={s.title}>{s.title}</span>
                  {'snippet' in s && s.snippet
                    ? <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.snippet}>{s.snippet}</span>
                    : null}
                </span>
                {!('snippet' in s) && <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: (s.mode || 'work') === 'work' ? 'var(--accent)' : 'var(--success)', border: '1px solid currentColor', borderRadius: 4, padding: '0 4px', marginLeft: 6, flexShrink: 0, opacity: 0.85 }}>{(s.mode || 'work') === 'work' ? '工作' : '聊天'}</span>}
                {s.busy && <span className="session-busy" title="该会话正在工作中，可切换到其他会话独立使用">● 工作中</span>}
                {!('snippet' in s) && <button className="session-delete" onClick={e => { e.stopPropagation(); del(s.id) }}
                  title="删除会话" aria-label="删除会话"
                  style={{ width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 'calc(var(--ui-font-size) + 1px)' }}>
                  ×
                </button>}
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
