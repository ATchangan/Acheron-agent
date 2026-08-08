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

// v0.3.0 M5: 统一错误消息提取(catch unknown 用)（B6-2：与主进程共用 shared/errmsg）
export { errMsg } from '../../electron/shared/errmsg'

// 调试日志门禁: logLevel=debug 时才输出(生产默认 info 不打印调度/切换噪音)
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 保留外部 setDebugLogging 接口, 内部暂无读取点
let debugEnabled = false
export function setDebugLogging(v: boolean): void { debugEnabled = v }
