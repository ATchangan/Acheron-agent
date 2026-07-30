import React, { useEffect, useState } from 'react'
import { useSettingsStore } from './store/settings'
import { useChatStore } from './store/chat'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import RightPanel from './components/RightPanel'
import SettingsView from './components/SettingsView'
import AgentsView from './components/AgentsView'
import MemoryView from './components/MemoryView'

export type View = 'chat' | 'settings' | 'agents'

export default function App() {
  const [view, setView] = useState<View>('chat')

  useEffect(() => {
    useSettingsStore.getState().load()
    useChatStore.getState().load()
    const settings = useSettingsStore.getState()
    const theme = settings.general.theme || 'huangquan'
    document.documentElement.setAttribute('data-theme', theme)
    // v0.2: 恢复自定义主题
    const cc = (settings.general as any).customColors
    if (cc) {
      const r = document.documentElement.style
      if (cc.bg) r.setProperty('--bg-root', cc.bg)
      if (cc.surface) r.setProperty('--bg-surface', cc.surface)
      if (cc.card) r.setProperty('--bg-card', cc.card)
      if (cc.accent) r.setProperty('--accent', cc.accent)
      if (cc.text) r.setProperty('--text-primary', cc.text)
      if (cc.border) r.setProperty('--border', cc.border)
    }
    // v0.2: 恢复透明度
    const op = (settings.general as any).opacity
    if (op !== undefined && op !== null) { window.huangquan.window.setOpacity(op); (window as any).huangquan.window.setOpacity(op) }
    // v0.2: 恢复动效
    const anim = (settings.general as any).animation
    document.documentElement.style.setProperty('--anim-duration', anim === false ? '0s' : '0.2s')
  }, [])

  const renderView = () => {
    switch (view) {
      case 'chat':     return <ChatView onNavigate={setView} />
      case 'settings': return <SettingsView />
      case 'agents':   return <AgentsView />
      case 'memory':   return <MemoryView />
      default:         return <ChatView onNavigate={setView} />
    }
  }

  return (
    <div className="app-shell">
      {/* 拖拽条 — 窗口拖动区域，pointer-events: none 防止遮挡下方按钮 */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 32, zIndex: 999,
        WebkitAppRegion: 'drag' as any, pointerEvents: 'none',
      }} />
      {/* 全局标题栏 — 窗口控件始终可见 */}
      <div style={{
        position: 'fixed', top: 0, right: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', height: 32, padding: '0 4px',
        WebkitAppRegion: 'no-drag' as any,
      }}>
        <button onClick={() => window.huangquan.window.minimize()}
          style={{ background: 'transparent', border: 'none', color: '#9999AA', fontSize: 16, cursor: 'pointer', padding: '4px 8px', borderRadius: 4, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget.style.background = '#1A1A2E')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>─</button>
        <button onClick={() => window.huangquan.window.maximize()}
          style={{ background: 'transparent', border: 'none', color: '#9999AA', fontSize: 16, cursor: 'pointer', padding: '4px 8px', borderRadius: 4, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget.style.background = '#1A1A2E')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>□</button>
        <button onClick={() => window.huangquan.window.close()}
          style={{ background: 'transparent', border: 'none', color: '#9999AA', fontSize: 16, cursor: 'pointer', padding: '4px 10px', borderRadius: 4, lineHeight: 1 }}
          onMouseEnter={e => { e.currentTarget.style.background = '#C23B22'; e.currentTarget.style.color = '#fff' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9999AA' }}>×</button>
      </div>

      <Sidebar currentView={view} onNavigate={setView} />
      <div className="chat-main" style={{ paddingTop: 0 }}>
        {renderView()}
      </div>
      {view === 'chat' && <RightPanel />}
    </div>
  )
}
