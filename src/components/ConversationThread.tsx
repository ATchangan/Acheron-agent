import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, RefreshCw, Quote, Square, Pencil, ChevronDown, Check, X, Loader2, Globe, GitBranch, Brain, ThumbsUp, ThumbsDown, Terminal, Search, Wrench } from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { Message } from '../global'
import { api } from '../services/ipc'
import { fmtDur } from './work-steps'
import { resolveDisplay } from '../store/display'
import { StreamMarkdown } from './StreamMarkdown'

// ============================================================
// 会话区 (v0.4.4 聊天区渲染规格)
// - 用户消息: 右对齐圆角气泡 (22px radius, 10/16 padding, 16/24), 完整文本不折叠
// - 助手消息: body(gap:16px) 分区平铺: 推理(Think 折叠+sweep) / 正文(mdast 增量渲染)
// - 工具调用: 独立流节点 (DisclosureRow 风格: 变体图标+标题+摘要, 展开 IN/OUT)
// - 消息动作条: 复制/重新生成/引用/分支/点赞反馈 + 时间与统计(hover 显现)
// - 流式: 无光标无打字机 —— 增量重渲染 markdown 尾部(UNSTABLE_TAIL_BLOCKS=2)
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
const TimelineStamp: React.FC<{ ts: number; className?: string }> = ({ ts, className }) => (
  <span className={'hq-timeline-stamp' + (className ? ' ' + className : '')} title={new Date(ts).toLocaleString('zh-CN')}>
    <time dateTime={new Date(ts).toISOString()}>{fmtClock.format(ts)}</time>
  </span>
)

// v0.4.4 推理块: 摘要行 —— 流式取末行, 定稿取首行
const firstLine = (s: string) => { const t = s.trim(); const i = t.indexOf('\n'); return i < 0 ? t : t.slice(0, i) }
const lastLine = (s: string) => { const t = s.trimEnd(); const i = t.lastIndexOf('\n'); return i < 0 ? t : t.slice(i + 1) }

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
  return (
    <div className="hq-reactions">
      {list.map(label => (
        <button key={label} type="button" className="hq-react-chip" title="点击取消" onClick={() => toggle(label)}>{label}</button>
      ))}
    </div>
  )
}

// v0.4.4 消息反馈(好评/差评): 本地持久化, 互斥单选
const FEEDBACK_KEY = 'hq_message_feedback'
const readFeedback = (id: string): 'like' | 'dislike' | null => {
  try { const d = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}'); return d[id] || null } catch { return null }
}
const writeFeedback = (id: string, v: 'like' | 'dislike' | null) => {
  try {
    const d = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}')
    if (v === null) delete d[id]
    else d[id] = v
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(d))
  } catch { /* 忽略 */ }
}
const FeedbackButtons: React.FC<{ messageId: string }> = ({ messageId }) => {
  const [val, setVal] = useState<'like' | 'dislike' | null>(() => readFeedback(messageId))
  const set = (v: 'like' | 'dislike') => {
    const next = val === v ? null : v
    setVal(next)
    writeFeedback(messageId, next)
  }
  return (
    <span className="hq-feedback">
      <button type="button" title={val === 'like' ? '取消好评' : '好评'} className={val === 'like' ? 'active' : ''} onClick={() => set('like')}><ThumbsUp size={13} /></button>
      <button type="button" title={val === 'dislike' ? '取消差评' : '差评'} className={val === 'dislike' ? 'active' : ''} onClick={() => set('dislike')}><ThumbsDown size={13} /></button>
    </span>
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

// 流式 Markdown 叶子(增量渲染): 只订阅 streamText, 无光标/打字机
const StreamingMarkdown: React.FC = React.memo(() => {
  const text = useChatStore(s => s.streamText)
  // v0.4.5: 内容增长信号(已按 60ms 合批) → MessageList 跟滚/停滞计时
  useEffect(() => {
    try { window.dispatchEvent(new Event('hq-stream-grew')) } catch { /* 忽略 */ }
  }, [text])
  return (
    <div className="hq-stream-markdown">
      <StreamMarkdown content={text} streaming />
    </div>
  )
})

// ------------------------------------------------------------
// 用户消息: 右对齐气泡(22px 圆角, 10/16 内边距, 16/24 文本, 完整展开)
// 编辑改到悬停操作里(不再点击气泡编辑)
// ------------------------------------------------------------
const UserBubble: React.FC<{
  message: Message
}> = ({ message }) => {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
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
      <div className={`hq-user-bubble${editing ? ' hq-user-editing' : ''}`}>
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
          <div className="hq-user-text">{String(message.content || '')}</div>
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
        {!disp.hideRegenerate && <button className="hq-mini-btn" title="重新生成回复" disabled={busy} style={busy ? { opacity: 0.4, cursor: 'default' } : undefined} onClick={() => resendFrom(message.id)}><RefreshCw size={12} /></button>}
        {!disp.hideRegenerate && <button className="hq-mini-btn" title="从此处新开分支会话" onClick={() => { const cur = useChatStore.getState().cur(); if (!cur) return; const idx = cur.messages.findIndex(m => m.id === message.id); const upTo = idx >= 0 ? cur.messages.slice(0, idx + 1).map(m => ({ ...m })) : []; useChatStore.getState().create(); const ns = useChatStore.getState().cur(); if (ns && upTo.length) { ns.messages = upTo; useChatStore.setState(s => ({ sessions: s.sessions.map(x => x.id === ns.id ? ns : x) })); window.huangquan.sessions.save(ns).catch(() => {}) } }}><GitBranch size={12} /></button>}
        {!editing && <button className="hq-mini-btn" title="编辑" onClick={startEdit}><Pencil size={12} /></button>}
        {!disp.hideCopyButtons && <button className="hq-mini-btn" title={copied ? '已复制' : '复制'} onClick={handleCopy}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>}
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
// 工具行标题映射(英文标题)
// ------------------------------------------------------------
const dsToolTitle = (name: string): string => {
  const n = (name || '').toLowerCase()
  if (n === 'pwsh' || n === 'powershell') return 'Pwsh'
  if (['list', 'ls', 'read', 'find', 'web_fetch', 'web_read', 'recall_tool_output'].includes(n)) return 'Read'
  if (['grep', 'web_search', 'search', 'glob'].includes(n)) return 'Search'
  if (['exec_command', 'terminal_run', 'bash', 'shell'].includes(n)) return 'Bash'
  if (['write', 'apply_patch', 'mkdir'].includes(n)) return 'Write'
  if (n === 'edit') return 'Edit'
  if (['codebox', 'run_code', 'code'].includes(n)) return 'Code'
  if (n) return n.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return 'Tool call'
}

// ------------------------------------------------------------
// 工具调用节点(独立流节点: 折叠行 + 变体图标 + 摘要 + 状态扫光)
// 展开体: IN(参数) / OUT(结果) 两段
// ------------------------------------------------------------
const ToolRow: React.FC<{
  tc: { id?: string; type?: string; function?: { name?: string; arguments?: string } }
  result?: { content: string; timestamp: number }
  executing?: boolean
  run?: { ms: number; error: boolean; result: string }
}> = ({ tc, result, executing, run }) => {
  const [open, setOpen] = useState(false)
  const [resOpen, setResOpen] = useState(false)
  const fn = tc.function || { name: '', arguments: '' }
  const label = fn.name ? dsToolTitle(fn.name) : 'Tool call'
  let args = ''
  try { args = JSON.stringify(JSON.parse(fn.arguments || '{}'), null, 2) } catch { args = fn.arguments || '' }
  const argsCapped = args.length > 4000 ? args.slice(0, 3000) + '\n…[中间省略 ' + (args.length - 3800) + ' 字符，两端已保留]\n' + args.slice(-800) : args
  // 摘要: 只取关键参数值(路径/查询/URL/命令等), 而非整段 JSON
  const toolSummary = toolCallSummary(tc)
  const isError = run?.error === true || (!!result && result.content.startsWith('E:'))
  const status = run?.error ? 'error' : result ? (isError ? 'error' : 'done') : (executing ? 'running' : 'pending')
  const shownResult = result ? result.content : (run?.result || '')
  const icon = (() => {
    const n = String(fn.name || '').toLowerCase()
    if (['exec_command', 'terminal_run', 'terminal_open', 'git', 'powershell', 'pwsh'].includes(n)) return <Terminal size={14} />
    if (['grep', 'web_search', 'search', 'find', 'ls'].includes(n)) return <Globe size={14} />
    if (['web_fetch', 'web_read', 'read', 'list', 'read_image'].includes(n)) return <Check size={14} />
    return <Terminal size={14} />
  })()
  return (
    <div className={`hq-tool-row hq-tool-${status}`} data-tool-row="" data-conversation-scaffold="">
      <div className="hq-tool-head" onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpen(!open)}>
        <span className="hq-tool-status">
          {status === 'running' ? <Loader2 size={12} className="hq-spin" /> : status === 'error' ? <X size={12} /> : status === 'done' ? <span className="hq-tool-done" /> : <span className="hq-tool-pending" />}
        </span>
        <span className="hq-tool-icon">{icon}</span>
        <span className="hq-tool-name">{label}</span>
        <span className="hq-tool-sep" aria-hidden />
        {toolSummary && <span className="hq-tool-args">{toolSummary.length > 64 ? toolSummary.slice(0, 64) + '…' : toolSummary}</span>}
        <ChevronDown size={12} className={`hq-tool-chevron${open ? ' open' : ''}`} />
      </div>
      {open && (
        <div className="hq-tool-detail">
          {args && (
            <div className="hq-tool-io">
              <div className="hq-tool-io-label">IN</div>
              <pre className="hq-tool-args-pre">{argsCapped}</pre>
            </div>
          )}
          {shownResult ? (
            <div className="hq-tool-io">
              <div className="hq-tool-io-label">OUT</div>
              <div className={"hq-fadebox" + (resOpen ? " hq-fadebox-open" : "")}>
                {!isError && /(^|\n)#{1,3} |```|\|.+\|/.test(shownResult.slice(0, 2000)) ? (
                  <div className="hq-tool-md"><StreamMarkdown content={shownResult.length > 8000 ? shownResult.slice(0, 6000) + '\n…[中间省略，尾部如下]\n' + shownResult.slice(-1500) : shownResult} /></div>
                ) : (
                  <pre className={"hq-tool-result" + (isError ? " error" : "")}>{shownResult.length > 8000 ? shownResult.slice(0, 6000) + '\n…[中间省略 ' + (shownResult.length - 7500) + ' 字符，两端已保留]\n' + shownResult.slice(-1500) : shownResult}</pre>
                )}
                <button type="button" className="hq-fadebox-toggle" onClick={() => setResOpen(v => !v)}>{resOpen ? '收起' : '展开'}</button>
              </div>
            </div>
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
// 委派卡片: dispatch 不走通用工具行 —— 列出每个子任务(角色+摘要)
// ------------------------------------------------------------
const DelegateCard: React.FC<{ tc: { id?: string; function?: { name?: string; arguments?: string } }; executing?: boolean }> = ({ tc, executing }) => {
  let tasks: { agent: string; task: string }[] = []
  try {
    const a = JSON.parse(tc.function?.arguments || '{}') as { tasks?: { agent: string; task: string }[] }
    if (Array.isArray(a.tasks)) tasks = a.tasks
  } catch { /* 参数解析失败按空处理 */ }
  return (
    <div className="hq-delegate-card" data-delegate-card="">
      <div className="hq-delegate-head">
        <GitBranch size={13} />
        <span>{executing ? '正在委派' : '已委派'} {tasks.length} 个子任务</span>
      </div>
      {tasks.map((x, i) => (
        <div key={i} className="hq-delegate-row">
          <span className="hq-delegate-agent">{x.agent}</span>
          <span className="hq-delegate-task">{x.task}</span>
        </div>
      ))}
    </div>
  )
}

// v0.6.0: 通用工具节点已并入活动行栈(ActRowView); dispatch 委派卡片在栈内单独渲染

// ------------------------------------------------------------
// 助手内容块: body(gap 16px) 分区平铺 —— 推理(Think) / 正文(mdast)
// 工具调用由活动行栈作为独立流节点渲染, 不出现在消息体内
// ------------------------------------------------------------
const AssistantBlock: React.FC<{
  message: Message
  showStamp?: boolean
  /** 执行组内紧凑模式: 隐藏操作条/表情/链接卡, 正文降为次要字号 */
  minimal?: boolean
}> = ({ message, showStamp = true, minimal = false }) => {
  const [copied, setCopied] = useState(false)
  const regen = useChatStore(s => s.regen)
  const content = String(message.content || '')
  const isStreaming = !!message._streaming
  const reasoning = String(message.reasoning_content || '')
  const [reasonOpen, setReasonOpen] = useState(false)
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
  // v0.4.5 Think 计时: 流式起点→定稿时长; 从磁盘重载的消息没有起点, 不显示时长
  const [reasonSecs, setReasonSecs] = useState<number | null>(null)
  const reasonStartRef = useRef<number | null>(null)
  useEffect(() => {
    if (reasoning && message._streaming) {
      if (reasonStartRef.current === null) reasonStartRef.current = Date.now()
    } else if (reasonStartRef.current !== null) {
      setReasonSecs(Math.max(1, Math.round((Date.now() - reasonStartRef.current) / 1000)))
      reasonStartRef.current = null
    }
  }, [reasoning, message._streaming])

  const quote = () => {
    if (content) window.dispatchEvent(new CustomEvent('huangquan-quote', { detail: content }))
  }
  const handleCopy = async () => {
    await copyText(content)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

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
      <div className="hq-assistant-body">
      {/* 推理块: 折叠态 Think · 摘要(流式末行/定稿首行), 运行态扫光 */}
      {reasoning && (
        <div className={'hq-reasoning-block' + (message._streaming ? ' hq-reasoning-running' : '')} data-conversation-scaffold="">
          <button className="hq-reasoning-toggle" onClick={() => setReasonOpen(o => !o)} aria-expanded={reasonOpen}>
            <span className="hq-reasoning-icon"><Brain size={14} /></span>
            <span className="hq-reasoning-label">{message._streaming ? '思考中' : reasonSecs != null ? '思考了 ' + reasonSecs + 's' : 'Think'}</span>
            <span className="hq-reasoning-sep" aria-hidden />
            <span className="hq-reasoning-summary" data-follow-end={message._streaming || undefined}>{message._streaming ? lastLine(reasoning) : firstLine(reasoning)}</span>
            <ChevronDown size={12} className={'hq-reasoning-chevron' + (reasonOpen ? ' open' : '')} />
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
        <div className={"hq-assistant-content" + (minimal ? " hq-step-content" : "")}>
          {isStreaming ? (
            <StreamingMarkdown />
          ) : content ? (
            <StreamMarkdown content={content} />
          ) : null}
        </div>
      )}
      </div>
      {hasText && !minimal && (
        <div className="hq-msg-footer">
          <div className="hq-msg-actions">
            {!disp.hideTimestamps && <span className="hq-msg-age" title={new Date(message.timestamp).toLocaleString('zh-CN')}>{fmtAgo(message.timestamp)}</span>}
            {!disp.hideTokenMeta && message.meta?.duration != null && <span className="hq-msg-meta" title="生成时长">生成 {fmtDur(message.meta.duration)}</span>}
            {!disp.hideTokenMeta && message.meta?.ttft != null && <span className="hq-msg-meta" title="首 token 延迟">{message.meta.ttft}ms 首token</span>}
            {!disp.hideTokenMeta && message.meta?.taskMs !== undefined && <span className="hq-msg-meta" title="任务总时长">耗时 {fmtDur(message.meta.taskMs)}</span>}
            {!disp.hideTokenMeta && message.meta?.taskTokens != null && <span className="hq-msg-meta" title="本任务总消耗">{message.meta.taskTokens} token</span>}
            <FeedbackButtons messageId={message.id} />
            {!disp.hideRegenerate && <button title="重新生成" onClick={regen}><RefreshCw size={13} /></button>}
            {!disp.hideCopyButtons && <button title={copied ? '已复制' : '复制回复'} onClick={handleCopy}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>}
            <button title="引用到输入框" onClick={quote}><Quote size={13} /></button>
          </div>
        </div>
      )}
      {/* 链接预览卡(minimal 模式隐藏) */}
      {!minimal && previewUrl && (
        <a className="hq-link-card" href={previewUrl} target="_blank" rel="noreferrer">
          <span className="hq-link-card-icon"><Globe size={13} /></span>
          <span className="hq-link-card-url">{previewUrl}</span>
        </a>
      )}
      {!minimal && <MessageReactions messageId={message.id} />}
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
// 执行组(v0.6.0 活动行栈): 一轮任务里的中间步骤按工具类别分组成多行折叠行 ——
// [● 终端 git status ·N] [○ 检索 read src/app.ts ·N] [思考 · 持续了Ns] ...
// 每行点击展开该组全部调用(紧凑 ToolRow); 运行中组头呼吸 + 最新摘要;
// 组顶「工作中 N分N秒」计时行(live 时)。
// ------------------------------------------------------------
const EDIT_TOOLS = new Set(['write', 'edit', 'apply_patch', 'mkdir'])
const RUN_TOOLS = new Set(['exec_command', 'terminal_run', 'terminal_open', 'codebox', 'git', 'powershell', 'pwsh', 'bash'])
const BROWSE_TOOLS = new Set(['browse', 'browse_screenshot', 'browser_click', 'browser_type', 'browser_press', 'browser_scroll'])
const EXPLORE_TOOLS = new Set(['read', 'find', 'grep', 'ls', 'list', 'web_search', 'web_fetch', 'web_read', 'read_image', 'session_search', 'memory_search', 'conversation_search'])

type WfCategory = 'edit' | 'run' | 'browse' | 'explore' | 'other'
function wfCategory(name: string): WfCategory {
  const n = (name || '').toLowerCase()
  if (EDIT_TOOLS.has(n)) return 'edit'
  if (RUN_TOOLS.has(n)) return 'run'
  if (BROWSE_TOOLS.has(n)) return 'browse'
  if (EXPLORE_TOOLS.has(n)) return 'explore'
  return 'other'
}
const ACT_META: Record<WfCategory, { label: string }> = {
  edit: { label: '编辑' },
  run: { label: '终端' },
  browse: { label: '浏览器' },
  explore: { label: '检索' },
  other: { label: '工具' },
}

// 工具调用一行摘要(关键参数值: 路径/命令/查询等) —— ToolRow 与活动行共用
function toolCallSummary(tc: { function?: { name?: string; arguments?: string } }): string {
  const fn = tc.function || { name: '', arguments: '' }
  const SUM_KEYS = ['path', 'file_path', 'filePath', 'dirPath', 'targetPath', 'url', 'query', 'pattern', 'command', 'cmd', 'name', 'file', 'lang']
  let parsed: Record<string, unknown> | null = null
  try { parsed = JSON.parse(fn.arguments || '{}') } catch { parsed = null }
  if (parsed) {
    for (const k of SUM_KEYS) {
      const v = parsed[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
      if (Array.isArray(v) && v.length && typeof v[0] === 'string') return v[0]
    }
    for (const v of Object.values(parsed)) if (typeof v === 'string' && v.trim()) return v.trim()
    return ''
  }
  return String(fn.arguments || '').replace(/\n/g, ' ').trim()
}

const fmtMs = (ms: number): string => {
  const s = Math.max(1, Math.floor(ms / 1000))
  if (s < 60) return s + ' 秒'
  return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒'
}

type ActItem = { m: Message; tc: NonNullable<Message['tool_calls']>[number] }
type ActRow = { key: string; cat: WfCategory | 'think'; items: ActItem[]; thinkMsg?: Message }

function buildActivityRows(blocks: Message[]): { rows: ActRow[]; texts: Message[] } {
  const rows: ActRow[] = []
  const texts: Message[] = []
  let cur: ActRow | null = null
  const pushRow = (r: ActRow) => { rows.push(r); cur = null }
  for (const m of blocks) {
    const tcs = m.tool_calls || []
    if (tcs.length) {
      for (const tc of tcs) {
        const cat = wfCategory(tc.function?.name || '')
        if (cur && cur.cat === cat) cur.items.push({ m, tc })
        else { if (cur) pushRow(cur); cur = { key: tc.id || m.id + '-' + rows.length, cat, items: [{ m, tc }] } }
      }
      continue
    }
    if (cur) pushRow(cur)
    if (m.reasoning_content && !m.content) {
      rows.push({ key: 'think-' + m.id, cat: 'think', items: [], thinkMsg: m })
      continue
    }
    if (m.content || m.reasoning_content) texts.push(m) // 中间说明文字: 保持在栈内平铺(紧凑模式)
  }
  if (cur) pushRow(cur)
  return { rows, texts }
}

const ActRowView: React.FC<{
  row: ActRow
  runningId?: string
  toolResults?: Map<string, { content: string; timestamp: number }>
  executing?: boolean
}> = ({ row, runningId, toolResults, executing }) => {
  const [open, setOpen] = useState(false)
  if (row.cat === 'think' && row.thinkMsg) {
    const reasoning = String(row.thinkMsg.reasoning_content || '')
    return (
      <div className="hq-act-row hq-act-think" data-conversation-scaffold={!open || undefined}>
        <button className="hq-act-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <span className={'hq-act-status' + (row.thinkMsg._streaming ? ' live' : '')}>{row.thinkMsg._streaming ? <Loader2 size={12} className="hq-spin" /> : <Brain size={13} />}</span>
          <span className="hq-act-name">思考</span>
          <span className="hq-act-summary">{row.thinkMsg._streaming ? lastLine(reasoning) : firstLine(reasoning)}</span>
          <ChevronDown size={12} className={'hq-act-chevron' + (open ? ' open' : '')} />
        </button>
        {open && (
          <div className="hq-act-body">
            <StreamMarkdown content={reasoning} streaming={row.thinkMsg._streaming} />
          </div>
        )}
      </div>
    )
  }
  const cat = row.cat as WfCategory
  const lastItem = row.items[row.items.length - 1]
  const summary = lastItem ? toolCallSummary(lastItem.tc) : ''
  const isRunning = !!executing && row.items.some(x => x.tc.id === runningId)
  const hasError = row.items.some(x => {
    const r = toolResults?.get(x.tc.id || '')
    return (r && r.content.startsWith('E:')) || (x.m._toolLog || []).some(l => l.toolCallId === x.tc.id && l.error)
  })
  const status = isRunning ? 'running' : hasError ? 'error' : 'done'
  const icon = cat === 'run' ? <Terminal size={13} /> : cat === 'browse' ? <Globe size={13} /> : cat === 'edit' ? <Pencil size={13} /> : cat === 'explore' ? <Search size={13} /> : <Wrench size={13} />
  return (
    <div className={'hq-act-row hq-act-' + status} data-conversation-scaffold={!open || undefined}>
      <button className="hq-act-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={'hq-act-status' + (isRunning ? ' live' : '')}>
          {isRunning ? <Loader2 size={12} className="hq-spin" /> : status === 'error' ? <X size={12} /> : <span className="hq-act-dot" />}
        </span>
        <span className="hq-act-icon">{icon}</span>
        <span className="hq-act-name">{ACT_META[cat].label}</span>
        {summary && <span className="hq-act-summary">{summary.length > 72 ? summary.slice(0, 72) + '…' : summary}</span>}
        {row.items.length > 1 && <span className="hq-act-count">×{row.items.length}</span>}
        <ChevronDown size={12} className={'hq-act-chevron' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="hq-act-body">
          {row.items.map(({ m, tc }) => (
            tc.function?.name === 'dispatch' ? (
              <DelegateCard key={tc.id || m.id} tc={tc} executing={executing && tc.id === runningId} />
            ) : (
              <ToolRowMemo key={tc.id || m.id} tc={tc} result={toolResults?.get(tc.id || '')} executing={executing && tc.id === runningId} run={(m._toolLog || []).find(l => l.toolCallId === tc.id)} />
            )
          ))}
        </div>
      )}
    </div>
  )
}

// 工作计时行: live 时显示「工作中 N分N秒」(本地秒表, 组挂载即计时)
const WorkingTimer: React.FC = () => {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setSec(s => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="hq-working-line" role="status">
      <span className="hq-working-label">工作中</span>
      <span className="hq-working-timer">{fmtMs(sec * 1000)}</span>
    </div>
  )
}

const ActivityStack: React.FC<{
  blocks: Message[]
  toolResults?: Map<string, { content: string; timestamp: number }>
  executing?: boolean
  live: boolean
}> = ({ blocks, toolResults, executing, live }) => {
  const { rows, texts } = useMemo(() => buildActivityRows(blocks), [blocks])
  // 运行中的调用 = 全部 tool_calls 里最后一个还没有结果的
  const runningId = useMemo(() => {
    if (!executing) return undefined
    let last: string | undefined
    for (const m of blocks) for (const tc of (m.tool_calls || [])) {
      if (!toolResults?.get(tc.id || '')) last = tc.id || undefined
    }
    return last
  }, [blocks, toolResults, executing])
  return (
    <div className={'hq-act-stack' + (live ? ' hq-act-live' : '')} data-conversation-scaffold="">
      {live && <WorkingTimer />}
      {rows.map(r => (
        <ActRowView key={r.key} row={r} runningId={runningId} toolResults={toolResults} executing={executing} />
      ))}
      {texts.map(m => <AssistantBlockMemo key={m.id} message={m} minimal showStamp={false} />)}
    </div>
  )
}

// ------------------------------------------------------------
// 回合 (用户气泡 + 其后助手内容平铺 + 工具调用独立节点)
// ------------------------------------------------------------
const ConversationTurnBase: React.FC<{
  user?: Message
  blocks: Message[]
  toolResults?: Map<string, { content: string; timestamp: number }>
  executing?: boolean
}> = ({ user, blocks, toolResults, executing }) => {
  const disp = resolveDisplay(useSettingsStore(s => s.general.uiDisplay))
  // v0.4.5 聚合工作流: 最终回复 = 最后一条无工具调用的 assistant 消息(完整操作条);
  // 其余中间步骤(思考/说明/工具调用)全部收进执行组, 折叠为单行摘要。
  // 流式中的占位消息(无 tool_calls)按最终回复渲染 —— 打字流式可见, step 落地后自动收进组内。
  let finalIdx = -1
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (!(blocks[i].tool_calls || []).length) { finalIdx = i; break }
  }
  const middle = blocks.filter((_, i) => i !== finalIdx)
  const final = finalIdx >= 0 ? blocks[finalIdx] : null
  return (
    <div className="hq-turn">
      {user && <UserBubbleMemo message={user} />}
      {!disp.hideToolCalls && middle.length > 0 && (
        <ActivityStack
          blocks={middle}
          toolResults={toolResults}
          executing={executing}
          live={!!executing && finalIdx < 0}
        />
      )}
      {final && (
        <AssistantBlockMemo message={final} showStamp />
      )}
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
