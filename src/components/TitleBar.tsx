// TitleBar.tsx —— v0.4.4 标题栏（对齐参考 图标位）：
// 左: 隐藏侧边栏 / 交换侧边栏位置 · 中: 会话标题(有消息才显示) · 右: 布局编辑器 / HUD 模式 / 动效反馈 / 打开设置 / 显示右侧栏
import React, { useEffect, useRef, useState } from 'react'
import { PanelLeft, ArrowLeftRight, Settings, PanelRight, Command, LayoutTemplate, AppWindow, Vibrate } from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import { keybindHint } from '../store/keybinds'

const TITLEBAR_TOOL_SIZE = 26

function ToolButton({ title, onClick, children, active }: {
  title: string
  onClick?: () => void
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      type="button"
      className={'hq-titlebar-tool' + (active ? ' active' : '')}
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{ width: TITLEBAR_TOOL_SIZE, height: TITLEBAR_TOOL_SIZE }}
    >
      {children}
    </button>
  )
}

export default function TitleBar({ sidebarOpen, onToggleSidebar, rightRailOpen, onToggleRightRail, panesFlipped, onFlipPanes, onOpenSettings, statusHidden, onToggleStatusHidden }: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  rightRailOpen: boolean
  onToggleRightRail: () => void
  panesFlipped: boolean
  onFlipPanes: () => void
  onOpenSettings: () => void
  statusHidden: boolean
  onToggleStatusHidden: () => void
}) {
  const title = useChatStore(s => s.cur()?.title || '')
  const msgCount = useChatStore(s => s.cur()?.messages.length ?? 0)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const animOn = useSettingsStore(s => s.general.animation !== false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const layoutRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!layoutOpen) return
    const onDown = (e: MouseEvent) => {
      if (layoutRef.current && !layoutRef.current.contains(e.target as Node)) setLayoutOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [layoutOpen])

  const toggleLs = (key: string, current: boolean): boolean => {
    const next = !current
    localStorage.setItem(key, next ? '1' : '0')
    window.dispatchEvent(new Event('hq-layout-changed'))
    return next
  }
  const lsOn = (key: string): boolean => localStorage.getItem(key) === '1'

  return (
    <header className="hq-titlebar">
      {/* 左工具簇: 侧栏开关 + 面板翻转 */}
      <div className="hq-titlebar-cluster hq-titlebar-cluster-left">
        <ToolButton title={sidebarOpen ? '隐藏侧边栏' : '显示侧边栏'} onClick={onToggleSidebar}>
          <PanelLeft size={15} />
        </ToolButton>
        <ToolButton title="交换侧边栏位置" onClick={onFlipPanes} active={panesFlipped}>
          <ArrowLeftRight size={15} />
        </ToolButton>
      </div>

      {/* 会话标题: 空会话不显示, 保持首页干净 */}
      <div className="hq-titlebar-title-wrap">
        {msgCount > 0 && title && <span className="hq-titlebar-title" title={title}>{title}</span>}
        {msgCount > 0 && title && <span className="hq-titlebar-mode">{mode === 'work' ? '工作' : '聊天'}</span>}
      </div>

      <div className="hq-titlebar-spacer" />

      {/* 右工具簇: 布局编辑器 / HUD 模式 / 动效反馈 / 打开设置 / 显示右侧栏 */}
      <div className="hq-titlebar-cluster hq-titlebar-cluster-right">
        <div className="hq-layout-wrap" ref={layoutRef}>
          <ToolButton title="布局编辑器" onClick={() => setLayoutOpen(v => !v)} active={layoutOpen}>
            <LayoutTemplate size={15} />
          </ToolButton>
          {layoutOpen && (
            <div className="hq-layout-menu">
              <div className="hq-layout-menu-title">显示 / 隐藏界面区域</div>
              <button type="button" className="hq-layout-menu-item" onClick={() => { onToggleSidebar(); }}>
                <span className={'hq-check' + (sidebarOpen ? ' on' : '')} />侧边栏
                <span className="hq-layout-menu-sub">会话列表与功能入口</span>
              </button>
              <button type="button" className="hq-layout-menu-item" onClick={() => { onToggleRightRail(); }}>
                <span className={'hq-check' + (rightRailOpen ? ' on' : '')} />右侧栏
                <span className="hq-layout-menu-sub">文件 / 预览 / 终端 / 评审</span>
              </button>
              <button type="button" className="hq-layout-menu-item" onClick={() => { onToggleStatusHidden(); }}>
                <span className={'hq-check' + (!statusHidden ? ' on' : '')} />状态栏
                <span className="hq-layout-menu-sub">底部设备与上下文状态</span>
              </button>
              <button type="button" className="hq-layout-menu-item" onClick={() => { toggleLs('hq_daysummary_hidden', lsOn('hq_daysummary_hidden')); }}>
                <span className={'hq-check' + (!lsOn('hq_daysummary_hidden') ? ' on' : '')} />当日总结
                <span className="hq-layout-menu-sub">右缘今日动态入口</span>
              </button>
              <button type="button" className="hq-layout-menu-item" onClick={() => { toggleLs('hq_profilestrip_hidden', lsOn('hq_profilestrip_hidden')); }}>
                <span className={'hq-check' + (!lsOn('hq_profilestrip_hidden') ? ' on' : '')} />配置档案条
                <span className="hq-layout-menu-sub">侧栏底部档案切换</span>
              </button>
              <div className="hq-layout-menu-sep" />
              <button type="button" className="hq-layout-menu-item" onClick={() => { window.dispatchEvent(new Event('hq-open-palette')); setLayoutOpen(false) }}>
                <span className={'hq-check' + ''} /><Command size={13} />命令面板 <span className="hq-layout-menu-sub">{keybindHint('command-palette')}</span>
              </button>
            </div>
          )}
        </div>
        <ToolButton title="HUD 模式（迷你常驻输入条）" onClick={() => { void window.huangquan.hud.toggle() }}>
          <AppWindow size={15} />
        </ToolButton>
        <ToolButton title="动效反馈" onClick={() => { const g = useSettingsStore.getState(); g.updateGeneral({ animation: !(g.general.animation !== false) }) }} active={animOn}>
          <Vibrate size={15} />
        </ToolButton>
        <ToolButton title="打开设置" onClick={onOpenSettings}>
          <Settings size={15} />
        </ToolButton>
        <ToolButton title={rightRailOpen ? '隐藏右侧栏' : '显示右侧栏'} onClick={onToggleRightRail} active={rightRailOpen}>
          <PanelRight size={15} />
        </ToolButton>
      </div>
    </header>
  )
}
