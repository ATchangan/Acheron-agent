// RealPages.tsx —— v0.4.4 设置真实页面：通知 / 记忆与上下文 / 账单 / 网关 / Browser
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useSettingsStore } from '../../store/settings'
import { C, S } from '../settings-ui'

function useGeneralSave() {
  return (patch: Partial<import('../../types').GeneralSettings>) => {
    useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } }))
    useSettingsStore.getState().save()
  }
}

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="aux-row">{children}</div>
)

// ── 通知 ────────────────────────────────────────────────────
export function NotificationsSettings() {
  const save = useGeneralSave()
  const g = useSettingsStore(s => s.general) || {}
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 26px 30px' }}>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, marginBottom: 16 }}>系统级 Windows 通知，应用缩到托盘时也能收到。</div>
      <Row>
        <div className="aux-row-main">
          <div className="aux-row-name">任务完成通知</div>
          <div className="aux-row-sub">后台/并行任务完成时弹系统通知</div>
        </div>
        <div className="aux-row-actions">
          <button type="button" className={'hq-btn' + (g.notifyTaskDone === true ? ' hq-btn-accent' : '')} style={{ height: 30, padding: '0 16px' }} onClick={() => save({ notifyTaskDone: !(g.notifyTaskDone === true) })}>
            {g.notifyTaskDone === true ? '已开启' : '已关闭'}
          </button>
        </div>
      </Row>
      <Row>
        <div className="aux-row-main">
          <div className="aux-row-name">消息平台来信通知</div>
          <div className="aux-row-sub">QQ 等渠道收到新消息时弹系统通知（需要先在「消息平台」启用渠道）</div>
        </div>
        <div className="aux-row-actions">
          <button type="button" className={'hq-btn' + (g.notifyMsgIncoming !== false ? ' hq-btn-accent' : '')} style={{ height: 30, padding: '0 16px' }} onClick={() => save({ notifyMsgIncoming: !(g.notifyMsgIncoming !== false) })}>
            {g.notifyMsgIncoming !== false ? '已开启' : '已关闭'}
          </button>
        </div>
      </Row>
    </div>
  )
}

// ── 记忆与上下文 ────────────────────────────────────────────
const MEM_CN: Record<string, { text: string; color: string }> = {
  ready: { text: '运行中', color: 'var(--success)' },
  starting: { text: '启动中…', color: 'var(--warning)' },
  failed: { text: '启动失败', color: 'var(--danger)' },
  disabled: { text: '未启用', color: 'var(--text-muted)' },
  stopped: { text: '已停止', color: 'var(--text-muted)' },
  external: { text: '外部实例', color: 'var(--accent)' },
}
export function MemoryContextSettings() {
  const save = useGeneralSave()
  const g = useSettingsStore(s => s.general) || {}
  const [mem, setMem] = useState<{ status: string; baseUrl: string; detail: string } | null>(null)
  const refresh = useCallback(async () => {
    try { setMem(await window.huangquan.memoryCore.status()) } catch { setMem(null) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const st = mem ? (MEM_CN[mem.status] || { text: mem.status, color: 'var(--text-muted)' }) : { text: '未知', color: 'var(--text-muted)' }
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 26px 30px' }}>
      <Row>
        <div className="aux-row-main">
          <div className="aux-row-name">记忆内核 <span className="aux-row-badge" style={{ color: st.color }}>{st.text}</span></div>
          <div className="aux-row-sub">{mem?.detail || '任务完成后自动沉淀对话记忆，模型按需检索。'}</div>
        </div>
        <div className="aux-row-actions">
          <button type="button" className="hq-btn" style={{ height: 30, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => { void refresh() }}><RefreshCw size={12} />刷新</button>
        </div>
      </Row>
      <Row>
        <div className="aux-row-main">
          <div className="aux-row-name">上下文窗口覆盖</div>
          <div className="aux-row-sub">单位：千 token。保持 0 则自动按当前模型检测；设了固定值后所有模型都用该上限</div>
        </div>
        <div className="aux-row-actions">
          <input
            type="number" min={0} max={2000}
            style={{ ...S.num, height: 30 }}
            value={g.contextLimitOverride || 0}
            onChange={e => save({ contextLimitOverride: Math.max(0, parseInt(e.target.value) || 0) })}
          />
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, whiteSpace: 'nowrap' }}>k token</span>
        </div>
      </Row>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, marginTop: 14, lineHeight: 1.7 }}>
        多轮上下文压缩始终开启：接近上限时自动把早期对话压成摘要，无需手动管理。
      </div>
    </div>
  )
}

// ── 账单（用量统计）────────────────────────────────────────
export function BillingSettings() {
  const [models, setModels] = useState<Record<string, { requests: number; inputTokens: number; writeTokens: number; hitReqs: number; providerName?: string }>>({})
  const [cache, setCache] = useState<{ hits: number; misses: number; hit_rate?: string } | null>(null)
  const refresh = useCallback(async () => {
    try {
      const ms = await window.huangquan.modelStats.get()
      setModels(ms.models || {})
    } catch { setModels({}) }
    try { setCache(await window.huangquan.cacheStats()) } catch { setCache(null) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const rows = Object.entries(models).sort((a, b) => b[1].requests - a[1].requests)
  const fmtK = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 26px 30px' }}>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, marginBottom: 16 }}>本地记录的模型用量统计（不清空供应商账单，只影响本应用内展示）。</div>
      <Row>
        <div className="aux-row-main">
          <div className="aux-row-name">上下文缓存</div>
          <div className="aux-row-sub">命中 {cache?.hits ?? 0} · 未命中 {cache?.misses ?? 0}{cache?.hit_rate ? ' · 命中率 ' + cache.hit_rate : ''}</div>
        </div>
      </Row>
      <div className="aux-row" style={{ fontWeight: 600, color: C.text }}>
        <span style={{ width: '34%' }}>模型</span><span style={{ width: '16%', textAlign: 'right' }}>请求</span><span style={{ width: '17%', textAlign: 'right' }}>输入 tok</span><span style={{ width: '17%', textAlign: 'right' }}>输出 tok</span><span style={{ width: '16%', textAlign: 'right' }}>缓存命中</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, padding: '10px 2px' }}>还没有用量记录</div>
      ) : rows.map(([k, v]) => (
        <div key={k} className="aux-row" style={{ fontSize: 'calc(var(--ui-font-size) - 1px)' }}>
          <span style={{ width: '34%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k}>{v.providerName ? v.providerName + ' · ' : ''}{k.split('::').pop()}</span>
          <span style={{ width: '16%', textAlign: 'right', color: C.muted }}>{v.requests}</span>
          <span style={{ width: '17%', textAlign: 'right', color: C.muted }}>{fmtK(v.inputTokens)}</span>
          <span style={{ width: '17%', textAlign: 'right', color: C.muted }}>{fmtK(v.writeTokens)}</span>
          <span style={{ width: '16%', textAlign: 'right', color: C.muted }}>{v.requests ? Math.round((v.hitReqs / v.requests) * 100) + '%' : '—'}</span>
        </div>
      ))}
      {rows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button type="button" className="hq-btn" style={{ height: 30, padding: '0 14px' }} onClick={() => { if (confirm('清空全部用量统计？')) void window.huangquan.modelStats.resetAll().then(() => refresh()) }}>清空统计</button>
        </div>
      )}
    </div>
  )
}

// ── 网关 ────────────────────────────────────────────────────
export function GatewaySettings({ onGoTab }: { onGoTab: (tab: string) => void }) {
  const [state, setState] = useState<{ state: string; detail?: string }>({ state: 'off' })
  const refresh = useCallback(async () => {
    try { const r = await window.huangquan.msg.getConfig(); setState({ state: r.state, detail: r.detail }) } catch { /* 忽略 */ }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const map: Record<string, { text: string; color: string }> = {
    connected: { text: '已连接', color: 'var(--success)' },
    connecting: { text: '连接中…', color: 'var(--warning)' },
    error: { text: '连接异常', color: 'var(--danger)' },
    off: { text: '未启用', color: 'var(--text-muted)' },
  }
  const s = map[state.state] || map.off
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 26px 30px' }}>
      <Row>
        <div className="aux-row-main">
          <div className="aux-row-name">消息网关（QQ 官方机器人） <span className="aux-row-badge" style={{ color: s.color }}>{s.text}</span></div>
          <div className="aux-row-sub">{state.detail || '在「消息平台」页启用渠道后，这里显示连接状态。'}</div>
        </div>
        <div className="aux-row-actions">
          <button type="button" className="hq-btn" style={{ height: 30, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => { void refresh() }}><RefreshCw size={12} />刷新</button>
          <button type="button" className="hq-btn" style={{ height: 30, padding: '0 12px' }} title="断开并重新连接消息网关" onClick={() => { void window.huangquan.msg.setConfig({ enabled: true }).then(() => setTimeout(() => { void refresh() }, 1200)) }}>重启网关</button>
          <button type="button" className="hq-btn hq-btn-accent" style={{ height: 30, padding: '0 14px' }} onClick={() => onGoTab('messagesPage')}>前往消息平台</button>
        </div>
      </Row>
      <Row>
        <div className="aux-row-main">
          <div className="aux-row-name">助手引擎</div>
          <div className="aux-row-sub">就绪 —— 引擎随应用常驻，负责任务调度与工具执行</div>
        </div>
      </Row>
    </div>
  )
}

// ── Browser ─────────────────────────────────────────────────
export function BrowserSettings() {
  const [rs, setRs] = useState<{ mode: string; gpuAcceleration: string; webgl: string; canvas2d: string } | null>(null)
  const refresh = useCallback(async () => {
    try { setRs(await window.huangquan.web.rendererStatus()) } catch { setRs(null) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const grid: [string, string][] = rs
    ? [['渲染模式', rs.mode], ['GPU 加速', rs.gpuAcceleration], ['WebGL', rs.webgl], ['Canvas2D', rs.canvas2d]]
    : []
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 26px 30px' }}>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, marginBottom: 16 }}>无头浏览器用于网页抓取、截图与自动化操作；每个任务使用独立浏览器会话，互不串页。</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {grid.map(([k, v]) => (
          <div key={k} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '10px 14px', minWidth: 140 }}>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginBottom: 3 }}>{k}</div>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: C.text }}>{v}</div>
          </div>
        ))}
        {!rs && <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 1px)' }}>加载中…</div>}
      </div>
      <div style={{ marginTop: 14 }}>
        <button type="button" className="hq-btn" style={{ height: 30, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => { void refresh() }}><RefreshCw size={12} />刷新状态</button>
      </div>
    </div>
  )
}
