import React, { useEffect, useRef } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import MessageItem from './MessageItem'
import ChatInput from './ChatInput'

export default function ChatView({ onNavigate }: { onNavigate: (v: any) => void }) {
  const session = useChatStore(s => s.getCurrentSession())
  const streaming = useChatStore(s => s.streaming)
  const error = useChatStore(s => s.error)
  const providers = useSettingsStore(s => s.providers)
  const endRef = useRef<HTMLDivElement>(null)
  const hasProvider = providers.length > 0 && providers[0].apiKey

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [session?.messages])

  return (
    <>
      <div className="chat-header-tab">
        <button className="tab-btn active">聊天</button>
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
          <p>独行银河 · 巡海游侠</p>
          <span className="memory-badge">◇ 可以提问了</span>
        </div>
      ) : (
        <>
          <div className="message-list">
            {session.messages.filter(m => m.content && m.role !== 'tool').map(msg => (
              <MessageItem key={msg.id} message={msg} streaming={streaming && msg.role === 'assistant' && msg === session.messages.filter(m => m.content && m.role !== 'tool').slice(-1)[0]} />
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
