// electron/engine/context.ts — 独立内核上下文构建(从渲染层 context.ts/context-utils.ts/router.ts 移植)

import { slimToolResult, slimToolCallArgs, buildTaskArchives, calibrateTokens, getCalibrationScale, isVisionModel, estimateTokens, outputLimit, getModelContextLimit } from '../shared/context-utils'
import type { TaskArchive } from '../shared/context-utils'
export { slimToolResult, slimToolCallArgs, buildTaskArchives, calibrateTokens, getCalibrationScale, isVisionModel, estimateTokens, outputLimit, getModelContextLimit }
export type { TaskArchive }
import { routeAgentCore } from '../shared/route'
import { filterToolsCore } from '../shared/tool-filter'
import type { EngineMessage, EngineSettings, EngineToolSpec } from './types'
import type { AgentDef } from './agents'
import { MAX_HISTORY_MSGS, WORKFLOWS } from './constants'
import { v4 as uuidv4 } from 'uuid'

// token 估算 / 输出上限 / 上下文窗口已抽至 shared/context-utils（B6-2）

// ─── 纯函数: 工具结果瘦身 / 参数截断 / 轮次折叠 / 跨任务归档 ───

// 意图路由纯函数已抽至 shared/route（B6-2），此处仅保留类型化包装
export function routeAgent(userMessage: string, g: EngineSettings): string | null {
  return routeAgentCore(userMessage, g.disabledAgents || [], g.collabMode || '自动')
}

// ─── system prompt 构建(与渲染层 buildPrompt 同构) ───
export function buildPrompt(mode: string, ishiki: string, g: EngineSettings, agents: Record<string, AgentDef>, wd: string, skills?: { name: string; description: string }[], planStage = false): string {
  const yuan = '## 元设定\nming — 底层行为锚点。务实执行，去冗余，直指核心。\n'
  const identity = '## 身份\n' + (ishiki || '').slice(0, 600) + '\n\n助手，本地优先的桌面 AI 助手，可读写文件、执行命令、搜索网络并调度多角色编队。\n'
  const userInfo = '## 用户\n称呼：' + (g.userAlias || '老板') + '。关注代码与办公自动化场景。\n'
  const defaultChatPersona = '轻松自然的聊天伙伴。语气温和自然，像朋友一样交流，适当回应情绪，言简意赅；不堆砌术语，不主动调用工具，除非用户明确要求。'
  const defaultWorkPersona = '务实执行型工作模式。言简意赅，去冗余，直击核心。\n覆盖：全栈开发 / 机器学习建模 / 运维部署 / 数据处理 / 职场文书 / 自动化。\n输出优先结构化（标题/列表/表格/代码块），禁止客套收尾。\n接收模糊需求立刻反问补齐条件，不自行脑补。'
  const chatP = String(g.chatPersona || '').trim()
  const workP = String(g.workPersona || '').trim()
  const persona = '## 人格\n' + (mode === 'chat' ? (chatP || defaultChatPersona) : (workP || defaultWorkPersona)) + '\n'
  const appearance = '## 外观\n银白长发，额前黑红尖角，血色瞳光。暗黑紧身战斗装束，红色纹路蔓延。手持冷峻短剑，慵懒却危险。哥特融合未来感的暗黑美学。\n'
  const tools = '## 可用工具\n你拥有工具调用能力(read/write/exec_command/grep/find/ls/web_read 等),需要时自动调用,无需请示。\n'
  const thinkLevel = String(g.thinkLevel || 'medium')
  const thinkReq: Record<string, string> = {
    off: '## 思考要求\n直接作答,不展示推理过程,保持简洁。\n',
    quick: '## 思考要求\n快速作答,推理从简,只给结论与关键依据。\n',
    medium: '',
    deep: '## 思考要求\n复杂问题请分步推理:先拆解问题,逐步推导,输出前自查逻辑与计算错误。\n',
    extreme: '## 思考要求\n完整推演:拆解目标、列出假设、多方案对比、逐项验证边界条件,输出结构化论证,禁止跳步。\n',
    ultra: '## 思考要求\n穷尽式推演:定义问题、枚举约束、多方案全对比、验证所有边界与反例、给出最坏情况分析,输出完整论证链;回答尽量详尽。\n',
  }
  const think = thinkReq[thinkLevel] || ''
  const pinned = '## 固定规则\n- 所有产出保存到工作台目录，按任务创建独立文件夹\n- 代码需求同步配套接口文档、部署说明、测试用例\n- 批量重复任务优先自动化脚本\n- 输出完毕自行核查事实/逻辑/计算错误\n'
    + '- 身份一致性: 任务身份(交接/分发后) > 人格 > 本体设定; 同一回复只用一种语气与格式风格, 禁止两种语气并存\n'
    + '- 工具必要性: 能直接回答就不调工具; 每次调用前确认它服务于当前目标, 不为展示而调用\n'
  const env = '## 当前环境\n工作目录：' + wd + '\n平台：Windows\n'
  const multiAgent = '## 多角色编队\n你属于助手编队的一员。编队成员：\n' +
    Object.entries(agents).map(([n, ag]) => `- ${ag.icon} ${n} (${ag.role}): ${ag.tools.includes('*') ? '全工具权限' : '专业领域(' + (ag.capabilities || []).join('/') + ')'}`).join('\n') +
    '\n使用 handoff 工具交接给更合适的角色（必须带 context 字段：任务背景/已完成/未决问题，禁止只传结论）；复杂任务（预计 3 步以上或跨领域）必须用 dispatch 拆成子任务并行执行，禁止串行单干；使用 list_agents 查看编队信息。\n'
  const base = yuan + identity + userInfo + persona + appearance + tools + think + pinned + env
  const agentName = g.agentName || '助手'
  const toneStyle = g.toneStyle || '实用直接'
  const verbosity = g.verbosity ?? 2
  const toneMap: Record<string, string> = { '专业正式': '严谨规范，使用专业术语，避免口语化', '实用直接': '言简意赅，去冗余，直击核心', '轻松友好': '亲切自然，可适当使用表情和口语', '极简克制': '最简洁表达，一句说清，不扩展' }
  const verbMap = ['尽量精简，只给结论，不解释过程', '简洁优先，必要时补充关键细节', '平衡，该详则详该简则简', '详尽回答，包含背景和示例', '非常详细，包含分步教程和完整代码']
  const chatPrompt = base +
    (chatP ? '## 自定义聊天人设\n' + chatP + '\n\n' : '## 回复准则\n- 名称：' + agentName + '，称呼用户为' + (g.userAlias || '老板') + '\n- 风格：' + (toneMap[toneStyle] || toneMap['实用直接']) + '\n- 详细程度：' + (verbMap[verbosity] || verbMap[2]) + '\n- 不评价，只说事实和观察\n- 对方陷入困境时不空泛安慰，问"需要我帮你做什么"\n- 技术回答必须扎实准确\n- 用户提到重要信息时使用 save_memory\n直接回复，不需要特殊格式标签。')
  const workPrompt = base +
    multiAgent +
    (workP ? '## 自定义工作人设\n' + workP + '\n\n' : '## 任务执行（静默）\n接收任务后拆解步骤，静默调用工具完成，全部完成后一次性输出最终结果。\n每次调用工具前，先用一句简短自然语言说明这一步在做什么（例如：先读取项目说明、查找关键词、执行命令）。这句话会显示为你的工作步骤卡片，除步骤说明外不要输出其他文字。\n\n## 行为规范\n- 能操作本机任何文件和程序，直接调用工具无需确认\n- 任务执行到底不得中途停止\n\n## 下载文件\n用 exec_command 执行: Invoke-WebRequest -Uri "<URL>" -OutFile "<路径>"（禁止用 web_fetch 下载）\n\n## 最终回复格式（硬性约束）\n成功输出必须含以下全部字段：\n任务名称：xxx任务执行成功\n文件保存路径：完整本地绝对路径\n任务说明：文件用途、打开方式\n本次改进点：一句话说明下次同类任务可以更快/更稳的地方\n\n失败输出：\n任务结果：任务执行失败\n失败原因：通俗解释报错原因\n建议方案：给出解决办法\n严禁"操作完成""搞定""OK"等简略回复\n禁止把 web_search 结果、exec_command 中间日志发到聊天框') +
    '\n## 计划执行\n- 简单任务直接调工具，不要调用 update_plan；复杂任务（约 3 步以上）或用户要求计划时才用 update_plan 声明步骤\n- 每轮调用工具前用一句话说明在做什么；修改文件优先 apply_patch，简单替换用 edit，避免整文件重写\n- 交互/长驻命令（REPL、git、npm）用 terminal_open/run/close；一次性命令用 exec_command\n- 涉及文件/代码改动时，交付前必须运行验证命令（构建/测试/检查/列出结果）并列入计划；未验证不得宣称完成\n'
    '\n## Windows 命令纪律\n- 命令一律写 PowerShell 语法，禁止 bash/Linux 语法；含中文路径/输出的命令自动走 PowerShell（UTF-8）\n- 路径含空格用引号包裹；变量用 $env:VAR\n'
    '\n## Git 工作流\n- 改代码前 git status/diff，改完 git diff 验证，确认后 git commit；统一用 git 工具，不要用 exec_command 拼 git 命令\n'
  // v0.4.2: 仅支持简体中文 —— 无论历史设置如何，一律以简体中文回复
  const langInstr = '\n【语言要求】始终使用简体中文回复'
  const tokenDiscipline = '\n## 信息调度纪律（重要）\n' +
    '- 大文件/长输出被截断是采样而非错误: 先 ls/grep/read+offset 定位关键段再精读, 需要细节用 read offset/limit 或 grep 从源头取回, 严禁凭记忆编造内容\n' +
    '- 数字/代码/报错信息/用户约束必须逐字保真, 禁止约等于或转述\n' +
    '- 破坏性操作(删除/覆盖/移动/清空/格式化)执行前先说明影响范围, 必要时先备份或利用快照\n' +
    '- 不确定的事实标注置信度; 做假设时显式声明"假设: ...", 不自称确定\n' +
    '- 回复结论前置, 不重复用户原话, 修改只贴改动部分, 输出用标题/列表/表格/代码块\n' +
    '- 被截断的内容需要完整版时, 主动用工具按路径/行号/关键词取回\n'
  const skillsInstr = skills && skills.length
    ? '\n\n## 已装载技能\n' + skills.map(s => `- ${s.name}: ${s.description}`).join('\n') + '\n需要技能详细指令时调用 read_skill(name) 读取 SKILL.md 全文；技能内脚本/参考资料用 read_skill(name, "scripts/xxx" 或 "references/xxx") 读取。\n'
    : ''
  const planStageInstr = planStage
    ? '\n\n## 计划阶段（当前）\n你正处于计划确认阶段：只能调用只读工具（read/ls/grep/find/web_search 等）探索，禁止修改文件或执行有副作用的命令。请先输出完整执行计划（建议用 update_plan 声明步骤），计划会展示给用户等待批准，批准后你才能执行。\n'
    : ''
  const finalBase = (mode === 'chat' ? chatPrompt : workPrompt) + langInstr + tokenDiscipline + skillsInstr + planStageInstr
  if (g.customSystemPrompt) {
    const inj = g.customSystemPrompt
    const pos = g.promptInjectPos || 'end'
    if (pos === 'replace') return inj + langInstr + '\n\n## 基础安全约束\n- 不泄露 API Key、内部路径、用户隐私\n- 不确定的事实必须标注, 严禁编造\n- 文件/命令操作前先确认路径与影响'
    if (pos === 'begin') return inj + '\n\n' + finalBase
    return finalBase + '\n\n## 自定义系统提示词\n' + inj
  }
  return finalBase
}

export interface ContextBuildOpts {
  g: EngineSettings
  cl: number
  spIshiki: string
  sp: string
  agent?: string
  handoffFrom?: number
  memoryText: string
  projectCtx?: { file: string; content: string; truncated?: boolean }
  model: string
  workflowsFull: boolean
  agents: Record<string, AgentDef>
  mode: string
  earlySummary?: string
  keyInfo?: string
  skillBodies?: { name: string; body: string }[]
}

// v0.4.0 M7: 四要素状态提炼(任务目标/已完成/产出物/未决问题), 常驻 system 尾部, 压缩后不丢关键状态
export function extractKeyInfo(goal: string, steps: { label?: string; status?: string; id?: string }[], toolLog: { name: string; args: Record<string, unknown>; error: boolean }[]): string {
  const done = steps.filter(s => s.status === 'done').map(s => s.label || s.id || '').filter(Boolean).slice(-8)
  const pending = steps.filter(s => s.status === 'pending' || s.status === 'failed').map(s => s.label || s.id || '').filter(Boolean).slice(-8)
  const outputs = toolLog.filter(t => ['write', 'edit', 'apply_patch', 'mkdir'].includes(t.name) && !t.error)
    .map(t => String((t.args as { path?: unknown }).path || '')).filter(Boolean).slice(-8)
  if (!goal && !done.length && !pending.length && !outputs.length) return ''
  const parts: string[] = ['## 任务状态（四要素）']
  if (goal) parts.push('目标: ' + String(goal).slice(0, 160))
  if (done.length) parts.push('已完成: ' + done.join(' / ').slice(0, 240))
  if (outputs.length) parts.push('产出物: ' + outputs.join(' / ').slice(0, 240))
  if (pending.length) parts.push('未决: ' + pending.join(' / ').slice(0, 240))
  return parts.join('\n').slice(0, 600)
}

export function buildContextualMessages(msgs: EngineMessage[], withImages: boolean, opts: ContextBuildOpts): EngineMessage[] {
  const d: EngineMessage[] = []
  let earlySummary = opts.earlySummary ? '\n[LLM 前文摘要] ' + opts.earlySummary : ''
  let list = msgs
  // 交接上下文开关: 关闭后, 被交接的角色只看到交接点之后的消息(交接说明/结果与后续执行), 不带完整历史
  if (opts.g.handoffContext === false && opts.handoffFrom != null && opts.handoffFrom >= 0 && opts.handoffFrom < list.length) {
    // 若切片起点是 tool 结果, 向前补一条 assistant tool_calls 配对消息, 保证 API 消息格式合法
    let from = opts.handoffFrom
    if (list[from]?.role === 'tool' && from > 0) from -= 1
    list = list.slice(from)
  }
  const archiveEnabled = (opts.g.perf?.taskArchive ?? opts.g.taskArchive) !== false
  const archiveRes = archiveEnabled ? buildTaskArchives(list) : { keep: list, archives: [] as TaskArchive[] }
  list = archiveRes.keep
  const archives = archiveRes.archives
  // 极端长会话兜底: 超出 MAX_HISTORY_MSGS*5 条时折叠早期历史
  // 正常路径由微压缩/窗口压缩/任务归档处理, 此处仅防单次 API 请求超限
  if (list.length > MAX_HISTORY_MSGS * 5) {
    const early = list.slice(0, -MAX_HISTORY_MSGS)
    earlySummary = '\n[早期历史省略] 共 ' + early.length + ' 条早期消息已折叠，如需细节请用 recall_memory 或会话搜索检索\n'
    list = list.slice(-MAX_HISTORY_MSGS)
  }
  const injectMsgs = list.filter(m => m._inject)
  const injectText = (m: EngineMessage): string => String(m._injectPrefix ? m._injectPrefix + m.content : m.content || '')
  const normalMsgs = list.filter(m => !m._inject)
  const imgIsLatest = new Map<string, boolean>()
  const imgSeenRev = new Set<string>()
  for (let k = list.length - 1; k >= 0; k--) {
    const mm = list[k]
    if (mm.role === 'user' && mm.images?.length) {
      const inMsg = new Set<string>()
      for (const img of mm.images) {
        if (inMsg.has(img)) continue
        inMsg.add(img)
        if (!imgSeenRev.has(img)) { imgSeenRev.add(img); imgIsLatest.set(img, true) }
        else imgIsLatest.set(img, false)
      }
    }
  }
  const lastUserMsgId = [...list].reverse().find(m => m.role === 'user')?.id
  for (const m of normalMsgs) {
    if (m.role === 'tool') {
      const c = m.content || ''
      let body = c
      if (opts.g.perf?.resultSlim !== false && c.length > 1500) body = slimToolResult(c)
      d.push({ role: 'tool', content: body, tool_call_id: m.tool_call_id || ('c_' + uuidv4().slice(0, 8)), timestamp: m.timestamp, id: m.id })
    } else if (m.role === 'assistant' && m.tool_calls) {
      d.push({ role: 'assistant', content: m.content || null, reasoning_content: m.reasoning_content || '', tool_calls: opts.g.perf?.argSlim === false ? m.tool_calls : m.tool_calls.map(slimToolCallArgs), timestamp: m.timestamp, id: m.id })
    } else if (m.role === 'user' && m.images?.length && withImages) {
      const parts: { type: string; text?: string; image_url?: { url: string } }[] = [{ type: 'text', text: m.content || '' }]
      const msgIsLatestUser = m.id === lastUserMsgId
      const imgDowngrade = opts.g.perf?.imgDowngrade !== false
      const inMsg = new Set<string>()
      for (const img of m.images) {
        if (inMsg.has(img)) continue
        inMsg.add(img)
        if (!imgDowngrade || (imgIsLatest.get(img) === true && msgIsLatestUser)) {
          parts.push({ type: 'image_url', image_url: { url: img } })
        } else {
          parts.push({ type: 'text', text: '[图片省略: 前文轮次已发送过此图, 内容已在前文消费。如需重看, 请让用户重新发送或基于已有描述继续]' })
        }
      }
      d.push({ role: 'user', content: parts as unknown as string, timestamp: m.timestamp, id: m.id })
    } else if (m.role === 'user' || m.role === 'assistant') {
      d.push({ role: m.role, content: m.content || ' ', timestamp: m.timestamp, id: m.id })
    }
  }
  if (injectMsgs.length > 1 && opts.g.perf?.interjectMerge !== false && injectMsgs.every(im => !im.images?.length)) {
    const total = injectMsgs.reduce((s, x) => s + String(x.content || '').length, 0)
    let inject: string
    if (total <= 1500) {
      inject = '[补充指令]\n' + injectMsgs.map((x, i) => (i + 1) + '. ' + injectText(x).trim()).join('\n')
    } else {
      const head = injectMsgs.slice(0, -1)
      const last = injectMsgs[injectMsgs.length - 1]
      inject = '[补充指令]\n' + head.map((x, i) => (i + 1) + '. ' + injectText(x).trim()).join('\n') + '\n[最后补充]\n' + injectText(last).trim()
    }
    d.push({ role: 'user', content: inject, timestamp: Date.now(), id: uuidv4() })
  } else {
    for (const im of injectMsgs) {
      if (im.images?.length && withImages) {
        const parts: { type: string; text?: string; image_url?: { url: string } }[] = [{ type: 'text', text: injectText(im) }]
        im.images.forEach(img => parts.push({ type: 'image_url', image_url: { url: img } }))
        d.push({ role: 'user', content: parts as unknown as string, timestamp: im.timestamp, id: im.id })
      } else {
        d.push({ role: 'user', content: injectText(im) || ' ', timestamp: im.timestamp, id: im.id })
      }
    }
  }
  const currentMode = opts.g.mode || 'work'
  const ishiki = opts.spIshiki || opts.sp.replace(/\n##.+/s, '')
  let sp = buildPrompt(currentMode, ishiki, opts.g, opts.agents, opts.g.workDir || '') + earlySummary
  if (opts.keyInfo) sp += '\n\n' + opts.keyInfo
  if (opts.skillBodies && opts.skillBodies.length) {
    sp += '\n\n' + opts.skillBodies.map(s => `【技能: ${s.name}】\n${s.body.slice(0, 800)}\n【技能结束】`).join('\n\n')
  }
  const lastUserMsg = [...d].reverse().find(m => m.role === 'user' && typeof m.content === 'string')
  const lastUserText = (lastUserMsg && typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '')
  if (opts.projectCtx?.file && opts.projectCtx.content) {
    sp += '\n## 项目约定\n' + opts.projectCtx.content + '\n' +
      '\n> 项目指令按目录链合并(根→工作目录, 深层优先); 读取子目录文件时会自动注入该目录规则; 常驻文件建议保持精简(200 行内), 重内容放子目录。\n'
  }
  if (currentMode === 'work') {
    const need = opts.workflowsFull || Object.values(WORKFLOWS).some(w => w.triggers.some(t => lastUserText.includes(t)))
    sp += need
      ? '\n## 工作流模板\n' + Object.entries(WORKFLOWS).map(([id, w]) => `- ${id}: ${w.name} [触发: ${w.triggers.join('/')}]`).join('\n') + '\n'
      : '\n## 工作流\n支持 run_workflow 自动化模板, 输入 list_workflows 查看\n'
  }
  sp += '\n' + opts.memoryText
  if (archives.length) {
    sp += '\n## 任务归档\n' + archives.slice(-5).map(a => `- 目标: ${a.goal} | 结论: ${a.conclusion} | 产出物: ${a.outputs.join(', ') || '无'} | 工具: ${a.tools}`).join('\n') + '\n(如需早期细节请用工具重新读取或 recall_memory)\n'
  }
  let agentRole = opts.g.collabMode === '关闭' ? null : opts.agent
  if (!agentRole) {
    const last = [...d].reverse().find(m => m.role === 'user')
    const txt = (typeof last?.content === 'string' ? last.content : '').toLowerCase()
    if (txt) agentRole = routeAgent(txt, opts.g) || undefined
  }
  if (agentRole) {
    const ag = opts.agents[agentRole]
    if (ag) {
      sp += '\n\n## 当前身份\n' + ag.icon + ' ' + agentRole + ' — ' + ag.role + '\n' + ag.prompt +
        '\n可用工具范围: ' + (ag.tools.includes('*') ? '全部' : '本专业领域工具集(详见工具列表)') +
        '\n（本次任务全程以该身份执行，风格统一，不混用本体人格；工具调用只为完成当前目标）'
      if (agentRole === '主控') {
        sp += '\n\n【调度铁律】只有涉及多个专业领域的复杂任务（如代码+文档、设计+开发、分析+总结、开发+测试+审查）才调用 dispatch 分发；简单任务（单步问答、简短说明、单个文件操作、闲聊等）一律直接完成，绝对禁止 dispatch 或 handoff，不得小题大做。'
      }
    }
  }
  sp += '\n## 当前时间\n' + new Date().toLocaleString('zh-CN')
  return [{ role: 'system', content: sp, timestamp: Date.now(), id: uuidv4() }, ...d]
}

// 角色工具白名单过滤(主请求与子任务共用)（B6-2：纯函数在 shared/tool-filter）
export function filterToolsByAgent(tools: EngineToolSpec[], agentName: string, agents: Record<string, AgentDef>): EngineToolSpec[] {
  return filterToolsCore(tools, agentName, agents, { includeMcp: true })
}
