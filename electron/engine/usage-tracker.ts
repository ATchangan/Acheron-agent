// electron/engine/usage-tracker.ts — token 用量统计与任务预算(0.3.9 结构清理: 从 engine.ts 抽出)
import { normalizeUsage } from './llm-core'
import { classifyCacheSupport, cacheCapToSupported } from './cache-caps'
import { getModelContextLimit } from './context'
import { invokeHandler } from './registry'
import type { EngineEvent, EngineUsage } from './types'
import type { TaskState, TokenStat } from './task-types'

export class UsageTracker {
  private sessTokBySid = new Map<string, Record<string, TokenStat>>()
  private costedReqs = new Set<string>()

  constructor(private emit: (ev: EngineEvent) => void) {}

  snapshotTok(sid: string): Record<string, TokenStat> {
    return JSON.parse(JSON.stringify(this.sessTokBySid.get(sid) || {})) as Record<string, TokenStat>
  }

  recordUsage(task: TaskState, rid: string, u: EngineUsage, modelOverride?: string): void {
    // 同一次请求 usage 可能多次到达(部分供应商流中+结束时各发一次), 按 requestId 去重防统计虚高
    if (this.costedReqs.has(rid)) return
    if (this.costedReqs.size > 500) {
      const arr = [...this.costedReqs]
      this.costedReqs.clear()
      for (const x of arr.slice(-250)) this.costedReqs.add(x)
    }
    this.costedReqs.add(rid)
    const n = normalizeUsage(u)
    const readT = n.readT
    const missT = n.missT
    const writeT = n.writeT
    const inputT = n.inputT
    const outT = n.outputT
    const cap = classifyCacheSupport(task.curP, n.sawCache)
    const mk = modelOverride || task.model
    const cur = this.sessTokBySid.get(task.sid) || {}
    const c = cur[mk] || { requests: 0, readTokens: 0, inputTokens: 0, writeTokens: 0, outputTokens: 0, hitReqs: 0 }
    c.requests += 1
    c.readTokens += readT
    c.inputTokens += inputT
    c.writeTokens += writeT
    c.outputTokens += outT
    c.hitReqs += readT > 0 ? 1 : 0
    cur[mk] = c
    this.sessTokBySid.set(task.sid, cur)
    this.emit({ type: 'usage', sid: task.sid, model: mk, usage: { ...u, _readTokens: readT, _missTokens: missT, _inputTokens: inputT, _writeTokens: writeT } })
    // 上下文环数据源 —— 每次请求的真实 prompt 输入 + 模型上下文上限
    const used = n.rawInputT
    const limit = getModelContextLimit(mk)
    if (used > 0) task.lastPromptTokens = used
    if (used > 0) this.emit({ type: 'context', sid: task.sid, used, limit })
    try {
      void invokeHandler('modelStats:recordRequest', [task.sid, mk, readT > 0, cacheCapToSupported(cap)], null)
      if (readT > 0 || inputT > 0 || writeT > 0 || missT > 0) {
        void invokeHandler('modelStats:recordTokens', [task.sid, mk, readT, inputT, writeT, missT, {
          supported: cacheCapToSupported(cap),
          provider: task.curP?.name,
        }], null)
        void invokeHandler('modelStats:recordEntry', [{
          sid: task.sid,
          model: mk,
          provider: task.curP?.name,
          readTokens: readT,
          missTokens: missT,
          writeTokens: writeT,
          inputTokens: inputT,
          outputTokens: outT,
          hit: readT > 0,
          supported: cacheCapToSupported(cap),
        }], null)
      }
    } catch { /* 忽略 */ }
  }

  taskTokensUsed(task: TaskState): number {
    const now = this.sessTokBySid.get(task.sid) || {}
    const base = task.tokBase
    let used = 0
    for (const [mk, c] of Object.entries(now)) {
      const b = base[mk] || {}
      used += (c.inputTokens - (b.inputTokens || 0)) + (c.outputTokens - (b.outputTokens || 0)) + (c.writeTokens - (b.writeTokens || 0))
    }
    return Math.max(0, used)
  }
}
