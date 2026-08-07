// ChatAttachmentBar.tsx —— 聊天输入框附件预览（从 ChatInput 拆出，行为不变）
import React from 'react'

export const ChatAttachmentBar: React.FC<{
  quote: string | null
  images: string[]
  attachments: { name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[]
  onRemoveQuote: () => void
  onRemoveImage: (i: number) => void
  onRemoveAttachment: (i: number) => void
}> = ({ quote, images, attachments, onRemoveQuote, onRemoveImage, onRemoveAttachment }) => (
  <>
    {quote && (
      <div className="quote-preview" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, padding: '8px 12px', borderRadius: 8, borderLeft: '3px solid var(--accent)', background: 'var(--bg-card)', fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', maxHeight: 80, overflowY: 'auto' }}>
        <span style={{ flexShrink: 0, fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--accent)', fontWeight: 600, marginTop: 2 }}>引用</span>
        <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{quote}</span>
        <button className="image-attach-remove" onClick={onRemoveQuote} style={{ position: 'static', flexShrink: 0 }}>×</button>
      </div>
    )}
    {!!images.length && (
      <div className="image-attach-preview">
        {images.map((img, i) => (
          <div key={i} className="image-attach-item">
            <img src={img} alt="" />
            <button className="image-attach-remove" onClick={() => onRemoveImage(i)}>×</button>
          </div>
        ))}
      </div>
    )}
    {!!attachments.length && (
      <div className="image-attach-preview">
        {attachments.map((a, i) => (
          <div key={i} className="attach-item" title={a.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)', maxWidth: 240 }}>
            <span>{a.kind === 'video' ? '🎬' : a.kind === 'audio' ? '🎵' : '📎'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
            <span style={{ color: 'var(--text-muted)' }}>{(a.size / 1024).toFixed(0)}KB</span>
            <button className="image-attach-remove" onClick={() => onRemoveAttachment(i)}>×</button>
          </div>
        ))}
      </div>
    )}
  </>
)
