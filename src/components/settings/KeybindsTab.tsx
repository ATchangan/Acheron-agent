// KeybindsTab.tsx —— v0.4.2 可重绑快捷键设置（keybind-settings）
import React, { useEffect, useState } from 'react'
import { Keyboard, RotateCcw } from 'lucide-react'
import { KEYBIND_DEFS, loadKeybinds, saveKeybind, resetKeybinds, formatCombo } from '../../store/keybinds'
import { useSettingsStore } from '../../store/settings'
import { C, S } from '../settings-ui'

export default function KeybindsTab() {
  const [binds, setBinds] = useState<Record<string, string>>(() => loadKeybinds())
  const [recording, setRecording] = useState<string | null>(null)
  const [recGlobal, setRecGlobal] = useState(false)
  const [toast, setToast] = useState('')
  const g = useSettingsStore(s => s.general)
  const updateGeneral = useSettingsStore(s => s.updateGeneral)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2200) }

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // 至少需要一个修饰键，避免误绑定裸键
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return
      const combo = formatCombo(e)
      if (recGlobal) {
        updateGeneral({ globalHotkey: combo })
        try { window.huangquan.hotkey.set(combo) } catch { /* 忽略 */ }
        setRecGlobal(false)
        showToast('已启用全局热键 ' + combo)
        setRecording(null)
        return
      }
      saveKeybind(recording, combo)
      setBinds(loadKeybinds())
      setRecording(null)
      showToast('已绑定 ' + combo)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [recording, recGlobal, updateGeneral])

  return (
    <div style={U.pageBody}>
      <div style={S.section}>快捷键</div>
      <div style={S.hint}>点击「录制」后按下新的组合键（需含 Ctrl/Cmd/Alt/Shift 之一）。Esc 可取消录制。</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {KEYBIND_DEFS.map(def => (
          <div key={def.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid ' + C.border, background: 'var(--bg-card)' }}>
            <Keyboard size={14} style={{ color: C.muted }} />
            <span style={{ flex: 1, fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>{def.label}</span>
            {recording === def.id ? (
              <span style={{ color: C.accent, fontSize: 'calc(var(--ui-font-size) - 1px)' }}>请按新的组合键…</span>
            ) : (
              <kbd style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', padding: '3px 9px', borderRadius: 5, border: '1px solid ' + C.border, background: 'var(--bg-elevated)', color: C.text, fontFamily: 'JetBrains Mono, Consolas, monospace', minWidth: 64, textAlign: 'center' }}>{binds[def.id]}</kbd>
            )}
            <button
              style={S.btn(recording === def.id ? 'primary' : 'ghost')}
              onClick={() => {
                if (recording === def.id) { setRecording(null); return }
                setRecording(def.id)
              }}
              onKeyDown={e => { if (e.key === 'Escape') setRecording(null) }}
            >
              {recording === def.id ? '取消' : '录制'}
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button style={S.btn('ghost')} onClick={() => { resetKeybinds(); setBinds(loadKeybinds()); showToast('已恢复默认快捷键') }}>
          <RotateCcw size={13} /> 恢复默认
        </button>
      </div>
      <div style={{ marginTop: 26 }}>
        <div style={S.section}>全局热键（随叫随到 · 选中即问）</div>
        <div style={S.hint}>系统级：在任何应用里选中文字（Ctrl+C 拷贝）后按下此组合键，立即唤起窗口并把选中内容填入输入框。留空 = 关闭。需含 Ctrl/Alt/Shift 之一。</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid ' + C.border, background: 'var(--bg-card)', marginTop: 12 }}>
          <Keyboard size={14} style={{ color: C.muted }} />
          <span style={{ flex: 1, fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>全局组合键</span>
          {recGlobal ? (
            <span style={{ color: C.accent, fontSize: 'calc(var(--ui-font-size) - 1px)' }}>请按新的组合键…</span>
          ) : (
            <kbd style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', padding: '3px 9px', borderRadius: 5, border: '1px solid ' + C.border, background: 'var(--bg-elevated)', color: C.text, fontFamily: 'JetBrains Mono, Consolas, monospace', minWidth: 64, textAlign: 'center' }}>{g.globalHotkey || '（未启用）'}</kbd>
          )}
          <button style={S.btn(recGlobal ? 'primary' : 'ghost')} onClick={() => { if (recGlobal) { setRecGlobal(false); setRecording(null); return } setRecording('__global__'); setRecGlobal(true) }}>
            {recGlobal ? '取消' : '录制'}
          </button>
          <button style={S.btn('ghost')} onClick={() => { updateGeneral({ globalHotkey: '' }); try { window.huangquan.hotkey.set('') } catch { /* 忽略 */ } showToast('已关闭全局热键') }}>
            关闭
          </button>
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: C.accent, color: 'var(--on-accent)', padding: '10px 18px', borderRadius: 8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex: 9999 }}>{toast}</div>}
    </div>
  )
}

// 复用样式对象（与其它 tab 一致）
const U = {
  pageBody: { padding: 20, maxWidth: 720 } as React.CSSProperties,
}
