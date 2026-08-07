// src/store/mcp-tools.ts — MCP 工具自动注入(v0.3.3 内核加固)
// MCP 服务器连接后, tools/list 的 schema 直接并入 LLM 工具列表(主流桌面 Agent 行为),
// 工具名统一 mcp__<server>__<tool>, 由 runTool 路由回 mcpCall/mcpSSECall。
import type { ToolSpec } from '../types'

export interface McpToolMeta {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpServerInfo {
  name: string
  cmd?: string
  args?: string[]
  url?: string
  tools?: McpToolMeta[] | string[]
}

export let MCP_TOOLS: ToolSpec[] = []
export const MCP_TOOL_NAMES = new Set<string>()
// 服务器 → 传输类型(stdio/sse), runTool 按此路由
export const MCP_SERVER_KIND: Record<string, 'stdio' | 'sse'> = {}

function sanitize(n: string): string {
  const s = String(n || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '')
  return s || 'tool'
}

export function mcpToolName(server: string, tool: string): string {
  return 'mcp__' + sanitize(server) + '__' + sanitize(tool)
}

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name || !name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const i = rest.indexOf('__')
  if (i <= 0 || i + 2 >= rest.length) return null
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) }
}

function schemaToParams(schema: Record<string, unknown> | undefined): { properties: Record<string, { type: string; description?: string }>; required: string[] } {
  const properties: Record<string, { type: string; description?: string }> = {}
  const required: string[] = []
  if (!schema || typeof schema !== 'object') return { properties, required }
  const props = (schema as { properties?: Record<string, { type?: string; description?: string }> }).properties
  const req = (schema as { required?: string[] }).required
  if (props && typeof props === 'object') {
    for (const [k, v] of Object.entries(props)) {
      if (!v || typeof v !== 'object') { properties[k] = { type: 'string' }; continue }
      const vt = String(v.type || 'string')
      properties[k] = { type: vt === 'integer' || vt === 'number' || vt === 'boolean' || vt === 'array' || vt === 'object' ? vt : 'string', description: v.description || k }
    }
  }
  if (Array.isArray(req)) for (const k of req) if (typeof k === 'string' && properties[k]) required.push(k)
  return { properties, required }
}

function buildSpec(server: string, t: McpToolMeta): ToolSpec | null {
  if (!t || typeof t.name !== 'string' || !t.name) return null
  const fnName = mcpToolName(server, t.name)
  const { properties, required } = schemaToParams(t.inputSchema)
  return {
    type: 'function',
    function: {
      name: fnName,
      description: String(t.description || ('MCP 工具 ' + server + '/' + t.name)).slice(0, 200),
      parameters: { type: 'object', properties, required },
    },
  }
}

export async function refreshMcpTools(): Promise<void> {
  const specs: ToolSpec[] = []
  const names = new Set<string>()
  const kinds: Record<string, 'stdio' | 'sse'> = {}
  try {
    const stdio = await window.huangquan.mcpList().catch(() => [])
    for (const s of Array.isArray(stdio) ? stdio : []) {
      if (!s || typeof s.name !== 'string') continue
      kinds[s.name] = 'stdio'
      for (const t of Array.isArray(s.tools) ? s.tools : []) {
        const meta = typeof t === 'string' ? { name: t } : t
        const spec = buildSpec(s.name, meta as McpToolMeta)
        if (spec) { specs.push(spec); names.add(spec.function.name) }
      }
    }
  } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  try {
    const sse = await window.huangquan.mcpSSEList().catch(() => [])
    for (const s of Array.isArray(sse) ? sse : []) {
      if (!s || typeof s.name !== 'string') continue
      kinds[s.name] = 'sse'
      for (const t of Array.isArray(s.tools) ? s.tools : []) {
        const meta = typeof t === 'string' ? { name: t } : t
        const spec = buildSpec(s.name, meta as McpToolMeta)
        if (spec) { specs.push(spec); names.add(spec.function.name) }
      }
    }
  } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  MCP_TOOLS = specs
  MCP_TOOL_NAMES.clear()
  for (const n of names) MCP_TOOL_NAMES.add(n)
  Object.assign(MCP_SERVER_KIND, kinds)
}
