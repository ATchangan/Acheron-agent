// electron/engine/context.ts — 独立内核上下文构建(从渲染层 context.ts/context-utils.ts/router.ts 移植)

import { slimToolResult, slimToolCallArgs, buildTaskArchives, calibrateTokens, getCalibrationScale, isVisionModel } from '../shared/context-utils'
import type { TaskArchive } from '../shared/context-utils'
export { slimToolResult, slimToolCallArgs, buildTaskArchives, calibrateTokens, getCalibrationScale, isVisionModel }
export type { TaskArchive }
import type { EngineMessage, EngineSettings, EngineToolSpec } from './types'
import type { AgentDef } from './agents'
import { MAX_HISTORY_MSGS, COMPACT_MSG_DEFAULT, COMPACT_TOKEN_DEFAULT, COMPACT_RATIO_DEFAULT, WORKFLOWS, DOMAIN_RE } from './constants'
import { v4 as uuidv4 } from 'uuid'

// ─── token 估算 + 实测校准(按模型 EMA) ───

export function estimateTokens(text: string, model?: string): number {
  if (!text) return 0
  const s = getCalibrationScale(model || '')
  let base = 0
  const codeBlocks = text.match(/```[\s\S]*?```/g) || []
  for (const b of codeBlocks) base += b.length / 3.5
  const rest = text.replace(/```[\s\S]*?```/g, '')
  const cn = (rest.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  base += cn * 1.2
  const urlM = rest.match(/[a-z]+:\/\/[^\s"'<>]+/gi) || []
  for (const u of urlM) base += 2 + u.split(/[\/?#]/).length
  const nonCn = rest.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '').replace(/[a-z]+:\/\/[^\s"'<>]+/gi, '')
  base += nonCn.length / 4
  return Math.max(1, Math.round(base * s))
}



export function outputLimit(userMsg: string, cfg: EngineSettings): number | undefined {
  const base = Number(cfg.maxTokens) || 4096
  // v0.3.5 T2: 输出上限分级开关 —— 关闭时恒用全局上限
  if (cfg.perf?.outputCap === false) return base
  if (userMsg.length < 40 && !/(代码|文件|报告|项目|脚本|写|改|建|查|找|分析)/.test(userMsg)) {
    return Math.min(base, 800)
  }
  return base
}

export function getModelContextLimit(modelName: string): number {
  const m = modelName.toLowerCase()
  if (m.includes('deepseek-v4') || m.includes('deepseek-chat') || m.includes('deepseek-reasoner')) return 1048576
  if (m.includes('gpt-4.1')) return 1048576
  if (m.includes('gemini-2.5') || m.includes('gemini-2') || m.includes('gemini-1.5')) return 1048576
  if (m.includes('o3') || m.includes('o4') || m.includes('o1')) return 200000
  if (m.includes('claude-4') || m.includes('claude-3.5') || m.includes('claude-3') || m.includes('claude-2')) return 200000
  if (m.includes('yi-')) return 200000
  if (m.includes('qwen3')) return 262144
  if (m.includes('minimax')) return 245760
  if (m.includes('deepseek-v3')) return 131072
  if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 131072
  if (m.includes('qwen2.5') || m.includes('qwen') || m.includes('glm') || m.includes('ernie-4.5') || m.includes('moonshot') || m.includes('kimi') || m.includes('doubao') || m.includes('skylark')) return 131072
  if (m.includes('gpt-4-32k')) return 32768
  if (m.includes('gpt-4')) return 8192
  if (m.includes('gpt-3.5-turbo-16k')) return 16384
  if (m.includes('gpt-3.5')) return 4096
  if (m.includes('deepseek')) return 65536
  if (m.includes('gemini')) return 32768
  if (m.includes('ernie')) return 8192
  return 65536
}

// ─── 纯函数: 工具结果瘦身 / 参数截断 / 轮次折叠 / 跨任务归档 ───

// ─── 意图路由(渲染层 router.ts 移植) ───
const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  code: ['代码', '脚本', '项目', 'bug', '修复', '开发', '编程', '写个', '实现', '重构'],
  doc: ['文档', '报告', '翻译', '总结', '纪要', '整理', '校对'],
  security: ['安全', '漏洞', '审查', '风险', '黑客', '攻防'],
  automation: ['定时', '监控', '自动化', '提醒', '调度', '巡检'],
  vision: ['图片', '截图', '设计', '配色', '看图', 'ui', '图标', '视觉'],
  chat: [],
}
const CAP_TO_AGENT: Record<string, string> = { code: '螺丝咕姆', doc: '三月七', security: '银狼', automation: '艾丝妲', vision: '黑天鹅', chat: '知更鸟' }
export function routeAgent(userMessage: string, g: EngineSettings): string | null {
  const t = userMessage.toLowerCase()
  const disabled = g.disabledAgents || []
  const collabMode = g.collabMode || '自动'
  if (collabMode === '关闭' || collabMode === '手动') return null
  const hitCaps = Object.entries(CAPABILITY_KEYWORDS)
    .filter(([cap, kws]) => kws.length > 0 && kws.some(k => t.includes(k.toLowerCase())))
    .map(([cap]) => cap)
  if (hitCaps.length >= 2 && !disabled.includes('姬子')) return '姬子'
  if (hitCaps.length === 1) {
    const capAg = CAP_TO_AGENT[hitCaps[0]]
    if (capAg && !disabled.includes(capAg)) return capAg
  }
  let hitDomains = 0
  for (const [name, re] of Object.entries(DOMAIN_RE)) {
    if (re.test(t) && !disabled.includes(name)) hitDomains++
  }
  if (hitDomains >= 2 && !disabled.includes('姬子')) return '姬子'
  for (const [name, re] of Object.entries(DOMAIN_RE)) {
    if (re.test(t)) return disabled.includes(name) ? null : name
  }
  if (t.trim().length < 30) return null
  return disabled.includes('姬子') ? null : '姬子'
}

// ─── system prompt 构建(与渲染层 buildPrompt 同构) ───
export function buildPrompt(mode: string, ishiki: string, g: EngineSettings, agents: Record<string, AgentDef>, wd: string): string {
  const yuan = '## 元设定\nming — 底层行为锚点。务实执行，去冗余，直指核心。\n'
  const identity = '## 身份\n' + (ishiki || '').slice(0, 600) + '\n\n黄泉，出云国幸存者，巡海游侠。配长刀「无」，行走于有与无的狭间。\n'
  const userInfo = '## 用户\n称呼：' + (g.userAlias || '老板') + '。关注代码与办公自动化场景。\n'
  const defaultChatPersona = '轻松自然的聊天伙伴。语气温和自然，像朋友一样交流，适当回应情绪，言简意赅；不堆砌术语，不主动调用工具，除非用户明确要求。'
  const defaultWorkPersona = '务实执行型工作模式。言简意赅，去冗余，直击核心。\n覆盖：全栈开发 / 机器学习建模 / 运维部署 / 数据处理 / 职场文书 / 自动化。\n输出优先结构化（标题/列表/表格/代码块），禁止客套收尾。\n接收模糊需求立刻反问补齐条件，不自行脑补。'
  const chatP = String(g.chatPersona || '').trim()
  const workP = String(g.workPersona || '').trim()
  const persona = '## 人格\n' + (mode === 'chat' ? (chatP || defaultChatPersona) : (workP || defaultWorkPersona)) + '\n'
  const appearance = '## 外观\n银白长发，额前黑红尖角，血色瞳光。暗黑紧身战斗装束，红色纹路蔓延。手持冷峻短剑，慵懒却危险。哥特融合未来感的暗黑美学。\n'
  const publicIshiki = '## 边界\n对外部访客保持礼貌与边界。不透露用户隐私。不确定的事坦诚说明，不编造。\n'
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
  const env = '## 当前环境\n工作目录：' + wd + '\n平台：Windows\n'
  const multiAgent = '## 多角色编队\n你属于黄泉编队的一员。编队成员：\n' +
    Object.entries(agents).map(([n, ag]) => `- ${ag.icon} ${n} (${ag.role}): ${ag.tools.includes('*') ? '全工具权限' : '专业领域(' + (ag.capabilities || []).join('/') + ')'}`).join('\n') +
    '\n使用 handoff 工具将任务交接给更合适的角色；复杂任务用 dispatch 把子任务分发给多个角色并行执行；使用 list_agents 查看编队信息。\n'
  const base = yuan + identity + userInfo + persona + appearance + tools + think + pinned + env
  const agentName = g.agentName || '黄泉'
  const toneStyle = g.toneStyle || '实用直接'
  const verbosity = g.verbosity ?? 2
  const toneMap: Record<string, string> = { '专业正式': '严谨规范，使用专业术语，避免口语化', '实用直接': '言简意赅，去冗余，直击核心', '轻松友好': '亲切自然，可适当使用表情和口语', '极简克制': '最简洁表达，一句说清，不扩展' }
  const verbMap = ['尽量精简，只给结论，不解释过程', '简洁优先，必要时补充关键细节', '平衡，该详则详该简则简', '详尽回答，包含背景和示例', '非常详细，包含分步教程和完整代码']
  const chatPrompt = base +
    (chatP ? '## 自定义聊天人设\n' + chatP + '\n\n' : '## 回复准则\n- 名称：' + agentName + '，称呼用户为' + (g.userAlias || '老板') + '\n- 风格：' + (toneMap[toneStyle] || toneMap['实用直接']) + '\n- 详细程度：' + (verbMap[verbosity] || verbMap[2]) + '\n- 不评价，只说事实和观察\n- 对方陷入困境时不空泛安慰，问"需要我帮你做什么"\n- 技术回答必须扎实准确\n- 用户提到重要信息时使用 save_memory\n直接回复，不需要特殊格式标签。')
  const workPrompt = base +
    multiAgent +
    (workP ? '## 自定义工作人设\n' + workP + '\n\n' : '## 任务执行（静默）\n接收任务后拆解步骤，静默调用工具完成，全部完成后一次性输出最终结果。\n每次调用工具前，先用一句简短自然语言说明这一步在做什么（例如：先读取项目说明、查找关键词、执行命令）。这句话会显示为你的工作步骤卡片，除步骤说明外不要输出其他文字。\n\n## 行为规范\n- 能操作本机任何文件和程序，直接调用工具无需确认\n- 任务执行到底不得中途停止\n\n## 下载文件\n用 exec_command 执行: Invoke-WebRequest -Uri "<URL>" -OutFile "<路径>"（禁止用 web_fetch 下载）\n\n## 最终回复格式（硬性约束）\n成功输出必须含以下全部字段：\n任务名称：xxx任务执行成功\n文件保存路径：完整本地绝对路径\n任务说明：文件用途、打开方式\n\n失败输出：\n任务结果：任务执行失败\n失败原因：通俗解释报错原因\n建议方案：给出解决办法\n严禁"操作完成""搞定""OK"等简略回复\n禁止把 web_search 结果、exec_command 中间日志发到聊天框')
  const langMap: Record<string, string> = { zh: '始终使用简体中文回复', 'zh-tw': '始终使用繁体中文回复', en: 'always reply in English', ja: '常に日本語で回答してください', auto: '自动检测用户语言并以此回复', match: '始终使用与用户提问相同的语言回复' }
  const langInstr = langMap[String(g.language || '')] ? '\n【语言要求】' + langMap[String(g.language || '')] : ''
  const tokenDiscipline = '\n## 信息调度纪律（重要）\n' +
    '- 大文件/长输出被截断是采样而非错误: 先 ls/grep/read+offset 定位关键段再精读, 需要细节用 read offset/limit 或 grep 从源头取回, 严禁凭记忆编造内容\n' +
    '- 数字/代码/报错信息/用户约束必须逐字保真, 禁止约等于或转述\n' +
    '- 回复结论前置, 不重复用户原话, 修改只贴改动部分, 输出用标题/列表/表格/代码块\n' +
    '- 被截断的内容需要完整版时, 主动用工具按路径/行号/关键词取回\n'
  const finalBase = (mode === 'chat' ? chatPrompt : workPrompt) + langInstr + tokenDiscipline
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
  projectCtx?: { file: string; content: string }
  model: string
  workflowsFull: boolean
  agents: Record<string, AgentDef>
  mode: string
  earlySummary?: string
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
  // ??????LLM ???????????/?????????????
  // ??????????????????????? API ????????????
  if (list.length > MAX_HISTORY_MSGS * 5) {
    const early = list.slice(0, -MAX_HISTORY_MSGS)
    earlySummary = '\n[?????] ?? ' + early.length + ' ?????????????????????? recall_memory?'
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
  const lastUserMsg = [...d].reverse().find(m => m.role === 'user' && typeof m.content === 'string')
  const lastUserText = (lastUserMsg && typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '')
  if (opts.projectCtx?.file && opts.projectCtx.content) sp += '\n## 项目约定\n' + opts.projectCtx.content + '\n'
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
        '\n可用工具范围: ' + (ag.tools.includes('*') ? '全部' : '本专业领域工具集(详见工具列表)')
      if (agentRole === '姬子') {
        sp += '\n\n【调度铁律】只有涉及多个专业领域的复杂任务（如代码+文档、设计+开发、分析+总结、开发+测试+审查）才调用 dispatch 分发；简单任务（单步问答、简短说明、单个文件操作、闲聊等）一律直接完成，绝对禁止 dispatch 或 handoff，不得小题大做。'
      }
    }
  }
  sp += '\n## 当前时间\n' + new Date().toLocaleString('zh-CN')
  return [{ role: 'system', content: sp, timestamp: Date.now(), id: uuidv4() }, ...d]
}

// 角色工具白名单过滤(主请求与子任务共用)
export function filterToolsByAgent(tools: EngineToolSpec[], agentName: string, agents: Record<string, AgentDef>): EngineToolSpec[] {
  const ag = agents[agentName]
  if (!ag || ag.tools.includes('*')) return tools
  const allowed = new Set([...ag.tools, 'handoff', 'dispatch', 'list_agents', 'session_search'])
  return tools.filter(t => allowed.has(t.function.name) || t.function.name.startsWith('plugin_') || t.function.name.startsWith('mcp__'))
}
