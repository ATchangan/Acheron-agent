import { describe, expect, it } from 'vitest'
import { buildContextualMessages, buildPrompt, estimateTokens, routeAgent, slimToolResult } from './context'
import { getAgents } from './agents'

const G = { workDir: 'D:/test', mode: 'work', collabMode: '自动', thinkLevel: 'medium' }

describe('engine context', () => {
  it('estimateTokens 基本正数估算', () => {
    expect(estimateTokens('你好世界 hello world', 'test-model')).toBeGreaterThan(0)
    expect(estimateTokens('', 'test-model')).toBe(0)
  })

  it('slimToolResult 长结果截断保留头尾', () => {
    const long = 'a'.repeat(3000)
    const out = slimToolResult(long)
    expect(out.length).toBeLessThan(2000)
    expect(out).toContain('已截断')
  })

  it('buildPrompt 包含身份与多角色编队', () => {
    const sp = buildPrompt('work', '测试人设', G, getAgents(), 'D:/test')
    expect(sp).toContain('多角色编队')
    expect(sp).toContain('助手')
    expect(sp).toContain('简单任务直接调工具')
  })

  it('routeAgent 简单消息不路由, 代码消息路由开发', () => {
    expect(routeAgent('你好', G)).toBeNull()
    expect(routeAgent('帮我写一个 python 脚本', G)).toBe('开发')
  })

  it('buildContextualMessages 注入 LLM 早期摘要', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, content: '你好', timestamp: 1 },
      { id: 'a1', role: 'assistant' as const, content: '你好，有什么可以帮你', timestamp: 2 },
    ]
    const out = buildContextualMessages(msgs, false, {
      g: G,
      cl: 65536,
      spIshiki: '人设',
      sp: buildPrompt('work', '人设', G, getAgents(), 'D:/test'),
      memoryText: '',
      model: 'test',
      workflowsFull: false,
      agents: getAgents(),
      mode: 'work',
      earlySummary: '早期聊了问候',
    })
    const sys = out[0]
    expect(sys.role).toBe('system')
    expect(String(sys.content)).toContain('LLM 前文摘要')
    expect(String(sys.content)).toContain('早期聊了问候')
  })

  it('handoffContext=false 时只保留交接点之后的消息', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, content: '早期需求', timestamp: 1 },
      { id: 'a1', role: 'assistant' as const, content: null, timestamp: 2, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'handoff', arguments: '{"agent_name":"文档"}' } }] },
    { id: 't1', role: 'tool' as const, content: '[已交接] 已交接给 文档', timestamp: 3, tool_call_id: 'c1' },
      { id: 'a2', role: 'assistant' as const, content: '接手后的回答', timestamp: 4 },
    ]
    const g = { ...G, handoffContext: false }
    const out = buildContextualMessages(msgs, false, {
      g,
      cl: 65536,
      spIshiki: '人设',
      sp: buildPrompt('work', '人设', g, getAgents(), 'D:/test'),
      agent: '文档',
      handoffFrom: 2,
      memoryText: '',
      model: 'test',
      workflowsFull: false,
      agents: getAgents(),
      mode: 'work',
    })
    const contents = out.filter(m => m.role === 'user' || m.role === 'tool' || (m.role === 'assistant' && m.content)).map(m => String(m.content))
    expect(contents.some(c => c.includes('早期需求'))).toBe(false)
    expect(contents.some(c => c.includes('已交接给'))).toBe(true)
    expect(contents.some(c => c.includes('接手后的回答'))).toBe(true)
    const toolIdx = out.findIndex(m => m.role === 'tool')
    expect(toolIdx).toBeGreaterThan(0)
    expect(out[toolIdx - 1]?.role).toBe('assistant')
    expect((out[toolIdx - 1] as { tool_calls?: unknown[] })?.tool_calls?.length).toBeGreaterThan(0)
  })

})
