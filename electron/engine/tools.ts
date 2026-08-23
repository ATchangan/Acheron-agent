// electron/engine/tools.ts — 工具分发器(schema/执行器已拆分到 tool-specs / tool-handlers)
// 本文件只保留: 权限/缓存/白名单/MCP 确认 + runTool 分发框架。
import { invokeHandler } from './registry'
import { join } from 'path'
import { CACHE_TTL } from './constants'
import type { EngineToolSpec } from './types'
import type { AgentDef } from './agents'
import { errMsg } from './errmsg'
import { parseMcpToolName, resolveMcpToolName } from '../shared/mcp-utils'
import { TOOLS, getMcpToolSpecs } from './tool-specs'
import { TOOL_HANDLERS, closeTerminalSessions, setRunToolRef } from './tool-handlers'
import type { ToolRunCtx } from './tool-types'
import { checkFilePermission } from './tool-permission'
import { requestRiskConfirm } from '../ipc/risk-confirm'
import { getPluginToolSpecs } from '../plugins/author'
export { parseMcpToolName, TOOLS, getMcpToolSpecs, closeTerminalSessions }
export type { ToolRunCtx }

// v0.3.8: 主控核心工具集 —— 默认只给常用工具, 省 schema/上下文; 进阶工具可在 设置→工具 单独放行或关闭核心模式
const CORE_TOOLS = new Set([
  'read', 'write', 'edit', 'apply_patch', 'mkdir', 'ls', 'grep', 'find',
  'exec_command', 'git', 'terminal_open', 'terminal_run', 'terminal_close',
  'web_search', 'web_fetch', 'web_read', 'read_skill', 'skill_manage', 'init_project_docs', 'update_plan',
  'system_info', 'session_search', 'save_memory', 'recall_memory', 'recall_events', 'recall_tool_output',
  'desktop_screenshot', 'desktop_click', 'desktop_move', 'desktop_scroll', 'desktop_type', 'desktop_key',
  'list_agents', 'dispatch', 'handoff', 'list_workflows', 'run_workflow',
  'install_plugin', 'list_plugins', 'read_plugin', 'remove_plugin', 'reload_plugins',
  'set_ui_display', 'get_ui_display',
  'get_settings', 'set_settings',
])

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
  // 插件工具恒注入(与 MCP 开关解耦): 用户显式安装的自写插件按 plugin_<name>__<tool> 进模型工具列表
  const merged = [...TOOLS, ...getPluginToolSpecs(join(ctx.userDataPath, 'plugins'), false, join(ctx.userDataPath, 'settings.json')), ...(autoMcp ? getMcpToolSpecs() : [])]
  // v0.3.5 T2: 工具白名单开关 —— 关闭时不过 agent 白名单, 返回全量工具
  let filtered = (ctx.agent && ctx.g.perf?.toolWhitelist !== false) ? filterTools(merged, ctx.agent, ctx.agents, ctx.g.mcpAutoInject !== false) : merged
  // v0.3.8: 核心工具模式(默认开) —— 只约束主控(无 agent / 主控), 其它角色仍按各自白名单; 用户在工具权限里显式配置过的工具自动放行
  const isMain = !ctx.agent || ctx.agent === '主控'
  if (ctx.g.perf?.toolCore !== false && isMain) {
    const explicit = new Set(Object.keys(ctx.g.toolPerms || {}).filter(k => (ctx.g.toolPerms || {})[k] !== 'deny'))
    filtered = filtered.filter(t => CORE_TOOLS.has(t.function.name) || explicit.has(t.function.name) || t.function.name.startsWith('mcp__') || t.function.name.startsWith('plugin_'))
  }
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
  const allowed = new Set([...ag.tools, 'handoff', 'dispatch', 'list_agents', 'clarify', 'session_search', 'update_plan', 'read_skill'])
  return tools.filter(t => allowed.has(t.function.name) || t.function.name.startsWith('plugin_') || (autoMcp && t.function.name.startsWith('mcp__')))
}

async function mcpConfirm(server: string, tool: string, args: Record<string, unknown>, ctx: ToolRunCtx): Promise<boolean> {
  try {
    // 自省整改: MCP 确认统一走软件内风险确认卡片(与 L2/L3 操作同一套「本次任务/以后都批准」)
    const d = await requestRiskConfirm({
      kind: 'MCP 工具调用',
      detail: server + '/' + tool + (args && Object.keys(args).length ? '\n\n参数：' + JSON.stringify(args).slice(0, 800) : ''),
      level: 'L3',
      sid: ctx.sid,
      taskId: ctx.taskId,
    })
    return d === 'allow'
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
      const ok = await mcpConfirm(t.server, t.tool, a || {}, ctx)
      if (!ok) return 'E:permission denied: 用户拒绝了 MCP 工具调用'
    }
    try {
      let r: unknown
      try {
        const { callMCPTool, listServers } = require('../mcp/client')
        const real = resolveMcpToolName(name, listServers().map((s: { name: string; tools: { name: string }[] }) => ({ name: s.name, tools: s.tools.map(x => x.name) })))
        const p = real || { server: t.server, tool: t.tool }
        r = await callMCPTool(p.server, p.tool, a || {})
      } catch (_e) {
        const { callSSETool, listSSEServers } = require('../mcp/sse-transport')
        const real = resolveMcpToolName(name, listSSEServers().map((s: { name: string; tools: unknown[] }) => ({ name: s.name, tools: s.tools.map(x => typeof x === 'string' ? x : String((x as { name?: string })?.name || '')) })))
        const p = real || { server: t.server, tool: t.tool }
        r = await callSSETool(p.server, p.tool, a || {})
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
    try { return String(await invokeHandler('plugins:exec', [{ plugin, tool, args: a || {}, sid: ctx.sid, taskId: ctx.taskId, workDir: ctx.workDir }], ctx.sender)) } catch (e: unknown) { return 'E:插件执行异常: ' + errMsg(e) }
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
    const writeOp = typeof def.writeOp === 'function' ? def.writeOp(a) : def.writeOp
    if (writeOp) onWriteOp()
    const r = await def.run(a as Record<string, string>, ctx)
    if (def.cacheable) setCached(ck, r)
    return r
  } catch (e: unknown) { return 'E:' + errMsg(e) }
}

// workflow 工具递归调用注册(避免模块循环依赖)
setRunToolRef(runTool)
