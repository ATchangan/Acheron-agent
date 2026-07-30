import { create } from 'zustand'
import type { SettingsData, ProviderConfig } from '../global'

interface SettingsStore extends SettingsData {
  loaded: boolean
  load: () => Promise<void>
  save: () => Promise<void>
  addProvider: (p: ProviderConfig) => void
  removeProvider: (id: string) => void
  updateProvider: (id: string, data: Partial<ProviderConfig>) => void
  setTheme: (theme: string) => void
  setMode: (mode: string) => void
  setWorkDir: (dir: string) => void
  setOpacity: (v: number) => void
  setCustomTheme: (colors: Record<string, string>) => void
  setAnimation: (on: boolean) => void
  setBgImage: (dataUrl: string | null) => void
  setBgOpacity: (v: number) => void
}

// ─── 从图片提取主色调 ────────────────────────────────
function extractDominantColor(dataUrl: string): Promise<{ r: number; g: number; b: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 100; canvas.width = size; canvas.height = size
      const ctx = canvas.getContext('2d')!
      // 缩放并居中裁剪
      const scale = Math.min(size / img.width, size / img.height)
      const sw = img.width * scale, sh = img.height * scale
      const sx = (size - sw) / 2, sy = (size - sh) / 2
      ctx.drawImage(img, sx, sy, sw, sh)
      // 采样中心 60% 区域
      const data = ctx.getImageData(20, 20, 60, 60).data
      let r = 0, g = 0, b = 0, n = 0
      for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; n++ }
      resolve({ r: Math.round(r/n), g: Math.round(g/n), b: Math.round(b/n) })
    }
    img.onerror = () => resolve({ r: 107, g: 76, b: 154 })
    img.src = dataUrl
  })
}

// 调整颜色的亮度和饱和度
function adjustColor(r: number, g: number, b: number, lightnessFactor: number): string {
  const lr = Math.min(255, Math.max(0, Math.round(r * lightnessFactor)))
  const lg = Math.min(255, Math.max(0, Math.round(g * lightnessFactor)))
  const lb = Math.min(255, Math.max(0, Math.round(b * lightnessFactor)))
  return `rgb(${lr},${lg},${lb})`
}

function applySkin(dataUrl: string | null) {
  const r = document.documentElement
  if (dataUrl) {
    r.style.setProperty('--bg-image', `url(${dataUrl})`)
    r.setAttribute('data-bg', '1')
  } else {
    r.style.removeProperty('--bg-image')
    r.removeAttribute('data-bg')
  }
}

async function applySkinColors(dataUrl: string) {
  const c = await extractDominantColor(dataUrl)
  const r = document.documentElement
  // 主色调应用到 UI 元素
  r.style.setProperty('--skin-accent', `${c.r},${c.g},${c.b}`)
  r.style.setProperty('--accent', adjustColor(c.r, c.g, c.b, 1.0))
  r.style.setProperty('--accent-dim', adjustColor(c.r, c.g, c.b, 0.8))
  r.style.setProperty('--border-glow', adjustColor(c.r, c.g, c.b, 0.4))
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  providers: [],
  general: { theme: 'dark', mode: 'work' },
  loaded: false,

  load: async () => {
    try {
      const data = await window.huangquan.settings.load()
      set({ ...data, loaded: true })
      const g = data.general as any
      if (g.bgImage) applySkin(g.bgImage)
      if (g.skinColors) {
        const sc = g.skinColors
        document.documentElement.style.setProperty('--skin-accent', `${sc.r},${sc.g},${sc.b}`)
        document.documentElement.style.setProperty('--accent', adjustColor(sc.r, sc.g, sc.b, 1.0))
        document.documentElement.style.setProperty('--accent-dim', adjustColor(sc.r, sc.g, sc.b, 0.8))
        document.documentElement.style.setProperty('--border-glow', adjustColor(sc.r, sc.g, sc.b, 0.4))
      }
    } catch { set({ loaded: true }) }
  },

  save: async () => {
    const { loaded: _, load: __, save: ___, ...data } = get()
    await window.huangquan.settings.save(data as SettingsData)
  },

  addProvider: (p) => { set((s) => ({ providers: [...s.providers, p] })); get().save() },
  removeProvider: (id) => { set((s) => ({ providers: s.providers.filter((p) => p.id !== id) })); get().save() },
  updateProvider: (id, data) => { set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, ...data } : p)) })); get().save() },
  setTheme: (theme) => { set((s) => ({ general: { ...s.general, theme } })); get().save() },
  setMode: (mode) => { set((s) => ({ general: { ...s.general, mode } })); get().save() },
  setWorkDir: (dir) => { set((s) => ({ general: { ...s.general, workDir: dir } })); get().save() },
  setOpacity: (v) => { set((s) => ({ general: { ...s.general, opacity: v } })); get().save(); (window as any).huangquan?.window?.setOpacity?.(v) },
  setCustomTheme: (colors) => {
    set((s) => ({ general: { ...s.general, theme: 'custom', customColors: colors } })); get().save()
    if (colors.bg) document.documentElement.style.setProperty('--bg-root', colors.bg)
    if (colors.text) document.documentElement.style.setProperty('--text-primary', colors.text)
    if (colors.accent) document.documentElement.style.setProperty('--accent', colors.accent)
  },
  setAnimation: (on) => { set((s) => ({ general: { ...s.general, animation: on } })); get().save(); document.documentElement.style.setProperty('--anim-duration', on ? '0.2s' : '0s') },
  setBgImage: async (dataUrl) => {
    set((s) => ({ general: { ...s.general, bgImage: dataUrl || undefined } })); get().save()
    if (dataUrl) {
      applySkin(dataUrl)
      const c = await extractDominantColor(dataUrl)
      applySkinColors(dataUrl) // applies via CSS vars
      set((s) => ({ general: { ...s.general, skinColors: { r: c.r, g: c.g, b: c.b } } })); get().save()
    } else {
      applySkin(null)
      set((s) => ({ general: { ...s.general, skinColors: undefined } })); get().save()
    }
  },
  setBgOpacity: (v) => { set((s) => ({ general: { ...s.general, bgOpacity: v } })); get().save() },
}))