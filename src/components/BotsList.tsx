// BotsList.tsx —— v0.4.4 侧栏 BOTS 页签（对齐参考: 聊天式 Bot 会话列表）
// 每个 Bot = 一个可对话的助手实体（圆角头像 + 状态点 + 名字 + 最后消息预览），
// 点卡片即进入该 Bot 的专属会话；悬浮铅笔编辑人设；顶部「新建机器人」。
// Bot 定义复用 AgentDef（role/prompt），会话绑定走 localStorage 映射。
import { useState } from 'react'
import { Bot, Plus, Trash2, Pencil, Check, X, VolumeX } from 'lucide-react'
import { useAgents } from '../store/agents'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { AgentDef } from '../types'
import type { View } from '../App'

const newBotDef = (role: string, prompt: string): AgentDef => ({
  role, prompt, tools: ['*'], handoff_to: [], icon: '🤖', memoryScope: 'global', capabilities: [],
})

const AVATAR_COLORS = ['#7c6fc4', '#4f8cff', '#4fae7e', '#e0a458', '#e0526e', '#37d0c8', '#9aa3b2']
const readMeta = (): Record<string, { color?: string }> => {
  try { return JSON.parse(localStorage.getItem('hq_bots_meta') || '{}') } catch { return {} }
}
const writeMeta = (m: Record<string, { color?: string }>): void => { try { localStorage.setItem('hq_bots_meta', JSON.stringify(m)) } catch { /* 忽略 */ } }

const fmtAgo = (ts: number): string => {
  const d = Date.now() - ts
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return Math.floor(d / 60_000) + '分钟'
  if (d < 86_400_000) return Math.floor(d / 3_600_000) + '小时'
  return Math.floor(d / 86_400_000) + '天'
}

export default function BotsList({ onNavigate }: { onNavigate: (v: View) => void }) {
  const agentsMap = useAgents()
  const overrides = useSettingsStore(s => (s.general).agentOverrides || {})
  const sessions = useChatStore(s => s.sessions)
  const create = useChatStore(s => s.create)
  const switchS = useChatStore(s => s.switchS)
  const [muted, setMuted] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrompt, setEditPrompt] = useState('')

  const roles = Object.keys(agentsMap)
  const boundSid = (role: string): string | undefined => {
    try { return (JSON.parse(localStorage.getItem('hq_bot_session_map') || '{}'))[role] } catch { return undefined }
  }
  const previewOf = (role: string): { text: string; ts: number } => {
    const sid = boundSid(role)
    const sess = sid ? sessions.find(x => x.id === sid) : undefined
    const msgs = sess?.messages || []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role === 'assistant' && m.content) return { text: String(m.content).replace(/\s+/g, ' ').slice(0, 60), ts: m.timestamp }
      if (m.role === 'user' && m.content) return { text: String(m.content).replace(/\s+/g, ' ').slice(0, 60), ts: m.timestamp }
    }
    return { text: '', ts: 0 }
  }
  const avatarColor = (role: string): string => {
    const m = readMeta()[role]
    if (m?.color) return m.color
    let h = 0
    for (const c of role) h = (h * 31 + c.charCodeAt(0)) >>> 0
    const color = AVATAR_COLORS[h % AVATAR_COLORS.length]
    writeMeta({ ...readMeta(), [role]: { color } })
    return color
  }

  const openBot = async (role: string) => {
    const mapKey = 'hq_bot_session_map'
    let map: Record<string, string> = {}
    try { map = JSON.parse(localStorage.getItem(mapKey) || '{}') } catch { /* 忽略 */ }
    let sid: string | undefined = map[role]
    const st = useChatStore.getState()
    if (!sid || !st.sessions.some(x => x.id === sid)) {
      create()
      const newSid: string | null = useChatStore.getState().cid
      if (!newSid) return
      sid = newSid
      useChatStore.setState(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, agent: role, title: role, mode: 'chat' } : x) }))
      map[role] = sid
      localStorage.setItem(mapKey, JSON.stringify(map))
    } else if (st.cid !== sid) {
      await switchS(sid)
    }
    onNavigate('chat')
  }

  const saveOverride = (origRole: string | null, r: string, p: string) => {
    if (!r.trim() || !p.trim()) return
    const next = { ...overrides }
    if (origRole && origRole !== r) delete next[origRole]
    next[r] = { ...(origRole ? agentsMap[origRole] : newBotDef(r, p)), role: r.trim(), prompt: p.trim() }
    useSettingsStore.getState().updateGeneral({ agentOverrides: next })
  }
  const removeBot = (role: string) => {
    if (!overrides[role]) return // 内置角色不可删
    const next = { ...overrides }
    delete next[role]
    useSettingsStore.getState().updateGeneral({ agentOverrides: next })
  }

  if (editing !== null) {
    return (
      <div className="sb-bots">
        <div className="sb-bot-form">
          <div className="sb-bot-form-row">
            <input className="hq-search" value={editName} placeholder="Bot 名字（如：翻译官）" onChange={e => setEditName(e.target.value)} />
          </div>
          <textarea className="sb-bot-prompt" rows={7} value={editPrompt}
            placeholder="人设提示词：这个 Bot 是谁、说话什么风格、擅长什么、有什么约束…"
            onChange={e => setEditPrompt(e.target.value)} />
          <div className="sb-bot-form-actions">
            <button type="button" className="hq-btn hq-btn-accent" onClick={() => { saveOverride(editing || null, editName, editPrompt); setEditing(null) }}><Check size={13} />保存</button>
            <button type="button" className="hq-btn" onClick={() => setEditing(null)}><X size={13} />取消</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sb-bots">
      {/* 头部: BOTS 标题 + 静音 + 新建机器人 */}
      <div className="sb-bots-head">
        <span className="sb-bots-title">BOTS</span>
        <span style={{ flex: 1 }} />
        <button type="button" className={'hq-sb-mini' + (muted ? ' active' : '')} title={muted ? '取消静音所有 Bot' : '静音所有 Bot 通知'} onClick={() => setMuted(v => !v)}>
          <VolumeX size={12} />
        </button>
        <button type="button" className="hq-sb-mini" title="新建机器人" onClick={() => { setName(''); setPrompt(''); setCreating(true) }}>
          <Plus size={13} />
        </button>
      </div>

      {creating && (
        <div className="sb-bot-form">
          <div className="sb-bot-form-row">
            <input className="hq-search" autoFocus value={name} placeholder="机器人名字（如：翻译官）" onChange={e => setName(e.target.value)} />
          </div>
          <textarea className="sb-bot-prompt" rows={5} value={prompt}
            placeholder="人设提示词：这个 Bot 是谁、说话什么风格、擅长什么…"
            onChange={e => setPrompt(e.target.value)} />
          <div className="sb-bot-form-actions">
            <button type="button" className="hq-btn hq-btn-accent" onClick={() => { if (name.trim() && prompt.trim()) { saveOverride(null, name, prompt); setCreating(false); setName(''); setPrompt('') } }}><Check size={13} />创建</button>
            <button type="button" className="hq-btn" onClick={() => setCreating(false)}><X size={13} />取消</button>
          </div>
        </div>
      )}

      {/* Bot 会话卡片列表（聊天软件式） */}
      <div className="sb-bot-list">
        {roles.map(role => {
          const color = avatarColor(role)
          const pv = previewOf(role)
          const sid = boundSid(role)
          const busy = sid ? !!sessions.find(x => x.id === sid)?.busy : false
          const isCustom = !!overrides[role]
          return (
            <div key={role} className="sb-bot-item" onClick={() => { void openBot(role) }} role="button" tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && void openBot(role)}>
              <span className="sb-bot-avatar" style={{ background: color }}>
                <Bot size={15} />
                <span className={'sb-bot-dot' + (busy ? ' busy' : '')} title={busy ? '工作中' : '就绪'} />
              </span>
              <span className="sb-bot-body">
                <span className="sb-bot-line1">
                  <span className="sb-bot-name">{role}</span>
                  {pv.ts > 0 && <span className="sb-bot-time">{fmtAgo(pv.ts)}</span>}
                </span>
                <span className="sb-bot-preview">{pv.text || '发消息开始对话'}</span>
              </span>
              <span className="sb-bot-actions">
                <button type="button" className="hq-mini-btn" title={isCustom ? '编辑' : '覆盖内置配置'} onClick={e => { e.stopPropagation(); setEditing(role); setEditName(role); setEditPrompt(agentsMap[role]?.prompt || '') }}><Pencil size={12} /></button>
                {isCustom && <button type="button" className="hq-mini-btn" title="删除" onClick={e => { e.stopPropagation(); removeBot(role) }}><Trash2 size={12} /></button>}
              </span>
            </div>
          )
        })}
        {roles.length === 0 && <div className="empty-tip">还没有机器人</div>}
      </div>
    </div>
  )
}
