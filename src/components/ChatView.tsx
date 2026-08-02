import React, { useEffect, useRef } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import MessageItem from './MessageItem'
import ChatInput from './ChatInput'

export default function ChatView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const session = useChatStore(s => s.cur())
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const stage = useChatStore(s => s.stage)
  const error = useChatStore(s => s.error)
  const setMode = useChatStore(s => s.setMode)
  const providers = useSettingsStore(s => s.providers)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const workDir = useSettingsStore(s => s.general.workDir)
  const agentAvatar = useSettingsStore(s => s.general.agentAvatar)
  const agentAvatarImg = useSettingsStore(s => s.general.agentAvatarImage)
  const endRef = useRef<HTMLDivElement>(null)
  const hasProvider = providers.length > 0 && providers[0].apiKey

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [session?.messages, stage])

  const switchMode = (m: string) => { if (m !== mode) setMode(m) }

  // 消息过滤：单气泡模式下隐藏 tool 角色和纯 tool_calls 消息；多气泡模式下全部展示
  const msgs = session?.messages || []
  const singleBubble = (useSettingsStore.getState().general as any).singleBubble !== false
  // v0.2.1: 单气泡终极过滤 —— 隐藏 tool/tool_calls/空消息，且连续 assistant 合并为单条（UI 层兜底，杜绝多气泡）
  const displayMsgs = (() => {
    const out: typeof msgs = []
    for (const m of msgs) {
      // v0.2.3-fix: 工具过程(调用卡片+结果块)统一显示在「思考气泡」内, 单气泡模式消息流保持干净(只有用户+最终回答)
      if (m.role === 'tool') { if (!singleBubble) out.push(m); continue }
      if (m.role === 'assistant' && (m as any).tool_calls && !m.content) { if (!singleBubble) out.push(m); continue }
      if (m.role === 'assistant' && !m.content && !(m as any).tool_calls) continue
      if (singleBubble && m.role === 'assistant' && !(m as any).tool_calls && out.length > 0 &&
        out[out.length - 1].role === 'assistant' && !(out[out.length - 1] as any).tool_calls) {
        // 连续 assistant → 内容合并进上一条（单气泡, 卡片消息不参与合并）
        const prev = out[out.length - 1]
        const merged = ((prev.content || '') + '\n\n' + (m.content || '')).trim()
        out[out.length - 1] = { ...prev, content: merged }
      } else out.push(m)
    }
    // v0.2.3-fix(Q14): 工具名关联只对多气泡模式有意义, 注入移到 MessageItem 外循环之后仍保持简单
    if (!singleBubble) {
      const toolNameById = new Map<string, string>()
      for (const m of msgs) {
        if (m.role === 'assistant' && (m as any).tool_calls) {
          for (const tc of (m as any).tool_calls || []) toolNameById.set(tc.id, tc.function?.name || '')
        }
      }
      for (const m of out) {
        if (m.role === 'tool') { const n = toolNameById.get((m as any).tool_call_id || ''); if (n) (m as any).toolName = n }
      }
    }
    return out
  })()

  const lastMsg = msgs.slice(-1)[0]
  const isGeneratingText = streaming && lastMsg?.role === 'assistant' && lastMsg?.content && lastMsg.content.length > 0
  // v0.2.3-fix(Q4): 单次遍历取最后 tool/assistant 时间戳, 不再三次全量 filter
  let lastToolT = 0, lastAsstT = 0
  for (const m of msgs) { if (m.role === 'tool') lastToolT = m.timestamp; else if (m.role === 'assistant') lastAsstT = m.timestamp }
  const isToolWorking = (streaming || executing) && lastToolT > 0 && lastToolT > lastAsstT

  const renderThinkingBubble = () => {
    const isActive = streaming || executing
    if (!isActive) return null
    if (isGeneratingText) return null // 已经有文字在流式输出
    // v0.2.3: 思考气泡内动态显示执行阶段 —— 思考中 → 🔧 调用 XX → ✓ 完成(任务结束气泡消失)
    // v0.2.3-fix(Q5): 仅显示当前会话的 stage(多会话并发不串台); 其他会话执行中显示通用「执行中」
    const myStage = stage && stage.sid === session?.id ? stage : null
    const phase = myStage?.phase || 'thinking'
    const label = myStage?.label || (isToolWorking ? '执行中' : '思考中')
    const detail = myStage?.detail || ''
    return (
      <div className="message-item message-assistant">
        <div className="message-avatar">{agentAvatarImg ? <img src={agentAvatarImg} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} alt="" /> : (agentAvatar || '泉')}</div>
        <div className="message-body">
          <div className="message-sender">黄泉</div>
          <div className="thinking-bubble" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{label}</span>
            {detail ? <span style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 2px)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span> : null}
            {phase === 'thinking' ? <span className="thinking-dots" /> : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="chat-header-tab">
        <button className={`tab-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => switchMode('chat')}>聊天</button>
        <button className={`tab-btn ${mode === 'work' ? 'active' : ''}`} onClick={() => switchMode('work')}>工作</button>
        {workDir && mode === 'work' && <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }} title={workDir}>📁 {workDir.split(/[/\\]/).pop()}</span>}
      </div>

      {!hasProvider ? (
        <div className="chat-center-empty">
          <div className="avatar-hex">{agentAvatarImg ? <img src={agentAvatarImg} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} alt="" /> : (agentAvatar || '泉')}</div><h1>黄泉Agent</h1><p>请先添加 API Provider</p>
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => onNavigate('settings')}>前往设置</button>
        </div>
      ) : !session || msgs.length === 0 ? (
        <div className="chat-center-empty">
          <div className="avatar-hex">{agentAvatarImg ? <img src={agentAvatarImg} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} alt="" /> : (agentAvatar || '泉')}</div><h1>黄泉Agent</h1>
          <p>{mode === 'chat' ? '雨停了没多久。你是循着声音来的，还是碰巧路过？' : '需要什么操作？'}</p>
          <span className="memory-badge">{mode === 'chat' ? '◇ 聊天模式' : '◇ 工作模式'}</span>
        </div>
      ) : (
        <>
          <div className="message-list">
            {displayMsgs.map(msg => (<MessageItem key={msg.id} message={msg} streaming={streaming} />))}
            {renderThinkingBubble()}
            <div ref={endRef} />
          </div>
          {error && <div className="error-bar"><span>{error}</span><button onClick={() => useChatStore.setState({ error: null })}>×</button></div>}
        </>
      )}
      {hasProvider && <ChatInput />}
    </>
  )
}
