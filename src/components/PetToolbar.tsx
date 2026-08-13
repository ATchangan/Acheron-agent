import React from 'react'
import { useSettingsStore } from '../store/settings'

// v0.4.0: 交互会话顶部的黄泉桌宠快捷控制条(原「聊天/工作」标签的位置)
// 开关/形态/动作/回位, 与设置→外观 的桌宠区、桌宠右键菜单同源
export default function PetToolbar() {
  const g = useSettingsStore(s => s.general) || {}
  const pet = g.pet || {}

  const save = (patch: Record<string, unknown>) => {
    useSettingsStore.setState(s => ({ general: { ...(s.general || {}), pet: { ...((s.general || {}).pet || {}), ...patch } } }))
    setTimeout(() => useSettingsStore.getState().save(), 150)
  }

  const toggle = async (enable: boolean) => {
    const on = await window.huangquan?.pet?.toggle?.(enable)
    if (typeof on === 'boolean') save({ enabled: on })
  }

  const sel: React.CSSProperties = {
    height: 24, padding: '0 6px', fontSize: 'calc(var(--ui-font-size) - 2px)',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', borderRadius: 6, outline: 'none', cursor: 'pointer',
  }

  return (
    <div className="chat-header-tab" style={{ alignItems: 'center', gap: 8 }}>
      <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 'calc(var(--ui-font-size) - 1px)', display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: pet.enabled === true ? 'var(--accent-green)' : 'var(--text-muted)', boxShadow: pet.enabled === true ? '0 0 6px var(--accent-green)' : 'none' }} />
        黄泉
      </span>
      <button className={`tab-btn ${pet.enabled === true ? 'active' : ''}`} style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 2px)' }} onClick={() => void toggle(pet.enabled !== true)}>
        {pet.enabled === true ? '桌宠开' : '桌宠关'}
      </button>
      <select style={sel} title="桌宠形态" value={pet.form || 'normal'} onChange={e => { const v = e.target.value as 'normal' | 'ultimate'; save({ form: v }); void window.huangquan?.pet?.setForm?.(v) }}>
        <option value="normal">正常</option>
        <option value="ultimate">大招</option>
      </select>
      <select style={sel} title="桌宠动作" value={pet.action || 'idle'} onChange={e => { const v = e.target.value as 'idle' | 'dance1' | 'dance2' | 'dance3'; save({ action: v }); void window.huangquan?.pet?.setAction?.(v) }}>
        <option value="idle">待机</option>
        <option value="dance1">极乐净土</option>
        <option value="dance2">彩虹节拍</option>
        <option value="dance3">Good Time</option>
      </select>
      <select style={sel} title="桌宠位置锚定" value={pet.anchor || 'float'} onChange={e => { const v = e.target.value as 'float' | 'window' | 'taskbar'; save({ anchor: v }); void window.huangquan?.pet?.setAnchor?.(v) }}>
        <option value="float">自由</option>
        <option value="window">坐视窗</option>
        <option value="taskbar">坐任务栏</option>
      </select>
      <button className="tab-btn" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 2px)' }} title="重置桌宠位置" onClick={() => void window.huangquan?.pet?.resetPos?.()}>回位</button>
    </div>
  )
}
