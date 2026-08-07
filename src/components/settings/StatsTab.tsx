import React, { useState } from 'react'
import { C, S } from '../settings-ui'
import { U } from '../ui-styles'


// v0.3.1 块 H: 模型缓存统计 tab(从 SettingsView 拆分, 行为零变化)
export default function StatsTab() {
  const [modelStats, setModelStats] = useState<Record<string, { requests?: number; hitReqs?: number; readTokens?: number; writeTokens?: number; inputTokens?: number; missTokens?: number }>>({})
  // 加载(与 SettingsView 原 if (tab === 'stats') 行为一致)
  React.useEffect(() => {
    window.huangquan.modelStats.get().then((d) => setModelStats(d?.models || {})).catch(() => setModelStats({}))
  }, [])
  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={S.section}>模型缓存统计</div>
        <div style={S.hint}>查看每个模型在调用中的缓存命中情况。命中率越高越省钱；数据保存在本地，重启不丢失，删除历史会话不影响统计。</div>
        {Object.keys(modelStats).length === 0 ? (
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, padding: '12px 0', textAlign: 'center' }}>暂无使用记录 —— 调用模型产生 API 请求后，该模型会自动出现在表格中</div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 'calc(var(--ui-font-size) - 2px)' }}>
              <thead>
                <tr style={{ color: C.muted, borderBottom: '1px solid ' + C.border, textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px', fontWeight: 600 }}>模型名称</th>
                  <th style={U.thCell}>总请求</th>
                  <th style={U.thCell} title="命中缓存的请求数">命中请求</th>
                  <th style={U.thCell} title="请求级命中率 = 命中请求 ÷ 总请求">请求命中率</th>
                  <th style={U.thCell}>缓存读取</th>
                  <th style={U.thCell}>缓存写入</th>
      <th style={U.thCell} title="未命中缓存的输入用量（prompt_cache_miss_tokens）">缓存未命中</th>
      <th style={U.thCell} title="输入总用量（缓存读取 + 未命中）">输入总用量</th>
                  <th style={U.thCell} title="官方口径命中率 = 缓存读取 ÷ (缓存读取 + 缓存未命中)">命中率</th>
                  <th style={U.thCell}>操作</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(modelStats).map(([m, c]) => {
                  const reqs = c.requests || 0
                  const hitReqs = c.hitReqs || 0
                  const readT = c.readTokens || 0
                  const writeT = c.writeTokens || 0
                  const inputT = c.inputTokens || 0
                  // 双口径显示 —— 请求级(命中请求÷总请求)与 token 级
                  const reqRate = reqs > 0 ? (hitReqs / reqs * 100).toFixed(1) : '—'
                  // 官方口径(DeepSeek API 文档): 命中率 = prompt_cache_hit_tokens ÷ (hit + miss); 无 miss 数据时回退 hit÷输入总
                  const missT2 = c.missTokens || 0
                  const totalC = readT + missT2
                  const rate = totalC > 0 ? (readT / totalC * 100).toFixed(1) : (inputT > 0 ? (readT / inputT * 100).toFixed(1) : '—')
                  const fmtTok = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
                  return (
                    <tr key={m} style={{ borderBottom: '1px solid ' + C.border, color: C.text }}>
                      <td style={{ padding: '6px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m}>{m}</td>
                      <td style={U.thCell2}>{reqs}</td>
                      <td style={U.thCellOk} title="命中缓存的请求数">{hitReqs}</td>
                      <td style={U.thCellOk} title="请求级命中率(DeepSeek 自动缓存下通常接近 100%)">{reqRate}%</td>
                      <td style={U.thCellOk}>{fmtTok(readT)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--accent)' }}>{fmtTok(writeT)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center', color: '#d98a5f' }}>{fmtTok(missT2)}</td>
                      <td style={U.thCell2}>{fmtTok(inputT)}</td>
      <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, color: 'var(--success)' }} title="缓存读取用量 ÷ 输入总用量">{rate}{rate !== '—' ? '%' : ''}</td>
                      <td style={U.thCell2}>
                        <button style={{ ...S.btn('ghost'), height: 20, fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '0 6px' }} onClick={async () => { await window.huangquan.modelStats.resetOne(m); const s = await window.huangquan.modelStats.get(); setModelStats(s?.models || {}); }}>重置</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={{ ...S.btn('danger'), height: 24, fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={async () => { if (!confirm('确定重置全部模型的缓存统计？此操作不可恢复')) return; await window.huangquan.modelStats.resetAll(); const s = await window.huangquan.modelStats.get(); setModelStats(s?.models || {}) }}>重置全部模型统计</button>
              <button style={{ ...S.btn('ghost'), height: 24, fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={async () => { const s = await window.huangquan.modelStats.get(); setModelStats(s?.models || {}) }}>刷新</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
