import { describe, expect, it } from 'vitest'
import { buildSubSummary, buildSubSystemPrompt, parseSubResult } from './sub-result'
import type { AgentDef } from './agents'

const AG: AgentDef = { role: '测试', prompt: '执行任务', tools: ['*'], handoff_to: [], icon: '测', memoryScope: 'private', capabilities: [] }

describe('sub-result 结构化结果', () => {
  it('解析 ```json 代码块并提取字段', () => {
    const text = '已完成。\n```json\n{"goal":"写报告","status":"done","outputs":["D:/out/report.md"],"open":[],"note":"完成"}\n```'
    const r = parseSubResult(text)
    expect(r.goal).toBe('写报告')
    expect(r.status).toBe('done')
    expect(r.outputs).toEqual(['D:/out/report.md'])
    expect(r.open).toEqual([])
  })

  it('无代码块时兜底解析最后一个 JSON 对象', () => {
    const r = parseSubResult('随便说点 {"goal":"g","status":"partial","outputs":["a"],"open":["b"]}')
    expect(r.goal).toBe('g')
    expect(r.status).toBe('partial')
  })

  it('无法解析时回退原文', () => {
    const r = parseSubResult('没有任何 JSON')
    expect(r).toEqual({})
    expect(buildSubSummary('银狼', '检查安全', r, '原始结果')).toContain('原始结果')
  })

  it('结构化摘要包含目标/状态/产出物', () => {
    const s = buildSubSummary('银狼', 't', { goal: '安全审计', status: 'done', outputs: ['report.md'], open: [] })
    expect(s).toContain('【银狼】')
    expect(s).toContain('安全审计')
    expect(s).toContain('report.md')
  })

  it('子代理提示词包含交付格式与私有记忆', () => {
    const p = buildSubSystemPrompt(AG, '银狼', '检查配置', '## 私有记忆\n- 之前发现过配置泄漏')
    expect(p).toContain('交付格式')
    expect(p).toContain('```json')
    expect(p).toContain('配置泄漏')
    expect(p).toContain('不要询问')
  })
})
