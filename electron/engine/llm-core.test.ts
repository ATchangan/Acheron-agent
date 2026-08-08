import { describe, expect, it, vi } from 'vitest'
import { LLM_STALL_MS, stallExceeded, streamChat, normalizeUsage } from './llm-core'

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

  it('DeepSeek 官方流式: usage 在独立的空 choices chunk 中也能收到', async () => {
    const c = collect()
    await streamChat(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"hi"},"index":0}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":100,"total_tokens":1100,"prompt_cache_hit_tokens":800,"prompt_cache_miss_tokens":200}}\n\n',
      'data: [DONE]\n\n',
    ]), PARAMS, c.handlers)

    expect(c.errors).toEqual([])
    expect(c.usages).toHaveLength(1)
    expect(c.usages[0]).toMatchObject({
      prompt_tokens: 1000,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    })
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

describe('normalizeUsage 多供应商缓存字段归一化', () => {
  it('DeepSeek: prompt_cache_hit_tokens + prompt_cache_miss_tokens', () => {
    const n = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    })
    expect(n).toMatchObject({ readT: 800, missT: 200, writeT: 0, inputT: 1000, outputT: 100 })
  })

  it('OpenAI: prompt_tokens_details.cached_tokens, miss 由总量推导', () => {
    const n = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 800 },
    })
    expect(n).toMatchObject({ readT: 800, missT: 200, inputT: 1000, outputT: 100 })
  })

  it('Kimi/Moonshot: 顶层 usage.cached_tokens', () => {
    const n = normalizeUsage({ prompt_tokens: 1000, cached_tokens: 800, completion_tokens: 100 })
    expect(n).toMatchObject({ readT: 800, missT: 200, inputT: 1000 })
  })

  it('Anthropic 原生: input_tokens 不含缓存读写, 未命中与写入分开统计', () => {
    const n = normalizeUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 100,
    })
    expect(n).toMatchObject({ readT: 800, missT: 100, writeT: 100, inputT: 1000, outputT: 50 })
  })

  it('Anthropic SDK 形态: cache_control ephemeral 计费块合并计入缓存写入', () => {
    const n = normalizeUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 800,
      cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 40 },
    })
    expect(n).toMatchObject({ readT: 800, missT: 100, writeT: 100, inputT: 1000, outputT: 50, sawCache: true })
  })

  it('Gemini 原生: usageMetadata.cachedContentTokenCount', () => {
    const n = normalizeUsage({
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, cachedContentTokenCount: 700 },
    })
    expect(n).toMatchObject({ readT: 700, missT: 300, inputT: 1000, outputT: 50 })
  })

  it('SiliconFlow: 未命中时 cached_tokens 为 0 不影响 miss 统计', () => {
    const n = normalizeUsage({
      prompt_tokens: 15,
      prompt_tokens_details: { cached_tokens: 0 },
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 15,
    })
    expect(n).toMatchObject({ readT: 0, missT: 15, inputT: 15 })
  })

  it('通义百炼: prompt_tokens_details.cache_creation_input_tokens 计入缓存写入', () => {
    const n = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 700, cache_creation_input_tokens: 200 },
    })
    expect(n).toMatchObject({ readT: 700, missT: 300, writeT: 200, inputT: 1000 })
  })

  it('OpenRouter: prompt_tokens_details.cache_write_tokens 计入缓存写入', () => {
    const n = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 700, cache_write_tokens: 200 },
    })
    expect(n).toMatchObject({ readT: 700, missT: 300, writeT: 200, inputT: 1000, sawCache: true })
  })

  it('Mistral: num_cached_tokens 与 prompt_token_details.cached_tokens(单数) 均识别', () => {
    const n = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      num_cached_tokens: 700,
      prompt_token_details: { cached_tokens: 700 },
    })
    expect(n).toMatchObject({ readT: 700, missT: 300, writeT: 0, inputT: 1000, sawCache: true })
  })

  it('OpenAI 首次请求 cached_tokens=0 时 miss = 全部输入(不再漏计)', () => {
    const n = normalizeUsage({
      prompt_tokens: 15,
      prompt_tokens_details: { cached_tokens: 0 },
    })
    expect(n).toMatchObject({ readT: 0, missT: 15, inputT: 15, sawCache: true })
  })

  it('无缓存字段时 read 为 0, miss 兜底为全部输入(不支持的供应商由界面标注)', () => {
    const n = normalizeUsage({ prompt_tokens: 100, completion_tokens: 20 })
    expect(n).toMatchObject({ readT: 0, missT: 100, writeT: 0, inputT: 100, outputT: 20, sawCache: false })
  })
})
