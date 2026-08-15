// electron/mcp/auto.ts — MCP 配置持久化读取 + 启动自动连接 + stdio 断线重连(v0.4.1)
// 服务器配置存 settings.json → general.mcpServers; 渲染层连接/断开时维护, 本模块只读并执行连接策略。
import * as fs from 'fs'
import type { McpServerConfig } from '../shared/settings-types'

export interface McpRuntimeConfig {
  servers: McpServerConfig[]
  autoConnect: boolean
  autoReconnect: boolean
  timeoutMs: number
}

export function readMcpConfig(settingsPath: string): McpRuntimeConfig {
  try {
    const g = (JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { general?: Record<string, unknown> })?.general || {}
    const servers = Array.isArray(g.mcpServers) ? (g.mcpServers as McpServerConfig[]) : []
    const rawTimeout = Number(g.mcpTimeout)
    return {
      servers,
      autoConnect: g.mcpAutoConnectOnStart === true,
      autoReconnect: g.mcpAutoReconnect !== false,
      timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.min(Math.max(rawTimeout, 2), 120) * 1000 : 15000,
    }
  } catch {
    return { servers: [], autoConnect: false, autoReconnect: true, timeoutMs: 15000 }
  }
}

const retryState = new Map<string, { attempts: number; timer: ReturnType<typeof setTimeout> | null }>()
const manualStopped = new Set<string>()
const RETRY_DELAYS = [5000, 15000, 30000]
const RETRY_MAX = 3

async function connectOne(s: McpServerConfig, timeoutMs: number, onExit?: (name: string, code: number | null) => void): Promise<void> {
  manualStopped.delete(s.name)
  const isSse = s.type === 'sse' || (!!s.url && !s.command)
  if (isSse) {
    const { connectSSE } = require('./sse-transport')
    await connectSSE({ name: s.name, type: 'sse', url: String(s.url || ''), headers: s.headers || {} })
  } else {
    const { connectServer } = require('./client')
    await connectServer(s.name, String(s.command || ''), Array.isArray(s.args) ? s.args : [], timeoutMs, onExit)
  }
}

export function stdioReconnectHandler(settingsPath: string): (name: string, code: number | null) => void {
  return (name: string, code: number | null) => {
    if (manualStopped.has(name)) return
    const cfg = readMcpConfig(settingsPath)
    if (!cfg.autoReconnect) return
    const server = cfg.servers.find(s => s.name === name)
    if (!server) return
    const st = retryState.get(name) || { attempts: 0, timer: null }
    if (st.attempts >= RETRY_MAX) return
    st.attempts++
    if (st.timer) clearTimeout(st.timer)
    st.timer = setTimeout(() => {
      void connectOne(server, cfg.timeoutMs, stdioReconnectHandler(settingsPath)).then(
        () => retryState.set(name, { attempts: 0, timer: null }),
        () => retryState.set(name, { ...st, timer: null }),
      )
    }, RETRY_DELAYS[Math.min(st.attempts, RETRY_DELAYS.length) - 1])
    retryState.set(name, st)
    try { console.debug('[mcp] stdio 退出, 重连计划 ' + name + ' #' + st.attempts + ' code=' + code) } catch { /* 忽略 */ }
  }
}

export function markMcpManualDisconnect(name: string): void {
  manualStopped.add(name)
  const st = retryState.get(name)
  if (st?.timer) clearTimeout(st.timer)
  retryState.delete(name)
}

export async function autoConnectMcp(settingsPath: string): Promise<void> {
  const cfg = readMcpConfig(settingsPath)
  if (!cfg.autoConnect) return
  const onExit = stdioReconnectHandler(settingsPath)
  for (const s of cfg.servers) {
    if (!s || typeof s.name !== 'string' || !s.name) continue
    try {
      await connectOne(s, cfg.timeoutMs, onExit)
      try { console.debug('[mcp] 启动自动连接成功: ' + s.name) } catch { /* 忽略 */ }
    } catch (e: unknown) {
      try { console.debug('[mcp] 启动自动连接失败: ' + s.name + ' -> ' + (e instanceof Error ? e.message : String(e))) } catch { /* 忽略 */ }
    }
  }
}
