// electron/engine/reliability.ts — 主进程可靠性纯函数(与渲染层 reliability 同构)
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 8000): number {
  const safeAttempt = Math.max(0, Math.min(attempt, 10))
  const exp = Math.min(maxMs, baseMs * Math.pow(2, safeAttempt))
  return Math.min(maxMs, Math.round(exp * (0.75 + Math.random() * 0.5)))
}
