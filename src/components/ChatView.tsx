import React from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import ChatInput from './ChatInput'
import MessageList from './MessageList'
import { U } from './ui-styles'

// v0.3.6 P0-1: ChatView 只负责头部/空态/错误/输入区,
// 消息列表与流式渲染完全下沉到 MessageList, 不再订阅 streamText。
export default function ChatView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const error = useChatStore(s => s.error)
  const activeAgents = useChatStore(s => s.activeAgents)
  const orphanTasks = useChatStore(s => s.orphanTasks)
  const restoreTask = useChatStore(s => s.restoreTask)
  const planPendingMap = useChatStore(s => s.planPending)
  const sessionId = useChatStore(s => s.cur()?.id ?? null)
  const msgCount = useChatStore(s => s.cur()?.messages.length ?? 0)
  const planPending = sessionId ? planPendingMap[sessionId] : undefined
  const setMode = useChatStore(s => s.setMode)
  const providers = useSettingsStore(s => s.providers)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const workDir = useSettingsStore(s => s.general.workDir)
  const hasProvider = providers.some(p => p.apiKey)

  const retryLast = async () => {
    useChatStore.setState({ error: null })
    const cur = useChatStore.getState().cur()
    if (!cur || cur.streaming || cur.busy) return
    for (let i = cur.messages.length - 1; i >= 0; i--) {
      const m = cur.messages[i]
      if (m.role === 'user') { await useChatStore.getState().resendFrom(m.id); return }
    }
  }

  const switchMode = (m: string) => { if (m !== mode) setMode(m) }
  const empty = !sessionId || msgCount === 0

  return (
    <>
      <div className="chat-header-tab">
        <button className={`tab-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => switchMode('chat')}>聊天</button>
        <button className={`tab-btn ${mode === 'work' ? 'active' : ''}`} onClick={() => switchMode('work')}>工作</button>
        {workDir && mode === 'work' && <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }} title={workDir}>📁 {workDir.split(/[/\\]/).pop()}</span>}
        {(streaming || executing) && activeAgents.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8, flexWrap: 'wrap' }}>
            {activeAgents.map(a => (
              <span key={a} style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 'calc(var(--ui-font-size) - 3px)', background: 'rgba(var(--skin-accent),.12)', border: '1px solid rgba(var(--skin-accent),.28)', borderRadius: 10, padding: '1px 8px' }}>● {a}</span>
            ))}
          </span>
        )}
      </div>

      {orphanTasks.length > 0 && (
        <div className="error-bar" style={U.wrap8}>
          <span>上次退出时有 {orphanTasks.length} 个任务未完成：</span>
          {orphanTasks.slice(0, 3).map(t => (
            <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.content}>{String(t.content || '').slice(0, 40)}</span>
              <button className="tab-btn active" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={() => restoreTask(t.id)}>恢复</button>
              <button className="tab-btn" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={async () => { await window.huangquan.tasks.finish(t.id, 'aborted', '用户忽略'); useChatStore.setState(s => ({ orphanTasks: s.orphanTasks.filter(x => x.id !== t.id) })) }}>忽略</button>
            </span>
          ))}
          {orphanTasks.length > 3 && <span style={U.textMuted}>…</span>}
          <button className="tab-btn" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)', marginLeft: 'auto' }} onClick={async () => {
            for (const t of orphanTasks) await window.huangquan.tasks.finish(t.id, 'aborted', '用户忽略').catch(() => {})
            useChatStore.setState({ orphanTasks: [] })
          }}>全部忽略</button>
        </div>
      )}

      {planPending && sessionId && (
        <div className="error-bar" style={U.wrap8}>
          <span style={U.b600}>执行计划确认：</span>
          <span style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={planPending.summary}>{planPending.summary || '模型准备调用工具执行任务'}</span>
          {planPending.steps.slice(0, 4).map((s, i) => (
            <span key={i} style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', background: 'rgba(var(--skin-accent),.10)', border: '1px solid rgba(var(--skin-accent),.25)', borderRadius: 10, padding: '1px 8px' }}>{s.tool}</span>
          ))}
          {planPending.steps.length > 4 && <span style={U.textMuted}>…</span>}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <button className="tab-btn" style={U.px12} onClick={async () => { await window.huangquan.engine.reject(sessionId); useChatStore.setState(s => { const pp = { ...s.planPending }; delete pp[sessionId]; return { planPending: pp } }) }}>拒绝</button>
            <button className="tab-btn active" style={U.px12} onClick={async () => { await window.huangquan.engine.approve(sessionId); useChatStore.setState(s => { const pp = { ...s.planPending }; delete pp[sessionId]; return { planPending: pp } }) }}>批准执行</button>
          </span>
        </div>
      )}

      {!hasProvider ? (
        <div className="chat-center-empty">
          <h1>黄泉</h1><p>请先在「模型服务」中配置一个服务商</p>
          <button className="btn-primary" style={U.mt8} onClick={() => onNavigate('settings')}>前往设置</button>
        </div>
      ) : empty ? (
        <div className="chat-center-empty">
          <h1>黄泉</h1>
          <p>{mode === 'chat' ? '雨停了没多久。你是循着声音来的，还是碰巧路过？' : '说吧，这次要处理什么？'}</p>
          <span className="memory-badge">{mode === 'chat' ? '● 聊天模式' : '● 工作模式'}</span>
        </div>
      ) : (
        <MessageList />
      )}
      {!empty && error && (
        <div className="error-bar">
          <span>{error}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <button className="tab-btn" style={{ padding: '1px 12px', fontSize: 'calc(var(--ui-font-size) - 2px)' }} onClick={retryLast}>重试</button>
            <button onClick={() => useChatStore.setState({ error: null })}>×</button>
          </span>
        </div>
      )}
      {hasProvider && <ChatInput />}
    </>
  )
}
