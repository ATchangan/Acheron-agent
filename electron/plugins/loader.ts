// electron/plugins/loader.ts — 插件库 插件系统
// 目录约定: plugins/<name>/manifest.json + index.js(可选实现)
// v0.3.0 M4: index.js 协议 —— module.exports = { tools: [{ name, description, params, run }] }
//   - 有 index.js 的插件: 工具注入 LLM(plugin_ 前缀), run 在 vm 沙箱执行
//   - 无 index.js 的旧插件: 仅 manifest 声明, 不注入 LLM, UI 标记"未启用(缺实现)"

import * as fs from 'fs'
import { join } from 'path'
import { loadPluginToolsStatic } from './sandbox'

interface PluginManifest { name: string; version: string; description: string; tools?: { name: string; description: string; params: Record<string,string> }[]; commands?: { name: string; action: string }[]; settings?: { key: string; label: string; type?: string; default?: unknown; options?: string[]; hint?: string }[] }

interface LoadedPlugin { manifest: PluginManifest; path: string; enabled: boolean; hasImpl: boolean }

const plugins: Map<string, LoadedPlugin> = new Map()

export function scanPlugins(pluginsDir: string): PluginManifest[] {
  if (!fs.existsSync(pluginsDir)) return []
  const results: PluginManifest[] = []
  plugins.clear()
  for (const entry of fs.readdirSync(pluginsDir)) {
    const dir = join(pluginsDir, entry)
    const mf = join(dir, 'manifest.json')
    if (fs.existsSync(mf)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(mf, 'utf-8'))
        results.push(manifest)
        plugins.set(manifest.name, { manifest, path: dir, enabled: true, hasImpl: fs.existsSync(join(dir, 'index.js')) })
      } catch { /* 损坏清单忽略 */ console.debug('[swallow]', 'bad manifest ' + entry) }
    }
  }
  return results
}

export function getPluginTools(): { name: string; description: string; params: Record<string,string>; plugin: string }[] {
  const tools: { name: string; description: string; params: Record<string, string>; plugin: string }[] = []
  for (const [_, p] of plugins) {
    if (!p.enabled || !p.manifest.tools) continue
    for (const t of p.manifest.tools) tools.push({ ...t, plugin: p.manifest.name })
  }
  return tools
}

export function getPluginCommands(): { name: string; action: string; plugin: string }[] {
  const cmds: { name: string; action: string; plugin: string }[] = []
  for (const [_, p] of plugins) {
    if (!p.enabled || !p.manifest.commands) continue
    for (const c of p.manifest.commands) cmds.push({ ...c, plugin: p.manifest.name })
  }
  return cmds
}

// ─── v0.3.0 M4: index.js 实现协议 ─────────────────────────
// 返回有实现的插件工具清单: [{ plugin, name, description, params }]
// 仅读取 tools 元数据(module.exports.tools), 不执行 run —— 冲突工具名后加载者跳过并告警
export function getPluginImplTools(pluginsDir: string): { plugin: string; name: string; description: string; params: Record<string,string> }[] {
  if (!fs.existsSync(pluginsDir)) return []
  const out: { plugin: string; name: string; description: string; params: Record<string,string> }[] = []
  const seen = new Set<string>()
  for (const entry of fs.readdirSync(pluginsDir)) {
    const dir = join(pluginsDir, entry)
    const idx = join(dir, 'index.js')
    if (!fs.existsSync(idx)) continue
    try {
      // v0.4.x 加固: 元数据改为 vm 静态加载(顶层仅 path、10s 超时、禁代码生成逃逸),
      // 不再用 require 在主进程执行第三方插件的任意顶层代码。
      const tools = loadPluginToolsStatic(fs.readFileSync(idx, 'utf-8'))
      for (const raw of tools) {
        const t = raw as { name?: unknown; description?: unknown; params?: unknown }
        if (!t || typeof t.name !== 'string') continue
        if (seen.has(t.name)) { console.warn('[plugin] 工具名冲突, 跳过: ' + t.name + ' (' + entry + ')'); continue }
        seen.add(t.name)
        out.push({ plugin: entry, name: t.name, description: String(t.description || '').slice(0, 200), params: t.params && typeof t.params === 'object' ? t.params as Record<string, string> : {} })
      }
    } catch (e: unknown) { console.warn('[plugin] index.js 加载失败: ' + entry + ' -> ' + ((e instanceof Error ? e.message : String(e)))) }
  }
  return out
}

// 校验 plugin/tool 是否在已扫描的实现清单内(防任意路径注入)
export function isPluginToolValid(pluginsDir: string, plugin: string, tool: string): boolean {
  return getPluginImplTools(pluginsDir).some(t => t.plugin === plugin && t.name === tool)
}

// 插件是否有 index.js 实现
export function pluginHasImpl(pluginsDir: string, name: string): boolean {
  try { return fs.existsSync(join(pluginsDir, name, 'index.js')) } catch { return false }
}
