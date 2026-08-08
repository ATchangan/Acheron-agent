// 全局错误捕获 — 在 React 渲染之前
window.addEventListener('error', (e) => {
  const msg = `[FATAL] ${errMsg(e)} at ${e.filename}:${e.lineno}:${e.colno}`
  document.body.innerHTML = `<div style="padding:40px;color:#ff4466;font-family:monospace;font-size:13px;white-space:pre-wrap;background:#17181c;min-height:100vh">${msg}\n${e.error?.stack || ''}</div>`
})
// unhandledrejection 只记录不替换页面 —— 部分 Promise 错误(如对话框取消)可恢复, 刷成错误页反而丢 UI
window.addEventListener('unhandledrejection', (e) => {
  console.error('[REJECTION]', e.reason?.message || e.reason)
})

import React from 'react'
import { errMsg } from './utils/safe'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import './styles/ui-polish.css'

// React Error Boundary — 捕获渲染错误并显示在页面上
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '40px', color: '#ff4466', fontFamily: 'monospace', fontSize: '13px', whiteSpace: 'pre-wrap', background: '#17181c', minHeight: '100vh' }}>
          <h1 style={{ color: '#ff4466' }}>⚠ React 渲染错误</h1>
          <pre style={{ color: '#ffaa00', marginTop: 16 }}>{this.state.error.message}</pre>
          <pre style={{ color: '#999', marginTop: 8, fontSize: 'calc(var(--ui-font-size) - 2px)' }}>{this.state.error.stack}</pre>
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
} catch (e: unknown) {
  // 错误页提供重新加载按钮, 不再只能重启应用
  const em = errMsg(e)
  document.body.innerHTML = `<div style="padding:40px;color:#ff4466;font-family:monospace;font-size:14px;background:#17181c;min-height:100vh"><h1>React 渲染失败</h1><pre>${String(em)}\n${String((e as Error)?.stack || '')}</pre><button onclick="location.reload()" style="margin-top:16px;padding:8px 20px;background:#7c6fa8;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">重新加载</button></div>`
}
