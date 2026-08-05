import { describe, it, expect, vi, afterEach } from 'vitest'
import { assertAlternates } from './context'
import type { LLMMessage } from '../global'

describe('context 序列断言兜底(M4-2)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('合法序列零告警', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d: LLMMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'exec_command', arguments: '{}' } }] },
      { role: 'tool', content: 'ok', tool_call_id: 't1' },
      { role: 'assistant', content: 'done' },
    ]
    assertAlternates(d)
    const alerts = spy.mock.calls.filter(c => String(c[0]).includes('序列校验'))
    expect(alerts.length).toBe(0)
  })

  it('违规序列(assistant(tool_calls) 后是 user)触发告警 —— 兜底生效', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d: LLMMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'exec_command', arguments: '{}' } }] },
      // 违规: tool_calls 后直接 user(重排被破坏时的情形)
      { role: 'user', content: '插话' },
      { role: 'tool', content: 'ok', tool_call_id: 't1' },
    ]
    assertAlternates(d)
    const alerts = spy.mock.calls.filter(c => String(c[0]).includes('序列校验'))
    expect(alerts.length).toBeGreaterThan(0)
    expect(String(alerts[0][0])).toContain('位置 1')
  })
})
