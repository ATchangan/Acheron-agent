// src/store/tools.ts — 工具 Schema 定义(纯数据)
// 从 chat.ts 拆分, 降低单文件复杂度
// v0.3.0 M1: TOOLS 类型化为 ToolSpec[](结构本身已符合, 仅补类型标注)
import type { ToolSpec } from '../types'
import { useAgents } from './agents'

// v0.3.2 T1: 角色工具白名单统一过滤(主请求与子任务共用同一函数源)
// 规则: 协作工具(handoff/dispatch/list_agents)始终保留; 插件工具(plugin_ 前缀)恒保留(用户显式安装授权);
//       其余仅注入该角色白名单内工具。filter 保序(TOOLS 原序 + PLUGIN_TOOLS 原序), 禁止 sort/Set 去重
export function filterToolsByAgent(tools: ToolSpec[], agentName: string): ToolSpec[] {
  const ag = useAgents()[agentName]
  if (!ag || ag.tools.includes('*')) return tools
  // 基础工具恒保留: 协作工具 + 跨会话回忆(session_search)
  const allowed = new Set([...ag.tools, 'handoff', 'dispatch', 'list_agents', 'session_search'])
  return tools.filter(t => allowed.has(t.function.name) || t.function.name.startsWith('plugin_'))
}

export const TOOLS: ToolSpec[] = [
  // v0.3.2 T2: 描述中文精简(删冗余英文长句/否定式重复; 参数名/类型/enum/required/安全限制全部保留)
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
  { type: 'function', function: { name: 'browse', description: 'browse(url) 无头浏览器打开网页并取全文', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browse_screenshot', description: 'browse_screenshot(url) 对网页截图', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'screenshot', description: 'screenshot() 截取屏幕', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'clipboard_read', description: 'clipboard_read() 读取剪贴板文本', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'clipboard_write', description: 'clipboard_write(text) 写入剪贴板', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'process_list', description: 'process_list() 列出运行中进程', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'kill_process', description: 'kill_process(pid) 按 PID 结束进程', parameters: { type: 'object', properties: { pid: { type: 'string' } }, required: ['pid'] } } },
  { type: 'function', function: { name: 'save_memory', description: 'save_memory(fact, pinned?) 保存记忆; pinned=true 置顶跨会话永久保留', parameters: { type: 'object', properties: { fact: { type: 'string' }, pinned: { type: 'boolean' } }, required: ['fact'] } } },
  { type: 'function', function: { name: 'recall_memory', description: 'recall_memory(query) 语义检索记忆', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  // 会话全文关键词搜索(跨会话回忆, 轻量版)
  { type: 'function', function: { name: 'session_search', description: 'session_search(query, limit?) 关键词搜索历史会话(跨会话回忆, 返回匹配消息摘要)', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'codebox', description: 'codebox(lang, code) 沙箱运行 Python/Node 代码(lang: python|node)', parameters: { type: 'object', properties: { lang: { type: 'string' }, code: { type: 'string' } }, required: ['lang', 'code'] } } },
  { type: 'function', function: { name: 'import_doc', description: 'import_doc(path) 导入文档到知识库', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'schedule_task', description: 'schedule_task(expression, prompt) 创建定时任务(如 every 30m|every 1h|at 09:00)', parameters: { type: 'object', properties: { expression: { type: 'string' }, prompt: { type: 'string' } }, required: ['expression', 'prompt'] } } },
  { type: 'function', function: { name: 'list_schedules', description: 'list_schedules() 列出全部定时任务', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'mcp_connect', description: 'mcp_connect(name, command, args) 连接 MCP 服务器(args 为字符串数组)', parameters: { type: 'object', properties: { name: { type: 'string' }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['name', 'command'] } } },
  { type: 'function', function: { name: 'mcp_call', description: 'mcp_call(server, tool, args) 调用 MCP 工具', parameters: { type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object' } }, required: ['server', 'tool'] } } },
  { type: 'function', function: { name: 'handoff', description: 'handoff(agent_name, reason) 将任务交接给另一角色并切换身份执行', parameters: { type: 'object', properties: { agent_name: { type: 'string', enum: ['姬子','三月七','银狼','艾丝妲','知更鸟','黑天鹅','螺丝咕姆'] }, reason: { type: 'string' }, context: { type: 'string' } }, required: ['agent_name'] } } },
  { type: 'function', function: { name: 'dispatch', description: 'dispatch(tasks) 并行分发子任务给多个角色独立执行并汇总; tasks=[{agent, task}]', parameters: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: { agent: { type: 'string' }, task: { type: 'string' } }, required: ['agent', 'task'] } }, reason: { type: 'string' } }, required: ['tasks'] } } },
  { type: 'function', function: { name: 'list_agents', description: 'list_agents() 列出全部角色', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_workflows', description: 'list_workflows() 列出工作流模板', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'run_workflow', description: 'run_workflow(workflow_id, variables?) 按模板运行工作流', parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, variables: { type: 'object' } }, required: ['workflow_id'] } } },
  { type: 'function', function: { name: 'read_image', description: 'read_image(path) 读取图片为 dataURL(脚本内部用; 用户提供图片路径时系统自动处理)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  // v0.3.0: 媒体自动生成 —— 对话中遇到生图/生视频需求自动调用(无需用户明确要求使用工具)
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

