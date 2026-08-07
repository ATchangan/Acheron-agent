// src/store/chat-view-utils.ts —— 对话视图纯函数(v0.3.3)

const NEAR_BOTTOM_PX = 160

/** 滚动容器是否已接近底部(回到底部按钮的显示/隐藏判定) */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = NEAR_BOTTOM_PX,
): boolean {
  if (clientHeight <= 0) return true
  return scrollHeight - scrollTop - clientHeight <= threshold
}

/**
 * 取「最后一条完整回复」:
 * - 优先取最后一条 assistant 且有内容且不含 tool_calls 的消息(最终回复)
 * - 没有最终回复时回退到调用方传入的流式文字(streamText)
 * - 仍为空则回退到最后一条 assistant 文本(步骤说明), 保证复制按钮有内容可复制
 */
export function latestAssistantText(
  msgs: readonly { role?: string; content?: string | null; tool_calls?: unknown[] | null }[],
  fallback = '',
): string {
  let lastAny = ''
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== 'assistant') continue
    const c = String(m.content || '').trim()
    if (!c) continue
    if (!m.tool_calls || m.tool_calls.length === 0) return c
    if (!lastAny) lastAny = c
  }
  const fb = fallback.trim()
  return fb || lastAny
}

/**
 * 流式 Markdown 增量切分(v0.3.3 性能优化):
 * 稳定前缀(到最后一个块边界为止)只解析一次, 尾部实时渲染。
 * - 优先按最后一个空行(段落边界)切, 无空行时按最后一个换行切
 * - 若稳定部分出现未闭合代码围栏(``` 数量为奇数), 把围栏起点并入尾部,
 *   避免前缀被解析成吞掉后续内容的大代码块
 */
export function splitStreamMarkdown(text: string): { stable: string; tail: string } {
  const t = String(text || '')
  if (!t) return { stable: '', tail: '' }
  let idx = t.lastIndexOf('\n\n')
  if (idx < 0) idx = t.lastIndexOf('\n')
  if (idx < 0) return { stable: '', tail: t }
  let stable = t.slice(0, idx)
  let tail = t.slice(idx)
  const fences = stable.match(/^```/gm)
  if (fences && fences.length % 2 === 1) {
    const openIdx = stable.lastIndexOf('```')
    const lineStart = stable.lastIndexOf('\n', openIdx - 1) + 1
    stable = stable.slice(0, lineStart)
    tail = t.slice(lineStart)
  }
  return { stable, tail }
}
