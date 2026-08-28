// electron/shared/reliability.ts —— renderer/main 共享可靠性纯函数（B6-1）
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 8000): number {
  const safeAttempt = Math.max(0, Math.min(attempt, 10))
  const exp = Math.min(maxMs, baseMs * Math.pow(2, safeAttempt))
  return Math.min(maxMs, Math.round(exp * (0.75 + Math.random() * 0.5)))
}

// v0.4.4 无进展停滞判定阈值（与子任务 dispatch-runner 看门狗口径一致）:
// max(90s, toolTimeout*1000 + 30s)。toolTimeout 为空/0 时按默认 120s 计。
export function resolveStallMs(toolTimeoutSec?: number | string | undefined, minMs = 90000): number {
  const t = Number(toolTimeoutSec) > 0 ? Number(toolTimeoutSec) : 120
  return Math.max(minMs, t * 1000 + 30000)
}
