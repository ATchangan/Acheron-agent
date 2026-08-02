import React, { useEffect, useState } from 'react'
import { useSettingsStore } from './store/settings'
import { useChatStore } from './store/chat'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import RightPanel from './components/RightPanel'
import SettingsView from './components/SettingsView'
import AgentsView from './components/AgentsView'
import MemoryView from './components/MemoryView'
import BrowserView from './components/BrowserView'
import FloatBadge from './components/FloatBadge'

export type View = 'chat' | 'settings' | 'agents' | 'memory' | 'browser'

// 窗口控制按钮
const WinBtn: React.FC<{ onClick: () => void; danger?: boolean; children: React.ReactNode }> = ({ onClick, danger, children }) => (
  <button onClick={onClick} title={danger ? '关闭' : undefined}
    style={{
      width: 34, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 'calc(var(--ui-font-size) + 3px)',
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
  'dark-tech':  { '--bg-root':'#15171c','--bg-surface':'#1b1d23','--bg-elevated':'#212329','--bg-card':'#24262d','--bg-hover':'#2c2e36','--border':'#363840','--border-glow':'#454852','--accent':'#5e7c96','--accent-dim':'#4e6a82','--accent-purple':'#7e93a8','--accent-green':'#5f8f74','--text-primary':'#e0e2e8','--text-secondary':'#999ba6','--text-muted':'#60636e','--skin-accent':'94,124,150' },
  'light-warm': { '--bg-root':'#f4f2ec','--bg-surface':'#fbfaf6','--bg-elevated':'#f7f5ef','--bg-card':'#fbfaf6','--bg-hover':'#edebe3','--border':'#e2dfd5','--border-glow':'#d2cfc4','--accent':'#7a6a55','--accent-dim':'#665845','--accent-purple':'#94846c','--accent-green':'#5f7d62','--text-primary':'#2a2a28','--text-secondary':'#6e6e68','--text-muted':'#9a9a92','--skin-accent':'122,106,85' },
  'deep-black': { '--bg-root':'#0e0e0e','--bg-surface':'#131313','--bg-elevated':'#181818','--bg-card':'#1c1c1c','--bg-hover':'#242424','--border':'#2e2e2e','--border-glow':'#404040','--accent':'#8a8f98','--accent-dim':'#767b84','--accent-purple':'#a0a5ad','--accent-green':'#6f8f74','--text-primary':'#e4e4e4','--text-secondary':'#989898','--text-muted':'#606060','--skin-accent':'138,143,152' },
  'forest':     { '--bg-root':'#141815','--bg-surface':'#191e1a','--bg-elevated':'#1e241f','--bg-card':'#212823','--bg-hover':'#29312b','--border':'#333b35','--border-glow':'#434d45','--accent':'#647d68','--accent-dim':'#546b58','--accent-purple':'#85987f','--accent-green':'#5f8f74','--text-primary':'#dee2de','--text-secondary':'#969c96','--text-muted':'#5e655f','--skin-accent':'100,125,104' },
  'high-contrast': { '--bg-root':'#000','--bg-surface':'#000','--bg-elevated':'#0a0a0a','--bg-card':'#111','--bg-hover':'#1a1a1a','--border':'#444','--border-glow':'#666','--accent':'#FFF','--accent-dim':'#FFF','--accent-purple':'#FFF','--accent-green':'#0F0','--text-primary':'#FFF','--text-secondary':'#CCC','--text-muted':'#999','--skin-accent':'255,255,255' },
}

// v0.2.3: 跟随系统主题 —— 'system' 按系统深浅色解析为暗色/浅色预设
function resolveThemePreset(preset: string | undefined): string {
  if (preset && preset !== 'system') return preset
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-tech' : 'light-warm' } catch { return 'dark-tech' }
}

function applyAppearance(g: any) {
  const r = document.documentElement.style
  // Theme preset: set ALL CSS variables to match the preset
  const preset = resolveThemePreset(g.themePreset)
  if (preset && PRESETS_THEME[preset]) {
    const t = PRESETS_THEME[preset]
    for (const [k,v] of Object.entries(t)) r.setProperty(k, v)
    document.documentElement.setAttribute('data-theme', preset)
  }
  // Custom theme colors override (from settings)
  const customTheme = g.customColors || g.customTheme
  if (customTheme) {
    const ct = customTheme
    if (ct.bg) r.setProperty('--bg-root', ct.bg)
    if (ct.surface) r.setProperty('--bg-surface', ct.surface)
    if (ct.accent) r.setProperty('--accent', ct.accent)
  }
  // v0.2.2-fix: 背景图主色调统一应用（与 settings.load 恢复逻辑一致，避免切换预设后 accent 残留漂移）
  if (g.bgImage && g.skinColors) {
    const sc = g.skinColors
    const adj = (f: number) => { const lr = Math.min(255, Math.max(0, Math.round(sc.r * f))); const lg = Math.min(255, Math.max(0, Math.round(sc.g * f))); const lb = Math.min(255, Math.max(0, Math.round(sc.b * f))); return `rgb(${lr},${lg},${lb})` }
    r.setProperty('--skin-accent', `${sc.r},${sc.g},${sc.b}`)
    r.setProperty('--accent', adj(1))
    r.setProperty('--accent-dim', adj(0.8))
    r.setProperty('--border-glow', adj(0.4))
    // v0.2.3-fix: 字体颜色按图片亮度自适应(亮图深字/暗图浅字) —— 防主题预设覆盖皮肤文字色
    const luma = (0.299 * sc.r + 0.587 * sc.g + 0.114 * sc.b) / 255
    if (luma > 0.55) {
      r.setProperty('--text-primary', '#1c1d21')
      r.setProperty('--text-secondary', 'rgba(20,21,25,0.78)')
      r.setProperty('--text-muted', 'rgba(20,21,25,0.58)')
      r.setProperty('--border', 'rgba(0,0,0,0.16)')
      r.setProperty('--bg-elevated', 'rgba(255,255,255,0.78)')
      r.setProperty('--bg-card', 'rgba(250,250,252,0.92)')
      r.setProperty('--bg-input', 'rgba(240,241,244,0.92)')
      r.setProperty('--bg-root', 'rgba(248,248,250,0.5)')
      r.setProperty('--bg-surface', 'rgba(244,245,248,0.85)')
      r.setProperty('--skin-overlay', 'rgba(255,255,255,0.40)')
    } else {
      r.setProperty('--text-primary', '#e9e9eb')
      r.setProperty('--text-secondary', 'rgba(255,255,255,0.86)')
      r.setProperty('--text-muted', 'rgba(255,255,255,0.66)')
      r.setProperty('--border', 'rgba(255,255,255,0.16)')
      r.setProperty('--bg-elevated', 'rgba(255,255,255,0.10)')
      r.setProperty('--bg-card', 'rgba(23,24,28,0.92)')
      r.setProperty('--bg-input', 'rgba(20,21,25,0.92)')
      r.setProperty('--skin-overlay', 'rgba(8,8,15,0.50)')
    }
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
  document.documentElement.setAttribute('data-theme', resolveThemePreset(g.themePreset) || 'dark-tech')
}

export default function App() {
  const [view, setView] = useState<View>('chat')

  // v0.2.3: hash 路由 —— #browser = 独立无头浏览器窗口; #float = 悬浮窗; 其余 = 主窗口
  const [routeHash, setRouteHash] = useState<string>(window.location.hash || '')
  useEffect(() => {
    const onHash = () => setRouteHash(window.location.hash || '')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  if (routeHash === '#browser') return <BrowserView />

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
  // v0.2.3: 跟随系统 —— 系统深浅色切换时实时重应用(system 预设)
  useEffect(() => {
    const unsub = useSettingsStore.subscribe(s => {
      applyAppearance(s.general as any)
    })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onSysChange = () => {
      const g = useSettingsStore.getState().general as any
      if ((g.themePreset || '') === 'system') applyAppearance(g)
    }
    mq.addEventListener('change', onSysChange)
    return () => { unsub(); mq.removeEventListener('change', onSysChange) }
  }, [])

  const renderView = () => {
    switch (view) {
      case 'chat':     return <ChatView onNavigate={setView} />
      case 'settings': return <SettingsView onNavigate={setView} />
      case 'agents':   return <AgentsView />
      case 'memory':   return <MemoryView />
      case 'browser':  return <div style={{ padding: 40, color: 'var(--text-muted)', fontSize: 'var(--ui-font-size)' }}>无头浏览器已在独立窗口打开 ↗</div>
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
      {/* v0.2.4: agent 使用浏览器时的主窗口内横幅提示 */}
      <FloatBadge />
    </div>
  )
}
