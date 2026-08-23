import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import ChatInput from './ChatInput'
import MessageList from './MessageList'
import { U } from './ui-styles'

// v0.3.6 P0-1: ChatView 只负责头部/空态/错误/输入区,
// 消息列表与流式渲染完全下沉到 MessageList, 不再订阅 streamText。
export default function ChatView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const error = useChatStore(s => s.error)
  const errorStep = useChatStore(s => s.errorStep)
  const orphanTasks = useChatStore(s => s.orphanTasks)
  const restoreTask = useChatStore(s => s.restoreTask)
  const sessionId = useChatStore(s => s.cur()?.id ?? null)
  const msgCount = useChatStore(s => s.cur()?.messages.length ?? 0)
  const providers = useSettingsStore(s => s.providers)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const hasProvider = providers.some(p => p.apiKey)
  const jumpToMsg = (mid: string) => {
    const el = document.querySelector(`[data-message-id="${mid}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const retryLast = async () => {
    useChatStore.setState({ error: null })
    const cur = useChatStore.getState().cur()
    if (!cur || cur.streaming || cur.busy) return
    for (let i = cur.messages.length - 1; i >= 0; i--) {
      const m = cur.messages[i]
      if (m.role === 'user') { await useChatStore.getState().resendFrom(m.id); return }
    }
  }

  const empty = !sessionId || msgCount === 0

  return (
    <>
      {orphanTasks.length > 0 && (
        <div className="error-bar" style={U.wrap8}>
          <span>上次退出时有 {orphanTasks.length} 个任务未完成：</span>
          {orphanTasks.slice(0, 3).map(t => (
            <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.content}>{String(t.content || '').slice(0, 40)}</span>
              {t.planProgress && <span style={U.textMuted}>已完成 {t.planProgress}</span>}
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

      {!hasProvider ? (
        <div className="chat-center-empty">
          <h1>Acheron-Agent</h1><p>请先在「模型服务」中配置一个服务商</p>
          <button className="btn-primary" style={U.mt8} onClick={() => onNavigate('settings')}>前往设置</button>
        </div>
      ) : empty ? (
        <div className="chat-center-empty">
          <img src="huangquan.png" alt="黄泉" style={{ width: 190, height: 190, objectFit: 'contain', pointerEvents: 'none', opacity: .92, filter: 'drop-shadow(0 10px 26px rgba(0,0,0,.4))' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <h1>Acheron-Agent</h1>
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
            {errorStep?.messageId && <button className="tab-btn" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={() => jumpToMsg(errorStep.messageId!)}>定位失败步骤</button>}
            <button className="tab-btn" style={{ padding: '1px 12px', fontSize: 'calc(var(--ui-font-size) - 2px)' }} onClick={retryLast}>重试</button>
            <button onClick={() => useChatStore.setState({ error: null })}>×</button>
          </span>
        </div>
      )}
      {hasProvider && <ChatInput />}
    </>
  )
}
