// electron/engine/llm-core.ts — LLM 直连内核(独立内核用)
// 从 ipc/llm.ts 抽出的回调式流式实现: IPC 层和 AgentEngine 共用同一套请求逻辑,
// 引擎不再经渲染层中转 LLM 流。

import type { EngineUsage } from './types'

export interface LlmMsg {
  role: string
  content?: string | null | Array<{ type?: string; text?: string; image_url?: { url: string } }>
  tool_call_id?: string
  tool_calls?: { id?: string; type: string; function: { name: string; arguments: string } }[]
  reasoning_content?: string
}

export interface LlmChatParams {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  messages: LlmMsg[]
  temperature?: number
  tools?: unknown[]
  headers?: string
  requestId?: string
  customHeaders?: string
  sid?: string
  max_tokens?: number
  thinkLevel?: string
}

export interface LlmStreamHandlers {
  onChunk: (d: { content: string; reasoning?: string; done: boolean; requestId?: string; finishReason?: string }) => void
  onToolCall: (tc: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string }; requestId?: string }) => void
  onUsage: (u: Record<string, unknown> & { requestId?: string }) => void
  onError: (e: unknown) => void
}

const activeRequests = new Map<string, { ctrl: AbortController; sid?: string }>()

// ─── 推理强度 → API 原生参数（对照主流实现的 wire 形态）──────────
// off = 关闭思考；quick/medium/deep/extreme/ultra 分别映射 low/medium/high/xhigh/max。
// DeepSeek 用 thinking 开关；OpenRouter/Nous 用 reasoning{enabled,effort}（透传扩展档位）；
// OpenAI 官方用 reasoning_effort（xhigh/max 收敛为 high）；其余 OpenAI 兼容服务不硬塞原生参数，
// 由提示词中的思考要求兜底，避免不认识的字段导致 400。
const EFFORT_BY_LEVEL: Record<string, string> = {
  quick: 'low', medium: 'medium', deep: 'high', extreme: 'xhigh', ultra: 'max',
}

export function buildReasoningParams(provider: string, baseUrl: string | undefined, model: string, thinkLevel: string | undefined): Record<string, unknown> {
  const level = String(thinkLevel || 'medium')
  const base = (baseUrl || '').toLowerCase()
  const p = String(provider || '').toLowerCase()
  const isDeepseek = p === 'deepseek' || base.includes('deepseek')
  const isOpenRouter = base.includes('openrouter') || base.includes('nousresearch')
  const isOpenAI = p === 'openai' || base.includes('api.openai.com')
  const isXai = base.includes('x.ai') || base.includes('grok')
  const isLmStudio = base.includes('lmstudio') || base.includes('127.0.0.1:1234')
  // 原生 thinking 开关兼容的网关（OpenAI 兼容协议）
  const isThinkingGateway = isDeepseek
    || base.includes('moonshot')           // Kimi / Moonshot
    || base.includes('bigmodel')           // 智谱
    || base.includes('volces')             // 火山方舟 / 豆包
    || base.includes('siliconflow')        // SiliconFlow
  if (level === 'off') {
    if (isThinkingGateway) return { thinking: { type: 'disabled' } }
    if (isOpenRouter) return { reasoning: { enabled: false } }
    return {}
  }
  const effort = EFFORT_BY_LEVEL[level] || 'medium'
  if (isThinkingGateway) return { thinking: { type: 'enabled' } }
  if (isOpenRouter) return { reasoning: { enabled: true, effort } }
  if (isOpenAI && /(gpt-5|o[1-9]|o[0-9]|reasoning)/i.test(model)) {
    const safe = ['low', 'medium', 'high'].includes(effort) ? effort : 'high'
    return { reasoning_effort: safe }
  }
  if (isXai || isLmStudio) {
    const safe = ['low', 'medium', 'high'].includes(effort) ? effort : 'high'
    return { reasoning_effort: safe }
  }
  return {}
}

// 缓存统计统一归一化 —— 各家官方 usage 字段口径:
//   DeepSeek / SiliconFlow : prompt_cache_hit_tokens / prompt_cache_miss_tokens
//   OpenAI / 智谱 / 通义 / 火山方舟 / Gemini(OpenAI 兼容): prompt_tokens_details.cached_tokens
//   Kimi / Moonshot        : usage.cached_tokens(顶层)
//   Anthropic 原生          : cache_read_input_tokens / cache_creation_input_tokens(input_tokens 不含缓存读写)
//   Gemini 原生             : usageMetadata.cachedContentTokenCount / promptTokenCount
export interface NormalizedUsage {
  readT: number   // 缓存命中读取
  missT: number   // 缓存未命中(含 Anthropic 的 cache_creation 写入部分)
  writeT: number  // 缓存写入(Anthropic cache_creation)
  inputT: number  // 输入总用量(缓存读取 + 未命中), 用于命中率分母
  rawInputT: number // 供应商原始输入计数(prompt_tokens 等), 用于上下文占用
  outputT: number
}

function firstNum(...vals: unknown[]): number {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

export function normalizeUsage(u: EngineUsage | Record<string, unknown>): NormalizedUsage {
  const details = (u.prompt_tokens_details || {}) as Record<string, unknown>
  const meta = (u.usageMetadata || {}) as Record<string, unknown>
  const inputDetails = (u.input_tokens_details || {}) as Record<string, unknown>
  const readT = firstNum(
    u.prompt_cache_hit_tokens,
    details.cached_tokens,
    u.cached_tokens,
    u.cache_read_input_tokens,
    details.cache_read_input_tokens,
    inputDetails.cached_tokens,
    meta.cachedContentTokenCount,
  )
  const writeT = firstNum(u.cache_creation_input_tokens, details.cache_creation_input_tokens)
  const rawInputT = firstNum(u.prompt_tokens, meta.promptTokenCount, u.input_tokens)
  let missT = firstNum(u.prompt_cache_miss_tokens)
  // Anthropic 原生: input_tokens 只含未命中且未写入缓存的部分, cache_creation 也按未命中输入计费
  const isAnthropicShape = u.input_tokens !== undefined
    && (u.cache_read_input_tokens !== undefined || u.cache_creation_input_tokens !== undefined)
  if (isAnthropicShape) {
    missT = (firstNum(u.input_tokens) || 0) + writeT
  } else if (missT <= 0 && rawInputT > 0 && readT > 0) {
    missT = Math.max(0, rawInputT - readT)
  }
  // 输入总用量(缓存读取 + 未命中); Anthropic 需要三段相加, 其余优先用供应商原始总输入
  let inputT = rawInputT
  if (isAnthropicShape || rawInputT <= 0) inputT = readT + missT
  const outputT = firstNum(u.completion_tokens, meta.candidatesTokenCount, u.output_tokens)
  return { readT, missT, writeT, inputT, rawInputT, outputT }
}

// v0.3.3: 流式超时 —— 供应商连接挂起不发数据时任务会永远“执行中”
export const LLM_STALL_MS = 45000
export const LLM_OVERALL_MS = 240000

export function stallExceeded(lastDataAt: number, now: number, stallMs = LLM_STALL_MS): boolean {
  return now - lastDataAt >= stallMs
}

export function abortLLM(id?: string): void {
  if (!id) {
    for (const [, rec] of activeRequests) { try { rec.ctrl.abort() } catch { /* 忽略 */ } }
    activeRequests.clear()
    return
  }
  if (activeRequests.has(id)) {
    try { activeRequests.get(id)!.ctrl.abort() } catch { /* 忽略 */ }
    activeRequests.delete(id)
    return
  }
  for (const [rid, rec] of activeRequests) {
    if (rec.sid === id) { try { rec.ctrl.abort() } catch { /* 忽略 */ } activeRequests.delete(rid) }
  }
}

function buildUrl(provider: string, baseUrl?: string): string {
  switch (provider) {
    case 'openai': return (baseUrl || 'https://api.openai.com') + '/v1/chat/completions'
    case 'deepseek': return (baseUrl || 'https://api.deepseek.com') + '/v1/chat/completions'
    case 'OpenAI Compatible':
    case 'custom': {
      const base = (baseUrl || '').replace(/\/+$/, '')
      return /\/v\d+$/i.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions'
    }
    default: throw new Error('不支持的 Provider: ' + provider + '（请在设置中将类型改为 OpenAI Compatible）')
  }
}

function buildHeaders(apiKey?: string, customHeaders?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (apiKey || '') }
  if (customHeaders) {
    try { Object.assign(h, JSON.parse(customHeaders)) } catch {
      customHeaders.split('\n').forEach((line: string) => {
        const idx = line.indexOf('=')
        if (idx > 0) h[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      })
    }
  }
  return h
}

export async function streamChat(netFetch: typeof fetch, params: LlmChatParams, handlers: LlmStreamHandlers): Promise<void> {
  const { provider, model, apiKey, baseUrl, messages, temperature = 0.7, tools, headers: customHeaders, sid, thinkLevel } = params
  const requestId = params.requestId || ('r' + Date.now() + '_' + Math.random().toString(36).slice(2, 8))
  const abortCtrl = new AbortController()
  activeRequests.set(requestId, { ctrl: abortCtrl, sid })
  const removeReq = () => { activeRequests.delete(requestId) }
  const sendError = (msg: unknown) => { removeReq(); handlers.onError(msg) }
  let lastDataAt = Date.now()
  let timedOut = false
  const stallTimer = setInterval(() => {
    if (stallExceeded(lastDataAt, Date.now())) {
      timedOut = true
      try { abortCtrl.abort() } catch { /* 忽略 */ }
    }
  }, 5000)
  const overallTimer = setTimeout(() => {
    timedOut = true
    try { abortCtrl.abort() } catch { /* 忽略 */ }
  }, LLM_OVERALL_MS)

  const body: Record<string, unknown> = { model, messages, temperature, stream: true }
  body.stream_options = { include_usage: true }
  if (tools?.length) body.tools = tools
  if (params.max_tokens) body.max_tokens = params.max_tokens
  Object.assign(body, buildReasoningParams(provider, baseUrl, model, thinkLevel))

  try {
    const url = buildUrl(provider, baseUrl)
    const res = await netFetch(url, {
      method: 'POST',
      headers: buildHeaders(apiKey, customHeaders),
      body: JSON.stringify(body),
      signal: abortCtrl.signal,
    })
    if (!res.ok) {
      const e = await res.text().catch(() => '')
      sendError({ requestId, error: 'API ' + res.status + ': ' + e.slice(0, 400) })
      return
    }
    const reader = res.body?.getReader()
    if (!reader) { sendError({ requestId, error: '无流' }); return }
    const dec = new TextDecoder()
    let buf = ''
    let streamEnded = false
    let finishReason: string | undefined
    const tcAccum = new Map<number, { id: string; name: string; args: string }>()

    const flushToolCalls = () => {
      for (const [idx, tc] of tcAccum) {
        handlers.onToolCall({ requestId, index: idx, id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })
      }
      tcAccum.clear()
    }
    const sendDone = () => {
      if (streamEnded) return
      streamEnded = true
      flushToolCalls()
      handlers.onChunk({ requestId, content: '', done: true, finishReason })
      removeReq()
    }

    while (true) {
      let done = false
      let value: Uint8Array | undefined
      try {
        const result = await reader.read()
        done = result.done
        value = result.value
      } catch (readErr: unknown) {
        if (timedOut) { sendError({ requestId, error: '模型响应超时（长时间无数据），已自动断开并重试' }); break }
        if ((readErr as Error)?.name === 'AbortError' || abortCtrl.signal.aborted) { sendDone(); break }
        throw readErr
      }
      if (done) { sendDone(); break }
      lastDataAt = Date.now()
      buf += dec.decode(value, { stream: true })
      const rawLines = buf.split('\n')
      buf = rawLines.pop() || ''
      for (const rawLine of rawLines) {
        const t = rawLine.trim()
        if (!t.startsWith('data: ')) continue
        const d = t.slice(6)
        if (d === '[DONE]') { sendDone(); continue }
        try {
          const p = JSON.parse(d)
          const choice = p.choices?.[0]
          // v0.3.5: 兼容供应商把 usage 放在独立 chunk(DeepSeek 官方流式: 结束前发
          // {"choices":[], "usage":{...}}, 带 finish_reason 的 chunk usage 为 null);
          // 之前只在 finish_reason 分支读 usage, 独立 usage chunk 会被整块丢弃。
          // 重复到达由 engine.recordUsage 按 requestId 去重, 这里直接透传。
          if (p.usage && typeof p.usage === 'object') {
            handlers.onUsage({ requestId, ...(p.usage as Record<string, unknown>) })
          }
          // v0.3.3: 兼容最终 chunk 的 message.tool_calls / message.content ——
          // 部分 OpenAI 兼容网关不把工具调用放在 delta, 而是放在 message 字段整体下发,
          // 只认 delta 会整体丢失工具调用(前面文字被误当最终回复提交)
          const msgTcs = choice?.message?.tool_calls
          if (Array.isArray(msgTcs) && msgTcs.length) {
            for (let i = 0; i < msgTcs.length; i++) {
              const mtc = msgTcs[i]
              handlers.onToolCall({
                requestId,
                index: i,
                id: mtc?.id,
                type: 'function',
                function: { name: mtc?.function?.name, arguments: mtc?.function?.arguments },
              })
            }
            tcAccum.clear() // message 形式已完整, 丢弃 delta 累积避免重复
          }
          const deltaTcs = choice?.delta?.tool_calls
          if (deltaTcs) {
            for (const deltaTc of deltaTcs) {
              const idx = deltaTc.index ?? 0
              if (!tcAccum.has(idx)) tcAccum.set(idx, { id: '', name: '', args: '' })
              const cur = tcAccum.get(idx)!
              if (deltaTc.id) cur.id = deltaTc.id
              if (deltaTc.function?.name) cur.name = deltaTc.function.name
              if (deltaTc.function?.arguments !== undefined) cur.args += deltaTc.function.arguments
            }
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason
            flushToolCalls()
            continue
          }
          const c = choice?.delta?.content || (typeof choice?.message?.content === 'string' ? choice.message.content : '') || ''
          // 兼容多种网关的思考字段形态: reasoning_content / reasoning, 字符串或 {text}/{content} 数组
          const rawR = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? ''
          let r = ''
          if (typeof rawR === 'string') r = rawR
          else if (Array.isArray(rawR)) r = rawR.map((x: unknown) => {
            if (typeof x === 'string') return x
            const o = x as { text?: unknown; content?: unknown }
            return typeof o?.text === 'string' ? o.text : (typeof o?.content === 'string' ? o.content : '')
          }).join('')
          else if (rawR && typeof rawR === 'object') {
            const o = rawR as { text?: unknown; content?: unknown }
            r = typeof o?.text === 'string' ? o.text : (typeof o?.content === 'string' ? o.content : '')
          }
          if (c || r) handlers.onChunk({ requestId, content: c, reasoning: r || undefined, done: false })
        } catch { /* 忽略坏行 */ }
      }
    }
  } catch (err: unknown) {
    removeReq()
    if (!(err instanceof Error && (err.name === 'AbortError' || abortCtrl.signal.aborted))) {
      sendError({ requestId, error: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    clearInterval(stallTimer)
    clearTimeout(overallTimer)
    activeRequests.delete(requestId)
  }
}

export async function chatOnce(netFetch: typeof fetch, params: LlmChatParams, onUsage?: (u: Record<string, unknown>) => void): Promise<string> {
  const { provider, model, apiKey, baseUrl, messages } = params
  try {
    const url = buildUrl(provider, baseUrl)
    const res = await netFetch(url, {
      method: 'POST',
      headers: buildHeaders(apiKey, params.customHeaders),
      body: JSON.stringify({ model, messages, temperature: params.temperature ?? 0.7, max_tokens: 4096 }),
      signal: AbortSignal.timeout(120000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return 'E:' + (data.error?.message || ('HTTP ' + res.status))
    if (onUsage && data.usage) onUsage(data.usage as Record<string, unknown>)
    return data.choices?.[0]?.message?.content || '(empty)'
  } catch (e: unknown) { return 'E:' + (e instanceof Error ? e.message : String(e)) }
}

export async function visionOnce(netFetch: typeof fetch, params: { provider: string; model: string; apiKey?: string; baseUrl?: string; imageDataUrl: string; prompt?: string; customHeaders?: string }): Promise<string> {
  const { provider, model, apiKey, baseUrl, imageDataUrl, prompt } = params
  try {
    const url = buildUrl(provider, baseUrl)
    const body = {
      model,
      max_tokens: 800,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt || '请描述这张图片的内容' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ] }],
    }
    const res = await netFetch(url, {
      method: 'POST',
      headers: buildHeaders(apiKey, params.customHeaders),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
    if (!res.ok) { const e = await res.text().catch(() => ''); return 'E:视觉API ' + res.status + ' ' + e.slice(0, 200) }
    const data = await res.json().catch(() => ({}))
    const text = data.choices?.[0]?.message?.content
    return (typeof text === 'string' && text.trim()) ? text.trim() : 'E:视觉模型返回空'
  } catch (e: unknown) { return 'E:' + (e instanceof Error ? e.message : String(e)) }
}
