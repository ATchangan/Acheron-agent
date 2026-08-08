import React, { useState } from 'react'
import { C, S } from '../settings-ui'
import { U } from '../ui-styles'


// v0.3.6: 模型缓存统计页 —— 布局对齐 HanaAgent 用量统计:
// 总览(大命中率 + 环形图 + 模型分布 + 请求明细) / 按日期(7/30 天柱状图) / 按类别(按供应商) / 按模型 / 明细
type ModelStat = {
  requests?: number
  hitReqs?: number
  observedReqs?: number
  readTokens?: number
  writeTokens?: number
  inputTokens?: number
  missTokens?: number
  cacheSupported?: boolean | null
  providerName?: string
}
type StatsMap = Record<string, ModelStat>
type LedgerItem = {
  ts: number
  sid: string
  model: string
  provider?: string
  readTokens: number
  missTokens: number
  writeTokens: number
  inputTokens: number
  outputTokens: number
  hit: boolean
  supported: boolean | null
  status: string
}
type StatsTabView = 'overview' | 'daily' | 'category' | 'models' | 'detail'

function Ring({
  cached,
  uncached,
  size,
  center,
  centerSub,
}: {
  cached: number
  uncached: number
  size: number
  center: string
  centerSub?: string
}) {
  const total = cached + uncached
  const pct = total > 0 ? Math.max(0, Math.min(100, (cached / total) * 100)) : 0
  const r = size * 0.42
  const circ = 2 * Math.PI * r
  const dashC = (pct / 100) * circ
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(150,150,160,0.18)" strokeWidth={size * 0.09} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--success)" strokeWidth={size * 0.09} strokeLinecap="round"
          strokeDasharray={`${dashC} ${circ - dashC}`}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="rgba(150,150,160,0.55)" strokeWidth={size * 0.09}
          strokeDasharray={`${circ - dashC} ${dashC}`} strokeDashoffset={-dashC}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <span style={{ fontSize: Math.max(15, size * 0.2), fontWeight: 700, color: 'var(--success)' }}>{center}</span>
        {centerSub ? <span style={{ fontSize: 10, color: C.muted }}>{centerSub}</span> : null}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <i style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
        缓存命中
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <i style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(150,150,160,0.55)', display: 'inline-block' }} />
        未缓存消耗
      </span>
    </div>
  )
}

const dayKey = (ts: number) => {
  const d = new Date(ts)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const fmtTime = (ts: number) => {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

export default function StatsTab() {
  const [modelStats, setModelStats] = useState<StatsMap>({})
  const [ledger, setLedger] = useState<LedgerItem[]>([])
  const [view, setView] = useState<StatsTabView>('overview')
  const [period, setPeriod] = useState<7 | 30>(7)
  const refresh = React.useCallback(async () => {
    try {
      const d = await window.huangquan.modelStats.get()
      setModelStats(d?.models || {})
      setLedger(d?.ledger || [])
    } catch { setModelStats({}); setLedger([]) }
  }, [])
  React.useEffect(() => { void refresh() }, [refresh])

  const entries = Object.entries(modelStats)
  const totals = React.useMemo(() => {
    let requests = 0, hitReqs = 0, observed = 0, read = 0, write = 0, input = 0, miss = 0
    for (const c of Object.values(modelStats)) {
      requests += c.requests || 0
      hitReqs += c.hitReqs || 0
      observed += c.observedReqs || 0
      read += c.readTokens || 0
      write += c.writeTokens || 0
      input += c.inputTokens || 0
      miss += c.missTokens || 0
    }
    return { requests, hitReqs, observed, read, write, input, miss }
  }, [modelStats])

  const overallRate = totals.observed > 0 ? (totals.hitReqs / totals.observed * 100).toFixed(1) : null
  const fmtTok = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
  const fmtPct = (n: number) => (n * 100).toFixed(0) + '%'
  const rateOf = (c: ModelStat): string => {
    if (c.cacheSupported === false || c.cacheSupported === null || c.cacheSupported === undefined) return '不支持'
    const observed = c.observedReqs || 0
    return observed > 0 ? ((c.hitReqs || 0) / observed * 100).toFixed(1) + '%' : '—'
  }
  const capCell = (c: ModelStat, val: string, tip: string) => {
    if (c.cacheSupported === false || c.cacheSupported === null || c.cacheSupported === undefined) {
      return <span style={{ color: C.muted }} title={c.cacheSupported === false ? '该供应商的 API 不返回缓存统计字段' : '未确认该供应商支持缓存统计，按不支持处理'}>不支持</span>
    }
    return <span title={tip}>{val}</span>
  }

  const tabBtn = (key: StatsTabView, label: string) => (
    <button
      onClick={() => setView(key)}
      style={{
        background: view === key ? C.accent : 'transparent',
        color: view === key ? '#fff' : C.muted,
        border: '1px solid ' + (view === key ? C.accent : C.border),
        borderRadius: 8,
        padding: '6px 14px',
        fontSize: 'calc(var(--ui-font-size) - 2px)',
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

  const resetOne = async (m: string) => {
    await window.huangquan.modelStats.resetOne(m)
    await refresh()
  }

  // 按日期: 近 7/30 天每日 缓存/未缓存 汇总
  const dailyGroups = React.useMemo(() => {
    const days: { key: string; label: string; read: number; input: number }[] = []
    const today = new Date()
    for (let i = period - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const key = dayKey(d.getTime())
      let read = 0, input = 0
      for (const e of ledger) {
        if (dayKey(e.ts) === key) { read += e.readTokens; input += e.inputTokens }
      }
      days.push({ key, label: (d.getMonth() + 1) + '/' + d.getDate(), read, input })
    }
    return days
  }, [ledger, period])
  const maxDailyInput = Math.max(1, ...dailyGroups.map(d => d.input))

  // 按类别: 暂按供应商归类(请求来源标签未记录)
  const categoryGroups = React.useMemo(() => {
    const map = new Map<string, { provider: string; requests: number; read: number; input: number; hit: number; observed: number }>()
    for (const e of ledger) {
      const p = e.provider || '未知'
      const g = map.get(p) || { provider: p, requests: 0, read: 0, input: 0, hit: 0, observed: 0 }
      g.requests += 1
      g.read += e.readTokens
      g.input += e.inputTokens
      if (e.supported === true) {
        g.observed += 1
        if (e.hit) g.hit += 1
      }
      map.set(p, g)
    }
    return [...map.values()].sort((a, b) => b.input - a.input)
  }, [ledger])

  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={S.section}>模型缓存统计</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...S.btn('ghost'), height: 26, fontSize: 'calc(var(--ui-font-size) - 2px)' }} onClick={() => void refresh()}>刷新</button>
            <button
              style={{ ...S.btn('danger'), height: 26, fontSize: 'calc(var(--ui-font-size) - 2px)' }}
              onClick={async () => {
                if (!confirm('确定重置全部模型的缓存统计？此操作不可恢复')) return
                await window.huangquan.modelStats.resetAll()
                await refresh()
              }}
            >
              重置全部
            </button>
          </div>
        </div>
        <div style={S.hint}>仅供参考，具体以供应商的统计为准。命中率为请求级口径（命中缓存的请求 ÷ 有缓存观测的请求，与 HanaAgent 一致）；供应商 API 不返回缓存字段、或未能确认支持缓存统计的模型，一律标注「不支持」。</div>
        {entries.length === 0 ? (
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, padding: '12px 0', textAlign: 'center' }}>暂无使用记录 —— 调用模型产生 API 请求后，该模型会自动出现在这里</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {tabBtn('overview', '总览')}
              {tabBtn('daily', '按日期')}
              {tabBtn('category', '按类别')}
              {tabBtn('models', '按模型')}
              {tabBtn('detail', '明细')}
            </div>

            {view === 'overview' && (
              <>
                <div style={{ display: 'flex', gap: 24, alignItems: 'center', padding: '14px 18px', borderRadius: 12, background: 'rgba(150,150,160,0.07)', marginBottom: 14, flexWrap: 'wrap' }}>
                  <Ring
                    cached={totals.read}
                    uncached={Math.max(0, totals.input - totals.read)}
                    size={118}
                    center={overallRate !== null ? overallRate + '%' : '—'}
                    centerSub="命中率"
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 26, fontWeight: 700, color: C.text }}>{fmtTok(totals.input)}</span>
                      <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted }}>输入总用量</span>
                    </div>
                    <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted }}>
                      缓存 <b style={{ color: 'var(--success)' }}>{fmtTok(totals.read)}</b> · 未缓存 <b style={{ color: C.text }}>{fmtTok(Math.max(0, totals.input - totals.read))}</b>
                    </div>
                    <div style={{ display: 'flex', gap: 20, fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, flexWrap: 'wrap' }}>
                      <span>请求数 <b style={{ color: C.text }}>{totals.requests}</b></span>
                      <span>命中请求 <b style={{ color: 'var(--success)' }}>{totals.hitReqs}</b></span>
                      <span>缓存读取 <b style={{ color: C.text }}>{fmtTok(totals.read)}</b></span>
                      <span>缓存写入 <b style={{ color: 'var(--accent)' }}>{fmtTok(totals.write)}</b></span>
                    </div>
                  </div>
                  <Legend />
                </div>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: C.text, marginBottom: 6 }}>模型分布</div>
                {entries.map(([m, c]) => {
                  const read = c.readTokens || 0
                  const input = c.inputTokens || 0
                  const share = totals.input > 0 ? input / totals.input : 0
                  return (
                    <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderBottom: '1px solid ' + C.border }}>
                      <Ring cached={read} uncached={Math.max(0, input - read)} size={42} center="" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m + (c.providerName ? '（' + c.providerName + '）' : '')}>{m}</div>
                        <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted }}>
                          {c.providerName ? c.providerName + ' · ' : ''}{c.requests || 0} 请求 · 缓存 {fmtTok(read)} · 未缓存 {fmtTok(Math.max(0, input - read))}
                        </div>
                      </div>
                      <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--success)' }}>{rateOf(c)}</div>
                        <div>{fmtTok(input)} · {fmtPct(share)}</div>
                      </div>
                    </div>
                  )
                })}

                <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: C.text, margin: '14px 0 6px' }}>请求明细</div>
                {ledger.length === 0 ? (
                  <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, padding: '10px 0' }}>暂无逐请求明细（新请求产生后自动记录）</div>
                ) : (
                  ledger.slice(0, 8).map((e, i) => (
                    <div key={e.ts + '_' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid ' + C.border, fontSize: 'calc(var(--ui-font-size) - 2px)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: e.hit ? 'var(--success)' : 'rgba(150,150,160,0.55)', flexShrink: 0 }} title={e.hit ? '命中缓存' : '未命中缓存'} />
                      <span style={{ color: C.muted, flexShrink: 0 }}>{fmtTime(e.ts)}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }} title={(e.provider ? e.provider + ' · ' : '') + e.model}>{(e.provider ? e.provider + ' · ' : '') + e.model}</span>
                      <span style={{ color: 'var(--success)', flexShrink: 0 }}>{e.status === 'ok' ? '完成' : e.status}</span>
                      <span style={{ color: C.muted, flexShrink: 0 }}>{fmtTok(e.inputTokens)} tok · 缓存 {fmtTok(e.readTokens)}</span>
                    </div>
                  ))
                )}
              </>
            )}

            {view === 'daily' && (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  {([7, 30] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      style={{
                        background: period === p ? C.accent : 'transparent',
                        color: period === p ? '#fff' : C.muted,
                        border: '1px solid ' + (period === p ? C.accent : C.border),
                        borderRadius: 8, padding: '5px 12px', fontSize: 'calc(var(--ui-font-size) - 2px)', cursor: 'pointer',
                      }}
                    >
                      近{p}天
                    </button>
                  ))}
                  <div style={{ marginLeft: 'auto', alignSelf: 'center' }}><Legend /></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150, padding: '0 4px', borderBottom: '1px solid ' + C.border }}>
                  {dailyGroups.map((d, i) => {
                    const cached = (d.read / maxDailyInput) * 100
                    const uncached = Math.max(0, ((d.input - d.read) / maxDailyInput) * 100)
                    return (
                      <div key={d.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }} title={d.key + ' · 输入 ' + fmtTok(d.input) + ' · 缓存 ' + fmtTok(d.read)}>
                        <div style={{ width: '100%', maxWidth: 36, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 'calc(100% - 20px)' }}>
                          {d.input > 0 ? (
                            <>
                              <div style={{ height: cached + '%', background: 'var(--success)', borderRadius: '3px 3px 0 0' }} />
                              <div style={{ height: uncached + '%', background: 'rgba(150,150,160,0.55)' }} />
                            </>
                          ) : (
                            <div style={{ height: 2, background: 'rgba(150,150,160,0.2)' }} />
                          )}
                        </div>
                        <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.muted }}>{i === 0 || i === dailyGroups.length - 1 ? d.label : ''}</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginTop: 6 }}>按天统计来自逐请求明细；旧数据未记录时间戳的不参与。</div>
              </>
            )}

            {view === 'category' && (
              <>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginBottom: 10 }}>暂按供应商归类（请求来源标签尚未记录，后续有来源标记再细化）。</div>
                {categoryGroups.length === 0 ? (
                  <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, padding: '10px 0' }}>暂无数据</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                    {categoryGroups.map(g => {
                      const rate = g.observed > 0 ? (g.hit / g.observed * 100).toFixed(1) + '%' : '—'
                      return (
                        <div key={g.provider} style={{ border: '1px solid ' + C.border, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                          <Ring cached={g.read} uncached={Math.max(0, g.input - g.read)} size={86} center={rate} centerSub="命中率" />
                          <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>{g.provider}</div>
                          <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted }}>{g.requests} 请求 · 输入 {fmtTok(g.input)} · 缓存 {fmtTok(g.read)}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {view === 'models' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {entries.map(([m, c]) => {
                  const read = c.readTokens || 0
                  const input = c.inputTokens || 0
                  const miss = c.missTokens || 0
                  const write = c.writeTokens || 0
                  return (
                    <div key={m} style={{ border: '1px solid ' + C.border, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Ring cached={read} uncached={Math.max(0, input - read)} size={86} center={rateOf(c)} centerSub={c.cacheSupported === false ? '不支持' : '命中率'} />
                      <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text, textAlign: 'center', wordBreak: 'break-all' }} title={m}>{m}</div>
                      <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, textAlign: 'center' }}>
                        {c.providerName ? c.providerName + ' · ' : ''}{c.requests || 0} 请求
                      </div>
                      <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, textAlign: 'center' }}>
                        读取 {fmtTok(read)} · 未命中 {fmtTok(miss)} · 写入 {fmtTok(write)} · 输入 {fmtTok(input)}
                      </div>
                      <button style={{ ...S.btn('ghost'), height: 20, fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '0 8px' }} onClick={() => void resetOne(m)}>重置</button>
                    </div>
                  )
                })}
              </div>
            )}

            {view === 'detail' && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'calc(var(--ui-font-size) - 2px)' }}>
                <thead>
                  <tr style={{ color: C.muted, borderBottom: '1px solid ' + C.border, textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 600 }}>模型名称</th>
                    <th style={U.thCell}>总请求</th>
                    <th style={U.thCell} title="命中缓存的请求数">命中请求</th>
                    <th style={U.thCell} title="请求级命中率（HanaAgent 同口径）= 命中缓存的请求数 ÷ 有缓存观测的请求数">命中率</th>
                    <th style={U.thCell}>缓存读取</th>
                    <th style={U.thCell}>缓存写入</th>
                    <th style={U.thCell} title="未命中缓存的输入用量（prompt_cache_miss_tokens）">缓存未命中</th>
                    <th style={U.thCell} title="输入总用量（缓存读取 + 未命中）">输入总用量</th>
                    <th style={U.thCell}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([m, c]) => {
                    const reqs = c.requests || 0
                    const hitReqs = c.hitReqs || 0
                    const observed = c.observedReqs || 0
                    const read = c.readTokens || 0
                    const write = c.writeTokens || 0
                    const miss = c.missTokens || 0
                    const input = c.inputTokens || 0
                    const reqRate = observed > 0 ? (hitReqs / observed * 100).toFixed(1) : '—'
                    return (
                      <tr key={m} style={{ borderBottom: '1px solid ' + C.border, color: C.text }}>
                        <td style={{ padding: '6px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m + (c.providerName ? '（' + c.providerName + '）' : '')}>{m}</td>
                        <td style={U.thCell2}>{reqs}</td>
                        <td style={U.thCellOk}>{capCell(c, String(hitReqs), '命中缓存的请求数')}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, color: 'var(--success)' }}>{capCell(c, reqRate !== '—' ? reqRate + '%' : '—', '请求级命中率（HanaAgent 同口径）= 命中请求 ÷ 有缓存观测的请求，当前 ' + hitReqs + '/' + observed)}</td>
                        <td style={U.thCellOk}>{capCell(c, fmtTok(read), '缓存读取 token')}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--accent)' }}>{capCell(c, fmtTok(write), '缓存写入 token')}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', color: '#d98a5f' }}>{capCell(c, fmtTok(miss), '缓存未命中 token')}</td>
                        <td style={U.thCell2}>{fmtTok(input)}</td>
                        <td style={U.thCell2}>
                          <button style={{ ...S.btn('ghost'), height: 20, fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '0 6px' }} onClick={() => void resetOne(m)}>重置</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  )
}
