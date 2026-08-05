import React, { useState, useCallback } from 'react'
import { Volume2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { Message } from '../global'
import { api } from '../services/ipc'

interface Props { message: Message; streaming?: boolean }

// 统一 SVG 图标组件
const SvgIcon: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const CopyIcon = () => <SvgIcon><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></SvgIcon>
const CheckIcon = () => <SvgIcon><polyline points="20 6 9 17 4 12" /></SvgIcon>
const RefreshIcon = () => <SvgIcon><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></SvgIcon>
const ScreenshotIcon = () => <SvgIcon><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></SvgIcon>
const QuoteIcon = () => <SvgIcon><path d="M8 6h13M8 12h13M8 18h13M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" /></SvgIcon>

// 底部按钮组件 — 最小 28x28 触摸区域
const FooterBtn: React.FC<{ title: string; onClick: () => void; active?: boolean; children: React.ReactNode }> =
  ({ title, onClick, active, children }) => (
    <button title={title} onClick={onClick}
      className={`footer-btn${active ? ' active' : ''}`}
      style={{ width: 28, height: 28, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </button>
  )

// 时长格式化（ms -> 1.2s / 850ms）
const fmtTime = (ms?: number) => {
  if (ms === undefined || ms === null) return ''
  return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'
}

function MessageItem({ message, streaming }: Props) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const regen = useChatStore(s => s.regen)
  const resendFrom = useChatStore(s => s.resendFrom)
  const startEdit = () => { setEditText(message.content || ''); setEditing(true) }
  const saveEdit = () => { const v = editText.trim(); if (v && v !== message.content) resendFrom(message.id, v); setEditing(false) }
  const agentAvatar = useSettingsStore(s => s.general.agentAvatar)
  const agentAvatarImg = useSettingsStore(s => s.general.agentAvatarImage)
  const cardMaxHeight = useSettingsStore(s => (s.general).cardMaxHeight || 500)
  // TTS 语音朗读(Windows SAPI)
  const ttsEnabled = useSettingsStore(s => (s.general).ttsEnabled !== false)
  const ttsRate = useSettingsStore(s => (s.general).ttsRate || 1)
  const [ttsBusy, setTtsBusy] = useState(false)
  const speakText = async () => {
    if (ttsBusy || !message.content) return
    setTtsBusy(true)
    try { await api.tts.speak(message.content.replace(/[#*`>|\-\[\](){}]/g, '').slice(0, 300), ttsRate) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    setTtsBusy(false)
  }
  const showTimestamps = useSettingsStore(s => (s.general).showTimestamps || 'hover')
  const [selected, setSelected] = useState(false)
  const isUser = message.role === 'user'
  const timeText = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const handleCopy = async () => {
    // 内容可能是多模态数组 → 统一转文本; clipboard 需焦点 → 异常时回退 execCommand(无需焦点/权限)
    const raw = message.content
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw || '')
    try {
      if (navigator.clipboard && document.hasFocus()) {
        await navigator.clipboard.writeText(text)
      } else {
        throw new Error('clipboard-unavailable')
      }
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch (e) { /* ignore */ console.debug('[swallow]', e) }
      document.body.removeChild(ta)
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  // 引用内容 → 显示在输入框上方（类似图片预览），由 ChatInput 监听 huangquan-quote 事件接收
  const sendQuote = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent('huangquan-quote', { detail: text }))
  }, [])

  // 右键引用选中文字
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection()?.toString().trim()
    if (selection) {
      e.preventDefault()
      sendQuote(selection)
    }
  }, [sendQuote])

  if (message.role === 'tool') {
    const c = message.content || ''
    const truncated = c.length > 300 ? c.slice(0, 300) + '...' : c
    const isError = c.startsWith('E:')
    const toolId = message.tool_call_id || ''
    const shortId = toolId.replace(/^(call_|c_)/, '').slice(0, 8) || 'tool'
    // 显示关联工具名(如 ✓ write), 不再只显示 call id 缩写
    const toolName = message.toolName || shortId
    return (
      <div className="message-item" style={{ paddingLeft: 40, opacity: .85 }}>
        <div className="message-body">
          <div className="tool-call-block" style={{ borderColor: isError ? 'var(--danger)' : 'var(--accent-green)', background: isError ? 'var(--danger-soft)' : 'var(--success-soft)' }}>
            <div className="tool-call-header" style={{ color: isError ? 'var(--danger)' : 'var(--accent-green)' }}>{isError ? '✗ 出错（' + toolName + '）' : '✓ ' + toolName}</div>
            <pre className="tool-call-output">{truncated}</pre>
          </div>
        </div>
      </div>
    )
  }

  // 工具调用卡片 —— 内嵌紧凑风格(与工具结果块一致: 无头像无sender)
  // header 只显示工具名, 参数为灰色单行摘要, 完整参数可展开
  const toolCalls = message.tool_calls
  if (toolCalls?.length) {
    return (
      <div className="message-item" style={{ paddingLeft: 40, opacity: .85 }}>
        <div className="message-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {toolCalls.map((tc: { id?: string; type?: string; function?: { name?: string; arguments?: string } }, i: number) => {
            const fn = tc.function || { name: '', arguments: '' }
            let args = ''
            try { args = JSON.stringify(JSON.parse(fn.arguments || '{}'), null, 2) } catch { args = fn.arguments || '' }
            const inline = args.replace(/\n/g, ' ').trim()
            return (
              <details key={i} className="tool-call-block" style={{ borderColor: 'var(--accent-green)', background: 'var(--success-soft)' }} open={args.length <= 60}>
                <summary className="tool-call-header" style={{ color: 'var(--accent-green)', cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ whiteSpace: 'nowrap' }}>🔧 {fn.name}</span>
                  {inline && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 'calc(var(--ui-font-size) - 2px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{inline.length > 50 ? inline.slice(0, 50) + '…' : inline}</span>}
                  <span style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 3px)' }}>{args.length > 60 ? '展开' : ''}</span>
                </summary>
                {args.length > 60 && <pre className="tool-call-output">{args}</pre>}
              </details>
            )
          })}
        </div>
      </div>
    )
  }

  const renderAssistantContent = (text: string | null) => {
    if (!text) return (
      <span className="thinking-bubble">
        {streaming ? <>🤔 思考中<span className="thinking-dots" /></> : '调用工具中...'}
      </span>
    )
    // 解析交互卡片 <!--CARD:title-->html<!--/CARD-->
    // matchAll 一次性提取卡片, 避免 exec+replace 混用导致相同卡片错位
    const cardRe = /<!--CARD(?::([^>]*))?-->([\s\S]*?)<!--\/CARD-->/g
    const cards: { title: string; html: string }[] = []
    let reflect = ''
    let clean = text
    for (const m of text.matchAll(cardRe)) { cards.push({ title: m[1] || '', html: m[2] }) }
    if (cards.length) clean = text.replace(cardRe, '')
    // 反思内容不再静默丢弃 —— 提取为可折叠「💭 反思」块
    // 多段反思内容拼接保留, 不再只留最后一段
    clean = clean.replace(/<reflect>([\s\S]*?)<\/reflect>/g, (_s: string, body: string) => { const b = body.trim(); reflect = reflect ? reflect + '\n' + b : b; return '' }).trim()
    // 超长文本渲染保护: 防止 ReactMarkdown 解析超大内容导致渲染进程栈溢出
    const MAX_RENDER = 30000
    if (clean.length > MAX_RENDER) clean = clean.slice(0, MAX_RENDER) + '\n\n…[内容过长已截断，需要完整内容可让助手重新输出]'
    return (
      <div className="markdown-body">
        {clean && <ReactMarkdown remarkPlugins={[remarkGfm]}>{clean || (streaming ? '' : '...')}</ReactMarkdown>}
        {reflect && (
          <details style={{ margin: '8px 0', fontSize: 'calc(var(--ui-font-size) - 1px)' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', userSelect: 'none' }}>
              💭 {streaming ? '反思中…' : '反思内容(点击展开)'}
            </summary>
            <div style={{ marginTop: 6, padding: '8px 12px', borderRadius: 8, background: 'rgba(var(--skin-accent),.08)', border: '1px solid rgba(var(--skin-accent),.25)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{reflect}</div>
          </details>
        )}
        {cards.map((card, i) => (
          <div key={i} className="card-container" style={{ margin: '12px 0', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)', background: '#fff' }}>
            {card.title && <div style={{ padding: '8px 14px', fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: '#555', borderBottom: '1px solid #eee', background: '#fafafa' }}>{card.title}</div>}
            <iframe srcDoc={card.html} sandbox="allow-scripts" style={{ width: '100%', height: Math.min(cardMaxHeight, Math.max(200, (card.html.match(/\n/g) || []).length * 20 + 100)), border: 'none' }} title={card.title || 'card'} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={`message-item ${isUser ? 'message-user' : 'message-assistant'} ${selected ? 'message-selected' : ''}`}>
      <div className="message-avatar">
        {isUser ? '你' : agentAvatarImg
          ? <img src={agentAvatarImg} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} alt="" />
          : (agentAvatar || '泉')}
      </div>
      <div className="message-body" onContextMenu={handleContextMenu}>
        <div className="message-sender">{isUser ? '你' : (agentAvatar || '黄泉')}</div>
        {message.images?.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>{message.images.map((img, i) => <img key={i} src={img} className="image-preview" alt="" />)}</div> : null}
        {/* 附件（视频/音频/文档）展示，点击用系统默认程序打开 */}
        {message.attachments?.length ? (
          <div className="message-attachments">
            {message.attachments.map((a, i) => (
              <span key={i} className="message-attachment" title={a.path} onClick={() => { try { api.computer.openFile(a.path) } catch (e) { console.debug('[swallow]', e) } }}>
                {a.kind === 'video' ? '🎬' : a.kind === 'audio' ? '🎵' : '📄'} {a.name}
              </span>
            ))}
          </div>
        ) : null}
        {isUser ? (editing ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <textarea className="chat-textarea" style={{ flex: 1, minHeight: 48, background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 6, padding: 8, fontSize: 'calc(var(--ui-font-size) - 1px)' }} value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
            <button className="send-btn" onClick={saveEdit} style={{ width: 32, height: 32, borderRadius: 6, fontSize: 'var(--ui-font-size)' }} title="保存修改">✓</button>
            <button className="send-btn stop-btn" onClick={() => setEditing(false)} style={{ width: 32, height: 32, borderRadius: 6, fontSize: 'var(--ui-font-size)' }} title="取消">✕</button>
          </div>
        ) : <div className="message-text">{message.content}</div>) : String(message.role) === 'tool' ? (
          // 工具结果: 纯文本渲染, 不经过 markdown 解析(长结果可安全折叠)
          <pre className="tool-call-output" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)', maxHeight: 320, overflowY: 'auto' }}>{String(message.content || '').slice(0, 8000)}{(message.content || '').length > 8000 ? '\n…[内容过长已截断]' : ''}</pre>
        ) : renderAssistantContent(message.content)}
        <div className={`message-footer ${isUser ? 'footer-right' : 'footer-left'}`}>
          {showTimestamps === 'always' && <span className="footer-time">{timeText}</span>}
          {!isUser && (
            <>
              {ttsEnabled && <FooterBtn title={ttsBusy ? '朗读中…' : '语音朗读'} onClick={speakText}>{ttsBusy ? <Volume2 size={13} /> : <Volume2 size={13} />}</FooterBtn>}
              <FooterBtn title="重新生成" onClick={regen}><RefreshIcon /></FooterBtn>
              <FooterBtn title={copied ? '已复制' : '复制内容'} onClick={handleCopy} active={copied}>{copied ? <CheckIcon /> : <CopyIcon />}</FooterBtn>
              <FooterBtn title="全选引入到输入框" onClick={() => { const text = message.content || ''; if (text) sendQuote(text) }}><QuoteIcon /></FooterBtn>
              <FooterBtn title={selected ? '取消选中' : '选中消息'} onClick={() => setSelected(!selected)} active={selected}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {selected ? <><rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" opacity="0.2" /><polyline points="9 12 11.5 14.5 16 9" /></> : <rect x="3" y="3" width="18" height="18" rx="2" />}
                </svg>
              </FooterBtn>
              {(message.meta?.ttft !== undefined || message.meta?.duration !== undefined || message.usage) && (
                <span style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 3px)', marginLeft: 4, display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                  {message.meta?.ttft !== undefined && <span title="首字延迟（收到首个字符的耗时）">⚡{fmtTime(message.meta.ttft)}</span>}
                  {message.meta?.taskMs !== undefined
                    ? <span title="任务总时长（含工具执行）">⏱{fmtTime(message.meta.taskMs)}</span>
                    : message.meta?.duration !== undefined && <span title="本次回复时长">⏱{fmtTime(message.meta.duration)}</span>}
                  {(message.usage || message.meta?.taskTokens) && (() => {
                    // 任务结束消息优先显示「本任务总消耗」(主 Agent + 全部子 Agent)
                    const total = message.meta?.taskTokens || message.usage?.total_tokens || ((message.usage?.prompt_tokens || 0) + (message.usage?.completion_tokens || 0))
                    const speed = message.meta?.duration && (message.usage?.completion_tokens || 0) > 0
                      ? Math.round((message.usage?.completion_tokens || 0) / (message.meta.duration / 1000))
                      : 0
                    return <span title={message.meta?.taskTokens ? '本任务总消耗（主角色 + 全部子角色）' : '本次回复消耗的词元总数'}>{total} 词元{message.meta?.taskTokens ? '（全角色）' : ''}{speed > 0 ? ' · ' + speed + ' 词元/秒' : ''}</span>
                  })()}
                </span>
              )}
            </>
          )}
          {isUser && (
            <>
              <FooterBtn title="重新发送" onClick={() => resendFrom(message.id)}><RefreshIcon /></FooterBtn>
              <FooterBtn title="编辑并重新发送" onClick={startEdit}>
                <SvgIcon><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></SvgIcon>
              </FooterBtn>
              <FooterBtn title={copied ? '已复制' : '复制内容'} onClick={handleCopy} active={copied}>{copied ? <CheckIcon /> : <CopyIcon />}</FooterBtn>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// 流式输出时仅重渲染内容变化的消息(长会话性能关键)
export default React.memo(MessageItem)
