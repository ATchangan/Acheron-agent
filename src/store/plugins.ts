// src/store/plugins.ts —— 插件工具注入(v0.3.0 M4)
// 启动时由 chat.ts 壳调用 refreshPluginTools() 拉取有 index.js 实现的插件工具,
// 组装为 ToolSpec(工具名前缀 plugin_<plugin>__<tool> 防冲突)并入 LLM 工具列表。
import type { ToolSpec } from '../types'

export let PLUGIN_TOOLS: ToolSpec[] = []
export const PLUGIN_TOOL_NAMES = new Set<string>()

export async function refreshPluginTools(): Promise<void> {
  try {
    const list = await window.huangquan.plugins.tools()
    const specs: ToolSpec[] = []
    PLUGIN_TOOL_NAMES.clear()
    for (const t of list || []) {
      const fnName = 'plugin_' + t.plugin + '__' + t.name
      PLUGIN_TOOL_NAMES.add(fnName)
      const properties: Record<string, { type: string; description?: string }> = {}
      for (const [k, v] of Object.entries((t.params as Record<string, string>) || {})) {
        properties[k] = { type: v === 'number' ? 'number' : v === 'boolean' ? 'boolean' : 'string', description: k }
      }
      specs.push({
        type: 'function',
        function: {
          name: fnName,
          description: String(t.description || ('插件工具 ' + t.name)).slice(0, 200),
          parameters: { type: 'object', properties, required: Object.keys(properties) },
        },
      })
    }
    PLUGIN_TOOLS = specs
  } catch (e) { /* 插件系统不可用时不注入 */ console.debug('[swallow]', e) }
}
