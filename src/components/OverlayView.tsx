// OverlayView.tsx —— v0.4.2 路由浮层：无标题栏，拖拽条 + 悬浮关闭按钮，
// 内容区自行滚动（对齐参考 OverlayView：backdrop blur + rounded-xl 卡片 + floating close）
import React, { useEffect } from 'react'
import { X } from 'lucide-react'

export default function OverlayView({ title, onClose, children, width = 900 }: {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="hq-overlay-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="hq-overlay-card"
        style={{ width: `min(${width}px, calc(100vw - 96px))`, height: 'min(720px, calc(100vh - 88px))' } as React.CSSProperties}
        data-overlay-surface=""
      >
        {/* 拖拽条 + 悬浮关闭按钮（右上角，浮于内容之上） */}
        <div className="hq-overlay-drag" aria-hidden="true" />
        <button type="button" className="hq-overlay-close" aria-label={`关闭${title ? ' ' + title : ''}`} title="关闭" onClick={onClose}>
          <X size={15} />
        </button>
        <div className="hq-overlay-body">{children}</div>
      </div>
    </div>
  )
}
