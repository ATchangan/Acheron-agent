import React, { useEffect, useState } from 'react'
import { useSettingsStore } from './store/settings'
import type { GeneralSettings } from './types'
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

// 主题解析 —— theme 优先(6 套预设), 旧 themePreset 自动迁移(PRESETS_THEME 内联机制已废弃), custom 回退 dark + 内联覆盖
const THEME_WHITELIST = ['dark', 'light', 'black', 'huangquan', 'bloodmoon', 'dawn']
const LEGACY_THEME: Record<string, string> = { 'system': 'dark', 'dark-tech': 'dark', 'light-warm': 'light', 'deep-black': 'black', 'forest': 'dark', 'high-contrast': 'black' }
function resolveTheme(g: GeneralSettings): string {
  const t = g.theme
  if (THEME_WHITELIST.includes(t)) return t
  const legacy = LEGACY_THEME[g.themePreset || '']
  if (legacy) return legacy
  return (g.customColors || g.customTheme) ? 'dark' : 'dark'
}

function applyAppearance(g: GeneralSettings) {
  const r = document.documentElement.style
  // 主题 = data-theme 6 套 CSS token 块(不再内联变量)
  document.documentElement.setAttribute('data-theme', resolveTheme(g))
  // Custom theme colors override (from settings)
  const customTheme = g.customColors || g.customTheme
  if (customTheme) {
    const ct = customTheme
    if (ct.bg) r.setProperty('--bg-root', ct.bg)
    if (ct.surface) r.setProperty('--bg-surface', ct.surface)
    if (ct.card) r.setProperty('--bg-card', ct.card)
    if (ct.accent) r.setProperty('--accent', ct.accent)
    if (ct.text) r.setProperty('--text-primary', ct.text)
    if (ct.border) r.setProperty('--border', ct.border)
  }
  // 皮肤与主题解耦 —— 皮肤只提供 --skin-accent/--skin-secondary/文字自适应, 不覆盖主题强调色
  if (g.bgImage && g.skinColors) {
    const sc = g.skinColors
    r.setProperty('--skin-accent', `${sc.r},${sc.g},${sc.b}`)
    if (g.skinSecondary) r.setProperty('--skin-secondary', g.skinSecondary)
    // 字体颜色按图片亮度自适应(亮图深字/暗图浅字) —— 防主题预设覆盖皮肤文字色
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
}

export default function App() {
  const [view, setView] = useState<View>('chat')

  // hash 路由 —— #browser = 独立无头浏览器窗口; #float = 悬浮窗; 其余 = 主窗口
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
    const cc = (settings.general).customColors
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
    const op = (settings.general).opacity
    if (op !== undefined && op !== null) {
      try { window.huangquan.window.setOpacity(op) } catch { /* 窗口透明度设置失败可忽略 */ }
    }
    // 恢复动效
    const anim = (settings.general).animation
    document.documentElement.style.setProperty('--anim-duration', anim === false ? '0s' : '0.2s')
    // 应用外观设置
    const g = settings.general
    applyAppearance(g)
  }, [])

  // 实时监听外观设置变更
  // 跟随系统 —— 系统深浅色切换时实时重应用(system 预设)
  useEffect(() => {
    const unsub = useSettingsStore.subscribe(s => {
      applyAppearance(s.general)
    })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onSysChange = () => {
      const g = useSettingsStore.getState().general
      if ((g.themePreset || '') === 'system') applyAppearance(g)
    }
    mq.addEventListener('change', onSysChange)
    return () => { unsub(); mq.removeEventListener('change', onSysChange) }
  }, [])

  const renderView = () => {
    switch (view) {
      case 'chat':     return <ChatView onNavigate={(v) => setView(v as View)} />
      case 'settings': return <SettingsView onNavigate={(v) => setView(v as View)} />
      case 'agents':   return <AgentsView />
      case 'memory':   return <MemoryView />
      case 'browser':  return <div style={{ padding: 40, color: 'var(--text-muted)', fontSize: 'var(--ui-font-size)' }}>无头浏览器已在独立窗口打开 ↗</div>
      default:         return <ChatView onNavigate={(v) => setView(v as View)} />
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
      {/* agent 使用浏览器时的主窗口内横幅提示 */}
      <FloatBadge />
    </div>
  )
}
