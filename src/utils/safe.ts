// src/utils/safe.ts — IPC 参数序列化安全工具(渲染层)
// 从 chat.ts 抽取, 单一来源

export function safeIPC(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  try { return JSON.parse(JSON.stringify(obj)) } catch {
    const seen = new WeakSet()
    const clone = (o: unknown): unknown => {
      if (o === null || typeof o !== 'object') return o
      if (typeof o === 'object' && o !== null && seen.has(o)) return '[Circular]'
      seen.add(o)
      if (Array.isArray(o)) return o.map(clone)
      const r: Record<string, unknown> = {}
      for (const k of Object.keys(o as Record<string, unknown>)) {
        try { const v = (o as Record<string, unknown>)[k]; if (typeof v === 'function' || typeof v === 'symbol') continue; r[k] = clone(v) } catch { /* 单值不可克隆时跳过该字段 */ }
      }
      return r
    }
    return clone(obj)
  }
}

// v0.3.0 M5: 统一错误消息提取(catch unknown 用)
export function errMsg(e: unknown): string {
  // 修复: 原实现递归调用自身导致 Maximum call stack size exceeded
  return e instanceof Error ? e.message : String(e)
}

// 调试日志门禁: logLevel=debug 时才输出(生产默认 info 不打印调度/切换噪音)
let debugEnabled = false
export function setDebugLogging(v: boolean): void { debugEnabled = v }
export const debugLog = (...args: unknown[]): void => { if (debugEnabled) console.log(...args) }
