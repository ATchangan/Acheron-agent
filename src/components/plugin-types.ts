// v0.3.1 块 K: 插件页 类型/常量(从 PluginsView 拆出, 行为零变化)

// ─── 型定義 ────────────────────────────────────────────
export interface PluginManifest {
  name: string
  version: string
  description: string
  author?: string
  homepage?: string
  license?: string
  permissions?: string[]
  tools?: { name: string; description: string; params: Record<string, string> }[]
  commands?: { name: string; action: string }[]
  category?: 'oni' | 'yokai' | 'sen' | 'jin'
}

export interface PluginInfo {
  manifest: PluginManifest
  dirName: string
  enabled: boolean
  category: string
}

export interface PluginState {
  enabled: boolean
  category: string
}

// ─── 定数 ──────────────────────────────────────────────
export const CATEGORIES: Record<string, { label: string; emoji: string }> = {
  oni: { label: '鬼族', emoji: '鬼' },
  yokai: { label: '妖族', emoji: '妖' },
  sen: { label: '仙族', emoji: '仙' },
  jin: { label: '人族', emoji: '人' },
}

export const CATEGORY_HINT: Record<string, string> = {
  oni: '工具',
  yokai: '娱乐',
  sen: '生产力',
  jin: '日常',
}

export const YELLOW_RIVER = 'var(--accent)'

// ─── 内联样式 ─────────────────────────────────────────
// 类别颜色
export const CAT_COLORS: Record<string, string> = {
  oni: 'var(--danger)',
  yokai: 'var(--warning)',
  sen: 'var(--accent)',
  jin: 'var(--success)',
}
