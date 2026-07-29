import { create } from 'zustand'
import type { SettingsData, ProviderConfig } from '../global'

interface SettingsStore {
  providers: ProviderConfig[]
  general: { theme: string }
  loaded: boolean
  load: () => Promise<void>
  addProvider: (p: ProviderConfig) => void
  removeProvider: (id: string) => void
  setTheme: (theme: string) => void
}

function serializeData(s: SettingsStore): SettingsData {
  return { providers: s.providers, general: s.general }
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  providers: [],
  general: { theme: 'dark' },
  loaded: false,

  load: async () => {
    try {
      const data = await window.huangquan.settings.load()
      set({ providers: data.providers || [], general: data.general || { theme: 'dark' }, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  addProvider: (p) => {
    set((s) => ({ providers: [...s.providers, p] }))
    // 立即同步保存（fire and forget，不阻塞 UI）
    const data = serializeData(get())
    window.huangquan.settings.save(data)
  },

  removeProvider: (id) => {
    set((s) => ({ providers: s.providers.filter(p => p.id !== id) }))
    window.huangquan.settings.save(serializeData(get()))
  },

  setTheme: (theme) => {
    set((s) => ({ general: { ...s.general, theme } }))
    window.huangquan.settings.save(serializeData(get()))
  },
}))
