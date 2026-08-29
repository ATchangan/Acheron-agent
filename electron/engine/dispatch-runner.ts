// electron/engine/dispatch-runner.ts — 子任务并行执行器(0.3.9 结构清理: 从 engine.ts 抽出)
// 子任务在主进程并行执行: 上下文隔离 + 工具白名单 + 并发上限 + 看门狗 + 结构化结果
import { getAgents, type AgentDef } from './agents'
import { filterToolsByAgent } from './context'
import { getActiveTools, type ToolRunCtx } from './tools'
import { streamChat } from './llm-core'
import type { LlmMsg } from './llm-core'
import { buildSubSystemPrompt, parseSubResult, buildSubSummary } from './sub-result'
import { pickSubModel, resolveThinkLevel as resolveThinkLevelOf } from './model-router'
import { invokeHandler } from './registry'
import type { EngineEvent, EngineToolCall, EngineUsage } from './types'
import type { TaskState } from './task-types'

export interface DispatchDeps {
  netFetch: typeof fetch
  curGen: (sid: string) => number
  emit: (ev: EngineEvent) => void
  trace: (level: 'debug' | 'info' | 'warn' | 'error', event: string, detail?: string, sid?: string, requestId?: string) => void
  buildToolCtx: (task: TaskState) => ToolRunCtx
  runToolGuarded: (task: TaskState, tc: EngineToolCall, ctx: ToolRunCtx, opts?: { subAgent?: string }) => Promise<string>
  planAppend: (task: TaskState, tcs: EngineToolCall[], summary?: string) => void
  planStart: (task: TaskState, tcs: EngineToolCall[], messageId?: string) => string[]
  planFinish: (task: TaskState, ids: string[], results: { r: string; ms: number }[]) => void
  recordUsage: (task: TaskState, rid: string, u: EngineUsage, modelOverride?: string) => void
}

export async function runDispatch(deps: DispatchDeps, task: TaskState, tasks: { agent: string; task: string }[]): Promise<string> {
  // 停止后不再启动新的分发执行
  if (deps.curGen(task.sid) !== task.myGen) return '已终止'
  const agents = getAgents(task.g.agentOverrides as Record<string, Partial<AgentDef>> | undefined)
  if (!tasks.length) return 'E:dispatch 需要 tasks 数组 [{agent, task}]'
  const disabledAgents = task.g.disabledAgents || []
  const validAgents = tasks.map(t => t.agent).filter(n => agents[n] && !disabledAgents.includes(n))
  if (validAgents.length) {
    task.activeAgents = [...new Set([...task.activeAgents, ...validAgents])]
    deps.emit({ type: 'agent', sid: task.sid, agent: task.agent || '', activeAgents: task.activeAgents })
  }
  const out: string[] = []
  const dispGen = deps.curGen(task.sid)
  // 并发上限: 按「最多同时活跃角色」分批执行, 默认 5
  const maxConcurrent = Math.max(1, Number(task.g.maxAgents) || 5)
  const results: { agent: string; task: string; result: string }[] = []
  for (let i = 0; i < tasks.length; i += maxConcurrent) {
    const chunk = tasks.slice(i, i + maxConcurrent)
    results.push(...await Promise.all(chunk.map(async (t) => {
      const ag = agents[t.agent]
      if (!ag) return { agent: t.agent, task: t.task, result: 'E:未知角色' }
      if (disabledAgents.includes(t.agent)) return { agent: t.agent, task: t.task, result: 'E:该角色已被禁用: ' + t.agent }
      const sp = buildSubSystemPrompt(ag, t.agent, t.task)
      const COLLAB_TOOLS = ['handoff', 'dispatch', 'list_agents']
      // 子任务用子角色构建工具上下文, 避免父角色白名单误伤子角色工具
      const subCtx = {
        ...deps.buildToolCtx(task),
        agent: t.agent,
        isSubtask: true,
        activeAgents: [...task.activeAgents, t.agent],
      }
      const agTools = filterToolsByAgent(getActiveTools(subCtx), t.agent, agents).filter(tt => !COLLAB_TOOLS.includes(tt.function.name))
      // 子任务使用角色专属模型(如设计 vision), 未配置则继承当前模型
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
        let toolBusy = false
        let finished = false
        let watchdog: ReturnType<typeof setInterval> | null = null
        const finish = (v: string) => { if (finished) return; finished = true; if (watchdog) clearInterval(watchdog); resolveSub(v) }
        const touch = () => { lastActivity = Date.now() }
        // 活动看门狗: 只在“长时间无任何数据/工具产出”时判超时, 不设总时长上限; 超时顺手中止在跑命令
        // v0.4.4: 工具在跑(await runToolGuarded 期间)视为活跃, 不把合法长工具/长命令误判为无进展
        watchdog = setInterval(() => {
          if (toolBusy) { lastActivity = Date.now(); return }
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
            deps.trace('warn', 'subtask.rounds-extend', t.agent + ' 轮次 ' + subRounds + ' → 上限自动顺延至 ' + subRoundLimit, task.sid, task.taskId)
          }
          if (deps.curGen(task.sid) !== dispGen) { finish('已终止'); return }
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
            streamChat(deps.netFetch, {
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
              onUsage: u => { touch(); deps.recordUsage(task, rid, u as EngineUsage, subModel) },
              onError: e => { touch(); err = e; resolveOnce() },
            }).catch(e => { touch(); err = e; resolveOnce() })
          })
          touch()
          if (deps.curGen(task.sid) !== dispGen) { finish('已终止'); return }
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
              // 子代理工具统一走 runToolGuarded —— 文件快照/事件钩子/子目录指令/审计与主循环一致
              const t0 = Date.now()
              deps.emit({ type: 'stage', sid: task.sid, phase: 'tool', label: '[' + t.agent + '] 执行 ' + tc.name, detail: JSON.stringify(tc.args || {}).slice(0, 40) })
              toolBusy = true
              const rr = await deps.runToolGuarded(task, tc, subCtx, { subAgent: t.agent })
              toolBusy = false
              const subMs = Date.now() - t0
              task.toolLog.push({ name: tc.name, args: tc.args, result: rr, error: rr.startsWith('E:'), ms: subMs, toolCallId: tc.id, agent: t.agent })
              deps.trace(rr.startsWith('E:') ? 'warn' : 'info', 'subtool', tc.name + ' ' + subMs + 'ms', task.sid, task.taskId)
              // 子代理工具进入主计划, 便于界面可见与任务复盘
              deps.planAppend(task, [tc])
              const subPlanIds = deps.planStart(task, [tc])
              for (const pid of subPlanIds) {
                const st = task.planSteps.find(s => s.id === pid)
                if (st && !String(st.label).startsWith('[')) st.label = '[' + t.agent + '] ' + st.label
              }
              deps.planFinish(task, subPlanIds, [{ r: rr, ms: subMs }])
              touch()
              subMsgs.push({ role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }] })
              subMsgs.push({ role: 'tool', content: rr, tool_call_id: tc.id })
            }
            setTimeout(() => void step(), 50)
            return
          }
          // 子代理结果结构化 —— 提取 目标/状态/产出物/未决问题, 失败解析回退原文
          const parsed = parseSubResult(text)
          subText = buildSubSummary(t.agent, t.task, parsed, text)
          finish(subText)
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
