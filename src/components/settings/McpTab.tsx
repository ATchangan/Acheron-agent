import React, { useState, useEffect } from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S, Toggle } from '../settings-ui'

// v0.3.1 块 H: MCP tab(从 SettingsView 拆分, 行为零变化)
export default function McpTab() {
  const g = useSettingsStore(s => s.general) || {}
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const [mcpName, setMcpName] = useState(''); const [mcpCmd, setMcpCmd] = useState(''); const [mcpArgs, setMcpArgs] = useState('')
  const [mcpSseName, setMcpSseName] = useState(''); const [mcpSseUrl, setMcpSseUrl] = useState('')
  const [mcpServers, setMcpServers] = useState<{ name: string; status?: string; cmd?: string; args?: string[]; tools?: (string | { name?: string })[] }[]>([])
  useEffect(() => { window.huangquan.mcpList?.().then((s) => setMcpServers(s || [])).catch(() => setMcpServers([])) }, [])
  return (
    <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
      <div style={S.card}>
        <div style={S.section}>MCP 服务器（stdio）</div>
        <div style={S.hint}>通过标准输入/输出协议连接本地 MCP 服务器，为 Agent 提供外部工具</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input style={{ ...S.inp, flex: 1 }} placeholder="服务器名称" value={mcpName} onChange={e => setMcpName(e.target.value)} />
          <input style={{ ...S.inp, flex: 1.5 }} placeholder="启动命令（如 npx / node）" value={mcpCmd} onChange={e => setMcpCmd(e.target.value)} />
          <input style={{ ...S.inp, flex: 1.5 }} placeholder="参数（空格分隔，如 -y @modelcontextprotocol/server-filesystem C:/）" value={mcpArgs} onChange={e => setMcpArgs(e.target.value)} />
          <button style={S.btn('primary')} onClick={async () => { if (!mcpName || !mcpCmd) { showToast('请填写名称和命令'); return } const r = await window.huangquan.mcpConnect(mcpName, mcpCmd, mcpArgs.split(/\s+/).filter(Boolean)); showToast(typeof r === 'string' ? r : ('已连接：' + mcpName)); setMcpName(''); setMcpCmd(''); setMcpArgs(''); window.huangquan.mcpList?.().then((s) => setMcpServers(s || [])) }}>连接</button>
        </div>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 700, color: C.text, margin: '8px 0 6px' }}>已连接服务器</div>
        {mcpServers.length === 0 ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)' }}>暂无已连接的 MCP 服务器</div> : mcpServers.map((s, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: C.input, marginBottom: 6, border: '1px solid ' + C.border }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text, fontWeight: 600 }}>{s.name} <span style={{ color: s.status === 'connected' ? 'var(--success)' : 'var(--warning)', fontSize: 'calc(var(--ui-font-size) - 4px)' }}>{s.status || 'connected'}</span></div>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted }}>{s.cmd || ''} {s.args?.join(' ') || ''}</div>
              {s.tools?.length ? <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.accent, marginTop: 2 }}>工具：{s.tools.map((t: string | { name?: string }) => (typeof t === 'string' ? t : (t.name || ''))).join(', ').slice(0, 100)}</div> : null}
            </div>
            <button style={{ ...S.btn('danger'), height: 26, fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '0 10px' }} onClick={async () => { try { await (window.huangquan as { mcpDisconnect?: (n: string) => Promise<unknown> }).mcpDisconnect?.(s.name) } catch { /* 忽略 */ } showToast('已断开 ' + s.name); window.huangquan.mcpList?.().then((x) => setMcpServers(x || [])) }}>断开</button>
          </div>
        ))}
      </div>
      <div style={S.card}>
        <div style={S.section}>MCP 服务器（SSE）</div>
        <div style={S.hint}>通过 HTTP SSE 端点连接远程 MCP 服务器</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...S.inp, flex: 1 }} placeholder="服务器名称" value={mcpSseName} onChange={e => setMcpSseName(e.target.value)} />
          <input style={{ ...S.inp, flex: 2 }} placeholder="SSE URL（如 http://localhost:8080/sse）" value={mcpSseUrl} onChange={e => setMcpSseUrl(e.target.value)} />
          <button style={S.btn('primary')} onClick={async () => { if (!mcpSseName || !mcpSseUrl) { showToast('请填写名称和 URL'); return } const r = await window.huangquan.mcpSSEConnect(mcpSseName, mcpSseUrl); showToast(typeof r === 'string' ? r : ('已连接：' + mcpSseName + '（' + (Array.isArray(r) ? r.length : 0) + ' 工具）')); setMcpSseName(''); setMcpSseUrl('') }}>连接</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>MCP 行为配置</div>
        <Toggle checked={g.mcpAutoReconnect !== false} onChange={v => save({ mcpAutoReconnect: v })} label="断线自动重连" />
        <Toggle checked={g.mcpAutoConnectOnStart === true} onChange={v => save({ mcpAutoConnectOnStart: v })} label="启动时自动连接全部 MCP 服务器" />
        <div style={S.row}><div style={S.label}>启动超时</div><input type="number" style={S.num} value={g.mcpTimeout || 10} onChange={e => save({ mcpTimeout: parseInt(e.target.value) || 10 })} /><span style={S.hint}>秒</span></div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: C.accent, color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex: 9999 }}>{toast}</div>}
    </div>
  )
}
