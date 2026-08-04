// electron/ipc/llm.ts —— LLM 域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'

interface LLMMsg {
  role: string
  content?: string | null | Array<{ type?: string; text?: string; image_url?: { url: string } }>
  tool_call_id?: string
  tool_calls?: { id?: string; type: string; function: { name: string; arguments: string } }[]
  reasoning_content?: string
}
interface LLMChatParams {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  messages: LLMMsg[]
  temperature?: number
  tools?: unknown[]
  headers?: string
  requestId?: string
  customHeaders?: string
  sid?: string
}
interface VisionParams {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  imageDataUrl: string
  prompt?: string
}

// 使用 AbortController 替代全局标志位，支持并发请求
const activeRequests = new Map<string, { ctrl: AbortController; sid?: string }>()

export function registerLlmIpc(deps: {
  netFetch: typeof fetch
}): void {
  const { netFetch } = deps

ipcMain.handle('llm:abort', (_e, id?: string) => {
  if (!id) {
    for (const [rid, rec] of activeRequests) { try { rec.ctrl.abort() } catch (e) { /* ok */ console.debug('[swallow]', e) } }
    activeRequests.clear()
    return
  }
  if (activeRequests.has(id)) {
    const rec = activeRequests.get(id)!
    try { rec.ctrl.abort() } catch (e) { /* ok */ console.debug('[swallow]', e) }
    activeRequests.delete(id)
    return
  }
  // 会话级中止(该 sid 的全部请求)
  for (const [rid, rec] of activeRequests) {
    if (rec.sid === id) { try { rec.ctrl.abort() } catch (e) { /* ok */ console.debug('[swallow]', e) } activeRequests.delete(rid) }
  }
})

ipcMain.handle('llm:chat', async (event, params: LLMChatParams) => {
  // 多会话并发 —— requestId 由调用方传入，用于把流式事件路由回对应会话
  const { provider, model, apiKey, baseUrl, messages, temperature = 0.7, tools, headers: customHeaders, sid } = params
  const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }
  // 合并自定义 Headers（JSON 或 key=value 多行格式）
  if (customHeaders) {
    try { const extra = JSON.parse(customHeaders); Object.assign(reqHeaders, extra) } catch {
      customHeaders.split('\n').forEach((line: string) => { const idx = line.indexOf('='); if (idx > 0) reqHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim() })
    }
  }
  const body: Record<string, unknown> = { model, messages, temperature, stream: true }
  // 官方要求 include_usage 才保证流式返回完整 usage(prompt_cache_hit/miss_tokens), 否则缓存统计缺失
  body.stream_options = { include_usage: true }
  // 打印首个 assistant(tool_calls) 完整结构(排查 reasoning_content 400)
  if ((messages || []).some((m: LLMMsg) => m.role === 'assistant' && m.tool_calls)) {
    const atc = (messages as LLMMsg[]).find((m: LLMMsg) => m.role === 'assistant' && m.tool_calls)
    const toolMsgs = (messages as { role: string }[]).filter((m: { role: string }) => m.role === 'tool').length
    console.log('[LLM] ATC:', JSON.stringify({ keys: atc ? Object.keys(atc) : [], content: atc?.content, rc: atc?.reasoning_content, tcId: (atc?.tool_calls as { id?: string }[] | undefined)?.[0]?.id, tools: toolMsgs }))
  }
  // 打印消息 role 序列(排查 tool 消息格式问题)
  if ((messages || []).length > 20) console.log('[LLM] roles:', (messages as { role: string }[]).map((m: { role: string }) => m.role).join(','), '| tc:', (messages as { tool_calls?: unknown }[]).filter((m: { tool_calls?: unknown }) => m.tool_calls).length)
  if (tools?.length) { body.tools = tools }

  let url: string
  // 兼容设置界面保存的显示名类型（OpenAI Compatible 等），修复非 DeepSeek provider 全部报"不支持的 Provider"
  switch (provider) {
    case 'openai': url = (baseUrl || 'https://api.openai.com') + '/v1/chat/completions'; break
    case 'deepseek': url = (baseUrl || 'https://api.deepseek.com') + '/v1/chat/completions'; break
    case 'OpenAI Compatible':
    case 'custom': {
      let base = (baseUrl || '').replace(/\/+$/, '')
      // baseUrl 可能含 /v1（如 https://api.openai.com/v1）也可能不含（如 https://api.deepseek.com）
      url = /\/v\d+$/i.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions'
      break
    }
    default: event.sender.send('llm:error', '不支持的 Provider: ' + provider + '（请在设置中将类型改为 OpenAI Compatible）'); return
  }

  const requestId = params.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const abortCtrl = new AbortController()
  activeRequests.set(requestId, { ctrl: abortCtrl, sid: params.sid })
  // 请求结束后自动从活跃表移除（防止泄漏 + 精确中止）
  const removeReq = () => { activeRequests.delete(requestId); event.sender.removeListener('destroyed', removeReq) }
  event.sender.once('destroyed', removeReq)
  // 请求结束(成功/失败)立即清理 listener, 防止 WebContents 监听器累积(修复 MaxListenersExceededWarning)
  const doneClean = () => { removeReq(); event.sender.removeListener('destroyed', removeReq) }

  try {
    console.log('[LLM]', provider, model, url, 'msgs:', messages?.length, 'tools:', tools?.length || 0)
    const res = await netFetch(url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(body),
      signal: abortCtrl.signal,
    })
    if (!res.ok) { const e = await res.text().catch(() => ''); console.error('[LLM] FAIL', res.status, e.slice(0, 400)); doneClean(); console.error('[LLM] FAIL-MSGS:', JSON.stringify((messages || []).slice(0, 6).map((m: LLMMsg) => ({ role: m.role, tc: Array.isArray(m.tool_calls) ? m.tool_calls.length : 0, tcid: m.tool_call_id || null, c: typeof m.content === 'string' ? m.content.slice(0, 60) : null })))); event.sender.send('llm:error', { requestId, error: `API ${res.status}: ${e.slice(0, 400)}` }); return }
    console.log('[LLM] stream ok'); doneClean()
    const reader = res.body?.getReader(); if (!reader) { event.sender.send('llm:error', { requestId, error: '无流' }); return }

    const dec = new TextDecoder(); let buf = ''
    let streamEnded = false // 防止重复发送 done
    // 累积工具调用参数 — 支持多工具调用
    const tcAccum: Map<number, { id: string; name: string; args: string }> = new Map()

    const flushToolCalls = () => {
      for (const [idx, tc] of tcAccum) {
        event.sender.send('llm:toolCall', { requestId, index: idx, id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })
      }
      tcAccum.clear()
    }

    const sendDone = () => {
      if (streamEnded) return
      streamEnded = true
      flushToolCalls()
      event.sender.send('llm:chunk', { requestId, content: '', done: true })
      removeReq()
    }

    while (true) {
      let done = false, value: Uint8Array | undefined
      try {
        const result = await reader.read()
        done = result.done; value = result.value
      } catch (readErr: unknown) {
        // reader 被 abort 取消时会抛出，视为正常结束
        if ((readErr as Error)?.name === 'AbortError' || abortCtrl.signal.aborted) { sendDone(); break }
        throw readErr
      }
      if (done) { sendDone(); break }
      buf += dec.decode(value!, { stream: true })
      // 修复: 使用正确的 SSE 行解析 — 先 split，保留不完整行在 buf 中
      const rawLines = buf.split('\n')
      buf = rawLines.pop() || ''
      for (const rawLine of rawLines) {
        const t = rawLine.trim(); if (!t.startsWith('data: ')) continue
        const d = t.slice(6); if (d === '[DONE]') { sendDone(); continue }
        try {
          const p = JSON.parse(d), choice = p.choices?.[0]
          // 累积工具调用参数片段 — 支持多工具调用
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
            // 仅刷新 tool calls + usage，done 由 sendDone() 统一处理（外层 done 或 [DONE] 触发）
            flushToolCalls()
            if (p.usage) event.sender.send('llm:usage', { requestId, ...p.usage })
            continue
          }
          const c = choice?.delta?.content || ''
          if (c) event.sender.send('llm:chunk', { requestId, content: c, done: false })
        } catch (e) { /* ignore malformed JSON lines */ console.debug('[swallow]', e) }
      }
    }
  } catch (err: unknown) {
    removeReq()
    if (err instanceof Error && (err.name === 'AbortError' || abortCtrl.signal.aborted)) {
      // 用户主动取消，不报错
    } else {
      event.sender.send('llm:error', { requestId, error: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    // 确保 reader 被释放
    activeRequests.delete(requestId)
  }
})

// 非流式单次 LLM 调用 —— 多 Agent 分发时子 Agent 独立执行
ipcMain.handle('llm:chatOnce', async (_e, params: LLMChatParams) => {
  const { provider, model, apiKey, baseUrl, messages } = params
  try {
    let base = (baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')
    const url = base.endsWith('/v1') ? base + '/chat/completions' : base + '/v1/chat/completions'
    const res = await netFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 4096 }),
      signal: AbortSignal.timeout(120000),
    })
    const data = await res.json()
    if (!res.ok) return 'E:' + (data.error?.message || ('HTTP ' + res.status))
    return data.choices?.[0]?.message?.content || '(empty)'
  } catch (e: unknown) { return 'E:' + ((e instanceof Error ? e.message : String(e)) || String(e)) }
})

// 视觉辅助模型 —— 主模型不支持多模态时，用此接口分析图片（非流式一次性调用）
ipcMain.handle('llm:vision', async (_e, params: VisionParams) => {
  const { provider, model, apiKey, baseUrl, imageDataUrl, prompt } = params
  try {
    let base = (baseUrl || '').replace(/\/+$/, '')
    const url = /\/v\d+$/i.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions'
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
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
    if (!res.ok) { const e = await res.text().catch(() => ''); return 'E:视觉API ' + res.status + ' ' + e.slice(0, 200) }
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content
    return (typeof text === 'string' && text.trim()) ? text.trim() : 'E:视觉模型返回空'
  } catch (e: unknown) { return 'E:' + ((e instanceof Error ? e.message : String(e))) }
})


}
