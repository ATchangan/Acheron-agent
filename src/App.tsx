import React, { useEffect, useState } from 'react'
import { useSettingsStore } from './store/settings'
import type { GeneralSettings } from './types'
import { useChatStore } from './store/chat'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import FilesView from './components/FilesView'
import SettingsView from './components/SettingsView'
import AgentsView from './components/AgentsView'
import MemoryView from './components/MemoryView'
import BrowserView from './components/BrowserView'
import FloatBadge from './components/FloatBadge'
import RiskConfirmCard from './components/RiskConfirmCard'

export type View = 'chat' | 'settings' | 'agents' | 'memory' | 'browser' | 'files'

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
  // 先清掉可能残留的内联变量(自定义配色/皮肤写入), 否则会盖住预设主题, 导致切主题"没反应"
  const staleVars = ['--text-primary', '--text-secondary', '--text-muted', '--border', '--bg-elevated',
    '--bg-card', '--bg-input', '--bg-root', '--bg-surface', '--skin-overlay', '--skin-accent', '--skin-secondary', '--accent',
    '--chat-font-size', '--code-font-size']
  for (const v of staleVars) r.removeProperty(v)
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
  // 会话字号: 控制交互会话(聊天区正文/输入框/消息内代码/工具输出), 默认跟随界面字号
  const chatFs = g.codeFontSize ? Number(g.codeFontSize) : 0
  r.setProperty('--chat-font-size', chatFs > 0 ? chatFs + 'px' : 'var(--ui-font-size)')
  r.setProperty('--code-font-size', chatFs > 0 ? Math.max(11, chatFs - 1) + 'px' : 'calc(var(--ui-font-size) - 1px)')
  // Message spacing
  if (g.messageSpacing) {
    const gap: Record<string,string> = { compact:'4px', comfortable:'12px', loose:'24px' }
    r.setProperty('--msg-gap', gap[g.messageSpacing] || '12px')
  }
  // 会话区宽度: 默认 780px, 可在 设置→外观 自定义; 消息区与输入框共用同一 CSS 变量
  const chatWidth = g.chatMaxWidth || 780
  r.setProperty('--chat-max-width', chatWidth + 'px')
  r.setProperty('--hq-composer-width', chatWidth + 'px')
  // 系统窗口按钮(最小化/最大化/关闭)配色跟随主题: 预置主题直接映射根背景色, 自定义配色按亮度选图标色
  const OVERLAY_BY_THEME: Record<string, { color: string; symbolColor: string }> = {
    dark: { color: '#15171c', symbolColor: '#c8c8cc' },
    light: { color: '#f4f2ec', symbolColor: '#1a1a1f' },
    black: { color: '#0e0e0e', symbolColor: '#d0d0d8' },
    huangquan: { color: '#121014', symbolColor: '#e9d5ff' },
    bloodmoon: { color: '#171013', symbolColor: '#fecaca' },
    dawn: { color: '#f6f1e8', symbolColor: '#2b2b2b' },
  }
  const applyOverlay = () => {
    try {
      const theme = resolveTheme(g)
      const custom = g.customColors || g.customTheme
      let color: string | undefined
      let symbolColor = '#c8c8cc'
      if (!custom) {
        color = OVERLAY_BY_THEME[theme]?.color
        symbolColor = OVERLAY_BY_THEME[theme]?.symbolColor || symbolColor
      }
      if (!color) {
        const bg = getComputedStyle(document.body).backgroundColor
        const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
        if (m) {
          const [rr, gg, bb] = [Number(m[1]), Number(m[2]), Number(m[3])]
          color = `rgb(${rr}, ${gg}, ${bb})`
          symbolColor = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255 > 0.55 ? '#1a1a1f' : '#c8c8cc'
        }
      }
      if (color) window.huangquan.window.setTitleBarOverlay?.({ color, symbolColor, height: 32 })
    } catch { /* 忽略: 非 Electron/早期调用 */ }
  }
  applyOverlay()
  // 首次进入时主题 CSS 可能尚未完全落地, 延迟再同步一次
  setTimeout(applyOverlay, 150)
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
  // v0.3.4: 主进程请求切换到内嵌浏览器面板(点击悬浮横幅/工具调用时)
  useEffect(() => {
    const off = window.huangquan?.web?.onEmbed?.((d) => { if (d?.show) setView('browser') })
    return () => { try { off?.() } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } }
  }, [])
  // v0.3.6 修复: 聊天 Markdown 里的外链(如模型回复的 GitHub 地址)点击后
  // 不再让应用窗口跳走, 统一交给系统默认浏览器打开
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      const a = el && el.closest ? el.closest('a[href]') as HTMLAnchorElement | null : null
      if (!a) return
      const href = a.getAttribute('href') || ''
      if (/^https?:/i.test(href)) {
        e.preventDefault()
        e.stopPropagation()
        void window.huangquan.web.openExternal(href).catch(() => {})
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
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
      case 'files':    return <FilesView />
      case 'browser':  return <BrowserView embedded />
      default:         return <ChatView onNavigate={(v) => setView(v as View)} />
    }
  }

  return (
    <>
      <div className="app-shell">
        {/* 拖拽条 — 窗口拖动区域 */}
        <div style={{
          // v0.3.3: 右侧让出窗口按钮区(150px), 避免 OS 拖拽区域干扰最小化/最大化/关闭点击
          position: 'fixed' as const, top: 0, left: 0, right: 150, height: 32, zIndex: 999,
          WebkitAppRegion: 'drag', pointerEvents: 'none',
        } as React.CSSProperties} />

        <Sidebar currentView={view} onNavigate={setView} />
        <div className="chat-main" style={{ paddingTop: 0 }}>
          {renderView()}
        </div>
      </div>
      {/* v0.3.6: 右上角按钮组 —— 固定在窗口控制按钮(最小化/最大化/关闭)正下方 */}
      {/* 固定定位浮层(风险确认/浏览器横幅)渲染在 flex 容器之外, 避免参与布局挤窄聊天区 */}
      <FloatBadge />
      <RiskConfirmCard />
    </>
  )
}
