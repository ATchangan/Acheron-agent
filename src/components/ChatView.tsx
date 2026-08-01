import React, { useEffect, useRef } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import MessageItem from './MessageItem'
import ChatInput from './ChatInput'

export default function ChatView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const session = useChatStore(s => s.cur())
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const error = useChatStore(s => s.error)
  const setMode = useChatStore(s => s.setMode)
  const providers = useSettingsStore(s => s.providers)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const workDir = useSettingsStore(s => s.general.workDir)
  const agentAvatar = useSettingsStore(s => s.general.agentAvatar)
  const agentAvatarImg = useSettingsStore(s => s.general.agentAvatarImage)
  const endRef = useRef<HTMLDivElement>(null)
  const hasProvider = providers.length > 0 && providers[0].apiKey

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [session?.messages])

  const switchMode = (m: string) => { if (m !== mode) setMode(m) }

  // 消息过滤：单气泡模式下隐藏 tool 角色和纯 tool_calls 消息；多气泡模式下全部展示
  const msgs = session?.messages || []
  const singleBubble = (useSettingsStore.getState().general as any).singleBubble !== false
  // v0.2.1: 单气泡终极过滤 —— 隐藏 tool/tool_calls/空消息，且连续 assistant 合并为单条（UI 层兜底，杜绝多气泡）
  const displayMsgs = (() => {
    const out: typeof msgs = []
    for (const m of msgs) {
      if (m.role === 'tool') { if (!singleBubble) out.push(m); continue }
      if (m.role === 'assistant' && (m as any).tool_calls && !m.content) { if (!singleBubble) out.push(m); continue }
      if (m.role === 'assistant' && !m.content && !(m as any).tool_calls) continue
      if (singleBubble && m.role === 'assistant' && out.length > 0 && out[out.length - 1].role === 'assistant') {
        // 连续 assistant → 内容合并进上一条（单气泡）
        const prev = out[out.length - 1]
        const merged = ((prev.content || '') + '\n\n' + (m.content || '')).trim()
        out[out.length - 1] = { ...prev, content: merged }
      } else out.push(m)
    }
    return out
  })()

  const lastMsg = msgs.slice(-1)[0]
  const isGeneratingText = streaming && lastMsg?.role === 'assistant' && lastMsg?.content && lastMsg.content.length > 0
  const isToolWorking = (streaming || executing) && msgs.filter(m => m.role === 'tool').length > 0 &&
    msgs.filter(m => m.role === 'tool').slice(-1)[0]?.timestamp > (msgs.filter(m => m.role === 'assistant').slice(-1)[0]?.timestamp || 0)

  const renderThinkingBubble = () => {
    const isActive = streaming || executing
    if (!isActive) return null
    if (isGeneratingText) return null // 已经有文字在流式输出
    const label = isToolWorking ? '执行中' : '思考中'
    return (
      <div className="message-item message-assistant">
        <div className="message-avatar">{agentAvatarImg ? <img src={agentAvatarImg} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} alt="" /> : (agentAvatar || '泉')}</div>
        <div className="message-body">
          <div className="message-sender">黄泉</div>
          <div className="thinking-bubble">
            <span>{label}</span>
            <span className="thinking-dots" />
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
        {workDir && mode === 'work' && <span style={{ fontSize: 10, color: '#9999AA', marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }} title={workDir}>📁 {workDir.split(/[/\\]/).pop()}</span>}
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
