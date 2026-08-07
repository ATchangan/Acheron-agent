// src/utils/trace.ts — 渲染层诊断轨迹(v0.3.3 可观测性)
import { useSettingsStore } from '../store/settings'
import type { TraceEntry } from '../global'

export function traceLog(level: TraceEntry['level'], event: string, detail?: string, sid?: string, requestId?: string): void {
  try {
    if (useSettingsStore.getState().general.traceEnabled === false) return
    window.huangquan.trace.log({
      ts: Date.now(),
      level,
      event,
      detail: detail ? String(detail).slice(0, 600) : undefined,
      sid,
      requestId,
    }).catch(() => {})
  } catch { /* 轨迹不可用时静默 */ }
}
