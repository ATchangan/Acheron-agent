// electron/engine/plan-controller.ts — 计划状态机与 PLANS.md 文档(0.3.9 结构清理: 从 engine.ts 抽出)
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import { join } from 'path'
import type { EngineEvent, EngineToolCall, PlanStep } from './types'
import type { TaskState } from './task-types'
import { buildPlanDocContent, dedupePlanSteps, planHasVerification as planHasVerificationCore, type PlanStepData } from './plan-core'
import { toolLabel, toolDetail, toolExpected } from './tool-labels'

export interface PlanControllerDeps {
  userDataPath: string
  isCurrent: (task: TaskState) => boolean
  emit: (ev: EngineEvent) => void
}

export class PlanController {
  constructor(private deps: PlanControllerDeps) {}

  // plan-update 节流合并(150ms) —— 长任务步骤多时避免每步一次全量 IPC
  emitPlan(task: TaskState, force = false): void {
    const { steps, changedIds } = this.buildPlanEvent(task)
    if (force) {
      if (task.planEmitTimer) { clearTimeout(task.planEmitTimer); task.planEmitTimer = null }
      this.deps.emit({ type: 'plan-update', sid: task.sid, summary: task.planSummary || undefined, steps, changedIds })
      return
    }
    if (task.planEmitTimer) return
    task.planEmitTimer = setTimeout(() => {
      task.planEmitTimer = null
      if (!this.deps.isCurrent(task)) return
      const latest = this.buildPlanEvent(task)
      this.deps.emit({ type: 'plan-update', sid: task.sid, summary: task.planSummary || undefined, steps: latest.steps, changedIds: latest.changedIds })
    }, 150)
  }

  // 计划增量 —— 对比上次快照, 只标记变化的步骤 id, 渲染层按 id 局部 patch
  buildPlanEvent(task: TaskState): { steps: PlanStep[]; changedIds?: string[] } {
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

  flushPlan(task: TaskState): void {
    this.emitPlan(task, true)
  }

  // 新批次工具调用 → 追加步骤。按 tc.id 去重: 同一工具调用只生成一次步骤(门禁前/恢复后重放安全)
  planAppend(task: TaskState, tcs: EngineToolCall[], summary?: string): void {
    if (summary && !task.planSummary) task.planSummary = String(summary).slice(0, 500)
    if (!tcs.length) return
    for (const tc of tcs) {
      if (tc.name === 'update_plan') continue
      if (task.planSteps.some(s => s.toolCallId && s.toolCallId === tc.id)) continue
      // 优先认领模型 update_plan 声明的 pending 步骤(无 toolCallId), 避免声明与自动生成重复
      const declared = task.planSteps.find(s => s.status === 'pending' && !s.toolCallId && (!s.tool || s.tool === tc.name))
      if (declared) {
        declared.toolCallId = tc.id
        declared.tool = tc.name
        if (!declared.detail) declared.detail = toolDetail(tc)
        if (!declared.expected) declared.expected = toolExpected(tc)
        continue
      }
      const step: PlanStep = { id: uuidv4(), label: toolLabel(tc), status: 'pending', tool: tc.name, detail: toolDetail(tc), toolCallId: tc.id, expected: toolExpected(tc) }
      task.planSteps.push(step)
    }
    task.planSteps = dedupePlanSteps(task.planSteps)
    this.emitPlan(task)
  }

  // 开始执行当前批次: 按 toolCallId 精确绑定步骤(缺失时回退到首个 pending), 返回按 res.tcs 顺序的 step id
  planStart(task: TaskState, tcs: EngineToolCall[], messageId?: string): string[] {
    const ids: string[] = []
    for (const tc of tcs) {
      if (tc.name === 'update_plan') continue
      let st = task.planSteps.find(s => s.toolCallId && s.toolCallId === tc.id)
      if (!st) st = task.planSteps.find(s => s.status === 'pending' && !s.toolCallId && (!s.tool || s.tool === tc.name))
      if (!st) {
        st = { id: uuidv4(), label: toolLabel(tc), status: 'pending', tool: tc.name, detail: toolDetail(tc), toolCallId: tc.id, expected: toolExpected(tc) }
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
  planFinish(task: TaskState, ids: string[], results: { r: string; ms: number }[]): void {
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
  planFailPending(task: TaskState, reason: string): void {
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
  planCloseAll(task: TaskState, status: 'aborted' | 'failed', reason?: string): void {
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

  // 计划复盘 —— 任务收尾时由代码生成结构化复盘(零额外 LLM 调用)
  planRetrospective(task: TaskState): string {
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
    // 验证闭环 —— 改过文件但没有独立验证命令时给出提醒
    const touchedFiles = steps.some(s => (s.tool === 'write' || s.tool === 'edit' || s.tool === 'apply_patch') && s.status === 'done')
    if (touchedFiles && !planHasVerificationCore(steps as PlanStepData[])) lines.push('- [!] 修改过文件但未检测到独立验证命令，建议补充构建/测试/检查')
    return lines.join('\n')
  }

  // PLANS.md 计划文档(计划式: Progress/Surprises/Decision Log/Outcomes)
  planDocDir(): string {
    return join(this.deps.userDataPath, 'plans')
  }

  planDocPath(task: TaskState): string {
    return join(this.planDocDir(), task.taskId + '.md')
  }

  planStamp(): string {
    const d = new Date()
    const p2 = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
  }

  planAddDecision(task: TaskState, text: string): void {
    task.planDecisions.push('`' + this.planStamp() + '` ' + text)
    if (task.planDecisions.length > 80) task.planDecisions = task.planDecisions.slice(-80)
    this.schedulePlanDoc(task)
  }

  planAddSurprise(task: TaskState, text: string): void {
    task.planSurprises.push('`' + this.planStamp() + '` ' + text)
    if (task.planSurprises.length > 40) task.planSurprises = task.planSurprises.slice(-40)
    this.schedulePlanDoc(task)
  }

  buildPlanDoc(task: TaskState): string {
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

  writePlanDoc(task: TaskState): void {
    try {
      fs.mkdirSync(this.planDocDir(), { recursive: true })
      // 异步写盘, 避免长任务高频节流时阻塞主进程
      const content = this.buildPlanDoc(task)
      void fs.promises.writeFile(this.planDocPath(task), content, 'utf8').catch(() => {})
    } catch { /* 计划文档写入失败不影响主流程 */ }
  }

  schedulePlanDoc(task: TaskState): void {
    if (task.planDocTimer) return
    task.planDocTimer = setTimeout(() => {
      task.planDocTimer = null
      if (!this.deps.isCurrent(task)) return
      this.writePlanDoc(task)
    }, 2000)
  }

  flushPlanDoc(task: TaskState): void {
    if (task.planDocTimer) { clearTimeout(task.planDocTimer); task.planDocTimer = null }
    this.writePlanDoc(task)
  }

  // 模型自主计划工具(update_plan) —— 声明/更新计划步骤
  applyPlanUpdate(task: TaskState, steps: { label?: string; status?: string; expected?: string; id?: string; tool?: string }[]): string {
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
}
