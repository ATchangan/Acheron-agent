import React, { useEffect, useState } from 'react'
import { C, S } from '../settings-ui'
import type { TraceEntry } from '../../global'
import { U } from '../ui-styles'


// v0.3.3: 诊断轨迹 —— 本地 JSONL 可观测性, 按级别过滤/刷新/清空
const LEVEL_COLOR: Record<string, string> = { debug: 'var(--text-muted)', info: 'var(--accent)', warn: '#fbbf24', error: 'var(--danger)' }

export default function DiagnosticsTab() {
  const [items, setItems] = useState<TraceEntry[]>([])
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const l = await window.huangquan.trace.list(300)
      setItems(Array.isArray(l) ? l : [])
    } catch { setItems([]) }
  }
  useEffect(() => { load() }, [])

  const shown = filter ? items.filter(x => x.level === filter || x.event.includes(filter) || (x.detail || '').includes(filter)) : items

  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={S.section}>运行轨迹</div>
        <div style={S.hint}>记录任务开始/LLM 轮次/工具调用/错误/预算等事件，按 requestId 与会话串起完整调用链，全部保存在本地 agent-trace.jsonl，不上传。</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...S.inp, width: 220 }} placeholder="过滤：级别/事件/关键词" value={filter} onChange={e => setFilter(e.target.value)} />
          <button style={S.btn('ghost')} onClick={async () => { setBusy(true); await load(); setBusy(false) }}>{busy ? '刷新中…' : '刷新'}</button>
          <button style={S.btn('danger')} onClick={async () => { if (!confirm('清空全部诊断轨迹？')) return; await window.huangquan.trace.clear(); await load() }}>清空轨迹</button>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted }}>共 {items.length} 条{filter ? ' / 显示 ' + shown.length + ' 条' : ''}</span>
        </div>
      </div>
      <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
        {shown.length === 0 ? (
          <div style={{ padding: 24, color: C.muted, fontSize: 'calc(var(--ui-font-size) - 1px)' }}>暂无轨迹。发送一条任务后这里会出现执行记录。</div>
        ) : (
          <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
            {shown.slice().reverse().map((x, i) => (
              <div key={i} style={{ padding: '8px 14px', borderBottom: '1px solid ' + C.border, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ color: LEVEL_COLOR[x.level] || C.muted, fontSize: 'calc(var(--ui-font-size) - 3px)', fontWeight: 700, width: 38, flexShrink: 0, textTransform: 'uppercase' }}>{x.level}</span>
                <div style={U.flex1min0}>
                  <div style={U.fs2b600}>{x.event}</div>
                  {x.detail ? <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{x.detail}</div> : null}
                  <div style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.muted, marginTop: 2 }}>
                    {new Date(x.ts).toLocaleTimeString('zh-CN')} {x.sid ? '· ' + x.sid.slice(0, 8) : ''} {x.requestId ? '· ' + String(x.requestId).slice(0, 12) : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
