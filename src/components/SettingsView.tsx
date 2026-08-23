import React, { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/settings'
import { C, S } from './settings-ui'
import { MEDIA_PRESETS } from './settings/consts'


import { Key, SlidersHorizontal, UserRound, Database, Users, Wrench, Puzzle, Palette, BarChart3, Settings as SettingsIcon, Info, Download, Upload, RotateCcw, Activity, MonitorSmartphone, Keyboard } from 'lucide-react'
import { ScrollMark, MaskMark } from './themed-icons'
// v0.3.6 P3-10: 设置各 tab 懒加载, 首屏只加载默认 tab(供应商), 减少启动与首屏 bundle
const AboutTab = React.lazy(() => import('./settings/AboutTab'))
const ModelsTab = React.lazy(() => import('./settings/ModelsTab'))
const StatsTab = React.lazy(() => import('./settings/StatsTab'))
const SkinTab = React.lazy(() => import('./settings/SkinTab'))
const UiTab = React.lazy(() => import('./settings/UiTab'))
const KeybindsTab = React.lazy(() => import('./settings/KeybindsTab'))
const McpTab = React.lazy(() => import('./settings/McpTab'))
const MemoryTab = React.lazy(() => import('./settings/MemoryTab'))
const StrategyTab = React.lazy(() => import('./settings/StrategyTab'))
const PersonaTab = React.lazy(() => import('./settings/PersonaTab'))
const ToolsTab = React.lazy(() => import('./settings/ToolsTab'))
const AdvancedTab = React.lazy(() => import('./settings/AdvancedTab'))
const CollabTab = React.lazy(() => import('./settings/CollabTab'))
const DiagnosticsTab = React.lazy(() => import('./settings/DiagnosticsTab'))
const KnowledgeView = React.lazy(() => import('./KnowledgeView'))
const PluginsView = React.lazy(() => import('./PluginsView'))
import { U } from './ui-styles'


// 判断是否为本地服务（127.0.0.1 / localhost / noKey）



export default function SettingsView({ onNavigate, initialTab }: { onNavigate: (v: string) => void; initialTab?: string }) {
  useSettingsStore()

  // 读取后才有模型 —— 一次性迁移: 清理与官方预置完全一致的模型(旧行为自动带上的, 未经过读取)
  useEffect(() => {
    try {
      const same = (a: string[] | undefined, b: string[] | undefined) => {
        const A = a || [], B = b || []
        return A.length === B.length && A.every((x, i) => x === B[i])
      }
      ;(mediaProviders || []).forEach(mp => {
        const pre = MEDIA_PRESETS[mp.name]
        if (!pre) return
        const patch: Parameters<typeof updateMediaProvider>[1] = {}
        if (same(mp.imgModels, pre.img)) { patch.imgModels = []; patch.selectedImg = undefined }
        if (same(mp.videoModels, pre.video)) { patch.videoModels = []; patch.selectedVideo = undefined }
        if (Object.keys(patch).length) updateMediaProvider(mp.id, patch)
      })
    } catch (e) { /* 迁移失败不影响使用 */ console.debug('[swallow]', e) }
     
  }, [])

  // 模型缓存统计(持久化)
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  // 新建工作流改用应用内弹窗(Electron 不支持 prompt, 调用会抛错触发全局错误页)
  const [wfModal, setWfModal] = useState(false)
  const [wfName, setWfName] = useState('')
  const [wfDesc, setWfDesc] = useState('')
  // 多媒体供应商
  const mediaProviders = useSettingsStore(s => s.mediaProviders || [])
  const updateMediaProvider = useSettingsStore(s => s.updateMediaProvider)

  const TABS = [
    { key: 'models', icon: <Key size={15} />, label: '供应商' }, { key: 'strategy', icon: <SlidersHorizontal size={15} />, label: '策略' },
    { key: 'persona', icon: <UserRound size={15} />, label: '角色' },
    { key: 'memory', icon: <Database size={15} />, label: '记忆' }, { key: 'collab', icon: <Users size={15} />, label: '协作' },
    { key: 'tools', icon: <Wrench size={15} />, label: '工具' },
    { key: 'mcp', icon: <Puzzle size={15} />, label: 'MCP' },
    { key: 'skin', icon: <Palette size={15} />, label: '外观' },
    { key: 'ui', icon: <MonitorSmartphone size={15} />, label: '界面' },
    { key: 'keybinds', icon: <Keyboard size={15} />, label: '快捷键' },
    { key: 'stats', icon: <BarChart3 size={15} />, label: '模型缓存统计' },
    { key: 'diagnostics', icon: <Activity size={15} />, label: '诊断' },
    { key: 'advanced', icon: <SettingsIcon size={15} />, label: '引擎' },
    // 藏书阁（原知识库）：私人文档的录入/检索/问答
    { key: 'knowledge', icon: <ScrollMark size={15} />, label: '藏书阁' },
    { key: 'plugins', icon: <MaskMark size={15} />, label: '插件' },
    { key: 'about', icon: <Info size={15} />, label: '关于' },
  ]
  // v0.4.2: 支持命令面板/引导深链到指定 tab（TABS 定义后才能安全引用）
  const [tab, setTab] = useState(() => initialTab && TABS.some(t => t.key === initialTab) ? initialTab : 'models')
  const [q, setQ] = useState('')

  // 分类导航：把线性 Tab 收敛成几组 + 顶部搜索（低密度，能力藏而不堆）
  const CATEGORIES: { key: string; label: string; items: string[] }[] = [
    { key: 'model', label: '模型', items: ['models', 'strategy'] },
    { key: 'team', label: '角色与协作', items: ['persona', 'collab'] },
    { key: 'cap', label: '能力与扩展', items: ['tools', 'mcp', 'plugins'] },
    { key: 'content', label: '内容', items: ['memory', 'knowledge'] },
    { key: 'look', label: '外观与界面', items: ['skin', 'ui', 'keybinds'] },
    { key: 'system', label: '系统', items: ['stats', 'diagnostics', 'advanced', 'about'] },
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
            {tab === 'models' ? <ModelsTab showToast={showToast} /> : tab === 'strategy' ? <StrategyTab /> : tab === 'persona' ? <PersonaTab /> : tab === 'memory' ? <MemoryTab /> : tab === 'collab' ? <CollabTab onNavigate={(pg) => onNavigate(pg)} setTab={setTab} openWfModal={(n, d) => { setWfName(n); setWfDesc(d); setWfModal(true) }} /> : tab === 'mcp' ? <McpTab /> : tab === 'stats' ? <StatsTab /> : tab === 'diagnostics' ? <DiagnosticsTab /> : tab === 'skin' ? <SkinTab /> : tab === 'ui' ? <UiTab /> : tab === 'keybinds' ? <KeybindsTab /> : tab === 'tools' ? <ToolsTab /> : tab === 'advanced' ? <AdvancedTab /> : tab === 'knowledge' ? <KnowledgeView /> : tab === 'plugins' ? <PluginsView /> : tab === 'about' ? <AboutTab /> : null}
          </React.Suspense>
        </div>
      </div>
      {/* 新建工作流弹窗(Electron prompt 不支持) */}
      {wfModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && setWfModal(false)}>
          <div style={{ ...S.card, width: 420, padding: 24 }}>
            <div style={{ fontSize: 'calc(var(--ui-font-size) + 2px)', fontWeight: 700, color: C.text, marginBottom: 14 }}>新建工作流</div>
            <div style={S.label}>名称</div>
            <input style={{ ...S.inp, marginBottom: 10 }} value={wfName} placeholder="工作流名称" onChange={e => setWfName(e.target.value)} autoFocus />
            <div style={S.label}>任务描述</div>
            <textarea style={{ ...S.inp, minHeight: 60, resize: 'vertical', marginBottom: 14 }} value={wfDesc} placeholder="将按此执行（留空用名称）" onChange={e => setWfDesc(e.target.value)} />
            <div style={U.flexEnd}>
              <button style={S.btn('ghost')} onClick={() => setWfModal(false)}>取消</button>
              <button style={S.btn('primary')} disabled={!wfName.trim()} onClick={() => {
                const name = wfName.trim(); const desc = wfDesc.trim() || name
                const list = JSON.parse(localStorage.getItem('hq_custom_wfs') || '[]')
                list.push({ id: Date.now().toString(36), name, desc, steps: 1 })
                localStorage.setItem('hq_custom_wfs', JSON.stringify(list))
                setWfName(''); setWfDesc(''); setWfModal(false)
                showToast('已创建自定义工作流「' + name + '」')
              }}>创建</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', background:C.accent, color:'#fff', padding:'10px 18px', borderRadius:8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex:9999 }}>{toast}</div>}
    </div>
  )
}
