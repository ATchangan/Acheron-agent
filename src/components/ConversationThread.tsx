import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, RefreshCw, Volume2, Quote, Square, Pencil, ChevronDown, Terminal, Check, X, Loader2 } from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { Message } from '../global'
import { api } from '../services/ipc'
import { TOOL_LABELS, fmtDur } from './work-steps'

// ============================================================
// 会话区 (v0.3.4)
// - 回合制: 用户气泡(sticky) + 其后助手内容平铺
// - 助手回复: 无卡片/无气泡, 平铺 markdown, 悬停浮现操作栏
// - 工具调用: 扁平脚手架行(状态/名称/参数/耗时, 点击展开结果)
// - 思考中: 脉冲 + 标签 + 计时行
// v0.3.6 P0-2: 全部子组件 memo 化, 流式 chunk 只重渲染当前块
// ============================================================

const fmtAgo = (ts: number) => {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + '分钟前'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + '小时前'
  return Math.floor(diff / 86_400_000) + '天前'
}

const copyText = async (text: string) => {
  if (!text) return
  try {
    if (navigator.clipboard && document.hasFocus()) await navigator.clipboard.writeText(text)
    else throw new Error('clipboard-unavailable')
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    document.body.removeChild(ta)
  }
}

// 流式文本叶子: 只订阅 streamText, 每 token 只重渲染这一小块
const StreamingText: React.FC = React.memo(() => {
  const text = useChatStore(s => s.streamText)
  return (
    <>
      <span className="hq-stream-plain">{text}</span>
      <span className="hq-stream-cursor" />
    </>
  )
})

// v0.3.6 P0-3: Markdown 解析缓存 —— 历史消息内容不变时跳过 react-markdown 全量解析
const MemoizedMarkdownInner: React.FC<{ content: string }> = ({ content }) => {
  const el = useMemo(() => (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  ), [content])
  return el
}
const MemoizedMarkdown = React.memo(MemoizedMarkdownInner, (p, n) => p.content === n.content)

// ------------------------------------------------------------
// 用户气泡 (玻璃圆角卡, sticky 跟随滚动, 长文自动收成两行)
// ------------------------------------------------------------
const UserBubble: React.FC<{
  message: Message
}> = ({ message }) => {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const resendFrom = useChatStore(s => s.resendFrom)
  const stop = useChatStore(s => s.stop)
  const busy = useChatStore(s => s.sessions.find(x => x.id === s.cid)?.busy || false)
  const isLatestUser = useChatStore(s => {
    const cur = s.sessions.find(x => x.id === s.cid)
    const msgs = cur?.messages || []
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') return msgs[i].id === message.id
    }
    return false
  })
  const showTimestamps = useSettingsStore(s => (s.general).showTimestamps || 'hover')
  const timeText = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  const measure = useCallback(() => {
    const el = innerRef.current
    if (!el) return
    setClamped(el.scrollHeight > el.clientHeight + 2)
  }, [])

  useLayoutEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (innerRef.current) ro.observe(innerRef.current)
    return () => ro.disconnect()
  }, [measure, message.content])

  const startEdit = () => { setEditText(String(message.content || '')); setEditing(true) }
  const saveEdit = async () => {
    const v = editText.trim()
    if (v && v !== message.content) await resendFrom(message.id, v)
    setEditing(false)
  }
  const handleCopy = async () => {
    await copyText(String(message.content || ''))
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="hq-user-sticky" data-message-id={message.id}>
      <div
        className={`hq-user-bubble${clamped && !expanded ? ' hq-user-clamped' : ''}${expanded ? ' hq-user-expanded' : ''}`}
        onClick={() => {
          if (editing) return
          startEdit()
        }}
        title="点击编辑"
      >
        {message.images?.length ? (
          <div className="hq-user-images">
            {message.images.map((img, i) => <img key={i} src={img} alt="" />)}
          </div>
        ) : null}
        {message.attachments?.length ? (
          <div className="hq-user-attachments">
            {message.attachments.map((a, i) => (
              <span key={i} title={a.path} onClick={e => { e.stopPropagation(); api.computer.openFile(a.path).catch(() => {}) }}>
                [{a.kind === 'video' ? '视频' : a.kind === 'audio' ? '音频' : '文件'}] {a.name}
              </span>
            ))}
          </div>
        ) : null}
        {editing ? (
          <div className="hq-user-edit" onClick={e => e.stopPropagation()}>
            <textarea
              autoFocus
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() } }}
            />
            <div className="hq-user-edit-actions">
              <button className="hq-mini-btn hq-mini-btn-ok" onClick={saveEdit} title="保存"><Check size={13} /></button>
              <button className="hq-mini-btn" onClick={() => setEditing(false)} title="取消"><X size={13} /></button>
            </div>
          </div>
        ) : (
          <div className="hq-user-text" ref={innerRef}>{String(message.content || '')}</div>
        )}
        {(busy && isLatestUser) && (
          <button
            className="hq-user-stop"
            title="停止"
            onClick={e => { e.stopPropagation(); stop() }}
          >
            <Square size={12} fill="currentColor" />
          </button>
        )}
      </div>
      <div className="hq-user-hover-actions" onClick={e => e.stopPropagation()}>
        {clamped && !expanded && <button className="hq-mini-btn" title="展开完整内容" onClick={() => setExpanded(true)}><ChevronDown size={12} /></button>}
        {!editing && <button className="hq-mini-btn" title="重新生成回复" disabled={busy} style={busy ? { opacity: 0.4, cursor: 'default' } : undefined} onClick={() => resendFrom(message.id)}><RefreshCw size={12} /></button>}
        {!editing && <button className="hq-mini-btn" title="编辑" onClick={startEdit}><Pencil size={12} /></button>}
        {!editing && <button className="hq-mini-btn" title={copied ? '已复制' : '复制'} onClick={handleCopy}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>}
        {showTimestamps === 'always' && <span className="hq-user-time">{timeText}</span>}
      </div>
    </div>
  )
}

// v0.3.6 P0-2: 用户气泡 memo —— message 引用不变即跳过重渲染
const UserBubbleMemo = React.memo(UserBubble)

// ------------------------------------------------------------
// 工具脚手架行 (扁平一行, 点击展开参数/结果)
// ------------------------------------------------------------
const ToolRow: React.FC<{
  tc: { id?: string; type?: string; function?: { name?: string; arguments?: string } }
  result?: { content: string; timestamp: number }
  executing?: boolean
  run?: { ms: number; error: boolean; result: string }
}> = ({ tc, result, executing, run }) => {
  const [open, setOpen] = useState(false)
  const fn = tc.function || { name: '', arguments: '' }
  const label = fn.name ? (TOOL_LABELS[fn.name] || fn.name) : '工具'
  let args = ''
  try { args = JSON.stringify(JSON.parse(fn.arguments || '{}'), null, 2) } catch { args = fn.arguments || '' }
  const inline = args.replace(/\n/g, ' ').trim()
  const isError = !!result && result.content.startsWith('E:')
  const status = result ? (isError ? 'error' : 'done') : (executing ? 'running' : 'pending')
  return (
    <div className={`hq-tool-row hq-tool-${status}`} data-tool-row="">
      <div className="hq-tool-head" onClick={() => setOpen(!open)}>
        <span className="hq-tool-status">
          {status === 'running' ? <Loader2 size={12} className="hq-spin" /> : status === 'error' ? <X size={12} /> : status === 'done' ? <Check size={12} /> : <span className="hq-tool-pending" />}
        </span>
        <Terminal size={12} className="hq-tool-icon" />
        <span className="hq-tool-name">{label}</span>
        {inline && <span className="hq-tool-args">{inline.length > 52 ? inline.slice(0, 52) + '…' : inline}</span>}
        {run?.ms != null && <span className="hq-tool-dur">{fmtDur(run.ms)}</span>}
        <ChevronDown size={12} className={`hq-tool-chevron${open ? ' open' : ''}`} />
      </div>
      {open && (
        <div className="hq-tool-detail">
          {args && <pre className="hq-tool-args-pre">{args}</pre>}
          {result ? (
            <pre className={`hq-tool-result${isError ? ' error' : ''}`}>{(result.content || '').slice(0, 8000)}{result.content.length > 8000 ? '\n…内容过长已截断' : ''}</pre>
          ) : (
            <div className="hq-tool-wait">{executing ? '执行中…' : '等待执行…'}</div>
          )}
        </div>
      )}
    </div>
  )
}

// v0.3.6 P0-2: 工具行 memo —— 历史回合重渲染时跳过
const ToolRowMemo = React.memo(ToolRow)

// ------------------------------------------------------------
// 助手内容块 (无卡片平铺, 悬停浮现操作栏)
// ------------------------------------------------------------
const AssistantBlock: React.FC<{
  message: Message
  toolResults?: Map<string, { content: string; timestamp: number }>
  executing?: boolean
}> = ({ message, toolResults, executing }) => {
  const [copied, setCopied] = useState(false)
  const regen = useChatStore(s => s.regen)
  const ttsEnabled = useSettingsStore(s => (s.general).ttsEnabled !== false)
  const ttsRate = useSettingsStore(s => (s.general).ttsRate || 1)
  const [ttsBusy, setTtsBusy] = useState(false)
  const content = String(message.content || '')
  const isStreaming = !!message._streaming
  const reasoning = String(message.reasoning_content || '')
  const [reasonOpen, setReasonOpen] = useState(() => !!message._streaming)
  useEffect(() => { if (reasoning && message._streaming) setReasonOpen(true) }, [reasoning, message._streaming])
  // 完成后默认收起（执行中展开看过程，结束收成一行）
  useEffect(() => { if (!message._streaming && reasoning) setReasonOpen(false) }, [message._streaming, reasoning])
  // 思考过程自动跟随滚动：流式输出时贴近底部才自动滚到底，用户上滑后暂停跟随
  const reasonRef = useRef<HTMLPreElement | null>(null)
  const reasonFollow = useRef(true)
  const syncReasonScroll = useCallback(() => {
    const el = reasonRef.current
    if (!el) return
    const nb = el.scrollHeight - el.scrollTop - el.clientHeight <= 24
    reasonFollow.current = nb
  }, [])
  useEffect(() => {
    if (!reasonOpen || !reasoning) return
    const el = reasonRef.current
    if (!el || !reasonFollow.current) return
    el.scrollTop = el.scrollHeight
  }, [reasoning, reasonOpen])

  const runByCall = useMemo(() => {
    const map = new Map<string, { ms: number; error: boolean; result: string }>()
    for (const x of (message._toolLog || [])) if (x.toolCallId) map.set(x.toolCallId, { ms: x.ms, error: x.error, result: x.result })
    return map
  }, [message._toolLog])

  const speak = async () => {
    if (ttsBusy || !content) return
    setTtsBusy(true)
    try { await api.tts.speak(content.replace(/[#*`>|\-\[\](){}]/g, '').slice(0, 300), ttsRate) } catch { /* ignore */ }
    setTtsBusy(false)
  }

  const quote = () => {
    if (content) window.dispatchEvent(new CustomEvent('huangquan-quote', { detail: content }))
  }

  const handleCopy = async () => {
    await copyText(content)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const tools = message.tool_calls || []
  const hasText = !!content || isStreaming

  return (
    <div className="hq-assistant-block group" data-role="assistant" data-message-id={message.id}>
      {reasoning && (
        <div className="hq-reasoning-block">
          <button className="hq-reasoning-toggle" onClick={() => setReasonOpen(o => !o)}>
            <span className="hq-reasoning-arrow">{reasonOpen ? '▾' : '▸'}</span> 思考过程
            {!reasonOpen && <span className="hq-reasoning-meta">（已折叠）</span>}
          </button>
          {reasonOpen && <pre ref={reasonRef} onScroll={syncReasonScroll} className="hq-reasoning-text">{reasoning}</pre>}
        </div>
      )}
      {hasText && (
        <div className="hq-assistant-content">
          {isStreaming ? (
            <StreamingText />
          ) : content ? (
            <MemoizedMarkdown content={content} />
          ) : null}
        </div>
      )}
      {tools.length > 0 && (
        <div className="hq-tool-list">
          {tools.map((tc, i) => (
            <ToolRowMemo
              key={tc.id || `${message.id}-${i}`}
              tc={tc}
              result={toolResults?.get(tc.id || '')}
              executing={executing}
              run={runByCall.get(tc.id || '')}
            />
          ))}
        </div>
      )}
      {hasText && (
        <div className="hq-msg-actions">
          <span className="hq-msg-age">{fmtAgo(message.timestamp)}</span>
  {message.meta?.taskMs !== undefined && <span className="hq-msg-meta" title="任务总时长">{fmtDur(message.meta.taskMs)}</span>}
          {message.meta?.taskTokens != null && <span className="hq-msg-meta" title="本任务总消耗(全 agent)">{message.meta.taskTokens} token</span>}
          {ttsEnabled && <button title={ttsBusy ? '朗读中…' : '语音朗读'} onClick={speak}><Volume2 size={13} /></button>}
          <button title="重新生成" onClick={regen}><RefreshCw size={13} /></button>
          <button title={copied ? '已复制' : '复制回复'} onClick={handleCopy}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
          <button title="引用到输入框" onClick={quote}><Quote size={13} /></button>
        </div>
      )}
    </div>
  )
}

// v0.3.6 P0-2: 助手块 memo —— message 引用不变即跳过
const AssistantBlockMemo = React.memo(AssistantBlock)

// ------------------------------------------------------------
// 思考状态行 (脉冲 + 标签 + 计时)
// ------------------------------------------------------------
export const ThinkingRow: React.FC<{
  label?: string
  detail?: string
}> = ({ label, detail }) => {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setSec(s => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="hq-status-row" role="status">
      <span className="hq-status-pulse" />
      <span className="hq-status-label">{label || '思考中'}</span>
      {detail && <span className="hq-status-detail">{detail}</span>}
      <span className="hq-status-timer">{sec}s</span>
    </div>
  )
}

// ------------------------------------------------------------
// 回合 (用户气泡 + 其后的助手块)
// ------------------------------------------------------------
const ConversationTurnBase: React.FC<{
  user?: Message
  blocks: Message[]
  toolResults?: Map<string, { content: string; timestamp: number }>
  executing?: boolean
}> = ({ user, blocks, toolResults, executing }) => {
  return (
    <div className="hq-turn">
      {user && <UserBubbleMemo message={user} />}
      {blocks.map(m => (
        <AssistantBlockMemo
          key={m.id}
          message={m}
          toolResults={toolResults}
          executing={executing}
        />
      ))}
    </div>
  )
}

// v0.3.6 P0-2: 回合 memo —— turns 数组每次流式更新都会重建, 但历史回合的消息对象引用不变,
// 因此按消息对象引用比较, 跳过历史回合的整树重渲染 (toolResults 变化必伴随消息变化, 可忽略)。
const blocksSame = (a: Message[], b: Message[]): boolean => {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
export const ConversationTurn = React.memo(ConversationTurnBase, (p, n) =>
  p.user === n.user && p.executing === n.executing && blocksSame(p.blocks, n.blocks),
)
