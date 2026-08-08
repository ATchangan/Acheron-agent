// src/store/parse-utils.ts — 纯解析工具(独立内核后唯一保留的旧运行时函数, 供测试与兼容)
// dispatch 参数解析容错: 兼容 数组 / {tasks:[...]} / JSON 字符串 三种模型传参风格
export function parseDispatchTasks(raw: unknown): { agent: string; task: string }[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(parsed)) return parsed as { agent: string; task: string }[]
    if (parsed && Array.isArray((parsed as { tasks?: unknown }).tasks)) return (parsed as { tasks: { agent: string; task: string }[] }).tasks
  } catch { /* 忽略 */ }
  return []
}
