import { describe, expect, it, vi } from 'vitest'
import { LLM_STALL_MS, stallExceeded, streamChat } from './llm-core'

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function collect() {
  const chunks: { content: string; done: boolean; finishReason?: string }[] = []
  const tools: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string }; requestId?: string }[] = []
  const usages: Record<string, unknown>[] = []
  const errors: unknown[] = []
  return {
    chunks, tools, usages, errors,
    handlers: {
      onChunk: (d: { content: string; done: boolean; finishReason?: string }) => chunks.push(d),
      onToolCall: (tc: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string }; requestId?: string }) => tools.push(tc),
      onUsage: (u: Record<string, unknown>) => usages.push(u),
      onError: (e: unknown) => errors.push(e),
    },
  }
}

const PARAMS = {
  provider: 'custom',
  model: 'test-model',
  apiKey: 'k',
  baseUrl: 'https://example.com',
  messages: [{ role: 'user' as const, content: 'hi' }],
}

describe('streamChat 工具调用解析', () => {
  it('兼容最终 chunk 的 message.tool_calls（OpenAI 兼容网关形式）', async () => {
    const c = collect()
    await streamChat(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Node 环境就绪。写俄罗斯方块完整实现："},"index":0}]}\n\n',
      'data: {"choices":[{"message":{"content":"","tool_calls":[{"id":"call_1","type":"function","function":{"name":"write","arguments":"{\\"path\\":\\"a.js\\",\\"content\\":\\"code\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":800,"total_tokens":801}}\n\n',
      'data: [DONE]\n\n',
    ]), PARAMS, c.handlers)

    expect(c.errors).toEqual([])
    expect(c.chunks[0].content).toContain('Node 环境就绪')
    expect(c.tools).toHaveLength(1)
    expect(c.tools[0].function?.name).toBe('write')
    expect(c.tools[0].id).toBe('call_1')
    expect(c.tools[0].function?.arguments).toContain('"path"')
    expect(c.chunks[c.chunks.length - 1]).toMatchObject({ done: true, finishReason: 'tool_calls' })
    expect(c.usages[0]?.completion_tokens).toBe(800)
  })

  it('标准 delta.tool_calls 仍然生效', async () => {
    const c = collect()
    await streamChat(async () => sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"ls","arguments":"{\\"dirPath\\":\\"C:/work\\"}"}}]},"finish_reason":"tool_calls","index":0}],"usage":{"total_tokens":9}}\n\n',
      'data: [DONE]\n\n',
    ]), PARAMS, c.handlers)

    expect(c.errors).toEqual([])
    expect(c.tools).toHaveLength(1)
    expect(c.tools[0].function?.name).toBe('ls')
    expect(c.tools[0].function?.arguments).toContain('dirPath')
  })

  it('普通文字回复透传 finish_reason', async () => {
    const c = collect()
    await streamChat(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"你好"},"index":0}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]), PARAMS, c.handlers)

    expect(c.errors).toEqual([])
    expect(c.chunks[c.chunks.length - 1]).toMatchObject({ done: true, finishReason: 'stop' })
  })
})

describe('流式超时', () => {
  it('stallExceeded 纯函数判定无数据时长', () => {
    expect(stallExceeded(1000, 1000 + LLM_STALL_MS - 1, LLM_STALL_MS)).toBe(false)
    expect(stallExceeded(1000, 1000 + LLM_STALL_MS, LLM_STALL_MS)).toBe(true)
  })

  it('供应商挂起不发数据 → 自动断开并报超时错误', async () => {
    vi.useFakeTimers()
    try {
      const c = collect()
      const encoder = new TextEncoder()
      let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
      let sig: AbortSignal | null = null
      const fakeFetch = (_url: string, opts: { signal?: AbortSignal }) => {
        sig = opts.signal || null
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            ctrl = controller
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"前缀"},"index":0}]}\n\n'))
            // 故意不 close: 模拟供应商连接挂起; abort 时中断 read
            sig?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
          },
        }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      const p = streamChat(fakeFetch as unknown as typeof fetch, PARAMS, c.handlers)
      await vi.advanceTimersByTimeAsync(LLM_STALL_MS + 10000)
      await p
      expect(ctrl).not.toBeNull()
      expect(c.errors).toHaveLength(1)
      expect(String((c.errors[0] as { error?: string })?.error || c.errors[0])).toContain('响应超时')
    } finally {
      vi.useRealTimers()
    }
  }, 15000)
})
