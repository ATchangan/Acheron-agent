// CommandCenterView.tsx —— v0.4.2 命令中心：系统健康 + 快捷操作
import React, { useEffect, useState } from 'react'
import { Cpu, Database, Gauge, HardDrive, RefreshCw, Trash2, Activity, Zap } from 'lucide-react'

interface Health {
  app: { version: string; electron: string; node: string } | null
  sys: { platform: string; arch: string; hostname: string; cpus: number; totalMemory: number; freeMemory: number } | null
  cache: { hits: number; misses: number; hit_rate?: string } | null
  storage: Record<string, unknown> | null
  models: { models?: Record<string, { requests: number; inputTokens: number; writeTokens: number }>; ledger?: unknown[] } | null
  update: { version?: string; hasUpdate?: boolean; current?: string } | null
}

const fmtBytes = (n: number) => n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + ' GB' : n >= 1024 ** 2 ? (n / 1024 ** 2).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'

export default function CommandCenterView() {
  const [h, setH] = useState<Health>({ app: null, sys: null, cache: null, storage: null, models: null, update: null })
  const [msg, setMsg] = useState('')
  const toast = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2200) }

  const load = async () => {
    const safe = async (fn: () => Promise<unknown> | undefined) => { try { return await fn() } catch { return null } }
    const [app, sys, cache, storage, models] = await Promise.all([
      safe(() => window.huangquan.appInfo()),
      safe(() => window.huangquan.computer.systemInfo()),
      safe(() => window.huangquan.cacheStats()),
      safe(() => window.huangquan.storageStats()),
      safe(() => window.huangquan.modelStats.get()),
    ])
    setH(prev => ({ app: app as Health['app'], sys: sys as Health['sys'], cache: cache as Health['cache'], storage: storage as Health['storage'], models: models as Health['models'], update: prev.update }))
  }
  useEffect(() => {
    void load()
    // 更新检查走网络，异步非阻塞
    const t = window.setTimeout(() => {
      window.huangquan.update.check().then(u => setH(prev => ({ ...prev, update: u as Health['update'] }))).catch(() => {})
    }, 300)
    return () => window.clearTimeout(t)
  }, [])

  const rows: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <Zap size={14} />, label: '应用版本', value: h.app ? `v${h.app.version} · Electron ${h.app.electron} · Node ${h.app.node}` : '—' },
    { icon: <Cpu size={14} />, label: '系统', value: h.sys ? `${h.sys.platform} ${h.sys.arch} · ${h.sys.cpus} 核 · 内存 ${fmtBytes(h.sys.freeMemory)} / ${fmtBytes(h.sys.totalMemory)}` : '—' },
    { icon: <Gauge size={14} />, label: '工具缓存', value: h.cache ? `命中 ${h.cache.hits} · 未命中 ${h.cache.misses}${h.cache.hit_rate ? ' · ' + h.cache.hit_rate : ''}` : '—' },
    { icon: <HardDrive size={14} />, label: '存储', value: h.storage ? Object.entries(h.storage).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'number' ? fmtBytes(v) : String(v)}`).join(' · ') : '—' },
  ]

  const modelCount = h.models?.models ? Object.keys(h.models.models).length : 0
  const modelTokens = h.models?.models ? Object.values(h.models.models).reduce((s, m) => s + (m.inputTokens || 0) + (m.writeTokens || 0), 0) : 0

  return (
    <div className="hq-command-center">
      <div className="hq-page-head">
        <h2 className="hq-page-title"><Activity size={16} /> 命令中心</h2>
        <span className="hq-page-subtitle">系统健康与快捷维护</span>
      </div>

      <div className="hq-cc-grid">
        {rows.map(r => (
          <div key={r.label} className="hq-cc-card">
            <span className="hq-cc-icon">{r.icon}</span>
            <div className="hq-cc-body">
              <div className="hq-cc-label">{r.label}</div>
              <div className="hq-cc-value">{r.value}</div>
            </div>
          </div>
        ))}
        <div className="hq-cc-card">
          <span className="hq-cc-icon"><Database size={14} /></span>
          <div className="hq-cc-body">
            <div className="hq-cc-label">模型用量</div>
            <div className="hq-cc-value">{modelCount} 个模型 · 累计 {modelTokens >= 1000 ? (modelTokens / 1000).toFixed(1) + 'k' : modelTokens} token</div>
          </div>
        </div>
        <div className="hq-cc-card">
          <span className="hq-cc-icon"><RefreshCw size={14} /></span>
          <div className="hq-cc-body">
            <div className="hq-cc-label">软件更新</div>
            <div className="hq-cc-value">{h.update ? (h.update.hasUpdate ? `发现新版本 v${h.update.version}` : `已是最新 v${h.update.current}`) : '—'}</div>
          </div>
        </div>
      </div>

      <div className="hq-cc-actions">
        <div className="hq-page-subtitle" style={{ marginBottom: 8 }}>快捷操作</div>
        <div className="hq-btn-group">
          <button type="button" className="hq-btn" onClick={async () => { await window.huangquan.cacheClear().catch(() => {}); toast('工具缓存已清空') }}><Trash2 size={13} /> 清空工具缓存</button>
          <button type="button" className="hq-btn" onClick={async () => { await window.huangquan.modelStats.resetAll().catch(() => {}); toast('模型统计已重置'); void load() }}><Trash2 size={13} /> 重置模型统计</button>
          <button type="button" className="hq-btn" onClick={() => { void load(); toast('已刷新') }}><RefreshCw size={13} /> 刷新状态</button>
        </div>
      </div>
      {msg && <div className="hq-toast hq-profiles-toast">{msg}</div>}
    </div>
  )
}
