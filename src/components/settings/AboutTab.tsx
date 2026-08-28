import React, { useEffect, useState } from 'react'
import { C, S } from '../settings-ui'
import { U } from '../ui-styles'


// v0.3.1 块 H: 关于 tab(从 SettingsView 拆分, 行为零变化)
// v0.4.4 精简: 软件更新(检查/下载)已收敛, 仅保留版本信息与来源
export default function AboutTab() {
  // 动态版本信息(主进程 app.getVersion + process.versions), 不硬编码
  const [info, setInfo] = useState<{ version: string; electron: string; node: string } | null>(null)
  useEffect(() => { window.huangquan.appInfo().then(setInfo).catch(() => {}) }, [])
  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <img src="huangquan.png" alt="黄泉" style={{ width: 190, height: 190, objectFit: 'contain', filter: 'drop-shadow(0 10px 24px rgba(0,0,0,.4))' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        </div>
        <div style={S.section}>关于</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[['版本', info?.version || '…'], ['平台', 'Acheron-Agent'], ['Electron', info?.electron || '…'], ['React', React.version], ['Node', info?.node || '…']].map(([k, v]) => (
            <div key={k}><div style={S.hint}>{k}</div><div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: C.text }}>{v}</div></div>
          ))}
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>开发者</div>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>
          由 <b style={{ color: C.accent }}>ATchangan</b> 独立开发并持续维护
        </div>
        <a
          href="#"
          onClick={e => { e.preventDefault(); void window.huangquan.web.openExternal('https://github.com/ATchangan/Acheron-agent') }}
          style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontSize: 'calc(var(--ui-font-size) - 1px)', marginTop: 6, display: 'inline-block' }}
        >
          https://github.com/ATchangan/Acheron-agent
        </a>
      </div>
    </div>
  )
}
