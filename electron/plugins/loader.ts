// electron/plugins/loader.ts — 黄泉式神录 插件系统
// 目录约定: plugins/<name>/manifest.json + index.js

import * as fs from 'fs'
import { join } from 'path'

interface PluginManifest { name: string; version: string; description: string; tools?: { name: string; description: string; params: Record<string,string> }[]; commands?: { name: string; action: string }[] }

interface LoadedPlugin { manifest: PluginManifest; path: string; enabled: boolean }

const plugins: Map<string, LoadedPlugin> = new Map()

export function scanPlugins(pluginsDir: string): PluginManifest[] {
  if (!fs.existsSync(pluginsDir)) return []
  const results: PluginManifest[] = []
  for (const entry of fs.readdirSync(pluginsDir)) {
    const dir = join(pluginsDir, entry)
    const mf = join(dir, 'manifest.json')
    if (fs.existsSync(mf)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(mf, 'utf-8'))
        results.push(manifest)
        plugins.set(manifest.name, { manifest, path: dir, enabled: true })
      } catch {}
    }
  }
  return results
}

export function getPluginTools(): { name: string; description: string; params: Record<string,string>; plugin: string }[] {
  const tools: any[] = []
  for (const [_, p] of plugins) {
    if (!p.enabled || !p.manifest.tools) continue
    for (const t of p.manifest.tools) tools.push({ ...t, plugin: p.manifest.name })
  }
  return tools
}

export function getPluginCommands(): { name: string; action: string; plugin: string }[] {
  const cmds: any[] = []
  for (const [_, p] of plugins) {
    if (!p.enabled || !p.manifest.commands) continue
    for (const c of p.manifest.commands) cmds.push({ ...c, plugin: p.manifest.name })
  }
  return cmds
}
