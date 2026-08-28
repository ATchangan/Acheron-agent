import React, { useState } from 'react'
import { useSettingsStore } from '../store/settings'
import { C } from './settings-ui'


import { Key, SlidersHorizontal, UserRound, Wrench, Puzzle, Palette, Settings as SettingsIcon, Info, Download, Upload, RotateCcw, MonitorSmartphone, Keyboard } from 'lucide-react'
import { MaskMark } from './themed-icons'
// v0.3.6 P3-10: 设置各 tab 懒加载, 首屏只加载默认 tab(供应商), 减少启动与首屏 bundle
// v0.4.4 精简: 仅保留 模型/策略/人格/工具/插件(MCP)/外观/界面/快捷键/引擎/关于, 技能/记忆/协作/统计/诊断/藏书阁已收敛
const AboutTab = React.lazy(() => import('./settings/AboutTab'))
const ModelsTab = React.lazy(() => import('./settings/ModelsTab'))
const SkinTab = React.lazy(() => import('./settings/SkinTab'))
const UiTab = React.lazy(() => import('./settings/UiTab'))
const KeybindsTab = React.lazy(() => import('./settings/KeybindsTab'))
const McpTab = React.lazy(() => import('./settings/McpTab'))
const StrategyTab = React.lazy(() => import('./settings/StrategyTab'))
const PersonaTab = React.lazy(() => import('./settings/PersonaTab'))
const ToolsTab = React.lazy(() => import('./settings/ToolsTab'))
const AdvancedTab = React.lazy(() => import('./settings/AdvancedTab'))
const PluginsView = React.lazy(() => import('./PluginsView'))

export default function SettingsView({ onNavigate: _onNavigate, initialTab }: { onNavigate: (v: string) => void; initialTab?: string }) {
  useSettingsStore()
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const TABS = [
    { key: 'models', icon: <Key size={15} />, label: '供应商' }, { key: 'strategy', icon: <SlidersHorizontal size={15} />, label: '策略' },
    { key: 'persona', icon: <UserRound size={15} />, label: '人格' },
    { key: 'tools', icon: <Wrench size={15} />, label: '工具' },
    { key: 'mcp', icon: <Puzzle size={15} />, label: 'MCP' },
    { key: 'plugin', icon: <MaskMark size={15} />, label: '插件' },
    { key: 'skin', icon: <Palette size={15} />, label: '外观' },
    { key: 'ui', icon: <MonitorSmartphone size={15} />, label: '界面' },
    { key: 'keybinds', icon: <Keyboard size={15} />, label: '快捷键' },
    { key: 'advanced', icon: <SettingsIcon size={15} />, label: '引擎' },
    { key: 'about', icon: <Info size={15} />, label: '关于' },
  ]
  // v0.4.2: 支持命令面板/引导深链到指定 tab（TABS 定义后才能安全引用）
  const [tab, setTab] = useState(() => initialTab && TABS.some(t => t.key === initialTab) ? initialTab : 'models')
  const [q, setQ] = useState('')

  // 分类导航：把线性 Tab 收敛成几组 + 顶部搜索（低密度，能力藏而不堆）
  const CATEGORIES: { key: string; label: string; items: string[] }[] = [
    { key: 'model', label: '模型', items: ['models', 'strategy'] },
    { key: 'persona', label: '对话', items: ['persona'] },
    { key: 'cap', label: '能力与扩展', items: ['tools', 'mcp', 'plugin'] },
    { key: 'look', label: '外观与界面', items: ['skin', 'ui', 'keybinds'] },
    { key: 'system', label: '系统', items: ['advanced', 'about'] },
  ]
  const norm = (s: string) => String(s || '').toLowerCase()
  const catOf = (key: string) => CATEGORIES.find(c => c.items.includes(key))
  const currentCat = catOf(tab)
  const matches = (t: { key: string; label: string }) => !q || norm(t.label).includes(norm(q)) || norm(t.key).includes(norm(q))
  const filteredTabs = TABS.filter(matches)

  return (
    <div className="hq-settings">
      {/* OverlayNav：左导航（分组 + 底部导入/导出/重置） */}
      <div className="hq-settings-nav">
        <input
          className="hq-settings-search"
          placeholder="搜索设置…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {q ? (
          <div className="hq-settings-nav-scroll">
            {currentCat && <div className="hq-settings-nav-cat">{currentCat.label}</div>}
            {filteredTabs.map(t => (
              <button key={t.key} type="button" className={'hq-settings-nav-item' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
                <span className="nav-icon">{t.icon}</span>
                <span className="hq-settings-nav-label">{t.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="hq-settings-nav-scroll">
            {CATEGORIES.map(cat => {
              const items = cat.items.map(k => TABS.find(x => x.key === k)).filter((x): x is (typeof TABS)[number] => !!x)
              if (!items.length) return null
              return (
                <div key={cat.key} className="hq-settings-nav-group">
                  <div className="hq-settings-nav-cat">{cat.label}</div>
                  {items.map(t => (
                    <button key={t.key} type="button" className={'hq-settings-nav-item' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
                      <span className="nav-icon">{t.icon}</span>
                      <span className="hq-settings-nav-label">{t.label}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        <div className="hq-settings-nav-footer">
          <button type="button" className="hq-icon-btn" title="导出设置" aria-label="导出设置" onClick={async () => { try { const cfg = await window.huangquan.settings.load(); const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'huangquan-settings-' + new Date().toISOString().slice(0, 10) + '.json' }); a.click() } catch { alert('导出失败') } }}><Download size={14} /></button>
          <button type="button" className="hq-icon-btn" title="导入设置" aria-label="导入设置" onClick={() => { const f = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' }); f.onchange = async () => { try { const t = await f.files?.[0]?.text(); if (t) { const cfg = JSON.parse(t); await window.huangquan.settings.save(cfg); alert('导入成功，请重启应用'); window.location.reload() } } catch { alert('导入失败，文件格式不正确') } }; f.click() }}><Upload size={14} /></button>
          <button type="button" className="hq-icon-btn" title="恢复默认" aria-label="恢复默认" onClick={() => { if (confirm('重置所有设置为默认值？此操作不可撤销。')) { window.huangquan.settings.reset?.(); alert('已重置，请重启应用'); window.location.reload() } }}><RotateCcw size={14} /></button>
        </div>
      </div>

      {/* OverlayMain：主内容区 */}
      <div className="hq-settings-main">
        <div className="hq-settings-content">
          <React.Suspense fallback={<div style={{ padding: 24, color: C.muted, fontSize: 'calc(var(--ui-font-size) - 1px)' }}>加载中…</div>}>
            {tab === 'models' ? <ModelsTab showToast={showToast} /> : tab === 'strategy' ? <StrategyTab /> : tab === 'persona' ? <PersonaTab /> : tab === 'mcp' ? <McpTab /> : tab === 'plugin' ? <PluginsView /> : tab === 'skin' ? <SkinTab /> : tab === 'ui' ? <UiTab /> : tab === 'keybinds' ? <KeybindsTab /> : tab === 'tools' ? <ToolsTab /> : tab === 'advanced' ? <AdvancedTab /> : tab === 'about' ? <AboutTab /> : null}
          </React.Suspense>
        </div>
      </div>
      {toast && <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', background:C.accent, color:'#fff', padding:'10px 18px', borderRadius:8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex:9999 }}>{toast}</div>}
    </div>
  )
}
