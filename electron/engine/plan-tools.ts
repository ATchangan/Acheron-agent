// electron/engine/plan-tools.ts —— 计划确认阶段的只读工具判断(纯函数, 便于单测)
// 计划门开启且未批准时, 模型只能探索/检索/规划, 禁止修改文件或执行有副作用的命令

const PLAN_READONLY_TOOLS = [
  'read', 'ls', 'grep', 'find',
  'web_search', 'web_fetch', 'web_read',
  'session_search', 'memory_search', 'conversation_search', 'skill_search',
  'list_agents', 'list_workflows', 'list_schedules',
  'system_info', 'update_plan', 'read_skill',
]

const GIT_READONLY_ACTIONS = ['status', 'diff', 'log']

export function isPlanReadonlyTool(name: string, args: Record<string, unknown> = {}): boolean {
  if (PLAN_READONLY_TOOLS.includes(name)) return true
  if (name === 'git') {
    const action = String(args.action || '').trim().toLowerCase()
    return GIT_READONLY_ACTIONS.includes(action)
  }
  return false
}
