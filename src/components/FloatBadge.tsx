import React, { useEffect, useState } from 'react'
import { useSettingsStore } from '../store/settings'

// "agent 正在使用浏览器"横幅 —— 主窗口内提示(不再创建系统悬浮窗)
// 位置由设置 browserFloatPos 控制: top-right(默认) / top-center / bottom-left / bottom-right
export default function FloatBadge() {
  const [show, setShow] = useState(false)
  const g = useSettingsStore(s => s.general)
  const pos = g?.browserFloatPos || 'top-right'

  useEffect(() => {
    const unsub = window.huangquan?.web.onFloat?.((d: { show: boolean }) => {
      // 实时读取开关设置, 不再闭包捕获初始快照
      const enabled = useSettingsStore.getState().general?.browserFloatEnabled !== false
      setShow(!!d.show && enabled)
    })
    return () => { try { unsub?.() } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } }
  }, [])

  if (!show) return null
  const openPanel = () => { try { window.huangquan?.web.showPanel() } catch (e) { /* 静默 */ console.debug('[swallow]', e) } }

  const posStyle: Record<string, React.CSSProperties> = {
    'top-right': { top: 44, right: 16 },
    'top-center': { top: 44, left: '50%', transform: 'translateX(-50%)' },
    'bottom-left': { bottom: 16, left: 16 },
    'bottom-right': { bottom: 16, right: 16 },
  }
  const base: React.CSSProperties = { position: 'fixed', zIndex: 9999, ...(posStyle[pos] || posStyle['top-right']) }

  return (
    <div
      onClick={openPanel}
      title="点击打开无头浏览器窗口"
      style={{
        ...base,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
        background: 'var(--bg-card)', border: '1px solid var(--border-glow)',
        backdropFilter: 'blur(var(--blur))', WebkitBackdropFilter: 'blur(var(--blur))',
        boxShadow: 'var(--shadow-2)', userSelect: 'none',
      }}
    >
  <span style={{ fontSize: 'calc(var(--ui-font-size) + 3px)', animation: 'floatSpin 1.6s linear infinite' }}>◉</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>正在使用浏览器</span>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--accent-purple)', whiteSpace: 'nowrap' }}>点击查看实时画面</span>
      </div>
      <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--success)', marginLeft: 4 }}>● 进行中</span>
    </div>
  )
}
