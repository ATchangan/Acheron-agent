// electron/engine/engine.ts — 黄泉Agent 独立内核(v0.3.3)
// Agent 主循环完全运行在主进程: LLM 直连(不经渲染层)、工具直接分发、任务可落盘断点恢复。
// 渲染层只负责: 发送启动请求、消费事件流、展示结果。
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import { join } from 'path'
import type { EngineEvent, EngineMessage, EngineProvider, EngineSettings, EngineStartParams, EngineToolCall, EngineToolSpec, EngineUsage } from './types'
import { getAgents, type AgentDef } from './agents'
import { buildContextualMessages, buildPrompt, getModelContextLimit, isVisionModel, outputLimit, filterToolsByAgent } from './context'
import { runTool, getActiveTools, getMcpToolSpecs, type ToolRunCtx } from './tools'
import { loadMemory, saveMemory, memoryBlockText, type EngineMemory } from './memory'
import { streamChat, chatOnce, abortLLM, visionOnce } from './llm-core'
import type { LlmMsg } from './llm-core'
import { logTraceFile } from '../ipc/trace'
import { startTask, updateTask, finishTask, getTask } from '../ipc/tasks'
import { backoffDelay } from './reliability'
import { invokeHandler } from './registry'

interface TokenStat { requests: number; readTokens: number; inputTokens: number; writeTokens: number; outputTokens: number; hitReqs: number }
interface ToolLogEntry { name: string; args: Record<string, unknown>; result: string; error: boolean; ms: number; toolCallId?: string }
interface CallResult { text: string; reasoning?: string; tcs: EngineToolCall[]; ttft?: number; duration?: number; usage?: EngineUsage; msgId?: string }
interface PlanGate { promise: Promise<void>; resolve: (v: boolean) => void }

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
  agent?: string
  agentManual?: boolean
  activeAgents: string[]
  handoffStack: string[]
  handoffCounts: Record<string, number>
  handoffAt: number
  toolLog: ToolLogEntry[]
  tokBase: Record<string, TokenStat>
  memoryText: string
  projectCtx: { file: string; content: string } | null
  memory: EngineMemory
  lastMidSave: number
  planPending: PlanGate | null
  planApproved: boolean
  stopped: boolean
  running: boolean
  lastMsgId?: string
  roundNum: number
  interjects: { text: string; kind: 'supplement' | 'retarget' }[]
  withImages: boolean
  switchedVision: boolean
  earlySummary?: string
  earlySummaryDone?: boolean
}

export interface EngineDeps {
  settingsPath: string
  userDataPath: string
  memoryPath: string
  tracePath: string
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
    if (existing?.running) {
      this.interject(params.sid, params.content, params.images, params.attachments, 'supplement')
      return
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
    const initialPick = this.pickInitialModel(general, providers, p, params.content, params.images)
    const model = params.agent && !params.agentManual
      ? (this.pickAgentModel(general, providers, p, params.agent) || initialPick.model)
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
      memory: loadMemory(this.deps.memoryPath),
      lastMidSave: 0,
      planPending: null,
      planApproved: false,
      stopped: false,
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
    void this.runTask(task)
  }

  resume(taskId: string): void {
    const rec = getTask(taskId)
    if (!rec || !rec.checkpoint) return
    const cp = rec.checkpoint as { messages: EngineMessage[]; agent?: string; activeAgents: string[]; model: string; round: number; provider?: unknown; handoffAt?: number; handoffStack?: string[]; handoffCounts?: Record<string, number> }
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
    const myGen = this.nextGen(rec.sid)
    const lastUser = [...cp.messages].reverse().find(m => m.role === 'user')
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
      agent: cp.agent,
      activeAgents: cp.activeAgents || [],
      handoffStack: cp.handoffStack || [],
      handoffCounts: cp.handoffCounts || {},
      handoffAt: typeof cp.handoffAt === 'number' ? cp.handoffAt : -1,
      toolLog: [],
      tokBase: this.snapshotTok(rec.sid),
      memoryText: '',
      projectCtx: null,
      memory: loadMemory(this.deps.memoryPath),
      lastMidSave: 0,
      planPending: null,
      planApproved: true,
      stopped: false,
      running: true,
      roundNum: cp.round || 0,
      interjects: [],
      withImages: !!(rec.images && rec.images.length),
      switchedVision: false,
    }
    this.tasks.set(rec.sid, task)
    this.emit({ type: 'restore', sid: rec.sid, messages: cp.messages, agent: cp.agent, activeAgents: cp.activeAgents || [], model: task.model })
    this.emit({ type: 'busy', sid: rec.sid, busy: true })
    this.emit({ type: 'stream', sid: rec.sid, streaming: true, executing: true })
    this.trace('info', 'task.resume', rec.content.slice(0, 120), rec.sid, rec.id)
    void this.runTask(task)
  }

  stop(sid: string): void {
    const task = this.tasks.get(sid)
    this.invalidate(sid)
    if (task) { task.stopped = true; if (task.planPending) { task.planApproved = false; task.planPending.resolve(false) } }
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

  private snapshotTok(sid: string): Record<string, TokenStat> {
    return JSON.parse(JSON.stringify(this.sessTokBySid.get(sid) || {})) as Record<string, TokenStat>
  }

  private pickAgentModel(g: EngineSettings, providers: EngineProvider[], p: EngineProvider, agent: string): string {
    const ag = getAgents(g.agentOverrides as Record<string, Partial<AgentDef>> | undefined)[agent]
    const pref = ag?.model
    if (pref === 'vision') {
      const cand = this.visionCandidates(g, providers, p)
      if (cand.length) return cand[0].model
    }
    return p.selectedModel || p.models[0] || ''
  }

  // 多模型策略(与旧渲染层 pickModels 同构): 简单任务小模型/快模型, 复杂任务大模型
  private pickInitialModel(g: EngineSettings, providers: EngineProvider[], p: EngineProvider, content: string, images?: string[]): { p: EngineProvider; model: string } {
    const main = this.resolveModelFrom(g, providers, p, 'mainModel') || { p, model: p.selectedModel || p.models[0] || '' }
    const heavyWords = ['工具', '代码', '脚本', '文件', '读取', '创建', '查找', '目录', '搜索', '网页', '下载', '执行', '命令', '终端', '分析', '总结', '报告', '修改', '删除', '移动', '复制']
    const isSimple = g.autoFastModel !== false && !images?.length && content.length < 300 && !heavyWords.some(w => content.includes(w))
    const fast = isSimple ? (this.resolveModelFrom(g, providers, p, 'fastModel') || main) : main
    const small = this.resolveModelFrom(g, providers, p, 'smallModel')
    const large = this.resolveModelFrom(g, providers, p, 'largeModel')
    return isSimple ? (small || fast) : (large || main)
  }

  private resolveModelFrom(g: EngineSettings, providers: EngineProvider[], curP: EngineProvider, key: string): { p: EngineProvider; model: string } | null {
    const val = g[key]
    if (!val) return null
    const [pid, m] = String(val).includes('::') ? String(val).split('::') : [null, String(val)]
    if (pid) {
      const pr = providers.find(x => x.id === pid)
      if (pr && (pr.models || []).includes(m)) return { p: pr, model: m }
    } else if ((curP.models || []).includes(String(val))) return { p: curP, model: String(val) }
    return null
  }

  // 推理强度：每模型覆盖 > 全局档位；缺省回落到 medium
  private resolveThinkLevel(task: TaskState, model?: string): string {
    const m = model || task.model
    const ov = (task.g.thinkOverrides || {}) as Record<string, string>
    return ov[m] || String(task.g.thinkLevel || 'medium')
  }

  private visionCandidates(g: EngineSettings, providers: EngineProvider[], curP: EngineProvider): { p: EngineProvider; model: string }[] {
    const out: { p: EngineProvider; model: string }[] = []
    const list: string[] = (g.visionModels && g.visionModels.length) ? g.visionModels : (g.visionModel ? [g.visionModel] : [])
    const push = (pid: string | null, m: string) => {
      if (pid) {
        const pr = providers.find(x => x.id === pid || x.name === pid)
        if (pr && (pr.models || []).includes(m) && !out.some(c => c.model === m)) out.push({ p: pr, model: m })
      } else {
        const pr = providers.find(x => (x.models || []).includes(m))
        if (pr && !out.some(c => c.model === m)) out.push({ p: pr, model: m })
      }
    }
    for (const item of list) {
      if (item.startsWith('ref:')) {
        const pid = item.slice(4)
        const pr = providers.find(x => x.id === pid || x.name === pid)
        if (pr) { const m = pr.models.find(isVisionModel); if (m) push(pr.id, m) }
      } else if (item.includes('::')) {
        const [a, b] = item.split('::')
        push(a, b)
      } else push(null, item)
    }
    if (!out.length) {
      const inProv = (curP.models || []).find(isVisionModel)
      if (inProv) out.push({ p: curP, model: inProv })
      else {
        for (const pr of providers) {
          const m = (pr.models || []).find(isVisionModel)
          if (m) { out.push({ p: pr, model: m }); break }
        }
      }
    }
    return out
  }

  private async runTask(task: TaskState): Promise<void> {
    const { sid } = task
    try {
      const g = task.g
      task.memoryText = memoryBlockText(task.memory, task.content)
      task.projectCtx = this.readProjectCtx(g.workDir || '')
      // LLM 摘要压缩(实验): 长会话早期消息交给模型压缩, 替代规则截断
      if (g.llmSummary === true && !task.earlySummaryDone && task.messages.length > 40) {
        task.earlySummaryDone = true
        task.earlySummary = await this.makeEarlySummary(task)
      }
      // 视觉任务: 主模型不支持时切换视觉队列, 无队列则用视觉辅助分析
      if (task.images && task.images.length && !isVisionModel(task.model)) {
        const cands = this.visionCandidates(g, task.providers, task.curP)
        if (cands.length) {
          task.curP = cands[0].p
          task.model = cands[0].model
          task.switchedVision = true
          task.withImages = true
          this.emit({ type: 'agent', sid, agent: task.agent || '', activeAgents: task.activeAgents })
          this.trace('info', 'model.vision-switch', task.model, sid, task.taskId)
        } else {
          // 无任何视觉候选时不再拿纯文本模型硬调 visionOnce, 直接提示配置
          task.userMsg.content = String(task.userMsg.content || '') + '\n\n[未配置可用的视觉辅助模型，图片无法分析。可在 设置→策略→👁️视觉理解 中配置视觉模型优先级。]'
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

        let res: CallResult = await callLLM(task)
        if (this.curGen(sid) !== task.myGen) break
        const used = this.taskTokensUsed(task)
        if (budgetExceeded(used, maxTaskTokens)) {
          this.trace('warn', 'task.budget', '已达预算 ' + used + ' tokens', sid, task.taskId)
          res = { text: res.text, tcs: [] }
        }

        // 计划确认门: 首次工具调用前先给方案等用户批准
        if (res.tcs.length && g.planGate === true && !task.planApproved && task.roundNum === 1) {
          let gateResolve: (v: boolean) => void = () => {}
          const gate = new Promise<boolean>(r => { gateResolve = r })
          task.planPending = { promise: gate.then(() => {}), resolve: gateResolve }
          this.emit({ type: 'plan', sid, summary: (res.text || '').slice(0, 200), steps: res.tcs.map(tc => ({ tool: tc.name, args: tc.args })) })
          const ok = await gate
          task.planPending = null
          if (!ok) {
            res = { text: (res.text || '') + '\n\n[用户拒绝了执行计划，任务已中止]', tcs: [] }
            this.finalizeTask(task, res, maxTaskTokens)
            task.stopped = true
            break
          }
        }

        // 工具轮循环
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
          if (task.interjects.length && task.interjects[0].kind === 'retarget') {
            task.toolLog.push({ name: 'retarget-meltdown', args: {}, result: 'E:改向指令熔断', error: true, ms: 0 })
            break
          }
          const rc = new Map<string, number>()
          for (const t of task.toolLog) { const k = t.name + '::' + JSON.stringify(t.args || {}); rc.set(k, (rc.get(k) || 0) + 1) }
          if (res.tcs.some(tc => (rc.get(tc.name + '::' + JSON.stringify(tc.args || {})) || 0) >= meltLimit)) {
            this.trace('warn', 'tool.meltdown', res.tcs[0].name, sid, task.taskId)
            break
          }
          const logStart = task.toolLog.length
          const stepText = (res.text || '').trim()
          const stepId = res.msgId || task.lastMsgId || uuidv4()
          task.messages.push({ id: stepId, role: 'assistant', content: stepText || null, reasoning_content: res.reasoning || undefined, timestamp: Date.now(), tool_calls: res.tcs.map(tc2 => ({ id: tc2.id, type: 'function', function: { name: tc2.name, arguments: JSON.stringify(tc2.args) } })) })
          this.emit({ type: 'step', sid, id: stepId, content: stepText || null, reasoning: res.reasoning || undefined, toolCalls: res.tcs })

          const runOne = async (tc: EngineToolCall) => {
            if (task.interjects.length && task.interjects[0].kind === 'retarget') {
              task.toolLog.push({ name: 'retarget-meltdown', args: {}, result: 'E:改向指令熔断', error: true, ms: 0 })
              return { tc, r: 'E:改向指令熔断' }
            }
            let r2 = ''
            let ms = 0
            for (let a = 0; a <= maxRetry; a++) {
              const t0 = Date.now()
              this.emit({ type: 'stage', sid, phase: 'tool', label: '🔧 ' + tc.name, detail: JSON.stringify(tc.args || {}).slice(0, 40) })
              r2 = await this.runToolFor(task, tc)
              ms = Date.now() - t0
              if (!r2.startsWith('E:')) break
              if (a < maxRetry) await new Promise(r => setTimeout(r, backoffDelay(a, 500, 8000)))
            }
            task.toolLog.push({ name: tc.name, args: tc.args, result: r2, error: r2.startsWith('E:'), ms, toolCallId: tc.id })
            this.trace(r2.startsWith('E:') ? 'warn' : 'info', 'tool', tc.name + ' ' + ms + 'ms', sid, tc.id)
            return { tc, r: r2 }
          }
          const writes = ['write', 'edit', 'exec_command', 'mkdir', 'codebox']
          const results: { tc: EngineToolCall; r: string }[] = []
          if (doParallel) {
            const readTcs = res.tcs.filter(tc => !writes.includes(tc.name))
            const writeTcs = res.tcs.filter(tc => writes.includes(tc.name))
            results.push(...(await Promise.all(readTcs.map(runOne))))
            for (const tc of writeTcs) results.push(await runOne(tc))
          } else {
            for (const tc of res.tcs) results.push(await runOne(tc))
          }
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
          if (toolNames.some(n => ['write', 'edit', 'exec_command', 'mkdir', 'codebox', 'grep', 'read'].includes(n))) {
            const cm = this.resolveModel(task, 'codeModel')
            if (cm) { task.curP = cm.p; task.model = cm.model }
          } else if (toolNames.some(n => ['save_memory', 'recall_memory', 'web_search', 'web_fetch', 'import_doc'].includes(n))) {
            const lm = this.resolveModel(task, 'longTextModel')
            if (lm) { task.curP = lm.p; task.model = lm.model }
          }
          this.emit({ type: 'stage', sid, phase: 'thinking', label: '思考中', detail: '' })
          if (this.curGen(sid) !== task.myGen) break
          res = await callLLM(task)
          if (budgetExceeded(this.taskTokensUsed(task), maxTaskTokens)) res = { text: res.text, tcs: [] }
          if (this.curGen(sid) !== task.myGen) break
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
      this.emit({ type: 'stage-clear', sid })
      this.emit({ type: 'stream', sid, streaming: false, executing: false })
      this.emit({ type: 'busy', sid, busy: false })
      if (task.switchedVision && task.origModel) {
        task.curP = task.p
        task.model = task.origModel
      }
    }
  }

  // 消息模型: 任务流只允许「用户消息 / 步骤卡 / 最终回复」三种消息。
  // 流式文字走临时通道(不落消息), 步骤文字随步骤卡落一条, 最终回复作为独立消息追加。
  // 不创建占位消息 → 不存在“卡片前重复”的架构性可能。
  private finalizeTask(task: TaskState, res: CallResult, maxTaskTokens: number): void {
    const { sid } = task
    let finalText = (res.text || '').trim()
    if (budgetExceeded(this.taskTokensUsed(task), maxTaskTokens)) {
      finalText += (finalText ? '\n\n' : '') + '[已达任务 token 预算上限，本轮提前结束。可在 设置→引擎→任务可靠性 中调整预算。]'
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
    this.emit({ type: 'stage-clear', sid })
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

  // 子任务模型: 角色专属模型(如黑天鹅 vision)优先, 否则继承当前模型
  private pickSubModel(task: TaskState, ag: AgentDef): { p: EngineProvider; model: string } {
    const pref = ag?.model
    if (pref === 'vision') {
      const cands = this.visionCandidates(task.g, task.providers, task.curP)
      if (cands.length) return cands[0]
    } else if (pref) {
      for (const pr of task.providers) {
        if ((pr.models || []).includes(pref)) return { p: pr, model: pref }
      }
    }
    return { p: task.curP, model: task.model }
  }

  private finishTask(task: TaskState, status: 'done' | 'failed' | 'aborted', error?: string): void {
    // 任务结束清除插话标记, 避免历史插话在后续请求里被持续重排到末尾
    task.messages = task.messages.map(m => m._inject ? { ...m, _inject: false } : m)
    finishTask(task.taskId, status, error)
    this.emit({ type: 'task-done', sid: task.sid, taskId: task.taskId, status, error })
  }

  private checkpoint(task: TaskState, round: number): void {
    // 断点剥离图片 dataURL(体积大), 原图仍在会话文件中
    const cpMsgs = task.messages.map(m => m.images && m.images.length ? { ...m, images: ['[图片已从断点剥离，原图以会话记录为准]'] } : m)
    updateTask(task.taskId, { checkpoint: { messages: cpMsgs, agent: task.agent, activeAgents: task.activeAgents, model: task.model, round, provider: task.curP, handoffAt: task.handoffAt, handoffStack: task.handoffStack, handoffCounts: task.handoffCounts } })
  }

  private findProvider(cp: unknown, providers: EngineProvider[], fallback: EngineProvider): EngineProvider {
    const c = cp as EngineProvider | undefined
    if (c && c.id) {
      const hit = providers.find(x => x.id === c.id)
      if (hit) return hit
    }
    return fallback
  }

  private withEmptyRetry(task: TaskState): (t: TaskState) => Promise<CallResult> {
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
          throw e
        }
      }
    }
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
      const flush = () => {
        flushTimer = null
        this.emit({ type: 'assistant-chunk', sid, id: rid, content: text, reasoning: reasoning || undefined, streaming: true })
      }
      const settle = () => {
        if (settled) return
        settled = true
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
        this.emit({ type: 'assistant-chunk', sid, id: rid, content: text, reasoning: reasoning || undefined, streaming: false })
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
        if (finishReason === 'length' && tcs.length === 0 && text) { reject(new Error('模型输出被截断（输出上限），重试中')); return }
        resolve({ text, reasoning: reasoning || undefined, tcs, ttft, duration, usage: lastUsage || undefined, msgId: rid })
      }
      const msgs = this.buildMsgs(task, isVisionModel(task.model), task.withImages)
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
        thinkLevel: this.resolveThinkLevel(task),
        headers: task.curP.headers,
        requestId: rid,
        sid,
      }, {
        onChunk: d => {
          if (d.done) { if (d.finishReason) finishReason = d.finishReason; settle(); return }
          if (d.content) {
            if (!firstChunkAt) firstChunkAt = Date.now()
            text += d.content
            if (!flushTimer) flushTimer = setTimeout(flush, 40)
          }
          if (d.reasoning) {
            // 兼容累积型/增量型网关: 整段覆盖优先, 否则只追加新片段, 避免重复
            if (!reasoning) reasoning = d.reasoning
            else if (d.reasoning.startsWith(reasoning)) reasoning = d.reasoning
            else if (!reasoning.endsWith(d.reasoning)) reasoning += d.reasoning
            if (!firstChunkAt) firstChunkAt = Date.now()
            if (!flushTimer) flushTimer = setTimeout(flush, 40)
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
      sp: buildPrompt(task.g.mode || 'work', String(task.g.ishiki || ''), task.g, agents, task.g.workDir || ''),
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
    // v0.3.3: browser_vision 需要引擎的视觉模型队列(截图 + 视觉通道回答)
    if (tc.name === 'browser_vision') return this.runBrowserVision(task, tc)
    const ctx = this.buildToolCtx(task)
    const r = await runTool(tc.name, tc.args, ctx)
    return r
  }

  private async runBrowserVision(task: TaskState, tc: EngineToolCall): Promise<string> {
    const q = String((tc.args as { question?: unknown })?.question || '').trim() || '描述这张网页截图'
    const img = String(await invokeHandler('browser:screenshot', [undefined, task.sid + '::' + task.taskId], this.deps.getSender()))
    if (!img || img.startsWith('E:') || img.length < 100) return 'E:页面截图失败: ' + (img || '空')
    const cands = this.visionCandidates(task.g, task.providers, task.curP)
    if (!cands.length) return 'E:未配置视觉理解模型(设置→策略→👁️视觉理解)'
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

  private resolveModel(task: TaskState, key: string): { p: EngineProvider; model: string } | null {
    const val = task.g[key]
    if (!val) return null
    const [pid, m] = String(val).includes('::') ? String(val).split('::') : [null, String(val)]
    if (pid) { const pr = task.providers.find(x => x.id === pid); if (pr && (pr.models || []).includes(m)) return { p: pr, model: m } }
    else if ((task.curP.models || []).includes(String(val))) return { p: task.curP, model: String(val) }
    return null
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
    const readT = u.prompt_cache_hit_tokens || u.prompt_tokens_details?.cached_tokens || u.cache_read_input_tokens || 0
    const inputT = u.prompt_tokens || u.input_tokens || 0
    const writeT = u.cache_creation_input_tokens || 0
    const outT = u.completion_tokens || u.output_tokens || 0
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
    this.emit({ type: 'usage', sid: task.sid, model: mk, usage: { ...u, _readTokens: readT, _inputTokens: inputT, _writeTokens: writeT } })
    // v0.3.3: 上下文环数据源 —— 每次请求的真实 prompt 输入 + 模型上下文上限
    const used = Number(u.prompt_tokens || u.input_tokens || 0)
    const limit = getModelContextLimit(mk)
    if (used > 0) this.emit({ type: 'context', sid: task.sid, used, limit })
    try {
      void invokeHandler('modelStats:recordRequest', [task.sid, mk, readT > 0], null)
      if (readT > 0 || inputT > 0 || writeT > 0) void invokeHandler('modelStats:recordTokens', [task.sid, mk, readT, inputT, writeT], null)
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

  private readProjectCtx(workDir: string): { file: string; content: string } | null {
    try {
      for (const name of ['AGENTS.md', '.agents.md']) {
        const p = join(workDir, name)
        if (fs.existsSync(p)) return { file: name, content: fs.readFileSync(p, 'utf-8').slice(0, 4000) }
      }
    } catch { /* 忽略 */ }
    return null
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
        const subPick = this.pickSubModel(task, ag)
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
          let done = false
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
              thinkLevel: this.resolveThinkLevel(task, subModel),
              requestId: rid,
            }, {
              onChunk: d => { touch(); if (d.content) text += d.content; if (d.done) { done = true; resolveOnce() } },
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
    return '📤 分发完成，共 ' + tasks.length + ' 个子任务：\n\n' + out.join('\n\n---\n\n')
  }
}

// 预算判定(与渲染层 reliability 同构)
function budgetExceeded(used: number, limit: number): boolean {
  return limit > 0 && used >= limit
}
