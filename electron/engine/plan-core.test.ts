import { describe, expect, it } from 'vitest'
import { buildPlanDocContent, planHasVerification, planNeedsVerify, type PlanStepData } from './plan-core'

const step = (over: Partial<PlanStepData>): PlanStepData => ({ id: 's1', label: '步骤', status: 'pending', ...over })

describe('buildPlanDocContent', () => {
  it('生成五段结构并输出中文状态', () => {
    const doc = buildPlanDocContent({
      goalObjective: '测试目标',
      goalStatus: '进行中',
      taskStopped: false,
      steps: [step({ id: 'a', label: '读取', tool: 'read', status: 'done', ms: 12 }), step({ id: 'b', label: '失败步骤', tool: 'write', status: 'failed', detail: 'E:boom' })],
      surprises: ['发现 X'],
      decisions: ['决定 Y'],
      retrospective: '复盘内容',
    })
    expect(doc).toContain('# 执行计划（PLANS.md）')
    expect(doc).toContain('## Goal')
    expect(doc).toContain('目标：测试目标')
    expect(doc).toContain('## Progress')
    expect(doc).toContain('1/2 完成，1 失败')
    expect(doc).toContain('| 完成 | 读取 | read | 12ms |')
    expect(doc).toContain('| 失败 | 失败步骤 | write | - |')
    expect(doc).toContain('## Surprises & Discoveries')
    expect(doc).toContain('- 发现 X')
    expect(doc).toContain('## Decision Log')
    expect(doc).toContain('- 决定 Y')
    expect(doc).toContain('## Outcomes & Retrospective')
    expect(doc).toContain('复盘内容')
  })

  it('任务中止时状态为已中止', () => {
    const doc = buildPlanDocContent({ goalObjective: 'g', goalStatus: '已中止', taskStopped: true, steps: [], surprises: [], decisions: [], retrospective: '' })
    expect(doc).toContain('状态：已中止')
  })

  it('空步骤时进度为 0/0', () => {
    const doc = buildPlanDocContent({ goalObjective: 'g', goalStatus: '进行中', taskStopped: false, steps: [], surprises: [], decisions: [], retrospective: '' })
    expect(doc).toContain('0/0 完成')
  })
})

describe('planNeedsVerify / planHasVerification', () => {
  it('write 后无验证 → 需要强制验证', () => {
    const steps = [step({ id: 'a', label: '写入', tool: 'write', status: 'done' })]
    expect(planNeedsVerify(steps)).toBe(true)
  })

  it('write 后有 read 确认 → 不需要', () => {
    const steps = [step({ id: 'a', label: '写入', tool: 'write', status: 'done' }), step({ id: 'b', label: '读取', tool: 'read', status: 'done' })]
    expect(planNeedsVerify(steps)).toBe(false)
  })

  it('write 后有 exec_command → 不需要', () => {
    const steps = [step({ id: 'a', label: '写入', tool: 'write', status: 'done' }), step({ id: 'b', label: '验证', tool: 'exec_command', status: 'done' })]
    expect(planNeedsVerify(steps)).toBe(false)
  })

  it('纯读取任务 → 不需要', () => {
    const steps = [step({ id: 'a', label: '读取', tool: 'read', status: 'done' })]
    expect(planNeedsVerify(steps)).toBe(false)
  })

  it('write 之前有 read → 仍需要(验证必须在修改之后)', () => {
    const steps = [step({ id: 'a', label: '读取', tool: 'read', status: 'done' }), step({ id: 'b', label: '写入', tool: 'write', status: 'done' })]
    expect(planNeedsVerify(steps)).toBe(true)
  })

  it('apply_patch 也触发验证要求', () => {
    const steps = [step({ id: 'a', label: '编辑', tool: 'apply_patch', status: 'done' })]
    expect(planNeedsVerify(steps)).toBe(true)
  })

  it('planHasVerification 支持指定起始下标', () => {
    const steps = [step({ id: 'a', label: '读', tool: 'read', status: 'done' }), step({ id: 'b', label: '写', tool: 'write', status: 'done' }), step({ id: 'c', label: '验', tool: 'codebox', status: 'done' })]
    expect(planHasVerification(steps, 1)).toBe(true)
    expect(planHasVerification(steps, 0)).toBe(true)
  })
})
