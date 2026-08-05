import React, { useState, useMemo } from 'react'
import { useSettingsStore } from '../store/settings'
import { useAgents } from '../store/agents'
import { TOOLS } from '../store/tools'
import { useChatStore } from '../store/chat'
import type { AgentDef } from '../types'

// v0.3.0 M3: Agent 实体化管理页 —— 工具白名单(标签+可编辑勾选)/模型偏好(仅存储)/记忆范围徽标
// 编辑保存进 settings.agentOverrides, 运行时由 useAgents() 合并生效

const S = {
  card: { background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, marginBottom: 12 } as React.CSSProperties,
  title: { fontSize: 'calc(var(--ui-font-size) + 4px)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 } as React.CSSProperties,
  row: { display: 'flex', alignItems: 'center', gap: 10 } as React.CSSProperties,
  label: { fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', marginBottom: 6, marginTop: 12 } as React.CSSProperties,
  chip: { fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '2px 8px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' } as React.CSSProperties,
  badge: { fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '2px 8px', borderRadius: 10 } as React.CSSProperties,
  btn: (kind: 'primary' | 'ghost'): React.CSSProperties => ({
    fontSize: 'calc(var(--ui-font-size) - 1px)', padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
    border: '1px solid ' + (kind === 'primary' ? 'var(--accent)' : 'var(--border)'),
    background: kind === 'primary' ? 'var(--accent)' : 'transparent',
    color: kind === 'primary' ? 'var(--on-accent)' : 'var(--text-secondary)',
  }),
}

export default function AgentsView() {
  const agents = useAgents()
  const general = useSettingsStore(s => s.general)
  const activeAgents = useChatStore(s => s.activeAgents)
  const [editAgent, setEditAgent] = useState<string | null>(null)
  const [draftTools, setDraftTools] = useState<string[]>([])
  const [draftModel, setDraftModel] = useState<string>('')
  const [savedMsg, setSavedMsg] = useState('')

  const overrides: Record<string, Partial<AgentDef>> = general?.agentOverrides || {}
  const allToolNames = useMemo(() => TOOLS.map(t => t.function.name), [])

  const toast = (msg: string) => { setSavedMsg(msg); setTimeout(() => setSavedMsg(''), 2500) }

  const startEdit = (name: string, ag: AgentDef) => {
    setEditAgent(name)
    setDraftTools(overrides[name]?.tools && (overrides[name].tools as string[]).length ? (overrides[name].tools as string[]) : ag.tools)
    setDraftModel(overrides[name]?.model || ag.model || '')
  }

  const saveEdit = (name: string) => {
    const next = { ...overrides, [name]: { ...(overrides[name] || {}), tools: draftTools, model: draftModel || undefined } }
    useSettingsStore.getState().updateGeneral({ agentOverrides: next })
    setEditAgent(null)
    toast(`已保存「${name}」的 Agent 配置(重启后持续生效)`)
  }

  const resetOne = (name: string) => {
    const next = { ...overrides }
    delete next[name]
    useSettingsStore.getState().updateGeneral({ agentOverrides: next })
    toast(`已恢复「${name}」默认配置`)
  }

  const toggleTool = (t: string) => {
    setDraftTools(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={S.title}>编队管理</div>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', marginBottom: 16 }}>
        在这里设置每位角色的工具范围和记忆范围：全局记忆所有角色共享，私有记忆仅自己可见。模型偏好将在后续版本生效。
      </div>
      {savedMsg && <div style={{ color: 'var(--success)', fontSize: 'calc(var(--ui-font-size) - 1px)', marginBottom: 10 }}>{savedMsg}</div>}
      {Object.entries(agents).map(([name, ag]) => {
        const isActive = activeAgents.includes(name)
        const ov = overrides[name]
        const curTools = ov?.tools && (ov.tools as string[]).length ? (ov.tools as string[]) : ag.tools
        const isAll = curTools.includes('*')
        const editing = editAgent === name
        return (
          <div key={name} style={{ ...S.card, borderColor: isActive ? 'var(--accent)' : 'var(--border)' }}>
            <div style={S.row}>
              <span style={{ fontSize: 22 }}>{ag.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 'calc(var(--ui-font-size) + 1px)' }}>
                  {name}
                  {isActive && <span style={{ ...S.badge, background: 'var(--accent)', color: 'var(--on-accent)', marginLeft: 8 }}>工作中</span>}
                  {ov && <span style={{ ...S.badge, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', marginLeft: 6 }}>已自定义</span>}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 'calc(var(--ui-font-size) - 2px)' }}>{ag.role}</div>
              </div>
              <span style={{ ...S.badge, background: ag.memoryScope === 'global' ? 'color-mix(in srgb, var(--danger) 15%, transparent)' : 'color-mix(in srgb, var(--accent) 15%, transparent)', color: ag.memoryScope === 'global' ? 'var(--danger)' : 'var(--accent)', border: '1px solid var(--border)' }}>
                {ag.memoryScope === 'global' ? '记忆: 全局' : '记忆: 私有'}
              </span>
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(ag.capabilities || []).map(c => <span key={c} style={{ ...S.chip, color: 'var(--accent)', borderColor: 'var(--accent)' }}>擅长:{({ dispatch: '任务调度', doc: '文档处理', security: '安全审查', automation: '自动化', chat: '陪伴沟通', vision: '视觉设计', code: '开发' } as Record<string, string>)[c] || c}</span>)}
              {ag.model ? <span style={{ ...S.chip }}>模型偏好: {ag.model}</span> : null}
            </div>
            <div style={S.label}>工具白名单 {isAll ? '(全工具)' : `(${curTools.length} 项)`}</div>
            {editing ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto', padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
                  {allToolNames.map(t => {
                    const on = draftTools.includes('*') || draftTools.includes(t)
                    return (
                      <span key={t} onClick={() => toggleTool(t)} style={{ ...S.chip, cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--bg-elevated)', color: on ? 'var(--on-accent)' : 'var(--text-secondary)' }}>
                        {on ? '✓ ' : ''}{t}
                      </span>
                    )
                  })}
                </div>
                <div style={S.label}>模型偏好（后续版本生效）</div>
                <input
                  value={draftModel}
                  onChange={e => setDraftModel(e.target.value)}
                  placeholder="留空=默认模型"
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 'calc(var(--ui-font-size) - 1px)' }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                  <button style={S.btn('ghost')} onClick={() => setEditAgent(null)}>取消</button>
                  <button style={S.btn('primary')} onClick={() => saveEdit(name)}>保存</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {isAll
                    ? <span style={{ ...S.chip }}>全部工具（含交接、派发、任务列表）</span>
                    : curTools.slice(0, 8).map(t => <span key={t} style={S.chip}>{t}</span>)}
                  {!isAll && curTools.length > 8 && <span style={S.chip}>+{curTools.length - 8} 项</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                  {ov && <button style={S.btn('ghost')} onClick={() => resetOne(name)}>恢复默认</button>}
                  <button style={S.btn('primary')} onClick={() => startEdit(name, ag)}>编辑</button>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
