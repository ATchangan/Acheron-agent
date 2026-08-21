// electron/engine/plan-core.ts — 计划状态机/计划文档纯函数(与引擎解耦, 可单测)

export type PlanStatus = 'pending' | 'running' | 'done' | 'failed' | 'aborted' | 'paused'

export interface PlanStepData {
  id: string
  label: string
  status: PlanStatus
  tool?: string
  detail?: string
  expected?: string
  ms?: number
}

export interface PlanDocOptions {
  goalObjective: string
  goalStatus: string
  goalProgress?: string
  taskStopped: boolean
  steps: PlanStepData[]
  surprises: string[]
  decisions: string[]
  retrospective: string
}

// 计划步骤去重: 按 id 去重; 未认领的 pending/paused 步骤按 label+tool 去重(防模型重复 update_plan 撑大总数)
export function dedupePlanSteps<T extends { id: string; label: string; tool?: string; status: string }>(steps: T[]): T[] {
  const out: T[] = []
  const seenIds = new Set<string>()
  const seenSig = new Set<string>()
  for (const s of steps) {
    if (s.id && seenIds.has(s.id)) continue
    if (s.id) seenIds.add(s.id)
    if ((s.status === 'pending' || s.status === 'paused') && !('toolCallId' in s)) {
      const sig = 'l:' + s.label + '|t:' + (s.tool || '')
      if (seenSig.has(sig)) continue
      seenSig.add(sig)
    }
    out.push(s)
  }
  return out
}

const STATUS_LABEL: Record<string, string> = { done: '完成', running: '进行中', failed: '失败', aborted: '中止', paused: '暂停', pending: '待办' }

// PLANS.md 文档构建(计划式: Goal/Progress/Surprises/Decision Log/Outcomes)
export function buildPlanDocContent(o: PlanDocOptions): string {
  const total = o.steps.length
  const done = o.steps.filter(s => s.status === 'done').length
  const failed = o.steps.filter(s => s.status === 'failed').length
  const aborted = o.steps.filter(s => s.status === 'aborted').length
  const status = o.taskStopped ? '已中止' : (total && done === total ? '已完成' : '执行中')
  const lines: string[] = []
  lines.push('# 执行计划（PLANS.md）', '', '## Goal', '', '目标：' + o.goalObjective, '', '目标状态：' + o.goalStatus + (o.goalProgress ? ' · ' + o.goalProgress : ''), '')
  lines.push('## Progress', '', `- 状态：${status}`, `- 进度：${done}/${total} 完成` + (failed ? `，${failed} 失败` : '') + (aborted ? `，${aborted} 中止` : ''), '')
  lines.push('| 状态 | 步骤 | 工具 | 耗时 | 说明 |', '|---|---|---|---|---|')
  for (const s of o.steps) {
    lines.push(`| ${STATUS_LABEL[s.status] || s.status} | ${s.label} | ${s.tool || '-'} | ${s.ms != null ? s.ms + 'ms' : '-'} | ${(s.detail || s.expected || '').slice(0, 80)} |`)
  }
  lines.push('', '## Surprises & Discoveries', '')
  lines.push(o.surprises.length ? o.surprises.map(x => '- ' + x).join('\n') : '- 暂无')
  lines.push('', '## Decision Log', '')
  lines.push(o.decisions.length ? o.decisions.map(x => '- ' + x).join('\n') : '- 暂无')
  lines.push('', '## Outcomes & Retrospective', '')
  lines.push(o.retrospective || '任务尚未收尾')
  return lines.join('\n')
}

// 修改之后是否有验证步骤(read 确认 / exec_command / codebox)
export function planHasVerification(steps: PlanStepData[], firstWriteIdx = -1): boolean {
  if (firstWriteIdx < 0) firstWriteIdx = steps.findIndex(s => (s.tool === 'write' || s.tool === 'edit' || s.tool === 'apply_patch') && s.status === 'done')
  if (firstWriteIdx < 0) return false
  return steps.slice(firstWriteIdx + 1).some(s => (s.tool === 'read' || s.tool === 'exec_command' || s.tool === 'codebox') && s.status === 'done')
}

// 是否需要强制验证: 改过文件(write/edit/apply_patch)但没有后续验证
export function planNeedsVerify(steps: PlanStepData[]): boolean {
  if (!steps.length) return false
  const firstWriteIdx = steps.findIndex(s => (s.tool === 'write' || s.tool === 'edit' || s.tool === 'apply_patch') && s.status === 'done')
  return firstWriteIdx >= 0 && !planHasVerification(steps, firstWriteIdx)
}
