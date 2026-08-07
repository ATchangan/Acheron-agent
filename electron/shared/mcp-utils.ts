// electron/shared/mcp-utils.ts —— MCP 工具名解析纯函数（renderer/main 共享，B6-2）
// 约束：禁止 import electron API / zustand / fs

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name || !name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const i = rest.indexOf('__')
  if (i <= 0 || i + 2 >= rest.length) return null
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) }
}
