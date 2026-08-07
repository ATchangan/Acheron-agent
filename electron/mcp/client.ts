// electron/mcp/client.ts — MCP 协议客户端 (stdio transport)
// 支持连接本地 MCP 服务器，发现和调用工具

import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { createInterface } from 'readline'

interface MCPServer { name: string; command: string; args: string[]; process?: ChildProcess; tools: MCPTool[]; reqId: number }

interface MCPTool { name: string; description: string; inputSchema: Record<string, unknown> }

const servers: Map<string, MCPServer> = new Map()

function sendRPC(server: MCPServer, method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++server.reqId
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    const proc = server.process!
    if (!proc.stdin || proc.stdin.destroyed) { reject(new Error('Process not running')); return }
    
    const cleanup = () => { clearTimeout(timeout); proc.stdout?.removeListener('line', onLine) }
    // 超时/完成都要移除监听器, 防止泄漏
    const timeout = setTimeout(() => { cleanup(); reject(new Error('MCP timeout')) }, 10000)
    const onLine = (line: string) => {
      try {
        const res = JSON.parse(line)
        if (res.id === id) { cleanup(); resolve(res.result || res) }
      } catch (e) { console.debug('[mcp] 解析响应失败:', e) }
    }
    proc.stdout?.on('line', onLine)
    proc.stdin.write(msg)
  })
}

export async function connectServer(name: string, command: string, args: string[] = []): Promise<MCPTool[]> {
  try {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    // spawn error 监听 —— 命令不存在(ENOENT)等启动失败时优雅返回错误, 防止冒泡为 uncaughtException
    const spawnError = new Promise<never>((_, rej) => { proc.on('error', (e: Error) => rej(new Error('MCP 启动失败: ' + (e instanceof Error ? e.message : String(e))))) })
    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity })
    const server: MCPServer = { name, command, args, process: proc, tools: [], reqId: 0 }
    
    const initResult = await Promise.race([
      new Promise<{ ok?: boolean; error?: string; serverInfo?: unknown }>((resolve, reject) => {
      const id = ++server.reqId
      proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\n')
      const timer = setTimeout(() => { proc.kill(); reject(new Error('Init timeout')) }, 15000)
      rl.once('line', line => { clearTimeout(timer); resolve(JSON.parse(line)) })
    }), spawnError])
    
    // List tools
    const toolsResult = (await sendRPC(server, 'tools/list', {})) as { tools?: { name?: string; description?: string; inputSchema?: unknown }[] }
    server.tools = (toolsResult?.tools || []).map((t: { name?: string; description?: string; inputSchema?: unknown }) => ({ name: t.name || '', description: t.description || '', inputSchema: (t.inputSchema || {}) as Record<string, unknown> }))
    server.process = proc
    
    servers.set(name, server)
    return server.tools
  } catch (e: unknown) { throw new Error('MCP connect failed: ' + (e instanceof Error ? e.message : String(e))) }
}

export async function callMCPTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const server = servers.get(serverName)
  if (!server) throw new Error('Server not connected: ' + serverName)
  const result = await sendRPC(server, 'tools/call', { name: toolName, arguments: args })
  return JSON.stringify((result as { content?: unknown })?.content || result)
}

export function listServers(): { name: string; tools: MCPTool[] }[] {
  return [...servers.entries()].map(([name, s]) => ({ name, tools: s.tools }))
}

export function disconnectAll() { for (const [_, s] of servers) { try { s.process?.kill() } catch (e) { console.debug('[mcp] 终止进程失败:', e) } }; servers.clear() }
