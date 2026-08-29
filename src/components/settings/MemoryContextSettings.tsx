// MemoryContextSettings.tsx —— v0.4.4 记忆与上下文（对齐参考 字段布局）
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

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      width: 38, height: 22, borderRadius: 11, background: on ? C.accent : C.border,
      cursor: 'pointer', position: 'relative', transition: 'background .15s', flexShrink: 0, border: 'none',
    }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: on ? 19 : 3, transition: 'left .15s' }} />
    </button>
  )
}

function NumInput({ value, onChange, placeholder }: { value: number; onChange: (v: number) => void; placeholder?: string }) {
  return (
    <input type="number" style={{ ...S.inp, height: 34, width: 160 }} value={value || ''} placeholder={placeholder || '未设置'}
      onChange={e => onChange(parseFloat(e.target.value) || 0)} />
  )
}

export default function MemoryContextSettings() {
  const save = useGeneralSave()
  const g = useSettingsStore(s => s.general) || {}
  const [mem, setMem] = useState<{ status: string; baseUrl: string; detail: string } | null>(null)
  const refresh = useCallback(async () => {
    try { setMem(await window.huangquan.memoryCore.status()) } catch { setMem(null) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const memEnabled = g.memoryCoreEnabled !== false
  const st = mem ? (mem.status === 'ready' ? { text: '运行中', color: C.green } : mem.status === 'failed' ? { text: '启动失败', color: C.danger } : { text: mem.status, color: C.muted }) : { text: '未知', color: C.muted }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 26px 30px' }}>
      {/* 持久记忆 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + C.border }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>持久记忆</span>
        <Toggle on={memEnabled} onClick={() => save({ memoryCoreEnabled: !memEnabled })} />
      </div>
      {/* 用户画像 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + C.border }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>用户画像</span>
        <Toggle on={g.profileBudget !== 0} onClick={() => save({ profileBudget: g.profileBudget === 0 ? 1375 : 0 })} />
      </div>
      {/* 记忆预算 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + C.border }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>记忆预算</span>
        <NumInput value={g.memoryBudget || 2200} onChange={v => save({ memoryBudget: v })} />
      </div>
      {/* 画像预算 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + C.border }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>画像预算</span>
        <NumInput value={g.profileBudget || 1375} onChange={v => save({ profileBudget: v })} />
      </div>
      {/* 记忆内核状态 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + C.border }}>
        <div>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>
            记忆内核 <span className="aux-row-badge" style={{ color: st.color }}>{st.text}</span>
          </div>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginTop: 2 }}>{mem?.detail || '任务完成后自动沉淀对话记忆，模型按需检索。'}</div>
        </div>
        <button type="button" className="hq-btn" style={{ height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => { void refresh() }}><RefreshCw size={12} />刷新</button>
      </div>
      {/* 上下文引擎 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + C.border }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>上下文引擎</span>
        <select style={{ ...S.sel, height: 34 }} value="Compressor" onChange={() => { /* 目前只有内置 Compressor */ }}>
          <option value="Compressor">Compressor</option>
        </select>
      </div>
      {/* 自动压缩 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + C.border }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>自动压缩</span>
        <Toggle on={true} onClick={() => { /* 始终开启 */ }} />
      </div>
      {/* 压缩阈值 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + C.border }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>压缩阈值</span>
        <NumInput value={g.compactThreshold || 0.5} onChange={v => save({ compactThreshold: Math.min(1, Math.max(0.1, v)) })} />
      </div>
      {/* 压缩目标 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + C.border }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>压缩目标</span>
        <NumInput value={g.compactTarget || 0.2} onChange={v => save({ compactTarget: Math.min(1, Math.max(0.05, v)) })} />
      </div>
      {/* 保护最近消息 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid ' + C.border }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>保护最近消息</span>
        <NumInput value={g.compactProtect || 20} onChange={v => save({ compactProtect: Math.max(0, v) })} />
      </div>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, marginTop: 14, lineHeight: 1.7 }}>
        上下文接近阈值时自动压缩早期对话；压缩后保留目标比例的上下文窗口，最近 N 条消息不参与压缩。
      </div>
    </div>
  )
}

