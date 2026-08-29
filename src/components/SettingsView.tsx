import React, { useState } from 'react'
import { useSettingsStore } from '../store/settings'
import { C } from './settings-ui'

import { Key, Cpu, MessageSquare, Palette, MonitorSmartphone, Shield, Globe, Brain, SlidersHorizontal, Bell, CreditCard, Network, Keyboard, Wrench, Puzzle, Archive, Info, Download, Upload, RotateCcw, Search } from 'lucide-react'
import { PERM_ICONS, PERM_LABELS, type FilePerm } from './chat-input-constants'
import { BrowserSettings, NotificationsSettings, BillingSettings, GatewaySettings } from './settings/RealPages'
const MemoryContextSettings = React.lazy(() => import('./settings/MemoryContextSettings'))
// v0.3.6 P3-10: 设置各 tab 懒加载, 首屏只加载默认 tab, 减少启动与首屏 bundle
// v0.4.4: 导航与结构对齐参考 —— 18 项平铺导航 + 全屏弹窗 + 顶部居中搜索
const ModelSettings = React.lazy(() => import('./settings/ModelSettings'))
const WorkspaceSettings = React.lazy(() => import('./settings/WorkspaceSettings'))
const ArchivedSessions = React.lazy(() => import('./settings/ArchivedSessions'))
const AboutTab = React.lazy(() => import('./settings/AboutTab'))
const ModelsTab = React.lazy(() => import('./settings/ModelsTab'))
const SkinTab = React.lazy(() => import('./settings/SkinTab'))
const UiTab = React.lazy(() => import('./settings/UiTab'))
const KeybindsTab = React.lazy(() => import('./settings/KeybindsTab'))
const McpTab = React.lazy(() => import('./settings/McpTab'))
const PersonaTab = React.lazy(() => import('./settings/PersonaTab'))
const ToolsTab = React.lazy(() => import('./settings/ToolsTab'))
const AdvancedTab = React.lazy(() => import('./settings/AdvancedTab'))
const PluginsView = React.lazy(() => import('./PluginsView'))

export default function SettingsView({ onNavigate, initialTab }: { onNavigate: (v: string) => void; initialTab?: string }) {
  useSettingsStore()
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // v0.4.4 对齐参考: 18 项平铺导航（顺序一致）
  const TABS = [
    { key: 'model', label: '模型', icon: <Cpu size={15} /> },
    { key: 'chat', label: '对话', icon: <MessageSquare size={15} /> },
    { key: 'appearance', label: '外观', icon: <Palette size={15} /> },
    { key: 'workspace', label: '工作区', icon: <MonitorSmartphone size={15} /> },
    { key: 'security', label: '安全', icon: <Shield size={15} /> },
    { key: 'browser', label: 'Browser', icon: <Globe size={15} /> },
    { key: 'memory', label: '记忆与上下文', icon: <Brain size={15} /> },
    { key: 'advanced', label: '高级', icon: <SlidersHorizontal size={15} /> },
    { key: 'notifications', label: '通知', icon: <Bell size={15} /> },
    { key: 'billing', label: '账单', icon: <CreditCard size={15} /> },
    { key: 'providers', label: '提供方', icon: <Key size={15} /> },
    { key: 'gateway', label: '网关', icon: <Network size={15} /> },
    { key: 'keybinds', label: '键盘快捷键', icon: <Keyboard size={15} /> },
    { key: 'tools', label: '工具与密钥', icon: <Wrench size={15} /> },
    { key: 'plugins', label: '插件', icon: <Puzzle size={15} /> },
    { key: 'archived', label: '已归档对话', icon: <Archive size={15} /> },
    { key: 'about', label: '关于', icon: <Info size={15} /> },
  ]
  // 旧 tab key 深链映射（命令面板/其他页面跳转兼容）
  const LEGACY: Record<string, string> = { models: 'providers', strategy: 'model', persona: 'chat', mcp: 'tools', plugin: 'plugins', skin: 'appearance', ui: 'appearance' }
  const [tab, setTab] = useState(() => {
    const k = initialTab || 'model'
    return (TABS.some(t => t.key === k) ? k : LEGACY[k]) || 'model'
  })
  const [q, setQ] = useState('')
  const norm = (s: string) => String(s || '').toLowerCase()
  const filteredTabs = TABS.filter(t => !q || norm(t.label).includes(norm(q)))

  const filePermission = useSettingsStore(s => s.general.filePermission || 'auto')

  const renderPage = () => {
    switch (tab) {
      case 'model': return <ModelSettings onGoTab={(t) => setTab(t)} />
      case 'chat': return <PersonaTab />
      case 'appearance': return <><SkinTab /><UiTab /></>
      case 'workspace': return <WorkspaceSettings />
      case 'security': return (
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 26px 30px' }}>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, marginBottom: 16 }}>风险分级（L0-L4）与危险命令拦截始终开启；这里控制默认的文件操作权限档，会话中可在输入框随时切换。</div>
          <div className="aux-row">
            <div className="aux-row-main">
              <div className="aux-row-name">默认文件权限档</div>
              <div className="aux-row-sub">新会话启动时使用的文件操作权限</div>
            </div>
            <div className="aux-row-actions">
              <select style={{ height: 30, borderRadius: 7, border: '1px solid ' + C.border, background: C.input, color: C.text, fontSize: 'calc(var(--ui-font-size) - 2px)', outline: 'none', cursor: 'pointer' }}
                value={filePermission}
                onChange={e => { useSettingsStore.getState().updateGeneral({ filePermission: e.target.value }); }}
              >
                {(Object.keys(PERM_ICONS) as FilePerm[]).map(k => <option key={k} value={k}>{PERM_LABELS[k]}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, marginTop: 14, lineHeight: 1.7 }}>
            需要临时改权限时，直接点输入框下方的盾牌档位即可，仅对当前会话生效。
          </div>
        </div>
      )
      case 'browser': return <BrowserSettings />
      case 'memory': return <MemoryContextSettings />
      case 'advanced': return <AdvancedTab />
      case 'notifications': return <NotificationsSettings />
      case 'billing': return <BillingSettings />
      case 'gateway': return <GatewaySettings onGoTab={(t) => { if (t === 'messagesPage') { onNavigate('messages'); } else setTab(t) }} />
      case 'providers': return <ModelsTab showToast={showToast} />
      case 'keybinds': return <KeybindsTab />
      case 'tools': return (
        <>
          <ToolsTab />
          <div style={{ height: 12 }} />
          <McpTab />
        </>
      )
      case 'plugins': return <PluginsView />
      case 'archived': return <ArchivedSessions />
      case 'about': return <AboutTab />
      default: return <ModelSettings onGoTab={(t) => setTab(t)} />
    }
  }

  return (
    <div className="hq-settings">
      {/* 顶部居中搜索（对齐参考: 搜索 Ctrl K） */}
      <div className="hq-settings-topbar">
        <div className="hq-settings-searchwrap">
          <Search size={13} />
          <input
            className="hq-settings-search"
            placeholder="搜索设置"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <span className="sb-kbd">Ctrl</span>
          <span className="sb-kbd">K</span>
        </div>
      </div>
      {/* 左导航：18 项平铺 */}
      <div className="hq-settings-nav">
        <div className="hq-settings-nav-scroll">
          {filteredTabs.map(t => (
            <button key={t.key} type="button" className={'hq-settings-nav-item' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
              <span className="nav-icon">{t.icon}</span>
              <span className="hq-settings-nav-label">{t.label}</span>
            </button>
          ))}
          {filteredTabs.length === 0 && <div className="empty-tip">没有匹配的设置项</div>}
        </div>
        <div className="hq-settings-nav-footer">
          <button type="button" className="hq-icon-btn" title="导出设置" aria-label="导出设置" onClick={async () => { try { const cfg = await window.huangquan.settings.load(); const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'huangquan-settings-' + new Date().toISOString().slice(0, 10) + '.json' }); a.click() } catch { alert('导出失败') } }}><Download size={14} /></button>
          <button type="button" className="hq-icon-btn" title="导入设置" aria-label="导入设置" onClick={() => { const f = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' }); f.onchange = async () => { try { const t = await f.files?.[0]?.text(); if (t) { const cfg = JSON.parse(t); await window.huangquan.settings.save(cfg); alert('导入成功，请重启应用'); window.location.reload() } } catch { alert('导入失败，文件格式不正确') } }; f.click() }}><Upload size={14} /></button>
          <button type="button" className="hq-icon-btn" title="恢复默认" aria-label="恢复默认" onClick={() => { if (confirm('重置所有设置为默认值？此操作不可撤销。')) { window.huangquan.settings.reset?.(); alert('已重置，请重启应用'); window.location.reload() } }}><RotateCcw size={14} /></button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="hq-settings-main">
        <div className="hq-settings-content">
          <React.Suspense fallback={<div style={{ padding: 24, color: C.muted, fontSize: 'calc(var(--ui-font-size) - 1px)' }}>加载中…</div>}>
            {renderPage()}
          </React.Suspense>
        </div>
      </div>
      {toast && <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', background:C.accent, color:'#fff', padding:'10px 18px', borderRadius:8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex:9999 }}>{toast}</div>}
    </div>
  )
}
