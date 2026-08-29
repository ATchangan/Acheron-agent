import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import { Bot } from 'lucide-react'
import ChatInput from './ChatInput'
import MessageList from './MessageList'
import { U } from './ui-styles'
import DaySummary from './DaySummary'

// Bot 会话空态: 与侧栏 BOTS 一致的彩色圆角头像 + 角色名（对齐参考 的 Bot 对话首页）
const AVATAR_COLORS = ['#7c6fc4', '#4f8cff', '#4fae7e', '#e0a458', '#e0526e', '#37d0c8', '#9aa3b2']
function botColor(role: string): string {
  try {
    const m = JSON.parse(localStorage.getItem('hq_bots_meta') || '{}') as Record<string, { color?: string }>
    if (m[role]?.color) return m[role].color as string
  } catch { /* 忽略 */ }
  let h = 0
  for (const c of role) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// v0.3.6 P0-1: ChatView 只负责头部/空态/错误/输入区,
// 消息列表与流式渲染完全下沉到 MessageList, 不再订阅 streamText。
export default function ChatView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const error = useChatStore(s => s.error)
  const errorStep = useChatStore(s => s.errorStep)
  const orphanTasks = useChatStore(s => s.orphanTasks)
  const restoreTask = useChatStore(s => s.restoreTask)
  const sessionId = useChatStore(s => s.cur()?.id ?? null)
  const session = useChatStore(s => s.cur())
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
      <DaySummary />
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
          <h1 className="archeron-greet-name">Acheron-Agent</h1>
          <p className="archeron-greet-sub">还差一步：在 设置 → 供应商 中配置一个模型服务商，就可以开始工作了。</p>
          <button className="btn-primary" style={U.mt8} onClick={() => onNavigate('settings')}>前往设置</button>
        </div>
      ) : empty ? (
        session?.agent ? (
          <div className="chat-center-empty">
            <span className="archeron-bot-avatar" style={{ background: botColor(session.agent) }}>
              <Bot size={36} />
            </span>
            <h1 className="archeron-greet-name">{session.agent}</h1>
            <p className="archeron-greet-sub">说点什么开始吧。</p>
          </div>
        ) : (
          <div className="chat-center-empty">
            <div className="archeron-greet-avatar">
              <img src="huangquan.png" alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
            <h1 className="archeron-greet-name">Acheron-Agent</h1>
            <p className="archeron-greet-sub">
              {mode === 'chat'
                ? '想聊什么，坐下来慢慢说。'
                : '告诉我目标，机械的部分交给我。'}
            </p>
          </div>
        )
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
