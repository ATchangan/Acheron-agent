import React, { useEffect, useRef } from 'react'

// 侧栏自由拖拽调宽 —— 拖动边缘调整 --sidebar-w / --right-w, 宽度持久化到 localStorage
// 用法: <ResizeBar varName="--sidebar-w" storeKey="hq_sidebar_w" min={140} max={420} edge="right" />
export default function ResizeBar({ varName, storeKey, min = 140, max = 420, edge = 'right' }: {
  varName: string
  storeKey: string
  min?: number
  max?: number
  edge?: 'left' | 'right'
}) {
  const startRef = useRef<{ x: number; w: number } | null>(null)

  // 启动时恢复保存的宽度
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storeKey)
      if (saved) {
        const w = Math.max(min, Math.min(max, parseFloat(saved)))
        if (w > 0) document.documentElement.style.setProperty(varName, w + 'px')
      }
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
     
  }, [])

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName)) || 260
    startRef.current = { x: e.clientX, w: cur }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!startRef.current) return
      const dx = ev.clientX - startRef.current.x
      // 右侧面板的拖拽条在左边缘: 向右拖 = 变窄; 侧边栏在右边缘: 向右拖 = 变宽
      const dir = edge === 'left' ? -1 : 1
      const w = Math.max(min, Math.min(max, startRef.current.w + dir * dx))
      document.documentElement.style.setProperty(varName, w + 'px')
      try { localStorage.setItem(storeKey, String(w)) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    }
    const onUp = () => {
      startRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={onDown}
      onDoubleClick={() => {
        const def = varName === '--right-w' ? 280 : 200
        document.documentElement.style.setProperty(varName, def + 'px')
        try { localStorage.setItem(storeKey, String(def)) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      }}
      title="拖动调整宽度(双击恢复默认)"
      style={{
        position: 'absolute', top: 0, bottom: 0,
        [edge]: -3, width: 7,
        cursor: 'col-resize', zIndex: 60,
        background: 'transparent',
        transition: 'background .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--skin-accent),.25)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    />
  )
}
