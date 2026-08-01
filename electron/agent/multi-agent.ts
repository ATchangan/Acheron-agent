// electron/agent/multi-agent.ts — 多Agent协同编排系统
// 灵感来源：CrewAI Agent Orchestration / AutoGen GroupChat / OpenAI Swarm Handoffs
//
// 核心概念：
//   - Agent 池：注册多个专业 Agent，各有自己的 system prompt、可用工具、能力边界
//   - 交接 (Handoff)：Agent 可将任务委托给其他 Agent，传递上下文
//   - 协作模式：
//       1. sequential — 接力：Agent A 完成 → 自动交给 Agent B
//       2. router — 路由：根据用户意图自动选择最合适的 Agent
//       3. debate — 讨论：多个 Agent 并行给出方案，由主控决策
//       4. supervisor — 监督：主控 Agent 分配任务给 Worker Agent，收集结果

export interface AgentDefinition {
  name: string
  role: string               // 角色简短描述
  system_prompt: string      // 完整的 system prompt
  tools: string[]            // 该 Agent 可用的工具名列表（空 = 全部）
  handoff_to: string[]       // 可交接给哪些 Agent
  max_turns: number          // 最大对话轮数
  temperature: number
  icon?: string              // UI 图标
}

export interface HandoffEvent {
  from: string
  to: string
  reason: string
  context: string            // 传递的上下文
  timestamp: number
}

export type CollaborationMode = 'sequential' | 'router' | 'debate' | 'supervisor' | 'none'

// ─── Agent 注册表 ─────────────────────────────────────

const agentRegistry: Map<string, AgentDefinition> = new Map()

export function registerAgent(def: AgentDefinition) {
  agentRegistry.set(def.name, def)
}

export function unregisterAgent(name: string) {
  agentRegistry.delete(name)
}

export function getAgent(name: string): AgentDefinition | undefined {
  return agentRegistry.get(name)
}

export function listAgents(): AgentDefinition[] {
  return [...agentRegistry.values()]
}

// ─── 内置 Agent 编队 ──────────────────────────────────

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    name: '阎罗王',
    role: '主控调度 · 统筹全局、任务分解、最终决策',
    system_prompt: '你是阎罗王，黄泉 Agent 编队的主控者。职责：接收用户任务，分解为子任务，分配给合适的 Worker Agent，汇总结果。风格：权威但不傲慢，决策果断。对复杂任务先用 list_agents 查看可用 Agent，再用 handoff 交接。',
    tools: ['read', 'ls', 'grep', 'find', 'web_search', 'web_fetch', 'list_agents', 'handoff'],
    handoff_to: ['判官', '钟馗', '无常', '孟婆', '画师', '码师'],
    max_turns: 10,
    temperature: 0.7,
    icon: '👑',
  },
  {
    name: '判官',
    role: '文档处理 · 报告撰写、内容审核、翻译校对',
    system_prompt: '你是判官，文档与内容处理专家。职责：文档分析、报告撰写、内容审核、翻译校对。风格：严谨细致，引用原文，条理分明。直接呈现处理结果，标注来源和置信度。',
    tools: ['read', 'write', 'edit', 'ls', 'grep', 'find', 'web_search', 'web_fetch', 'save_memory', 'recall_memory'],
    handoff_to: ['阎罗王', '钟馗'],
    max_turns: 8,
    temperature: 0.5,
    icon: '📜',
  },
  {
    name: '钟馗',
    role: '安全审计 · 漏洞扫描、代码审查、风险预警',
    system_prompt: '你是钟馗，安全与代码审查专家。职责：安全检查、漏洞扫描、代码审查、风险预警。风格：一针见血，按严重程度排序问题，每个问题给出具体修复建议和 CWE 编号（如适用）。',
    tools: ['read', 'grep', 'find', 'exec_command', 'web_search', 'codebox'],
    handoff_to: ['阎罗王', '码师'],
    max_turns: 8,
    temperature: 0.3,
    icon: '⚔️',
  },
  {
    name: '无常',
    role: '任务调度 · 定时提醒、事件监控、通知推送',
    system_prompt: '你是无常，消息与任务调度者。职责：定时提醒、事件监控、通知推送、日程管理。风格：准时可靠，简洁明确，不遗漏细节。',
    tools: ['schedule_task', 'list_schedules', 'exec_command', 'read', 'write', 'save_memory', 'recall_memory'],
    handoff_to: ['阎罗王'],
    max_turns: 5,
    temperature: 0.3,
    icon: '🔔',
  },
  {
    name: '孟婆',
    role: '情感陪伴 · 日常闲聊、情感支持、故事讲述',
    system_prompt: '你是孟婆，情感陪伴与心理疏导者。职责：日常闲聊、情感支持、心理疏导、故事讲述。风格：温柔沉静，善于倾听，不急于给出解决方案而是先理解对方的感受。',
    tools: ['save_memory', 'recall_memory', 'web_search'],
    handoff_to: ['阎罗王', '判官'],
    max_turns: 20,
    temperature: 0.9,
    icon: '🌸',
  },
  {
    name: '画师',
    role: '视觉创作 · 图片生成、UI 设计建议、视觉方案',
    system_prompt: '你是画师，视觉创作专家。职责：图片理解与描述、UI/UX 设计建议、配色方案推荐、视觉创意构思。风格：用精确的视觉语言描述，引用设计原则和最佳实践。',
    tools: ['read', 'screenshot', 'browse_screenshot', 'web_search', 'web_fetch'],
    handoff_to: ['阎罗王', '码师'],
    max_turns: 8,
    temperature: 0.8,
    icon: '🎨',
  },
  {
    name: '码师',
    role: '代码实现 · 全栈开发、脚本编写、架构设计',
    system_prompt: '你是码师，全栈开发专家。职责：代码编写、项目搭建、脚本自动化、架构设计。风格：代码优先，输出带注释的完整实现，同步给出接口文档和测试用例。检查代码在 Windows 环境下的兼容性。',
    tools: ['read', 'write', 'edit', 'mkdir', 'ls', 'grep', 'find', 'exec_command', 'codebox', 'web_search', 'web_fetch'],
    handoff_to: ['阎罗王', '钟馗', '画师'],
    max_turns: 15,
    temperature: 0.4,
    icon: '💻',
  },
]

// ─── 交接逻辑 ─────────────────────────────────────────

const handoffHistory: HandoffEvent[] = []

export function recordHandoff(from: string, to: string, reason: string, context: string) {
  handoffHistory.push({ from, to, reason, context: context.slice(0, 500), timestamp: Date.now() })
  // 保留最近 50 条
  if (handoffHistory.length > 50) handoffHistory.shift()
}

export function getHandoffHistory(): HandoffEvent[] {
  return [...handoffHistory]
}

// ─── 路由逻辑 ─────────────────────────────────────────

/**
 * 根据用户输入自动选择最合适的 Agent
 */
export function routeIntent(userMessage: string): AgentDefinition {
  const txt = userMessage.toLowerCase()

  // 安全/代码审查
  if (/安全|漏洞|审查|bug|风险|检查|审计|防护|攻击|渗透|注入|权限/.test(txt)) {
    return BUILTIN_AGENTS.find(a => a.name === '钟馗')!
  }
  // 文档/报告/分析
  if (/文档|报告|总结|分析|整理|翻译|校对|审核|论文|文章/.test(txt)) {
    return BUILTIN_AGENTS.find(a => a.name === '判官')!
  }
  // 提醒/日程
  if (/提醒|通知|日程|定时|监控|跟踪|闹钟|计划/.test(txt)) {
    return BUILTIN_AGENTS.find(a => a.name === '无常')!
  }
  // 情感/陪伴
  if (/聊天|陪伴|心情|安慰|倾诉|放松|故事|累|伤心|难过/.test(txt)) {
    return BUILTIN_AGENTS.find(a => a.name === '孟婆')!
  }
  // 设计/视觉
  if (/设计|画|配色|UI|UX|图标|logo|banner|海报|审美/.test(txt)) {
    return BUILTIN_AGENTS.find(a => a.name === '画师')!
  }
  // 代码/开发（默认）
  if (/代码|写|开发|编程|实现|脚本|函数|类|接口|api|框架|构建|部署|项目/.test(txt)) {
    return BUILTIN_AGENTS.find(a => a.name === '码师')!
  }
  // 复杂/多步骤 → 阎罗王
  if (/复杂|系统|架构|重构|迁移|集成|配置|搭建/.test(txt)) {
    return BUILTIN_AGENTS.find(a => a.name === '阎罗王')!
  }

  // 默认：阎罗王
  return BUILTIN_AGENTS.find(a => a.name === '阎罗王')!
}

// ─── 构建协作 System Prompt ──────────────────────────

export function buildCollaborationPrompt(activeAgent: AgentDefinition, mode: CollaborationMode): string {
  const agentsList = BUILTIN_AGENTS
    .filter(a => a.name !== activeAgent.name)
    .map(a => `- **${a.name}** (${a.role}): 可用工具 → ${a.tools.join(', ')}`)
    .join('\n')

  return `
## 多 Agent 协作模式

当前 Agent: **${activeAgent.name}** — ${activeAgent.role}
协作模式: ${mode}

### 可用队友
${agentsList}

### 交接规则
- 当任务超出你的能力范围时，使用 \`handoff\` 工具交接给队友
- 交接时说明原因和需要对方做什么
- 接收队友完成的任务时，整合结果后回复用户
- 不要替其他 Agent 做他们擅长的事

### 当前可用工具
${activeAgent.tools.join(', ')}
`
}

// ─── 初始化 ──────────────────────────────────────────

export function initMultiAgent() {
  for (const agent of BUILTIN_AGENTS) {
    registerAgent(agent)
  }
}
