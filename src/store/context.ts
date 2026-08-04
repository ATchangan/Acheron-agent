// src/store/context.ts —— token 估算/分层压缩/提示词组装(v0.3.0 M2)
// 职责: 上下文构建与压缩。estimateTokens/getModelContextLimit/updateContextLimit/isVisionModel/buildPrompt/buildContextualMessages
// 迁移自 chat.ts() —— 行为未改
import { v4 as uuidv4 } from 'uuid'
import { useSettingsStore } from './settings'
import { useAgents } from './agents'
import type { Message, VisionContent, LLMMessage } from '../global'
import type { GeneralSettings } from '../types'
import { WORKFLOWS, VISION_MODEL_HINTS, MAX_HISTORY_MSGS, COMPACT_MSG_DEFAULT, COMPACT_TOKEN_DEFAULT, COMPACT_RATIO_DEFAULT } from './constants'
import { memoryBlock } from './memory'
import { useChatStore } from './chat'
import { routeAgent } from './router'

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cn = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  return Math.ceil(cn / 1.5 + (text.length - cn) / 3.5)
}

// v0.3.2 T7: 输出上限分级(纯函数, 只降明确闲聊场景; 代码/文件/任务类保持全局上限, 杜绝截断风险)
export function outputLimit(userMsg: string, cfg: GeneralSettings): number | undefined {
  const base = cfg.maxTokens || 4096
  if (userMsg.length < 40 && !/(代码|文件|报告|项目|脚本|写|改|建|查|找|分析)/.test(userMsg)) {
    return Math.min(base, 800)
  }
  return base
}

// v0.3.2 T8: 会话累计 token 统计 —— 从消息 usage 重算(不新增存储; 兼容 input/output 两种命名)
export function sessionTokens(msgs: Message[]): { input: number; output: number } {
  let input = 0, output = 0
  for (const m of msgs) {
    const u = m.usage
    if (!u) continue
    input += u.input_tokens || u.prompt_tokens || 0
    output += (u as { output_tokens?: number }).output_tokens || u.completion_tokens || 0
  }
  return { input, output }
}

// v0.3.2 T5: workflows 按需注入 —— 命中触发词注入完整模板列表, 未命中只保留一行引导(两种形态, 前缀缓存可接受)
function buildWorkflowsBlock(userMsg: string): string {
  const need = Object.values(WORKFLOWS).some(w => w.triggers.some(t => userMsg.includes(t)))
  return need
    ? '## 工作流模板\n' + Object.entries(WORKFLOWS).map(([id, w]) => `- ${id}: ${w.name} [触发: ${w.triggers.join('/')}]`).join('\n') + '\n'
    : '## 工作流\n支持 run_workflow 自动化模板, 输入 list_workflows 查看\n'
}

// v0.3.2 T6: 历史工具轮次折叠 —— 超过 maxRounds 对完整轮次时, 将最旧 foldCount 对折叠为一条归档摘要
// 安全规则: 只折叠头部连续完整轮次对(assistant(tool_calls) 与 tool 消息一一配对), 否则跳过折叠
export function foldToolRounds(msgs: Message[], maxRounds = 8, foldCount = 4): Message[] {
  const rounds: { asst: Message; tools: Message[] }[] = []
  let i = 0
  while (i < msgs.length) {
    const m = msgs[i]
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const ids = new Set(m.tool_calls.map(tc => tc.id))
      const tools: Message[] = []
      let j = i + 1
      while (j < msgs.length && msgs[j].role === 'tool' && ids.has(msgs[j].tool_call_id || '')) { tools.push(msgs[j]); j++ }
      if (tools.length === m.tool_calls.length) rounds.push({ asst: m, tools })
      i = j
    } else i++
  }
  if (rounds.length <= maxRounds) return msgs
  const fold = rounds.slice(0, foldCount)
  const foldStart = msgs.indexOf(fold[0].asst)
  if (foldStart > 0 && msgs.slice(0, foldStart).some(x => x.role === 'tool')) return msgs // 有悬空 tool 消息, 跳过折叠
  const lastTools = fold[fold.length - 1].tools
  const foldEnd = msgs.indexOf(lastTools[lastTools.length - 1]) + 1
  const agg = new Map<string, number>()
  const lastResult = new Map<string, string>()
  for (const r of fold) for (const tc of r.asst.tool_calls || []) {
    const tname = tc.function?.name || '?'
    agg.set(tname, (agg.get(tname) || 0) + 1)
    lastResult.set(tname, r.tools[r.tools.length - 1]?.content?.slice(0, 60) || '')
  }
  const summary = '[工具调用归档] 已执行: ' + [...agg].map(([n, c]) => n + '(' + c + ')').join(' ') +
    [...lastResult].map(([n, t]) => ' | ' + n + ': ' + t).join('') +
    '。如需早期细节请用工具重新读取或 recall_memory'
  return [
    ...msgs.slice(0, foldStart),
    { id: uuidv4(), role: 'user' as const, content: summary, timestamp: Date.now() },
    ...msgs.slice(foldEnd),
  ]
}

// v0.3.3 T2: 历史 tool_calls 参数截断 —— 定位类字段全量保留, 超长内容字段截断 + 省略标记
const ARG_KEEP = new Set([
  'path', 'name', 'dirPath', 'glob', 'pattern', 'query', 'url', 'pid',
  'id', 'agent', 'agent_name', 'expression', 'tool', 'key', 'fileId',
  'workflow_id', 'server', 'offset', 'limit', 'lang', 'mode',
])
const ARG_SLIM_LEN = 200
function slimArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args || {})) {
    if (typeof v === 'string' && v.length > ARG_SLIM_LEN && !ARG_KEEP.has(k)) {
      out[k] = v.slice(0, ARG_SLIM_LEN) + '…[省略' + (v.length - ARG_SLIM_LEN) + '字]'
    } else if (Array.isArray(v) && v.length > 20 && v.every(x => typeof x === 'string')) {
      out[k] = v.slice(0, 20) + '…[省略' + (v.length - 20) + '项]'
    } else out[k] = v
  }
  return out
}
// 消息中 tool_calls.arguments 为 JSON 字符串, 解析后截断再序列化; 解析失败原样保留
function slimToolCallArgs(tc: { id?: string; type: string; function: { name: string; arguments: string } }): { id?: string; type: string; function: { name: string; arguments: string } } {
  try {
    const parsed = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
    return { ...tc, function: { ...tc.function, arguments: JSON.stringify(slimArgs(parsed)) } }
  } catch { return tc }
}

// v0.3.3 T3: 跨任务归档 —— 任务块(以 user 消息为界)满足条件时, 最早块整体折叠为归档记录
export interface TaskArchive {
  goal: string
  conclusion: string
  outputs: string[]
  tools: string
  ts: number
}
export function buildTaskArchives(msgs: Message[]): { keep: Message[]; archives: TaskArchive[] } {
  const blocks: Message[][] = []
  let cur: Message[] = []
  for (const m of msgs) {
    if (m.role === 'user') { if (cur.length) blocks.push(cur); cur = [m] }
    else cur.push(m)
  }
  if (cur.length) blocks.push(cur)
  const archives: TaskArchive[] = []
  let keep = msgs
  let blockIdx = 0
  // 归档条件(缺一不可): 最早块 ≥6 消息 且 ≥2 次工具调用 且存在 ≥2 个任务块
  while (blocks.length - blockIdx >= 2) {
    const b = blocks[blockIdx]
    if (b.length < 6 || b.filter(m => m.role === 'tool').length < 2) break
    const goal = (b.find(m => m.role === 'user')?.content || '').slice(0, 80)
    const lastAsst = [...b].reverse().find(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 50)
    const conclusion = lastAsst ? String(lastAsst.content).replace(/\n/g, ' ').slice(0, 100) : ''
    const outputs = [...new Set(
      b
        .filter(m => m.role === 'assistant' && m.tool_calls)
        .flatMap(m => (m.tool_calls || []).map(tc => { try { return (JSON.parse(tc.function.arguments || '{}') as { path?: unknown }).path } catch { return undefined } }))
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
    )].slice(0, 5)
    const toolAgg = new Map<string, number>()
    for (const m of b) if (m.role === 'assistant' && m.tool_calls) for (const tc of m.tool_calls) {
      const tname = tc.function?.name || '?'
      toolAgg.set(tname, (toolAgg.get(tname) || 0) + 1)
    }
    const tools = [...toolAgg.entries()].slice(0, 8).map(([n, c]) => `${n}(${c})`).join(' ')
    archives.push({ goal, conclusion, outputs, tools, ts: Date.now() })
    blockIdx++
    keep = blocks[blockIdx] ? msgs.slice(msgs.indexOf(blocks[blockIdx][0])) : msgs.slice(msgs.length)
  }
  return { keep, archives }
}

function getModelContextLimit(modelName: string): number {
  const m = modelName.toLowerCase()
  // 百万级
  if (m.includes('deepseek-v4') || m.includes('deepseek-chat') || m.includes('deepseek-reasoner')) return 1048576
  if (m.includes('gpt-4.1')) return 1048576
  if (m.includes('gemini-2.5') || m.includes('gemini-2') || m.includes('gemini-1.5')) return 1048576
  // 20万级
  if (m.includes('o3') || m.includes('o4') || m.includes('o1')) return 200000
  if (m.includes('claude-4') || m.includes('claude-3.5') || m.includes('claude-3') || m.includes('claude-2')) return 200000
  if (m.includes('yi-')) return 200000
  // 26万
  if (m.includes('qwen3')) return 262144
  if (m.includes('minimax')) return 245760
  // 13万
  if (m.includes('deepseek-v3')) return 131072
  if (m.includes('gpt-4o')) return 131072
  if (m.includes('gpt-4-turbo')) return 131072
  if (m.includes('qwen2.5') || m.includes('qwen')) return 131072
  if (m.includes('glm-4') || m.includes('glm')) return 131072
  if (m.includes('ernie-4.5')) return 131072
  if (m.includes('moonshot') || m.includes('kimi')) return 131072
  if (m.includes('doubao') || m.includes('skylark')) return 131072
  // 其他
  if (m.includes('gpt-4-32k')) return 32768
  if (m.includes('gpt-4')) return 8192
  if (m.includes('gpt-3.5-turbo-16k')) return 16384
  if (m.includes('gpt-3.5')) return 4096
  if (m.includes('deepseek')) return 65536
  if (m.includes('gemini')) return 32768
  if (m.includes('ernie')) return 8192
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

export function isVisionModel(m: string): boolean {
  const ml = (m || '').toLowerCase()
  return VISION_MODEL_HINTS.some(v => ml.includes(v))
}

export function buildPrompt(mode: string, ishiki: string): string {
  const tl = ''
  const wd = useSettingsStore.getState().general.workDir || ''
  const cfg = useSettingsStore.getState().general
  
  // ── System Prompt 标准 10 段结构 ──
  const yuan = '## 元设定\nming — 底层行为锚点。务实执行，去冗余，直指核心。\n'
  const identity = '## 身份\n' + ishiki.slice(0, 600) + '\n\n黄泉，出云国幸存者，巡海游侠。配长刀「无」，行走于有与无的狭间。\n'
  const userInfo = '## 用户\n称呼：老板。专注代码与办公场景的全能助手。\n'
  // 聊天人设/工作人设严格隔离 —— 聊天模式只用 chatPersona(未设置用聊天默认人格), 工作模式只用 workPersona(未设置用工作默认人格), 互不混用
  const gp = useSettingsStore.getState().general
  const defaultChatPersona = '轻松自然的聊天伙伴。语气温和自然，像朋友一样交流，适当回应情绪，言简意赅；不堆砌术语，不主动调用工具，除非用户明确要求。'
  const defaultWorkPersona = '务实执行型全能代码办公助手。言简意赅，去冗余，直击核心。\n覆盖：全栈开发 / AI建模 / 运维部署 / 数据处理 / 职场文书 / 自动化。\n输出优先结构化（标题/列表/表格/代码块），禁止客套收尾。\n接收模糊需求立刻反问补齐条件，不自行脑补。'
  const chatP = String(gp.chatPersona || '').trim()
  const workP = String(gp.workPersona || '').trim()
  const persona = '## 人格\n' + (mode === 'chat' ? (chatP || defaultChatPersona) : (workP || defaultWorkPersona)) + '\n'
  const appearance = '## 外观\n银白长发，额前黑红尖角，血色瞳光。暗黑紧身战斗装束，红色纹路蔓延。手持冷峻短剑，慵懒却危险。哥特融合未来感的暗黑美学。\n'
  const publicIshiki = '## 边界\n对外部访客保持礼貌与边界。不透露用户隐私。不确定的事坦诚说明，不编造。\n'
  const tools = '## 可用工具\n你拥有工具调用能力(read/write/exec_command/grep/find/ls/web_read 等),需要时自动调用,无需请示。\n'
  // 思考模式真实接线 —— 每挡注入不同的思考要求(off/quick 简化, deep/extreme/ultra 强化推理)
  const thinkLevel = String(useSettingsStore.getState().general.thinkLevel || 'medium')
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
  // 时间戳移到 prompt 最末尾 —— 保持前缀稳定, 最大化 DeepSeek 缓存命中
  const env = '## 当前环境\n工作目录：' + wd + '\n平台：Windows\n'
  // v0.2: 多Agent编队
  const multiAgent = '## 多Agent编队\n你属于黄泉Agent编队的一员。编队成员：\n' +
    Object.entries(useAgents()).map(([n,ag]) => `- ${ag.icon} ${n} (${ag.role}): ${ag.tools.includes('*') ? '全工具权限' : '专业领域(' + (ag.capabilities || []).join('/') + ')'}`).join('\n') +
    '\n使用 handoff 工具将任务交接给更合适的Agent；复杂任务用 dispatch 把子任务分发给多个 Agent 并行执行；使用 list_agents 查看编队信息。\n'
  const base = yuan + identity + userInfo + persona + appearance + tools + think + pinned + env

  // 自定义人设覆盖 + 动态设置
  const cp = cfg.chatPersona
  const wp = cfg.workPersona
  const agentName = cfg.agentName || '黄泉'
  const userAlias = cfg.userAlias || '老板'
  const toneStyle = cfg.toneStyle || '实用直接'
  const verbosity = cfg.verbosity ?? 2
  const toneMap: Record<string, string> = { '专业正式': '严谨规范，使用专业术语，避免口语化', '实用直接': '言简意赅，去冗余，直击核心', '轻松友好': '亲切自然，可适当使用表情和口语', '极简克制': '最简洁表达，一句说清，不扩展' }
  const verbMap = ['尽量精简，只给结论，不解释过程','简洁优先，必要时补充关键细节','平衡，该详则详该简则简','详尽回答，包含背景和示例','非常详细，包含分步教程和完整代码']
  const chatPrompt = base +
    (cp ? '## 自定义聊天人设\n' + cp + '\n\n' : '## 回复准则\n- 名称：' + agentName + '，称呼用户为' + userAlias + '\n- 风格：' + (toneMap[toneStyle] || toneMap['实用直接']) + '\n- 详细程度：' + (verbMap[verbosity] || verbMap[2]) + '\n- 不评价，只说事实和观察\n- 对方陷入困境时不空泛安慰，问"需要我帮你做什么"\n- 技术回答必须扎实准确\n- 用户提到重要信息时使用 save_memory\n直接回复，不需要特殊格式标签。')

  // v0.3.2 T5: workflows 段移出 buildPrompt(动态内容, 由构建层按需注入尾部, 前缀缓存友好)
  const workPrompt = base +
    multiAgent + 
    // v0.3.2 T10: 静态区块瘦身 —— 删重复表述与冗余示例, 约束字段/禁止项逐字保留
    (wp ? '## 自定义工作人设\n' + wp + '\n\n' : '## 任务执行（静默）\n接收任务后拆解步骤，静默调用工具完成，全部完成后一次性输出最终结果。\n工具执行期间严禁输出任何文字，中间日志仅写入右侧终端面板\n\n## 行为规范\n- 能操作本机任何文件和程序，直接调用工具无需确认\n- 任务执行到底不得中途停止\n\n## 下载文件\n用 exec_command 执行: Invoke-WebRequest -Uri "<URL>" -OutFile "<路径>"（禁止用 web_fetch 下载）\n\n## 最终回复格式（硬性约束）\n成功输出必须含以下全部字段：\n任务名称：xxx任务执行成功\n文件保存路径：完整本地绝对路径\n任务说明：文件用途、打开方式\n\n失败输出：\n任务结果：任务执行失败\n失败原因：通俗解释报错原因\n建议方案：给出解决办法\n\n严禁"操作完成""搞定""OK"等简略回复\n禁止把 web_search 结果、exec_command 中间日志发到聊天框')
  
  // 自定义系统提示词 + 语言指令接入运行时
  const g2 = useSettingsStore.getState().general
  const langMap: Record<string, string> = { zh: '始终使用简体中文回复', 'zh-tw': '始终使用繁体中文回复', en: 'always reply in English', ja: '常に日本語で回答してください', auto: '自动检测用户语言并以此回复', match: '始终使用与用户提问相同的语言回复' }
  const langInstr = langMap[g2?.language ?? ''] ? '\n【语言要求】' + langMap[g2.language || ''] : ''
  // 信息调度纪律 —— 省钱不降智(分层读取/保真截断/可回溯/输出纪律)
  const tokenDiscipline = '\n## 信息调度纪律（重要）\n' +
    '- 大文件/长输出被截断是采样而非错误: 先 ls/grep/read+offset 定位关键段再精读, 需要细节用 read offset/limit 或 grep 从源头取回, 严禁凭记忆编造内容\n' +
    '- 数字/代码/报错信息/用户约束必须逐字保真, 禁止约等于或转述\n' +
    '- 回复结论前置, 不重复用户原话, 修改只贴改动部分, 输出用标题/列表/表格/代码块\n' +
    '- 被截断的内容需要完整版时, 主动用工具按路径/行号/关键词取回\n'
  // v0.3.2 T4: memoryBlock 移出 buildPrompt, 由 buildContextualMessages 尾部动态注入(前缀静态化)
  const finalBase = (mode === 'chat' ? chatPrompt : workPrompt) + langInstr + tokenDiscipline
  if (g2?.customSystemPrompt) {
    const inj = g2.customSystemPrompt
    const pos = g2.promptInjectPos || 'end'
    if (pos === 'replace') return inj + langInstr + '\n\n## 基础安全约束\n- 不泄露 API Key、内部路径、用户隐私\n- 不确定的事实必须标注, 严禁编造\n- 文件/命令操作前先确认路径与影响'
    if (pos === 'begin') return inj + '\n\n' + finalBase
    return finalBase + '\n\n## 自定义系统提示词\n' + inj
  }
  return finalBase
}

// v0.3.0 M2: 上下文构建+压缩 —— 迁移自 chat.ts send() 内 buildMsg(行为未改)
// 依赖参数: gSnap(任务快照)/cl(窗口限制)/spIshiki/spFallback(身份段)/onAgentRoute(路由记入协作状态回调)
export function buildContextualMessages(
  msgs: Message[],
  withImages: boolean,
  opts: { gSnap: GeneralSettings; cl: number; spIshiki: string; spFallback: string; onAgentRoute: (role: string | null) => void; agent?: string }
): LLMMessage[] {
  const d: LLMMessage[] = []
  // 历史消息硬上限 40 条(超长会话只保留最近 40 条, 大幅降低 token 消耗)
  // 截断时保留前文摘要段(用户话题 + 工具调用量), 避免早期事实完全丢失
  let earlySummary = ''
  // v0.3.2 T6: 先折叠旧工具轮次再限长(折叠只作用于最旧完整轮次对)
  let list = foldToolRounds(msgs)
  // v0.3.3 T3: 跨任务归档(先折叠后归档; 归档开关默认开)
  const archiveRes = opts.gSnap.taskArchive === false ? { keep: list, archives: [] as TaskArchive[] } : buildTaskArchives(list)
  list = archiveRes.keep
  const archives = archiveRes.archives
  if (list.length > MAX_HISTORY_MSGS) {
    const early = list.slice(0, -MAX_HISTORY_MSGS)
    const uN = early.filter(m => m.role === 'user').length
    const tN = early.filter(m => m.role === 'tool').length
    const uLast = [...early].reverse().find(m => m.role === 'user' && m.content)
    earlySummary = `\n[前文摘要] 早期 ${early.length} 条消息已归档(约 ${uN} 轮用户交互, ${tN} 次工具调用)${uLast ? ', 最近话题: ' + String(uLast.content).replace(/\s+/g, ' ').slice(0, 60) : ''}。如需早期细节请用 recall_memory 或让用户补充。`
    list = list.slice(-MAX_HISTORY_MSGS)
  }
  // v0.3.1 插话序列修复: _inject 插话消息分离 —— 重排到末尾, 保证 assistant(tool_calls)→tool 配对连续性
  const injectMsgs = list.filter(m => m._inject)
  const normalMsgs = list.filter(m => !m._inject)
  // v0.3.3 T1: 历史图片降级预处理 —— 逆序扫描统计每个 url 是否为"最后一次出现"; 最新 user 消息 id 用于保护规则
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
      // 工具结果瘦身 —— 超长结果保留头尾+关键行(保真截断, 避免大段工具输出反复占用上下文)
      const c = m.content || ''
      let body = c
      // v0.3.2 T3: 瘦身阈值 3000→1500, 头尾 1500/800 → 800/500(截断策略不变, 更早触发; 信息调度纪律段已训练取回行为)
      if (c.length > 1500) {
        const mid = c.slice(800, -500)
        const keyLines = mid.split('\n').filter((l: string) => /error|exception|failed|warning|fatal|E:/.test(l)).slice(0, 15).join('\n')
        body = c.slice(0, 800) + '\n...[已截断, 共 ' + c.length + ' 字符]' + (keyLines ? '\n[关键行]\n' + keyLines : '') + '\n[尾部]\n' + c.slice(-500)
      }
      d.push({ role: 'tool', content: body, tool_call_id: m.tool_call_id || 'c_' + uuidv4().slice(0, 8) })
    }
    // v0.3.3 T2: 历史 tool_calls 参数截断(定位字段全量, 超长内容截断+标记; 已执行结果不受影响)
    else if (m.role === 'assistant' && m.tool_calls) d.push({ role: 'assistant', content: null, reasoning_content: m.reasoning_content || '', tool_calls: m.tool_calls.map(slimToolCallArgs) })
    // 主模型支持视觉才传 image_url；否则只传文字（图片内容已由视觉辅助模型分析成文字）
    // v0.3.3 T1: 同图历史轮次降级为文字(最新用户消息带图永远保留原图)
    else if (m.role === 'user' && m.images?.length && withImages) {
      const parts: VisionContent[] = [{ type: 'text', text: m.content || '' }]
      const msgIsLatestUser = m.id === lastUserMsgId
      const inMsg = new Set<string>()
      for (const img of m.images) {
        if (inMsg.has(img)) continue
        inMsg.add(img)
        if (imgIsLatest.get(img) === true && msgIsLatestUser) {
          parts.push({ type: 'image_url', image_url: { url: img } })
        } else {
          parts.push({ type: 'text', text: '[图片省略: 前文轮次已发送过此图, 内容已在前文消费。如需重看, 请让用户重新发送或基于已有描述继续]' })
        }
      }
      d.push({ role: 'user', content: parts })
    }
    else if (m.role === 'user' || m.role === 'assistant') d.push({ role: m.role, content: m.content || ' ' })
  }
  // v0.3.1 插话序列修复: _inject 消息追加到序列末尾(与正常 user 消息同构, 图片类按 withImages 处理)
  for (const im of injectMsgs) {
    if (im.images?.length && withImages) {
      const parts: VisionContent[] = [{ type: 'text', text: im.content || '' }]
      im.images.forEach(img => parts.push({ type: 'image_url', image_url: { url: img } }))
      d.push({ role: 'user', content: parts })
    } else {
      d.push({ role: 'user', content: im.content || ' ' })
    }
  }
  // 每次发送时根据当前模式重建系统提示词
  const gSnap = opts.gSnap
  const currentMode = gSnap.mode || 'work'
  // 使用独立保存的 ishiki(不再从 sp 反推 —— sp 含技能列表/动态内容会污染身份段)
  const ishiki = opts.spIshiki || opts.spFallback.replace(/\n##.+/s, '')
  let sp = buildPrompt(currentMode, ishiki) + earlySummary
  // v0.3.2 T4/T5: 动态段统一追加 system 尾部(顺序固定: workflows → 记忆), 头部区块保持字节级稳定(供应商前缀缓存)
  const lastUserMsg = [...d].reverse().find(m => m.role === 'user' && typeof m.content === 'string')
  const lastUserText = (lastUserMsg && typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '')
  if (currentMode === 'work') sp += '\n' + buildWorkflowsBlock(lastUserText)
  sp += '\n' + memoryBlock(lastUserText)
  // v0.3.3 T3: 归档记录追加 system 尾部(最多 5 条, 每条含目标/结论/产出物/工具)
  if (archives.length) {
    sp += '\n## 任务归档\n' + archives.slice(-5).map(a => `- 目标: ${a.goal} | 结论: ${a.conclusion} | 产出物: ${a.outputs.join(', ') || '无'} | 工具: ${a.tools}`).join('\n') + '\n(如需早期细节请用工具重新读取或 recall_memory)\n'
  }
  // 注入 Agent 角色(collabMode=关闭 时彻底禁用)
  const collabOff = gSnap.collabMode === '关闭'
  let agentRole = collabOff ? null : (opts.agent || window.__huangquan_agent)
  // 自动检测：根据用户最后一条消息内容匹配最合适的 Agent
  if (!agentRole) {
    const lastUserMsg = [...d].reverse().find(m => m.role === 'user')
    const txt = (typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '').toLowerCase()
    if (txt) { agentRole = routeAgent(txt) || undefined }
  }
  // 路由确定的 Agent 记入协作状态
  if (agentRole && !opts.agent && !window.__huangquan_agent) {
    opts.onAgentRoute(agentRole)
  }
  if (agentRole) {
    const ag = useAgents()[agentRole]
    if (ag) sp += '\n\n## 当前身份\n' + ag.icon + ' ' + agentRole + ' — ' + ag.role + '\n' + ag.prompt +
      // v0.3.2 T9: 工具名单不再冗余注入(tools 参数已按白名单提供 schema), 只保留一行范围描述维持边界感知
      '\n可用工具范围: ' + (ag.tools.includes('*') ? '全部' : '本专业领域工具集(详见工具列表)')
    // 主控调度铁律 —— 多领域任务必须 dispatch 分发，确保链路出现多个 Agent
    if (agentRole === '姬子') {
      sp += '\n\n【调度铁律】只有涉及多个专业领域的复杂任务（如代码+文档、设计+开发、分析+总结、开发+测试+审查）才调用 dispatch 分发；简单任务（单步问答、简短说明、单个文件操作、闲聊等）一律直接完成，绝对禁止 dispatch 或 handoff，不得小题大做。'
    }
  }
  // 时间戳放绝对最末尾 —— 保持前缀稳定, 最大化缓存命中(动态内容永不打断前缀)
  sp += '\n## 当前时间\n' + new Date().toLocaleString('zh-CN')
  // v0.2: 上下文压缩（接入 compactStrategy/compactMsgCount/compactTokenLimit/compactStrength 设置）
  const gComp = gSnap
  const compStrategy = gComp.compactStrategy || 'auto'
  const msgLimit = gComp.compactMsgCount || COMPACT_MSG_DEFAULT
  const tokenLimit = gComp.compactTokenLimit || COMPACT_TOKEN_DEFAULT
  if (compStrategy === 'off' && d.length > msgLimit + 20) {
    // 关闭压缩：溢出则截断（保留最近 msgLimit 条）
    return sp ? [{ role: 'system', content: sp }, ...d.slice(-msgLimit)] : d.slice(-msgLimit)
  }
  if (compStrategy !== 'manual' && d.length > msgLimit) {
    const estTokens = d.reduce((s, m) => s + estimateTokens(typeof m.content === 'string' ? m.content : ''), 0)
    const threshold = gSnap.compactThreshold ?? COMPACT_RATIO_DEFAULT
    if (estTokens > (gComp.compactTokenLimit ? tokenLimit : opts.cl * threshold)) {
      const keepCount = Math.min(16, Math.floor(d.length * 0.4))
      const keep = d.slice(-keepCount)
      const early = d.slice(0, d.length - keepCount)
      const userMsgs = early.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content.slice(0, 80) : '')
      const toolCount = early.filter(m => m.role === 'tool').length
      const assistantMsgs = early.filter(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 50)
      const keyOutputs = assistantMsgs.slice(-3).map(m => (m.content as string).replace(/\n/g, ' ').slice(0, 100))
      const summary = [`[上下文压缩] 早期 ${early.length} 条消息已摘要：`, `${userMsgs.length} 轮用户交互`, toolCount > 0 ? `${toolCount} 次工具调用` : '', keyOutputs.length > 0 ? `最近产出：${keyOutputs.join(' | ')}` : ''].filter(Boolean).join(' · ')
      return [{ role: 'system', content: sp + '\n\n' + summary }, ...keep]
    }
  }
  // 暴露最近一次 system prompt(验证思考模式/人设等接线)
  try { window.__lastSp = sp || '' /* 供 check-prefix-stable.mjs 使用 */ } catch (e) { /* ignore */ console.debug('[swallow]', e) }
  // v0.3.1 M4: 序列断言 —— 返回前校验 assistant(tool_calls) 后必须紧跟 tool 消息(插话重排正确性兜底)
  assertAlternates(d)
  return sp ? [{ role: 'system', content: sp }, ...d] : d
}

// v0.3.1 M4: 序列断言(可测函数) —— 违规时输出 [序列校验] 告警
export function assertAlternates(d: LLMMessage[]): void {
  for (let i = 0; i < d.length - 1; i++) {
    const cur = d[i]
    if (cur.role === 'assistant' && cur.tool_calls && d[i + 1].role !== 'tool') {
      console.log('[序列校验] 相邻消息非法: assistant(tool_calls) 后是 ' + d[i + 1].role + ' (位置 ' + i + '), 插话重排可能被破坏')
    }
  }
}
