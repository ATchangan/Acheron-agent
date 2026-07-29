import React, { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../store/chat'
import type { Message } from '../global'

interface Props { message: Message; streaming?: boolean }

const CopyIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
const CheckIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
const RefreshIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
const ScreenshotIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
const SelectAllIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="m3 6 1 1 2-2" /><path d="m3 12 1 1 2-2" /><path d="m3 18 1 1 2-2" /></svg>
const SelectIcon = ({ s }: { s: boolean }) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{s ? (<><rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" opacity="0.15" /><rect x="3" y="3" width="18" height="18" rx="2" /><polyline points="9 12 11.5 14.5 16 9" /></>) : <rect x="3" y="3" width="18" height="18" rx="2" />}</svg>

export default function MessageItem({ message, streaming }: Props) {
  const [copied, setCopied] = useState(false)
  const regenerateLast = useChatStore(s => s.regenerateLast)
  const [selected, setSelected] = useState(false)
  const [thinkOpen, setThinkOpen] = useState(true)
  const isUser = message.role === 'user'
  const timeText = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const handleCopy = () => { navigator.clipboard.writeText(message.content); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  // 右键引用
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection()?.toString().trim()
    if (selection) {
      e.preventDefault()
      const input = document.querySelector('.chat-textarea') as HTMLTextAreaElement
      if (input) {
        const quoted = `> ${selection.replace(/\n/g, '\n> ')}\n\n`
        input.value = input.value ? input.value + '\n' + quoted : quoted
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      }
    }
  }, [])

  if (message.role === 'tool') return null // 工具消息不显示

  // 解析沉思块和正文
  const renderAssistantContent = (text: string) => {
    const reflectMatch = text.match(/<reflect>([\s\S]*?)<\/reflect>/)
    const hasReflect = !!reflectMatch

    if (!hasReflect) {
      return (
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || (streaming ? '' : '...')}</ReactMarkdown>
        </div>
      )
    }

    const reflectContent = reflectMatch![1]
    const afterReflect = text.slice(reflectMatch!.index! + reflectMatch![0].length)

    return (
      <>
        <details className="thinking-block" open={thinkOpen} onToggle={e => setThinkOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="thinking-summary">
            <span className="thinking-arrow">{thinkOpen ? '▼' : '▶'}</span>
            {' '}{streaming ? <span>思考中<span className="thinking-dots" /></span> : '沉思'}
          </summary>
          <pre className="thinking-content">{reflectContent.trim()}</pre>
        </details>
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{afterReflect.trim() || ''}</ReactMarkdown>
        </div>
      </>
    )
  }

  return (
    <div className={`message-item ${isUser ? 'message-user' : 'message-assistant'} ${selected ? 'message-selected' : ''}`}>
      <div className="message-avatar">{isUser ? '你' : '泉'}</div>
      <div className="message-body" onContextMenu={handleContextMenu}>
        <div className="message-sender">{isUser ? '你' : '黄泉'}</div>
        {message.images?.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>{message.images.map((img, i) => <img key={i} src={img} className="image-preview" alt="" />)}</div> : null}
        {isUser ? <div className="message-text">{message.content}</div> : renderAssistantContent(message.content)}
        <div className={`message-footer ${isUser ? 'footer-right' : 'footer-left'}`}>
          <span className="footer-time">{timeText}</span>
          <button className="footer-btn" onClick={regenerateLast}><RefreshIcon /></button>
          <button className="footer-btn" onClick={handleCopy}>{copied ? <CheckIcon /> : <CopyIcon />}</button>
          <button className="footer-btn" onClick={async () => { try { await window.huangquan.computer.screenshot() } catch { /* ok */ } }}><ScreenshotIcon /></button>
          <button className="footer-btn" onClick={() => {}}><SelectAllIcon /></button>
          <button className={`footer-btn ${selected ? 'active' : ''}`} onClick={() => setSelected(!selected)}><SelectIcon s={selected} /></button>
        </div>
      </div>
    </div>
  )
}
