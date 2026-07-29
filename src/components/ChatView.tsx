import React, { useEffect, useRef } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import MessageItem from './MessageItem'
import ChatInput from './ChatInput'

export default function ChatView({ onNavigate }: { onNavigate: (v: any) => void }) {
  const session = useChatStore(s => s.cur())
  const streaming = useChatStore(s => s.streaming)
  const error = useChatStore(s => s.error)
  const providers = useSettingsStore(s => s.providers)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const setMode = useSettingsStore(s => s.setMode)
  const create = useChatStore(s => s.create)
  const endRef = useRef<HTMLDivElement>(null)

  const handleModeSwitch = async (m: string) => {
    if (m === mode) return
    setMode(m)
    const chatStore = useChatStore.getState()
    await chatStore.reloadPrompt()
    const modeSessions = chatStore.sessions.filter(s => (s.mode || 'work') === m)
    if (modeSessions.length > 0) chatStore.switchS(modeSessions[0].id)
    else chatStore.create()
  }
  const hasProvider = providers.length > 0 && providers[0].apiKey

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [session?.messages])

  return (
    <>
      <div className="chat-header-tab">
        <button className={`tab-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => handleModeSwitch('chat')}>聊天</button>
        <button className={`tab-btn ${mode === 'work' ? 'active' : ''}`} onClick={() => handleModeSwitch('work')}>工作</button>
        <div className="window-controls">
          <button onClick={() => window.huangquan.window.minimize()}>─</button>
          <button onClick={() => window.huangquan.window.maximize()}>□</button>
          <button className="win-close" onClick={() => window.huangquan.window.close()}>×</button>
        </div>
      </div>

      {!hasProvider ? (
        <div className="chat-center-empty">
          <div className="avatar-hex">泉</div>
          <h1>黄泉Agent</h1>
          <p>请先添加 API Provider</p>
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => onNavigate('settings')}>前往设置</button>
        </div>
      ) : !session || session.messages.length === 0 ? (
        <div className="chat-center-empty">
          <div className="avatar-hex">泉</div>
          <h1>黄泉Agent</h1>
          <p>{mode === 'chat' ? '雨停了没多久。你是循着声音来的，还是碰巧路过？' : '需要什么操作？'}</p>
          <span className="memory-badge">{mode === 'chat' ? '◇ 聊天模式' : '◇ 工作模式'}</span>
        </div>
      ) : (
        <>
          <div className="message-list">
            {session.messages.filter(m => m.content && m.role !== 'tool').map(msg => (
              <MessageItem key={msg.id} message={msg} />
            ))}
            <div ref={endRef} />
          </div>
          {error && <div className="error-bar"><span>{error}</span><button onClick={() => useChatStore.setState({ error: null })}>×</button></div>}
        </>
      )}
      {hasProvider && <ChatInput />}
    </>
  )
}
