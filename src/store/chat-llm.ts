// src/store/chat-llm.ts —— LLM 流式调用封装(v0.3.1 补丁 D: 从 chat-send.ts 拆出, 行为零变化)
import type { ProviderConfig, UsageData, ToolCallDelta } from '../global'
import type { GeneralSettings } from '../types'
import { updateContextLimit, buildContextualMessages, isVisionModel } from './context'
import { getActiveTools, costedReqs } from './runtime'
import type { S } from './chat-send'
import type { CallResult, ToolCallItem } from './chat-round'

export interface CallLlmDeps {
  sid: string
  gSnap: GeneralSettings
  get: () => S
  set: (partial: S | Partial<S> | ((state: S) => S | Partial<S>), replace?: boolean) => void
  getModel: () => string
  getCurP: () => ProviderConfig
}

// 单次 LLM 流式调用: 收集文本/工具调用/用量, 返回 Promise
export function createCallLLM(deps: CallLlmDeps): (aid: string, ridArg?: string) => Promise<CallResult> {
  const { sid, gSnap, get, set, getModel, getCurP } = deps
  return (aid: string, ridArg?: string): Promise<CallResult> =>
    new Promise((resolve, reject) => {
      const model = getModel()
      const curP = getCurP()
      const cbs: (() => void)[] = []; let text = ''; const tcs: ToolCallItem[] = []
      // 多会话并发 —— 每次调用独立 requestId，只收自己的流式事件
      const rid = ridArg || ('r' + Date.now() + '_' + Math.random().toString(36).slice(2, 8))
      // 记录 TTFT(首字延迟) / 总时长 / token 用量
      const t0 = Date.now(); let firstChunkAt = 0; let usage: UsageData | null = null
      cbs.push(window.huangquan.llm.onUsage(u => {
        if (u && u.requestId && u.requestId !== rid) return
        if (u) {
          // 用量归一化: 兼容 DeepSeek/OpenAI/Anthropic 缓存字段
          const readT = u.prompt_cache_hit_tokens || u.prompt_tokens_details?.cached_tokens || u.cache_read_input_tokens || 0
          const missT = u.prompt_cache_miss_tokens || 0
          const writeT = u.cache_creation_input_tokens || 0
          const inputT = u.prompt_tokens || u.input_tokens || 0
          usage = { ...u, _readTokens: readT, _inputTokens: inputT, _writeTokens: writeT }
          // 同一次请求的 usage 只统计/累加一次(流式 usage 可能多次到达, 防重复)
          if (!costedReqs.has(rid)) {
            // 防止无限增长(每 500 条裁剪一半)
            if (costedReqs.size > 500) { const arr = [...costedReqs]; costedReqs.clear(); for (const x of arr.slice(-250)) costedReqs.add(x) }
            costedReqs.add(rid)
            const sid2 = get().cid || ''
            // 持久化埋点(主进程, 会话×模型)
            try {
              window.huangquan.modelStats?.recordRequest(sid2, model, readT > 0)
              if (readT > 0 || inputT > 0 || writeT > 0) window.huangquan.modelStats?.recordTokens(sid2, model, readT, inputT, writeT, missT)
            } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
            // 前端镜像(右侧面板实时显示)
            if (sid2) set(s => {
              const ss = s.sessTok[sid2] || {}
              const c2 = ss[model] || { requests: 0, readTokens: 0, inputTokens: 0, writeTokens: 0, hitReqs: 0 }
              return { sessTok: { ...s.sessTok, [sid2]: { ...ss, [model]: { requests: c2.requests + 1, readTokens: c2.readTokens + readT, inputTokens: c2.inputTokens + inputT, writeTokens: c2.writeTokens + writeT, hitReqs: c2.hitReqs + (readT > 0 ? 1 : 0) } } } }
            })
          }
        } else { usage = u }
      }))
      // 流式渲染节流 —— 40ms 内合并多次 chunk 再 set, 避免每个 token 全量重渲染
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const flushText = () => {
        flushTimer = null
        const cur = text
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: cur } : m) } : x), streaming: s.cid === sid ? true : s.streaming }))
      }
      cbs.push(window.huangquan.llm.onChunk(d => {
        if (d.requestId && d.requestId !== rid) return // 其他会话的流，忽略
        if (!firstChunkAt && d.content) firstChunkAt = Date.now()
        text += d.content
        if (!flushTimer) flushTimer = setTimeout(flushText, 40)
        if (d.done) {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: text } : m) } : x), streaming: s.cid === sid ? false : s.streaming }))
          cbs.forEach(f => f())
          const ttft = firstChunkAt ? firstChunkAt - t0 : (Date.now() - t0)
          const duration = Date.now() - t0
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: text, usage: usage || m.usage, meta: { ttft, duration } } : m) } : x) }))
          if (!text && !tcs.length) { reject(new Error('模型返回空响应，请检查 API 配置或切换模型')); return } resolve({ text, tcs })
        }
      }))
      cbs.push(window.huangquan.llm.onError((e: unknown) => {
        const em = e as { error?: string; requestId?: string }
        const errMsg = typeof e === 'string' ? e : (em?.error || String(e))
        if (em && em.requestId && em.requestId !== rid) return // 其他会话的错误，忽略
        cbs.forEach(f => f()); reject(new Error(errMsg))
      }))
      cbs.push(window.huangquan.llm.onToolCall((tc: ToolCallDelta) => { if (tc && tc.requestId && tc.requestId !== rid) return; try { if (tc.function?.name) tcs.push({ id: tc.id || 'c' + Date.now(), name: tc.function.name, args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {} }) } catch { console.warn('[黄泉Agent] 工具参数解析失败:', tc?.function?.name, String(tc?.function?.arguments || '').slice(0, 100)) } }))
      const cur = get().sessions.find(x => x.id === sid)!
      const msgs = buildContextualMessages(cur.messages, isVisionModel(model), { gSnap, cl: get().cl, spIshiki: get().spIshiki, spFallback: get().sp, agent: cur.agent, onAgentRoute: (role) => { if (role) { set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, agent: role as string, activeAgents: (x.activeAgents || []).includes(role as string) ? x.activeAgents : [...(x.activeAgents || []), role as string] } : x) })); try { window.__huangquan_agent = role as string } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } } } })
      // 更新上下文用量
      const estCu = msgs.reduce((s,m) => s + (typeof m.content === 'string' ? m.content.length : Array.isArray(m.content) ? (m.content as { text?: string }[]).reduce((t:number,p:{ text?: string }) => t + ((p.text)?.length || 0), 0) : 0), 0)
      set({ cu: estCu })
      window.huangquan.llm.chat({ requestId: rid, sid, provider: curP.type, model, apiKey: curP.apiKey, baseUrl: curP.baseUrl, messages: msgs, temperature: gSnap.temperature ?? 0.7, max_tokens: gSnap.maxTokens || undefined, tools: getActiveTools(cur.agent), headers: curP.headers }).catch(e => { cbs.forEach(f => f()); reject(e) })
    })
}
