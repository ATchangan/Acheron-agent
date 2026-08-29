import React, { useEffect, useState } from 'react'
import { useSettingsStore, THEME_WHITELIST } from './store/settings'
import type { GeneralSettings } from './types'
import { useChatStore } from './store/chat'
import { initCronClient } from './store/cron-client'
import { initMsgClient } from './store/msg-client'
import { CUSTOM_CSS_MAX } from './store/display'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import FloatBadge from './components/FloatBadge'
import StatusBar from './components/StatusBar'
import RiskConfirmCard from './components/RiskConfirmCard'
import TitleBar from './components/TitleBar'
import RightRail from './components/RightRail'
import CommandPalette from './components/CommandPalette'
import OverlayView from './components/OverlayView'
import FirstRunOverlay from './components/FirstRunOverlay'
import HudView from './components/HudView'
import { ErrorBoundary } from './components/ErrorBoundary'
import { matchCombo, loadKeybinds } from './store/keybinds'

// v0.4.3: 重页面懒加载(进到对应视图才拉取), 缩小首屏 bundle
// v0.4.4 精简: 仅保留 会话/设置/浏览器 三个视图, 技能/记忆/编队/定时等已收敛
const SettingsView = React.lazy(() => import('./components/SettingsView'))
const BrowserView = React.lazy(() => import('./components/BrowserView'))
const CronPage = React.lazy(() => import('./components/CronPage'))
const ArtifactPage = React.lazy(() => import('./components/ArtifactPage'))
const CapabilityPage = React.lazy(() => import('./components/CapabilityPage'))
const TasksPage = React.lazy(() => import('./components/TasksPage'))
const PluginsView = React.lazy(() => import('./components/PluginsView'))
const MessagesPage = React.lazy(() => import('./components/MessagesPage'))
const LazyFallback = () => <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 1px)' }}>加载中…</div>

export type View = 'chat' | 'settings' | 'browser' | 'files' | 'cron' | 'artifact' | 'capability' | 'tasks' | 'plugins' | 'messages'

// 聊天区局部崩溃降级: 外壳(标题栏/侧栏)保持可用, 只替换聊天内容区
const chatFallback = (_err: Error) => (
  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
    <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>聊天区渲染异常</div>
    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>其余界面不受影响，可重新加载恢复</div>
    <button className="hq-btn" onClick={() => location.reload()}>重新加载</button>
  </div>
)

// 主题解析 —— theme 优先(多套预设), 旧 themePreset 自动迁移, custom 回退 dark + 内联覆盖
// THEME_WHITELIST 唯一来源: src/store/settings.ts(App 与 store 共用, 防两份清单漂移)
const LEGACY_THEME: Record<string, string> = { 'system': 'auto', 'dark-tech': 'black', 'light-warm': 'light', 'deep-black': 'black', 'forest': 'black', 'high-contrast': 'black', 'huangquan': 'huangquan' }
function resolveTheme(g: GeneralSettings): string {
  const t = g.theme
  // v0.4.2: 跟随系统 —— 深浅色实时跟随系统外观
  // v0.5.0: 深色默认解析为 archeron(改版后的默认观感), 浅色仍为 light
  if (t === 'auto' || !t) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'archeron' : 'light'
  }
  if (t === 'dark') return 'archeron'
  if (THEME_WHITELIST.includes(t)) return t
  const legacy = LEGACY_THEME[g.theme] || LEGACY_THEME[g.themePreset || '']
  if (legacy) return legacy
  return (g.customColors || g.customTheme) ? 'dark' : 'auto'
}

function applyAppearance(g: GeneralSettings) {
  const r = document.documentElement.style
  // 先清掉可能残留的内联变量(自定义配色/皮肤写入), 否则会盖住预设主题, 导致切主题"没反应"
  const staleVars = ['--text-primary', '--text-secondary', '--text-muted', '--border', '--bg-elevated',
    '--bg-card', '--bg-input', '--bg-root', '--bg-surface', '--skin-overlay', '--skin-accent', '--skin-secondary', '--accent',
    '--chat-font-size', '--code-font-size']
  for (const v of staleVars) r.removeProperty(v)
  // 主题 = data-theme token 块(不再内联变量)
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
  // 会话区宽度: 默认 748px(--dsh-chat-content-width), 可在 设置→外观 自定义; 消息区与输入框共用同一 CSS 变量
  const chatWidth = g.chatMaxWidth || 748
  r.setProperty('--chat-max-width', chatWidth + 'px')
  r.setProperty('--hq-composer-width', chatWidth + 'px')
  // 界面自定义: 信息密度(消息间距唯一来源) + 自定义 CSS(任意显示细节可覆写)
  // v0.4.4 默认紧凑: 未显式设置时用 compact(收紧消息间距)
  const uiDensity = g.uiDisplay?.density === 'compact' || g.uiDisplay?.density === 'spacious' ? g.uiDisplay.density : 'compact'
  document.documentElement.setAttribute('data-density', uiDensity)
  const DENSITY_GAP: Record<string, string> = { compact: '4px', comfortable: '12px', spacious: '24px' }
  r.setProperty('--msg-gap', DENSITY_GAP[uiDensity] || '4px')
  let cssEl = document.getElementById('hq-custom-css') as HTMLStyleElement | null
  if (!cssEl) {
    cssEl = document.createElement('style')
    cssEl.id = 'hq-custom-css'
    document.head.appendChild(cssEl)
  }
  cssEl.textContent = (g.uiDisplay?.customCss || '').slice(0, CUSTOM_CSS_MAX)
  // 系统窗口按钮(最小化/最大化/关闭)配色严格跟随主题: 背景 = 标题栏背景(--bg-surface),
  // 图标色按背景亮度自动选择 —— 消除右上角窗口按钮区与标题栏的色差接缝
  const parseRgb = (c: string): [number, number, number] | null => {
    const hex = c.trim().match(/^#([0-9a-f]{6})$/i)
    if (hex) { const n = parseInt(hex[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
    const rgb = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
  }
  const applyOverlay = () => {
    try {
      // 优先取主题 token --bg-surface(标题栏背景); 自定义配色/皮肤内联覆盖后同样生效
      let color = getComputedStyle(document.documentElement).getPropertyValue('--bg-surface').trim()
      let symbolColor = '#c8c8cc'
      const rgb = parseRgb(color)
      if (!rgb) {
        const bg = getComputedStyle(document.body).backgroundColor
        const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
        if (m) {
          const [rr, gg, bb] = [Number(m[1]), Number(m[2]), Number(m[3])]
          color = `rgb(${rr}, ${gg}, ${bb})`
          symbolColor = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255 > 0.55 ? '#1a1a1f' : '#c8c8cc'
        }
      } else {
        const [rr, gg, bb] = rgb
        symbolColor = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255 > 0.55 ? '#1a1a1f' : '#c8c8cc'
      }
      if (color) window.huangquan.window.setTitleBarOverlay?.({ color, symbolColor, height: 32 })
    } catch { /* 忽略: 非 Electron/早期调用 */ }
  }
  applyOverlay()
  // 解析后主题色同步:
  // color-scheme 与 <meta name=theme-color> 跟随渲染结果, 浏览器/系统界面与应用一致
  const resolvedTheme = resolveTheme(g)
  document.documentElement.style.colorScheme = (resolvedTheme === 'light' || resolvedTheme === 'dawn') ? 'light' : 'dark'
  let metaTheme = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
  if (!metaTheme) {
    metaTheme = document.createElement('meta')
    metaTheme.name = 'theme-color'
    document.head.appendChild(metaTheme)
  }
  const bodyBg = getComputedStyle(document.body).backgroundColor
  if (bodyBg) metaTheme.content = bodyBg
  // 首次进入时主题 CSS 可能尚未完全落地, 延迟再同步一次
  setTimeout(applyOverlay, 150)
}

export default function App() {
  const [view, setView] = useState<View>('chat')
  // v0.4.2 外壳状态：侧栏/右栏开关、面板翻转、命令面板、状态栏显隐
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightRailOpen, setRightRailOpen] = useState(false)
  const [panesFlipped, setPanesFlipped] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [statusHidden, setStatusHidden] = useState(false)
  const [settingsTab, setSettingsTab] = useState<string | null>(null)
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('hq_onboarded_v1') === '1')

  const openSettings = (tab?: string) => {
    if (tab) setSettingsTab(tab)
    setView('settings')
  }

  // v0.4.4: 模型菜单「编辑模型…」→ 打开设置·提供方
  useEffect(() => {
    const f = (e: Event) => { const t = (e as CustomEvent).detail; openSettings(typeof t === 'string' ? t : undefined) }
    window.addEventListener('hq-open-settings', f)
    return () => window.removeEventListener('hq-open-settings', f)
  }, [])



  const navigate = (v: View) => {
    // 文件 → 打开右栏文件面板；其余视图照常切换
    if (v === 'files') { setRightRailOpen(true); setView('chat'); return }
    setView(v)
  }

  // Ctrl+K 命令面板 / Ctrl+N 新对话
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const kb = loadKeybinds()
      if (matchCombo(e, kb['command-palette'])) {
        e.preventDefault()
        setPaletteOpen(v => !v)
      } else if (matchCombo(e, kb['new-chat'])) {
        e.preventDefault()
        useChatStore.getState().create()
      } else if (matchCombo(e, kb['toggle-sidebar'])) {
        e.preventDefault()
        setSidebarOpen(v => !v)
      } else if (matchCombo(e, kb['toggle-right-rail'])) {
        e.preventDefault()
        setRightRailOpen(v => !v)
      } else if (matchCombo(e, kb['settings'])) {
        e.preventDefault()
        setView('settings')
      }
    }
    document.addEventListener('keydown', onKey)
    // v0.5.0: 侧栏底部「更多」图标 → 打开命令面板
    const onPalette = () => setPaletteOpen(true)
    window.addEventListener('hq-open-palette', onPalette)
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('hq-open-palette', onPalette) }
  }, [])

  // hash 路由 —— #browser = 独立无头浏览器窗口; 其余 = 主窗口
  // v0.4.3 系统级"随叫随到"/选中即问: 全局热键把剪贴板选中带进聊天草稿
  useEffect(() => {
    try {
      const off = window.huangquan.hotkey.onAsk(text => {
        if (!text) return
        useChatStore.getState().setAskDraft(text)
      })
      return off
    } catch { /* 非 Electron / 未暴露时忽略 */ }
  }, [])

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

  // v0.4.5 修复: 这三个 hook 必须在条件 return 之前声明 —— routeHash 运行期变化时
  // hook 数量改变会让 React 抛 "Rendered more hooks than during the previous render" 崩掉整窗
  useEffect(() => {
    useSettingsStore.getState().load()
    useChatStore.getState().load()
    initCronClient()
    initMsgClient() // v0.4.4 消息平台: QQ 官方机器人来信桥接
    const settings = useSettingsStore.getState()
    const theme = resolveTheme(settings.general)
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
      if (g.theme === 'auto') applyAppearance(g)
    }
    mq.addEventListener('change', onSysChange)
    return () => { unsub(); mq.removeEventListener('change', onSysChange) }
  }, [])

  // 聊天修改设置(set_settings 工具)后, 主进程推送变更信号 → 渲染层重载设置并即时应用
  useEffect(() => {
    try {
      const off = window.huangquan?.settings?.onChanged?.(() => { useSettingsStore.getState().load().catch(() => {}) })
      return () => { try { off?.() } catch { /* 忽略 */ } }
    } catch { return undefined }
  }, [])

  if (routeHash === '#hud') return <HudView />
  if (routeHash === '#browser') return <React.Suspense fallback={<LazyFallback />}><BrowserView /></React.Suspense>

  return (
    <>
      <div className="hq-app-root">
      <TitleBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(v => !v)}
        rightRailOpen={rightRailOpen}
        onToggleRightRail={() => setRightRailOpen(v => !v)}
        panesFlipped={panesFlipped}
        onFlipPanes={() => setPanesFlipped(v => !v)}
        onOpenSettings={() => openSettings()}
        statusHidden={statusHidden}
        onToggleStatusHidden={() => setStatusHidden(v => !v)}
      />
      <div className={'app-shell' + (panesFlipped ? ' hq-panes-flipped' : '') + (sidebarOpen ? '' : ' hq-sidebar-collapsed')}>
        {sidebarOpen && <Sidebar currentView={view} onNavigate={navigate} />}
        <div className="chat-main" style={{ paddingTop: 0 }}>
          {view === 'browser' ? <React.Suspense fallback={<LazyFallback />}><BrowserView embedded /></React.Suspense>
            : (
              <ErrorBoundary fallback={chatFallback}>
                <ChatView onNavigate={(v) => navigate(v as View)} />
              </ErrorBoundary>
            )}
        </div>
        {rightRailOpen && <RightRail />}
      </div>
      <StatusBar hidden={statusHidden} onToggleHidden={() => setStatusHidden(v => !v)} />
      {/* v0.4.2 路由浮层：设置 覆盖在聊天之上 */}
      <React.Suspense fallback={<LazyFallback />}>
      {view === 'settings' && (
        <OverlayView title="设置" onClose={() => setView('chat')} full>
          <SettingsView onNavigate={(v) => navigate(v as View)} initialTab={settingsTab || undefined} />
        </OverlayView>
      )}
      {/* v0.5.0 侧栏功能页：定时任务 / 产物 / 技能与工具（同为浮层路由） */}
      {view === 'cron' && <OverlayView title="定时任务" onClose={() => setView('chat')}><CronPage /></OverlayView>}
      {view === 'artifact' && <OverlayView title="产物" onClose={() => setView('chat')}><ArtifactPage /></OverlayView>}
      {view === 'capability' && <OverlayView title="技能与工具" onClose={() => setView('chat')}><CapabilityPage onOpenSettings={openSettings} /></OverlayView>}
      {/* v0.6.0 任务列表 / 插件市场 */}
      {view === 'tasks' && (
        <OverlayView title="任务" onClose={() => setView('chat')}>
          <TasksPage onOpenSession={(sid) => { void useChatStore.getState().switchS(sid); setView('chat') }} />
        </OverlayView>
      )}
      {view === 'plugins' && <OverlayView title="插件市场" onClose={() => setView('chat')} width={860}><PluginsView /></OverlayView>}
      {view === 'messages' && <OverlayView title="消息平台" onClose={() => setView('chat')} width={860}><MessagesPage /></OverlayView>}
      </React.Suspense>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(v) => navigate(v as View)}
        onOpenSettingsTab={openSettings}
        onNewChat={() => useChatStore.getState().create()}
        onToggleSidebar={() => setSidebarOpen(v => !v)}
        onToggleRightRail={() => setRightRailOpen(v => !v)}
        onToggleStatusbar={() => setStatusHidden(v => !v)}
      />
      {!onboarded && view === 'chat' && (
        <FirstRunOverlay
          onDone={() => { localStorage.setItem('hq_onboarded_v1', '1'); setOnboarded(true) }}
          onOpenSettings={openSettings}
        />
      )}
      </div>
      {/* v0.3.6: 右上角按钮组 —— 固定在窗口控制按钮(最小化/最大化/关闭)正下方 */}
      {/* 固定定位浮层(风险确认)渲染在 flex 容器之外, 避免参与布局挤窄聊天区 */}
      <FloatBadge />
      <RiskConfirmCard />
      {/* 角色角标: 右下角小黄泉(纯装饰, 不拦截点击), 低透明度避免喧宾夺主; 可点 设置→界面→自定义 CSS 隐藏 */}
      <img src="huangquan.png" alt="" aria-hidden style={{ position: 'fixed', right: 16, bottom: 46, width: 54, height: 54, objectFit: 'contain', opacity: .45, pointerEvents: 'none', zIndex: 60, filter: 'drop-shadow(0 6px 16px rgba(0,0,0,.4))' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
    </>
  )
}
