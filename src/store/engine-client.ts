// src/store/engine-client.ts — 独立内核渲染层客户端
// 把主进程 AgentEngine 的事件流应用到 Zustand store(消息/状态/token/计划门), 渲染层不再跑 agent 循环。
import type { Message, SessionData, UsageData } from '../global'
import { useChatStore } from './chat'
import { useSettingsStore } from './settings'
import { autoExtractMemory } from './memory'
import type { PlanStepView, PlanState } from '../global'

interface EngineEventMsg {
  id: string
  role: string
  content?: string | null
  timestamp?: number
  tool_call_id?: string
  images?: string[]
  attachments?: Message['attachments']
  tool_calls?: { id?: string; type: string; function: { name: string; arguments: string } }[]
  _toolLog?: Message['_toolLog']
  meta?: Message['meta']
  _inject?: boolean
  _streaming?: boolean
}

interface EngineEvent {
  type: string
  sid: string
  id?: string
  taskId?: string
  delta?: string
  msg?: EngineEventMsg
  content?: string | null
  reasoning?: string
  streaming?: boolean
  executing?: boolean
  busy?: boolean
  phase?: 'thinking' | 'tool'
  label?: string
  detail?: string
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]
  toolLog?: Message['_toolLog']
  stepId?: string
  model?: string
  usage?: UsageData
  used?: number
  limit?: number
  taskTokens?: number
  taskMs?: number
  status?: 'done' | 'failed' | 'aborted'
  error?: string
  failedStep?: { label?: string; tool?: string; detail?: string; messageId?: string }
  fileChanges?: number
  message?: string
  summary?: string
  steps?: PlanStepView[]
  changedIds?: string[]
  pending?: boolean
  agent?: string
  activeAgents?: string[]
  kind?: string
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
function throttledSessionSave(sid: string, delay = 1200): void {
  const cur = useChatStore.getState().sessions.find(s => s.id === sid)
  if (!cur) return
  if (saveTimers.has(sid)) clearTimeout(saveTimers.get(sid)!)
  saveTimers.set(sid, setTimeout(() => {
    saveTimers.delete(sid)
    const s = useChatStore.getState().sessions.find(x => x.id === sid)
    if (s) window.huangquan.sessions.save(s).catch(() => {})
  }, delay))
}

function setGlobal(ev: EngineEvent): void {
  const st = useChatStore.getState()
  if (st.cid === ev.sid) {
    useChatStore.setState({
      streaming: ev.streaming !== undefined ? ev.streaming : st.streaming,
      executing: ev.executing !== undefined ? ev.executing : st.executing,
    })
  }
}

function patchSession(sid: string, fn: (s: SessionData) => SessionData): void {
  useChatStore.setState(s => ({ sessions: s.sessions.map(x => x.id === sid ? fn(x) : x) }))
}

// v0.3.4: 流式占位清理 —— 任务结束/出错/恢复时移除半截占位消息, 防止落盘与重复渲染
function stripStreaming(msgs: Message[]): Message[] {
  return (msgs || []).filter(m => !(m as { _streaming?: boolean })._streaming)
}

// v0.3.4: 流式文本直接写入正式消息 id —— 消息不存在时先创建占位(身份稳定),
// 流式内容仍由 streamText 通道独立渲染(隔离重渲染), step/final 事件用同一 id 一次性落地
function ensureStreamingMessage(s: SessionData, ev: EngineEvent): SessionData {
  const list = s.messages || []
  if (list.some(m => m.id === ev.id)) return s
  return { ...s, messages: [...list, { id: ev.id as string, role: 'assistant' as const, content: '', timestamp: Date.now(), _streaming: true }] }
}

function applyEngineEvent(raw: unknown): void {
  try {
    applyEngineEventInner(raw)
  } catch (e) {
    console.error('[engine-client] 事件应用失败(已忽略, 避免拖垮界面):', e, raw)
  }
}

function applyEngineEventInner(raw: unknown): void {
  const ev = raw as EngineEvent
  if (!ev || typeof ev !== 'object' || !ev.type || !ev.sid) return
  const st = useChatStore.getState()
  switch (ev.type) {
    case 'assistant-chunk': {
      if (!ev.id) return
      // 临时流式通道(stream- 前缀): 只更新 streamText, 不落消息; 最终内容由 step/final 事件承载
      // v0.3.6 P1-5: delta 增量 append; 旧格式 content 全量覆盖兜底
      useChatStore.setState(s => ({
        // 按消息 id 隔离: 同一路增量追加; 新的一路(并行/插话)自动重置, 防止串文
        streamId: ev.id,
        streamText: ev.delta !== undefined ? (ev.id === s.streamId ? s.streamText + ev.delta : ev.delta) : (ev.content ?? ''),
      }))
      if (!String(ev.id).startsWith('stream-')) {
        patchSession(ev.sid, s => ensureStreamingMessage(s, ev))
      }
      if (ev.reasoning !== undefined) {
        patchSession(ev.sid, s => ({ ...s, messages: (s.messages || []).map(m => m.id === ev.id ? { ...m, reasoning_content: ev.reasoning } : m) }))
      }
      if (ev.streaming !== undefined) setGlobal(ev)
      break
    }
    case 'assistant-usage': {
      if (!ev.id || !ev.usage) return
      patchSession(ev.sid, s => ({ ...s, messages: (s.messages || []).map(m => m.id === ev.id ? { ...m, usage: ev.usage } : m) }))
      break
    }
    case 'step': {
      if (!ev.id) return
      useChatStore.setState({ streamText: '', streamId: '' })
      const toolCalls = (ev.toolCalls || []).map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } }))
      patchSession(ev.sid, s => {
        const list = s.messages || []
        const idx = list.findIndex(m => m.id === ev.id)
        if (idx >= 0) {
          return { ...s, messages: list.map(m => m.id === ev.id ? { ...m, content: ev.content ?? null, reasoning_content: ev.reasoning ?? m.reasoning_content, tool_calls: toolCalls, _streaming: false } : m) }
        }
        return { ...s, messages: [...list, { id: ev.id as string, role: 'assistant' as const, content: ev.content ?? null, reasoning_content: ev.reasoning, timestamp: Date.now(), tool_calls: toolCalls, _streaming: false }] }
      })
      break
    }
    case 'tool-msg': {
      const m = ev.msg
      if (!m) return
      patchSession(ev.sid, s => ({ ...s, messages: [...(s.messages || []), {
        id: m.id,
        role: (m.role === 'tool' ? 'tool' : m.role) as Message['role'],
        content: m.content ?? null,
        timestamp: m.timestamp || Date.now(),
        tool_call_id: m.tool_call_id,
      }] }))
      break
    }
    case 'tool-log': {
      if (!ev.stepId || !ev.toolLog) return
      patchSession(ev.sid, s => ({ ...s, messages: (s.messages || []).map(m => m.id === ev.stepId ? { ...m, _toolLog: ev.toolLog } : m) }))
      throttledSessionSave(ev.sid)
      break
    }
    case 'stage': {
      useChatStore.setState({ stage: { sid: ev.sid, phase: ev.phase || 'thinking', label: ev.label || '', detail: ev.detail || '' } })
      break
    }
    case 'stage-clear': {
      if (st.stage?.sid === ev.sid) useChatStore.setState({ stage: null })
      break
    }
    case 'final': {
      if (!ev.id) break
      useChatStore.setState({ streamText: '', streamId: '' })
      const finalMeta = { taskTokens: ev.taskTokens, taskMs: ev.taskMs }
      patchSession(ev.sid, s => {
        const list = s.messages || []
        const idx = list.findIndex(m => m.id === ev.id)
        if (idx >= 0) {
          return { ...s, messages: list.map(m => m.id === ev.id ? { ...m, content: ev.content ?? '', reasoning_content: ev.reasoning ?? m.reasoning_content, _toolLog: ev.toolLog, meta: finalMeta, _streaming: false } : m) }
        }
        return { ...s, messages: [...list, { id: ev.id as string, role: 'assistant' as const, content: ev.content ?? '', reasoning_content: ev.reasoning, timestamp: Date.now(), _toolLog: ev.toolLog, meta: finalMeta, _streaming: false }] }
      })
      throttledSessionSave(ev.sid, 300)
      break
    }
    case 'stream': {
      if (!ev.streaming) useChatStore.setState({ streamText: '', streamId: '' })
      patchSession(ev.sid, s => ({ ...s, streaming: !!ev.streaming, busy: !!ev.executing }))
      setGlobal(ev)
      break
    }
    case 'busy': {
      patchSession(ev.sid, s => ({ ...s, busy: !!ev.busy }))
      if (st.cid === ev.sid) useChatStore.setState({ executing: !!ev.busy })
      break
    }
    case 'agent': {
      patchSession(ev.sid, s => ({ ...s, agent: ev.agent || s.agent, activeAgents: ev.activeAgents }))
      if (st.cid === ev.sid) useChatStore.setState({ activeAgents: ev.activeAgents || [] })
      break
    }
    case 'interject': {
      const m = ev.msg
      if (!m) break
      patchSession(ev.sid, s => ({ ...s, messages: [...(s.messages || []), {
        id: m.id,
        role: (m.role === 'system' ? 'system' : 'user') as 'user' | 'system',
        content: m.content ?? '',
        timestamp: m.timestamp || Date.now(),
        images: m.images,
        attachments: m.attachments,
        _inject: true,
      }] }))
      break
    }
    case 'usage': {
      if (!ev.model || !ev.usage) break
      const sid = ev.sid
      const u = ev.usage
      const readT = u._readTokens || u.prompt_cache_hit_tokens || u.prompt_tokens_details?.cached_tokens || u.cache_read_input_tokens || 0
      const inputT = u._inputTokens || u.prompt_tokens || u.input_tokens || 0
      const writeT = u._writeTokens || u.cache_creation_input_tokens || 0
      const outT = u.completion_tokens || (u as { output_tokens?: number }).output_tokens || 0
      useChatStore.setState(s => {
        const ss = s.sessTok[sid] || {}
        const c = ss[ev.model!] || { requests: 0, readTokens: 0, inputTokens: 0, writeTokens: 0, outputTokens: 0, hitReqs: 0 }
        return { sessTok: { ...s.sessTok, [sid]: { ...ss, [ev.model!]: { requests: c.requests + 1, readTokens: c.readTokens + readT, inputTokens: c.inputTokens + inputT, writeTokens: c.writeTokens + writeT, outputTokens: c.outputTokens + outT, hitReqs: c.hitReqs + (readT > 0 ? 1 : 0) } } } }
      })
      break
    }
    case 'context': {
      // v0.3.3: 输入框上下文环 —— 最近一次请求的真实上下文占用(不再永远显示 0)
      if (typeof ev.used === 'number' && ev.used >= 0) {
        useChatStore.setState(s => ({ cu: ev.used, cl: ev.limit && ev.limit > 0 ? ev.limit : s.cl }))
      }
      break
    }
    case 'restore': {
      const msgs = (ev as unknown as { messages?: EngineEventMsg[] }).messages
      if (!Array.isArray(msgs)) break
      patchSession(ev.sid, s => ({ ...s, messages: stripStreaming(msgs as Message[]).map(m => ({
        id: m.id,
        role: (m.role === 'tool' ? 'tool' : m.role === 'assistant' ? 'assistant' : 'user') as Message['role'],
        content: m.content ?? null,
        timestamp: m.timestamp || Date.now(),
        tool_call_id: m.tool_call_id,
        images: m.images,
        attachments: m.attachments,
        tool_calls: m.tool_calls,
        _toolLog: m._toolLog,
        meta: m.meta,
        _inject: m._inject,
      })), agent: ev.agent, activeAgents: ev.activeAgents }))
      break
    }
    case 'ui': {
      const ui = ev as unknown as { workDir?: string; theme?: string }
      if (ui.workDir) {
        useSettingsStore.setState(s => ({ general: { ...s.general, workDir: ui.workDir } }))
        useSettingsStore.getState().save().catch(() => {})
      }
      if (ui.theme) {
        useSettingsStore.setState(s => ({ general: { ...s.general, theme: ui.theme as string } }))
        useSettingsStore.getState().save().catch(() => {})
      }
      break
    }
    case 'plan': {
      const plan: PlanState = { summary: ev.summary || '', steps: ev.steps || [], pending: true }
      useChatStore.setState(s => ({ plans: { ...s.plans, [ev.sid]: plan } }))
      patchSession(ev.sid, s => ({ ...s, plan }))
      throttledSessionSave(ev.sid, 300)
      break
    }
    case 'plan-update': {
      const prev = useChatStore.getState().plans[ev.sid]
      // v0.3.8: 增量合并 —— 只 patch 变化的步骤, 避免全量数组频繁替换
      let steps = ev.steps || []
      if (ev.changedIds && ev.changedIds.length && prev) {
        const byId = new Map(steps.map(s => [s.id, s]))
        steps = [...prev.steps.map(s => byId.get(s.id) || s), ...steps.filter(s => !prev.steps.some(p => p.id === s.id))]
      }
      const plan: PlanState = { summary: ev.summary !== undefined ? ev.summary : (prev?.summary || ''), steps, pending: prev?.pending ?? false }
      useChatStore.setState(s => ({ plans: { ...s.plans, [ev.sid]: plan } }))
      break
    }
    case 'compact': {
      // v0.3.4: 微压缩 —— 引擎把最旧一轮问答折成摘要并重写会话消息
      const list = (ev as unknown as { messages?: EngineEventMsg[] }).messages
      if (!Array.isArray(list)) break
      patchSession(ev.sid, s => ({ ...s, messages: stripStreaming(list as Message[]).map(m => ({
        id: m.id,
        role: (m.role === 'tool' ? 'tool' : m.role === 'assistant' ? 'assistant' : 'user') as Message['role'],
        content: m.content ?? null,
        timestamp: m.timestamp || Date.now(),
        tool_call_id: m.tool_call_id,
        images: m.images,
        attachments: m.attachments,
        tool_calls: m.tool_calls,
        _toolLog: m._toolLog,
        meta: m.meta,
        _inject: m._inject,
      })) }))
      throttledSessionSave(ev.sid, 300)
      break
    }
    case 'task-done': {
      useChatStore.setState({ streamText: '', streamId: '' })
      const finalPlan = useChatStore.getState().plans[ev.sid]
      patchSession(ev.sid, s => ({ ...s, busy: false, streaming: false, messages: stripStreaming(s.messages || []), plan: finalPlan || s.plan }))
      if (st.cid === ev.sid) {
        // v0.3.8: 失败归因 —— 错误提示附带失败步骤
        let errText = ''
        if (ev.status === 'failed') {
          errText = ev.error || '任务失败'
          const fs2 = ev.failedStep as { label?: string; tool?: string } | undefined
          if (fs2?.label) errText += '（失败于步骤：' + fs2.label + (fs2.tool ? ' / ' + fs2.tool : '') + '）'
        }
        useChatStore.setState({ streaming: false, executing: false, stage: null, error: errText || null, errorStep: ev.failedStep?.messageId ? { messageId: ev.failedStep.messageId } : null, fileChanges: ev.fileChanges || 0, lastTaskId: ev.taskId || '' })
      }
      throttledSessionSave(ev.sid, 200)
      autoExtractMemory(ev.sid, useChatStore.getState().sessions).catch(() => {})
      // v0.3.3: 任务结束关闭该任务的独立浏览器会话(隔离, 不串页面)
      try { window.huangquan?.web?.closeBrowserSession?.(ev.sid, ev.taskId || '') } catch { /* 忽略 */ }
      break
    }
    case 'error': {
      useChatStore.setState({ streamText: '', streamId: '' })
      patchSession(ev.sid, s => ({ ...s, messages: stripStreaming(s.messages || []) }))
      if (st.cid === ev.sid) useChatStore.setState({ error: ev.message || '任务执行出错' })
      break
    }
    default: break
  }
}

export function bindEngineEvents(): () => void {
  // v0.3.6 P1-6: 向主进程注册事件订阅, 引擎只向本窗口广播
  try { window.huangquan.engine.subscribe().catch(() => {}) } catch { /* 忽略 */ }
  return window.huangquan.engine.onEvent(applyEngineEvent)
}
