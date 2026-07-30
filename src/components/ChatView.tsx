import React, { useEffect, useRef } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import MessageItem from './MessageItem'
import ChatInput from './ChatInput'

export default function ChatView({ onNavigate }: { onNavigate: (v: any) => void }) {
  const session = useChatStore(s => s.cur())
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const error = useChatStore(s => s.error)
  const setMode = useChatStore(s => s.setMode)
  const providers = useSettingsStore(s => s.providers)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const workDir = useSettingsStore(s => s.general.workDir)
  const endRef = useRef<HTMLDivElement>(null)
  const hasProvider = providers.length > 0 && providers[0].apiKey

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [session?.messages])

  const switchMode = (m: string) => { if (m !== mode) setMode(m) }

  // 判断当前状态：纯文本生成 vs 工具执行中
  const msgs = session?.messages || []
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
        <div className="message-avatar">泉</div>
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
          <div className="avatar-hex">泉</div><h1>黄泉Agent</h1><p>请先添加 API Provider</p>
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => onNavigate('settings')}>前往设置</button>
        </div>
      ) : !session || session.messages.length === 0 ? (
        <div className="chat-center-empty">
          <div className="avatar-hex">泉</div><h1>黄泉Agent</h1>
          <p>{mode === 'chat' ? '雨停了没多久。你是循着声音来的，还是碰巧路过？' : '需要什么操作？'}</p>
          <span className="memory-badge">{mode === 'chat' ? '◇ 聊天模式' : '◇ 工作模式'}</span>
        </div>
      ) : (
        <>
          <div className="message-list">
            {session.messages.filter(m => m.content && m.role !== 'tool').map(msg => (<MessageItem key={msg.id} message={msg} />))}
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