// ErrorBoundary.tsx —— 可复用渲染错误边界: 局部崩溃只降级该区域, 不炸掉整个界面
import React from 'react'

interface Props {
  children: React.ReactNode
  /** 自定义降级 UI(默认全屏错误页 + 重新加载按钮) */
  fallback?: (error: Error, reset: () => void) => React.ReactNode
}

export class ErrorBoundary extends React.Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  reset = () => this.setState({ error: null })
  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
      return (
        <div style={{ padding: '40px', color: '#ff4466', fontFamily: 'monospace', fontSize: '13px', whiteSpace: 'pre-wrap', background: 'var(--bg-root)', minHeight: '100vh' }}>
          <h1 style={{ color: '#ff4466', fontSize: 16 }}>界面渲染错误</h1>
          <pre style={{ color: '#ffaa00', marginTop: 12 }}>{this.state.error.message}</pre>
          <pre style={{ color: '#999', marginTop: 8, fontSize: 11 }}>{this.state.error.stack}</pre>
          <button
            onClick={() => location.reload()}
            style={{ marginTop: 16, padding: '8px 20px', background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
