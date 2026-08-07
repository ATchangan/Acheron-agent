// electron/shared/reliability.ts —— renderer/main 共享可靠性纯函数（B6-1）
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 8000): number {
  const safeAttempt = Math.max(0, Math.min(attempt, 10))
  const exp = Math.min(maxMs, baseMs * Math.pow(2, safeAttempt))
  return Math.min(maxMs, Math.round(exp * (0.75 + Math.random() * 0.5)))
}
