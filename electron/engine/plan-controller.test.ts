import { describe, expect, it } from 'vitest'
import { PlanController } from './plan-controller'
import type { TaskState } from './task-types'
import type { PlanStep } from './types'

function state(steps: Partial<PlanStep>[]): TaskState {
  return {
    sid: 's', taskId: 't', myGen: 1, content: '', userMsgId: 'u',
    userMsg: { id: 'u', role: 'user', content: 'x', timestamp: 1 },
    messages: [], g: {}, providers: [], p: {} as never, curP: {} as never,
    model: 'm', origModel: 'm', modelFailCount: 0, modelFallbackUsed: false,
    activeAgents: [], handoffStack: [], handoffCounts: {}, handoffAt: -1,
    toolLog: [], tokBase: {}, memoryText: '', projectCtx: null,
    instrVisited: new Set(), fileSnapshots: {}, memory: { facts: [], summaries: [] },
    lastMidSave: 0,
    planSteps: steps.map((s, i) => ({ id: 'p' + i, label: '步骤' + i, status: 'done', ...s })) as PlanStep[],
    planSummary: '', planGateChecked: true, planEmitTimer: null, planLastSnapshot: '',
    planSurprises: [], planDecisions: [], planDocTimer: null,
    goal: { objective: 'x', status: 'active', startedAt: Date.now() },
    planPending: null, planApproved: true, stopped: false, taskFinished: false,
    running: true, roundNum: 1, interjects: [], withImages: false, switchedVision: false,
  } as unknown as TaskState
}

describe('planRetrospective 协作提示(自省整改 #4/#6)', () => {
  const ctrl = new PlanController({ userDataPath: '', isCurrent: () => true, emit: () => {} })

  it('3 步以上且未用 dispatch/handoff 时给出协作提示', () => {
    const retro = ctrl.planRetrospective(state([
      { tool: 'read' }, { tool: 'grep' }, { tool: 'write' },
    ]))
    expect(retro).toContain('[协作提示]')
  })

  it('使用 dispatch 后不再提示', () => {
    const retro = ctrl.planRetrospective(state([
      { tool: 'dispatch' }, { tool: 'read' }, { tool: 'write' },
    ]))
    expect(retro).not.toContain('[协作提示]')
  })

  it('少于 3 步不提示', () => {
    const retro = ctrl.planRetrospective(state([{ tool: 'read' }, { tool: 'write' }]))
    expect(retro).not.toContain('[协作提示]')
  })
})
