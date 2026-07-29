import React, { useState, useEffect } from 'react'
import { useChatStore } from '../store/chat'
import type { View } from '../App'

interface Props { currentView: View; onNavigate: (v: View) => void }

export default function Sidebar({ currentView, onNavigate }: Props) {
  const sessions = useChatStore(s => s.sessions)
  const currentId = useChatStore(s => s.currentId)
  const switchSession = useChatStore(s => s.switchSession)
  const createSession = useChatStore(s => s.createSession)
  const deleteSession = useChatStore(s => s.deleteSession)
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])

  useEffect(() => {
    window.huangquan.skills.list().then(setSkills).catch(() => {})
  }, [])

  return (
    <aside className="sidebar">
      <div className="sidebar-top-bar">
        <span className="brand-text">黄泉<span className="brand-sub">· HUANGQUAN</span></span>
        <div className="sidebar-top-actions">
          <button onClick={createSession} title="新对话">+</button>
        </div>
      </div>

      <div className="sidebar-menu">
        <div className={`menu-item ${currentView === 'chat' ? 'active' : ''}`} onClick={() => onNavigate('chat')}>
          <span className="menu-icon">▸</span><span>对话</span>
        </div>
        <div className={`menu-item ${currentView === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')}>
          <span className="menu-icon">⚙</span><span>设置</span>
        </div>
        <div className="menu-item">
          <span className="menu-icon">🛡️</span><span>沙盒</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--accent-green)' }}>开启</span>
        </div>
        <div className="menu-item">
          <span className="menu-icon">🌐</span><span>浏览器</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>关闭</span>
        </div>
      </div>

      {/* Skills */}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', padding: '0 4px' }}>Skills</div>
      <div className="session-list">
        {skills.map(s => (
          <div key={s.name} className="session-item" title={s.description}>
            <span className="session-title">{s.name}</span>
          </div>
        ))}
        {skills.length === 0 && <div className="empty-tip">无技能</div>}
      </div>

      {/* 会话列表 */}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', padding: '0 4px', marginTop: 8 }}>会话</div>
      <div className="session-list">
        {sessions.map(s => (
          <div key={s.id} className={`session-item ${s.id === currentId ? 'active' : ''}`}
            onClick={() => switchSession(s.id)}>
            <span className="session-title">{s.title}</span>
            <button className="session-delete"
              onClick={e => { e.stopPropagation(); deleteSession(s.id) }}>×</button>
          </div>
        ))}
        {sessions.length === 0 && <div className="empty-tip">尚无对话</div>}
      </div>
    </aside>
  )
}
