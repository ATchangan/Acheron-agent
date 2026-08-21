// keybinds.ts —— v0.4.2 可重绑快捷键(keybinds)：默认值 + 本地持久化 + 录制/匹配
export const KEYBINDS_KEY = 'hq_keybinds'

export interface KeybindDef {
  id: string
  label: string
  default: string
}

export const KEYBIND_DEFS: KeybindDef[] = [
  { id: 'command-palette', label: '命令面板', default: 'Ctrl+K' },
  { id: 'new-chat', label: '新对话', default: 'Ctrl+N' },
  { id: 'toggle-sidebar', label: '显示/隐藏侧边栏', default: 'Ctrl+B' },
  { id: 'toggle-right-rail', label: '显示/隐藏右栏', default: 'Ctrl+J' },
  { id: 'settings', label: '打开设置', default: 'Ctrl+,' },
]

export function loadKeybinds(): Record<string, string> {
  try {
    const d = JSON.parse(localStorage.getItem(KEYBINDS_KEY) || '{}')
    const out: Record<string, string> = {}
    for (const def of KEYBIND_DEFS) out[def.id] = typeof d[def.id] === 'string' && d[def.id] ? d[def.id] : def.default
    return out
  } catch { return Object.fromEntries(KEYBIND_DEFS.map(d => [d.id, d.default])) }
}

export function saveKeybind(id: string, combo: string) {
  const d = loadKeybinds()
  d[id] = combo
  localStorage.setItem(KEYBINDS_KEY, JSON.stringify(d))
}

export function resetKeybinds() {
  localStorage.removeItem(KEYBINDS_KEY)
}

export function keybindHint(id: string): string {
  return loadKeybinds()[id] || KEYBIND_DEFS.find(d => d.id === id)?.default || ''
}

export function formatCombo(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.metaKey) parts.push('Meta')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  const k = e.key === ' ' ? 'Space' : e.key === ',' ? ',' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  parts.push(k)
  return parts.join('+')
}

export function matchCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false
  const parts = combo.split('+').map(s => s.trim()).filter(Boolean)
  const key = (parts.pop() || '').toLowerCase()
  const mods = new Set(parts.map(p => p.toLowerCase()))
  const keyMatch = key === ',' ? e.key === ','
    : key === 'space' ? e.key === ' '
    : e.key.toLowerCase() === key
  return keyMatch
    && e.ctrlKey === mods.has('ctrl')
    && e.shiftKey === mods.has('shift')
    && e.altKey === mods.has('alt')
    && e.metaKey === mods.has('meta')
}
