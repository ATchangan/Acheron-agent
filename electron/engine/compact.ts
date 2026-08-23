// electron/engine/compact.ts —— 上下文自动摘要压缩（真实用量触发 + LLM 摘要）
// 设计：跟踪每次请求的真实输入 token，接近模型窗口阈值时把最旧的完整轮次
// 交给摘要请求压成一条摘要，替换回消息列表；保留最近 N 轮完整上下文。
import type { EngineMessage } from './types'

export const COMPACT_DEFAULT_RATIO = 0.8
export const COMPACT_DEFAULT_KEEP_ROUNDS = 6
export const COMPACT_COOLDOWN_MS = 60_000
export const COMPACT_SUMMARY_MAX_CHARS = 300
export const COMPACT_PROMPT_MAX_CHARS = 20000
export const COMPACT_SMALL_WINDOW = 524288 // 小窗口模型阈值下限参考线
export const COMPACT_SMALL_FLOOR = 0.75    // 小窗口模型的最低压缩阈值（只抬高不压低）
export const COMPACT_PREFLIGHT_MARGIN = 0.95 // preflight 预压缩余量

// 解析当前模型的实际压缩阈值比例：
// 按模型覆盖（compactOverrides[model]） > 全局百分比（compactThreshold）
// 小窗口模型（< 512K）阈值不低于 0.75（用户显式覆盖除外）
export function resolveCompactRatio(model: string, overrides: Record<string, number> | undefined, globalRatio: number | undefined, overrideRatio?: number): number {
  const ov = overrides?.[model]
  let ratio = typeof ov === 'number' && ov > 0 ? ov : (globalRatio && globalRatio > 0 ? globalRatio : COMPACT_DEFAULT_RATIO)
  if (overrideRatio && overrideRatio > 0) ratio = overrideRatio
  return ratio
}

// 多次压缩代价提示：压缩次数越多，长程准确率受影响越大，建议适时开新对话
export function buildCompactNotice(compactCount: number): string {
  if (compactCount <= 1) return ''
  if (compactCount === 2) return '\n\n[提示] 历史已多次自动压缩，长程信息可能略有损失，建议适时开启新对话。'
  return '\n\n[提示] 本会话已多次自动压缩，继续累积可能影响长程准确率，建议开启新对话或清理早期历史。'
}

// 选出待压缩的旧轮次：从最早消息到“最近 keepRounds 个用户交互”之前为止。
// 保留段以 user 消息开头，避免 assistant(tool_calls) / tool 配对被拆散。
export function pickCompactCandidates(msgs: EngineMessage[], keepRounds: number): EngineMessage[] {
  if (!msgs.length || keepRounds < 1) return []
  let keepFrom = 0
  let users = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      users++
      if (users >= keepRounds) { keepFrom = i; break }
    }
  }
  if (keepFrom <= 1) return []
  // 向前兜底到 user 边界（保留段以 user 开头，保证消息配对合法）
  let start = keepFrom
  while (start > 0 && msgs[start].role !== 'user') start--
  return start <= 1 ? [] : msgs.slice(0, start)
}

// 构造摘要请求（系统 + 候选历史文本）
export function buildCompactPrompt(cands: EngineMessage[]): { system: string; user: string } {
  const text = cands.map((m) => {
    if (m.role === 'user') return '用户: ' + String(m.content || '').slice(0, 300)
    if (m.role === 'assistant') {
      const tools = m.tool_calls?.length ? ' [调用工具: ' + m.tool_calls.map((t) => t.function.name).join(', ') + ']' : ''
      return '助手: ' + String(m.content || '').slice(0, 200) + tools
    }
    if (m.role === 'tool') return '工具结果: ' + String(m.content || '').slice(0, 300)
    return ''
  }).filter(Boolean).join('\n')
  return {
    system: '你是Acheron-Agent。请把下面的对话历史压缩成 ' + COMPACT_SUMMARY_MAX_CHARS + ' 字以内的要点摘要：保留关键事实、文件路径、命令、结论、待办和约束。只输出摘要。',
    user: text.slice(0, COMPACT_PROMPT_MAX_CHARS),
  }
}

// 摘要替换：新列表 = [摘要消息, ...最近保留的完整轮次]
export function applyCompact(msgs: EngineMessage[], summary: string, keepRounds: number): EngineMessage[] {
  const cands = pickCompactCandidates(msgs, keepRounds)
  if (!cands.length) return msgs
  const keep = msgs.slice(cands.length)
  const head: EngineMessage = {
    id: 'compact-' + Date.now().toString(36),
    role: 'assistant',
    content: '[历史摘要]\n' + summary.trim(),
    timestamp: Date.now(),
  }
  return [head, ...keep]
}

// v0.3.9: 批量微压缩候选 —— 从最旧消息开始收集最多 maxPairs 组「用户→助手(无工具调用)」完整问答,
// 一次性交给 LLM 摘要, 替代旧的"每组一次请求"
export function pickMicroFoldCandidates(msgs: EngineMessage[], maxPairs = 3): { start: number; end: number; pairs: { user: string; assistant: string }[] } | null {
  const pairs: { user: string; assistant: string }[] = []
  let start = -1
  let lastUserIdx = -1
  for (let k = msgs.length - 1; k >= 0; k--) {
    if (msgs[k].role === 'user') { lastUserIdx = k; break }
  }
  let i = 0
  while (i < msgs.length - 1 && pairs.length < maxPairs) {
    if (lastUserIdx >= 0 && i >= lastUserIdx) break
    if (msgs[i].role !== 'user') { i++; continue }
    const a = msgs[i + 1]
    if (!a || a.role !== 'assistant' || a.tool_calls?.length || !a.content) { i++; continue }
    if (msgs[i + 2] && msgs[i + 2].role === 'tool') { i++; continue }
    if (start < 0) start = i
    pairs.push({ user: String(msgs[i].content || '').slice(0, 1200), assistant: String(a.content).slice(0, 1600) })
    i += 2
  }
  if (!pairs.length || start < 0) return null
  return { start, end: start + pairs.length * 2, pairs }
}
