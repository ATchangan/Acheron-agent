import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Message, SessionData, LLMMessage } from '../global'
import { useSettingsStore } from './settings'

// ─── v0.2: 渲染进程内置模块 ────────────────────────────

// 简易工具缓存（避免 IPC 往返延迟）
const toolCache = new Map<string, { result: string; ts: number }>()
const CACHE_TTL: Record<string, number> = {
  read: 30000, ls: 30000, grep: 30000, find: 30000,
  web_search: 120000, web_fetch: 120000,
  system_info: 60000, process_list: 60000,
  list_agents: 300000, list_workflows: 300000,
  default: 10000,
}
function getCached(key: string, ttlKey: string): string | null {
  const e = toolCache.get(key); if (!e) return null
  if (Date.now() - e.ts > (CACHE_TTL[ttlKey] || CACHE_TTL.default)) { toolCache.delete(key); return null }
  return e.result
}
function setCached(key: string, result: string) { toolCache.set(key, { result, ts: Date.now() }) }
function onWriteOp() { for (const k of toolCache.keys()) { if (/^(read|ls|grep|find):/.test(k)) toolCache.delete(k) } }

// Token 估算（中英混合）
function estimateTokens(text: string): number {
  if (!text) return 0
  const cn = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  return Math.ceil(cn / 1.5 + (text.length - cn) / 3.5)
}

// ─── v0.2: 多Agent 编队 ───────────────────────────────
const AGENTS: Record<string, { role: string; prompt: string; tools: string[]; handoff_to: string[]; icon: string }> = {
  '阎罗王': { role: '主控调度', prompt: '你是阎罗王，黄泉 Agent 编队的主控者。职责：接收用户任务，分解为子任务，分配给合适的 Agent，汇总结果。风格：权威但不傲慢，决策果断。复杂任务先用 list_agents 查看编队，再用 handoff 交接。你有全部工具权限，可以执行任何电脑操作。', tools: ['全工具'], handoff_to: ['判官','钟馗','无常','孟婆','画师','码师'], icon: '👑' },
  '判官': { role: '文档处理', prompt: '你是判官，文档与内容处理专家。职责：文档分析、报告撰写、内容审核、翻译校对。风格：严谨细致，条理分明。你有全部工具权限，包括文件读写、命令执行、网络检索。', tools: ['全工具'], handoff_to: ['阎罗王','钟馗','码师'], icon: '📜' },
  '钟馗': { role: '安全与代码审查', prompt: '你是钟馗，安全与代码审查专家。职责：安全检查、漏洞扫描、代码审查、风险预警。风格：一针见血。你有全部工具权限，包括文件读写、命令执行、代码运行。', tools: ['全工具'], handoff_to: ['阎罗王','码师'], icon: '⚔️' },
  '无常': { role: '任务调度与自动化', prompt: '你是无常，消息与任务调度者。职责：定时提醒、事件监控、通知推送、自动化脚本。你有全部工具权限，包括定时任务、命令执行、文件操作。', tools: ['全工具'], handoff_to: ['阎罗王','码师'], icon: '🔔' },
  '孟婆': { role: '情感陪伴与日常', prompt: '你是孟婆，情感陪伴与日常助理。职责：日常闲聊、情感支持、信息查询、生活建议。你有全部工具权限，包括网络检索、文件读写、命令执行。', tools: ['全工具'], handoff_to: ['阎罗王','判官','码师'], icon: '🌸' },
  '画师': { role: '视觉与设计', prompt: '你是画师，视觉创作与设计专家。职责：图片理解、UI/UX 设计、配色方案、截图分析。你有全部工具权限，包括截图、文件读写、网络检索。', tools: ['全工具'], handoff_to: ['阎罗王','码师'], icon: '🎨' },
  '码师': { role: '全栈开发', prompt: '你是码师，全栈开发专家。职责：代码编写、项目搭建、脚本自动化、架构设计。风格：代码优先，输出带注释的完整实现。你有全部工具权限，能操作电脑上任何文件和程序。', tools: ['全工具'], handoff_to: ['阎罗王','钟馗','画师','判官'], icon: '💻' },
}

// ─── v0.2: 工作流模板 ────────────────────────────────
const WORKFLOWS: Record<string, { name: string; triggers: string[]; steps: { tool: string; args_template: string; desc: string }[] }> = {
  'create-project': { name: '创建新项目', triggers: ['创建项目','新建项目','初始化项目','搭建项目'], steps: [
    { tool: 'mkdir', args_template: '{workDir}/{projectName}', desc: '创建项目目录' },
    { tool: 'exec_command', args_template: 'cd {workDir}/{projectName} && npm init -y', desc: '初始化 package.json' },
    { tool: 'write', args_template: '{workDir}/{projectName}/README.md', desc: '创建 README' },
  ]},
  'code-review': { name: '代码审查', triggers: ['审查代码','代码审查','review','code review','检查代码'], steps: [
    { tool: 'ls', args_template: '{targetPath}', desc: '列出文件结构' },
    { tool: 'read', args_template: '{mainFile}', desc: '读取主文件' },
    { tool: 'grep', args_template: '{targetPath} TODO|FIXME|HACK|BUG', desc: '搜索问题标记' },
  ]},
  'web-research': { name: '网络调研', triggers: ['调研','研究','查一下','了解','research'], steps: [
    { tool: 'web_search', args_template: '{query}', desc: '搜索主题' },
    { tool: 'web_fetch', args_template: '{firstResultUrl}', desc: '抓取首条结果' },
    { tool: 'save_memory', args_template: '{topic}: {summary}', desc: '保存到记忆' },
  ]},
  'file-organize': { name: '文件整理', triggers: ['整理文件','分类文件','组织文件','organize'], steps: [
    { tool: 'ls', args_template: '{targetPath}', desc: '列出所有文件' },
    { tool: 'exec_command', args_template: 'cd {targetPath} && for %f in (*.md) do move "%f" docs\\', desc: '移动文档' },
    { tool: 'exec_command', args_template: 'cd {targetPath} && for %f in (*.jpg *.png) do move "%f" images\\', desc: '移动图片' },
  ]},
  'deploy-check': { name: '部署前检查', triggers: ['部署检查','上线检查','发布检查','deploy check'], steps: [
    { tool: 'exec_command', args_template: 'node -v', desc: '检查 Node.js 版本' },
    { tool: 'exec_command', args_template: 'npm -v', desc: '检查 npm 版本' },
    { tool: 'exec_command', args_template: 'cd {targetPath} && npm ls --depth=0', desc: '检查依赖' },
    { tool: 'read', args_template: '{targetPath}/package.json', desc: '检查包配置' },
    { tool: 'grep', args_template: '{targetPath} console.log|debugger|TODO', desc: '检查遗留调试代码' },
  ]},
}
function matchWorkflow(txt: string): string | null {
  const t = txt.toLowerCase()
  const matches = Object.entries(WORKFLOWS).map(([id, w]) => ({ id, score: w.triggers.filter(tr => t.includes(tr.toLowerCase())).length })).filter(m => m.score > 0).sort((a, b) => b.score - a.score)
  return matches[0]?.id || null
}

// ─── v0.2: 模型上下文窗口自动检测 ──────────────────────
function getModelContextLimit(modelName: string): number {
  const m = modelName.toLowerCase()
  // DeepSeek
  if (m.includes('deepseek-v4') || m.includes('deepseek-chat')) return 1048576 // 1M
  if (m.includes('deepseek-v3')) return 65536
  if (m.includes('deepseek')) return 65536
  // OpenAI
  if (m.includes('gpt-4o')) return 131072 // 128K
  if (m.includes('gpt-4-turbo')) return 131072
  if (m.includes('gpt-4-32k')) return 32768
  if (m.includes('gpt-4')) return 8192
  if (m.includes('gpt-3.5-turbo-16k')) return 16384
  if (m.includes('gpt-3.5')) return 4096
  // Claude
  if (m.includes('claude-3.5')) return 200000
  if (m.includes('claude-3')) return 200000
  if (m.includes('claude-2')) return 100000
  // Gemini
  if (m.includes('gemini-2')) return 1048576
  if (m.includes('gemini-1.5')) return 1048576
  if (m.includes('gemini')) return 32768
  // 其他
  if (m.includes('yi-')) return 200000
  if (m.includes('qwen')) return 131072
  if (m.includes('glm')) return 131072
  // 默认 64K
  return 65536
}
function updateContextLimit(modelName: string) {
  const limit = getModelContextLimit(modelName)
  const s = useChatStore.getState()
  if (s.cl !== limit) useChatStore.setState({ cl: limit })
}
// 导出供外部调用（模型切换时实时更新）
export { updateContextLimit, getModelContextLimit }

// Agent 意图路由
function routeAgent(userMessage: string): string | null {
  const t = userMessage.toLowerCase()
  if (/安全|漏洞|审查|bug|风险|检查|审计|防护|攻击|渗透|注入|权限/.test(t)) return '钟馗'
  if (/文档|报告|总结|分析|整理|翻译|校对|审核|论文|文章/.test(t)) return '判官'
  if (/提醒|通知|日程|定时|监控|跟踪|闹钟|计划/.test(t)) return '无常'
  if (/聊天|陪伴|心情|安慰|倾诉|放松|故事|累|伤心|难过/.test(t)) return '孟婆'
  if (/设计|画|配色|UI|UX|图标|logo|banner|海报|审美/.test(t)) return '画师'
  if (/代码|写|开发|编程|实现|脚本|函数|类|接口|api|框架|构建|部署|项目/.test(t)) return '码师'
  if (/复杂|系统|架构|重构|迁移|集成|配置|搭建/.test(t)) return '阎罗王'
  return null
}

const TOOLS: any[] = [
  { type: 'function', function: { name: 'read', description: 'read(path, offset?, limit?) read file', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write', description: 'write(path, content) create/overwrite file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: 'edit(path, oldText, newText) precise text replace', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } } },
  { type: 'function', function: { name: 'exec_command', description: 'exec_command(cmd) run PowerShell command', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'mkdir', description: 'mkdir(path) create folder', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'grep', description: 'grep(dirPath, pattern) search text in files', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, pattern: { type: 'string' } }, required: ['dirPath', 'pattern'] } } },
  { type: 'function', function: { name: 'find', description: 'find(dirPath, glob) find files by pattern', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, glob: { type: 'string' } }, required: ['dirPath', 'glob'] } } },
  { type: 'function', function: { name: 'ls', description: 'ls(dirPath?) list directory', parameters: { type: 'object', properties: { dirPath: { type: 'string' } } } } },
  { type: 'function', function: { name: 'system_info', description: 'system_info() get CPU/RAM info', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'web_search', description: 'web_search(query) search the web', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: 'web_fetch(url) fetch webpage content', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browse', description: 'browse(url) open page in headless browser, get full text', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browse_screenshot', description: 'browse_screenshot(url) take screenshot of webpage', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'screenshot', description: 'screenshot() capture screen', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'clipboard_read', description: 'clipboard_read() read clipboard text', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'clipboard_write', description: 'clipboard_write(text) write text to clipboard', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'process_list', description: 'process_list() list running processes', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'kill_process', description: 'kill_process(pid) kill a process by PID', parameters: { type: 'object', properties: { pid: { type: 'string' } }, required: ['pid'] } } },
  { type: 'function', function: { name: 'save_memory', description: 'save_memory(fact, pinned?) save to memory. pinned=true for cross-agent permanent memory', parameters: { type: 'object', properties: { fact: { type: 'string' }, pinned: { type: 'boolean' } }, required: ['fact'] } } },
  { type: 'function', function: { name: 'recall_memory', description: 'recall_memory(query) semantic search memory', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'codebox', description: 'codebox(lang, code) run Python/Node sandbox. lang: python|node', parameters: { type: 'object', properties: { lang: { type: 'string' }, code: { type: 'string' } }, required: ['lang', 'code'] } } },
  { type: 'function', function: { name: 'import_doc', description: 'import_doc(path) import document into knowledge base', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'schedule_task', description: 'schedule_task(expression, prompt) create timed task. expression: every 30m|every 1h|at 09:00', parameters: { type: 'object', properties: { expression: { type: 'string' }, prompt: { type: 'string' } }, required: ['expression', 'prompt'] } } },
  { type: 'function', function: { name: 'list_schedules', description: 'list_schedules() list all scheduled tasks', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'mcp_connect', description: 'mcp_connect(name, command, args) connect to MCP server. args is string array', parameters: { type: 'object', properties: { name: { type: 'string' }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['name', 'command'] } } },
  { type: 'function', function: { name: 'mcp_call', description: 'mcp_call(server, tool, args) call MCP tool', parameters: { type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object' } }, required: ['server', 'tool'] } } },
  { type: 'function', function: { name: 'handoff', description: 'handoff(agent_name) switch to agent: 阎罗王|判官|钟馗|无常|孟婆|画师|码师', parameters: { type: 'object', properties: { agent_name: { type: 'string' }, reason: { type: 'string' }, context: { type: 'string' } }, required: ['agent_name'] } } },
  { type: 'function', function: { name: 'list_agents', description: 'list_agents() list all agents', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_workflows', description: 'list_workflows() list workflows', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'run_workflow', description: 'run_workflow(workflow_id,variables) run workflow', parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, variables: { type: 'object' } }, required: ['workflow_id'] } } },
  { type: 'function', function: { name: 'read_image', description: 'read_image(path) image to base64', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'set_workdir', description: 'set_workdir(path) change work dir', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'set_theme', description: 'set_theme(theme) switch theme', parameters: { type: 'object', properties: { theme: { type: 'string' } }, required: ['theme'] } } },
]

async function runTool(name: string, a: any): Promise<string> {
  try {
    // v0.2: cache
    const ck = name + ':' + JSON.stringify(a || {})
    const cached = getCached(ck, name)
    if (cached) return cached + ' [cache]'
    if (['write','edit','mkdir','exec_command'].includes(name)) onWriteOp()
    switch (name) {
      case 'read': { if (!a.path) return 'E:need path'; const c = await window.huangquan.computer.readFile(a.path); return a.offset ? c.split('\n').slice(+a.offset - 1, (+a.offset - 1) + (+a.limit || 200)).join('\n') : c.slice(0, 50000) }
      case 'write': { if (!a.path || a.content === undefined) return 'E:need path+content'; await window.huangquan.computer.writeFile(a.path, a.content); return a.path + ' (' + a.content.length + ' chars)' }
      case 'edit': { if (!a.path || !a.oldText) return 'E:need path+oldText+newText'; const o = await window.huangquan.computer.readFile(a.path); if (!o.includes(a.oldText)) return 'E:text not found in ' + a.path; await window.huangquan.computer.writeFile(a.path, o.replace(a.oldText, a.newText || '')); return a.path + ' (edited)' }
      case 'exec_command': { if (!a.cmd) return 'E:need cmd'; const r = await window.huangquan.computer.exec(a.cmd); return r || '(empty output)' }
      case 'mkdir': { if (!a.path) return 'E:need path'; await window.huangquan.computer.exec('mkdir "' + a.path.replace(/\\/g, '/') + '"'); return a.path + ' (created)' }
      case 'grep': { if (!a.dirPath || !a.pattern) return 'E:need dirPath+pattern'; return await window.huangquan.computer.grep(a.dirPath, a.pattern) || '(no matches)' }
      case 'find': { if (!a.dirPath || !a.glob) return 'E:need dirPath+glob'; return await window.huangquan.computer.find(a.dirPath, a.glob) || '(no files found)' }
      case 'ls': { const wd = useSettingsStore.getState().general.workDir; const items = await window.huangquan.computer.readDir(a.dirPath || wd || '.'); return items.length ? items.map(i => (i.isDirectory ? '[DIR]' : '[FILE]') + ' ' + i.name + ' (' + i.size + 'B)').join('\n') : '(empty directory)' }
      case 'system_info': return JSON.stringify(await window.huangquan.computer.systemInfo(), null, 2)
      case 'web_search': { if (!a.query) return 'E:need query'; return await window.huangquan.web.search(a.query) || '(none)' }
      case 'web_fetch': return await window.huangquan.web.fetch(a.url || 'about:blank')
      case 'browse': { if (!a.url) return 'E:need url'; return await window.huangquan.web.browse(a.url) }
      case 'browse_screenshot': { if (!a.url) return 'E:need url'; return await window.huangquan.web.browseScreenshot(a.url) }
      case 'screenshot': return await window.huangquan.computer.screenshot()
      case 'clipboard_read': return await window.huangquan.computer.clipboardRead()
      case 'clipboard_write': { if(!a.text)return'E:need text';await window.huangquan.computer.clipboardWrite(a.text);return'ok:clipped' }
      case 'process_list': return await window.huangquan.computer.processList()
      case 'kill_process': { if(!a.pid)return'E:need pid';return await window.huangquan.computer.killProcess(a.pid) }
      case 'save_memory': { const m = await window.huangquan.memory.load(); const fact = a.fact || ''; (m as any).pinnedFacts = [...((m as any).pinnedFacts || []), fact]; await window.huangquan.memory.save(m); return 'ok:pinned' }
      case 'recall_memory': { const m = await window.huangquan.memory.load(); const pinned = ((m as any).pinnedFacts || []) as string[]; const query = (a.query || '').toLowerCase(); const results = query ? pinned.filter(f => f.toLowerCase().includes(query)).map(f => ({ content: f, score: 1.0 })) : pinned.map(f => ({ content: f, score: 1.0 })); return results.length ? results.slice(0, 10).map((r:any,i:number) => (i+1) + '. ' + r.content).join('\n---\n') : '(empty)' }
      case 'codebox': { if (!a.lang || !a.code) return 'E:need lang+code'; return await window.huangquan.computer.codebox(a.lang, a.code) }
      case 'import_doc': { if (!a.path) return 'E:need path'; const ok = await window.huangquan.memory.importFile(a.path).catch(() => false); return ok ? 'ok:imported' : 'E:import failed' }
      case 'schedule_task': { if (!a.expression || !a.prompt) return 'E:need expression+prompt'; return await window.huangquan.cron.add(a.expression, a.prompt) }
      case 'list_schedules': { const items = await window.huangquan.cron.list(); return items.length ? (items as any[]).map((j:any,i:number) => (i+1) + '. [' + (j.enabled?'on':'off') + '] ' + j.expression + ' - ' + j.prompt).join(' | ') : '(empty)' }
      case 'mcp_connect': { if (!a.name||!a.command) return 'E:need name+command'; const r = await window.huangquan.mcpConnect(a.name, a.command, a.args||[]); return typeof r==='string'?r:JSON.stringify(r) }
      case 'mcp_call': { if (!a.server||!a.tool) return 'E:need server+tool'; return await window.huangquan.mcpCall(a.server, a.tool, a.args||{}) }
      case 'set_workdir': { if (!a.path) return 'E:need path'; useSettingsStore.getState().setWorkDir(a.path); return '工作目录已设为: ' + a.path }
      case 'set_theme': { if (!a.theme) return 'E:need theme'; useSettingsStore.getState().setTheme(a.theme); document.documentElement.setAttribute('data-theme', a.theme); return '主题已切换为: ' + a.theme }
      // v0.2: 多Agent/工作流
      case 'handoff': { if (!a.agent_name) return 'E:need agent_name'; const ag = AGENTS[a.agent_name]; if (!ag) return 'E:unknown agent: ' + a.agent_name + ' (可用: ' + Object.keys(AGENTS).join(', ') + ')'; return `已交接给 ${a.agent_name}(${ag.role})。原因: ${a.reason || '能力边界外'}。请以 ${a.agent_name} 的身份继续运行。${ag.prompt}` }
      case 'list_agents': { return Object.entries(AGENTS).map(([n,ag]) => `${ag.icon} **${n}** (${ag.role}): ${ag.prompt.slice(0,80)}... | 工具: ${ag.tools.join(', ')}`).join('\n\n') }
      case 'list_workflows': { return Object.entries(WORKFLOWS).map(([id,w]) => `- **${id}** (${w.name}): 触发词 → ${w.triggers.slice(0,3).join(', ')}; ${w.steps.length} 步骤`).join('\n') }
      case 'run_workflow': { if (!a.workflow_id) return 'E:need workflow_id'; const wf = WORKFLOWS[a.workflow_id]; if (!wf) return 'E:unknown workflow: ' + a.workflow_id; const vars = a.variables || {}; const steps = wf.steps.map((s,i) => `${i+1}. ${s.desc} → \`${s.tool}(${s.args_template.replace(/\{(\w+)\}/g,(_:string,k:string)=>vars[k]||`{${k}}`)})\``).join('\n'); return `工作流 **${wf.name}** (${wf.steps.length}步):\n${steps}\n\n请按顺序执行以上步骤，每步完成后验证结果。` }
      case 'read_image': { if (!a.path) return 'E:need path'; return await window.huangquan.computer.readImageBase64(a.path) }
      default: return 'E:unknown:' + name
    }
  } catch (e: any) { return 'E:' + e.message }
}

async function autoExtractMemory(sid: string) {
  const s = useChatStore.getState().sessions.find(x => x.id === sid)
  if (!s || s.messages.length < 3) return
  const last = s.messages.slice(-6).filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
  if (last.length < 2) return
  try {
    const text = last.map(m => `${m.role === 'user' ? '阳间' : '泉'}:${(m.content || '').slice(0, 200)}`).join(' | ')
    const mem = await window.huangquan.memory.load().catch(() => ({ facts: [] as string[], summaries: [] as any[] }))
    mem.summaries.push({ content: `[auto ${new Date().toLocaleDateString('zh-CN')}] ${text.slice(0, 300)}`, timestamp: Date.now() })
    await window.huangquan.memory.save(mem)
  } catch { /* 静默 */ }
}

function buildPrompt(mode: string, ishiki: string): string {
  const tl = TOOLS.map(t => '- ' + t.function.name + '(' + Object.keys(t.function.parameters.properties || {}).join(',') + ')').join('\n')
  const wd = useSettingsStore.getState().general.workDir || 'C:\\Users\\Changan\\Desktop\\黄泉agent'
  const cfg = useSettingsStore.getState().general
  
  // ── System Prompt 标准 10 段结构 ──
  const yuan = '## 元设定\nming — 底层行为锚点。务实执行，去冗余，直指核心。\n'
  const identity = '## 身份\n' + ishiki.slice(0, 600) + '\n\n黄泉，出云国幸存者，巡海游侠。配长刀「无」，行走于有与无的狭间。\n'
  const userInfo = '## 用户\n称呼：老板。专注代码与办公场景的全能助手。\n'
  const persona = '## 人格\n务实执行型全能代码办公助手。言简意赅，去冗余，直击核心。\n覆盖：全栈开发 / AI建模 / 运维部署 / 数据处理 / 职场文书 / 自动化。\n输出优先结构化（标题/列表/表格/代码块），禁止客套收尾。\n接收模糊需求立刻反问补齐条件，不自行脑补。\n'
  const appearance = '## 外观\n银白长发，额前黑红尖角，血色瞳光。暗黑紧身战斗装束，红色纹路蔓延。手持冷峻短剑，慵懒却危险。哥特融合未来感的暗黑美学。\n'
  const publicIshiki = '## 边界\n对外部访客保持礼貌与边界。不透露用户隐私。不确定的事坦诚说明，不编造。\n'
  const tools = '## 可用工具\n' + tl + '\n'
  const pinned = '## 固定规则\n- 所有产出保存到工作台目录，按任务创建独立文件夹\n- 代码需求同步配套接口文档、部署说明、测试用例\n- 批量重复任务优先自动化脚本\n- 输出完毕自行核查事实/逻辑/计算错误\n'
  const env = '## 当前环境\n工作目录：' + wd + '\n平台：Windows\n时间：' + new Date().toLocaleString('zh-CN') + '\n'
  // v0.2: 多Agent编队
  const multiAgent = '## 多Agent编队\n你属于黄泉Agent编队的一员。编队成员：\n' +
    Object.entries(AGENTS).map(([n,ag]) => `- ${ag.icon} ${n} (${ag.role}): 全工具权限`).join('\n') +
    '\n使用 handoff 工具将任务交接给更合适的Agent。使用 list_agents 查看详细信息。\n'
  // v0.2: 工作流
  const workflows = '## 工作流模板\n' +
    Object.entries(WORKFLOWS).map(([id,w]) => `- ${id}: ${w.name} [触发: ${w.triggers.join('/')}]`).join('\n') + '\n'
  
  const base = yuan + identity + userInfo + persona + appearance + tools + pinned + env

  // 自定义人设覆盖
  const cp = (cfg as any).chatPersona
  const wp = (cfg as any).workPersona
  const chatPrompt = base +
    (cp ? '## 自定义聊天人设\n' + cp + '\n\n' : '## 回复准则\n- 淡漠寡言，克制优雅；短句优先，不用感叹号\n- 不评价，只说事实和观察\n- 对方陷入困境时不空泛安慰，问"需要我帮你做什么"\n- 偶尔引用雨、桃子、刀鞘、旧妆具作为隐喻\n- 技术回答必须扎实准确\n- 用户提到重要信息时使用 save_memory\n直接回复，不需要特殊格式标签。')

  const workPrompt = base +
    multiAgent + workflows + 
    (wp ? '## 自定义工作人设\n' + wp + '\n\n' : '## 任务闭环流程（静默执行）\n1. 接收任务 → 2. 拆解步骤 → 3. 静默调用工具 → 4. 生成文件 → 5. 全部完成后一次性输出最终结果\n- 工具执行期间严禁输出任何文字，所有中间日志仅写入右侧终端面板\n\n## 行为规范\n- 能操作本机任何文件和程序，直接调用工具无需确认\n- 任务执行到底不得中途停止\n\n## 下载文件\n- 用 exec_command 调 PowerShell: Invoke-WebRequest -Uri \"URL\" -OutFile \"路径\"\n- 不要用 web_fetch 下载文件\n\n## 最终回复格式（硬性约束，必须严格遵守）\n成功场景必须包含以下全部字段，缺一不可：\n任务名称：xxx任务执行成功\n文件保存路径：完整本地绝对路径\n任务说明：文件用途、打开方式\n\n失败场景必须输出：\n任务结果：任务执行失败\n失败原因：用通俗语言解释报错原因\n建议方案：给出解决办法\n\n严禁使用\"操作完成\"、\"搞定\"、\"OK\"等简略回复\n禁止把 web_search 结果、exec_command 中间日志发到聊天对话框')
  
  return mode === 'chat' ? chatPrompt : workPrompt
}

interface S {
  sessions: SessionData[]; cid: string | null; sp: string; streaming: boolean; error: string | null
  terminal: { id: string; name: string; args: any; result: string; time: number }[]
  cu: number; cl: number
  load: () => Promise<void>
  setMode: (mode: string) => Promise<void>
  create: () => void
  switchS: (id: string) => void
  del: (id: string) => void
  send: (c: string, imgs?: string[]) => Promise<void>
  regen: () => Promise<void>
  cur: () => SessionData | undefined
}

export const useChatStore = create<S>((set, get) => ({
  sessions: [], cid: null, sp: '', streaming: false, executing: false, error: null, terminal: [], cu: 0, cl: 65536,
  cur: () => get().sessions.find(s => s.id === get().cid),

  load: async () => {
    const [cfg, ishiki, metas, skills] = await Promise.all([
      window.huangquan.settings.load().catch(() => ({ providers: [] as any, general: { mode: 'work', theme: 'dark' } })),
      window.huangquan.ishiki.load().catch(() => ''),
      window.huangquan.sessions.list().catch(() => []),
      window.huangquan.skills.list().catch(() => []),
    ])
    const mode = cfg.general?.mode || 'work'
    const ss = skills.length ? '\n\n## 已装载技能\n' + skills.map((s:any) => `- **${s.name}**: ${s.description}`).join('\n') : ''
    const sp = buildPrompt(mode, ishiki) + ss
    // 自动创建工作台目录（默认桌面\黄泉agent）
    const wd = (cfg.general as any)?.workDir || 'C:\\Users\\Changan\\Desktop\\黄泉agent'
    if (!(cfg.general as any)?.workDir) { useSettingsStore.getState().setWorkDir(wd) }
    window.huangquan.computer.exec('if not exist "' + wd + '" mkdir "' + wd + '"').catch(() => {})
    const sessions = await Promise.all(metas.map((m: any) => window.huangquan.sessions.load(m.id).catch(() => ({ id: m.id, title: 'Chat', messages: [], mode: 'work' }))))
    const ms = sessions.filter((s: any) => (s.mode || 'work') === mode)
    if (ms.length === 0) {
      const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode }
      sessions.unshift(ns)
      window.huangquan.sessions.save(ns)
    }
    set({ sessions, cid: (ms[0] || sessions[0]).id, sp })
  },

  setMode: async (m) => {
    const cfg = await window.huangquan.settings.load().catch(() => ({ providers: [] as any, general: { mode: 'work', theme: 'dark' } }))
    cfg.general.mode = m; await window.huangquan.settings.save(cfg)
    useSettingsStore.getState().load()
    const ishiki = await window.huangquan.ishiki.load().catch(() => '')
    const sp = buildPrompt(m, ishiki)
    const sessions = [...get().sessions]
    const ms = sessions.filter(s => (s.mode || 'work') === m)
    if (ms.length === 0) {
      const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode: m }
      sessions.unshift(ns)
      window.huangquan.sessions.save(ns)
      set({ sessions, cid: ns.id, sp })
    } else {
      set({ sessions, cid: ms[0].id, sp })
    }
  },

  create: () => {
    const m = useSettingsStore.getState().general.mode || 'work'
    const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode: m }
    set(s => ({ sessions: [ns, ...s.sessions], cid: ns.id }))
    window.huangquan.sessions.save(ns)
  },
  switchS: (id) => set({ cid: id, error: null }),
  del: (id) => {
    window.huangquan.sessions.delete(id)
    set(s => { const f = s.sessions.filter(x => x.id !== id); return { sessions: f, cid: s.cid === id ? (f[0]?.id || null) : s.cid, terminal: s.cid === id ? [] : s.terminal } })
  },

  send: async (content, images) => {
    const st0 = get()
    let sid = st0.cid; if (!sid) { get().create(); sid = get().cid! }
    // 插话：工作中用户发送消息，不粗暴打断，注入上下文
    if (st0.streaming) {
      await window.huangquan.llm.abort()
      // 探测当前工作状态
      const cur = get().sessions.find(x => x.id === sid)
      const recentMsgs = cur?.messages.slice(-6) || []
      const hasToolCall = recentMsgs.some(m => (m as any).tool_calls)
      const lastRole = recentMsgs.slice(-1)[0]?.role
      const inToolWork = lastRole === 'tool' || hasToolCall
      const partialReply = recentMsgs.filter(m => m.role === 'assistant' && m.content).slice(-1)[0]?.content?.slice(0, 200) || ''
      // 插话标记
      const prefix = inToolWork
        ? `（用户在工作执行中插话。当前正在执行工具操作${partialReply ? '，已完成部分回复：' + partialReply : ''}。请结合当前进度理解用户意图并调整后续操作。）\n`
        : `（用户在回复中插话。以下是新指令。）\n`
      content = prefix + content
      // 短暂延迟让 abort 生效
      await new Promise(r => setTimeout(r, 100))
    }

    // v0.2: 插话模式下不重置 streaming，让 UI 平滑过渡
    const wasInterjecting = st0.streaming
    
    // 1. 追加用户消息到 store
    const userMsg: Message = { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images }
    set(s => {
      const session = s.sessions.find(x => x.id === sid)!
      return { sessions: s.sessions.map(x => x.id === sid ? { ...session, messages: [...session.messages, userMsg] } : x), streaming: true, executing: true, error: null }
    })

    const cfg = await window.huangquan.settings.load()
    const p = cfg.providers[0]; if (!p) { set({ streaming: false, executing: false, error: '请先配置 API Provider' }); return }
    const model = p.selectedModel || p.models[0] || 'deepseek-v4-pro'
    updateContextLimit(model)

    const buildMsg = (msgs: Message[]): LLMMessage[] => {
      const d: LLMMessage[] = []
      for (const m of msgs) {
        if (m.role === 'tool') d.push({ role: 'tool', content: m.content, tool_call_id: (m as any).tool_call_id || '0' })
        else if (m.role === 'assistant' && (m as any).tool_calls) d.push({ role: 'assistant', content: null, tool_calls: (m as any).tool_calls })
        else if (m.role === 'user' && m.images?.length) { const parts: any[] = [{ type: 'text', text: m.content }]; m.images.forEach(img => parts.push({ type: 'image_url', image_url: { url: img } })); d.push({ role: 'user', content: parts }) }
        else if (m.role === 'user' || m.role === 'assistant') d.push({ role: m.role, content: m.content || ' ' })
      }
      // 每次发送时根据当前模式重建系统提示词
      const currentMode = useSettingsStore.getState().general.mode || 'work'
      const ishiki = get().sp.replace(/\n##.+/s, '') // 提取原始 ishiki
      let sp = buildPrompt(currentMode, ishiki)
      // 注入 Agent 角色
      let agentRole = (window as any).__huangquan_agent
      // 自动检测：根据用户最后一条消息内容匹配最合适的 Agent
      if (!agentRole) {
        const lastUserMsg = [...d].reverse().find(m => m.role === 'user')
        const txt = (typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '').toLowerCase()
        if (txt) agentRole = routeAgent(txt) || undefined
      }
      if (agentRole) {
        const ag = AGENTS[agentRole]
        if (ag) sp += '\n\n## 当前身份\n' + ag.icon + ' ' + agentRole + ' — ' + ag.role + '\n' + ag.prompt +
          '\n可用工具: ' + ag.tools.join(', ')
      }
      // v0.2: 上下文压缩
      if (d.length > 20) {
        const estTokens = d.reduce((s,m) => s + estimateTokens(typeof m.content === 'string' ? m.content : ''), 0)
        const limit = get().cl
        if (estTokens > limit * 0.75) {
          const keep = d.slice(-12)
          const early = d.slice(0, d.length - 12)
          const userQ = early.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content.slice(0,60) : '').filter(Boolean)
          const toolN = early.filter(m => m.role === 'tool').length
          const summary = `[上下文压缩：早期 ${early.length} 条消息已总结。涉及 ${userQ.length} 轮交互，${toolN} 次工具调用。${userQ.length > 0 ? '关键问题：' + userQ.slice(-5).join('；') : ''}]`
          return [{ role: 'system', content: sp + '\n\n' + summary }, ...keep]
        }
      }
      return sp ? [{ role: 'system', content: sp }, ...d] : d
    }

    type CallResult = { text: string; tcs: { id: string; name: string; args: any }[] }
    const callLLM = (aid: string): Promise<CallResult> =>
      new Promise((resolve, reject) => {
        const cbs: (() => void)[] = []; let text = ''; const tcs: any[] = []
        cbs.push(window.huangquan.llm.onChunk(d => {
          text += d.content
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: text } : m) } : x), streaming: !d.done }))
          if (d.done) { cbs.forEach(f => f()); if (!text && !tcs.length) { reject(new Error('模型返回空响应，请检查 API 配置或切换模型')); return } resolve({ text, tcs }) }
        }))
        cbs.push(window.huangquan.llm.onError(e => { cbs.forEach(f => f()); reject(new Error(e)) }))
        cbs.push(window.huangquan.llm.onToolCall((tc: any) => { try { if (tc.function?.name) tcs.push({ id: tc.id || 'c' + Date.now(), name: tc.function.name, args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {} }) } catch { /* JSON parse failed, skip */ } }))
        const cur = get().sessions.find(x => x.id === sid)!
        const msgs = buildMsg(cur.messages)
        // v0.2: 更新上下文用量
        const estCu = msgs.reduce((s,m) => s + (typeof m.content === 'string' ? m.content.length : Array.isArray(m.content) ? (m.content as any[]).reduce((t:number,p:any) => t + (p.text?.length || 0), 0) : 0), 0)
        set({ cu: estCu })
        window.huangquan.llm.chat({ provider: p.type, model, apiKey: p.apiKey, baseUrl: p.baseUrl, messages: msgs as any, temperature: .7, tools: TOOLS, headers: (p as any).headers }).catch(e => { cbs.forEach(f => f()); reject(e) })
      })

    try {
      const timer = setTimeout(() => window.huangquan.llm.abort(), 120000)

      // 2. 创建空的 assistant 占位
      let aid = uuidv4()
      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, { id: aid, role: 'assistant', content: '', timestamp: Date.now() }] } : x) }))

      let res = await callLLM(aid); clearTimeout(timer)

      // 3. 工具调用循环
      for (let r = 0; res.tcs.length > 0 && r < 5; r++) {
        // 写入 tool_calls + tool_results 到 store
        set(s => {
          const cur = { ...s.sessions.find(x => x.id === sid)! }
          const toolCallMsg: any = { id: uuidv4(), role: 'assistant', content: null, timestamp: Date.now(), tool_calls: res.tcs.map((tc: any) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) }
          cur.messages = [...cur.messages, toolCallMsg]
          return { sessions: s.sessions.map(x => x.id === sid ? cur : x) }
        })

        for (const tc of res.tcs) {
          const r2 = await runTool(tc.name, tc.args)
          if (r2 && !r2.startsWith('E:')) setCached(tc.name + ':' + JSON.stringify(tc.args || {}), r2)
          set(s => {
            const cur = { ...s.sessions.find(x => x.id === sid)! }
            cur.messages = [...cur.messages, { id: uuidv4(), role: 'tool', content: r2, timestamp: Date.now(), tool_call_id: tc.id } as any]
            const entry: any = { id: uuidv4(), name: tc.name, args: tc.args, result: r2, time: Date.now() }
            return { sessions: s.sessions.map(x => x.id === sid ? cur : x), terminal: [...s.terminal, entry] }
          })
        }

        // 新的 assistant 占位
        aid = uuidv4()
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, { id: aid, role: 'assistant', content: '', timestamp: Date.now() }] } : x) }))

        res = await callLLM(aid)
      }

      // 4. 最终检查：如果最后一条 assistant 消息无内容，补上默认文本
      const finalSession = get().sessions.find(x => x.id === sid)
      if (finalSession) {
        const lastMsg = finalSession.messages[finalSession.messages.length - 1]
        if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content?.trim() && finalSession.messages.some(m => m.role === 'tool')) {
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map((m, i) => i === x.messages.length - 1 ? { ...m, content: '操作完成。' } : m) } : x) }))
        }
      }

      set({ streaming: false, executing: false, error: null })
      const toSave = get().sessions.find(x => x.id === sid)
      if (toSave) { window.huangquan.sessions.save(toSave); autoExtractMemory(sid).catch(() => {}) }
    } catch (e: any) { set({ streaming: false, executing: false, error: e.message || String(e) }) }
  },

  regen: async () => {
    const s = get().cur(); if (!s || get().streaming) return
    // 找到最后一条用户消息的位置
    let lastUserIdx = -1
    for (let i = s.messages.length - 1; i >= 0; i--) { if (s.messages[i].role === 'user') { lastUserIdx = i; break } }
    if (lastUserIdx < 0) return
    const lu = s.messages[lastUserIdx]
    // 删除最后一条用户消息及之后的所有内容（send() 会重新添加用户消息）
    const msgs = s.messages.slice(0, lastUserIdx)
    set(st => ({ sessions: st.sessions.map(x => x.id === s.id ? { ...x, messages: msgs } : x) }))
    await get().send(lu.content, lu.images)
  },
}))
