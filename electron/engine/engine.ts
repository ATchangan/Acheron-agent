// electron/engine/engine.ts — 黄泉Agent 独立内核(v0.3.3)
// Agent 主循环完全运行在主进程: LLM 直连(不经渲染层)、工具直接分发、任务可落盘断点恢复。
// 渲染层只负责: 发送启动请求、消费事件流、展示结果。
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import { isAbsolute, join } from 'path'
import type { EngineEvent, EngineMessage, EngineProvider, EngineSettings, EngineStartParams, EngineToolCall, EngineToolSpec, EngineUsage, PlanStep } from './types'
import { getAgents, type AgentDef } from './agents'
import { buildContextualMessages, buildPrompt, getModelContextLimit, isVisionModel, outputLimit, filterToolsByAgent, slimToolResult, estimateTokens } from './context'
import { runTool, getActiveTools, getMcpToolSpecs, closeTerminalSessions, type ToolRunCtx } from './tools'
import { loadMemory, saveMemory, memoryBlockText, type EngineMemory } from './memory'
import { streamChat, chatOnce, abortLLM, visionOnce, normalizeUsage } from './llm-core'
import type { LlmMsg } from './llm-core'
import { classifyCacheSupport, cacheCapToSupported } from './cache-caps'
import { applyCompact, buildCompactNotice, buildCompactPrompt, pickCompactCandidates, resolveCompactRatio, COMPACT_COOLDOWN_MS, COMPACT_DEFAULT_KEEP_ROUNDS, COMPACT_PREFLIGHT_MARGIN, COMPACT_SMALL_WINDOW, COMPACT_SMALL_FLOOR } from './compact'
import { buildPlanDocContent, dedupePlanSteps, planNeedsVerify as planNeedsVerifyCore, planHasVerification as planHasVerificationCore, type PlanStepData } from './plan-core'
import { toolLabel as toolLabelOf, toolDetail as toolDetailOf, toolExpected as toolExpectedOf } from './tool-labels'
import { pickAgentModel, pickInitialModel, pickSubModel, resolveModel as resolveModelOf, resolveThinkLevel as resolveThinkLevelOf, visionCandidates } from './model-router'
import { listSkills } from './skill-files'
import { runHooks } from './hooks'
import { isPlanReadonlyTool } from './plan-tools'
import { chainDirs, collectSubdirInstructions, discoverProjectInstructions, type InstructionFile } from './project-instructions'
import { logTraceFile } from '../ipc/trace'
import { startTask, updateTask, finishTask, getTask } from '../ipc/tasks'
import { backoffDelay } from './reliability'
import { invokeHandler } from './registry'

interface TokenStat { requests: number; readTokens: number; inputTokens: number; writeTokens: number; outputTokens: number; hitReqs: number }
interface ToolLogEntry { name: string; args: Record<string, unknown>; result: string; error: boolean; ms: number; toolCallId?: string }
interface CallResult { text: string; reasoning?: string; tcs: EngineToolCall[]; ttft?: number; duration?: number; usage?: EngineUsage; msgId?: string; truncated?: boolean }
interface PlanGate { promise: Promise<void>; resolve: (v: boolean) => void }
interface TaskGoal {
  objective: string
  status: 'active' | 'completed' | 'failed' | 'aborted'
  startedAt: number
  progress?: string
}

interface TaskState {
  sid: string
  taskId: string
  myGen: number
  content: string
  images?: string[]
  attachments?: EngineMessage['attachments']
  userMsgId: string
  userMsg: EngineMessage
  messages: EngineMessage[]
  g: EngineSettings
  providers: EngineProvider[]
  p: EngineProvider
  curP: EngineProvider
  model: string
  origModel: string
  modelFailCount: number
  modelFallbackUsed: boolean
  agent?: string
  agentManual?: boolean
  activeAgents: string[]
  handoffStack: string[]
  handoffCounts: Record<string, number>
  handoffAt: number
  toolLog: ToolLogEntry[]
  tokBase: Record<string, TokenStat>
  memoryText: string
  projectCtx: { file: string; content: string; truncated?: boolean; dirs?: string[] } | null
  instrVisited: Set<string>
  fileSnapshots: Record<string, string | null>
  memory: EngineMemory
  lastMidSave: number
  planSteps: PlanStep[]
  planSummary: string
  planGateChecked: boolean
  planEmitTimer: NodeJS.Timeout | null
  planLastSnapshot: string
  planSurprises: string[]
  planDecisions: string[]
  planDocTimer: NodeJS.Timeout | null
  goal: TaskGoal
  planPending: PlanGate | null
  planApproved: boolean
  stopped: boolean
  taskFinished: boolean
  autoContinueCount?: number
  running: boolean
  lastMsgId?: string
  roundNum: number
  interjects: { text: string; kind: 'supplement' | 'retarget' }[]
  withImages: boolean
  switchedVision: boolean
  earlySummary?: string
  earlySummaryDone?: boolean
  skillsCache?: { name: string; description: string }[]
  lastCompactAt?: number
  lastPromptTokens?: number
  compactCount?: number
  pendingText?: string
}

export interface EngineDeps {
  settingsPath: string
  userDataPath: string
  memoryPath: string
  tracePath: string
  skillsDirs?: string[]
  netFetch: typeof fetch
  loadSettings: () => { providers: EngineProvider[]; general: EngineSettings }
  loadIshiki: () => string
  sendEvent: (ev: EngineEvent) => void
  getSender: () => Electron.WebContents | null
}

export class AgentEngine {
  private deps: EngineDeps
  private tasks = new Map<string, TaskState>()
  private gens = new Map<string, number>()
  private runningTasks = 0
  private sessTokBySid = new Map<string, Record<string, TokenStat>>()
  private costedReqs = new Set<string>()
  private traceOn = true
  private traceOnAt = 0

  constructor(deps: EngineDeps) { this.deps = deps }

  private nextGen(sid: string): number {
    const cur = this.gens.get(sid) || 0
    const next = cur + 1
    this.gens.set(sid, next)
    return next
  }
  private curGen(sid: string): number { return this.gens.get(sid) || 0 }
  private invalidate(sid: string): void { this.gens.set(sid, (this.gens.get(sid) || 0) + 1) }

  private trace(level: 'debug' | 'info' | 'warn' | 'error', event: string, detail?: string, sid?: string, requestId?: string): void {
    try {
      if (Date.now() - this.traceOnAt > 5000) {
        this.traceOnAt = Date.now()
        this.traceOn = this.deps.loadSettings().general.traceEnabled !== false
      }
      if (!this.traceOn) return
      logTraceFile(this.deps.tracePath, { ts: Date.now(), level, event, detail: detail ? String(detail).slice(0, 600) : undefined, sid, requestId })
    } catch { /* 忽略 */ }
  }

  private emit(ev: EngineEvent): void {
    try { this.deps.sendEvent(ev) } catch { /* 忽略 */ }
  }

  start(params: EngineStartParams): void {
    const existing = this.tasks.get(params.sid)
    // 仅当旧任务仍在正常运行（未被停止/失效）时，新消息才作为插话合并
    if (existing?.running && !existing.stopped && this.curGen(params.sid) === existing.myGen) {
      this.interject(params.sid, params.content, params.images, params.attachments, 'supplement')
      return
    }
    // 旧任务已被停止/失效：先彻底打断再开新任务，防止旧循环继续跑
    if (existing?.running) {
      existing.stopped = true
      abortLLM(params.sid)
      void invokeHandler('computer:abort', [params.sid], null)
    }
    const myGen = this.nextGen(params.sid)
    const { providers, general: rawGeneral } = this.deps.loadSettings()
    const general: EngineSettings = { ...rawGeneral, ishiki: this.deps.loadIshiki() }
    const p = providers.find(x => x.apiKey && x.baseUrl) || providers[0]
    if (!p) {
      this.emit({ type: 'busy', sid: params.sid, busy: false })
      this.emit({ type: 'stream', sid: params.sid, streaming: false, executing: false })
      this.emit({ type: 'error', sid: params.sid, message: '请先配置 API Provider' })
      return
    }
    // v0.3.8: 多会话并发上限 —— 防止同时跑太多任务吃满资源
    const maxConcurrent = Math.max(1, Number(general.maxConcurrentTasks) || 3)
    if (this.runningTasks >= maxConcurrent) {
      this.emit({ type: 'busy', sid: params.sid, busy: false })
      this.emit({ type: 'stream', sid: params.sid, streaming: false, executing: false })
      this.emit({ type: 'error', sid: params.sid, message: '同时运行的任务已达上限（' + maxConcurrent + ' 个，当前运行 ' + this.runningTasks + ' 个），请等待当前任务完成后再发送。可在 设置→引擎 中调整上限' })
      return
    }
    this.runningTasks++
    const agentsMap = getAgents(general.agentOverrides as Record<string, Partial<AgentDef>> | undefined)
    const initialPick = pickInitialModel(general, providers, p, params.content, params.images)
    const model = params.agent && !params.agentManual
      ? (pickAgentModel(general, providers, p, params.agent, agentsMap) || initialPick.model)
      : initialPick.model
    const userMsg: EngineMessage = params.history?.find(m => m.id === params.userMsgId)
      || { id: params.userMsgId, role: 'user', content: params.content, timestamp: params.userMsgTimestamp || Date.now(), images: params.images, attachments: params.attachments }
    // 历史消息已含本条用户消息(渲染层 buildUserMessage 已上屏), 引擎直接继承完整会话
    const history: EngineMessage[] = (params.history && params.history.length) ? params.history : [userMsg]
    const task: TaskState = {
      sid: params.sid,
      taskId: params.taskId,
      myGen,
      content: params.content,
      images: params.images,
      attachments: params.attachments,
      userMsgId: params.userMsgId,
      userMsg,
      messages: history,
      g: general,
      providers,
      p,
      curP: initialPick.p,
      model,
      origModel: model,
      modelFailCount: 0,
      modelFallbackUsed: false,
      agent: params.agent,
      agentManual: params.agentManual,
      activeAgents: params.agent ? [params.agent] : [],
      handoffStack: [],
      handoffCounts: {},
      handoffAt: -1,
      toolLog: [],
      tokBase: this.snapshotTok(params.sid),
      memoryText: '',
      projectCtx: null,
      instrVisited: new Set<string>(),
      fileSnapshots: {},
      memory: loadMemory(this.deps.memoryPath),
      lastMidSave: 0,
      planSteps: [],
      planSummary: '',
      planGateChecked: false,
      planEmitTimer: null,
      planLastSnapshot: '',
      planSurprises: [],
      planDecisions: [],
      planDocTimer: null,
      goal: { objective: String(params.content || '').slice(0, 500), status: 'active', startedAt: Date.now() },
      planPending: null,
      planApproved: false,
      stopped: false,
      taskFinished: false,
      autoContinueCount: 0,
      running: true,
      roundNum: 0,
      interjects: [],
      withImages: !!(params.images && params.images.length),
      switchedVision: false,
    }
    this.tasks.set(params.sid, task)
    this.emit({ type: 'busy', sid: params.sid, busy: true })
    this.emit({ type: 'stream', sid: params.sid, streaming: true, executing: true })
    startTask({ id: params.taskId, sid: params.sid, content: String(params.content).slice(0, 2000), images: params.images, attachments: params.attachments, model })
    getMcpToolSpecs(true) // 新任务启动时强制刷新 MCP 工具清单(刚连接的服务器立即生效)
    this.trace('info', 'task.start', String(params.content).slice(0, 120), params.sid, params.taskId)
    runHooks(general, 'task-start', { sid: params.sid, taskId: params.taskId, content: String(params.content || '').slice(0, 200) })
    this.planAddDecision(task, '任务启动：' + String(params.content || '').slice(0, 80))
    this.writePlanDoc(task)
    void this.runTask(task)
  }

  resume(taskId: string): void {
    const rec = getTask(taskId)
    if (!rec || !rec.checkpoint) return
    const cp = rec.checkpoint as { messages: EngineMessage[]; agent?: string; activeAgents: string[]; model: string; round: number; provider?: unknown; handoffAt?: number; handoffStack?: string[]; handoffCounts?: Record<string, number>; planSteps?: PlanStep[]; planSummary?: string; planSurprises?: string[]; planDecisions?: string[]; goal?: TaskGoal }
    if (!cp || !Array.isArray(cp.messages)) return
    const existing = this.tasks.get(rec.sid)
    if (existing?.running) return
    const { providers, general: rawGeneral } = this.deps.loadSettings()
    const general: EngineSettings = { ...rawGeneral, ishiki: this.deps.loadIshiki() }
    const p = providers.find(x => x.apiKey && x.baseUrl) || providers[0]
    if (!p) {
      this.emit({ type: 'busy', sid: rec.sid, busy: false })
      this.emit({ type: 'stream', sid: rec.sid, streaming: false, executing: false })
      this.emit({ type: 'error', sid: rec.sid, message: '请先配置 API Provider' })
      return
    }
    const maxConcurrent = Math.max(1, Number(general.maxConcurrentTasks) || 3)
    if (this.runningTasks >= maxConcurrent) {
      this.emit({ type: 'busy', sid: rec.sid, busy: false })
      this.emit({ type: 'stream', sid: rec.sid, streaming: false, executing: false })
      this.emit({ type: 'error', sid: rec.sid, message: '同时运行的任务已达上限（' + maxConcurrent + ' 个，当前运行 ' + this.runningTasks + ' 个），请等待当前任务完成后再恢复' })
      return
    }
    this.runningTasks++
    const myGen = this.nextGen(rec.sid)
    const lastUser = [...cp.messages].reverse().find(m => m.role === 'user')
    const restoredSteps: PlanStep[] = Array.isArray(cp.planSteps) ? cp.planSteps : []
    const hasPendingSteps = restoredSteps.some(s => s.status === 'pending' || s.status === 'paused')
    // v0.3.7: 计划门禁开启且恢复时仍有未完成步骤 → 重新走一次计划确认; 否则直接续跑
    const gateNeeded = general.planGate === true && hasPendingSteps
    const task: TaskState = {
      sid: rec.sid,
      taskId: rec.id,
      myGen,
      content: rec.content,
      images: rec.images,
      attachments: rec.attachments as EngineMessage['attachments'],
      userMsgId: lastUser?.id || '',
      userMsg: lastUser || { id: uuidv4(), role: 'user', content: rec.content, timestamp: Date.now() },
      messages: cp.messages,
      g: general,
      providers,
      p,
      curP: this.findProvider(cp.provider, providers, p),
      model: cp.model || p.selectedModel || p.models[0] || '',
      origModel: cp.model || p.selectedModel || p.models[0] || '',
      modelFailCount: 0,
      modelFallbackUsed: false,
      agent: cp.agent,
      activeAgents: cp.activeAgents || [],
      handoffStack: cp.handoffStack || [],
      handoffCounts: cp.handoffCounts || {},
      handoffAt: typeof cp.handoffAt === 'number' ? cp.handoffAt : -1,
      toolLog: [],
      tokBase: this.snapshotTok(rec.sid),
      memoryText: '',
      projectCtx: null,
      instrVisited: new Set<string>(),
      fileSnapshots: {},
      memory: loadMemory(this.deps.memoryPath),
      lastMidSave: 0,
      planSteps: restoredSteps,
      planSummary: String(cp.planSummary || ''),
      planGateChecked: !hasPendingSteps,
      planEmitTimer: null,
      planLastSnapshot: '',
      planSurprises: Array.isArray(cp.planSurprises) ? cp.planSurprises : [],
      planDecisions: Array.isArray(cp.planDecisions) ? cp.planDecisions : [],
      planDocTimer: null,
      goal: cp.goal && cp.goal.objective ? { ...cp.goal, status: 'active' } : { objective: String(rec.content || '').slice(0, 500), status: 'active', startedAt: Date.now() },
      planPending: null,
      planApproved: !gateNeeded,
      stopped: false,
      taskFinished: false,
      autoContinueCount: 0,
      running: true,
      roundNum: cp.round || 0,
      interjects: [],
      withImages: !!(rec.images && rec.images.length),
      switchedVision: false,
    }
    this.tasks.set(rec.sid, task)
    this.emit({ type: 'restore', sid: rec.sid, messages: cp.messages, agent: cp.agent, activeAgents: cp.activeAgents || [], model: task.model })
    if (task.planSteps.length) this.emit({ type: 'plan-update', sid: rec.sid, summary: task.planSummary || undefined, steps: task.planSteps.map(s => ({ ...s })) })
    this.emit({ type: 'busy', sid: rec.sid, busy: true })
    this.emit({ type: 'stream', sid: rec.sid, streaming: true, executing: true })
    this.trace('info', 'task.resume', rec.content.slice(0, 120), rec.sid, rec.id)
    runHooks(task.g, 'task-resume', { sid: rec.sid, taskId: rec.id })
    this.planAddDecision(task, '任务恢复（断点第 ' + task.roundNum + ' 轮）')
    this.writePlanDoc(task)
    void this.runTask(task)
  }

  stop(sid: string): void {
    const task = this.tasks.get(sid)
    this.invalidate(sid)
    if (task) {
      task.stopped = true
      if (task.planPending) { task.planApproved = false; task.planPending.resolve(false) }
      this.planCloseAll(task, 'aborted', '用户停止')
      this.emitPlan(task, true)
      this.planAddDecision(task, '用户停止任务')
      this.flushPlanDoc(task)
      closeTerminalSessions(sid)
      runHooks(task.g, 'task-stop', { sid, taskId: task.taskId })
      // v0.3.7: 停止时同步落盘任务状态, 避免进程被杀后 tasks.json 残留 running
      this.finishTask(task, 'aborted', '用户停止')
    }
    abortLLM(sid)
    // 打断正在执行的超长命令(exec 带 sid 注册, 可被中止)
    void invokeHandler('computer:abort', [sid], null)
  }

  interject(sid: string, content: string, images?: string[], attachments?: EngineMessage['attachments'], kind: 'supplement' | 'retarget' = 'supplement', prefix = ''): void {
    const task = this.tasks.get(sid)
    if (!task || !task.running) return
    // 模型看到的是 prefix+content(含插话说明), 界面看到的是原始 content(不带内部前缀)
    task.interjects.push({ text: prefix + content, kind })
    const msg: EngineMessage = { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images, attachments, _inject: true, _injectPrefix: prefix || undefined }
    task.messages.push(msg)
    this.emit({ type: 'interject', sid, msg, kind })
    this.trace('info', 'task.interject', content.slice(0, 80), sid, task.taskId)
  }

  approve(sid: string): void {
    const task = this.tasks.get(sid)
    if (task?.planPending) { task.planApproved = true; task.planPending.resolve(true) }
  }

  reject(sid: string): void {
    const task = this.tasks.get(sid)
    if (task?.planPending) { task.planApproved = false; task.planPending.resolve(false) }
  }

  // v0.3.7: plan-update 节流合并(150ms) —— 长任务步骤多时避免每步一次全量 IPC
  private emitPlan(task: TaskState, force = false): void {
    const { steps, changedIds } = this.buildPlanEvent(task)
    if (force) {
      if (task.planEmitTimer) { clearTimeout(task.planEmitTimer); task.planEmitTimer = null }
      this.emit({ type: 'plan-update', sid: task.sid, summary: task.planSummary || undefined, steps, changedIds })
      return
    }
    if (task.planEmitTimer) return
    task.planEmitTimer = setTimeout(() => {
      task.planEmitTimer = null
      if (this.tasks.get(task.sid) !== task) return
      const latest = this.buildPlanEvent(task)
      this.emit({ type: 'plan-update', sid: task.sid, summary: task.planSummary || undefined, steps: latest.steps, changedIds: latest.changedIds })
    }, 150)
  }

  // v0.3.8: 计划增量 —— 对比上次快照, 只标记变化的步骤 id, 渲染层按 id 局部 patch
  private buildPlanEvent(task: TaskState): { steps: PlanStep[]; changedIds?: string[] } {
    const steps = task.planSteps.map(s => ({ ...s }))
    const snapshot = JSON.stringify(steps)
    let changedIds: string[] | undefined
    if (task.planLastSnapshot && task.planLastSnapshot !== snapshot) {
      try {
        const prev = JSON.parse(task.planLastSnapshot) as PlanStep[]
        const prevById = new Map(prev.map(s => [s.id, s]))
        const prevIds = new Set(prev.map(s => s.id))
        changedIds = steps.filter(s => JSON.stringify(prevById.get(s.id)) !== JSON.stringify(s)).map(s => s.id)
        for (const s of steps) if (!prevIds.has(s.id)) changedIds.push(s.id)
        if (!changedIds.length) changedIds = undefined
      } catch { changedIds = undefined }
    }
    task.planLastSnapshot = snapshot
    return { steps, changedIds }
  }

  private flushPlan(task: TaskState): void {
    this.emitPlan(task, true)
  }

  // 新批次工具调用 → 追加步骤。按 tc.id 去重: 同一工具调用只生成一次步骤(门禁前/恢复后重放安全)
  private planAppend(task: TaskState, tcs: EngineToolCall[], summary?: string): void {
    if (summary && !task.planSummary) task.planSummary = String(summary).slice(0, 500)
    if (!tcs.length) return
    for (const tc of tcs) {
      if (tc.name === 'update_plan') continue
      if (task.planSteps.some(s => s.toolCallId && s.toolCallId === tc.id)) continue
      // v0.3.7: 优先认领模型 update_plan 声明的 pending 步骤(无 toolCallId), 避免声明与自动生成重复
      const declared = task.planSteps.find(s => s.status === 'pending' && !s.toolCallId && (!s.tool || s.tool === tc.name))
      if (declared) {
        declared.toolCallId = tc.id
        declared.tool = tc.name
        if (!declared.detail) declared.detail = toolDetailOf(tc)
        if (!declared.expected) declared.expected = toolExpectedOf(tc)
        continue
      }
      const step: PlanStep = { id: uuidv4(), label: toolLabelOf(tc), status: 'pending', tool: tc.name, detail: toolDetailOf(tc), toolCallId: tc.id, expected: toolExpectedOf(tc) }
      task.planSteps.push(step)
    }
    task.planSteps = dedupePlanSteps(task.planSteps)
    this.emitPlan(task)
  }

  // 开始执行当前批次: 按 toolCallId 精确绑定步骤(缺失时回退到首个 pending), 返回按 res.tcs 顺序的 step id
  private planStart(task: TaskState, tcs: EngineToolCall[], messageId?: string): string[] {
    const ids: string[] = []
    for (const tc of tcs) {
      if (tc.name === 'update_plan') continue
      let st = task.planSteps.find(s => s.toolCallId && s.toolCallId === tc.id)
      if (!st) st = task.planSteps.find(s => s.status === 'pending' && !s.toolCallId && (!s.tool || s.tool === tc.name))
      if (!st) {
        st = { id: uuidv4(), label: toolLabelOf(tc), status: 'pending', tool: tc.name, detail: toolDetailOf(tc), toolCallId: tc.id, expected: toolExpectedOf(tc) }
        task.planSteps.push(st)
      }
      st.status = 'running'
      if (messageId) st.messageId = messageId
      ids.push(st.id)
    }
    task.planSteps = dedupePlanSteps(task.planSteps)
    this.emitPlan(task)
    return ids
  }

  // 工具结果返回后: 按结果打勾/打叉, 记录耗时; 基础自检(E: 前缀 / 关键工具空结果)
  private planFinish(task: TaskState, ids: string[], results: { r: string; ms: number }[]): void {
    ids.forEach((id, i) => {
      const st = task.planSteps.find(x => x.id === id)
      if (!st) return
      const res = results[i] || { r: '', ms: 0 }
      const r = res.r || ''
      st.ms = (st.ms || 0) + (res.ms || 0)
      // 空目录/无匹配对 ls/find/grep 是正常结果, 只有 read/exec/web 空输出才算可疑失败
      const emptyFail = !r.trim() && ['read', 'exec_command', 'web_search', 'web_fetch'].includes(st.tool || '')
      if (r.startsWith('E:') || emptyFail) {
        st.status = 'failed'
        const reason = emptyFail ? '空结果' : r.slice(2, 50).replace(/\s+/g, ' ')
        if (reason) st.detail = (st.detail ? st.detail + ' · ' : '') + reason
        this.planAddSurprise(task, st.label + ' 失败：' + (reason || '未知原因'))
      } else {
        st.status = 'done'
      }
    })
    this.emitPlan(task)
  }

  // 熔断/异常: 所有未开始的 pending 步骤直接标 failed(不再依赖队列)
  private planFailPending(task: TaskState, reason: string): void {
    let changed = false
    for (const st of task.planSteps) {
      if (st.status === 'pending') {
        st.status = 'failed'
        st.detail = (st.detail ? st.detail + ' · ' : '') + reason
        changed = true
      }
    }
    if (changed) this.emitPlan(task)
  }

  // 停止/拒绝/任务失败: 未完成步骤统一收尾(paused 也视为未完成)
  private planCloseAll(task: TaskState, status: 'aborted' | 'failed', reason?: string): void {
    let changed = false
    for (const st of task.planSteps) {
      if (st.status === 'pending' || st.status === 'running' || st.status === 'paused') {
        st.status = status
        if (reason) st.detail = (st.detail ? st.detail + ' · ' : '') + reason
        changed = true
      }
    }
    if (changed) this.emitPlan(task)
  }

  // v0.3.7: 计划复盘 —— 任务收尾时由代码生成结构化复盘(零额外 LLM 调用)
  private planRetrospective(task: TaskState): string {
    const steps = task.planSteps
    if (!steps.length) return ''
    const total = steps.length
    const done = steps.filter(s => s.status === 'done').length
    const failed = steps.filter(s => s.status === 'failed').length
    const aborted = steps.filter(s => s.status === 'aborted').length
    const lines: string[] = []
    lines.push(`\n\n---\n\n**执行计划复盘**：${done}/${total} 完成` + (failed ? `，${failed} 失败` : '') + (aborted ? `，${aborted} 中止` : ''))
    for (const s of steps) {
      if (s.status === 'failed') lines.push(`- 失败：${s.label}${s.tool ? ' (' + s.tool + ')' : ''}${s.detail ? ' — ' + s.detail : ''}`)
      else if (s.status === 'aborted') lines.push(`- 中止：${s.label}${s.detail ? ' — ' + s.detail : ''}`)
    }
    const unfinished = steps.filter(s => s.status === 'pending' || s.status === 'paused').map(s => s.label)
    if (unfinished.length) lines.push(`- 未执行：${unfinished.join('、')}`)
    // v0.3.7: 验证闭环 —— 改过文件但没有独立验证命令时给出提醒
    const touchedFiles = steps.some(s => (s.tool === 'write' || s.tool === 'edit' || s.tool === 'apply_patch') && s.status === 'done')
    if (touchedFiles && !this.planHasVerification(task)) lines.push('- [!] 修改过文件但未检测到独立验证命令，建议补充构建/测试/检查')
    return lines.join('\n')
  }

  // ─── v0.3.7: PLANS.md 计划文档(计划式: Progress/Surprises/Decision Log/Outcomes) ───
  private planDocDir(): string {
    return join(this.deps.userDataPath, 'plans')
  }

  private planDocPath(task: TaskState): string {
    return join(this.planDocDir(), task.taskId + '.md')
  }

  private planStamp(): string {
    const d = new Date()
    const p2 = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
  }

  private planAddDecision(task: TaskState, text: string): void {
    task.planDecisions.push('`' + this.planStamp() + '` ' + text)
    if (task.planDecisions.length > 80) task.planDecisions = task.planDecisions.slice(-80)
    this.schedulePlanDoc(task)
  }

  private planAddSurprise(task: TaskState, text: string): void {
    task.planSurprises.push('`' + this.planStamp() + '` ' + text)
    if (task.planSurprises.length > 40) task.planSurprises = task.planSurprises.slice(-40)
    this.schedulePlanDoc(task)
  }

  private buildPlanDoc(task: TaskState): string {
    const goalStatus = task.goal.status === 'completed' ? '已完成' : task.goal.status === 'failed' ? '失败' : task.goal.status === 'aborted' ? '已中止' : '进行中'
    const retro = this.planRetrospective(task)
    return buildPlanDocContent({
      goalObjective: task.goal.objective,
      goalStatus,
      goalProgress: task.goal.progress,
      taskStopped: task.stopped,
      steps: task.planSteps as PlanStepData[],
      surprises: task.planSurprises,
      decisions: task.planDecisions,
      retrospective: retro.replace(/^\n*---\s*\n\n?/, ''),
    })
  }

  private writePlanDoc(task: TaskState): void {
    try {
      fs.mkdirSync(this.planDocDir(), { recursive: true })
      // v0.3.7: 异步写盘, 避免长任务高频节流时阻塞主进程
      const content = this.buildPlanDoc(task)
      void fs.promises.writeFile(this.planDocPath(task), content, 'utf8').catch(() => {})
    } catch { /* 计划文档写入失败不影响主流程 */ }
  }

  private schedulePlanDoc(task: TaskState): void {
    if (task.planDocTimer) return
    task.planDocTimer = setTimeout(() => {
      task.planDocTimer = null
      if (this.tasks.get(task.sid) !== task) return
      this.writePlanDoc(task)
    }, 2000)
  }

  private flushPlanDoc(task: TaskState): void {
    if (task.planDocTimer) { clearTimeout(task.planDocTimer); task.planDocTimer = null }
    this.writePlanDoc(task)
  }

  // v0.3.7: 模型自主计划工具(update_plan) —— 声明/更新计划步骤
  private applyPlanUpdate(task: TaskState, steps: { label?: string; status?: string; expected?: string; id?: string; tool?: string }[]): string {
    let added = 0
    let updated = 0
    for (const s of steps) {
      const label = String(s.label || '').trim()
      if (!label) continue
      // 完成/失败状态只能由引擎按工具实际执行结果写入, 不信任模型在 update_plan 里自报的 done/failed
      const status: PlanStep['status'] = String(s.status || '').trim() === 'paused' ? 'paused' : 'pending'
      let target = s.id ? task.planSteps.find(x => x.id === s.id) : undefined
      // 无 id 时按 label+tool 合并已存在的未认领 pending 步骤, 防止重复 update_plan 产生一模一样条目
      if (!target) {
        target = task.planSteps.find(x => !x.toolCallId && x.status === 'pending' && x.label === label && (s.tool === undefined || x.tool === s.tool))
      }
      if (target) {
        target.label = label
        if (s.expected !== undefined) target.expected = String(s.expected).slice(0, 200)
        if (s.tool !== undefined) target.tool = String(s.tool)
        if (status === 'paused') target.status = 'paused'
        updated++
      } else {
        const step: PlanStep = { id: uuidv4(), label, status, tool: s.tool !== undefined ? String(s.tool) : undefined, expected: s.expected !== undefined ? String(s.expected).slice(0, 200) : undefined }
        task.planSteps.push(step)
        added++
      }
    }
    task.planSteps = dedupePlanSteps(task.planSteps)
    if (added || updated) {
      this.planAddDecision(task, '模型 update_plan：新增 ' + added + ' 步，更新 ' + updated + ' 步（共 ' + task.planSteps.length + ' 步）')
      this.emitPlan(task)
      this.flushPlan(task)
      this.schedulePlanDoc(task)
    }
    return 'ok:plan updated (added ' + added + ', updated ' + updated + '), total ' + task.planSteps.length
  }

  private snapshotTok(sid: string): Record<string, TokenStat> {
    return JSON.parse(JSON.stringify(this.sessTokBySid.get(sid) || {})) as Record<string, TokenStat>
  }

  private async runTask(task: TaskState): Promise<void> {
    const { sid } = task
    try {
      const g = task.g
      task.memoryText = memoryBlockText(task.memory, task.content)
      task.skillsCache = listSkills(this.deps.skillsDirs || [])
      const projectInstr = discoverProjectInstructions(g.workDir || '', (Number(g.projectDocMaxKb) || 32) * 1024)
      task.projectCtx = projectInstr ? { file: projectInstr.files[0].path, content: projectInstr.content, truncated: projectInstr.truncated, dirs: projectInstr.dirs } : null
      task.instrVisited = new Set(task.projectCtx?.dirs || chainDirs(g.workDir || ''))
      // LLM 摘要压缩(实验): 长会话早期消息交给模型压缩, 替代规则截断
      if (g.llmSummary === true && !task.earlySummaryDone && task.messages.length > 40) {
        task.earlySummaryDone = true
        task.earlySummary = await this.makeEarlySummary(task)
      }
      // 视觉任务: 主模型不支持时切换视觉队列, 无队列则用视觉辅助分析
      if (task.images && task.images.length && !isVisionModel(task.model)) {
        const cands = visionCandidates(g, task.providers, task.curP)
        if (cands.length) {
          task.curP = cands[0].p
          task.model = cands[0].model
          task.switchedVision = true
          task.withImages = true
          this.emit({ type: 'agent', sid, agent: task.agent || '', activeAgents: task.activeAgents })
          this.trace('info', 'model.vision-switch', task.model, sid, task.taskId)
        } else {
          // 无任何视觉候选时不再拿纯文本模型硬调 visionOnce, 直接提示配置
          task.userMsg.content = String(task.userMsg.content || '') + '\n\n[未配置可用的视觉辅助模型，图片无法分析。可在 设置→策略→视觉理解 中配置视觉模型优先级。]'
          task.messages = task.messages.map(m => m.id === task.userMsgId ? { ...m, content: task.userMsg.content } : m)
          task.withImages = false
        }
      }

      let maxToolRounds = Number(g.maxToolRounds) || 50
      const maxTaskTokens = Number(g.maxTaskTokens) || 0
      const maxRetry = g.retryCount ?? 3
      const doParallel = g.parallelTools !== false
      const meltLimit = g.meltdownLimit || 3
      const callLLM = this.withEmptyRetry(task)
      // v0.3.4: 微压缩 —— 每轮把最旧一组纯问答折进运行摘要, 分摊压缩成本
      // v0.3.4: 微压缩默认开启(可在 设置→引擎 关闭)
      if (g.microCompact !== false) await this.microCompact(task)

      while (true) {
        task.roundNum++
        if (this.curGen(sid) !== task.myGen) break
        task.interjects = []
        this.emit({ type: 'stage', sid, phase: 'thinking', label: '思考中', detail: '' })
        // 窗口阈值压缩：每轮请求前按真实输入用量判断是否批量压缩旧历史
        await this.maybeCompact(task)

        let res: CallResult = await callLLM(task)
        // 截断续写：保留已生成文本，追加续写请求（最多 4 次），避免整段重生成
        let continueCount = 0
        while (res.truncated && continueCount < 4) {
          continueCount++
          task.pendingText = (task.pendingText || '') + res.text
          this.trace('warn', 'llm.continue', continueCount + '/4', sid, task.taskId)
          res = await this.callLLM(task, Math.min(2 ** continueCount, 32))
        }
        if (res.truncated) {
          task.pendingText = (task.pendingText || '') + res.text
          res = { text: '', tcs: [], truncated: false }
        }
        if (this.curGen(sid) !== task.myGen) break
        const used = this.taskTokensUsed(task)
        const budgetAct = this.budgetAction(task, used, maxTaskTokens)
        if (budgetAct === 'continue') { /* 自动续跑: 保留 res.tcs 继续工具轮 */ }
        else if (budgetExceeded(used, maxTaskTokens)) res = { text: res.text, tcs: [] }

        // v0.3.7: 工具调用即步骤 —— 首批在门禁前生成, 后续批次在工具轮内追加
        if (res.tcs.length) this.planAppend(task, res.tcs, res.text)

        // 计划确认门: 本轮计划未被确认前先给方案等用户批准(新任务首轮/恢复后未完成计划均触发)
        if (res.tcs.length && g.planGate === true && !task.planApproved && !task.planGateChecked) {
          let gateResolve: (v: boolean) => void = () => {}
          const gate = new Promise<boolean>(r => { gateResolve = r })
          task.planPending = { promise: gate.then(() => {}), resolve: gateResolve }
          this.emit({ type: 'plan', sid, summary: task.planSummary || (res.text || '').slice(0, 200), steps: task.planSteps.map(s => ({ ...s })) })
          this.flushPlan(task)
          const ok = await gate
          task.planPending = null
          if (!ok) {
            res = { text: (res.text || '') + '\n\n[用户拒绝了执行计划，任务已中止]', tcs: [] }
            this.planCloseAll(task, 'aborted', '用户拒绝执行')
            this.planAddDecision(task, '用户拒绝执行计划，任务中止')
            this.flushPlan(task)
            this.finalizeTask(task, res, maxTaskTokens)
            task.stopped = true
            break
          }
          task.planApproved = true
          task.planGateChecked = true
          this.planAddDecision(task, '用户批准执行计划（' + task.planSteps.length + ' 步）')
        }

        // 工具轮循环
        let loopRes = await this.runToolLoop(task, res, maxToolRounds, maxRetry, meltLimit, doParallel, maxTaskTokens)
        res = loopRes.res
        maxToolRounds = loopRes.maxToolRounds

        // v0.3.7: 验证强制闭环 —— 改过文件但未运行验证命令时, 注入验证请求(最多 1 轮, 控制效率成本)
        let verifyForced = 0
        while (!res.tcs.length && this.planNeedsVerify(task) && verifyForced < 1 && this.curGen(sid) === task.myGen && !task.stopped) {
          verifyForced++
          this.planAddDecision(task, '强制验证第 ' + verifyForced + ' 轮：检测到文件修改但无验证命令')
          const vmsg: EngineMessage = {
            id: uuidv4(),
            role: 'system',
            content: '[系统提示] 你刚修改了文件，但尚未运行任何验证命令。请立即调用 exec_command 执行验证（构建/测试/语法检查/列出改动确认），确认改动有效后再做最终总结。',
            timestamp: Date.now(),
          }
          task.messages.push(vmsg)
          // v0.3.7: 双源一致 —— 验证注入消息同步给渲染层(system 角色, UI 不显示但随会话持久化)
          this.emit({ type: 'interject', sid, msg: vmsg, kind: 'system' })
          this.checkpoint(task, task.roundNum)
          res = await callLLM(task)
          loopRes = await this.runToolLoop(task, res, maxToolRounds, maxRetry, meltLimit, doParallel, maxTaskTokens)
          res = loopRes.res
          maxToolRounds = loopRes.maxToolRounds
        }

        this.finalizeTask(task, res, maxTaskTokens)
        this.autoReturnIfNeeded(task)
        if (this.curGen(sid) !== task.myGen || task.interjects.length === 0) break
      }
      if (this.curGen(sid) !== task.myGen || task.stopped) this.finishTask(task, 'aborted')
      else this.finishTask(task, 'done')
    } catch (e) {
      const errText = e instanceof Error ? e.message : String(e)
      this.trace('error', 'task.error', errText.slice(0, 300), sid, task.taskId)
      this.emit({ type: 'error', sid, message: errText.slice(0, 500) })
      this.finishTask(task, 'failed', errText)
    } finally {
      task.running = false
      this.runningTasks = Math.max(0, this.runningTasks - 1)
      // 只有当前任务才能清状态；被新任务替换的旧任务不能覆盖新任务忙碌态
      if (this.tasks.get(sid) === task) {
        this.emit({ type: 'stage-clear', sid })
        this.emit({ type: 'stream', sid, streaming: false, executing: false })
        this.emit({ type: 'busy', sid, busy: false })
      }
      if (task.switchedVision && task.origModel) {
        task.curP = task.p
        task.model = task.origModel
      }
    }
  }

  // v0.3.7: 工具轮循环(提取自 runTask, 供主循环与验证强制闭环复用)
  private async runToolLoop(
    task: TaskState,
    res: CallResult,
    maxToolRounds: number,
    maxRetry: number,
    meltLimit: number,
    doParallel: boolean,
    maxTaskTokens: number,
  ): Promise<{ res: CallResult; maxToolRounds: number }> {
    const { sid } = task
    const callLLM = this.withEmptyRetry(task)
    let toolRounds = 0
    while (res.tcs.length > 0) {
      // 动态自动调节: 单批工具轮达到初始上限但仍有工具待执行时, 自动顺延, 直到模型停止调用工具
      if (toolRounds >= maxToolRounds) {
        if (maxToolRounds >= 10000) break
        maxToolRounds = Math.min(maxToolRounds + 50, 10000)
        this.trace('warn', 'tool.rounds-extend', '单批工具轮 ' + toolRounds + ' → 上限自动顺延至 ' + maxToolRounds, sid, task.taskId)
      }
      toolRounds++
      if (this.curGen(sid) !== task.myGen) break
      // v0.3.7: 后续批次的工具调用补充为计划步骤
      if (toolRounds > 1 && res.tcs.length) this.planAppend(task, res.tcs)
      if (task.interjects.length && task.interjects[0].kind === 'retarget') {
        task.toolLog.push({ name: 'retarget-meltdown', args: {}, result: 'E:改向指令熔断', error: true, ms: 0 })
        this.planFailPending(task, '改向熔断')
        break
      }
      const rc = new Map<string, number>()
      for (const t of task.toolLog) { const k = t.name + '::' + JSON.stringify(t.args || {}); rc.set(k, (rc.get(k) || 0) + 1) }
      if (res.tcs.some(tc => (rc.get(tc.name + '::' + JSON.stringify(tc.args || {})) || 0) >= meltLimit)) {
        this.trace('warn', 'tool.meltdown', res.tcs[0].name, sid, task.taskId)
        this.planFailPending(task, '重复调用熔断')
        break
      }
      const logStart = task.toolLog.length
      const stepText = (res.text || '').trim()
      const stepId = res.msgId || task.lastMsgId || uuidv4()
      task.messages.push({ id: stepId, role: 'assistant', content: stepText || null, reasoning_content: res.reasoning || undefined, timestamp: Date.now(), tool_calls: res.tcs.map(tc2 => ({ id: tc2.id, type: 'function', function: { name: tc2.name, arguments: JSON.stringify(tc2.args) } })) })
      this.emit({ type: 'step', sid, id: stepId, content: stepText || null, reasoning: res.reasoning || undefined, toolCalls: res.tcs })
      const planIds = this.planStart(task, res.tcs, stepId)

      const runOne = async (tc: EngineToolCall) => {
        if (task.interjects.length && task.interjects[0].kind === 'retarget') {
          task.toolLog.push({ name: 'retarget-meltdown', args: {}, result: 'E:改向指令熔断', error: true, ms: 0 })
          return { tc, r: 'E:改向指令熔断', ms: 0 }
        }
        let r2 = ''
        let ms = 0
        for (let a = 0; a <= maxRetry; a++) {
          const t0 = Date.now()
          this.emit({ type: 'stage', sid, phase: 'tool', label: '执行 ' + tc.name, detail: JSON.stringify(tc.args || {}).slice(0, 40) })
          r2 = await this.runToolFor(task, tc)
          ms = Date.now() - t0
          if (!r2.startsWith('E:')) break
          if (a < maxRetry) await new Promise(r => setTimeout(r, backoffDelay(a, 500, 8000)))
        }
        task.toolLog.push({ name: tc.name, args: tc.args, result: r2, error: r2.startsWith('E:'), ms, toolCallId: tc.id })
        this.trace(r2.startsWith('E:') ? 'warn' : 'info', 'tool', tc.name + ' ' + ms + 'ms', sid, tc.id)
        return { tc, r: r2, ms }
      }
      const writes = ['write', 'edit', 'apply_patch', 'exec_command', 'mkdir', 'codebox']
      const results: { tc: EngineToolCall; r: string; ms: number }[] = []
      if (doParallel) {
        const readTcs = res.tcs.filter(tc => !writes.includes(tc.name))
        const writeTcs = res.tcs.filter(tc => writes.includes(tc.name))
        results.push(...(await Promise.all(readTcs.map(runOne))))
        for (const tc of writeTcs) results.push(await runOne(tc))
      } else {
        for (const tc of res.tcs) results.push(await runOne(tc))
      }
      // v0.3.5 T1: 并行结果总量护栏 —— 结果数 >4 且总字符 >6000 时, 保留前 4 大结果全量, 其余瘦身
      if (task.g.perf?.parallelCap !== false && results.length > 4) {
        const totalLen = results.reduce((s, x) => s + x.r.length, 0)
        if (totalLen > 6000) {
          const ranked = [...results].sort((a, b) => b.r.length - a.r.length)
          const keepFull = new Set(ranked.slice(0, 4))
          for (const x of results) if (!keepFull.has(x)) x.r = slimToolResult(x.r)
        }
      }
      this.planFinish(task, planIds, results.map(x => ({ r: x.r, ms: x.ms })))
      for (const { tc, r } of results) {
        const toolMsg: EngineMessage = { id: uuidv4(), role: 'tool', content: r, timestamp: Date.now(), tool_call_id: tc.id }
        task.messages.push(toolMsg)
        this.emit({ type: 'tool-msg', sid, msg: toolMsg })
      }
      const roundLog = task.toolLog.slice(logStart)
      if (roundLog.length) this.emit({ type: 'tool-log', sid, stepId, log: roundLog })
      // 断点: 每 5 轮或 30s 落盘 + 通知渲染层保存会话
      if (toolRounds % 5 === 0 || Date.now() - task.lastMidSave > 30000) {
        task.lastMidSave = Date.now()
        this.checkpoint(task, toolRounds)
      }
      task.interjects = []
      if (this.curGen(sid) !== task.myGen) break
      // 多模型策略: 代码类任务切 codeModel, 文档类切 longTextModel
      const toolNames = res.tcs.map(tc => tc.name)
      if (toolNames.some(n => ['write', 'edit', 'apply_patch', 'exec_command', 'mkdir', 'codebox', 'grep', 'read'].includes(n))) {
        const cm = resolveModelOf(task.g, task.providers, task.curP, 'codeModel')
        if (cm) { task.curP = cm.p; task.model = cm.model }
      } else if (toolNames.some(n => ['save_memory', 'recall_memory', 'web_search', 'web_fetch', 'import_doc'].includes(n))) {
        const lm = resolveModelOf(task.g, task.providers, task.curP, 'longTextModel')
        if (lm) { task.curP = lm.p; task.model = lm.model }
      }
      this.emit({ type: 'stage', sid, phase: 'thinking', label: '思考中', detail: '' })
      if (this.curGen(sid) !== task.myGen) break
      res = await callLLM(task)
      const used2 = this.taskTokensUsed(task)
      const budgetAct2 = this.budgetAction(task, used2, maxTaskTokens)
      if (budgetAct2 === 'continue') { /* 自动续跑: 保留 tcs */ }
      else if (budgetExceeded(used2, maxTaskTokens)) res = { text: res.text, tcs: [] }
      if (this.curGen(sid) !== task.myGen) break
    }
    return { res, maxToolRounds }
  }

  // v0.3.7: 是否需要强制验证 —— 改过文件(write/edit/apply_patch)但没有任何验证命令(exec_command/codebox)
  private planNeedsVerify(task: TaskState): boolean {
    return planNeedsVerifyCore(task.planSteps as PlanStepData[])
  }

  // 修改之后是否有验证步骤(read 确认 / exec_command / codebox)
  private planHasVerification(task: TaskState, firstWriteIdx = -1): boolean {
    return planHasVerificationCore(task.planSteps as PlanStepData[], firstWriteIdx)
  }

  // 消息模型: 任务流只允许「用户消息 / 步骤卡 / 最终回复」三种消息。
  // 流式文字走临时通道(不落消息), 步骤文字随步骤卡落一条, 最终回复作为独立消息追加。
  // 不创建占位消息 → 不存在“卡片前重复”的架构性可能。
  private finalizeTask(task: TaskState, res: CallResult, _maxTaskTokens: number): void {
    const { sid } = task
    // v0.3.7: Goal 进度与计划同步
    const gTotal = task.planSteps.length
    const gDone = task.planSteps.filter(s => s.status === 'done').length
    if (gTotal) task.goal.progress = gDone + '/' + gTotal + ' 完成'
    // v0.3.7: 生成复盘前先收尾步骤状态, 保证统计准确(运行中按任务是否中止收尾)
    for (const st of task.planSteps) {
      if (st.status === 'running') st.status = task.stopped ? 'aborted' : 'done'
      else if (st.status === 'pending' || st.status === 'paused') {
        st.status = 'aborted'
        st.detail = (st.detail ? st.detail + ' · ' : '') + '未执行'
      }
    }
    let finalText = ((task.pendingText || '') + (res.text || '')).trim()
    task.pendingText = ''
    // v0.3.7: 计划复盘 —— 有工具步骤的任务自动附加结构化复盘
    if (task.planSteps.length) {
      const retro = this.planRetrospective(task)
      if (retro) finalText = (finalText ? finalText + retro : retro.trim())
    }
    const finalId = res.msgId || task.lastMsgId || uuidv4()
    task.messages.push({
      id: finalId,
      role: 'assistant',
      content: finalText || null,
      reasoning_content: res.reasoning || undefined,
      timestamp: Date.now(),
      _toolLog: task.toolLog.length ? task.toolLog : undefined,
    })
    const taskTokens = this.taskTokensUsed(task)
    const taskMs = Date.now() - (task.userMsg.timestamp || Date.now())
    this.emit({ type: 'final', sid, id: finalId, content: finalText, reasoning: res.reasoning || undefined, toolLog: task.toolLog, taskTokens, taskMs })
    if (res.usage) this.emit({ type: 'assistant-usage', sid, id: finalId, usage: res.usage })
    this.planAddDecision(task, '任务结束，生成复盘')
    this.flushPlanDoc(task)
    this.emit({ type: 'stage-clear', sid })
  }

  // v0.3.7: 预算处理 —— 未超限返回 none; 开启自动继续且未到上限时重置已用量继续; 否则返回 none 由调用处结束本轮
  private budgetAction(task: TaskState, used: number, max: number): 'none' | 'continue' {
    if (!budgetExceeded(used, max)) return 'none'
    const auto = task.g.longTaskAutoContinue === true
    const autoMax = Number(task.g.longTaskAutoMax) || 5
    if (auto && (task.autoContinueCount || 0) < autoMax) {
      task.autoContinueCount = (task.autoContinueCount || 0) + 1
      // 重置预算基数: 续跑按新一段用量计, 不立即再次超限
      task.tokBase = this.snapshotTok(task.sid)
      this.planAddDecision(task, '预算自动续跑第 ' + task.autoContinueCount + ' 次（重置用量基数）')
      this.trace('warn', 'task.budget-auto-continue', (task.autoContinueCount || 0) + '/' + autoMax, task.sid, task.taskId)
      return 'continue'
    }
    return 'none'
  }

  // 交接完成后自动交回: 被交接角色输出最终结果后, 身份回到上一角色(默认开启, 可在 设置→协作 关闭)
  private autoReturnIfNeeded(task: TaskState): void {
    if (task.g.handoffAutoReturn === false || !task.handoffStack.length) return
    const prev = task.handoffStack.pop()
    if (!prev) return
    task.agent = prev
    task.handoffAt = -1
    this.emit({ type: 'agent', sid: task.sid, agent: prev, activeAgents: task.activeAgents })
    this.trace('info', 'handoff.auto-return', prev, task.sid, task.taskId)
  }

  private finishTask(task: TaskState, status: 'done' | 'failed' | 'aborted', error?: string): void {
    // v0.3.7: 防重入 —— stop() 可能同步收尾, runTask 收尾再调用时直接跳过
    if (task.taskFinished) return
    task.taskFinished = true
    // 任务结束清除插话标记, 避免历史插话在后续请求里被持续重排到末尾
    task.messages = task.messages.map(m => m._inject ? { ...m, _inject: false } : m)
    // v0.3.7: Goal 生命周期收尾
    task.goal = { ...task.goal, status: status === 'done' ? 'completed' : status === 'failed' ? 'failed' : 'aborted' }
    // v0.3.7: 收尾未完成步骤 —— 中止标 aborted, 失败标 failed
    if (status !== 'done') this.planCloseAll(task, status === 'failed' ? 'failed' : 'aborted', status === 'failed' ? (error || '任务失败') : (error || '任务中止'))
    else {
      // 任务正常完成: 未认领/未执行的步骤标为未执行, 遗留 running 视为完成
      for (const st of task.planSteps) {
        if (st.status === 'running') st.status = 'done'
        else if (st.status === 'pending' || st.status === 'paused') {
          st.status = 'aborted'
          st.detail = (st.detail ? st.detail + ' · ' : '') + '未执行'
        }
      }
    }
    this.flushPlan(task)
    this.flushPlanDoc(task)
    closeTerminalSessions(task.sid)
    finishTask(task.taskId, status, error)
    // v0.3.8: 失败归因 —— 附带第一个失败步骤, 便于界面直接定位
    let failedStep: { label: string; tool?: string; detail?: string; messageId?: string } | undefined
    if (status === 'failed') {
      const bad = task.planSteps.find(s => s.status === 'failed')
      if (bad) failedStep = { label: bad.label, tool: bad.tool, detail: bad.detail, messageId: bad.messageId }
    }
    // v0.3.8: 文件快照持久化 —— 写操作过的文件保存原内容, 供一键回滚
    const fileChanges = Object.keys(task.fileSnapshots).length
    if (fileChanges) {
      try {
        const dir = join(this.deps.userDataPath, 'rollback')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(join(dir, task.taskId + '.json'), JSON.stringify({ taskId: task.taskId, sid: task.sid, content: String(task.content || '').slice(0, 200), at: Date.now(), files: task.fileSnapshots }), 'utf-8')
      } catch { /* 快照落盘失败不影响任务 */ }
    }
    this.emit({ type: 'task-done', sid: task.sid, taskId: task.taskId, status, error, failedStep, fileChanges })
    runHooks(task.g, 'task-end', { sid: task.sid, taskId: task.taskId, status })
  }

  private checkpoint(task: TaskState, round: number): void {
    // 断点剥离图片 dataURL(体积大), 原图仍在会话文件中
    const cpMsgs = task.messages.map(m => m.images && m.images.length ? { ...m, images: ['[图片已从断点剥离，原图以会话记录为准]'] } : m)
    updateTask(task.taskId, { checkpoint: { messages: cpMsgs, agent: task.agent, activeAgents: task.activeAgents, model: task.model, round, provider: task.curP, handoffAt: task.handoffAt, handoffStack: task.handoffStack, handoffCounts: task.handoffCounts, planSteps: task.planSteps.map(s => ({ ...s })), planSummary: task.planSummary, planSurprises: task.planSurprises, planDecisions: task.planDecisions, goal: { ...task.goal } } })
  }

  private findProvider(cp: unknown, providers: EngineProvider[], fallback: EngineProvider): EngineProvider {
    const c = cp as EngineProvider | undefined
    if (c && c.id) {
      const hit = providers.find(x => x.id === c.id)
      if (hit) return hit
    }
    return fallback
  }

  private withEmptyRetry(_task: TaskState): (t: TaskState) => Promise<CallResult> {
    return async (t: TaskState): Promise<CallResult> => {
      let capBoost = 1
      const rid = 'r' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      // 必须带完整随机后缀: slice(0,8) 只留时间戳前缀, 同一任务 100 秒内所有轮次会共用同一 id,
      // 导致 step/final 互相覆盖(最终回复盖掉最后一步)
      t.lastMsgId = 'm-' + t.taskId + '-' + rid
      for (let i = 0; ; i++) {
        try {
          return await this.callLLM(t, capBoost, t.lastMsgId)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (this.curGen(t.sid) !== t.myGen || t.stopped) throw e
          if (i < 5 && /(空响应|响应超时)/.test(msg)) {
            this.trace('warn', 'llm.empty-retry', (i + 1) + '/5', t.sid, t.taskId)
            await new Promise(r => setTimeout(r, backoffDelay(i, 800, 10000)))
            continue
          }
          // v0.3.3: 工具调用/输出被截断 → 自动放大输出上限重试(2x→4x→…→32x), 直到装得下大工具参数
          if (i < 5 && /(工具调用流不完整|工具调用参数不完整|输出被截断)/.test(msg)) {
            capBoost = Math.min(capBoost * 2, 32)
            this.trace('warn', 'llm.cap-boost', capBoost + 'x', t.sid, t.taskId)
            await new Promise(r => setTimeout(r, backoffDelay(i, 800, 10000)))
            continue
          }
          // v0.3.8: 非可重试错误 → 降级备用模型重试一次(同供应商其他模型优先, 其次其他有 key 的供应商; 每任务最多降级一次)
          t.modelFailCount = (t.modelFailCount || 0) + 1
          if (!t.modelFallbackUsed && this.switchFallbackModel(t)) {
            await new Promise(r => setTimeout(r, backoffDelay(i, 800, 10000)))
            continue
          }
          throw e
        }
      }
    }
  }

  // v0.3.8: 切换到备用模型 —— 返回是否切换成功
  private switchFallbackModel(task: TaskState): boolean {
    const old = task.model
    // 优先: 同供应商的其他模型
    const sameProvModels = (task.curP.models || []).filter(m => m && m !== old)
    if (sameProvModels.length) {
      task.model = sameProvModels[0]
    task.modelFailCount = 0
    task.modelFallbackUsed = true
    this.planAddDecision(task, '主模型 ' + old + ' 失败，切换同供应商模型 ' + task.model)
    this.trace('warn', 'model.fallback', old + ' → ' + task.model, task.sid, task.taskId)
    runHooks(task.g, 'model-fallback', { sid: task.sid, taskId: task.taskId, from: old, to: task.model })
    return true
    }
    // 其次: 其他有 key 的供应商
    const alt = task.providers.find(x => x.apiKey && x.baseUrl && x.id !== task.curP.id)
    if (!alt) return false
    task.curP = alt
    task.model = alt.selectedModel || (alt.models && alt.models[0]) || old
    task.modelFailCount = 0
    task.modelFallbackUsed = true
    this.planAddDecision(task, '主模型 ' + old + ' 连续失败，降级到 ' + task.model)
    this.trace('warn', 'model.fallback', old + ' → ' + task.model, task.sid, task.taskId)
    return true
  }

  // v0.3.3: 输出上限按轮次自适应 —— 纯聊天(无工具)用省钱档 800;
  // 工具轮必须给工具参数(尤其 write 大代码)留足空间, 截断重试时按 2 的幂放大
  private roundMaxTokens(task: TaskState, tools: EngineToolSpec[], capBoost: number): number | undefined {
    if (!tools.length) return outputLimit(task.content, task.g)
    const base = Number(task.g.maxTokens) || 4096
    return Math.min(base * Math.max(1, Math.min(capBoost, 32)), 65536)
  }

  private async callLLM(task: TaskState, capBoost = 1, msgId?: string): Promise<CallResult> {
    const { sid } = task
    const rid = msgId || ('m-' + task.taskId + '-' + 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
    // 流式文字走临时通道: 不落消息, 最终由 step/final 事件承载
    return new Promise<CallResult>((resolve, reject) => {
      let text = ''
      let reasoning = ''
      const tcs: EngineToolCall[] = []
      const t0 = Date.now()
      let firstChunkAt = 0
      let settled = false
      let lastUsage: EngineUsage | null = null
      let finishReason: string | undefined
      let argsBroken = false
      let flushTimer: NodeJS.Timeout | null = null
      // v0.3.6 P1-5: 流式增量 —— 只发上次到现在的 delta, 避免长回复 O(n²) IPC 传输
      let lastSent = 0
      // reasoning 默认折叠展示, 与正文不同频: 每 +300 字符或 300ms 才发一次全量
      let lastReasonLen = 0
      let lastReasonAt = 0
      const flush = () => {
        flushTimer = null
        const delta = text.slice(lastSent)
        lastSent = text.length
        const now = Date.now()
        const sendReason = reasoning.length > 0 && (reasoning.length > lastReasonLen + 300 || now - lastReasonAt >= 300)
          ? reasoning
          : undefined
        if (sendReason !== undefined) {
          lastReasonLen = reasoning.length
          lastReasonAt = now
        }
        this.emit({ type: 'assistant-chunk', sid, id: rid, delta, reasoning: sendReason, streaming: true })
      }
      const settle = () => {
        if (settled) return
        settled = true
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
        this.emit({ type: 'assistant-chunk', sid, id: rid, delta: text.slice(lastSent), reasoning: reasoning || undefined, streaming: false })
        const ttft = firstChunkAt ? firstChunkAt - t0 : Date.now() - t0
        const duration = Date.now() - t0
        this.trace('info', 'llm.round', 'text=' + text.length + ' tools=' + tcs.length, sid, rid)
        const aborted = this.curGen(sid) !== task.myGen || task.stopped
        if (!text && !tcs.length && !aborted) {
          reject(new Error('模型返回空响应，请检查 API 配置或切换模型')); return
        }
        // 用户停止/任务中止: 不当作异常, 直接返回让主循环退出(禁止停止后继续重试)
        if (aborted) { resolve({ text, reasoning: reasoning || undefined, tcs, usage: lastUsage || undefined }); return }
        // v0.3.3: 工具调用丢失 / 参数不完整 / 输出被截断 —— 绝不把半截响应当最终回复, 交给重试
        if (argsBroken && tcs.length) { reject(new Error('模型工具调用参数不完整（参数解析失败），重试中')); return }
        if (finishReason === 'tool_calls' && tcs.length === 0) { reject(new Error('模型工具调用流不完整（工具调用丢失），重试中')); return }
        if (finishReason === 'length' && tcs.length === 0 && text) {
          // 截断续写：保留已生成文本，由上层追加续写请求（避免整段重生成）
          this.trace('warn', 'llm.truncated', 'partial ' + text.length + ' chars', sid, rid)
          resolve({ text, reasoning: reasoning || undefined, tcs: [], truncated: true, usage: lastUsage || undefined, msgId: rid })
          return
        }
        resolve({ text, reasoning: reasoning || undefined, tcs, ttft, duration, usage: lastUsage || undefined, msgId: rid })
      }
      const msgs = this.buildMsgs(task, isVisionModel(task.model), task.withImages)
      // 截断续写：把已生成部分作为 assistant 消息注入，要求模型从断点继续
      if (task.pendingText) {
        msgs.push({ role: 'assistant', content: task.pendingText })
        msgs.push({ role: 'user', content: '[输出被截断，请从断点继续，不要重复已经写过的内容]' })
      }
      const tools = getActiveTools(this.buildToolCtx(task))
      const maxTokens = this.roundMaxTokens(task, tools, capBoost)
      void streamChat(this.deps.netFetch, {
        provider: task.curP.type,
        model: task.model,
        apiKey: task.curP.apiKey,
        baseUrl: task.curP.baseUrl,
        messages: msgs as unknown as LlmMsg[],
        temperature: Number(task.g.temperature) || 0.7,
        max_tokens: maxTokens,
        tools,
        thinkLevel: resolveThinkLevelOf(task.g, task.model),
        headers: task.curP.headers,
        requestId: rid,
        sid,
      }, {
        onChunk: d => {
          if (d.done) { if (d.finishReason) finishReason = d.finishReason; settle(); return }
          if (d.content) {
            if (!firstChunkAt) firstChunkAt = Date.now()
            text += d.content
            if (!flushTimer) flushTimer = setTimeout(flush, text.length > 4096 ? 90 : 40)
          }
          if (d.reasoning) {
            // 兼容累积型/增量型网关: 整段覆盖优先, 否则只追加新片段, 避免重复
            if (!reasoning) reasoning = d.reasoning
            else if (d.reasoning.startsWith(reasoning)) reasoning = d.reasoning
            else if (!reasoning.endsWith(d.reasoning)) reasoning += d.reasoning
            if (!firstChunkAt) firstChunkAt = Date.now()
            if (!flushTimer) flushTimer = setTimeout(flush, text.length > 4096 ? 90 : 40)
          }
        },
        onToolCall: tc => {
          try {
            if (tc?.function?.name) {
              const raw = (tc.function.arguments || '').trim()
              tcs.push({ id: tc.id || ('c' + Date.now()), name: tc.function.name, args: raw ? JSON.parse(raw) : {} })
            }
          } catch {
            // v0.3.3: 参数被截断/非 JSON 时不再静默丢弃 —— settle 阶段按「参数不完整」重试
            argsBroken = true
          }
        },
        onUsage: u => {
          lastUsage = u
          this.recordUsage(task, rid, u)
        },
        onError: e => {
          if (settled) return
          settled = true
          const em = e as { error?: string; requestId?: string }
          reject(new Error(typeof e === 'string' ? e : (em?.error || String(e))))
        },
      })
    })
  }

  private buildMsgs(task: TaskState, withImages: boolean, forceWithImages: boolean): unknown[] {
    const agents = getAgents(task.g.agentOverrides as Record<string, Partial<AgentDef>> | undefined)
    const messages = buildContextualMessages(task.messages, forceWithImages || withImages, {
      g: task.g,
      cl: getModelContextLimit(task.model),
      spIshiki: String(task.g.ishiki || ''),
      sp: buildPrompt(task.g.mode || 'work', String(task.g.ishiki || ''), task.g, agents, task.g.workDir || '', task.skillsCache || listSkills(this.deps.skillsDirs || []), task.g.planGate === true && !task.planApproved),
      agent: task.agent,
      handoffFrom: task.handoffAt,
      memoryText: task.memoryText,
      projectCtx: task.projectCtx || undefined,
      model: task.model,
      workflowsFull: (task.g.perf?.workflowLazy === false),
      agents,
      mode: task.g.mode || 'work',
      earlySummary: task.earlySummary,
    })
    return messages as unknown[]
  }

  private buildToolCtx(task: TaskState): ToolRunCtx {
    return {
      sid: task.sid,
      taskId: task.taskId,
      g: task.g,
      agents: getAgents(task.g.agentOverrides as Record<string, Partial<AgentDef>> | undefined),
      agent: task.agent,
      activeAgents: task.activeAgents,
      workDir: task.g.workDir || '',
      memoryPath: this.deps.memoryPath,
      userDataPath: this.deps.userDataPath,
      skillsDirs: this.deps.skillsDirs,
      sender: this.deps.getSender(),
      getMemory: () => task.memory,
      saveMemory: (m: EngineMemory) => { task.memory = m; saveMemory(this.deps.memoryPath, m) },
      onAgentChange: (agent: string) => {
        task.agent = agent
        if (!task.activeAgents.includes(agent)) task.activeAgents = [...task.activeAgents, agent]
        this.emit({ type: 'agent', sid: task.sid, agent, activeAgents: task.activeAgents })
      },
      onWorkDirChange: (dir: string) => {
        task.g.workDir = dir
        this.emit({ type: 'ui', sid: task.sid, workDir: dir })
      },
      onThemeChange: (theme: string) => {
        this.emit({ type: 'ui', sid: task.sid, theme })
      },
      onPlanUpdate: (steps) => this.applyPlanUpdate(task, steps),
      onGoalUpdate: (goalText) => {
        task.goal = { objective: String(goalText).slice(0, 500), status: 'active', startedAt: task.goal.startedAt }
        this.schedulePlanDoc(task)
      },
      runDispatch: (dTasks) => this.runDispatch(task, dTasks),
      getHandoffCounts: () => ({ ...task.handoffCounts }),
      onHandoffRecord: (agent: string) => {
        if (task.agent) task.handoffStack.push(task.agent)
        task.handoffAt = task.messages.length
        task.handoffCounts[agent] = (task.handoffCounts[agent] || 0) + 1
      },
      logTrace: (level, event, detail) => this.trace(level, event, detail, task.sid, task.taskId),
    }
  }

  private async runToolFor(task: TaskState, tc: EngineToolCall): Promise<string> {
    runHooks(task.g, 'tool-before', { tool: tc.name, sid: task.sid, taskId: task.taskId })
    // v0.3.8: 文件快照 —— 写操作前记录原内容, 任务结束可一键回滚
    if (['write', 'edit', 'apply_patch'].includes(tc.name)) {
      const p = String((tc.args || {}).path || '')
      if (p && !(p in task.fileSnapshots) && Object.keys(task.fileSnapshots).length < 50) {
        try {
          task.fileSnapshots[p] = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').slice(0, 5 * 1024 * 1024) : null
          if (fs.existsSync(p) && fs.statSync(p).size > 5 * 1024 * 1024) task.fileSnapshots[p] = '__SKIP__'
        } catch { task.fileSnapshots[p] = null }
      }
    }
    // v0.3.8: 计划模式 —— 批准前只允许只读/规划类工具, 模型先探索并输出计划
    if (task.g.planGate === true && !task.planApproved && !isPlanReadonlyTool(tc.name, tc.args)) {
      return 'E:计划阶段只读：当前处于计划确认阶段，只能读取/检索与规划（read/ls/grep/find/web_search/update_plan 等），请先输出执行计划等待批准'
    }
    // v0.3.3: browser_vision 需要引擎的视觉模型队列(截图 + 视觉通道回答)
    let r: string
    if (tc.name === 'browser_vision') r = await this.runBrowserVision(task, tc)
    else {
      const ctx = this.buildToolCtx(task)
      r = await runTool(tc.name, tc.args, ctx)
    }
    // v0.3.8: 子目录项目指令按需注入 —— 模型读取/操作某目录文件时, 自动把该目录(上溯 5 层)的规则附加到工具结果
    if (r.startsWith('E:')) { /* 工具失败不注入, 避免混淆错误信息 */ } else {
      r = this.attachSubdirInstructions(task, tc, r)
    }
    runHooks(task.g, 'tool-after', { tool: tc.name, sid: task.sid, taskId: task.taskId, result: r.slice(0, 200) })
    if (['write', 'edit', 'apply_patch'].includes(tc.name) && !r.startsWith('E:')) {
      runHooks(task.g, 'file-write', { tool: tc.name, sid: task.sid, taskId: task.taskId, path: String((tc.args || {}).path || '') })
    }
    return r
  }

  // 从工具参数里提取文件/目录路径(含 exec_command 中带引号的 Windows 路径)
  private extractToolPaths(tc: EngineToolCall): string[] {
    const a = tc.args || {}
    const out: string[] = []
    const push = (v: unknown): void => { if (typeof v === 'string' && v.trim()) out.push(v.trim()) }
    push(a.path)
    push(a.dirPath)
    push(a.targetPath)
    if (typeof a.cmd === 'string' && a.cmd) {
      const m = String(a.cmd).match(/(?:^|[\s'"])([A-Za-z]:\\[^\s"'<>|]+)/g)
      if (m) for (const x of m) out.push(x.replace(/^[\s'"]/, '').trim())
    }
    return out
  }

  private attachSubdirInstructions(task: TaskState, tc: EngineToolCall, result: string): string {
    const workDir = task.g.workDir || ''
    const found = new Map<string, InstructionFile>()
    for (const raw of this.extractToolPaths(tc)) {
      const p = isAbsolute(raw) ? raw : join(workDir, raw)
      for (const f of collectSubdirInstructions(p, task.instrVisited)) found.set(f.path, f)
    }
    if (!found.size) return result
    const block = [...found.values()].map(f => `## ${f.path}\n${f.content}`).join('\n\n')
    return result + '\n\n--- 目录项目指令(读取该目录时自动注入) ---\n' + block
  }

  private async runBrowserVision(task: TaskState, tc: EngineToolCall): Promise<string> {
    const q = String((tc.args as { question?: unknown })?.question || '').trim() || '描述这张网页截图'
    const img = String(await invokeHandler('browser:screenshot', [undefined, task.sid + '::' + task.taskId], this.deps.getSender()))
    if (!img || img.startsWith('E:') || img.length < 100) return 'E:页面截图失败: ' + (img || '空')
    const cands = visionCandidates(task.g, task.providers, task.curP)
    if (!cands.length) return 'E:未配置视觉理解模型(设置→策略→视觉理解)'
    let lastErr = ''
    for (const c of cands) {
      try {
        const r = await visionOnce(this.deps.netFetch, {
          provider: c.p.type,
          model: c.model,
          apiKey: c.p.apiKey,
          baseUrl: c.p.baseUrl,
          imageDataUrl: img,
          prompt: q,
          customHeaders: c.p.headers,
        })
        if (!r.startsWith('E:')) return r
        lastErr = r
      } catch (e) { lastErr = e instanceof Error ? e.message : String(e) }
    }
    return 'E:视觉分析失败: ' + lastErr
  }

  private recordUsage(task: TaskState, rid: string, u: EngineUsage, modelOverride?: string): void {
    // 同一次请求 usage 可能多次到达(部分供应商流中+结束时各发一次), 按 requestId 去重防统计虚高
    if (this.costedReqs.has(rid)) return
    if (this.costedReqs.size > 500) {
      const arr = [...this.costedReqs]
      this.costedReqs.clear()
      for (const x of arr.slice(-250)) this.costedReqs.add(x)
    }
    this.costedReqs.add(rid)
    // v0.3.5: 多供应商缓存字段统一归一化(DeepSeek/SiliconFlow/Kimi/OpenAI/智谱/通义/Anthropic/Gemini)
    const n = normalizeUsage(u)
    const readT = n.readT
    const missT = n.missT
    const writeT = n.writeT
    const inputT = n.inputT
    const outT = n.outputT
    // v0.3.6: 供应商缓存能力判定 —— 不支持的供应商界面直接标注"不支持", 不再显示虚假的 0% 命中率
    const cap = classifyCacheSupport(task.curP, n.sawCache)
    const mk = modelOverride || task.model
    const cur = this.sessTokBySid.get(task.sid) || {}
    const c = cur[mk] || { requests: 0, readTokens: 0, inputTokens: 0, writeTokens: 0, outputTokens: 0, hitReqs: 0 }
    c.requests += 1
    c.readTokens += readT
    c.inputTokens += inputT
    c.writeTokens += writeT
    c.outputTokens += outT
    c.hitReqs += readT > 0 ? 1 : 0
    cur[mk] = c
    this.sessTokBySid.set(task.sid, cur)
    this.emit({ type: 'usage', sid: task.sid, model: mk, usage: { ...u, _readTokens: readT, _missTokens: missT, _inputTokens: inputT, _writeTokens: writeT } })
    // v0.3.3: 上下文环数据源 —— 每次请求的真实 prompt 输入 + 模型上下文上限
    const used = n.rawInputT
    const limit = getModelContextLimit(mk)
    if (used > 0) task.lastPromptTokens = used
    if (used > 0) this.emit({ type: 'context', sid: task.sid, used, limit })
    try {
      // v0.3.6: 只有确认支持缓存统计的请求计入观测分母(命中率 = 命中请求 ÷ 有观测请求)
      void invokeHandler('modelStats:recordRequest', [task.sid, mk, readT > 0, cacheCapToSupported(cap)], null)
      if (readT > 0 || inputT > 0 || writeT > 0 || missT > 0) {
        void invokeHandler('modelStats:recordTokens', [task.sid, mk, readT, inputT, writeT, missT, {
          supported: cacheCapToSupported(cap),
          provider: task.curP?.name,
        }], null)
        // v0.3.6: 逐请求明细(请求明细/按日期/按类别视图的数据源)
        void invokeHandler('modelStats:recordEntry', [{
          sid: task.sid,
          model: mk,
          provider: task.curP?.name,
          readTokens: readT,
          missTokens: missT,
          writeTokens: writeT,
          inputTokens: inputT,
          outputTokens: outT,
          hit: readT > 0,
          supported: cacheCapToSupported(cap),
        }], null)
      }
    } catch { /* 忽略 */ }
  }

  private taskTokensUsed(task: TaskState): number {
    const now = this.sessTokBySid.get(task.sid) || {}
    const base = task.tokBase
    let used = 0
    for (const [mk, c] of Object.entries(now)) {
      const b = base[mk] || {}
      used += (c.inputTokens - (b.inputTokens || 0)) + (c.outputTokens - (b.outputTokens || 0)) + (c.writeTokens - (b.writeTokens || 0))
    }
    return Math.max(0, used)
  }

  private async makeEarlySummary(task: TaskState): Promise<string> {
    try {
      const early = task.messages.slice(0, -30).filter(m => typeof m.content === 'string' && m.content).slice(0, 60)
      if (!early.length) return ''
      const text = early.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${String(m.content).slice(0, 200)}`).join('\n')
      const r = await chatOnce(this.deps.netFetch, {
        provider: task.curP.type,
        model: task.model,
        apiKey: task.curP.apiKey,
        baseUrl: task.curP.baseUrl,
        messages: [
          { role: 'system', content: '你是黄泉Agent。请把下面的早期对话压缩成 200 字以内的要点总结，保留事实、路径、结论。只输出总结。' },
          { role: 'user', content: text.slice(0, 12000) },
        ],
      })
      return r.startsWith('E:') ? '' : r
    } catch { return '' }
  }

  // v0.3.4: 微压缩 —— 每轮把最旧的一组纯问答折进运行摘要, 分摊压缩成本
  private async microCompact(task: TaskState): Promise<void> {
    const msgs = task.messages
    if (!msgs || msgs.length < 12) return
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserIdx = i; break }
    }
    // 找最旧一组“用户→助手(无工具调用)”的完整问答
    let foldStart = -1
    let foldEnd = -1
    for (let i = 0; i < msgs.length - 1 && (lastUserIdx < 0 || i < lastUserIdx); i++) {
      if (msgs[i].role !== 'user') continue
      const a = msgs[i + 1]
      if (!a || a.role !== 'assistant' || a.tool_calls?.length || !a.content) continue
      // 确保这段问答后不是挂在工具轮里
      if (msgs[i + 2] && msgs[i + 2].role === 'tool') continue
      foldStart = i
      foldEnd = i + 2
      break
    }
    if (foldStart < 0) return
    const uText = String(msgs[foldStart].content || '').slice(0, 1200)
    const aText = String(msgs[foldEnd - 1].content || '').slice(0, 1600)
    try {
      runHooks(task.g, 'compact-before', { sid: task.sid, taskId: task.taskId, kind: 'micro' })
      const rid = 'micro_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
      const summary = await chatOnce(this.deps.netFetch, {
        provider: task.curP.type,
        model: task.model,
        apiKey: task.curP.apiKey,
        baseUrl: task.curP.baseUrl,
        messages: [
          { role: 'system', content: '把下面的问答压缩成 200 字以内的要点，保留事实、路径、结论，不编造。只输出摘要。' },
          { role: 'user', content: '问：' + uText + '\n答：' + aText },
        ],
      }, u => this.recordUsage(task, rid, u as EngineUsage))
      if (!summary || summary.startsWith('E:')) return
      const folded = String(summary).slice(0, 500)
      const foldedMsg: EngineMessage = { id: uuidv4(), role: 'user', content: '[早期对话摘要]\n' + folded, timestamp: Date.now() }
      task.messages = [...msgs.slice(0, foldStart), foldedMsg, ...msgs.slice(foldEnd)]
      task.earlySummary = (task.earlySummary ? task.earlySummary + '\n' : '') + folded
      this.emit({ type: 'compact', sid: task.sid, messages: task.messages })
      this.trace('info', 'task.micro-compact', 'folded ' + (foldEnd - foldStart) + ' msgs', task.sid, task.taskId)
    } catch { /* 压缩失败不影响主流程 */ }
  }

  // 窗口阈值压缩：用最近一次请求的真实输入 token 判断，接近模型窗口上限时
  // 把最旧的完整轮次交给摘要请求压成一条摘要，保留最近 N 轮完整上下文。
  // 与微压缩互补：微压缩持续小额折并，这里兜底防止窗口溢出。
  private async maybeCompact(task: TaskState): Promise<void> {
    try {
      if (task.g.perf?.compactSummary === false || task.g.compactSummary === false) return
      const limit = getModelContextLimit(task.model)
      if (!limit) return
      // 阈值解析：按模型覆盖 > 全局百分比；小窗口模型地板 0.75（仅无显式配置时生效）
      const explicit = task.g.compactOverrides?.[task.model] || task.g.compactThreshold
      let ratio = resolveCompactRatio(task.model, task.g.compactOverrides, task.g.compactThreshold)
      if (!explicit && limit < COMPACT_SMALL_WINDOW) ratio = Math.max(ratio, COMPACT_SMALL_FLOOR)
      const percentThreshold = Math.floor(limit * ratio)
      // 绝对 token 上限（可选）：必压线，绝不晚于该值触发
      const absCap = Number(task.g.compactTokenCap) || 0
      const threshold = absCap > 0 ? Math.min(percentThreshold, absCap) : percentThreshold
      // preflight：按当前消息估算预判（上一轮真实用量可能略滞后）
      let est = 0
      for (const m of task.messages) est += estimateTokens(typeof m.content === 'string' ? m.content : '', task.model)
      est += 2000 // system/提示词/工具 schema 粗估
      const promptTokens = task.lastPromptTokens || 0
      const preflightHit = est > threshold * COMPACT_PREFLIGHT_MARGIN
      if (!preflightHit && (promptTokens <= 0 || promptTokens < threshold)) return
      const now = Date.now()
      if (task.lastCompactAt && now - task.lastCompactAt < COMPACT_COOLDOWN_MS) return
      const keepRounds = Math.max(2, Math.min(20, Number(task.g.compactKeepRounds) || COMPACT_DEFAULT_KEEP_ROUNDS))
      const cands = pickCompactCandidates(task.messages, keepRounds)
      if (cands.length < 3) return
      this.emit({ type: 'stage', sid: task.sid, phase: 'thinking', label: '正在压缩历史', detail: cands.length + ' 条旧消息 → 摘要' })
      runHooks(task.g, 'compact-before', { sid: task.sid, taskId: task.taskId, kind: 'window' })
      const { system, user } = buildCompactPrompt(cands)
      const summary = await chatOnce(this.deps.netFetch, {
        provider: task.curP.type,
        model: task.model,
        apiKey: task.curP.apiKey,
        baseUrl: task.curP.baseUrl,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      })
      if (!summary || summary.startsWith('E:')) return
      task.compactCount = (task.compactCount || 0) + 1
      const notice = buildCompactNotice(task.compactCount)
      const next = applyCompact(task.messages, summary + notice, keepRounds)
      if (next.length >= task.messages.length) return
      task.messages = next
      task.lastCompactAt = now
      this.emit({ type: 'compact', sid: task.sid, messages: task.messages })
      this.checkpoint(task, task.roundNum)
      this.trace('info', 'context.window-compact', '压缩 ' + cands.length + ' 条历史 · 触发 ' + (preflightHit ? 'preflight ' + Math.round(est) : 'usage ' + promptTokens) + '/' + threshold, task.sid, task.taskId)
    } catch { /* 压缩失败不影响主流程 */ }
  }

  // dispatch: 子任务在主进程并行执行(上下文隔离 + 工具白名单 + 并发上限)
  private async runDispatch(task: TaskState, tasks: { agent: string; task: string }[]): Promise<string> {
    // 停止后不再启动新的分发执行
    if (this.curGen(task.sid) !== task.myGen) return '已终止'
    const agents = getAgents(task.g.agentOverrides as Record<string, Partial<AgentDef>> | undefined)
    if (!tasks.length) return 'E:dispatch 需要 tasks 数组 [{agent, task}]'
    const disabledAgents = task.g.disabledAgents || []
    const validAgents = tasks.map(t => t.agent).filter(n => agents[n] && !disabledAgents.includes(n))
    if (validAgents.length) {
      task.activeAgents = [...new Set([...task.activeAgents, ...validAgents])]
      this.emit({ type: 'agent', sid: task.sid, agent: task.agent || '', activeAgents: task.activeAgents })
    }
    const out: string[] = []
    const dispGen = this.curGen(task.sid)
    // 并发上限: 按「最多同时活跃角色」分批执行, 默认 5
    const maxConcurrent = Math.max(1, Number(task.g.maxAgents) || 5)
    const results: { agent: string; task: string; result: string }[] = []
    for (let i = 0; i < tasks.length; i += maxConcurrent) {
      const chunk = tasks.slice(i, i + maxConcurrent)
      results.push(...await Promise.all(chunk.map(async (t) => {
        const ag = agents[t.agent]
        if (!ag) return { agent: t.agent, task: t.task, result: 'E:未知角色' }
        if (disabledAgents.includes(t.agent)) return { agent: t.agent, task: t.task, result: 'E:该角色已被禁用: ' + t.agent }
      const sp = '## 当前身份\n' + ag.icon + ' ' + t.agent + ' — ' + ag.role + '\n' + ag.prompt + '\n（你是本次分发的一个子任务执行者，直接完成分配给你的子任务并输出成果。你可以调用工具（文件读写/命令执行/网络检索等）来真正完成工作，完成后给出结果摘要。不要询问。）'
        const COLLAB_TOOLS = ['handoff', 'dispatch', 'list_agents']
        // 子任务用子角色构建工具上下文, 避免父角色白名单误伤子角色工具
        const subCtx = { ...this.buildToolCtx(task), agent: t.agent, isSubtask: true, activeAgents: [...task.activeAgents, t.agent] }
        const agTools = filterToolsByAgent(getActiveTools(subCtx), t.agent, agents).filter(tt => !COLLAB_TOOLS.includes(tt.function.name))
        // 子任务使用角色专属模型(如黑天鹅 vision), 未配置则继承当前模型
        const subPick = pickSubModel(task.g, task.providers, task.curP, task.model, ag)
        const subP = subPick.p
        const subModel = subPick.model
        const subMsgs: unknown[] = [
          { role: 'system', content: sp },
          { role: 'user', content: '[任务分派] ' + (t.task || '') + '\n[必要上下文] (仅任务所需, 无全局会话历史)' },
        ]
        let subText = ''
        let subRounds = 0
        let subRetried = false
        const subCallCounts: Record<string, number> = {}
        const subRun = () => new Promise<string>((resolveSub) => {
        // 子任务轮次动态自动调节: 初始继承主任务上限, 仍在推进时自动顺延(上限 10000 仅作防挂死保险)
        let subRoundLimit = Number(task.g.maxToolRounds) || 50
        const toolTimeoutS = Number(task.g.toolTimeout) || 120
        const meltLimit = Number(task.g.meltdownLimit) || 3
        const stallMs = Math.max(90000, toolTimeoutS * 1000 + 30000)
        let lastActivity = Date.now()
        let finished = false
        let watchdog: ReturnType<typeof setInterval> | null = null
        const finish = (v: string) => { if (finished) return; finished = true; if (watchdog) clearInterval(watchdog); resolveSub(v) }
        const touch = () => { lastActivity = Date.now() }
        // 活动看门狗: 只在“长时间无任何数据/工具产出”时判超时, 不设总时长上限; 超时顺手中止在跑命令
        watchdog = setInterval(() => {
          if (Date.now() - lastActivity > stallMs) {
            void invokeHandler('computer:abort', [task.sid], null)
            finish(subText || '(子任务无进展超时)')
          }
        }, 15000)
        const step = async () => {
          subRounds++
          if (subRounds > subRoundLimit) {
            if (subRoundLimit >= 10000) { finish(subText || '(子任务轮次保险上限)'); return }
            subRoundLimit = Math.min(subRoundLimit + 50, 10000)
            this.trace('warn', 'subtask.rounds-extend', t.agent + ' 轮次 ' + subRounds + ' → 上限自动顺延至 ' + subRoundLimit, task.sid, task.taskId)
          }
          if (this.curGen(task.sid) !== dispGen) { finish('已终止'); return }
          const clean: unknown[] = []
          for (const mm of subMsgs) {
            const m = mm as { role: string; tool_calls?: unknown }
            if (m.role === 'tool') {
              const prev = clean[clean.length - 1] as { role?: string; tool_calls?: unknown } | undefined
              if (!prev || prev.role !== 'assistant' || !prev.tool_calls) continue
            }
            clean.push(mm)
          }
          if (clean.length !== subMsgs.length) { subMsgs.length = 0; subMsgs.push(...clean) }
          let text = ''
          const tcs: EngineToolCall[] = []
          let err: unknown = null
          const rid = 'sub' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
          await new Promise<void>((resolveOnce) => {
            streamChat(this.deps.netFetch, {
              provider: subP.type,
              model: subModel,
              apiKey: subP.apiKey,
              baseUrl: subP.baseUrl,
              messages: subMsgs as unknown as LlmMsg[],
              tools: agTools as unknown[],
              thinkLevel: resolveThinkLevelOf(task.g, subModel),
              requestId: rid,
            }, {
              onChunk: d => { touch(); if (d.content) text += d.content; if (d.done) { resolveOnce() } },
              onToolCall: tc => { touch(); try { if (tc?.function?.name) tcs.push({ id: tc.id || ('c' + Date.now()), name: tc.function.name, args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {} }) } catch { /* 忽略 */ } },
              onUsage: u => { touch(); this.recordUsage(task, rid, u, subModel) },
              onError: e => { touch(); err = e; resolveOnce() },
            }).catch(e => { touch(); err = e; resolveOnce() })
          })
          touch()
          if (this.curGen(task.sid) !== dispGen) { finish('已终止'); return }
          if (err && !subRetried) { subRetried = true; setTimeout(() => void step(), 400); return }
          if (tcs.length) {
            for (const tc of tcs) {
              if (!ag.tools.includes('*') && !ag.tools.includes(tc.name) && !tc.name.startsWith('plugin_') && !tc.name.startsWith('mcp__')) {
                subMsgs.push({ role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }] })
                subMsgs.push({ role: 'tool', content: 'E:权限不足，该 Agent 无权调用 ' + tc.name, tool_call_id: tc.id })
                continue
              }
              const key = tc.name + '::' + JSON.stringify(tc.args || {})
              subCallCounts[key] = (subCallCounts[key] || 0) + 1
              if (subCallCounts[key] >= meltLimit) {
                subMsgs.push({ role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }] })
                subMsgs.push({ role: 'tool', content: 'E:重复操作熔断: 同一工具同一参数已累计 ' + subCallCounts[key] + ' 次, 请停止重复并换一种方式完成', tool_call_id: tc.id })
                continue
              }
              // 子任务工具执行必须用子角色上下文(权限/白名单/目录一致)
              const rr = await runTool(tc.name, tc.args, subCtx)
              touch()
              subMsgs.push({ role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }] })
              subMsgs.push({ role: 'tool', content: rr, tool_call_id: tc.id })
            }
            setTimeout(() => void step(), 50)
            return
          }
          subText = text
          finish(text)
        }
        void step()
        })
        const r = await subRun()
        return { agent: t.agent, task: t.task, result: r }
      })))
    }
    for (const x of results) {
      const xr = x as { error?: string; result?: string }
      const err = xr.error ? '（未知角色）' : ''
      out.push(`【${x.agent}${err}】${xr.error || ''}\n任务: ${x.task}\n结果: ${xr.result || '(empty)'}`)
    }
    return '[分发完成] 共 ' + tasks.length + ' 个子任务：\n\n' + out.join('\n\n---\n\n')
  }
}

// 预算判定(与渲染层 reliability 同构)
function budgetExceeded(used: number, limit: number): boolean {
  return limit > 0 && used >= limit
}
