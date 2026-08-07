import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import ChatInput from './ChatInput'
import { ConversationTurn, ThinkingRow } from './ConversationThread'
import { isNearBottom, latestAssistantText } from '../store/chat-view-utils'
import type { Message } from '../global'
import { U } from './ui-styles'


// 单条消息渲染错误边界: 某条消息渲染异常时降级为纯文本, 防止拖垮整个渲染进程
class MsgBoundary extends React.Component<{ children: React.ReactNode }, { err: boolean }> {
  state = { err: false }
  static getDerivedStateFromError() { return { err: true } }
  componentDidCatch(e: unknown) { console.error('[MsgBoundary]', e) }
  render() {
    if (this.state.err) {
      return <div className="hq-msg-error">这条消息渲染异常，已折叠显示</div>
    }
    return this.props.children
  }
}

// 回合制: 用户气泡 + 其后助手内容
type Turn = { id: string; user?: Message; blocks: Message[] }

export default function ChatView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const session = useChatStore(s => s.cur())
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const stage = useChatStore(s => s.stage)
  const error = useChatStore(s => s.error)
  const activeAgents = useChatStore(s => s.activeAgents)
  const orphanTasks = useChatStore(s => s.orphanTasks)
  const restoreTask = useChatStore(s => s.restoreTask)
  const planPendingMap = useChatStore(s => s.planPending)
  const planPending = session ? planPendingMap[session.id] : undefined
  const streamingText = useChatStore(s => !!s.streamText)
  const streamText = useChatStore(s => s.streamText)
  const setMode = useChatStore(s => s.setMode)
  const providers = useSettingsStore(s => s.providers)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const workDir = useSettingsStore(s => s.general.workDir)
  const endRef = useRef<HTMLDivElement>(null)
  const listBox = useRef({ el: null as HTMLDivElement | null })
  const rafScroll = useRef<number | null>(null)
  // 跟随滚动：发送指令后强制回到底部并跟随输出最后一行；用户手动上滑后停止跟随
  const followRef = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [copiedLast, setCopiedLast] = useState(false)
  const hasProvider = providers.some(p => p.apiKey)

  const syncScrollBtn = useCallback(() => {
    const list = listBox.current.el
    if (!list) return
    const nb = isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight)
    followRef.current = nb
    setShowScrollBtn(!nb)
  }, [])

  const setListRef = useCallback((el: HTMLDivElement | null) => {
    if (listBox.current.el === el) return
    if (listBox.current.el) listBox.current.el.removeEventListener('scroll', syncScrollBtn)
    listBox.current.el = el
    if (el) el.addEventListener('scroll', syncScrollBtn, { passive: true })
  }, [syncScrollBtn])

  const copyLastReply = async () => {
    const live = useChatStore.getState().streamText
    const target = (live && live.trim()) ? live : lastReply
    if (!target) return
    try {
      if (navigator.clipboard && document.hasFocus()) {
        await navigator.clipboard.writeText(target)
      } else {
        throw new Error('clipboard-unavailable')
      }
    } catch {
      const ta = document.createElement('textarea')
      ta.value = target
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    setCopiedLast(true)
    setTimeout(() => setCopiedLast(false), 1500)
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

  useEffect(() => {
    const list = listBox.current.el
    if (!list) return
    if (followRef.current) {
      if (rafScroll.current !== null) cancelAnimationFrame(rafScroll.current)
      rafScroll.current = requestAnimationFrame(() => {
        rafScroll.current = null
        list.scrollTop = list.scrollHeight
      })
    }
  }, [session?.messages, stage, streamText])
  useEffect(() => () => { if (rafScroll.current !== null) cancelAnimationFrame(rafScroll.current) }, [])

  // 发送指令后：恢复跟随并强制回到底部（用户上滑后再次发送，也重新跟随）
  useEffect(() => {
    const onFollow = () => {
      followRef.current = true
      const list = listBox.current.el
      if (list) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight })
    }
    window.addEventListener('huangquan-follow-scroll', onFollow)
    return () => window.removeEventListener('huangquan-follow-scroll', onFollow)
  }, [])

  const switchMode = (m: string) => { if (m !== mode) setMode(m) }

  const msgs = session?.messages || []
  useEffect(() => {
    const list = listBox.current.el
    if (!list) return
    if (!isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight)) setShowScrollBtn(true)
  }, [msgs.length, stage])

  const lastReply = latestAssistantText(msgs, '')

  // 工具结果映射: call_id -> 结果内容 (工具行展开用)
  const toolResults = React.useMemo(() => {
    const map = new Map<string, { content: string; timestamp: number }>()
    for (const m of msgs) if (m.role === 'tool' && m.tool_call_id) map.set(m.tool_call_id, { content: m.content || '', timestamp: m.timestamp })
    return map
  }, [msgs])

  // 回合构建: 用户消息开新回合, 其后 assistant 内容(含工具步骤/最终回复/流式占位)依次平铺
  const turns = React.useMemo(() => {
    const out: Turn[] = []
    let cur: Turn | null = null
    for (const m of msgs) {
      if (m.role === 'user') {
        cur = { id: m.id, user: m, blocks: [] }
        out.push(cur)
        continue
      }
      if (m.role === 'assistant') {
        if (!cur) { cur = { id: 'lead-' + m.id, blocks: [] }; out.push(cur) }
        cur.blocks.push(m)
        continue
      }
      // tool 结果已折叠进 toolResults, 不单独占一行
      if (!cur) { cur = { id: 'tail-' + m.id, blocks: [] }; out.push(cur) }
    }
    return out
  }, [msgs])

  const streamingPlaceholder = msgs.some(m => m._streaming)
  const lastMsg = msgs.slice(-1)[0]
  const isGeneratingText = streaming && !!lastMsg?.content && lastMsg.content.length > 0
  let lastToolT = 0, lastAsstT = 0
  for (const m of msgs) { if (m.role === 'tool') lastToolT = m.timestamp; else if (m.role === 'assistant') lastAsstT = m.timestamp }
  const isToolWorking = (streaming || executing) && lastToolT > 0 && lastToolT > lastAsstT

  // 思考状态行: 仅在没有流式文字、且阶段为 thinking 时出现
  const renderThinkingRow = () => {
    const isActive = streaming || executing
    if (!isActive) return null
    if (streamingText || streamingPlaceholder) return null
    if (isGeneratingText) return null
    const myStage = stage && stage.sid === session?.id ? stage : null
    const phase = myStage?.phase || (isToolWorking ? 'tool' : 'thinking')
    if (phase === 'tool') return null
    return (
      <ThinkingRow
        label={myStage?.label || '思考中'}
        detail={myStage?.detail || ''}
      />
    )
  }

  return (
    <>
      <div className="chat-header-tab">
        <button className={`tab-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => switchMode('chat')}>聊天</button>
        <button className={`tab-btn ${mode === 'work' ? 'active' : ''}`} onClick={() => switchMode('work')}>工作</button>
        {workDir && mode === 'work' && <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }} title={workDir}>📁 {workDir.split(/[/\\]/).pop()}</span>}
        {(streaming || executing) && activeAgents.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8, flexWrap: 'wrap' }}>
            {activeAgents.map(a => (
              <span key={a} style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 'calc(var(--ui-font-size) - 3px)', background: 'rgba(var(--skin-accent),.12)', border: '1px solid rgba(var(--skin-accent),.28)', borderRadius: 10, padding: '1px 8px' }}>◉ {a}</span>
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

      {planPending && (
        <div className="error-bar" style={U.wrap8}>
          <span style={U.b600}>执行计划确认：</span>
          <span style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={planPending.summary}>{planPending.summary || '模型准备调用工具执行任务'}</span>
          {planPending.steps.slice(0, 4).map((s, i) => (
            <span key={i} style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', background: 'rgba(var(--skin-accent),.10)', border: '1px solid rgba(var(--skin-accent),.25)', borderRadius: 10, padding: '1px 8px' }}>{s.tool}</span>
          ))}
          {planPending.steps.length > 4 && <span style={U.textMuted}>…</span>}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <button className="tab-btn" style={U.px12} onClick={async () => { await window.huangquan.engine.reject(session!.id); useChatStore.setState(s => { const pp = { ...s.planPending }; delete pp[session!.id]; return { planPending: pp } }) }}>拒绝</button>
            <button className="tab-btn active" style={U.px12} onClick={async () => { await window.huangquan.engine.approve(session!.id); useChatStore.setState(s => { const pp = { ...s.planPending }; delete pp[session!.id]; return { planPending: pp } }) }}>批准执行</button>
          </span>
        </div>
      )}

      {!hasProvider ? (
        <div className="chat-center-empty">
          <h1>黄泉</h1><p>请先在「模型服务」中配置一个服务商</p>
          <button className="btn-primary" style={U.mt8} onClick={() => onNavigate('settings')}>前往设置</button>
        </div>
      ) : !session || msgs.length === 0 ? (
        <div className="chat-center-empty">
          <h1>黄泉</h1>
          <p>{mode === 'chat' ? '雨停了没多久。你是循着声音来的，还是碰巧路过？' : '说吧，这次要处理什么？'}</p>
          <span className="memory-badge">{mode === 'chat' ? '◉ 聊天模式' : '◉ 工作模式'}</span>
        </div>
      ) : (
        <>
          <div className="chat-messages-wrap">
            <div className="message-list hq-thread-viewport" ref={setListRef}>
              <div className="hq-thread-content">
                {turns.map(turn => (
                  <MsgBoundary key={turn.id}>
                    <ConversationTurn
                      user={turn.user}
                      blocks={turn.blocks}
                      toolResults={toolResults}
                      executing={executing}
                    />
                  </MsgBoundary>
                ))}
                {renderThinkingRow()}
                <div ref={endRef} />
              </div>
            </div>
            {showScrollBtn && (
              <button className="chat-fab chat-scroll-btn" title="回到底部" onClick={() => {
                const list = listBox.current.el
                followRef.current = true
                if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
              }}>↓</button>
            )}
            {lastReply && (
              <button className={`chat-fab chat-copy-last-btn${copiedLast ? ' copied' : ''}`}
                title={copiedLast ? '已复制最后回复' : '复制最后回复（原文 Markdown）'} onClick={copyLastReply}>
                {copiedLast ? '✓' : '⧉'}
              </button>
            )}
          </div>
          {error && (
            <div className="error-bar">
              <span>{error}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <button className="tab-btn" style={{ padding: '1px 12px', fontSize: 'calc(var(--ui-font-size) - 2px)' }} onClick={retryLast}>重试</button>
                <button onClick={() => useChatStore.setState({ error: null })}>×</button>
              </span>
            </div>
          )}
        </>
      )}
      {hasProvider && <ChatInput />}
    </>
  )
}
