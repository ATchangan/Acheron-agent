// electron/agent/context.ts — 上下文窗口智能管理
// 灵感来源：LangGraph Checkpointing / Claude Prompt Caching / MemGPT
//
// 核心策略：
//   1. 分层压缩 — 接近限制时按优先级压缩/截断消息
//   2. 滑动窗口 — 保留最近 N 条完整消息 + 早期摘要
//   3. 智能总结 — 对旧消息生成渐进式摘要
//   4. Token 估算 — 粗略估算 token 数量（中英文混合）

export interface ContextStats {
  total_tokens: number
  system_tokens: number
  messages_tokens: number
  tool_results_tokens: number
  message_count: number
  compressed: boolean
  summary_count: number
}

interface SummarizedChunk {
  id: string
  start_index: number
  end_index: number
  summary: string
  token_saved: number
}

// ─── Token 估算 ────────────────────────────────────────
// 粗略估算：中文 ~1.5 字符/token，英文 ~4 字符/token，混合取 ~2.5

export function estimateTokens(text: string): number {
  if (!text) return 0
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 3.5)
}

export function estimateMessagesTokens(messages: Array<{ role: string; content?: string | null }>): number {
  let total = 0
  for (const m of messages) {
    total += 4
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content)
    } else if (Array.isArray(m.content)) {
      for (const part of m.content as any[]) {
        if (part.text) total += estimateTokens(part.text)
        if (part.image_url) total += 85
      }
    }
  }
  return total
}

// ─── 分层压缩策略 ──────────────────────────────────────

const MAX_TOKENS = 65536
const SAFE_MARGIN = 0.15
const RECENT_KEEP = 8

const summaries: SummarizedChunk[] = []

export function getCompressionStrategy(
  _systemPromptLength: number,
  _messagesCount: number,
  estimatedTokens: number
): 'none' | 'light' | 'medium' | 'heavy' {
  const threshold = MAX_TOKENS * (1 - SAFE_MARGIN)
  const ratio = estimatedTokens / threshold

  if (ratio < 0.7) return 'none'
  if (ratio < 0.85) return 'light'
  if (ratio < 0.95) return 'medium'
  return 'heavy'
}

export function compressMessages(
  messages: Array<{ role: string; content: string; [k: string]: any }>
): {
  compressed: Array<{ role: string; content: string; [k: string]: any }>
  stats: ContextStats
  summary_text: string
} {
  const strategy = getCompressionStrategy(0, messages.length, estimateMessagesTokens(messages))

  if (strategy === 'none') {
    return {
      compressed: messages,
      stats: {
        total_tokens: estimateMessagesTokens(messages), system_tokens: 0,
        messages_tokens: estimateMessagesTokens(messages), tool_results_tokens: 0,
        message_count: messages.length, compressed: false, summary_count: summaries.length,
      },
      summary_text: '',
    }
  }

  if (strategy === 'light') {
    const compressed = messages.map(m => {
      if (m.role === 'tool' && m.content && m.content.length > 2000) {
        return { ...m, content: m.content.slice(0, 2000) + '\n...(截断)' }
      }
      return m
    })
    return {
      compressed,
      stats: {
        total_tokens: estimateMessagesTokens(compressed), system_tokens: 0,
        messages_tokens: estimateMessagesTokens(compressed), tool_results_tokens: 0,
        message_count: compressed.length, compressed: true, summary_count: summaries.length,
      },
      summary_text: '',
    }
  }

  const keepCount = strategy === 'medium' ? Math.floor(messages.length * 0.5) : RECENT_KEEP
  const earlyMessages = messages.slice(0, messages.length - keepCount)
  const recentMessages = messages.slice(messages.length - keepCount)

  const summary = generateRollingSummary(earlyMessages)
  const summaryMsg = `[会话摘要] ${summary}`

  const compressed = [
    { role: 'system' as const, content: summaryMsg },
    ...recentMessages,
  ]

  return {
    compressed,
    stats: {
      total_tokens: estimateMessagesTokens(compressed) + estimateTokens(summaryMsg),
      system_tokens: estimateTokens(summaryMsg),
      messages_tokens: estimateMessagesTokens(recentMessages), tool_results_tokens: 0,
      message_count: compressed.length, compressed: true, summary_count: summaries.length,
    },
    summary_text: summary,
  }
}

function generateRollingSummary(messages: Array<{ role: string; content: string }>): string {
  const userMessages = messages.filter(m => m.role === 'user')
  const assistantHeadlines = messages
    .filter(m => m.role === 'assistant' && m.content)
    .map(m => (m.content || '').slice(0, 100).replace(/\n/g, ' '))

  const parts: string[] = []
  const intents = userMessages.map(m => m.content?.slice(0, 80) || '').filter(Boolean)
  if (intents.length > 0) {
    parts.push(`用户完成了 ${userMessages.length} 次交互，涉及：${intents.slice(0, 5).join('；')}${intents.length > 5 ? ' 等' : ''}`)
  }
  const toolCount = messages.filter(m => m.role === 'tool').length
  if (toolCount > 0) parts.push(`期间执行了 ${toolCount} 次工具调用`)
  if (assistantHeadlines.length > 0) {
    parts.push(`关键输出：${assistantHeadlines.slice(0, 3).join(' | ')}`)
  }
  return parts.join('。') + '。'
}

// ─── Token 监控 ────────────────────────────────────────
export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  timestamp: number
}

const usageHistory: TokenUsage[] = []

export function recordUsage(usage: TokenUsage) {
  usageHistory.push(usage)
  if (usageHistory.length > 100) usageHistory.shift()
}

export function getUsageStats() {
  const total = usageHistory.reduce((s, u) => s + u.total_tokens, 0)
  return {
    total,
    avg_per_request: usageHistory.length ? Math.round(total / usageHistory.length) : 0,
    last_request: usageHistory[usageHistory.length - 1] || null,
    history: [...usageHistory],
  }
}

export function isMessageTooLarge(content: string): boolean {
  return estimateTokens(content) > MAX_TOKENS * 0.5
}

export function getMaxTokens(): number { return MAX_TOKENS }
export function getSafeMaxTokens(): number { return Math.floor(MAX_TOKENS * (1 - SAFE_MARGIN)) }
