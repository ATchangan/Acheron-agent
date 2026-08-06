import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import MessageItem, { TaskGroupCard } from './MessageItem'
import ChatInput from './ChatInput'
import StreamingMarkdown from './StreamingMarkdown'
import { isNearBottom, latestAssistantText } from '../store/chat-view-utils'

// 单条消息渲染错误边界: 某条消息渲染异常时降级为纯文本, 防止拖垮整个渲染进程
class MsgBoundary extends React.Component<{ children: React.ReactNode }, { err: boolean }> {
  state = { err: false }
  static getDerivedStateFromError() { return { err: true } }
  componentDidCatch(e: unknown) { console.error('[MsgBoundary]', e) }
  render() {
    if (this.state.err) {
      return <div className="message-item" style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 2px)' }}>这条消息渲染异常，已折叠显示</div>
    }
    return this.props.children
  }
}

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
  const streamText = useChatStore(s => s.streamText)
  const setMode = useChatStore(s => s.setMode)
  const providers = useSettingsStore(s => s.providers)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const workDir = useSettingsStore(s => s.general.workDir)
  const endRef = useRef<HTMLDivElement>(null)
  const listBox = useRef({ el: null as HTMLDivElement | null })
  const rafScroll = useRef<number | null>(null)
  // v0.3.3: 流式 Markdown 90ms 节流渲染 —— 避免每个 chunk 全量重解析 markdown
  const [localStream, setLocalStream] = useState('')
  const streamTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // v0.3.3: 上翻时新内容到达 → 右下角「回到底部」按钮
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [copiedLast, setCopiedLast] = useState(false)
  // 任一供应商已配置即可对话(原只检查 providers[0], 首个无 key 的供应商会挡住全部)
  const hasProvider = providers.some(p => p.apiKey)

  // 流式文字节流: 流式中最多每 90ms 更新一次本地渲染副本, 停止/结束时立即对齐最新值
  useEffect(() => {
    if (streaming && streamText) {
      if (!streamTimer.current) {
        streamTimer.current = setTimeout(() => {
          streamTimer.current = null
          setLocalStream(streamText)
        }, 90)
      }
    } else {
      if (streamTimer.current) { clearTimeout(streamTimer.current); streamTimer.current = null }
      setLocalStream(streamText)
    }
  }, [streamText, streaming])
  useEffect(() => () => { if (streamTimer.current) clearTimeout(streamTimer.current) }, [])

  // 滚动监听: 离开底部时显示回到底部按钮, 贴底自动隐藏
  const syncScrollBtn = useCallback(() => {
    const list = listBox.current.el
    if (!list) return
    setShowScrollBtn(!isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight))
  }, [])
  // 回调 ref 挂载/卸载滚动监听 —— 消息列表晚于组件挂载(欢迎页无列表),
  // 固定 effect 在首次执行时拿不到元素, 之后不会重跑, 会永久漏挂监听
  const setListRef = useCallback((el: HTMLDivElement | null) => {
    if (listBox.current.el === el) return
    if (listBox.current.el) listBox.current.el.removeEventListener('scroll', syncScrollBtn)
    listBox.current.el = el
    if (el) el.addEventListener('scroll', syncScrollBtn, { passive: true })
  }, [syncScrollBtn])
  // 复制最后一条完整回复(流式中复制当前内容)
  const copyLastReply = async () => {
    if (!lastReply) return
    try {
      if (navigator.clipboard && document.hasFocus()) {
        await navigator.clipboard.writeText(lastReply)
      } else {
        throw new Error('clipboard-unavailable')
      }
    } catch {
      const ta = document.createElement('textarea')
      ta.value = lastReply
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch (e) { /* ignore */ console.debug('[swallow]', e) }
      document.body.removeChild(ta)
    }
    setCopiedLast(true)
    setTimeout(() => setCopiedLast(false), 1500)
  }

  // 错误重试: 清空错误态并从最后一条用户消息重新执行
  const retryLast = async () => {
    useChatStore.setState({ error: null })
    const cur = useChatStore.getState().cur()
    if (!cur || cur.streaming || cur.busy) return
    for (let i = cur.messages.length - 1; i >= 0; i--) {
      const m = cur.messages[i]
      if (m.role === 'user') { await useChatStore.getState().resendFrom(m.id); return }
    }
  }

  // 仅在接近底部时自动滚动: 直接定位(无 smooth 动画), rAF 合并 ——
  // 流式高频更新时 smooth 动画会排队堆积, 造成滚动卡顿
  useEffect(() => {
    const el = endRef.current
    if (!el) return
    const list = el.parentElement
    if (!list) return
    const nearBottom = isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight)
    if (nearBottom) {
      if (rafScroll.current !== null) cancelAnimationFrame(rafScroll.current)
      rafScroll.current = requestAnimationFrame(() => {
        rafScroll.current = null
        list.scrollTop = list.scrollHeight
      })
    }
  }, [session?.messages, stage])
  useEffect(() => () => { if (rafScroll.current !== null) cancelAnimationFrame(rafScroll.current) }, [])

  const switchMode = (m: string) => { if (m !== mode) setMode(m) }

  // 消息过滤：工作步骤卡片(assistant+tool_calls)始终显示；tool 结果在单气泡模式折叠进卡片、多气泡模式单独展示
  const msgs = session?.messages || []
  // v0.3.3: 新内容/状态到达时若用户已上翻 → 亮出回到底部按钮
  useEffect(() => {
    const list = listBox.current.el
    if (!list) return
    if (!isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight)) setShowScrollBtn(true)
  }, [msgs.length, streamText, stage])

  // v0.3.3: 复制最后一条完整回复(流式中复制当前内容)
  const lastReply = latestAssistantText(msgs, streamText || '')
  const singleBubble = useSettingsStore.getState().general.singleBubble !== false
  // 单气泡过滤 —— 步骤卡片(assistant+tool_calls)保留，tool 结果折叠进卡片，连续 assistant 合并为单条
  const displayMsgs = React.useMemo(() => {
    const out: typeof msgs = []
    for (const m of msgs) {
      // 工作步骤卡片: 模型生成的步骤说明 + 工具 chips 实时状态
      if (m.role === 'assistant' && m.tool_calls) { out.push(m); continue }
      if (m.role === 'tool') { if (!singleBubble) out.push(m); continue }
      if (m.role === 'assistant' && !m.content && !m.tool_calls) continue
      if (singleBubble && m.role === 'assistant' && !m.tool_calls && out.length > 0 &&
        out[out.length - 1].role === 'assistant' && !out[out.length - 1].tool_calls) {
        // 连续 assistant → 内容合并进上一条（单气泡, 卡片消息不参与合并）
        const prev = out[out.length - 1]
        const merged = ((prev.content || '') + '\n\n' + (m.content || '')).trim()
        out[out.length - 1] = { ...prev, content: merged }
      } else out.push(m)
    }
    // 工具名关联只对多气泡模式有意义, 注入移到 MessageItem 外循环之后仍保持简单
    if (!singleBubble) {
      const toolNameById = new Map<string, string>()
      for (const m of msgs) {
        if (m.role === 'assistant' && m.tool_calls) {
          for (const tc of m.tool_calls || []) toolNameById.set(tc.id || '', tc.function?.name || '')
        }
      }
      for (const m of out) {
        if (m.role === 'tool') { const n = toolNameById.get(m.tool_call_id || ''); if (n) m.toolName = n }
      }
    }
    return out
  }, [msgs, singleBubble])

  // 工具结果映射: call_id -> 结果内容 —— 步骤卡片 chips 的完成/失败状态与可展开详情
  const toolResults = React.useMemo(() => {
    const map = new Map<string, { content: string; timestamp: number }>()
    for (const m of msgs) if (m.role === 'tool' && m.tool_call_id) map.set(m.tool_call_id, { content: m.content || '', timestamp: m.timestamp })
    return map
  }, [msgs])

  // 任务级分组 —— 同一任务(用户消息之间)的连续步骤卡片合并为一张「任务进程卡」
  // 仅单气泡模式生效(多气泡模式用户已选择逐条展示); 组内吸收中间说明与残留 tool 消息,
  // 最终回复(组末 assistant 无 tool_calls 有内容)在渲染时弹出为独立消息
  const groups = React.useMemo(() => {
    type G = { type: 'single'; msg: (typeof msgs)[number] } | { type: 'task'; msgs: (typeof msgs)[number][] }
    if (!singleBubble) return displayMsgs.map(msg => ({ type: 'single', msg }) as G)
    const out: G[] = []
    let cur: (typeof msgs)[number][] | null = null
    const flush = () => { if (cur) { out.push({ type: 'task', msgs: cur }); cur = null } }
    for (const m of displayMsgs) {
      if (m.role === 'user') { flush(); out.push({ type: 'single', msg: m }); continue }
      if (m.role === 'assistant') {
        if (m.tool_calls?.length) { (cur || (cur = [])).push(m); continue }
        if (cur) { cur.push(m); continue } // 中间说明或最终回复: 先收进组, 渲染时弹出最终回复
        out.push({ type: 'single', msg: m }); continue
      }
      if (cur) cur.push(m) // tool 等消息吸收进组(组内不渲染, 结果已由 chips 展示)
      else out.push({ type: 'single', msg: m })
    }
    flush()
    return out
  }, [displayMsgs, singleBubble])

  // 当前任务(最后一条 user 消息之后)是否已有步骤卡片 —— 有则思考状态由任务进程卡承担, 不再闪独立气泡
  const hasCardInTask = React.useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role === 'user') break
      if (m.role === 'assistant' && m.tool_calls?.length) return true
    }
    return false
  }, [msgs])

  const lastMsg = msgs.slice(-1)[0]
  const isGeneratingText = streaming && lastMsg?.role === 'assistant' && lastMsg?.content && lastMsg.content.length > 0
  // 单次遍历取最后 tool/assistant 时间戳, 不再三次全量 filter
  let lastToolT = 0, lastAsstT = 0
  for (const m of msgs) { if (m.role === 'tool') lastToolT = m.timestamp; else if (m.role === 'assistant') lastAsstT = m.timestamp }
  const isToolWorking = (streaming || executing) && lastToolT > 0 && lastToolT > lastAsstT

  const renderThinkingBubble = () => {
    const isActive = streaming || executing
    if (!isActive) return null
    // v0.3.3: 引擎临时流式文字 —— 不落消息, 由 step/final 事件承载最终内容
    if (streamText) {
      return (
        <div className="message-item message-assistant">
          <div className="message-body">
            {/* v0.3.3: 流式回复 Markdown 实时渲染, 末尾闪烁光标 */}
            <div className="message-content stream-markdown">
              <div className="markdown-body">
                <StreamingMarkdown text={localStream || streamText} />
              </div>
              {streaming && <span className="stream-cursor">▍</span>}
            </div>
          </div>
        </div>
      )
    }
    if (isGeneratingText) return null // 已经有文字在流式输出
    // 仅显示当前会话的 stage(多会话并发不串台); 其他会话执行中显示通用「执行中」
    const myStage = stage && stage.sid === session?.id ? stage : null
    // 工具执行阶段由步骤卡片承担实时状态, 思考气泡只在「思考中」阶段显示
    const phase = myStage?.phase || (isToolWorking ? 'tool' : 'thinking')
    if (phase === 'tool') return null
    // 任务已有步骤卡片: 思考状态由任务进程卡头部承担, 不再闪独立气泡(大幅减少气泡数量)
    if (singleBubble && hasCardInTask) return null
    const label = myStage?.label || '思考中'
    const detail = myStage?.detail || ''
    return (
      <div className="message-item message-assistant">
        <div className="message-body">
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
        {(streaming || executing) && activeAgents.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8, flexWrap: 'wrap' }}>
            {activeAgents.map(a => (
              <span key={a} style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 'calc(var(--ui-font-size) - 3px)', background: 'rgba(var(--skin-accent),.12)', border: '1px solid rgba(var(--skin-accent),.28)', borderRadius: 10, padding: '1px 8px' }}>◉ {a}</span>
            ))}
          </span>
        )}
      </div>

      {/* v0.3.3: 中断任务恢复横幅 */}
      {orphanTasks.length > 0 && (
        <div className="error-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span>上次退出时有 {orphanTasks.length} 个任务未完成：</span>
          {orphanTasks.slice(0, 3).map(t => (
            <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.content}>「{(t.content || '').slice(0, 40)}」</span>
              <button className="tab-btn active" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={() => restoreTask(t.id)}>恢复</button>
              <button className="tab-btn" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={async () => { await window.huangquan.tasks.finish(t.id, 'aborted', '用户忽略'); useChatStore.setState(s => ({ orphanTasks: s.orphanTasks.filter(x => x.id !== t.id) })) }}>忽略</button>
            </span>
          ))}
          {orphanTasks.length > 3 && <span style={{ color: 'var(--text-muted)' }}>…</span>}
          <button className="tab-btn" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)', marginLeft: 'auto' }} onClick={async () => {
            for (const t of orphanTasks) await window.huangquan.tasks.finish(t.id, 'aborted', '用户忽略').catch(() => {})
            useChatStore.setState({ orphanTasks: [] })
          }}>全部忽略</button>
        </div>
      )}

      {/* v0.3.3: 计划确认门(Claude/Cursor 风格) —— 首次工具调用前等用户批准 */}
      {planPending && (
        <div className="error-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>执行计划确认：</span>
          <span style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={planPending.summary}>{planPending.summary || '模型准备调用工具执行任务'}</span>
          {planPending.steps.slice(0, 4).map((s, i) => (
            <span key={i} style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', background: 'rgba(var(--skin-accent),.10)', border: '1px solid rgba(var(--skin-accent),.25)', borderRadius: 10, padding: '1px 8px' }}>{s.tool}</span>
          ))}
          {planPending.steps.length > 4 && <span style={{ color: 'var(--text-muted)' }}>…</span>}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <button className="tab-btn" style={{ padding: '1px 12px' }} onClick={async () => { await window.huangquan.engine.reject(session!.id); useChatStore.setState(s => { const pp = { ...s.planPending }; delete pp[session!.id]; return { planPending: pp } }) }}>拒绝</button>
            <button className="tab-btn active" style={{ padding: '1px 12px' }} onClick={async () => { await window.huangquan.engine.approve(session!.id); useChatStore.setState(s => { const pp = { ...s.planPending }; delete pp[session!.id]; return { planPending: pp } }) }}>批准执行</button>
          </span>
        </div>
      )}

      {!hasProvider ? (
        <div className="chat-center-empty">
          <h1>黄泉</h1><p>请先在「模型服务」中配置一个服务商</p>
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => onNavigate('settings')}>前往设置</button>
        </div>
      ) : !session || msgs.length === 0 ? (
        <div className="chat-center-empty">
          <h1>黄泉</h1>
          <p>{mode === 'chat' ? '雨停了没多久。你是循着声音来的，还是碰巧路过？' : '说吧，这次要处理什么？'}</p>
          <span className="memory-badge">{mode === 'chat' ? '◇ 聊天模式' : '◇ 工作模式'}</span>
        </div>
      ) : (
        <>
          <div className="chat-messages-wrap">
            <div className="message-list" ref={setListRef}>
              {groups.map((g, gi) => {
                if (g.type === 'single') {
                  return <MsgBoundary key={g.msg.id}><MessageItem message={g.msg} streaming={streaming} toolResults={toolResults} executing={executing} /></MsgBoundary>
                }
                // 任务组: 组末 assistant 无 tool_calls 且有内容 → 视为最终回复弹出单独渲染(保留操作按钮)
                const last = g.msgs[g.msgs.length - 1]
                const isFinalReply = last.role === 'assistant' && !last.tool_calls?.length && !!last.content
                const steps = isFinalReply ? g.msgs.slice(0, -1) : g.msgs
                return (
                  <React.Fragment key={'task-' + gi}>
                    <MsgBoundary><TaskGroupCard steps={steps} toolResults={toolResults} executing={executing} active={executing && gi === groups.length - 1} /></MsgBoundary>
                    {isFinalReply && <MsgBoundary key={last.id}><MessageItem message={last} streaming={streaming} toolResults={toolResults} executing={executing} /></MsgBoundary>}
                  </React.Fragment>
                )
              })}
              {renderThinkingBubble()}
              <div ref={endRef} />
            </div>
            {/* v0.3.3: 回到底部 / 复制最后回复 悬浮按钮 */}
            {showScrollBtn && (
              <button className="chat-fab chat-scroll-btn" title="回到底部" onClick={() => {
                const list = listBox.current.el
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
