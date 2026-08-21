// zoom.tsx —— 图片点击缩放共享 store（ZoomableImage）
import React, { useEffect, useState } from 'react'

let zoomSrc: string | null = null
const zoomListeners = new Set<() => void>()
export function openZoom(src: string) { zoomSrc = src; zoomListeners.forEach(l => l()) }
function useZoom() {
  const [src, setSrc] = useState<string | null>(zoomSrc)
  useEffect(() => {
    const l = () => setSrc(zoomSrc)
    zoomListeners.add(l)
    return () => { zoomListeners.delete(l) }
  }, [])
  const close = () => { zoomSrc = null; zoomListeners.forEach(l => l()) }
  return { src, close }
}
export function ZoomLayer() {
  const { src, close } = useZoom()
  if (!src) return null
  return (
    <div className="hq-zoom-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <img src={src} alt="预览" className="hq-zoom-img" onClick={close} />
      <button type="button" className="hq-icon-btn hq-zoom-close" aria-label="关闭预览" onClick={close}>×</button>
    </div>
  )
}
