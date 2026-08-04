import { describe, it, expect } from 'vitest'
import { outputLimit, sessionTokens, foldToolRounds } from './context'
import type { Message } from '../global'
import type { GeneralSettings } from '../types'

describe('0.3.2 T7 outputLimit 输出上限分级', () => {
  const cfg = { maxTokens: 4096 } as GeneralSettings
  it('短闲聊消息降为 800', () => {
    expect(outputLimit('在吗', cfg)).toBe(800)
  })
  it('代码/文件类消息保持全局上限', () => {
    expect(outputLimit('帮我写一个脚本', cfg)).toBe(4096)
    expect(outputLimit('分析这个文件', cfg)).toBe(4096)
  })
  it('maxTokens 低于 800 时取小值(不放大)', () => {
    expect(outputLimit('在吗', { maxTokens: 500 } as GeneralSettings)).toBe(500)
  })
  it('无 maxTokens 时默认 4096 基准', () => {
    expect(outputLimit('在吗', {} as GeneralSettings)).toBe(800)
    expect(outputLimit('帮我写脚本', {} as GeneralSettings)).toBe(4096)
  })
})

describe('0.3.2 T8 sessionTokens 会话累计统计', () => {
  it('聚合 input/output 两种命名', () => {
    const msgs: Message[] = [
      { id: 'a1', role: 'assistant', content: 'x', timestamp: 1, usage: { input_tokens: 100, completion_tokens: 20 } },
      { id: 'a2', role: 'assistant', content: 'y', timestamp: 2, usage: { prompt_tokens: 50, completion_tokens: 30 } },
      { id: 'u1', role: 'user', content: 'z', timestamp: 3 },
    ]
    expect(sessionTokens(msgs)).toEqual({ input: 150, output: 50 })
  })
  it('无 usage 返回 0', () => {
    expect(sessionTokens([])).toEqual({ input: 0, output: 0 })
  })
})

function tcPair(n: number): Message[] {
  const out: Message[] = []
  for (let i = 0; i < n; i++) {
    out.push({ id: 'a' + i, role: 'assistant', content: null, timestamp: i, tool_calls: [{ id: 'tc' + i, type: 'function', function: { name: 'read', arguments: '{}' } }] })
    out.push({ id: 't' + i, role: 'tool', content: 'result ' + i, timestamp: i, tool_call_id: 'tc' + i })
  }
  return out
}

describe('0.3.2 T6 foldToolRounds 历史轮次折叠', () => {
  it('超过 8 对完整轮次时折叠最旧 4 对', () => {
    const msgs = tcPair(10)
    const out = foldToolRounds(msgs)
    // 10 对 → 折叠 4 对(8 条)为 1 条摘要 → 13 条消息
    expect(out.length).toBe(13)
    expect(out[0].role).toBe('user')
    expect(String(out[0].content)).toContain('[工具调用归档]')
    expect(String(out[0].content)).toContain('read(4)')
  })
  it('≤8 对不触发折叠', () => {
    const msgs = tcPair(8)
    expect(foldToolRounds(msgs)).toBe(msgs)
  })
  it('配对不完整时跳过折叠(防悬空 tool_call_id)', () => {
    const msgs = tcPair(9)
    // 删除最后一对中的 tool 消息 → 有一个悬空 assistant
    msgs.pop()
    const out = foldToolRounds(msgs)
    expect(out).toBe(msgs)
  })
})
