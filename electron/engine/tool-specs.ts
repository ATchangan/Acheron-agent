// electron/engine/tool-specs.ts — 工具 schema 声明式集中定义(与执行器分离, 可单测)
import type { EngineToolSpec } from './types'
import { sanitizeMcpPart } from '../shared/mcp-utils'

export const TOOLS: EngineToolSpec[] = [
  { type: 'function', function: { name: 'read', description: 'read(path, offset?, limit?) 读取文件(UTF-8); 大文件用 offset/limit 分段续读', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'read_skill', description: 'read_skill(name, file?) 读取已装载技能的详细指令: file 默认 SKILL.md, 也可读技能内 scripts/ 或 references/ 下的文件(相对路径)', parameters: { type: 'object', properties: { name: { type: 'string' }, file: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'skill_manage', description: 'skill_manage(action, name, content?, oldText?, newText?) 管理技能: create 新建 / patch 局部修订(推荐, 只传变更文本省 token) / read 读取全文(带安全扫描) / list 列出全部技能。适合把成功经验沉淀为可复用技能', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'patch', 'read', 'list'] }, name: { type: 'string' }, content: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'update_plan', description: 'update_plan(steps, explanation?) 声明或更新任务执行计划: steps=[{label, status?, expected?, tool?, id?}], status 取值 pending/running/done/failed, tool 填将执行的工具名(如 read/write/apply_patch/exec_command/terminal_open); 复杂任务先用它列出完整步骤, 执行中持续更新状态并保持准确', parameters: { type: 'object', properties: { steps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, status: { type: 'string', enum: ['pending', 'running', 'done', 'failed'] }, expected: { type: 'string' }, tool: { type: 'string' } } } }, explanation: { type: 'string' } }, required: ['steps'] } } },
  { type: 'function', function: { name: 'write', description: 'write(path, content) 创建或覆盖写入文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: 'edit(path, oldText, newText) 精确文本替换(全文替换首个匹配)', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } } },
  { type: 'function', function: { name: 'apply_patch', description: 'apply_patch(path, hunks) 多 hunk 结构化编辑: hunks=[{oldText, newText}], 按顺序精确替换, 每个 oldText 必须唯一匹配(推荐带足够上下文); 一次调用可完成多处修改', parameters: { type: 'object', properties: { path: { type: 'string' }, hunks: { type: 'array', items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['oldText', 'newText'] } } }, required: ['path', 'hunks'] } } },
  { type: 'function', function: { name: 'exec_command', description: 'exec_command(cmd) 在 Windows 执行一次性命令(工作目录内)。请使用 PowerShell 语法；含中文路径/输出的命令会自动以 UTF-8 执行，纯 ASCII 简单命令走 cmd', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'git', description: 'git(action, args?) 在工作目录执行 Git 操作: action 取 status/diff/log/commit/stash/push/pull/checkout, args 为附加参数(如 commit 的 -am "msg")。改代码前先 status/diff, 改完用 diff 验证, 确认后 commit', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'diff', 'log', 'commit', 'stash', 'push', 'pull', 'checkout'] }, args: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'init_project_docs', description: 'init_project_docs() 扫描工作目录生成 AGENTS.md 项目指令草稿(项目概览/常用命令/目录结构/默认约定); 已存在时不覆盖。首次进入新项目且没有项目指令时使用', parameters: { type: 'object', properties: {}, required: [] } } },
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
  { type: 'function', function: { name: 'save_memory', description: 'save_memory(fact, pinned?, level?, agent?) 保存记忆到本地四层记忆库(原始记录→原子事实→场景→核心结论, 带溯源与去重); pinned=true 置顶永久保留, level: normal|important|pinned', parameters: { type: 'object', properties: { fact: { type: 'string' }, pinned: { type: 'boolean' }, level: { type: 'string', enum: ['normal', 'important', 'pinned'] }, agent: { type: 'string' } }, required: ['fact'] } } },
  { type: 'function', function: { name: 'recall_memory', description: 'recall_memory(query, scope?) 关键词+语义混合检索本地记忆(带核心结论/场景/原子事实分层与置信度); scope: global|private', parameters: { type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string', enum: ['global', 'private'] } }, required: ['query'] } } },
  { type: 'function', function: { name: 'session_search', description: 'session_search(query, limit?) 关键词搜索历史会话(跨会话回忆, 返回匹配消息摘要)', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'recall_events', description: 'recall_events(timeRange?) 查看近期操作时间线(情景记忆), timeRange: day|week|month(默认week)', parameters: { type: 'object', properties: { timeRange: { type: 'string', enum: ['day', 'week', 'month'] } } } } },
  { type: 'function', function: { name: 'recall_tool_output', description: 'recall_tool_output(id) 取回被存档的大工具结果(每次会话最多5次, 返回截断)', parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'codebox', description: 'codebox(lang, code) 沙箱运行 Python/Node 代码(lang: python|node)', parameters: { type: 'object', properties: { lang: { type: 'string' }, code: { type: 'string' } }, required: ['lang', 'code'] } } },
  { type: 'function', function: { name: 'desktop_screenshot', description: 'desktop_screenshot() 截取当前全屏画面并返回图片路径(配合 read_image 让视觉模型分析), 之后可用 desktop_click/type/key 操作任意应用', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'desktop_click', description: 'desktop_click(x, y, button?) 在屏幕坐标(x,y)点击(button=2 右键, 默认左键), 坐标来自屏幕截图视觉定位', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'number' } }, required: ['x', 'y'] } } },
  { type: 'function', function: { name: 'desktop_move', description: 'desktop_move(x, y) 把鼠标移动到屏幕坐标(x,y)', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } } },
  { type: 'function', function: { name: 'desktop_scroll', description: 'desktop_scroll(x, y, delta) 在屏幕坐标(x,y)滚动滚轮(delta 正=向上滚/负=向下, 约 120=一格)', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, delta: { type: 'number' } }, required: ['x', 'y', 'delta'] } } },
  { type: 'function', function: { name: 'desktop_type', description: 'desktop_type(text) 向当前聚焦窗口输入文本(自动粘贴, 支持中文/换行)', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'desktop_key', description: 'desktop_key(key) 发送按键组合(SendKeys 语法: ^c=Ctrl+C, %{F4}=Alt+F4, {ENTER}, {TAB}, {ESC})', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } },
  { type: 'function', function: { name: 'import_doc', description: 'import_doc(path) 导入文档到知识库', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'schedule_task', description: 'schedule_task(expression, prompt) 创建定时任务(如 every 30m|every 1h|at 09:00)', parameters: { type: 'object', properties: { expression: { type: 'string' }, prompt: { type: 'string' } }, required: ['expression', 'prompt'] } } },
  { type: 'function', function: { name: 'list_schedules', description: 'list_schedules() 列出全部定时任务', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'mcp_connect', description: 'mcp_connect(name, command, args) 连接 MCP 服务器(args 为字符串数组)', parameters: { type: 'object', properties: { name: { type: 'string' }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['name', 'command'] } } },
  { type: 'function', function: { name: 'mcp_call', description: 'mcp_call(server, tool, args) 调用 MCP 工具', parameters: { type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object' } }, required: ['server', 'tool'] } } },
  { type: 'function', function: { name: 'handoff', description: 'handoff(agent_name, reason, context) 将任务交接给另一角色并切换身份执行; context 必填: 任务背景/已完成/未决问题(禁止只传结论)', parameters: { type: 'object', properties: { agent_name: { type: 'string', enum: ['主控', '文档', '安全', '通知', '陪伴', '设计', '开发'] }, reason: { type: 'string' }, context: { type: 'string' } }, required: ['agent_name'] } } },
  { type: 'function', function: { name: 'dispatch', description: 'dispatch(tasks) 并行分发子任务给多个角色独立执行并汇总; tasks=[{agent, task}]', parameters: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: { agent: { type: 'string' }, task: { type: 'string' } }, required: ['agent', 'task'] } }, reason: { type: 'string' } }, required: ['tasks'] } } },
  { type: 'function', function: { name: 'list_agents', description: 'list_agents() 列出全部角色', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'clarify', description: 'clarify(question, choices?) 当用户意图不明确、缺少关键信息或需要在多个方案中选择时，暂停并向用户提出带选项的问题。返回用户选择的回答。choices 可提供 2-6 个选项（可选），multi_select=true 时用户可多选（返回 JSON 数组字符串）', parameters: { type: 'object', properties: { question: { type: 'string', description: '要问用户的问题（简洁明确）' }, choices: { type: 'array', items: { type: 'string' }, description: '可选的可选项列表，2-6 个' }, multi_select: { type: 'boolean', description: '是否允许用户多选' } }, required: ['question'] } } },
  { type: 'function', function: { name: 'list_workflows', description: 'list_workflows() 列出工作流模板', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'run_workflow', description: 'run_workflow(workflow_id, variables?) 按模板运行工作流', parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, variables: { type: 'object' } }, required: ['workflow_id'] } } },
  { type: 'function', function: { name: 'read_image', description: 'read_image(path) 读取图片为 dataURL(脚本内部用; 用户提供图片路径时系统自动处理)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'media_img', description: 'media_img(prompt, ratio?) 生成图片(用户需求涉及 画/生成/创作/制作 图片时自动调用)', parameters: { type: 'object', properties: { prompt: { type: 'string', description: '画面描述(尽量详细: 主体/风格/光线/构图)' }, ratio: { type: 'string', description: '可选: 1:1/16:9/9:16/4:3/3:4' } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'media_video', description: 'media_video(prompt, duration?) 生成视频(用户需求涉及 生成/制作 视频时自动调用)', parameters: { type: 'object', properties: { prompt: { type: 'string', description: '视频内容描述' }, duration: { type: 'number', description: '可选: 时长秒数(默认5)' } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'set_workdir', description: 'set_workdir(path) 切换工作目录(本次会话)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'set_theme', description: 'set_theme(theme) 切换主题', parameters: { type: 'object', properties: { theme: { type: 'string' } }, required: ['theme'] } } },
  { type: 'function', function: { name: 'set_ui_display', description: 'set_ui_display(patches) 按用户自然语言要求调节界面显示。patches 为 JSON 对象, 可选字段: hiddenNav(["agents","browser","files"] 的数组, chat/settings 不可隐藏); hideSessionSearch/hideSessionList/hidePlanCards/hideChatToolbar/hideAttachmentBar/hideModelPicker/hideThinkSelector/hideTokenUsage/hideTimestamps/hideToolCalls/hideTokenMeta/hideCopyButtons/hideRegenerate(布尔); statusLine(模板字符串, 插值 ${workDir}/${model}/${context}/${tokens}/${agents}, 传空串恢复默认); density("compact"|"comfortable"|"spacious"); customCss(字符串, 传空串清除)。未传字段保持不变, 只传要改的字段', parameters: { type: 'object', properties: { patches: { type: 'object', description: '要修改的界面字段(键值对)' } }, required: ['patches'] } } },
  { type: 'function', function: { name: 'get_ui_display', description: 'get_ui_display() 查看当前界面显示配置(用于向用户确认或回答当前显示状态)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_settings', description: 'get_settings(section?) 读取当前设置。section 取 general(默认)/providers/mediaProviders/all; 密钥与凭证已脱敏显示为 ***, 不进入上下文', parameters: { type: 'object', properties: { section: { type: 'string', enum: ['general', 'providers', 'mediaProviders', 'all'] } } } } },
  { type: 'function', function: { name: 'set_settings', description: 'set_settings(patch, section?) 按用户自然语言要求修改设置(立即生效并保存)。section 默认 general; patch 为对象, 支持: theme/mode/agentName/language/region/workDir/uiFontSize/codeFontSize/messageSpacing/chatMaxWidth/opacity/animation/showTimestamps/autoCopy/useTables/useLists/useEmoji/expressUncertainty/askWhenMissing/showConfidence/explainRefusal/neutralOnControversial/noClosingPhrase/briefClosing/customSystemPrompt/promptInjectPos/thinkLevel/thinkOverrides/sp/ishiki/mainModel/fastModel/longTextModel/codeModel/autoFastModel/autoMediaImg/autoMediaVideo/mediaImgProvider/mediaVideoProvider/mcpTimeout/mcpAutoConnectOnStart/mcpAutoReconnect/toolPerms/perf/customColors/customTheme/skinColors/skinSecondary/uiDisplay/notifyTaskDone/notifyError/keepUserGoals/keepPendingTasks/keepDecisions/keepRecentRaw/browserHomeUrl/compactStrategy/compactMsgCount/compactTokenLimit/compactStrength/taskArchive/ragChunkSize/ragThreshold。providers/mediaProviders 传数组[{id,...}] 只改非密钥字段。密钥/风险放行/命令黑名单等安全项拒绝经对话修改', parameters: { type: 'object', properties: { patch: { type: 'object', description: '要修改的字段(键值对)' }, section: { type: 'string', enum: ['general', 'providers', 'mediaProviders'] } }, required: ['patch'] } } },
  { type: 'function', function: { name: 'show_card', description: 'show_card(html, title?) 渲染交互卡片(SVG/图表/示意图)', parameters: { type: 'object', properties: { html: { type: 'string' }, title: { type: 'string' } }, required: ['html'] } } },
  { type: 'function', function: { name: 'bridge_notify', description: 'bridge_notify(title, body?) 发送桌面通知', parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'workflow', description: 'workflow(script) 执行 JS 工作流脚本(ctx.log/ctx.tools.run/ctx.done)', parameters: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } } },
  { type: 'function', function: { name: 'audit_log', description: 'audit_log(limit?) 查看最近操作审计记录(工具调用/文件变更/时间)', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'watch_file', description: 'watch_file(path) 监测文件变化(返回自上次检查以来的变更)', parameters: { type: 'object', properties: { path: { type: 'string' }, interval: { type: 'number', description: '轮询间隔 ms(默认5000)' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'save_goal', description: 'save_goal(goal, steps?) 持久化长期目标(重启后可恢复)', parameters: { type: 'object', properties: { goal: { type: 'string' }, steps: { type: 'string', description: '步骤描述的 JSON 数组' } }, required: ['goal'] } } },
  { type: 'function', function: { name: 'list_goals', description: 'list_goals() 查看全部持久化目标及进度', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'install_plugin', description: 'install_plugin(name, description, code, overwrite?, settings?) 给自己写插件并安装: 校验通过自动生成 manifest 并热加载, 无需重启, 下一轮即可按 plugin_<name>__<tool> 调用。code 为 CommonJS 源码, 协议 module.exports={tools:[{name,description,params:{参数:类型},run(args,ctx){return "结果"}}]}; run 内可用 ctx.tools.run("read"/"write"/"exec_command",args)、ctx.log(text) 与 ctx.settings(用户可配置项)。settings 可选数组 [{key,label,type:"string"|"number"|"boolean"|"select",default?,options?,hint?}], 会在插件页自动生成设置卡片。写插件前建议先 read_skill("plugin-authoring") 读完整规范', parameters: { type: 'object', properties: { name: { type: 'string', description: '插件目录名, 小写字母数字开头, 1-80 位 [a-z0-9_-]' }, description: { type: 'string', description: '插件一句话说明(≤500 字)' }, code: { type: 'string', description: 'index.js 完整源码' }, overwrite: { type: 'boolean', description: '已存在时是否覆盖更新(版本号自动 +1)' }, settings: { type: 'array', description: '插件设置 schema(可选)', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, type: { type: 'string', enum: ['string', 'number', 'boolean', 'select'] }, default: { type: ['string', 'number', 'boolean'] }, options: { type: 'array', items: { type: 'string' } }, hint: { type: 'string' } }, required: ['key', 'label'] } } }, required: ['name', 'description', 'code'] } } },
  { type: 'function', function: { name: 'list_plugins', description: 'list_plugins() 列出已安装插件、来源(自写/外部)与可用工具', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'read_plugin', description: 'read_plugin(name) 读取插件 manifest.json 与 index.js 源码(用于修订后再 install_plugin 覆盖)', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'remove_plugin', description: 'remove_plugin(name) 删除插件(需用户确认, 删除后立即失效)', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'reload_plugins', description: 'reload_plugins() 重新扫描插件目录并刷新工具列表(手动修改插件文件后调用)', parameters: { type: 'object', properties: {} } } },
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
        const name = 'mcp__' + sanitizeMcpPart(s.name) + '__' + sanitizeMcpPart(t.name)
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
        const name = 'mcp__' + sanitizeMcpPart(s.name) + '__' + sanitizeMcpPart(meta.name)
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
