// TitleBar.tsx —— v0.4.2 标题栏：34px，左工具簇 + 会话标题 + 右工具簇
// 对齐参考 titlebar：左侧(侧栏开关/面板翻转/新对话)，右侧(命令面板/右栏开关/设置)
// 上下文用量只在底部状态栏展示（与参考实现一致），标题栏不重复
// 原生窗口控制按钮(WCO)由 titleBarOverlay 渲染在右上角，标题栏为其预留 150px
import React, { useEffect, useRef, useState } from 'react'
import { PanelLeft, ArrowLeftRight, SquarePen, Settings, PanelRight, Command, Columns2 } from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import { keybindHint } from '../store/keybinds'

const TITLEBAR_TOOL_SIZE = 24

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

export default function TitleBar({ sidebarOpen, onToggleSidebar, rightRailOpen, onToggleRightRail, panesFlipped, onFlipPanes, onOpenSettings, onTogglePalette, onNewChat, splitSessionId, onSplit, onCloseSplit }: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  rightRailOpen: boolean
  onToggleRightRail: () => void
  panesFlipped: boolean
  onFlipPanes: () => void
  onOpenSettings: () => void
  onTogglePalette: () => void
  onNewChat: () => void
  splitSessionId: string | null
  onSplit: (dir: 'row' | 'column', sessionId: string) => void
  onCloseSplit: () => void
}) {
  const title = useChatStore(s => s.cur()?.title || '新对话')
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const sessions = useChatStore(s => s.sessions)
  const cid = useChatStore(s => s.cid)
  const [splitOpen, setSplitOpen] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!splitOpen) return
    const onDown = (e: MouseEvent) => {
      if (splitRef.current && !splitRef.current.contains(e.target as Node)) setSplitOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [splitOpen])

  return (
    <header className="hq-titlebar">
      {/* 左工具簇(titlebarTools left) */}
      <div className="hq-titlebar-cluster hq-titlebar-cluster-left">
        <ToolButton title={sidebarOpen ? '隐藏侧边栏' : '显示侧边栏'} onClick={onToggleSidebar}>
          <PanelLeft size={14} />
        </ToolButton>
        <ToolButton title="交换侧栏与右栏位置" onClick={onFlipPanes} active={panesFlipped}>
          <ArrowLeftRight size={14} />
        </ToolButton>
        <ToolButton title={'新对话 (' + keybindHint('new-chat') + ')'} onClick={onNewChat}>
          <SquarePen size={14} />
        </ToolButton>
        {/* 分栏：主区并排只读会话 */}
        <div className="hq-split-wrap" ref={splitRef}>
          <ToolButton title={splitSessionId ? '关闭分栏' : '分栏查看会话'} onClick={() => { if (splitSessionId) { onCloseSplit(); return } setSplitOpen(v => !v) }} active={!!splitSessionId}>
            <Columns2 size={14} />
          </ToolButton>
          {splitOpen && !splitSessionId && (
            <div className="hq-split-menu">
              <div className="hq-split-menu-label">选择要并排查看的会话</div>
              {sessions.filter(s => s.id !== cid && !s.archived).slice(0, 12).map(s => (
                <div key={s.id} className="hq-split-menu-item-wrap">
                  <button type="button" className="hq-split-menu-item" onClick={() => { onSplit('row', s.id); setSplitOpen(false) }}>
                    <span className="hq-split-menu-item-title">{s.title || '（无标题）'}</span>
                    <span className="hq-split-menu-dir">右侧</span>
                  </button>
                  <button type="button" className="hq-split-menu-item" onClick={() => { onSplit('column', s.id); setSplitOpen(false) }}>
                    <span className="hq-split-menu-item-title">{s.title || '（无标题）'}</span>
                    <span className="hq-split-menu-dir">下方</span>
                  </button>
                </div>
              ))}
              {sessions.filter(s => s.id !== cid && !s.archived).length === 0 && (
                <div className="hq-split-menu-empty">没有其它会话</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 会话标题 + 模式徽标 */}
      <div className="hq-titlebar-title-wrap">
        <span className="hq-titlebar-title" title={title}>{title}</span>
        <span className="hq-titlebar-mode">{mode === 'work' ? '工作' : '聊天'}</span>
      </div>

      <div className="hq-titlebar-spacer" />

      {/* 右工具簇(titlebarTools right) */}
      <div className="hq-titlebar-cluster hq-titlebar-cluster-right">
        <ToolButton title={'命令面板 (' + keybindHint('command-palette') + ')'} onClick={onTogglePalette}>
          <Command size={14} />
        </ToolButton>
        <ToolButton title={rightRailOpen ? '隐藏右栏' : '显示右栏'} onClick={onToggleRightRail} active={rightRailOpen}>
          <PanelRight size={14} />
        </ToolButton>
        <ToolButton title="设置" onClick={onOpenSettings}>
          <Settings size={14} />
        </ToolButton>
      </div>
    </header>
  )
}
