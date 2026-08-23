import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Copy, RefreshCw, Quote, Square, Pencil, ChevronDown, Terminal, Check, X, Loader2, Globe, GitBranch } from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { Message } from '../global'
import { api } from '../services/ipc'
import { TOOL_LABELS, fmtDur } from './work-steps'
import { resolveDisplay } from '../store/display'
import { StreamMarkdown } from './StreamMarkdown'

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

// 时间线时间戳：HH:MM，小号弱化，tabular 数字
const fmtClock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
const sameMinute = (a: number, b: number) => {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate() &&
    da.getHours() === db.getHours() && da.getMinutes() === db.getMinutes()
}
const TimelineStamp: React.FC<{ ts: number; className?: string }> = ({ ts, className }) => (
  <span className={'hq-timeline-stamp' + (className ? ' ' + className : '')} title={new Date(ts).toLocaleString('zh-CN')}>
    <time dateTime={new Date(ts).toISOString()}>{fmtClock.format(ts)}</time>
  </span>
)

// 秒表格式：<60s 显示 "12s"，否则 "1:23"
const fmtElapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)

// 消息回应（文字标签，不使用 emoji）
const REACTIONS_KEY = 'hq_message_reactions'
const readReactions = (id: string): string[] => {
  try {
    const d = JSON.parse(localStorage.getItem(REACTIONS_KEY) || '{}')
    return Array.isArray(d[id]) ? d[id] : []
  } catch { return [] }
}
const writeReactions = (id: string, list: string[]) => {
  try {
    const d = JSON.parse(localStorage.getItem(REACTIONS_KEY) || '{}')
    d[id] = list
    localStorage.setItem(REACTIONS_KEY, JSON.stringify(d))
  } catch { /* 忽略 */ }
}

const MessageReactions: React.FC<{ messageId: string }> = ({ messageId }) => {
  const [list, setList] = useState<string[]>(() => readReactions(messageId))
  const toggle = (label: string) => {
    const next = list.includes(label) ? list.filter(x => x !== label) : [...list, label]
    setList(next)
    writeReactions(messageId, next)
  }
  // v0.4.3 低密度: 移除"添加回应"加号(点击弹层定位曾有问题), 已存的回应仅只读展示
  return (
    <div className="hq-reactions">
      {list.map(label => (
        <button key={label} type="button" className="hq-react-chip" title="点击取消" onClick={() => toggle(label)}>{label}</button>
      ))}
    </div>
  )
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

// 流式 Markdown 叶子(Streamdown): 只订阅 streamText, 边生成边渲染不完整 Markdown + 光标
const StreamingMarkdown: React.FC = React.memo(() => {
  const text = useChatStore(s => s.streamText)
  return (
    <div className="hq-stream-markdown">
      <StreamMarkdown content={text} streaming />
      <span className="hq-stream-cursor" />
    </div>
  )
})

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
  const disp = resolveDisplay(useSettingsStore(s => s.general.uiDisplay))
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
        {!editing && !disp.hideRegenerate && <button className="hq-mini-btn" title="重新生成回复" disabled={busy} style={busy ? { opacity: 0.4, cursor: 'default' } : undefined} onClick={() => resendFrom(message.id)}><RefreshCw size={12} /></button>}
        {!editing && <button className="hq-mini-btn" title="从此处新开分支会话" onClick={() => { const cur = useChatStore.getState().cur(); if (!cur) return; const idx = cur.messages.findIndex(m => m.id === message.id); const upTo = idx >= 0 ? cur.messages.slice(0, idx + 1).map(m => ({ ...m })) : []; useChatStore.getState().create(); const ns = useChatStore.getState().cur(); if (ns && upTo.length) { ns.messages = upTo; useChatStore.setState(s => ({ sessions: s.sessions.map(x => x.id === ns.id ? ns : x) })); window.huangquan.sessions.save(ns).catch(() => {}) } }}><GitBranch size={12} /></button>}
        {!editing && <button className="hq-mini-btn" title="编辑" onClick={startEdit}><Pencil size={12} /></button>}
        {!editing && !disp.hideCopyButtons && <button className="hq-mini-btn" title={copied ? '已复制' : '复制'} onClick={handleCopy}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>}
        {!disp.hideTimestamps && showTimestamps === 'always' && <span className="hq-user-time">{timeText}</span>}
      </div>
      {/* 时间戳在气泡下方右对齐 */}
      {!disp.hideTimestamps && showTimestamps === 'always' && <TimelineStamp ts={message.timestamp} className="hq-user-stamp" />}
      <MessageReactions messageId={message.id} />
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
  const argsCapped = args.length > 4000 ? args.slice(0, 4000) + '\n…参数过长已截断' : args
  const inline = args.replace(/\n/g, ' ').trim()
  const isError = run?.error === true || (!!result && result.content.startsWith('E:'))
  const status = run?.error ? 'error' : result ? (isError ? 'error' : 'done') : (executing ? 'running' : 'pending')
  const shownResult = result ? result.content : (run?.result || '')
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
          {args && <pre className="hq-tool-args-pre">{argsCapped}</pre>}
          {shownResult ? (
            <pre className={`hq-tool-result${isError ? ' error' : ''}`}>{shownResult.slice(0, 8000)}{shownResult.length > 8000 ? '\n…内容过长已截断' : ''}</pre>
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
  showStamp?: boolean
}> = ({ message, toolResults, executing, showStamp = true }) => {
  const [copied, setCopied] = useState(false)
  const regen = useChatStore(s => s.regen)
  const content = String(message.content || '')
  const isStreaming = !!message._streaming
  const reasoning = String(message.reasoning_content || '')
  const [reasonOpen, setReasonOpen] = useState(() => !!message._streaming)
  const [reasonStart, setReasonStart] = useState<number | null>(null)
  const [reasonDur, setReasonDur] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  // 思考标签状态机：思考中(计时) → 思考了 Xs / 快速思考 / 思考
  useEffect(() => {
    if (reasoning && message._streaming) {
      setReasonOpen(true)
      if (reasonStart === null) setReasonStart(Date.now())
    } else if (reasoning && !message._streaming) {
      setReasonOpen(false)
      if (reasonStart !== null && reasonDur === null) setReasonDur(Math.max(1, Math.round((Date.now() - reasonStart) / 1000)))
    }
  }, [reasoning, message._streaming, reasonStart, reasonDur])
  useEffect(() => {
    if (!message._streaming || !reasoning) return
    setElapsed(0)
    const id = window.setInterval(() => setElapsed(s => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [reasoning, message._streaming])
  const reasonLabel = !reasoning ? null
    : message._streaming ? '思考中'
    : reasonDur === null ? '思考'
    : reasonDur < 1 ? '快速思考'
    : `思考了 ${fmtElapsed(reasonDur)}`
  // 思考过程自动跟随滚动：流式输出时贴近底部才自动滚到底，用户上滑后暂停跟随
  const reasonRef = useRef<HTMLDivElement | null>(null)
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

  const quote = () => {
    if (content) window.dispatchEvent(new CustomEvent('huangquan-quote', { detail: content }))
  }

  const handleCopy = async () => {
    await copyText(content)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const tools = message.tool_calls || []
  const hasText = !!content || isStreaming
  const disp = resolveDisplay(useSettingsStore(s => s.general.uiDisplay))
  const showTimestamps = useSettingsStore(s => (s.general).showTimestamps || 'hover')
  const previewUrl = useMemo(() => {
    if (isStreaming || !content) return ''
    const m = content.match(/https?:\/\/[^\s<>"'）)]+/)
    return m ? m[0].replace(/[.,;:!?]+$/, '') : ''
  }, [content, isStreaming])

  return (
    <div className="hq-assistant-block group" data-role="assistant" data-message-id={message.id}>
      {reasoning && (
        <div className="hq-reasoning-block" data-conversation-scaffold="">
          <button className="hq-reasoning-toggle" onClick={() => setReasonOpen(o => !o)} aria-expanded={reasonOpen}>
            <span className="hq-reasoning-arrow">{reasonOpen ? '▾' : '▸'}</span>
            <span className={'hq-reasoning-label' + (message._streaming ? ' hq-shimmer' : '')}>{reasonLabel}</span>
            {message._streaming && <span className="hq-reasoning-timer">{fmtElapsed(elapsed)}</span>}
          </button>
          {reasonOpen && (
            <div className={'hq-reasoning-body' + (message._streaming ? ' hq-reasoning-live' : '')} ref={reasonRef} onScroll={syncReasonScroll}>
              <StreamMarkdown content={reasoning} streaming={message._streaming} />
            </div>
          )}
        </div>
      )}
      {/* 消息级时间线时间戳（同分钟去重） */}
      {showStamp && !disp.hideTimestamps && showTimestamps === 'always' && hasText && (
        <TimelineStamp ts={message.timestamp} className="hq-msg-stamp" />
      )}
      {hasText && (
        <div className="hq-assistant-content">
          {isStreaming ? (
            <StreamingMarkdown />
          ) : content ? (
            <StreamMarkdown content={content} />
          ) : null}
        </div>
      )}
      {!disp.hideToolCalls && tools.length > 0 && (
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
        <div className="hq-msg-footer">
          <div className="hq-msg-actions">
            {!disp.hideTimestamps && <span className="hq-msg-age">{fmtAgo(message.timestamp)}</span>}
            {!disp.hideTokenMeta && message.meta?.taskMs !== undefined && <span className="hq-msg-meta" title="任务总时长">耗时 {fmtDur(message.meta.taskMs)}</span>}
            {!disp.hideTokenMeta && message.meta?.taskTokens != null && <span className="hq-msg-meta" title="本任务总消耗(全 agent)">{message.meta.taskTokens} token</span>}
            {!disp.hideRegenerate && <button title="重新生成" onClick={regen}><RefreshCw size={13} /></button>}
            {!disp.hideCopyButtons && <button title={copied ? '已复制' : '复制回复'} onClick={handleCopy}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>}
            <button title="引用到输入框" onClick={quote}><Quote size={13} /></button>
          </div>
        </div>
      )}
      {/* 链接预览卡 */}
      {previewUrl && (
        <a className="hq-link-card" href={previewUrl} target="_blank" rel="noreferrer">
          <span className="hq-link-card-icon"><Globe size={13} /></span>
          <span className="hq-link-card-url">{previewUrl}</span>
        </a>
      )}
      <MessageReactions messageId={message.id} />
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
  // 时间戳去重：同一分钟内连续消息只显示一次
  let prevStampTs: number | null = null
  return (
    <div className="hq-turn">
      {user && <UserBubbleMemo message={user} />}
      {blocks.map(m => {
        const showStamp = prevStampTs === null || !sameMinute(prevStampTs, m.timestamp)
        prevStampTs = m.timestamp
        return (
          <AssistantBlockMemo
            key={m.id}
            message={m}
            toolResults={toolResults}
            executing={executing}
            showStamp={showStamp}
          />
        )
      })}
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
