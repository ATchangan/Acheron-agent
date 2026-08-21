// electron/engine/engine.ts — Acheron-agent 独立内核(v0.3.3)
// Agent 主循环完全运行在主进程: LLM 直连(不经渲染层)、工具直接分发、任务可落盘断点恢复。
// 渲染层只负责: 发送启动请求、消费事件流、展示结果。
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import { isAbsolute, join } from 'path'
import { Notification } from 'electron'
import type { EngineEvent, EngineMessage, EngineProvider, EngineSettings, EngineStartParams, EngineToolCall, EngineToolSpec, EngineUsage, PlanStep } from './types'
import { getAgents, type AgentDef } from './agents'
import { normalizeAgentName } from '../shared/agents-data'
import { buildContextualMessages, buildPrompt, getModelContextLimit, isVisionModel, outputLimit, slimToolResult, extractKeyInfo } from './context'
import { runTool, getActiveTools, getMcpToolSpecs, closeTerminalSessions, type ToolRunCtx } from './tools'
import { loadMemory, saveMemory, memoryBlockText, addLesson, scanMemoryText, type EngineMemory } from './memory'
import { streamChat, abortLLM, visionOnce } from './llm-core'
import type { LlmMsg } from './llm-core'
import { planNeedsVerify as planNeedsVerifyCore, planHasVerification as planHasVerificationCore, type PlanStepData } from './plan-core'
import { pickInitialModel, resolveModel as resolveModelOf, resolveThinkLevel as resolveThinkLevelOf, visionCandidates } from './model-router'
import { listSkills, matchSkills } from './skill-files'
import { runHooks } from './hooks'
import { isPlanReadonlyTool } from './plan-tools'
import { chainDirs, collectSubdirInstructions, discoverProjectInstructions, type InstructionFile } from './project-instructions'
import { PlanController } from './plan-controller'
import { CompactionRunner } from './compaction'
import { runDispatch as runDispatchFn } from './dispatch-runner'
import { UsageTracker } from './usage-tracker'
import type { TaskState, TokenStat, CallResult, TaskGoal } from './task-types'
import { logTraceFile } from '../ipc/trace'
import { startTask, updateTask, finishTask, getTask } from '../ipc/tasks'
import { backoffDelay } from './reliability'
import { invokeHandler } from './registry'
import { saveToolOutput, insertAudit } from '../db'
import { detectTaskType, routeProfile } from '../llm/gateway'
import { enqueueLocalVision } from '../llm/vision'
import { recordSkillHit } from '../db'

function agentMemoryScope(general: EngineSettings, agent?: string): 'global' | 'private' {
  if (!agent) return 'global'
  const ag = getAgents(general.agentOverrides as Record<string, Partial<AgentDef>> | undefined)[agent]
  return ag?.memoryScope === 'private' ? 'private' : 'global'
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
  private plans: PlanController
  private usage: UsageTracker
  private compaction: CompactionRunner
  private traceOn = true
  private traceOnAt = 0

  constructor(deps: EngineDeps) {
    this.deps = deps
    this.plans = new PlanController({
      userDataPath: deps.userDataPath,
      isCurrent: t => this.tasks.get(t.sid) === t,
      emit: ev => this.emit(ev),
    })
    this.usage = new UsageTracker(ev => this.emit(ev))
    this.compaction = new CompactionRunner({
      netFetch: deps.netFetch,
      emit: ev => this.emit(ev),
      trace: (level, event, detail, sid, requestId) => this.trace(level, event, detail, sid, requestId),
      checkpoint: (task, round) => this.checkpoint(task, round),
      recordUsage: (task, rid, u, modelOverride) => this.recordUsage(task, rid, u, modelOverride),
    })
  }

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
    const reqAgent = normalizeAgentName(params.agent)
    const initialPick = pickInitialModel(general, providers, p, params.content, params.images)
    // v0.4.0 M5: 网关统一选路 —— 角色覆盖 > 任务类型(code/vision/long) > 全局默认
    const taskType = detectTaskType(params.content, params.images)
    const routed = routeProfile(general, providers, initialPick.p, { agent: reqAgent, agentManual: params.agentManual, taskType, agents: agentsMap })
    const model = routed.model || initialPick.model
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
      curP: routed.p,
      model,
      origModel: model,
      taskType,
      modelFailCount: 0,
      modelFallbackUsed: false,
      agent: reqAgent,
      agentManual: params.agentManual,
      activeAgents: reqAgent ? [reqAgent] : [],
      handoffStack: [],
      handoffCounts: {},
      handoffAt: -1,
      toolLog: [],
      tokBase: this.snapshotTok(params.sid),
      memoryText: '',
      projectCtx: null,
      instrVisited: new Set<string>(),
      fileSnapshots: {},
      memory: loadMemory(this.deps.memoryPath, { agent: reqAgent, scope: agentMemoryScope(general, reqAgent) }),
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
      clarifyPending: null,
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
    const resAgent = normalizeAgentName(cp.agent)
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
      agent: resAgent,
      activeAgents: (cp.activeAgents || []).map(normalizeAgentName),
      handoffStack: cp.handoffStack || [],
      handoffCounts: cp.handoffCounts || {},
      handoffAt: typeof cp.handoffAt === 'number' ? cp.handoffAt : -1,
      toolLog: [],
      tokBase: this.snapshotTok(rec.sid),
      memoryText: '',
      projectCtx: null,
      instrVisited: new Set<string>(),
      fileSnapshots: {},
      memory: loadMemory(this.deps.memoryPath, { agent: resAgent, scope: agentMemoryScope(general, resAgent) }),
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
      if (task.clarifyPending) { task.clarifyPending.resolve(''); task.clarifyPending = null }
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

  // v0.4.2: clarify 交互 —— 模型提问并等待用户选择
  clarifyRespond(sid: string, answer: string): boolean {
    const task = this.tasks.get(sid)
    if (task?.clarifyPending) {
      const p = task.clarifyPending
      task.clarifyPending = null
      p.resolve(String(answer ?? ''))
      this.trace('info', 'clarify.respond', String(answer || '').slice(0, 120), sid, task.taskId)
      return true
    }
    return false
  }

  private runClarify(task: TaskState, tc: EngineToolCall): Promise<string> {
    const args = (tc.args || {}) as { question?: unknown; choices?: unknown; multi_select?: unknown }
    const question = String(args.question || '请选择').slice(0, 500)
    const raw = Array.isArray(args.choices) ? args.choices.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
    const multiSelect = args.multi_select === true
    return new Promise<string>((resolve) => {
      const reqId = 'clarify_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
      task.clarifyPending = {
        reqId,
        resolve: (answer: string) => resolve(JSON.stringify({ question, user_response: answer })),
      }
      this.emit({ type: 'clarify', sid: task.sid, requestId: reqId, question, choices: raw, multiSelect })
      this.trace('info', 'clarify.request', question, task.sid, task.taskId)
    })
  }

  // 计划状态机/PLANS.md 已抽至 plan-controller(0.3.9 结构清理), 以下为薄委托
  private emitPlan(task: TaskState, force = false): void { this.plans.emitPlan(task, force) }
  private flushPlan(task: TaskState): void { this.plans.flushPlan(task) }
  private planAppend(task: TaskState, tcs: EngineToolCall[], summary?: string): void { this.plans.planAppend(task, tcs, summary) }
  private planStart(task: TaskState, tcs: EngineToolCall[], messageId?: string): string[] { return this.plans.planStart(task, tcs, messageId) }
  private planFinish(task: TaskState, ids: string[], results: { r: string; ms: number }[]): void { this.plans.planFinish(task, ids, results) }
  private planFailPending(task: TaskState, reason: string): void { this.plans.planFailPending(task, reason) }
  private planCloseAll(task: TaskState, status: 'aborted' | 'failed', reason?: string): void { this.plans.planCloseAll(task, status, reason) }
  private planRetrospective(task: TaskState): string { return this.plans.planRetrospective(task) }
  private planAddDecision(task: TaskState, text: string): void { this.plans.planAddDecision(task, text) }
  private planAddSurprise(task: TaskState, text: string): void { this.plans.planAddSurprise(task, text) }
  private writePlanDoc(task: TaskState): void { this.plans.writePlanDoc(task) }
  private schedulePlanDoc(task: TaskState): void { this.plans.schedulePlanDoc(task) }
  private flushPlanDoc(task: TaskState): void { this.plans.flushPlanDoc(task) }
  private applyPlanUpdate(task: TaskState, steps: { label?: string; status?: string; expected?: string; id?: string; tool?: string }[]): string { return this.plans.applyPlanUpdate(task, steps) }
  private snapshotTok(sid: string): Record<string, TokenStat> { return this.usage.snapshotTok(sid) }

  private async runTask(task: TaskState): Promise<void> {
    const { sid } = task
    try {
      const g = task.g
      task.memoryText = memoryBlockText(task.memory, task.content)
      // 自省整改: 内置技能隐藏名单 —— 隐藏的技能不注入系统提示, 但仍可 read_skill 读取
      const hiddenSkills = new Set((task.g.hiddenSkills || []).map(String))
      task.skillsCache = listSkills(this.deps.skillsDirs || []).filter(s => !hiddenSkills.has(s.name))
      // v0.4.0 M8: 按用户消息匹配技能(triggers 正则 > description 关键词), top2 注入, 命中计数落库
      if (task.g.perf?.skillInject !== false) {
        const matched = matchSkills(this.deps.skillsDirs || [], task.content, 2).filter(s => !hiddenSkills.has(s.name))
        task.matchedSkills = matched.map(s => ({ name: s.name, body: s.body }))
        for (const s of matched) recordSkillHit(s.name)
      } else {
        task.matchedSkills = []
      }
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
        // 自省整改 #3: 强制验证最多 2 轮 —— 首轮未产生验证命令时再给一次强提示
        while (!res.tcs.length && this.planNeedsVerify(task) && verifyForced < 2 && this.curGen(sid) === task.myGen && !task.stopped) {
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
        if (verifyForced > 0 && this.planNeedsVerify(task)) {
          this.planAddSurprise(task, '写文件后两轮强制验证均未产生验证命令(read/exec_command/codebox)，交付请人工复核')
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
    // 自省整改 #12: 交付闭环 —— 未附「本次改进点」时在决策日志记一笔
    if (task.planSteps.length && !finalText.includes('本次改进点')) {
      this.planAddSurprise(task, '交付未附「本次改进点」，复盘闭环未完成')
    }
    // 自省整改 #15: 工具表演检测 —— 简短请求却大量调工具时记复盘缺口
    const simpleReq = String(task.content || '').length <= 40 && !/工具|代码|文件|网页|搜索|命令|脚本|生成|创建|列出|读取/.test(String(task.content || ''))
    if (simpleReq && task.toolLog.length >= 5) {
      this.planAddSurprise(task, '工具表演检测: 简短请求但调用 ' + task.toolLog.length + ' 次工具, 后续先评估工具必要性')
    }
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
    // v0.3.9: 失败教训自动沉淀 —— 失败时写入(原因, 场景, 建议), 后续任务按时效注入
    if (status === 'failed') {
      const reason = String(error || '').slice(0, 160)
      const scene = String(task.content || '').slice(0, 120)
      const lesson = '失败复盘：' + reason + '。场景：' + scene + '。建议：先复现并定位第一个失败步骤，再决定重试或回滚文件改动。'
      if (scanMemoryText(lesson).ok && addLesson(task.memory, lesson)) {
        saveMemory(this.deps.memoryPath, task.memory, { agent: task.agent ?? '助手', scope: agentMemoryScope(task.g, task.agent) })
        this.trace('info', 'memory.lesson', '失败教训已沉淀', task.sid, task.taskId)
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
    // 自省整改 #13: 后台/并行任务完成通知(设置→引擎 开启 notifyTaskDone 后生效)
    if (task.g.notifyTaskDone === true && status === 'done') {
      try {
        new Notification({ title: 'Acheron-agent 任务完成', body: String(task.content || '').slice(0, 80) }).show()
      } catch { /* 通知失败不影响任务 */ }
    }
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
          // v0.3.8+: 非可重试错误 → 降级链(同供应商未试模型 → 其他有 key 的供应商), 最多尝试 4 次
          t.modelFailCount = (t.modelFailCount || 0) + 1
          if (t.modelFailCount <= 4 && this.switchFallbackModel(t)) {
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
    const tried = task.triedModels || []
    // 优先: 同供应商尚未试过的其他模型
    const sameProvModels = (task.curP.models || []).filter(m => m && m !== old && !tried.includes(m))
    if (sameProvModels.length) {
      task.triedModels = [...tried, sameProvModels[0]]
      task.model = sameProvModels[0]
      task.modelFailCount = 0
      this.planAddDecision(task, '主模型 ' + old + ' 失败，切换同供应商模型 ' + task.model)
      this.trace('warn', 'model.fallback', old + ' → ' + task.model, task.sid, task.taskId)
      runHooks(task.g, 'model-fallback', { sid: task.sid, taskId: task.taskId, from: old, to: task.model })
      return true
    }
    // 其次: 其他有 key 且未试过的供应商
    const alt = task.providers.find(x => x.apiKey && x.baseUrl && x.id !== task.curP.id)
    if (!alt) return false
    task.curP = alt
    task.model = alt.selectedModel || (alt.models && alt.models[0]) || old
    task.triedModels = [...tried, task.model]
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
      keyInfo: task.g.mode !== 'chat' ? extractKeyInfo(task.goal.objective, task.planSteps, task.toolLog) : '',
      skillBodies: task.matchedSkills,
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
      latestUserText: String(task.userMsg?.content || ''),
      getMemory: () => task.memory,
      saveMemory: (m: EngineMemory) => { task.memory = m; saveMemory(this.deps.memoryPath, m, { agent: task.agent ?? '助手', scope: agentMemoryScope(task.g, task.agent) }) },
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
      onUiDisplayChange: (d) => {
        task.g.uiDisplay = d
        this.emit({ type: 'ui', sid: task.sid, uiDisplay: d })
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

  // v0.3.9: 统一执行管道 —— 主循环与子代理共用: 快照/Hooks/计划只读门/子目录指令注入
  private async runToolGuarded(task: TaskState, tc: EngineToolCall, ctx: ToolRunCtx, opts: { subAgent?: string } = {}): Promise<string> {
    const agentVar = opts.subAgent || task.agent || ''
    const t0 = Date.now()
    runHooks(task.g, 'tool-before', { tool: tc.name, sid: task.sid, taskId: task.taskId, agent: agentVar })
    // v0.4.2: clarify 交互工具 —— 暂停等待用户选择（不受计划只读门限制）
    if (tc.name === 'clarify') {
      return await this.runClarify(task, tc)
    }
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
      const runner = runTool(tc.name, tc.args, ctx).catch((e: unknown) => 'E:工具 ' + tc.name + ' 异常: ' + ((e instanceof Error) ? e.message : String(e)))
      // 工具超时兜底: 命令类由用户/停止按钮控制不设限, 媒体生成放宽到 15 分钟, 其余 10 分钟
      const NO_TIMEOUT_TOOLS = new Set(['exec_command', 'terminal_run'])
      const cap = NO_TIMEOUT_TOOLS.has(tc.name) ? 0 : (tc.name === 'media_img' || tc.name === 'media_video' ? 15 * 60 * 1000 : 10 * 60 * 1000)
      if (!cap) r = await runner
      else {
        let timeoutId: NodeJS.Timeout | null = null
        const timeout = new Promise<string>(resolve => { timeoutId = setTimeout(() => resolve('E:工具 ' + tc.name + ' 执行超时(' + Math.round(cap / 60000) + ' 分钟)，已中止'), cap) })
        r = await Promise.race([runner, timeout])
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
      }
    }
    // v0.3.8: 子目录项目指令按需注入 —— 模型读取/操作某目录文件时, 自动把该目录(上溯 5 层)的规则附加到工具结果
    if (r.startsWith('E:')) { /* 工具失败不注入, 避免混淆错误信息 */ } else {
      r = this.attachSubdirInstructions(task, tc, r)
    }
    // v0.4.0 M7: 工具结果 >2KB 存档 side-channel, 上下文只保留取回指针(大结果不占窗口)
    const NON_ARCHIVE_TOOLS = new Set(['browser_vision', 'read_image', 'media_img', 'media_video', 'recall_tool_output'])
    if (r.length > 2048 && !r.startsWith('E:') && !NON_ARCHIVE_TOOLS.has(tc.name)) {
      const outId = saveToolOutput(task.sid, tc.name, r)
      if (outId > 0) {
        this.trace('info', 'tool.side-channel', tc.name + ' 存档 #' + outId + ' (' + r.length + ' 字符)', task.sid, task.taskId)
        r = '[工具结果 #' + outId + ' 已存档(' + r.length + ' 字符)。如需细节调用 recall_tool_output(' + outId + ')]'
      }
    }
    // v0.4.0 M3: 工具审计落 SQLite(情景时间线 recall_events 的数据源)
    try {
      insertAudit({
        ts: t0,
        agent: agentVar || null,
        tool: tc.name,
        argsSummary: JSON.stringify(tc.args || {}).slice(0, 200),
        resultSummary: (r.startsWith('E:') ? 'ERR ' : '') + r.slice(0, 200),
        durationMs: Date.now() - t0,
        tokens: null,
      })
    } catch { /* 审计失败不影响任务 */ }
    runHooks(task.g, 'tool-after', { tool: tc.name, sid: task.sid, taskId: task.taskId, result: r.slice(0, 200), agent: agentVar })
    if (['write', 'edit', 'apply_patch'].includes(tc.name) && !r.startsWith('E:')) {
      runHooks(task.g, 'file-write', { tool: tc.name, sid: task.sid, taskId: task.taskId, path: String((tc.args || {}).path || ''), agent: agentVar })
    }
    return r
  }

  private runToolFor(task: TaskState, tc: EngineToolCall): Promise<string> {
    return this.runToolGuarded(task, tc, this.buildToolCtx(task))
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
    // v0.4.0 M6: 本地视觉服务优先(可配置), 失败/未启用自动回云候选
    if (task.g.localVision?.enabled) {
      try {
        const local = await enqueueLocalVision(this.deps.netFetch, task.g.localVision, img, q)
        if (local) {
          this.trace('info', 'model.local-vision', '本地视觉服务命中', task.sid, task.taskId)
          return local
        }
      } catch (e) { this.trace('warn', 'model.local-vision-fail', e instanceof Error ? e.message : String(e), task.sid, task.taskId) }
    }
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

  private recordUsage(task: TaskState, rid: string, u: EngineUsage, modelOverride?: string): void { this.usage.recordUsage(task, rid, u, modelOverride) }

  private taskTokensUsed(task: TaskState): number { return this.usage.taskTokensUsed(task) }

  private async makeEarlySummary(task: TaskState): Promise<string> { return this.compaction.makeEarlySummary(task) }

  private async microCompact(task: TaskState): Promise<void> { return this.compaction.microCompact(task) }

  private async maybeCompact(task: TaskState): Promise<void> { return this.compaction.maybeCompact(task) }

  // dispatch: 子任务在主进程并行执行(上下文隔离 + 工具白名单 + 并发上限)
  private async runDispatch(task: TaskState, tasks: { agent: string; task: string }[]): Promise<string> {
    return runDispatchFn({
      netFetch: this.deps.netFetch,
      memoryPath: this.deps.memoryPath,
      curGen: sid => this.curGen(sid),
      emit: ev => this.emit(ev),
      trace: (level, event, detail, sid, requestId) => this.trace(level, event, detail, sid, requestId),
      buildToolCtx: t => this.buildToolCtx(t),
      runToolGuarded: (t, tc, ctx, opts) => this.runToolGuarded(t, tc, ctx, opts),
      planAppend: (t, tcs, summary) => this.planAppend(t, tcs, summary),
      planStart: (t, tcs, messageId) => this.planStart(t, tcs, messageId),
      planFinish: (t, ids, results) => this.planFinish(t, ids, results),
      recordUsage: (t, rid, u, modelOverride) => this.recordUsage(t, rid, u, modelOverride),
    }, task, tasks)
  }
}

// 预算判定(与渲染层 reliability 同构)
function budgetExceeded(used: number, limit: number): boolean {
  return limit > 0 && used >= limit
}
