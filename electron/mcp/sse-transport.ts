// electron/mcp/sse-transport.ts — MCP SSE 传输层补充
// 在现有 stdio 传输基础上增加 SSE/HTTP 传输支持
// 灵感来源：Anthropic MCP Spec 2024-11-05 Transport Layer
// 用 Electron net.fetch(跟随系统代理), 不再用 Node 全局 fetch(undici 不读系统代理)

const netFetch: typeof fetch = ((...args: Parameters<typeof fetch>) => {
  try {
    const net = require('electron').net
    return net.fetch(args[0] as string, args[1] as never)
  } catch {
    return fetch(args[0] as string, args[1] as RequestInit)
  }
}) as typeof fetch

interface MCPServerConfig {
  name: string
  type: 'stdio' | 'sse'
  command?: string          // stdio 模式
  args?: string[]
  url?: string              // SSE 模式
  headers?: Record<string, string>
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

interface SSESession {
  url: string
  headers: Record<string, string>
  tools: MCPTool[]
  reqId: number
  messageEndpoint?: string
  connected: boolean
}

const sseSessions: Map<string, SSESession> = new Map()

/**
 * 连接到 SSE-based MCP 服务器
 */
export async function connectSSE(config: MCPServerConfig): Promise<MCPTool[]> {
  if (!config.url) throw new Error('SSE transport requires a URL')

  const session: SSESession = {
    url: config.url,
    headers: config.headers || {},
    tools: [],
    reqId: 0,
    connected: false,
  }

  try {
    // 1. 发送 initialize 请求
    const initRes = await netFetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++session.reqId,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
    clientInfo: { name: 'huangquan-agent', version: '0.3.5' },
        },
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!initRes.ok) {
      throw new Error(`MCP SSE init failed: HTTP ${initRes.status}`)
    }

    const initData = await initRes.json()
    session.messageEndpoint = initData.result?.messageEndpoint || config.url
    session.connected = true

    // 2. 获取工具列表
    const toolsRes = await netFetch(session.messageEndpoint!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++session.reqId,
        method: 'tools/list',
        params: {},
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (toolsRes.ok) {
      const toolsData = await toolsRes.json()
      session.tools = (toolsData.result?.tools || []).map((t: { name?: string; description?: string; inputSchema?: unknown }) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || {},
      }))
    }

    sseSessions.set(config.name, session)
    return session.tools
  } catch (e: unknown) {
    session.connected = false
    throw new Error(`MCP SSE connect failed: ${(e instanceof Error ? e.message : String(e))}`)
  }
}

/**
 * 调用 SSE MCP 服务器的工具
 */
export async function callSSETool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const session = sseSessions.get(serverName)
  if (!session || !session.connected) {
    throw new Error(`SSE server not connected: ${serverName}`)
  }

  const endpoint = session.messageEndpoint || session.url
  const res = await netFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...session.headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++session.reqId,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    throw new Error(`MCP tool call failed: HTTP ${res.status}`)
  }

  const data = await res.json()
  if (data.error) {
    throw new Error(`MCP error: ${data.error.message || JSON.stringify(data.error)}`)
  }

  const content = data.result?.content
  if (Array.isArray(content)) {
    return content.map((c: { text?: string }) => c.text || JSON.stringify(c)).join('\n')
  }
  return JSON.stringify(content || data.result)
}

/**
 * 列出已连接的 SSE 服务器
 */
export function listSSEServers(): { name: string; tools: MCPTool[] }[] {
  return [...sseSessions.entries()].map(([name, s]) => ({
    name,
    tools: s.tools,
  }))
}

/**
 * 断开 SSE 服务器
 */
export function disconnectSSE(name: string): boolean {
  return sseSessions.delete(name)
}

export function disconnectAllSSE() {
  sseSessions.clear()
}

/**
 * 自动发现：尝试 SSE 连接并回退到 stdio
 */
export async function autoConnect(config: MCPServerConfig): Promise<MCPTool[]> {
  if (config.type === 'sse' && config.url) {
    return connectSSE(config)
  }
  // stdio 回退到原有 client.ts
  throw new Error('stdio transport: use mcp/client.ts connectServer')
}
