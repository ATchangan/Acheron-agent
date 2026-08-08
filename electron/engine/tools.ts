// electron/engine/tools.ts — 工具分发器(schema/执行器已拆分到 tool-specs / tool-handlers)
// 本文件只保留: 权限/缓存/白名单/MCP 确认 + runTool 分发框架。
import { dialog } from 'electron'
import { invokeHandler } from './registry'
import { CACHE_TTL } from './constants'
import type { EngineToolSpec } from './types'
import type { AgentDef } from './agents'
import { errMsg } from './errmsg'
import { parseMcpToolName } from '../shared/mcp-utils'
import { TOOLS, getMcpToolSpecs } from './tool-specs'
import { TOOL_HANDLERS, closeTerminalSessions, setRunToolRef } from './tool-handlers'
import type { ToolRunCtx } from './tool-types'
import { checkFilePermission } from './tool-permission'
export { parseMcpToolName, TOOLS, getMcpToolSpecs, closeTerminalSessions }
export type { ToolRunCtx }

// ─── 工具缓存(引擎内, 写操作自动失效) ───
const toolCache = new Map<string, { result: string; ts: number }>()
function getCached(key: string, ttlKey: string): string | null {
  const e = toolCache.get(key)
  if (!e) return null
  if (Date.now() - e.ts > (CACHE_TTL[ttlKey] || CACHE_TTL.default)) { toolCache.delete(key); return null }
  return e.result
}
function setCached(key: string, result: string): void { toolCache.set(key, { result, ts: Date.now() }) }
function onWriteOp(): void {
  for (const k of toolCache.keys()) { if (/^(read|ls|grep|find):/.test(k)) toolCache.delete(k) }
}

export function getActiveTools(ctx: ToolRunCtx): EngineToolSpec[] {
  const raw = ctx.g.disabledTools
  const disabled: string[] = raw === undefined ? ['workflow'] : (raw || [])
  const autoMcp = ctx.g.mcpAutoInject !== false
  const merged = autoMcp ? [...TOOLS, ...getMcpToolSpecs()] : [...TOOLS]
  // v0.3.5 T2: 工具白名单开关 —— 关闭时不过 agent 白名单, 返回全量工具
  const filtered = (ctx.agent && ctx.g.perf?.toolWhitelist !== false) ? filterTools(merged, ctx.agent, ctx.agents, ctx.g.mcpAutoInject !== false) : merged
  if (ctx.g.collabMode === '关闭') {
    return filtered.filter(t => !disabled.includes(t.function.name) && !['handoff', 'dispatch', 'list_agents'].includes(t.function.name))
  }
  if (ctx.g.autoMediaImg === false) disabled.push('media_img')
  if (ctx.g.autoMediaVideo === false) disabled.push('media_video')
  return disabled.length === 0 ? filtered : filtered.filter(t => !disabled.includes(t.function.name))
}

function filterTools(tools: EngineToolSpec[], agentName: string, agents: Record<string, AgentDef>, autoMcp: boolean): EngineToolSpec[] {
  const ag = agents[agentName]
  if (!ag || ag.tools.includes('*')) return tools
  const allowed = new Set([...ag.tools, 'handoff', 'dispatch', 'list_agents', 'session_search', 'update_plan', 'read_skill'])
  return tools.filter(t => allowed.has(t.function.name) || t.function.name.startsWith('plugin_') || (autoMcp && t.function.name.startsWith('mcp__')))
}

async function mcpConfirm(server: string, tool: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['拒绝', '允许'],
      defaultId: 1,
      cancelId: 0,
      title: 'MCP 工具调用确认',
      message: '是否允许调用 MCP 工具？',
      detail: server + '/' + tool + (args && Object.keys(args).length ? '\n\n参数：' + JSON.stringify(args).slice(0, 800) : ''),
    })
    return response === 1
  } catch { return false }
}

export async function runTool(name: string, a: Record<string, unknown>, ctx: ToolRunCtx): Promise<string> {
  // 角色白名单
  if (ctx.agent) {
    const agDef = ctx.agents[ctx.agent]
    if (agDef && !agDef.tools.includes('*') && !['handoff', 'dispatch', 'list_agents', 'session_search', 'update_plan', 'read_skill'].includes(name) && !agDef.tools.includes(name) && !name.startsWith('plugin_') && !name.startsWith('mcp__')) {
      return 'E:权限不足，该角色无权调用 ' + name
    }
  }
  // MCP 自动注入工具
  if (name.startsWith('mcp__')) {
    const t = parseMcpToolName(name)
    if (!t) return 'E:MCP 工具名格式错误: ' + name
    const lv = (ctx.g.toolPerms || {})[name] || 'ask' // MCP 工具默认首次调用需确认
    if (lv === 'deny') return 'E:permission denied: ' + name + ' 已被禁止(可在 设置→工具→权限 中修改)'
    if (lv === 'ask') {
      const ok = await mcpConfirm(t.server, t.tool, a || {})
      if (!ok) return 'E:permission denied: 用户拒绝了 MCP 工具调用'
    }
    try {
      let r: unknown
      try {
        const { callMCPTool } = require('../mcp/client')
        r = await callMCPTool(t.server, t.tool, a || {})
      } catch (_e) {
        const { callSSETool } = require('../mcp/sse-transport')
        r = await callSSETool(t.server, t.tool, a || {})
      }
      return typeof r === 'string' ? r : JSON.stringify(r)
    } catch (e: unknown) { return 'E:MCP 工具调用异常: ' + errMsg(e) }
  }
  // 插件工具
  if (name.startsWith('plugin_')) {
    const rest = name.slice(7)
    const sep = rest.lastIndexOf('__')
    if (sep <= 0) return 'E:插件工具名格式错误: ' + name
    const plugin = rest.slice(0, sep)
    const tool = rest.slice(sep + 2)
    try { return String(await invokeHandler('plugins:exec', [{ plugin, tool, args: a || {} }], ctx.sender)) } catch (e: unknown) { return 'E:插件执行异常: ' + errMsg(e) }
  }
  // 声明式 handler 分发
  const def = TOOL_HANDLERS.find(d => d.name === name)
  if (!def) return 'E:unknown:' + name
  try {
    const permErr = checkFilePermission(name, a, ctx)
    if (permErr) return permErr
    const perms = ctx.g.toolPerms || {}
    const lv = perms[name]
    if (lv === 'deny') return 'E:permission denied: ' + name + ' 已被禁止(可在 设置→工具→权限 中修改)'
    if (lv === 'ask') return 'E:permission denied: ' + name + ' 需要手动确认(可在 设置→工具→权限 中改为允许后重试)'
    const ck = name + ':' + JSON.stringify(a || {})
    if (def.cacheable) {
      const cached = getCached(ck, name)
      if (cached) return cached + ' [cache]'
    }
    if (def.writeOp) onWriteOp()
    const r = await def.run(a as Record<string, string>, ctx)
    if (def.cacheable) setCached(ck, r)
    return r
  } catch (e: unknown) { return 'E:' + errMsg(e) }
}

// workflow 工具递归调用注册(避免模块循环依赖)
setRunToolRef(runTool)
