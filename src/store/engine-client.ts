// src/store/engine-client.ts — 独立内核渲染层客户端
// 把主进程 AgentEngine 的事件流应用到 Zustand store(消息/状态/token/计划门), 渲染层不再跑 agent 循环。
import type { Message, SessionData, UsageData } from '../global'
import type { UiDisplayConfig } from '../types'
import { useChatStore } from './chat'
import { useSettingsStore } from './settings'
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
  round?: number
  stepsDone?: number
  stepsTotal?: number
  tokensUsed?: number
  elapsedMs?: number
  currentTool?: string
  stalled?: boolean
  active?: boolean
  status?: 'done' | 'failed' | 'aborted'
  error?: string
  failedStep?: { label?: string; tool?: string; detail?: string; messageId?: string }
  fileChanges?: number
  message?: string
  summary?: string
  steps?: PlanStepView[]
  changedIds?: string[]
  pending?: boolean
  requestId?: string
  question?: string
  choices?: string[]
  multiSelect?: boolean
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

// v0.4.5 流式批处理: delta/推理按 60ms 合并后再落 store。
// flash 档模型 40-70 chunk/s, 逐条 setState+patchSession 会打满渲染主线程导致掉帧卡顿。
let bufId = ''
let bufText = ''
let bufHasText = false
let bufReason: { sid: string; id: string; reasoning: string } | null = null
let bufHasReason = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flushStreamBuffer(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (bufHasText) {
    const id = bufId
    useChatStore.setState(s => ({
      streamId: id,
      streamText: s.streamId === id ? s.streamText + bufText : bufText,
    }))
    bufText = ''
    bufHasText = false
  }
  if (bufHasReason && bufReason) {
    const { sid, id, reasoning } = bufReason
    patchSession(sid, s => ({ ...s, messages: (s.messages || []).map(m => (m.id === id ? { ...m, reasoning_content: reasoning } : m)) }))
    bufHasReason = false
    bufReason = null
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; flushStreamBuffer() }, 60)
}

function applyEngineEventInner(raw: unknown): void {
  const ev = raw as EngineEvent
  if (!ev || typeof ev !== 'object' || !ev.type || !ev.sid) return
  if (ev.type !== 'assistant-chunk') flushStreamBuffer()
  const st = useChatStore.getState()
  switch (ev.type) {
    case 'assistant-chunk': {
      if (!ev.id) return
      // 临时流式通道(stream- 前缀): 只更新 streamText, 不落消息; 最终内容由 step/final 事件承载
      // v0.3.6 P1-5: delta 增量 append; 旧格式 content 全量覆盖兜底
      if (ev.delta !== undefined) {
        // 增量进缓冲; 新的一路(并行/插话)先把旧缓冲落盘再重置, 防止串文
        if (bufId !== ev.id) { flushStreamBuffer(); bufId = ev.id }
        bufText += ev.delta
        bufHasText = true
        scheduleFlush()
      } else {
        flushStreamBuffer()
        useChatStore.setState({ streamId: ev.id, streamText: ev.content ?? '' })
      }
      if (!String(ev.id).startsWith('stream-')) {
        flushStreamBuffer()
        patchSession(ev.sid, s => ensureStreamingMessage(s, ev))
      }
      if (ev.reasoning !== undefined) {
        bufReason = { sid: ev.sid, id: ev.id, reasoning: ev.reasoning }
        bufHasReason = true
        scheduleFlush()
      }
      if (ev.streaming !== undefined) { flushStreamBuffer(); setGlobal(ev) }
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
    case 'task-progress': {
      // v0.4.4 长任务感知性: 轮次/步骤进度/token/耗时/当前工具(按 sid 键控, 并发会话不互相覆盖)
      useChatStore.setState(s => ({ progress: { ...s.progress, [ev.sid]: { round: ev.round || 0, stepsDone: ev.stepsDone || 0, stepsTotal: ev.stepsTotal || 0, tokensUsed: ev.tokensUsed || 0, elapsedMs: ev.elapsedMs || 0, currentTool: ev.currentTool, stalled: ev.stalled === true } } }))
      break
    }
    case 'stall': {
      // v0.4.4 无进展停滞提示: active=true 显示"疑似停滞"; 用户继续/该任务恢复时只清本会话
      useChatStore.setState(s => {
        if (ev.active) return { stall: { ...s.stall, [ev.sid]: { active: true, elapsedMs: ev.elapsedMs || 0 } } }
        const st = { ...s.stall }; delete st[ev.sid]; return { stall: st }
      })
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
      const ui = ev as unknown as { workDir?: string; theme?: string; uiDisplay?: Record<string, unknown> }
      if (ui.workDir) {
        useSettingsStore.setState(s => ({ general: { ...s.general, workDir: ui.workDir } }))
        useSettingsStore.getState().save().catch(() => {})
      }
      if (ui.theme) {
        useSettingsStore.setState(s => ({ general: { ...s.general, theme: ui.theme as string } }))
        useSettingsStore.getState().save().catch(() => {})
      }
      if (ui.uiDisplay) {
        useSettingsStore.setState(s => ({ general: { ...s.general, uiDisplay: ui.uiDisplay as UiDisplayConfig } }))
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
    case 'clarify': {
      // v0.4.2: 模型提问 —— 渲染层展示选项卡片等待用户选择
      useChatStore.setState({ clarifyReq: { sid: ev.sid, requestId: ev.requestId || '', question: ev.question || '请选择', choices: ev.choices || [], multiSelect: ev.multiSelect === true } })
      break
    }
    case 'plan-update': {
      const prev = useChatStore.getState().plans[ev.sid]
      // v0.3.8: 增量合并 —— 只 patch 变化的步骤, 避免全量数组频繁替换
      const seen = new Set<string>()
      let steps = (ev.steps || []).filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true })
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
      useChatStore.setState(s => { const p = { ...s.progress }; delete p[ev.sid]; const st = { ...s.stall }; delete st[ev.sid]; return { streamText: '', streamId: '', progress: p, stall: st } })
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
      // v0.4.5: 渲染侧自动记忆提取已随 memory IPC 精简移除(记忆沉淀由引擎侧接管)
      // v0.3.3: 任务结束关闭该任务的独立浏览器会话(隔离, 不串页面)
      try { window.huangquan?.web?.closeBrowserSession?.(ev.sid, ev.taskId || '') } catch { /* 忽略 */ }
      break
    }
    case 'error': {
      useChatStore.setState(s => { const p = { ...s.progress }; delete p[ev.sid]; const st = { ...s.stall }; delete st[ev.sid]; return { streamText: '', streamId: '', progress: p, stall: st } })
      patchSession(ev.sid, s => ({ ...s, messages: stripStreaming(s.messages || []) }))
      if (st.cid === ev.sid) useChatStore.setState({ error: ev.message || '任务执行出错' })
      break
    }
    default: break
  }
}

export function bindEngineEvents(): () => void {
  // v0.4.5: 点击任务完成通知 → 跳转到任务所属会话
  try {
    window.huangquan.tasks.onActivate(function (sid: string) {
      const cur = useChatStore.getState()
      if (sid && cur.sessions.some(s => s.id === sid)) void cur.switchS(sid)
    })
  } catch { /* 忽略 */ }
  // v0.3.6 P1-6: 向主进程注册事件订阅, 引擎只向本窗口广播
  try { window.huangquan.engine.subscribe().catch(() => {}) } catch { /* 忽略 */ }
  return window.huangquan.engine.onEvent(applyEngineEvent)
}
