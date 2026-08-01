import React, { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { Message } from '../global'

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

// v0.2.2: 时长格式化（ms -> 1.2s / 850ms）
const fmtTime = (ms?: number) => {
  if (ms === undefined || ms === null) return ''
  return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'
}

export default function MessageItem({ message, streaming }: Props) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const regen = useChatStore(s => s.regen)
  const resendFrom = useChatStore(s => s.resendFrom)
  const startEdit = () => { setEditText(message.content || ''); setEditing(true) }
  const saveEdit = () => { const v = editText.trim(); if (v && v !== message.content) resendFrom(message.id, v); setEditing(false) }
  const agentAvatar = useSettingsStore(s => s.general.agentAvatar)
  const agentAvatarImg = useSettingsStore(s => s.general.agentAvatarImage)
  const cardMaxHeight = useSettingsStore(s => (s.general as any).cardMaxHeight || 500)
  const showTimestamps = useSettingsStore(s => (s.general as any).showTimestamps || 'hover')
  const [selected, setSelected] = useState(false)
  const isUser = message.role === 'user'
  const timeText = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const handleCopy = () => {
    const text = message.content || ''
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  // v0.2.2: 引用内容 → 显示在输入框上方（类似图片预览），由 ChatInput 监听 huangquan-quote 事件接收
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
    const truncated = message.content.length > 300 ? message.content.slice(0, 300) + '...' : message.content
    const isError = message.content.startsWith('E:')
    const toolId = (message as any).tool_call_id || ''
    const shortId = toolId.replace(/^(call_|c_)/, '').slice(0, 8) || 'tool'
    return (
      <div className="message-item" style={{ paddingLeft: 40, opacity: .85 }}>
        <div className="message-body">
          <div className="tool-call-block" style={{ borderColor: isError ? '#ff4466' : 'var(--accent-green)', background: isError ? 'rgba(255,68,102,.05)' : 'rgba(72,201,138,.05)' }}>
            <div className="tool-call-header" style={{ color: isError ? '#ff4466' : 'var(--accent-green)' }}>{isError ? '✗ Error' : '✓ ' + shortId}</div>
            <pre className="tool-call-output">{truncated}</pre>
          </div>
        </div>
      </div>
    )
  }

  const renderAssistantContent = (text: string | null) => {
    if (!text) return streaming ? <span className="thinking-dots" /> : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>调用工具中...</span>
    // v0.2.1: 解析交互卡片 <!--CARD:title-->html<!--/CARD-->
    const cardRe = /<!--CARD(?::([^>]*))?-->([\s\S]*?)<!--\/CARD-->/g
    const cards: { title: string; html: string }[] = []
    let clean = text; let m
    while ((m = cardRe.exec(text))) { cards.push({ title: m[1] || '', html: m[2] }); clean = clean.replace(m[0], '') }
    clean = clean.replace(/<reflect>[\s\S]*?<\/reflect>/g, '').trim()
    return (
      <div className="markdown-body">
        {clean && <ReactMarkdown remarkPlugins={[remarkGfm]}>{clean || (streaming ? '' : '...')}</ReactMarkdown>}
        {cards.map((card, i) => (
          <div key={i} className="card-container" style={{ margin: '12px 0', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)', background: '#fff' }}>
            {card.title && <div style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#555', borderBottom: '1px solid #eee', background: '#fafafa' }}>{card.title}</div>}
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
        {/* v0.2.2: 附件（视频/音频/文档）展示，点击用系统默认程序打开 */}
        {message.attachments?.length ? (
          <div className="message-attachments">
            {message.attachments.map((a, i) => (
              <span key={i} className="message-attachment" title={a.path} onClick={() => { try { window.huangquan.computer.openFile(a.path) } catch {} }}>
                {a.kind === 'video' ? '🎬' : a.kind === 'audio' ? '🎵' : '📄'} {a.name}
              </span>
            ))}
          </div>
        ) : null}
        {isUser ? (editing ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <textarea className="chat-textarea" style={{ flex: 1, minHeight: 48, background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 6, padding: 8, fontSize: 12 }} value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
            <button className="send-btn" onClick={saveEdit} style={{ width: 32, height: 32, borderRadius: 6, fontSize: 13 }} title="保存修改">✓</button>
            <button className="send-btn stop-btn" onClick={() => setEditing(false)} style={{ width: 32, height: 32, borderRadius: 6, fontSize: 13 }} title="取消">✕</button>
          </div>
        ) : <div className="message-text">{message.content}</div>) : renderAssistantContent(message.content)}
        <div className={`message-footer ${isUser ? 'footer-right' : 'footer-left'}`}>
          {showTimestamps === 'always' && <span className="footer-time">{timeText}</span>}
          {!isUser && (
            <>
              <FooterBtn title="重新生成" onClick={regen}><RefreshIcon /></FooterBtn>
              <FooterBtn title={copied ? '已复制' : '复制内容'} onClick={handleCopy} active={copied}>{copied ? <CheckIcon /> : <CopyIcon />}</FooterBtn>
              <FooterBtn title="全选引入到输入框" onClick={() => { const text = message.content || ''; if (text) sendQuote(text) }}><QuoteIcon /></FooterBtn>
              <FooterBtn title={selected ? '取消选中' : '选中消息'} onClick={() => setSelected(!selected)} active={selected}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {selected ? <><rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" opacity="0.2" /><polyline points="9 12 11.5 14.5 16 9" /></> : <rect x="3" y="3" width="18" height="18" rx="2" />}
                </svg>
              </FooterBtn>
              {(message.meta?.ttft !== undefined || message.meta?.duration !== undefined || message.usage) && (
                <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 4, display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                  {message.meta?.ttft !== undefined && <span title="首字延迟 (TTFT)">⚡{fmtTime(message.meta.ttft)}</span>}
                  {message.meta?.duration !== undefined && <span title="本次回复时长">⏱{fmtTime(message.meta.duration)}</span>}
                  {message.usage && (() => {
                    const total = message.usage.total_tokens || (message.usage.prompt_tokens + message.usage.completion_tokens)
                    const speed = message.meta?.duration ? Math.round(message.usage.completion_tokens / (message.meta.duration / 1000)) : 0
                    return <span title="本次回复消耗 token 总数">{total} tok{speed > 0 ? ' · ' + speed + ' tok/s' : ''}</span>
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
