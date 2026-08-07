// electron/engine/tools.ts — 独立内核工具注册表与执行器
// 工具 schema 与渲染层 TOOLS 保持一致; 执行层优先走主进程 handler 注册表(复用全部既有实现与安全检查),
// 记忆/MCP/插件/协作/工作流等复合工具在引擎内直接实现。
import { dialog, Notification } from 'electron'
import { invokeHandler } from './registry'
import { CACHE_TTL, WORKFLOWS } from './constants'
import type { EngineSettings, EngineToolSpec } from './types'
import type { AgentDef } from './agents'
import type { EngineMemory } from './memory'
import { scanMemoryText, recallFromMemory } from './memory'
import { errMsg } from './errmsg'

export const TOOLS: EngineToolSpec[] = [
  { type: 'function', function: { name: 'read', description: 'read(path, offset?, limit?) 读取文件(UTF-8); 大文件用 offset/limit 分段续读', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write', description: 'write(path, content) 创建或覆盖写入文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: 'edit(path, oldText, newText) 精确文本替换(全文替换首个匹配)', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } } },
  { type: 'function', function: { name: 'exec_command', description: 'exec_command(cmd) 执行 PowerShell 命令(工作目录内)', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'mkdir', description: 'mkdir(path) 创建目录(可递归)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'grep', description: 'grep(dirPath, pattern) 在目录文件中搜索文本(正则)', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, pattern: { type: 'string' } }, required: ['dirPath', 'pattern'] } } },
  { type: 'function', function: { name: 'find', description: 'find(dirPath, glob) 按 glob 模式查找文件', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, glob: { type: 'string' } }, required: ['dirPath', 'glob'] } } },
  { type: 'function', function: { name: 'ls', description: 'ls(dirPath?) 列出目录内容(默认工作目录)', parameters: { type: 'object', properties: { dirPath: { type: 'string' } } } } },
  { type: 'function', function: { name: 'system_info', description: 'system_info() 获取 CPU/内存/GPU 系统信息', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'web_search', description: 'web_search(query) 网络搜索', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: 'web_fetch(url) 抓取网页内容', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'web_read', description: 'web_read(url, mode?) 无头浏览器解析网页正文(text|screenshot|pdf); 仅单页解析, 禁止批量抓取', parameters: { type: 'object', properties: { url: { type: 'string' }, mode: { type: 'string', enum: ['text', 'screenshot', 'pdf'] } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browse', description: 'browse(url?) 无头浏览器打开网页并返回可访问性快照: 标题/正文 + 可交互元素列表(带 @编号, 如 @1 [link] 文档)。后续可用 browser_click/browser_type 操作页面', parameters: { type: 'object', properties: { url: { type: 'string', description: '要打开的网址; 省略则快照当前页面' } } } } },
  { type: 'function', function: { name: 'browse_screenshot', description: 'browse_screenshot(url) 对网页截图', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browser_click', description: 'browser_click(ref) 点击页面中 @编号 的元素(ref 来自 browse 快照)', parameters: { type: 'object', properties: { ref: { type: 'string', description: '形如 @1' } }, required: ['ref'] } } },
  { type: 'function', function: { name: 'browser_type', description: 'browser_type(ref, text) 向 @编号 输入框输入文字(输入前建议先 browser_click 聚焦)', parameters: { type: 'object', properties: { ref: { type: 'string' }, text: { type: 'string' } }, required: ['ref', 'text'] } } },
  { type: 'function', function: { name: 'browser_press', description: 'browser_press(key) 按下按键: Enter/Escape/Tab/ArrowDown/ArrowUp/ArrowLeft/ArrowRight/Backspace/空格 等', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } },
  { type: 'function', function: { name: 'browser_scroll', description: 'browser_scroll(direction) 页面滚动: down(向下)/up(向上)', parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['down', 'up'] } }, required: ['direction'] } } },
  { type: 'function', function: { name: 'browser_console', description: 'browser_console(expression) 在当前浏览器页面执行 JavaScript 并返回结果(用于读取页面状态/触发页面逻辑)', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } } },
  { type: 'function', function: { name: 'browser_vision', description: 'browser_vision(question) 对当前浏览器页面截图并用视觉模型回答(适合需要看图才能完成的网页操作/验证)', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } } },
  { type: 'function', function: { name: 'screenshot', description: 'screenshot() 截取屏幕', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'clipboard_read', description: 'clipboard_read() 读取剪贴板文本', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'clipboard_write', description: 'clipboard_write(text) 写入剪贴板', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'process_list', description: 'process_list() 列出运行中进程', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'kill_process', description: 'kill_process(pid) 按 PID 结束进程', parameters: { type: 'object', properties: { pid: { type: 'string' } }, required: ['pid'] } } },
  { type: 'function', function: { name: 'save_memory', description: 'save_memory(fact, pinned?) 保存记忆; pinned=true 置顶跨会话永久保留', parameters: { type: 'object', properties: { fact: { type: 'string' }, pinned: { type: 'boolean' } }, required: ['fact'] } } },
  { type: 'function', function: { name: 'recall_memory', description: 'recall_memory(query) 语义检索记忆', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'session_search', description: 'session_search(query, limit?) 关键词搜索历史会话(跨会话回忆, 返回匹配消息摘要)', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'codebox', description: 'codebox(lang, code) 沙箱运行 Python/Node 代码(lang: python|node)', parameters: { type: 'object', properties: { lang: { type: 'string' }, code: { type: 'string' } }, required: ['lang', 'code'] } } },
  { type: 'function', function: { name: 'import_doc', description: 'import_doc(path) 导入文档到知识库', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'schedule_task', description: 'schedule_task(expression, prompt) 创建定时任务(如 every 30m|every 1h|at 09:00)', parameters: { type: 'object', properties: { expression: { type: 'string' }, prompt: { type: 'string' } }, required: ['expression', 'prompt'] } } },
  { type: 'function', function: { name: 'list_schedules', description: 'list_schedules() 列出全部定时任务', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'mcp_connect', description: 'mcp_connect(name, command, args) 连接 MCP 服务器(args 为字符串数组)', parameters: { type: 'object', properties: { name: { type: 'string' }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['name', 'command'] } } },
  { type: 'function', function: { name: 'mcp_call', description: 'mcp_call(server, tool, args) 调用 MCP 工具', parameters: { type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object' } }, required: ['server', 'tool'] } } },
  { type: 'function', function: { name: 'handoff', description: 'handoff(agent_name, reason) 将任务交接给另一角色并切换身份执行', parameters: { type: 'object', properties: { agent_name: { type: 'string', enum: ['姬子', '三月七', '银狼', '艾丝妲', '知更鸟', '黑天鹅', '螺丝咕姆'] }, reason: { type: 'string' }, context: { type: 'string' } }, required: ['agent_name'] } } },
  { type: 'function', function: { name: 'dispatch', description: 'dispatch(tasks) 并行分发子任务给多个角色独立执行并汇总; tasks=[{agent, task}]', parameters: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: { agent: { type: 'string' }, task: { type: 'string' } }, required: ['agent', 'task'] } }, reason: { type: 'string' } }, required: ['tasks'] } } },
  { type: 'function', function: { name: 'list_agents', description: 'list_agents() 列出全部角色', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_workflows', description: 'list_workflows() 列出工作流模板', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'run_workflow', description: 'run_workflow(workflow_id, variables?) 按模板运行工作流', parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, variables: { type: 'object' } }, required: ['workflow_id'] } } },
  { type: 'function', function: { name: 'read_image', description: 'read_image(path) 读取图片为 dataURL(脚本内部用; 用户提供图片路径时系统自动处理)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'media_img', description: 'media_img(prompt, ratio?) 生成图片(用户需求涉及 画/生成/创作/制作 图片时自动调用)', parameters: { type: 'object', properties: { prompt: { type: 'string', description: '画面描述(尽量详细: 主体/风格/光线/构图)' }, ratio: { type: 'string', description: '可选: 1:1/16:9/9:16/4:3/3:4' } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'media_video', description: 'media_video(prompt, duration?) 生成视频(用户需求涉及 生成/制作 视频时自动调用)', parameters: { type: 'object', properties: { prompt: { type: 'string', description: '视频内容描述' }, duration: { type: 'number', description: '可选: 时长秒数(默认5)' } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'set_workdir', description: 'set_workdir(path) 切换工作目录(本次会话)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'set_theme', description: 'set_theme(theme) 切换主题', parameters: { type: 'object', properties: { theme: { type: 'string' } }, required: ['theme'] } } },
  { type: 'function', function: { name: 'show_card', description: 'show_card(html, title?) 渲染交互卡片(SVG/图表/示意图)', parameters: { type: 'object', properties: { html: { type: 'string' }, title: { type: 'string' } }, required: ['html'] } } },
  { type: 'function', function: { name: 'bridge_notify', description: 'bridge_notify(title, body?) 发送桌面通知', parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'workflow', description: 'workflow(script) 执行 JS 工作流脚本(ctx.log/ctx.tools.run/ctx.done)', parameters: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } } },
  { type: 'function', function: { name: 'audit_log', description: 'audit_log(limit?) 查看最近操作审计记录(工具调用/文件变更/时间)', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'watch_file', description: 'watch_file(path) 监测文件变化(返回自上次检查以来的变更)', parameters: { type: 'object', properties: { path: { type: 'string' }, interval: { type: 'number', description: '轮询间隔 ms(默认5000)' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'save_goal', description: 'save_goal(goal, steps?) 持久化长期目标(重启后可恢复)', parameters: { type: 'object', properties: { goal: { type: 'string' }, steps: { type: 'string', description: '步骤描述的 JSON 数组' } }, required: ['goal'] } } },
  { type: 'function', function: { name: 'list_goals', description: 'list_goals() 查看全部持久化目标及进度', parameters: { type: 'object', properties: {} } } },
]

export interface ToolRunCtx {
  sid: string
  taskId: string
  g: EngineSettings
  agents: Record<string, AgentDef>
  agent?: string
  isSubtask?: boolean
  activeAgents: string[]
  workDir: string
  memoryPath: string
  userDataPath: string
  sender?: Electron.WebContents | null
  getMemory: () => EngineMemory
  saveMemory: (m: EngineMemory) => void
  onAgentChange: (agent: string) => void
  onWorkDirChange?: (dir: string) => void
  onThemeChange?: (theme: string) => void
  runDispatch: (tasks: { agent: string; task: string }[]) => Promise<string>
  getHandoffCounts?: () => Record<string, number>
  onHandoffRecord?: (agent: string) => void
  logTrace: (level: 'debug' | 'info' | 'warn' | 'error', event: string, detail?: string) => void
}

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

const watchState: Record<string, string> = {}

function normPath(p: string): string {
  const norm = String(p || '').replace(/\\/g, '/')
  const isAbs = /^[a-zA-Z]:\//.test(norm) || norm.startsWith('/')
  const parts: string[] = []
  for (const seg of norm.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return (isAbs ? '/' : '') + parts.join('/')
}

function checkFilePermission(name: string, args: Record<string, unknown>, ctx: ToolRunCtx): string | null {
  const perm = ctx.g.filePermission || 'full'
  if (perm === 'full') return null
  const wd = ctx.workDir || ''
  const p = String(args.path || args.dirPath || '')
  if (perm === 'sandbox' && wd && p) {
    const rp = normPath(p).toLowerCase()
    const rw = normPath(wd).toLowerCase()
    if (!(rp === rw || (rw && rp.startsWith(rw + '/')))) return 'E:permission denied (sandbox): path outside work directory'
  }
  if (perm === 'readonly' && ['write', 'edit', 'mkdir', 'exec_command', 'codebox'].includes(name)) return 'E:permission denied (readonly): ' + name + ' not allowed'
  if (perm === 'ask' && ['write', 'edit', 'mkdir', 'exec_command', 'codebox'].includes(name)) return 'E:permission denied (ask): ' + name + ' requires manual confirmation. Use settings to change permission level.'
  return null
}

export function getActiveTools(ctx: ToolRunCtx): EngineToolSpec[] {
  const raw = ctx.g.disabledTools
  const disabled: string[] = raw === undefined ? ['workflow'] : (raw || [])
  const autoMcp = ctx.g.mcpAutoInject !== false
  const merged = autoMcp ? [...TOOLS, ...getMcpToolSpecs()] : [...TOOLS]
  const filtered = ctx.agent ? filterTools(merged, ctx.agent, ctx.agents, ctx.g.mcpAutoInject !== false) : merged
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
  const allowed = new Set([...ag.tools, 'handoff', 'dispatch', 'list_agents', 'session_search'])
  return tools.filter(t => allowed.has(t.function.name) || t.function.name.startsWith('plugin_') || (autoMcp && t.function.name.startsWith('mcp__')))
}

// ─── MCP schema 自动注入(主进程侧直读) ───
let mcpSpecsCache: EngineToolSpec[] | null = null
let mcpSpecsAt = 0
export function getMcpToolSpecs(force = false): EngineToolSpec[] {
  if (!force && mcpSpecsCache && Date.now() - mcpSpecsAt < 15000) return mcpSpecsCache
  const specs: EngineToolSpec[] = []
  const seen = new Set<string>()
  try {
    const { listServers } = require('../mcp/client')
    for (const s of listServers() || []) {
      for (const t of s.tools || []) {
        const name = 'mcp__' + String(s.name).replace(/[^a-zA-Z0-9_-]/g, '_') + '__' + String(t.name).replace(/[^a-zA-Z0-9_-]/g, '_')
        if (seen.has(name)) continue
        seen.add(name)
        const props: Record<string, { type: string; description?: string }> = {}
        const required: string[] = []
        const schema = (t.inputSchema || {}) as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }
        for (const [k, v] of Object.entries(schema.properties || {})) {
          const vt = String(v.type || 'string')
          props[k] = { type: vt === 'integer' || vt === 'number' || vt === 'boolean' || vt === 'array' || vt === 'object' ? vt : 'string', description: v.description || k }
        }
        for (const k of schema.required || []) if (props[k]) required.push(k)
        specs.push({ type: 'function', function: { name, description: String(t.description || ('MCP 工具 ' + s.name + '/' + t.name)).slice(0, 200), parameters: { type: 'object', properties: props, required } } })
      }
    }
  } catch { /* 忽略 */ }
  try {
    const { listSSEServers } = require('../mcp/sse-transport')
    for (const s of listSSEServers() || []) {
      for (const t of s.tools || []) {
        const meta = typeof t === 'string' ? { name: t } : t
        const name = 'mcp__' + String(s.name).replace(/[^a-zA-Z0-9_-]/g, '_') + '__' + String(meta.name).replace(/[^a-zA-Z0-9_-]/g, '_')
        if (seen.has(name)) continue
        seen.add(name)
        const props: Record<string, { type: string; description?: string }> = {}
        const schema = ((meta as { inputSchema?: Record<string, unknown> }).inputSchema || {}) as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }
        for (const [k, v] of Object.entries(schema.properties || {})) {
          const vt = String(v.type || 'string')
          props[k] = { type: vt === 'integer' || vt === 'number' || vt === 'boolean' || vt === 'array' || vt === 'object' ? vt : 'string', description: v.description || k }
        }
        const required = (schema.required || []).filter((k: string) => props[k])
        specs.push({ type: 'function', function: { name, description: String((meta as { description?: string }).description || ('MCP 工具 ' + s.name + '/' + meta.name)).slice(0, 200), parameters: { type: 'object', properties: props, required } } })
      }
    }
  } catch { /* 忽略 */ }
  mcpSpecsCache = specs
  mcpSpecsAt = Date.now()
  return specs
}

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name || !name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const i = rest.indexOf('__')
  if (i <= 0 || i + 2 >= rest.length) return null
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) }
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

function parseDispatchTasks(raw: unknown): { agent: string; task: string }[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(parsed)) return parsed as { agent: string; task: string }[]
    if (parsed && Array.isArray((parsed as { tasks?: unknown }).tasks)) return (parsed as { tasks: { agent: string; task: string }[] }).tasks
  } catch { /* 忽略 */ }
  return []
}

export async function runTool(name: string, a: Record<string, unknown>, ctx: ToolRunCtx): Promise<string> {
  const A = a as unknown as Record<string, string>
  // 角色白名单
  if (ctx.agent) {
    const agDef = ctx.agents[ctx.agent]
    if (agDef && !agDef.tools.includes('*') && !['handoff', 'dispatch', 'list_agents', 'session_search'].includes(name) && !agDef.tools.includes(name) && !name.startsWith('plugin_') && !name.startsWith('mcp__')) {
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
      } catch (e) {
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
  try {
    const permErr = checkFilePermission(name, a, ctx)
    if (permErr) return permErr
    const perms = ctx.g.toolPerms || {}
    const lv = perms[name]
    if (lv === 'deny') return 'E:permission denied: ' + name + ' 已被禁止(可在 设置→工具→权限 中修改)'
    if (lv === 'ask') return 'E:permission denied: ' + name + ' 需要手动确认(可在 设置→工具→权限 中改为允许后重试)'
    const ck = name + ':' + JSON.stringify(a || {})
    const cached = getCached(ck, name)
    if (cached) return cached + ' [cache]'
    if (['write', 'edit', 'mkdir', 'exec_command'].includes(name)) onWriteOp()
    switch (name) {
      case 'read': {
        if (!A.path) return 'E:need path'
        const c = String(await invokeHandler('computer:readFile', [A.path, A.offset ? Number(A.offset) : undefined, A.limit ? Number(A.limit) : undefined], ctx.sender))
        if (A.offset) return c
        return c.length > 8000 ? c.slice(0, 8000) + '\n...[已截断, 共 ' + c.length + ' 字符, 如需后续内容用 read offset=' + (c.slice(0, 8000).split('\n').length + 1) + ' 续读]' : c
      }
      case 'write': {
        if (!A.path || A.content === undefined) return 'E:need path+content'
        const ok = await invokeHandler('computer:writeFile', [A.path, A.content, ctx.sid, ctx.taskId], ctx.sender)
        return ok === true ? A.path + ' (' + A.content.length + ' chars)' : 'E:写入失败: ' + String(ok)
      }
      case 'edit': {
        if (!A.path || !A.oldText) return 'E:need path+oldText+newText'
        const o = String(await invokeHandler('computer:readFile', [A.path], ctx.sender))
        if (!o.includes(A.oldText)) return 'E:text not found in ' + A.path
        const ok = await invokeHandler('computer:writeFile', [A.path, o.replace(A.oldText, A.newText || ''), ctx.sid, ctx.taskId], ctx.sender)
        return ok === true ? A.path + ' (edited)' : 'E:edit failed'
      }
      case 'exec_command': {
        if (!A.cmd) return 'E:need cmd'
        const r = String(await invokeHandler('computer:exec', [A.cmd, ctx.sid, ctx.taskId], ctx.sender))
        const out = r || '(empty output)'
        return out.length > 3000 ? out.slice(0, 1500) + '\n...[输出过长已截断, 共 ' + out.length + ' 字符, 头尾已保留]\n' + out.slice(-1500) : out
      }
      case 'mkdir': { if (!A.path) return 'E:need path'; const r = await invokeHandler('computer:mkdir', [A.path], ctx.sender) as { ok?: boolean; error?: string }; return r?.ok ? A.path + ' (created)' : 'E:mkdir failed: ' + (r?.error || 'unknown') }
      case 'grep': { if (!A.dirPath || !A.pattern) return 'E:need dirPath+pattern'; return String(await invokeHandler('computer:grep', [A.dirPath, A.pattern], ctx.sender)) || '(no matches)' }
      case 'find': { if (!A.dirPath || !A.glob) return 'E:need dirPath+glob'; return String(await invokeHandler('computer:find', [A.dirPath, A.glob], ctx.sender)) || '(no files found)' }
      case 'ls': {
        const items = await invokeHandler('computer:readDir', [A.dirPath || ctx.workDir || '.'], ctx.sender) as { name: string; isDirectory: boolean; size: number }[]
        return Array.isArray(items) ? items.map(i => (i.isDirectory ? '[DIR]' : '[FILE]') + ' ' + i.name + ' (' + i.size + 'B)').join('\n') : '(empty directory)'
      }
      case 'system_info': return JSON.stringify(await invokeHandler('computer:systemInfo', [], ctx.sender), null, 2)
      case 'web_search': { if (!A.query) return 'E:need query'; return String(await invokeHandler('web:search', [A.query], ctx.sender)) || '(none)' }
      case 'web_fetch': return String(await invokeHandler('web:fetch', [A.url || 'about:blank'], ctx.sender))
      case 'web_read': {
        if (!A.url) return 'E:need url'
        try {
          const raw = String(await invokeHandler('web:read', [A.url, A.mode || 'text'], ctx.sender))
          let r: { ok?: boolean; error?: string; advice?: string; text?: string; title?: string; screenshotBase64?: string; pdfBase64?: string }
          try { r = JSON.parse(raw) } catch { return raw.slice(0, 500) }
          if (!r.ok) return 'E:' + (r.error || '读取失败') + (r.advice ? ' | 建议: ' + r.advice : '')
          if (A.mode === 'screenshot' && r.screenshotBase64) return '截图完成(已保存到会话): ' + r.screenshotBase64
          if (A.mode === 'pdf' && r.pdfBase64) return 'PDF 生成完成(base64, 长度 ' + r.pdfBase64.length + ')'
          const body = r.text || '(空页面)'
          return (r.title ? '标题: ' + r.title + '\n' : '') + '\n正文:\n' + (body.length > 6000 ? body.slice(0, 6000) + '\n...[正文过长已截断, 共 ' + body.length + ' 字符]' : body)
        } catch { return 'E:web_read 返回异常' }
      }
      case 'browse': return String(await invokeHandler('browser:snapshotA11y', [A.url, ctx.sid + '::' + ctx.taskId], ctx.sender))
      case 'browse_screenshot': return String(await invokeHandler('browser:screenshot', [A.url, ctx.sid + '::' + ctx.taskId], ctx.sender))
      case 'browser_click': return String(await invokeHandler('browser:click', [A.ref, ctx.sid + '::' + ctx.taskId], ctx.sender))
      case 'browser_type': return String(await invokeHandler('browser:type', [A.ref, A.text, ctx.sid + '::' + ctx.taskId], ctx.sender))
      case 'browser_press': return String(await invokeHandler('browser:press', [A.key, ctx.sid + '::' + ctx.taskId], ctx.sender))
      case 'browser_scroll': return String(await invokeHandler('browser:scroll', [A.direction, ctx.sid + '::' + ctx.taskId], ctx.sender))
      case 'browser_console': return String(await invokeHandler('browser:console', [A.expression, ctx.sid + '::' + ctx.taskId], ctx.sender))
      case 'browser_vision': return 'E:browser_vision 由引擎视觉通道处理'
      case 'screenshot': return String(await invokeHandler('computer:screenshot', [], ctx.sender))
      case 'clipboard_read': return String(await invokeHandler('computer:clipboardRead', [], ctx.sender))
      case 'clipboard_write': { if (!A.text) return 'E:need text'; await invokeHandler('computer:clipboardWrite', [A.text], ctx.sender); return 'ok:clipped' }
      case 'process_list': return String(await invokeHandler('computer:processList', [], ctx.sender))
      case 'kill_process': { if (!A.pid) return 'E:need pid'; return String(await invokeHandler('computer:killProcess', [A.pid], ctx.sender)) }
      case 'save_memory': {
        const m = ctx.getMemory()
        const fact = String(A.fact || '').trim()
        if (!fact) return 'E:need fact'
        const scan = scanMemoryText(fact)
        if (!scan.ok) return 'E:' + scan.reason
        if (A.pinned) {
          const pf = m.pinnedFacts || []
          if (pf.some(f => String(f).trim() === fact)) return 'ok:already saved'
          m.pinnedFacts = [...pf, fact]
        } else {
          if (m.facts.some(f => String(f).trim() === fact)) return 'ok:already saved'
          m.facts = [...m.facts, fact]
        }
        ctx.saveMemory(m)
        return 'ok:saved'
      }
      case 'recall_memory': {
        const query = (A.query || '').trim()
        let vecHits: { content: string; score: number }[] = []
        try {
          const v = await invokeHandler('memory:search', [query], ctx.sender)
          if (Array.isArray(v)) vecHits = v.map((x: { content?: string }) => ({ content: String(x.content || ''), score: 0.5 }))
        } catch { /* 忽略 */ }
        return recallFromMemory(ctx.getMemory(), query, vecHits)
      }
      case 'session_search': {
        const q = String(A.query || '').trim()
        if (!q) return 'E:need query'
        const r = await invokeHandler('sessions:search', [q, A.limit ? Number(A.limit) : 5], ctx.sender) as { title: string; role: string; snippet: string; ts: number }[]
        return Array.isArray(r) && r.length ? r.map((x, i) => `${i + 1}. [${x.title}](${x.role}) ${new Date(x.ts).toLocaleDateString('zh-CN')} ${x.snippet}`).join('\n---\n') : '(no matches)'
      }
      case 'codebox': { if (!A.lang || !A.code) return 'E:need lang+code'; return String(await invokeHandler('computer:codebox', [A.lang, A.code], ctx.sender)) }
      case 'import_doc': { if (!A.path) return 'E:need path'; const ok = await invokeHandler('memory:importFile', [A.path], ctx.sender); return ok === true ? 'ok:imported' : 'E:import failed' }
      case 'schedule_task': { if (!A.expression || !A.prompt) return 'E:need expression+prompt'; const cr = await invokeHandler('cron:add', [A.expression, A.prompt], ctx.sender); return JSON.stringify(cr) }
      case 'list_schedules': {
        const items = await invokeHandler('cron:list', [], ctx.sender) as { enabled?: boolean; expression: string; prompt: string }[]
        return Array.isArray(items) && items.length ? items.map((j, i) => (i + 1) + '. [' + (j.enabled ? 'on' : 'off') + '] ' + j.expression + ' - ' + j.prompt).join(' | ') : '(empty)'
      }
      case 'mcp_connect': {
        if (!A.name || !A.command) return 'E:need name+command'
        try {
          const { connectServer } = require('../mcp/client')
          const tools = await connectServer(A.name, A.command, A.args ? A.args.split(' ') : [])
          getMcpToolSpecs(true)
          return 'ok:' + A.name + ' (' + (Array.isArray(tools) ? tools.length : 0) + ' tools)'
        } catch (e: unknown) { return 'E:MCP 连接失败: ' + errMsg(e) }
      }
      case 'mcp_call': {
        if (!A.server || !A.tool) return 'E:need server+tool'
        try {
          const { callMCPTool } = require('../mcp/client')
          const r = await callMCPTool(A.server, A.tool, (A.args || '{}') as unknown as Record<string, unknown>)
          return typeof r === 'string' ? r : JSON.stringify(r)
        } catch (e: unknown) { return 'E:' + errMsg(e) }
      }
      case 'set_workdir': { if (!A.path) return 'E:need path'; ctx.workDir = A.path; ctx.onWorkDirChange?.(A.path); return '工作目录已设为(本次会话): ' + A.path }
      case 'set_theme': { if (!A.theme) return 'E:need theme'; ctx.onThemeChange?.(A.theme); return '主题已切换: ' + A.theme }
      case 'handoff': {
        if (ctx.isSubtask) return 'E:子任务内不允许交接，请直接完成当前子任务或返回主控角色'
        if (!A.agent_name) return 'E:缺少角色名'
        const ag = ctx.agents[A.agent_name]
        if (!ag) return 'E:未知角色: ' + A.agent_name
        if ((ctx.g.disabledAgents || []).includes(A.agent_name)) return 'E:该角色已被禁用: ' + A.agent_name
        // 防反复横跳熔断: 同一角色被反复交接多次(如 A→B→A→B)视为死循环, 拒绝并要求改用 dispatch 或直接完成
        const handoffCounts = ctx.getHandoffCounts ? ctx.getHandoffCounts() : {}
        const handoffMelt = (ctx.g.meltdownLimit || 3) + 2
        if ((handoffCounts[A.agent_name] || 0) >= handoffMelt) {
          return 'E:该角色已被反复交接 ' + (handoffCounts[A.agent_name] || 0) + ' 次, 疑似死循环。请在当前角色直接完成剩余工作, 或改用 dispatch 并行分发'
        }
        // 交接链动态自动调节: 达到设置长度不中断, 自动顺延, 直到任务完成
        const maxChain = ctx.g.maxHandoffChain || 3
        if (!ctx.activeAgents.includes(A.agent_name) && ctx.activeAgents.length >= maxChain) {
          ctx.g.maxHandoffChain = ctx.activeAgents.length + 1
          ctx.logTrace('warn', 'handoff.chain-extend', A.agent_name + ' 链长 ' + ctx.activeAgents.length + ' → ' + (ctx.activeAgents.length + 1))
        }
        ctx.onHandoffRecord?.(String(A.agent_name))
        ctx.onAgentChange(A.agent_name)
        return `✅ 已交接给 ${A.agent_name}(${ag.role})。原因: ${A.reason || '能力边界外'}。现在你以 ${A.agent_name} 的身份继续执行。\n\n【${A.agent_name} 身份】${ag.prompt}`
      }
      case 'list_agents': {
        const disabled = ctx.g.disabledAgents || []
        return Object.entries(ctx.agents).filter(([n]) => !disabled.includes(n)).map(([n, ag]) => `${ag.icon} **${n}** (${ag.role}): ${ag.prompt.slice(0, 80)}... | 工具: ${ag.tools.join(', ')}`).join('\n\n')
      }
      case 'dispatch': {
        if (ctx.isSubtask) return 'E:子任务内不允许再次分发，请直接完成当前子任务'
        const dTasks = parseDispatchTasks(A.tasks ?? A.plan ?? '[]')
        // 动态自动调节: 不再设固定总时长, 由每个子任务的活动看门狗 + 动态轮次决定结束时机, 任务推进到完成即可
        return await ctx.runDispatch(dTasks)
      }
      case 'list_workflows': return Object.entries(WORKFLOWS).map(([id, w]) => `- **${id}** (${w.name}): 触发词 → ${w.triggers.slice(0, 3).join(', ')}; ${w.steps.length} 步骤`).join('\n')
      case 'run_workflow': {
        if (!A.workflow_id) return 'E:need workflow_id'
        const wf = WORKFLOWS[A.workflow_id]
        if (!wf) return 'E:unknown workflow: ' + A.workflow_id
        let vars: Record<string, string> = {}
        try { vars = JSON.parse(A.variables || '{}') } catch { vars = {} }
        const steps = wf.steps.map((s, i) => `${i + 1}. ${s.desc} → \`${s.tool}(${s.args_template.replace(/\{(\w+)\}/g, (_: string, k: string) => vars[k] || `{${k}}`)})\``).join('\n')
        return `工作流 **${wf.name}** (${wf.steps.length}步):\n${steps}\n\n请按顺序执行以上步骤，每步完成后验证结果。`
      }
      case 'read_image': { if (!A.path) return 'E:need path'; return String(await invokeHandler('computer:readImageBase64', [A.path], ctx.sender)) }
      case 'media_img': {
        if (!A.prompt) return 'E:need prompt'
        const r = await invokeHandler('media:gen', [{ kind: 'img', prompt: String(A.prompt), ratio: A.ratio ? String(A.ratio) : undefined }], ctx.sender) as { ok?: boolean; path?: string; error?: string }
        return r?.ok ? ('图片已生成: ' + (r.path || '')) : ('生成失败: ' + (r?.error || ''))
      }
      case 'media_video': {
        if (!A.prompt) return 'E:need prompt'
        const r = await invokeHandler('media:gen', [{ kind: 'video', prompt: String(A.prompt), duration: A.duration ? Number(A.duration) : undefined }], ctx.sender) as { ok?: boolean; path?: string; error?: string }
        return r?.ok ? ('视频已生成: ' + (r.path || '')) : ('生成失败: ' + (r?.error || ''))
      }
      case 'show_card': { if (!A.html) return 'E:need html'; return '<!--CARD' + (A.title ? ':' + A.title : '') + '-->' + A.html + '<!--/CARD-->' }
      case 'bridge_notify': {
        try { new Notification({ title: A.title || '黄泉Agent', body: A.body || '' }).show() } catch { /* 忽略 */ }
        return 'ok:notified'
      }
      case 'workflow': {
        if (!A.script) return 'E:need script'
        if (String(A.script).length > 8192) return 'E:workflow script too long (max 8KB)'
        return new Promise<string>(resolve => {
          const logs: string[] = []
          let settled = false
          const timeout = setTimeout(() => finish('E:workflow timeout (30s)'), 30000)
          const finish = (r: unknown) => { if (settled) return; settled = true; clearTimeout(timeout); resolve(String(r)) }
          const wctx = {
            log: (msg: unknown) => { logs.push(String(msg)); if (logs.length > 200) logs.shift() },
            tools: { run: async (n: string, args: Record<string, unknown>) => { logs.push('[wf] ' + n); return await runTool(n, args, ctx) } },
            done: (r: unknown) => finish(JSON.stringify({ result: r, logs }, null, 2)),
          }
          try {
            const fn = new Function('ctx', '"use strict"; ' + A.script)
            const ret = fn(wctx)
            if (ret instanceof Promise) {
              ret.then(v => finish(JSON.stringify({ result: v, logs }, null, 2))).catch(e => finish('E:workflow error: ' + errMsg(e)))
            } else if (!settled) finish(JSON.stringify({ result: ret ?? null, logs }, null, 2))
          } catch (e) { finish('E:workflow error: ' + errMsg(e)) }
        })
      }
      case 'audit_log': {
        const mem = ctx.getMemory()
        const log = (mem.episodic || []).slice(-(Number(A.limit || 20)))
        return log.length ? log.map((e, i) => `${i + 1}. [${new Date(e.ts).toLocaleString('zh-CN')}] ${e.op} ${e.path || ''} → ${e.status}`).join('\n') : '(无操作记录)'
      }
      case 'watch_file': {
        if (!A.path) return 'E:need path'
        try {
          const content = String(await invokeHandler('computer:readFile', [A.path], ctx.sender))
          let hash = ''
          try {
            const crypto = require('crypto')
            hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 32)
          } catch { hash = content.length + ':' + content.slice(0, 200) }
          if (watchState[A.path] && watchState[A.path] !== hash) {
            const old = watchState[A.path]
            watchState[A.path] = hash
            return `CHANGED: ${A.path} (hash: ${old.slice(0, 16)}... → ${hash.slice(0, 16)}...)`
          }
          watchState[A.path] = hash
          return `WATCHING: ${A.path} (${content.length} bytes). Call again to detect changes.`
        } catch (e: unknown) { return 'E:watch failed: ' + errMsg(e) }
      }
      case 'save_goal': {
        const mem = ctx.getMemory()
        const goals = mem.goals || []
        goals.push({ goal: A.goal, steps: A.steps ? JSON.parse(A.steps) : [], created: Date.now(), status: 'active' })
        mem.goals = goals
        ctx.saveMemory(mem)
        return 'ok:goal_saved (' + goals.length + ' goals total)'
      }
      case 'list_goals': {
        const goals = ctx.getMemory().goals || []
        return goals.length ? goals.map((g, i) => `${i + 1}. [${g.status}] ${g.goal} (${(g.steps || []).length} steps, ${new Date(g.created || 0).toLocaleDateString('zh-CN')})`).join('\n') : '(无持久化目标)'
      }
      default: return 'E:unknown:' + name
    }
  } catch (e: unknown) { return 'E:' + errMsg(e) }
}
