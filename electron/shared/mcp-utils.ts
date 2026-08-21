// electron/shared/mcp-utils.ts —— MCP 工具名解析纯函数（renderer/main 共享，B6-2）
// 约束：禁止 import electron API / zustand / fs

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name || !name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const i = rest.indexOf('__')
  if (i <= 0 || i + 2 >= rest.length) return null
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) }
}

// schema 注入时用于把真实名称压平为工具名片段(与 parseMcpToolName 配合):
// 非 [A-Za-z0-9_-] → _, 连续下划线折叠为单个, 保证首个 __ 一定是 server/tool 分隔符
export function sanitizeMcpPart(s: string): string {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_')
}

// 把压平后的 mcp__server__tool 反查回真实名称(按已连接服务器清单比对 sanitize 结果),
// 修复"服务器/工具名含点、空格、双下划线时, 解析出的名字与注册表对不上导致调用失败"的问题
export function resolveMcpToolName(name: string, servers: { name: string; tools: string[] }[]): { server: string; tool: string } | null {
  const p = parseMcpToolName(name)
  if (!p) return null
  for (const s of servers || []) {
    if (sanitizeMcpPart(s.name) !== p.server) continue
    for (const tn of s.tools || []) {
      if (sanitizeMcpPart(tn) === p.tool) return { server: s.name, tool: tn }
    }
  }
  return null
}
