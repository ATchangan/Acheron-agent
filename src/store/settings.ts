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
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  providers: [],
  general: { theme: 'dark', mode: 'work' },
  loaded: false,

  load: async () => {
    try {
      const data = await window.huangquan.settings.load()
      set({ ...data, loaded: true })
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
}))
