// ChatThinkSelector.tsx —— 推理强度选择器（从 ChatInput 拆出，行为不变）
import React from 'react'
import { THINK_LEVELS, THINK_LABELS } from './chat-input-constants'
import { U } from './ui-styles'


export const ChatThinkSelector: React.FC<{
  thinkLabel: string
  effThink: string
  thinkOpen: boolean
  ovModel: string
  thinkOnly: boolean
  onToggle: () => void
  onToggleThinkMode: (on: boolean) => void
  onToggleThinkOnly: () => void
  onSetLevel: (k: string) => void
}> = ({ thinkLabel, effThink, thinkOpen, ovModel, thinkOnly, onToggle, onToggleThinkMode, onToggleThinkOnly, onSetLevel }) => (
  <div className="dropdown-wrap">
    <button
      title={`推理强度（当前：${thinkLabel}）`}
      onClick={onToggle}
      style={{
        height: 28, borderRadius: 5, padding: '0 10px', cursor: 'pointer', whiteSpace: 'nowrap',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: thinkOpen ? 'var(--bg-hover)' : 'var(--bg-elevated)',
        border: '1px solid ' + (thinkOpen ? 'var(--accent)' : 'var(--border)'),
        color: thinkOpen ? 'var(--accent)' : (effThink === 'off' ? 'var(--text-muted)' : 'var(--text-secondary)'),
        fontSize: 'calc(var(--ui-font-size) - 2px)', transition: 'all .12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
      onMouseLeave={e => { if (!thinkOpen) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = effThink === 'off' ? 'var(--text-muted)' : 'var(--text-secondary)' } }}
    >
      推理：{thinkLabel}
    </button>
    {thinkOpen && (
      <div className="dropdown-menu" style={{ left: 'auto', right: 0 }}>
        <div className={`dropdown-item ${effThink === 'off' ? 'active' : ''}`} onClick={() => onToggleThinkMode(effThink === 'off')} style={U.b600}>
          思考：{effThink === 'off' ? '关' : '开'}
        </div>
        <div className={`dropdown-item ${thinkOnly ? 'active' : ''}`} onClick={onToggleThinkOnly} style={{ fontSize: 'calc(var(--ui-font-size) - 3px)' }}>
          仅当前模型：{ovModel}
        </div>
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
        {THINK_LEVELS.map(k => (
          <div key={k} className={`dropdown-item ${effThink === k ? 'active' : ''}`} onClick={() => onSetLevel(k)}>
            {THINK_LABELS[k]}
          </div>
        ))}
      </div>
    )}
  </div>
)
