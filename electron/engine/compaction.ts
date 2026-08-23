// electron/engine/compaction.ts — 上下文压缩执行器(0.3.9 结构清理: 从 engine.ts 抽出)
import { v4 as uuidv4 } from 'uuid'
import { chatOnce } from './llm-core'
import { getModelContextLimit, estimateTokens } from './context'
import { runHooks } from './hooks'
import {
  applyCompact, buildCompactNotice, buildCompactPrompt, pickCompactCandidates, pickMicroFoldCandidates, resolveCompactRatio,
  COMPACT_COOLDOWN_MS, COMPACT_DEFAULT_KEEP_ROUNDS, COMPACT_PREFLIGHT_MARGIN, COMPACT_SMALL_WINDOW, COMPACT_SMALL_FLOOR,
} from './compact'
import type { EngineEvent, EngineMessage, EngineUsage } from './types'
import type { TaskState } from './task-types'

export interface CompactionDeps {
  netFetch: typeof fetch
  emit: (ev: EngineEvent) => void
  trace: (level: 'debug' | 'info' | 'warn' | 'error', event: string, detail?: string, sid?: string, requestId?: string) => void
  checkpoint: (task: TaskState, round: number) => void
  recordUsage: (task: TaskState, rid: string, u: EngineUsage, modelOverride?: string) => void
}

export class CompactionRunner {
  constructor(private deps: CompactionDeps) {}

  // 早期消息 LLM 摘要(实验): 长会话早期消息交给模型压缩, 替代规则截断
  async makeEarlySummary(task: TaskState): Promise<string> {
    try {
      const early = task.messages.slice(0, -30).filter(m => typeof m.content === 'string' && m.content).slice(0, 60)
      if (!early.length) return ''
      const text = early.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${String(m.content).slice(0, 200)}`).join('\n')
      const r = await chatOnce(this.deps.netFetch, {
        provider: task.curP.type,
        model: task.model,
        apiKey: task.curP.apiKey,
        baseUrl: task.curP.baseUrl,
        messages: [
          { role: 'system', content: '你是Acheron-Agent。请把下面的早期对话压缩成 200 字以内的要点总结，保留事实、路径、结论。只输出总结。' },
          { role: 'user', content: text.slice(0, 12000) },
        ],
      })
      return r.startsWith('E:') ? '' : r
    } catch { return '' }
  }

  // 微压缩 —— 每轮把最旧纯问答折进运行摘要; 批量折叠最多 3 组, 减少摘要调用次数
  async microCompact(task: TaskState): Promise<void> {
    const msgs = task.messages
    if (!msgs || msgs.length < 12) return
    const cand = pickMicroFoldCandidates(msgs, 3)
    if (!cand) return
    const { start, end, pairs } = cand
    try {
      runHooks(task.g, 'compact-before', { sid: task.sid, taskId: task.taskId, kind: 'micro' })
      const rid = 'micro_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
      const qaText = pairs.map((p, i) => '问' + (i + 1) + '：' + p.user + '\n答' + (i + 1) + '：' + p.assistant).join('\n\n')
      const summary = await chatOnce(this.deps.netFetch, {
        provider: task.curP.type,
        model: task.model,
        apiKey: task.curP.apiKey,
        baseUrl: task.curP.baseUrl,
        messages: [
          { role: 'system', content: '把下面的多组问答压缩成 300 字以内的要点，保留事实、路径、结论，不编造。只输出摘要。' },
          { role: 'user', content: qaText },
        ],
      }, u => this.deps.recordUsage(task, rid, u as EngineUsage))
      if (!summary || summary.startsWith('E:')) return
      const folded = String(summary).slice(0, 500)
      const foldedMsg: EngineMessage = { id: uuidv4(), role: 'user', content: '[早期对话摘要]\n' + folded, timestamp: Date.now() }
      task.messages = [...msgs.slice(0, start), foldedMsg, ...msgs.slice(end)]
      task.earlySummary = (task.earlySummary ? task.earlySummary + '\n' : '') + folded
      this.deps.emit({ type: 'compact', sid: task.sid, messages: task.messages })
      this.deps.trace('info', 'task.micro-compact', 'folded ' + pairs.length + ' 组问答(' + (end - start) + ' msgs)', task.sid, task.taskId)
    } catch { /* 压缩失败不影响主流程 */ }
  }

  // 窗口阈值压缩：真实输入 token 接近窗口上限时批量摘要最旧轮次, 保留最近 N 轮完整上下文
  async maybeCompact(task: TaskState): Promise<void> {
    try {
      if (task.g.perf?.compactSummary === false || task.g.compactSummary === false) return
      const limit = getModelContextLimit(task.model)
      if (!limit) return
      const explicit = task.g.compactOverrides?.[task.model] || task.g.compactThreshold
      let ratio = resolveCompactRatio(task.model, task.g.compactOverrides, task.g.compactThreshold)
      if (!explicit && limit < COMPACT_SMALL_WINDOW) ratio = Math.max(ratio, COMPACT_SMALL_FLOOR)
      const percentThreshold = Math.floor(limit * ratio)
      const absCap = Number(task.g.compactTokenCap) || 0
      const threshold = absCap > 0 ? Math.min(percentThreshold, absCap) : percentThreshold
      let est = 0
      for (const m of task.messages) est += estimateTokens(typeof m.content === 'string' ? m.content : '', task.model)
      est += 2000 // system/提示词/工具 schema 粗估
      const promptTokens = task.lastPromptTokens || 0
      const preflightHit = est > threshold * COMPACT_PREFLIGHT_MARGIN
      if (!preflightHit && (promptTokens <= 0 || promptTokens < threshold)) return
      const now = Date.now()
      if (task.lastCompactAt && now - task.lastCompactAt < COMPACT_COOLDOWN_MS) return
      const keepRounds = Math.max(2, Math.min(20, Number(task.g.compactKeepRounds) || COMPACT_DEFAULT_KEEP_ROUNDS))
      const cands = pickCompactCandidates(task.messages, keepRounds)
      if (cands.length < 3) return
      this.deps.emit({ type: 'stage', sid: task.sid, phase: 'thinking', label: '正在压缩历史', detail: cands.length + ' 条旧消息 → 摘要' })
      runHooks(task.g, 'compact-before', { sid: task.sid, taskId: task.taskId, kind: 'window' })
      const { system, user } = buildCompactPrompt(cands)
      const summary = await chatOnce(this.deps.netFetch, {
        provider: task.curP.type,
        model: task.model,
        apiKey: task.curP.apiKey,
        baseUrl: task.curP.baseUrl,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      })
      if (!summary || summary.startsWith('E:')) return
      task.compactCount = (task.compactCount || 0) + 1
      const notice = buildCompactNotice(task.compactCount)
      const next = applyCompact(task.messages, summary + notice, keepRounds)
      if (next.length >= task.messages.length) return
      task.messages = next
      task.lastCompactAt = now
      this.deps.emit({ type: 'compact', sid: task.sid, messages: task.messages })
      this.deps.checkpoint(task, task.roundNum)
      this.deps.trace('info', 'context.window-compact', '压缩 ' + cands.length + ' 条历史 · 触发 ' + (preflightHit ? 'preflight ' + Math.round(est) : 'usage ' + promptTokens) + '/' + threshold, task.sid, task.taskId)
    } catch { /* 压缩失败不影响主流程 */ }
  }
}
