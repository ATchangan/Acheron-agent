import React, { useMemo } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { View } from '../App'

interface Props { currentView: View; onNavigate: (v: View) => void }

const NAV_ITEMS: { id: View; icon: string; label: string }[] = [
  { id: 'chat', icon: '▸', label: '对话' },
  { id: 'agents', icon: '◉', label: 'Agent' },
  { id: 'memory', icon: '◈', label: '记忆' },
  { id: 'settings', icon: '⚙', label: '设置' },
]

export default function Sidebar({ currentView, onNavigate }: Props) {
  const sessions = useChatStore(s => s.sessions)
  const currentId = useChatStore(s => s.cid)
  const switchS = useChatStore(s => s.switchS)
  const create = useChatStore(s => s.create)
  const del = useChatStore(s => s.del)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const setMode = useSettingsStore(s => s.setMode)

  const filtered = useMemo(() => sessions.filter(s => (s.mode || 'work') === mode), [sessions, mode])

  const handleSwitch = (id: string) => {
    const s = sessions.find(x => x.id === id)
    if (s?.mode && s.mode !== mode) setMode(s.mode)
    switchS(id)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top-bar">
        <span className="brand-text">
          黄泉
        </span>
        <div className="sidebar-top-actions">
          <button onClick={create} title="新对话" style={{ fontSize:18,padding:'4px 10px',cursor:'pointer',background:'none',border:'none',color:'#9999AA',borderRadius:4,lineHeight:1 }}>+</button>
        </div>
      </div>

      <div className="sidebar-nav">
        <div className="sidebar-section-label">导航</div>
        {NAV_ITEMS.map(item => (
          <div
            key={item.id}
            className={`menu-item ${currentView === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="menu-icon">{item.icon}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      {currentView === 'chat' && (
        <>
          <div className="sidebar-section-label" style={{ marginTop: 6 }}>
            {mode === 'chat' ? '聊天会话' : '工作会话'} · {filtered.length}
          </div>
          <div className="session-list">
            {filtered.map(s => (
              <div key={s.id} className={`session-item ${s.id === currentId ? 'active' : ''}`}
                onClick={() => handleSwitch(s.id)}>
                <span className="session-title">{s.title}</span>
                <button className="session-delete" onClick={e => { e.stopPropagation(); del(s.id) }}>×</button>
              </div>
            ))}
            {filtered.length === 0 && <div className="empty-tip">暂无记录</div>}
          </div>
        </>
      )}
    </aside>
  )
}
