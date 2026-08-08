// electron/engine/tool-specs.ts — 工具 schema 声明式集中定义(与执行器分离, 可单测)
import type { EngineToolSpec } from './types'

export const TOOLS: EngineToolSpec[] = [
  { type: 'function', function: { name: 'read', description: 'read(path, offset?, limit?) 读取文件(UTF-8); 大文件用 offset/limit 分段续读', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'read_skill', description: 'read_skill(name, file?) 读取已装载技能的详细指令: file 默认 SKILL.md, 也可读技能内 scripts/ 或 references/ 下的文件(相对路径)', parameters: { type: 'object', properties: { name: { type: 'string' }, file: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'update_plan', description: 'update_plan(steps, explanation?) 声明或更新任务执行计划: steps=[{label, status?, expected?, tool?, id?}], status 取值 pending/running/done/failed, tool 填将执行的工具名(如 read/write/apply_patch/exec_command/terminal_open); 复杂任务先用它列出完整步骤, 执行中持续更新状态并保持准确', parameters: { type: 'object', properties: { steps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, status: { type: 'string', enum: ['pending', 'running', 'done', 'failed'] }, expected: { type: 'string' }, tool: { type: 'string' } } } }, explanation: { type: 'string' } }, required: ['steps'] } } },
  { type: 'function', function: { name: 'write', description: 'write(path, content) 创建或覆盖写入文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: 'edit(path, oldText, newText) 精确文本替换(全文替换首个匹配)', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } } },
  { type: 'function', function: { name: 'apply_patch', description: 'apply_patch(path, hunks) 多 hunk 结构化编辑: hunks=[{oldText, newText}], 按顺序精确替换, 每个 oldText 必须唯一匹配(推荐带足够上下文); 一次调用可完成多处修改', parameters: { type: 'object', properties: { path: { type: 'string' }, hunks: { type: 'array', items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['oldText', 'newText'] } } }, required: ['path', 'hunks'] } } },
  { type: 'function', function: { name: 'exec_command', description: 'exec_command(cmd) 执行 PowerShell 命令(工作目录内)', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'terminal_open', description: 'terminal_open(id, shell?, cwd?) 打开长驻交互终端会话(id 自定义如 term1; shell: powershell/cmd/node/python), 保持工作目录与状态, 之后用 terminal_run 输入命令', parameters: { type: 'object', properties: { id: { type: 'string' }, shell: { type: 'string', enum: ['powershell', 'cmd', 'node', 'python'] }, cwd: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'terminal_run', description: 'terminal_run(id, input, wait_ms?) 向终端会话输入命令/表达式并等待输出(默认等 1500ms, 最长 15000ms); 适合 REPL、git、npm 等需要保持状态的交互命令。输入请使用 ASCII 命令；含中文路径/文本的命令请改用 exec_command', parameters: { type: 'object', properties: { id: { type: 'string' }, input: { type: 'string' }, wait_ms: { type: 'number' } }, required: ['id', 'input'] } } },
  { type: 'function', function: { name: 'terminal_close', description: 'terminal_close(id) 关闭终端会话', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
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

// ─── MCP schema 自动注入(主进程侧直读, 15s 缓存) ───
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
