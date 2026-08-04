import React, { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../store/settings'
import { errMsg } from '../utils/safe'

// 实时浏览器面板 —— 轮询主进程无头浏览器截图,实时显示 agent 正在看的页面
// 增强: 页面标题栏 / 复制URL / 主页按钮 / 刷新间隔设置即时生效 / 空状态与错误提示
export default function BrowserView() {
  const [url, setUrl] = useState('')
  const [snap, setSnap] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const g = useSettingsStore(s => s.general)
  const snapMs = (g?.browserSnapMs as number) || 1200
  const homeUrl = (g?.browserHomeUrl as string) || ''

  const go = async (u?: string) => {
    const target = (u ?? inputRef.current?.value ?? '').trim()
    if (!target) return
    const full = /^https?:\/\//i.test(target) ? target : 'https://' + target
    setLoading(true); setErr('')
    try {
      await window.huangquan?.web.navigate(full)
    } catch (e: unknown) { setErr(errMsg(e)); setLoading(false) }
  }

  const copyUrl = async () => {
    // clipboard 需焦点, 失焦时回退 execCommand
    const text = url || inputRef.current?.value || ''
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
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  // 轮询快照(间隔由设置 browserSnapMs 控制, 改动即时生效)
  useEffect(() => {
    const tick = async () => {
      try {
        const s = await window.huangquan?.web.snapshot()
        if (s) {
          if (s.url && s.url !== 'about:blank') {
            setUrl(s.url)
            if (inputRef.current && document.activeElement !== inputRef.current) inputRef.current.value = s.url
          }
          if (s.img) setSnap(s.img)
          if (s.title) setTitle(s.title)
          setLoading(!!s.loading)
        }
      } catch (e) { /* 静默 */ console.debug('[swallow]', e) }
    }
    tick()
    pollRef.current = setInterval(tick, snapMs)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [snapMs])

  const C = {
    bg: 'var(--bg-root)', card: 'var(--bg-card)', input: 'var(--bg-elevated)', border: 'var(--border)',
    text: 'var(--text-primary)', muted: 'var(--text-muted)', accent: 'var(--accent)',
  }
  const btn = (active = true) => ({
    width: 30, height: 30, borderRadius: 6, border: '1px solid ' + C.border,
    background: C.input, color: active ? C.text : '#444', cursor: active ? 'pointer' : 'default',
    opacity: active ? 1 : 0.5,
  } as React.CSSProperties)

  return (
    <div className="browser-root" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: C.bg }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid ' + C.border, background: C.card }}>
        <span style={{ fontSize: 'var(--ui-font-size)', fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>🌐 无头浏览器</span>
        <button onClick={async () => { try { await window.huangquan?.web.back() } catch {} }} title="后退" style={btn()}>←</button>
        <button onClick={async () => { try { await window.huangquan?.web.forward() } catch {} }} title="前进" style={btn()}>→</button>
        <button onClick={async () => { try { await window.huangquan?.web.reload() } catch {} }} title="刷新" style={btn()}>⟳</button>
        <button onClick={() => homeUrl && go(homeUrl)} title="打开主页(设置中的默认主页)" style={btn(!!homeUrl)}>⌂</button>
        <input ref={inputRef} defaultValue={url} placeholder="输入网址，回车访问"
          onKeyDown={e => { if (e.key === 'Enter') go() }}
          style={{ flex: 1, height: 32, padding: '0 10px', borderRadius: 6, border: '1px solid ' + C.border, background: C.input, color: C.text, fontSize: 'calc(var(--ui-font-size) - 1px)', outline: 'none' }} />
        <button onClick={() => go()} style={{ height: 32, padding: '0 16px', borderRadius: 6, border: 'none', background: C.accent, color: 'var(--on-accent)', fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>访问</button>
        <button onClick={copyUrl} title="复制当前网址" style={{ height: 32, padding: '0 10px', borderRadius: 6, border: '1px solid ' + C.border, background: C.input, color: copied ? 'var(--success)' : C.text, fontSize: 'calc(var(--ui-font-size) - 2px)', cursor: 'pointer', whiteSpace: 'nowrap' }}>{copied ? '已复制 ✓' : '复制'}</button>
      </div>
      {/* 页面标题栏 */}
      {(url || title) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px', borderBottom: '1px solid ' + C.border, background: '#181920' }}>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40%' }}>{title || '(无标题)'}</span>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{url}</span>
          {loading && <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.accent, whiteSpace: 'nowrap' }}>⏳ 加载中…</span>}
        </div>
      )}
      {/* 实时画面 */}
      <div style={{ flex: 1, overflow: 'auto', background: '#141519', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 12 }}>
        {snap
          ? <img src={snap} alt="agent 浏览画面" style={{ maxWidth: '100%', boxShadow: '0 0 0 1px ' + C.border, borderRadius: 8, background: '#fff' }} />
          : <div style={{ marginTop: 80, color: C.muted, fontSize: 'calc(var(--ui-font-size) - 1px)', textAlign: 'center', lineHeight: 1.8 }}>
              {loading ? '⏳ 页面加载中…' : (url ? '等待页面渲染…' : '暂无浏览活动\n\n让 agent 打开网页(或在上方输入网址)\n这里会实时显示它正在看的画面')}
            </div>}
      </div>
      {err && <div style={{ padding: '6px 14px', fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--danger)', borderTop: '1px solid ' + C.border }}>⚠️ {err}</div>}
    </div>
  )
}
