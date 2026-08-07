// PluginScanBar.tsx —— 插件扫描错误栏（从 PluginsView 拆出，行为不变）
import React from 'react'
import { s } from './plugin-styles'

export const PluginScanBar: React.FC<{
  error: string
  onRetry: () => void
}> = ({ error, onRetry }) => (
  <div className="provider-form">
    <p style={s.msgError}>⚠️ {error}</p>
    <button className="btn-small" onClick={onRetry} style={{ marginTop: 8 }}>
      重试
    </button>
  </div>
)
