// src/store/reliability.ts — 任务可靠性纯函数(v0.3.3 内核加固)
// 职责: 指数退避(带抖动)/任务 token 预算计算/超限判定。全部纯函数, 可单测。

export interface TokenCounter {
  inputTokens?: number
  outputTokens?: number
  writeTokens?: number
}

// 指数退避 + 25% 抖动 —— 网络抖动/限流时避免固定间隔撞车
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 8000): number {
  const safeAttempt = Math.max(0, Math.min(attempt, 10))
  const exp = Math.min(maxMs, baseMs * Math.pow(2, safeAttempt))
  return Math.min(maxMs, Math.round(exp * (0.75 + Math.random() * 0.5)))
}

// 本任务 token 增量 = 当前累计 - 任务起始基线(输入/输出/缓存写入三项)
export function taskTokensUsed(
  now: Record<string, TokenCounter> | undefined,
  base: Record<string, TokenCounter> | undefined
): number {
  const baseMap = base || {}
  let used = 0
  for (const [mk, c] of Object.entries(now || {})) {
    const b = baseMap[mk] || {}
    used += (c.inputTokens || 0) - (b.inputTokens || 0)
    used += (c.outputTokens || 0) - (b.outputTokens || 0)
    used += (c.writeTokens || 0) - (b.writeTokens || 0)
  }
  return Math.max(0, used)
}

// 预算判定: limit<=0 表示不限
export function budgetExceeded(used: number, limit: number): boolean {
  return limit > 0 && used >= limit
}

// 重试间隔别名(语义化调用)
export function retryDelay(attempt: number, baseMs = 500, maxMs = 8000): number {
  return backoffDelay(attempt, baseMs, maxMs)
}
