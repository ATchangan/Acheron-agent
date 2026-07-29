import React, { useState, useEffect, useMemo } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { View } from '../App'

interface Props { currentView: View; onNavigate: (v: View) => void }

export default function Sidebar({ currentView, onNavigate }: Props) {
  const sessions = useChatStore(s => s.sessions)
  const currentId = useChatStore(s => s.cid)
  const switchS = useChatStore(s => s.switchS)
  const create = useChatStore(s => s.create)
  const del = useChatStore(s => s.del)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const setMode = useSettingsStore(s => s.setMode)
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])

  useEffect(() => { window.huangquan.skills.list().then(setSkills).catch(() => {}) }, [])

  const filtered = useMemo(() => sessions.filter(s => (s.mode || 'work') === mode), [sessions, mode])

  const handleSwitch = (id: string) => {
    const s = sessions.find(x => x.id === id)
    if (s?.mode && s.mode !== mode) setMode(s.mode)
    switchS(id)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top-bar">
        <span className="brand-text">黄泉<span className="brand-sub">· HUANGQUAN</span></span>
        <div className="sidebar-top-actions">
          <button onClick={create} title="新对话">+</button>
        </div>
      </div>

      <div className="sidebar-menu">
        <div className={`menu-item ${currentView === 'chat' ? 'active' : ''}`} onClick={() => onNavigate('chat')}>
          <span className="menu-icon">▸</span><span>对话</span>
        </div>
        <div className={`menu-item ${currentView === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')}>
          <span className="menu-icon">⚙</span><span>设置</span>
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', padding: '0 4px' }}>
        {mode === 'chat' ? '💬 聊天' : '🔧 工作'} ({filtered.length})
      </div>
      <div className="session-list">
        {filtered.map(s => (
          <div key={s.id} className={`session-item ${s.id === currentId ? 'active' : ''}`}
            onClick={() => handleSwitch(s.id)}>
            <span className="session-title">{s.title}</span>
            <button className="session-delete" onClick={e => { e.stopPropagation(); del(s.id) }}>×</button>
          </div>
        ))}
        {filtered.length === 0 && <div className="empty-tip">暂无{mode === 'chat' ? '聊天' : '工作'}记录</div>}
      </div>

      {skills.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', padding: '0 4px', marginTop: 8 }}>Skills</div>
          <div className="session-list">
            {skills.map(s => (
              <div key={s.name} className="session-item" title={s.description}>
                <span className="session-title">{s.name}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
