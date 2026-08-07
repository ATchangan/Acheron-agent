// electron/shared/tool-filter.ts —— 角色工具白名单过滤纯函数（renderer/main 共享，B6-2）
// 约束：禁止 import electron API / zustand / fs

export interface FilterableTool {
  function: { name: string }
}

export interface FilterableAgent {
  tools: string[]
}

export function filterToolsCore<T extends FilterableTool>(
  tools: T[],
  agentName: string,
  agents: Record<string, FilterableAgent>,
  opts: { includeMcp?: boolean } = {},
): T[] {
  const ag = agents[agentName]
  if (!ag || ag.tools.includes('*')) return tools
  const allowed = new Set([...ag.tools, 'handoff', 'dispatch', 'list_agents', 'session_search'])
  return tools.filter(t =>
    allowed.has(t.function.name) ||
    t.function.name.startsWith('plugin_') ||
    (opts.includeMcp && t.function.name.startsWith('mcp__'))
  )
}
