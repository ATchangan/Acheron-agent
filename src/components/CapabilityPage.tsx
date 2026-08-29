// CapabilityPage.tsx —— v0.4.4 技能与工具（对齐参考: 三 tab + 左列表开关 + 右详情卡）
// 技能 tab: 左=技能列表(开关启停) 右=选中技能详情卡; 工具集 tab: 内置工具清单; MCP tab: 服务器列表
import { useEffect, useMemo, useState, useCallback } from 'react'
import { Search, Settings2, Wrench, Layers, Puzzle } from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import type { McpServerInfo } from '../types/domain'

type Skill = { name: string; category: string; enabled: boolean; prompt: string }

export default function CapabilityPage({ onOpenSettings }: { onOpenSettings: (tab?: string) => void }) {
  const [tab, setTab] = useState<'skills' | 'tools' | 'mcp'>('skills')
  const [q, setQ] = useState('')
  const [selSkill, setSelSkill] = useState<string | null>(null)
  const [mcp, setMcp] = useState<McpServerInfo[]>([])

  // 技能来源: agentOverrides（内置 + 用户自建 Bot 都算技能，与引擎共用一套定义）
  const overrides = useSettingsStore(s => (s.general).agentOverrides || {})
  const skills = useMemo<Skill[]>(() => Object.entries(overrides).map(([role, o]) => ({
    name: role,
    category: '自定义',
    enabled: true,
    prompt: o.prompt || '',
  })), [overrides])

  const mcpRefresh = useCallback(async () => {
    try { setMcp(await window.huangquan.mcpList().catch(() => [])) } catch { setMcp([]) }
  }, [])
  useEffect(() => { void mcpRefresh() }, [mcpRefresh])
  useEffect(() => { const t = setInterval(() => { if (tab === 'mcp') void mcpRefresh() }, 10000); return () => clearInterval(t) }, [tab, mcpRefresh])

  const removeSkill = (role: string) => {
    const next = { ...overrides }; delete next[role]
    useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), agentOverrides: next } }))
    useSettingsStore.getState().save()
    if (selSkill === role) setSelSkill(null)
  }

  const filtered = skills.filter(s => !q.trim() || s.name.toLowerCase().includes(norm(q)))
  const selected = skills.find(s => s.name === selSkill)

  const norm = (s: string): string => s.toLowerCase()
  const tabCls = (k: string): string => 'sb-ch-tab' + (tab === k ? ' active' : '')

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部 tab 条（对齐参考: 技能 N | 工具集 N | MCP） */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4, padding: '10px 16px 0' }}>
        <button type="button" className={tabCls('skills')} onClick={() => setTab('skills')}><Layers size={13} />技能 {skills.length}</button>
        <button type="button" className={tabCls('tools')} onClick={() => setTab('tools')}><Wrench size={13} />工具集</button>
        <button type="button" className={tabCls('mcp')} onClick={() => setTab('mcp')}><Puzzle size={13} />MCP</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="hq-btn" style={{ height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => onOpenSettings('providers')}>
          <Settings2 size={12} />配置
        </button>
      </div>

      {/* 技能 tab: 左列表 + 右详情 */}
      {tab === 'skills' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* 左: 搜索 + 技能列表 */}
          <div style={{ width: 240, flex: 'none', borderRight: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', padding: '10px 8px' }}>
            <div className="hq-sb-search" style={{ marginBottom: 8 }}>
              <Search size={13} />
              <input className="hq-search" placeholder="搜索技能…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {filtered.map(s => (
                <button key={s.name} type="button" className={'sb-menu-item' + (selSkill === s.name ? ' active' : '')} style={{ height: 40 }} onClick={() => setSelSkill(s.name)}>
                  <span className="hq-ch-icon" style={{ background: '#7c6fc4' }}>{s.name.slice(0, 1).toUpperCase()}</span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: 'var(--text-muted)' }}>{s.category}</span>
                  </span>
                  <span className="hq-toggle-sm on" title="启用中" />
                </button>
              ))}
              {filtered.length === 0 && <div className="empty-tip">没有匹配的技能</div>}
            </div>
          </div>
          {/* 右: 详情卡 */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px 24px' }}>
            {selected ? (
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 'calc(var(--ui-font-size) + 3px)', fontWeight: 700, color: 'var(--text-primary)' }}>{selected.name}</span>
                  <span className="aux-row-badge">{selected.category}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="hq-btn hq-btn-danger" style={{ height: 28, padding: '0 12px', fontSize: 'calc(var(--ui-font-size) - 2px)' }} onClick={() => removeSkill(selected.name)}>删除</button>
                </div>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{selected.prompt || '（无人设描述）'}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 1px)' }}>
                从左侧选择一个技能查看详情
              </div>
            )}
          </div>
        </div>
      )}

      {/* 工具集 tab */}
      {tab === 'tools' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 24px' }}>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-muted)' }}>
            内置工具开箱即用，全部会话共享。在对话中输入 /help 可查看全部斜杠命令。
          </div>
        </div>
      )}

      {/* MCP tab */}
      {tab === 'mcp' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 24px' }}>
          {mcp.length === 0 ? (
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-muted)', padding: '10px 2px' }}>
              未连接 MCP 服务器。可以在 设置 → 工具与密钥 中添加 stdio / SSE 服务器，工具会自动注入。
            </div>
          ) : (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 14px' }}>
              {mcp.map(s => (
                <div key={s.name} className="aux-row">
                  <div className="aux-row-main">
                    <div className="aux-row-name">{s.name}<span className="aux-row-badge">{s.url ? 'SSE' : 'stdio'}</span></div>
                    <div className="aux-row-sub">{(s.tools || []).length} 个工具{s.cmd ? ' · ' + s.cmd : ''}{s.url ? ' · ' + s.url : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
