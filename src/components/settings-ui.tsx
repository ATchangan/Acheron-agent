// src/components/settings-ui.tsx — 设置页通用 UI(样式对象 + 设置控件)
// 从 SettingsView 拆分, 降低单文件复杂度
import React from 'react'
import { Minus, Plus } from 'lucide-react'
import { U } from './ui-styles'


export const C = { bg: 'var(--bg-root)', card: 'var(--bg-card)', input: 'var(--bg-elevated)', border: 'var(--border)', text: 'var(--text-primary)', label: 'var(--text-secondary)', muted: 'var(--text-muted)', accent: 'var(--accent)', accentBg: 'rgba(var(--skin-accent),0.08)', danger: 'var(--danger)', green: 'var(--success)', blue: 'var(--accent)' }


export const S = {
  card: { background: C.card, border: '1px solid ' + C.border, borderRadius: 10, padding: '20px 22px', marginBottom: 'calc(var(--msg-gap, 12px) + 2px)' },
  section: { fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 700, color: C.accent, textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid ' + C.border },
  inp: { height: 38, background: C.input, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 'calc(var(--ui-font-size) - 1px)', padding: '0 12px', width: '100%', boxSizing: 'border-box' as const, outline: 'none' },
  num: { height: 38, background: C.input, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 'calc(var(--ui-font-size) - 1px)', padding: '0 10px', width: 72, outline: 'none', textAlign: 'center' as const },
  sel: { height: 38, background: C.input, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 'calc(var(--ui-font-size) - 1px)', padding: '0 10px', outline: 'none', cursor: 'pointer' },
  btn: (v: string) => ({ height: 34, padding: '0 18px', borderRadius: 7, border: v === 'ghost' ? '1px solid ' + C.border : 'none', cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, background: v === 'primary' ? C.accent : v === 'danger' ? C.danger : C.input, color: v === 'ghost' ? C.text : '#fff', whiteSpace: 'nowrap' as const }),
  row: { marginBottom: 14 },
  label: { fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: C.label, marginBottom: 5 },
  hint: { fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginTop: 5, lineHeight: 1.5 },
}

// Toggle switch component


export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({ checked, onChange, label, hint }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '8px 0' }}>
    <div>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>{label}</div>
      {hint && <div style={S.hint}>{hint}</div>}
    </div>
    <div onClick={() => onChange(!checked)} style={{ width: 42, height: 24, borderRadius: 12, background: checked ? C.accent : C.border, cursor: 'pointer', position: 'relative', transition: 'all .15s', flexShrink: 0 }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: checked ? 21 : 3, transition: 'all .15s' }} />
    </div>
  </div>
)

// Number input with label
export const NumSetting: React.FC<{ label: string; hint: string; value: number; min: number; max: number; unit: string; step?: number; onChange: (v: number) => void }> = ({ label, hint, value, min, max, unit, step, onChange }) => (
  <div style={{ ...S.row, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
    <div style={U.flex1}>
      <div style={S.label}>{label}</div>
      <div style={S.hint}>{hint}</div>
    </div>
    <div style={U.flexGap8shrink}>
      <input type="number" style={S.num} min={min} max={max} step={step ?? 1} value={value} onChange={e => onChange(Math.max(min, Math.min(max, parseFloat(e.target.value) || value)))} />
      <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, whiteSpace: 'nowrap' }}>{unit}</span>
    </div>
  </div>
)

// 步进器(- 值 +) —— 替代生硬的滑动条
export const stepBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 7, border: '1px solid ' + C.border, background: C.bg, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 15, lineHeight: 1, transition: 'background .15s' }
export const StepSetting: React.FC<{ label: string; hint?: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }> = ({ label, hint, value, min, max, step = 1, unit = '', onChange }) => (
  <div style={{ ...S.row, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
    <div style={U.flex1}>
      <div style={S.label}>{label}</div>
      {hint ? <div style={S.hint}>{hint}</div> : null}
    </div>
    <div style={U.flexGap8shrink}>
      <button style={stepBtn} title="减小" onClick={() => onChange(Math.max(min, value - step))}><Minus size={14} /></button>
      <span style={{ minWidth: 52, textAlign: 'center', fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text, whiteSpace: 'nowrap' }}>{value}{unit}</span>
      <button style={stepBtn} title="增大" onClick={() => onChange(Math.min(max, value + step))}><Plus size={14} /></button>
    </div>
  </div>
)

// 档位按钮组 —— 替代生硬的滑动条
export const SegSetting: React.FC<{ label: string; hint?: string; value: number; options: { v: number; label: string }[]; onChange: (v: number) => void }> = ({ label, hint, value, options, onChange }) => (
  <div style={{ ...S.row, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
    <div style={U.flex1}>
      <div style={S.label}>{label}</div>
      {hint ? <div style={S.hint}>{hint}</div> : null}
    </div>
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid ' + (o.v === value ? C.accent : C.border), background: o.v === value ? C.accentBg : 'transparent', color: o.v === value ? C.text : C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)', cursor: 'pointer', transition: 'all .15s' }}>{o.label}</button>
      ))}
    </div>
  </div>
)
