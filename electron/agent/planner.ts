// electron/agent/planner.ts — Plan-Execute-Verify 循环
// 灵感来源：OpenManus PlanningAgent / LangGraph Plan-Execute / Devin 工作流
//
// 将 Agent 执行拆分为三阶段循环：
//   Plan  →  分析用户意图，生成结构化执行计划
//   Execute → 按计划逐步骤调用工具，收集结果
//   Verify → 验证每步结果，失败则修正重试或退回 Planning
//
// 相比直接 tool-calling 的优势：
//   - 可暂停/恢复（人类审查计划）
//   - 可并行标记（标记独立步骤让 Agent 并行执行）
//   - 失败有回退路径，不会盲目重试
//   - 计划可见，用户可感知 Agent 的思考过程

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface PlanStep {
  id: string
  order: number
  description: string        // 人类可读描述
  tool_name?: string          // 预期的工具名（可选，供 UI 展示）
  tool_args?: Record<string, unknown>
  depends_on: string[]        // 依赖的步骤 ID
  parallel_group?: number     // 同一组的步骤可并行
  status: StepStatus
  result?: string
  error?: string
  retries: number
  max_retries: number
  verification?: string       // 验证条件描述
}

export interface ExecutionPlan {
  id: string
  goal: string                // 用户原始目标
  steps: PlanStep[]
  current_step_index: number
  created_at: number
  status: 'planning' | 'executing' | 'verifying' | 'completed' | 'failed'
  summary?: string
}

// ─── Planner ───────────────────────────────────────────

/**
 * 从 LLM 响应中解析执行计划。
 * LLM 应输出 JSON 格式的计划：
 * {
 *   "goal": "创建 React 项目并配置 Tailwind",
 *   "steps": [
 *     { "order": 1, "description": "创建项目目录", "tool_name": "mkdir", "tool_args": {...}, "depends_on": [], "verification": "目录存在" },
 *     { "order": 2, "description": "初始化 package.json", "tool_name": "exec_command", "tool_args": {...}, "depends_on": [1], "verification": "package.json 存在" }
 *   ]
 * }
 */
export function parsePlan(raw: string, goal: string): ExecutionPlan {
  try {
    // 尝试从 LLM 输出中提取 JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return createFallbackPlan(goal)

    const parsed = JSON.parse(jsonMatch[0])
    const steps: PlanStep[] = (parsed.steps || []).map((s: any, i: number) => ({
      id: s.id || `step_${i + 1}`,
      order: s.order || i + 1,
      description: s.description || `Step ${i + 1}`,
      tool_name: s.tool_name,
      tool_args: s.tool_args,
      depends_on: s.depends_on || [],
      parallel_group: s.parallel_group,
      status: 'pending' as StepStatus,
      retries: 0,
      max_retries: s.max_retries ?? 3,
      verification: s.verification || '',
    }))

    return {
      id: `plan_${Date.now()}`,
      goal,
      steps,
      current_step_index: 0,
      created_at: Date.now(),
      status: 'planning',
    }
  } catch {
    return createFallbackPlan(goal)
  }
}

function createFallbackPlan(goal: string): ExecutionPlan {
  return {
    id: `plan_${Date.now()}`,
    goal,
    steps: [{
      id: 'step_1',
      order: 1,
      description: goal,
      depends_on: [],
      status: 'pending',
      retries: 0,
      max_retries: 3,
    }],
    current_step_index: 0,
    created_at: Date.now(),
    status: 'planning',
  }
}

// ─── Executor ──────────────────────────────────────────

/**
 * 获取下一批可执行的步骤（依赖已满足且状态为 pending）
 */
export function getNextSteps(plan: ExecutionPlan): PlanStep[] {
  const doneIds = new Set(
    plan.steps.filter(s => s.status === 'done' || s.status === 'skipped').map(s => s.id)
  )

  const ready = plan.steps.filter(s => {
    if (s.status !== 'pending') return false
    return s.depends_on.every(depId => doneIds.has(depId))
  })

  // 按 parallel_group 分组：同组可一起执行
  // 不同组（或未分组）按 order 串行
  if (ready.length === 0) return []

  // 找到最小编号的 pending step
  const minOrder = Math.min(...ready.map(s => s.order))
  const currentBatch = ready.filter(s => s.order === minOrder || (s.parallel_group && s.parallel_group === ready.find(r => r.order === minOrder)?.parallel_group))

  return currentBatch
}

export function hasMoreSteps(plan: ExecutionPlan): boolean {
  return plan.steps.some(s => s.status === 'pending')
}

export function isPlanComplete(plan: ExecutionPlan): boolean {
  return plan.steps.every(s => s.status === 'done' || s.status === 'skipped' || s.status === 'failed')
}

// ─── Verifier ──────────────────────────────────────────

/**
 * 验证步骤结果是否满足条件。
 * 返回 null 表示验证通过，否则返回失败原因。
 */
export function verifyStep(step: PlanStep): string | null {
  if (!step.verification) return null

  const v = step.verification.toLowerCase()
  const result = (step.result || '').toLowerCase()
  const error = (step.error || '').toLowerCase()

  // 检查错误
  if (error && (error.includes('error') || error.includes('fail') || error.includes('e:'))) {
    return `执行错误: ${step.error}`
  }

  // 目录存在检查
  if (v.includes('目录') && v.includes('存在')) {
    if (result.includes('exist') || result.includes('not found') || result.includes('no such')) {
      return `目录不存在或创建失败: ${step.result}`
    }
  }

  // 文件存在检查
  if (v.includes('文件') && v.includes('存在')) {
    if (result.includes('not found') || result.includes('no such') || result.includes('e:')) {
      return `文件不存在或创建失败: ${step.result}`
    }
  }

  // 空结果检查
  if ((v.includes('非空') || v.includes('有输出') || v.includes('有内容')) && (!result || result === '(empty output)' || result === '(empty)')) {
    return '期望非空但输出为空'
  }

  // 成功标志检查
  if (v.includes('成功') || v.includes('ok') || v.includes('完成')) {
    if (error || result.includes('失败') || result.includes('error')) {
      return '期望成功但执行失败'
    }
  }

  return null
}

// ─── Plan 格式化 (for System Prompt) ──────────────────

export function formatPlanForPrompt(plan: ExecutionPlan): string {
  const statusIcon = (s: PlanStep) => {
    switch (s.status) {
      case 'done': return '✅'
      case 'running': return '🔄'
      case 'failed': return '❌'
      case 'skipped': return '⏭️'
      default: return '⬜'
    }
  }

  const lines = [
    `## 执行计划: ${plan.goal}`,
    `状态: ${plan.status} | 步骤: ${plan.steps.filter(s => s.status === 'done').length}/${plan.steps.length} 完成`,
    '',
    ...plan.steps.map(s =>
      `${statusIcon(s)} [${s.order}] ${s.description}${s.depends_on.length ? ` (依赖: ${s.depends_on.join(', ')})` : ''}${s.verification ? ` [验证: ${s.verification}]` : ''}`
    ),
  ]
  return lines.join('\n')
}

// ─── 规划提示模板 ─────────────────────────────────────

export const PLANNING_SYSTEM_PROMPT = `
## 任务规划模式

你需要先制定执行计划，再逐步执行。输出 JSON 格式的计划：

\`\`\`json
{
  "goal": "用户目标的简洁描述",
  "steps": [
    {
      "order": 1,
      "description": "这一步做什么",
      "tool_name": "要调用的工具名",
      "tool_args": { "key": "value" },
      "depends_on": [],
      "verification": "如何验证这一步成功"
    }
  ]
}
\`\`\`

规则：
- 先探索（read/ls/grep）后操作（write/edit/mkdir）
- 文件操作前先确认路径
- 每步给出验证条件
- 独立步骤标记不同 parallel_group
`
