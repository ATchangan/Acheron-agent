// CommandPalette.tsx —— v0.4.2 命令面板：Ctrl+K 唤起，键盘导航，快速跳转/操作
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft, MessageSquare, Folder, Settings, Globe, SquarePen, Moon, Sun, PanelLeft, PanelRight, Minus, Command } from 'lucide-react'
import { useSettingsStore } from '../store/settings'

interface Cmd {
  id: string
  label: string
  hint?: string
  group: string
  icon?: React.ReactNode
  run: () => void
}

export default function CommandPalette({ open, onClose, onNavigate, onNewChat, onToggleSidebar, onToggleRightRail, onToggleStatusbar, onOpenSettingsTab }: {
  open: boolean
  onClose: () => void
  onNavigate: (v: string) => void
  onOpenSettingsTab: (tab?: string) => void
  onNewChat: () => void
  onToggleSidebar: () => void
  onToggleRightRail: () => void
  onToggleStatusbar: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const theme = useSettingsStore(s => s.general.theme || 'violet')

  // 打开时聚焦输入框并重置状态
  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const setMode = (m: string) => { void useSettingsStore.getState().setMode(m as 'chat' | 'work') }
  const setTheme = (t: string) => useSettingsStore.getState().updateGeneral({ theme: t })

  const commands: Cmd[] = useMemo(() => [
    { id: 'nav-chat', label: '对话', group: '跳转', icon: <MessageSquare size={14} />, run: () => onNavigate('chat') },
    { id: 'nav-files', label: '文件（右栏）', group: '跳转', icon: <Folder size={14} />, run: () => onNavigate('files') },
    { id: 'nav-browser', label: '浏览器', group: '跳转', icon: <Globe size={14} />, run: () => onNavigate('browser') },
    { id: 'nav-settings', label: '设置', group: '跳转', icon: <Settings size={14} />, run: () => onNavigate('settings') },
    { id: 'set-providers', label: '设置 → 供应商', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('models') },
    { id: 'set-strategy', label: '设置 → 策略', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('strategy') },
    { id: 'set-persona', label: '设置 → 人格', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('persona') },
    { id: 'set-tools', label: '设置 → 工具', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('tools') },
    { id: 'set-mcp', label: '设置 → MCP', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('mcp') },
    { id: 'set-plugins', label: '设置 → 插件', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('plugin') },
    { id: 'set-skin', label: '设置 → 外观', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('skin') },
    { id: 'set-ui', label: '设置 → 界面', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('ui') },
    { id: 'set-keybinds', label: '设置 → 快捷键', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('keybinds') },
    { id: 'set-advanced', label: '设置 → 引擎', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('advanced') },
    { id: 'set-about', label: '设置 → 关于', group: '设置', icon: <Settings size={14} />, run: () => onOpenSettingsTab('about') },
    { id: 'act-new', label: '新对话', group: '操作', hint: 'Ctrl+N', icon: <SquarePen size={14} />, run: onNewChat },
    { id: 'act-mode', label: mode === 'work' ? '切换到聊天模式' : '切换到工作模式', group: '操作', icon: <MessageSquare size={14} />, run: () => setMode(mode === 'work' ? 'chat' : 'work') },
    { id: 'act-theme', label: theme === 'dark' ? '切换到紫色主题' : '切换到深色主题', group: '操作', icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />, run: () => setTheme(theme === 'dark' ? 'violet' : 'dark') },
    { id: 'act-sidebar', label: '显示/隐藏侧边栏', group: '视图', icon: <PanelLeft size={14} />, run: onToggleSidebar },
    { id: 'act-rightrail', label: '显示/隐藏右栏', group: '视图', icon: <PanelRight size={14} />, run: onToggleRightRail },
    { id: 'act-statusbar', label: '显示/隐藏状态栏', group: '视图', icon: <Minus size={14} />, run: onToggleStatusbar },
  ], [mode, theme, onNavigate, onNewChat, onToggleSidebar, onToggleRightRail, onToggleStatusbar, onOpenSettingsTab])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return commands
    return commands.filter(c => c.label.toLowerCase().includes(t) || c.group.toLowerCase().includes(t))
  }, [commands, q])

  useEffect(() => { setSel(0) }, [q])

  if (!open) return null

  const groups = filtered.reduce<Record<string, Cmd[]>>((acc, c) => {
    ;(acc[c.group] ||= []).push(c)
    return acc
  }, {})
  const flat = filtered

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { const c = flat[sel]; if (c) { onClose(); c.run() } }
  }

  return (
    <div className="hq-palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="hq-palette">
        <div className="hq-palette-input-wrap">
          <Search size={15} />
          <input
            ref={inputRef}
            className="hq-palette-input"
            placeholder="输入命令或搜索…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="hq-palette-kbd"><Command size={11} /> K</span>
        </div>
        <div className="hq-palette-list">
          {flat.length === 0 && <div className="hq-palette-empty">没有匹配的命令</div>}
          {Object.entries(groups).map(([g, items]) => (
            <div key={g} className="hq-palette-group">
              <div className="hq-palette-group-label">{g}</div>
              {items.map((c, _i) => {
                const idx = flat.indexOf(c)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={'hq-palette-item' + (idx === sel ? ' selected' : '')}
                    onMouseEnter={() => setSel(idx)}
                    onClick={() => { onClose(); c.run() }}
                  >
                    <span className="hq-palette-item-icon">{c.icon}</span>
                    <span className="hq-palette-item-label">{c.label}</span>
                    {c.hint && <span className="hq-palette-item-hint">{c.hint}</span>}
                    {idx === sel && <CornerDownLeft size={12} className="hq-palette-item-enter" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
