// 全局错误捕获 — 在 React 渲染之前
window.addEventListener('error', (e) => {
  const msg = `[FATAL] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`
  document.body.innerHTML = `<div style="padding:40px;color:#ff4466;font-family:monospace;font-size:13px;white-space:pre-wrap;background:#0D0D1A;min-height:100vh">${msg}\n${e.error?.stack || ''}</div>`
})
window.addEventListener('unhandledrejection', (e) => {
  const existing = document.body.textContent || ''
  const msg = `\n\n[REJECTION] ${e.reason?.message || e.reason}`
  document.body.innerHTML = `<div style="padding:40px;color:#ffaa00;font-family:monospace;font-size:13px;white-space:pre-wrap;background:#0D0D1A;min-height:100vh">${existing}${msg}</div>`
})

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import './styles/ui-polish.css'

// v0.2.1: React Error Boundary — 捕获渲染错误并显示在页面上
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: any) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '40px', color: '#ff4466', fontFamily: 'monospace', fontSize: '13px', whiteSpace: 'pre-wrap', background: '#0D0D1A', minHeight: '100vh' }}>
          <h1 style={{ color: '#ff4466' }}>⚠ React 渲染错误</h1>
          <pre style={{ color: '#ffaa00', marginTop: 16 }}>{this.state.error.message}</pre>
          <pre style={{ color: '#999', marginTop: 8, fontSize: 11 }}>{this.state.error.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
} catch (e: any) {
  // v0.2.3-fix(P28): 错误页提供重新加载按钮, 不再只能重启应用
  document.body.innerHTML = `<div style="padding:40px;color:#ff4466;font-family:monospace;font-size:14px;background:#0D0D1A;min-height:100vh"><h1>React 渲染失败</h1><pre>${String(e.message)}\n${String(e.stack || '')}</pre><button onclick="location.reload()" style="margin-top:16px;padding:8px 20px;background:#6B4C9A;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">重新加载</button></div>`
}
