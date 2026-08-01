import React, { useEffect, useState } from 'react'
import { useSettingsStore } from './store/settings'
import { useChatStore } from './store/chat'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import RightPanel from './components/RightPanel'
import SettingsView from './components/SettingsView'
import AgentsView from './components/AgentsView'
import MemoryView from './components/MemoryView'

export type View = 'chat' | 'settings' | 'agents' | 'memory'

// 窗口控制按钮
const WinBtn: React.FC<{ onClick: () => void; danger?: boolean; children: React.ReactNode }> = ({ onClick, danger, children }) => (
  <button onClick={onClick} title={danger ? '关闭' : undefined}
    style={{
      width: 34, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 16,
      cursor: 'pointer', borderRadius: 0, padding: 0, lineHeight: 1, transition: 'all .12s',
    }}
    onMouseEnter={e => {
      e.currentTarget.style.background = danger ? '#E81123' : 'var(--bg-hover)'
      e.currentTarget.style.color = danger ? '#fff' : 'var(--text-primary)'
    }}
    onMouseLeave={e => {
      e.currentTarget.style.background = 'transparent'
      e.currentTarget.style.color = 'var(--text-secondary)'
    }}>
    {children}
  </button>
)

const PRESETS_THEME: Record<string, Record<string, string>> = {
  'dark-tech':  { '--bg-root':'#0D0D1A','--bg-surface':'#12122A','--bg-elevated':'#1A1A2E','--bg-card':'#1E1E38','--bg-hover':'#252545','--border':'#2A2A4A','--border-glow':'#3A3A5A','--accent':'#6B4C9A','--accent-dim':'#5A3D85','--accent-purple':'#8B6FC0','--accent-green':'#2D6A4F','--text-primary':'#E8E8F0','--text-secondary':'#9999AA','--text-muted':'#5A5A78' },
  'light-warm': { '--bg-root':'#F5F2EB','--bg-surface':'#FFF','--bg-elevated':'#FAF8F3','--bg-card':'#FFF','--bg-hover':'#F0EDE5','--border':'#E5E1D8','--border-glow':'#D5D0C5','--accent':'#2563EB','--accent-dim':'#1D4ED8','--accent-purple':'#7C3AED','--accent-green':'#059669','--text-primary':'#1A1A1A','--text-secondary':'#555','--text-muted':'#888' },
  'deep-black': { '--bg-root':'#000','--bg-surface':'#0A0A0A','--bg-elevated':'#111','--bg-card':'#151515','--bg-hover':'#1A1A1A','--border':'#252525','--border-glow':'#333','--accent':'#FFF','--accent-dim':'#CCC','--accent-purple':'#999','--accent-green':'#0F6','--text-primary':'#E0E0E0','--text-secondary':'#808080','--text-muted':'#505050' },
  'forest':     { '--bg-root':'#0D1A0D','--bg-surface':'#132213','--bg-elevated':'#1A2E1A','--bg-card':'#1E381E','--bg-hover':'#254525','--border':'#2A4A2A','--border-glow':'#3A5A3A','--accent':'#4A9A6B','--accent-dim':'#3D855A','--accent-purple':'#6FC08B','--accent-green':'#2D6A4F','--text-primary':'#D0E8D0','--text-secondary':'#99AA99','--text-muted':'#5A785A' },
  'high-contrast': { '--bg-root':'#000','--bg-surface':'#000','--bg-elevated':'#0A0A0A','--bg-card':'#111','--bg-hover':'#1A1A1A','--border':'#444','--border-glow':'#666','--accent':'#FFF','--accent-dim':'#FFF','--accent-purple':'#FFF','--accent-green':'#0F0','--text-primary':'#FFF','--text-secondary':'#CCC','--text-muted':'#999' },
}

function applyAppearance(g: any) {
  const r = document.documentElement.style
  // Theme preset: set ALL CSS variables to match the preset
  if (g.themePreset && PRESETS_THEME[g.themePreset]) {
    const t = PRESETS_THEME[g.themePreset]
    for (const [k,v] of Object.entries(t)) r.setProperty(k, v)
    document.documentElement.setAttribute('data-theme', g.themePreset)
  }
  // Custom theme colors override (from settings)
  if (g.customTheme) {
    const ct = g.customTheme
    if (ct.bg) r.setProperty('--bg-root', ct.bg)
    if (ct.surface) r.setProperty('--bg-surface', ct.surface)
    if (ct.accent) r.setProperty('--accent', ct.accent)
  }
  // Typography: override CSS variables
  if (g.uiFontSize) r.setProperty('--ui-font-size', g.uiFontSize + 'px')
  if (g.codeFontSize) r.setProperty('--code-font-size', g.codeFontSize + 'px')
  // Message spacing
  if (g.messageSpacing) {
    const gap: Record<string,string> = { compact:'4px', comfortable:'12px', loose:'24px' }
    r.setProperty('--msg-gap', gap[g.messageSpacing] || '12px')
  }
  // Chat max width
  if (g.chatMaxWidth) r.setProperty('--chat-max-width', g.chatMaxWidth + 'px')
  // Apply data-theme attribute for preset (CSS uses [data-theme="xxx"] selectors)
  document.documentElement.setAttribute('data-theme', g.themePreset || 'dark-tech')
}

export default function App() {
  const [view, setView] = useState<View>('chat')

  useEffect(() => {
    useSettingsStore.getState().load()
    useChatStore.getState().load()
    const settings = useSettingsStore.getState()
    const theme = settings.general.theme || 'huangquan'
    document.documentElement.setAttribute('data-theme', theme)
    // 恢复自定义主题
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
    // 恢复透明度
    const op = (settings.general as any).opacity
    if (op !== undefined && op !== null) {
      try { window.huangquan.window.setOpacity(op) } catch {}
    }
    // 恢复动效
    const anim = (settings.general as any).animation
    document.documentElement.style.setProperty('--anim-duration', anim === false ? '0s' : '0.2s')
    // v0.2.1: 应用外观设置
    const g = settings.general as any
    applyAppearance(g)
  }, [])

  // v0.2.1: 实时监听外观设置变更
  useEffect(() => {
    const unsub = useSettingsStore.subscribe(s => {
      applyAppearance(s.general as any)
    })
    return unsub
  }, [])

  const renderView = () => {
    switch (view) {
      case 'chat':     return <ChatView onNavigate={setView} />
      case 'settings': return <SettingsView onNavigate={setView} />
      case 'agents':   return <AgentsView />
      case 'memory':   return <MemoryView />
      default:         return <ChatView onNavigate={setView} />
    }
  }

  return (
    <div className="app-shell">
      {/* 拖拽条 — 窗口拖动区域 */}
      <div style={{
        position: 'fixed' as const, top: 0, left: 0, right: 0, height: 32, zIndex: 999,
        WebkitAppRegion: 'drag', pointerEvents: 'none',
      } as React.CSSProperties} />

      {/* 全局标题栏 — 窗口控件 */}
      <div style={{
        position: 'fixed' as const, top: 0, right: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', height: 32,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}>
        <WinBtn onClick={() => window.huangquan.window.minimize()}>─</WinBtn>
        <WinBtn onClick={() => window.huangquan.window.maximize()}>□</WinBtn>
        <WinBtn onClick={() => window.huangquan.window.close()} danger>×</WinBtn>
      </div>

      <Sidebar currentView={view} onNavigate={setView} />
      <div className="chat-main" style={{ paddingTop: 0 }}>
        {renderView()}
      </div>
      {view === 'chat' && <RightPanel />}
    </div>
  )
}
