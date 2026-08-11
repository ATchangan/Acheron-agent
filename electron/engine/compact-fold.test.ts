import { describe, expect, it } from 'vitest'
import { pickMicroFoldCandidates } from './compact'
import type { EngineMessage } from './types'

function msg(id: string, role: EngineMessage['role'], content: string | null, tool = false): EngineMessage {
  return { id, role, content, timestamp: 1, tool_calls: tool ? [{ id: 'c', type: 'function', function: { name: 'ls', arguments: '{}' } }] : undefined }
}

describe('pickMicroFoldCandidates 批量微压缩', () => {
  it('收集最旧的 3 组纯问答', () => {
    const msgs: EngineMessage[] = [
      msg('u1', 'user', '你好'),
      msg('a1', 'assistant', '你好呀'),
      msg('u2', 'user', '今天的天气'),
      msg('a2', 'assistant', '晴天'),
      msg('u3', 'user', '帮我写报告'),
      msg('a3', 'assistant', '好的'),
      msg('u4', 'user', '还有别的吗'),
      msg('a4', 'assistant', '没了'),
    ]
    const r = pickMicroFoldCandidates(msgs, 3)
    expect(r).not.toBeNull()
    expect(r!.pairs.length).toBe(3)
    expect(r!.start).toBe(0)
    expect(r!.end).toBe(6)
  })

  it('跳过工具轮, 不拆散 assistant(tool_calls)/tool 配对', () => {
    const msgs: EngineMessage[] = [
      msg('u0', 'user', '旧问答'),
      msg('a0', 'assistant', '旧回答'),
      msg('u1', 'user', '查一下'),
      msg('a1', 'assistant', null, true),
      { id: 't1', role: 'tool', content: '结果', timestamp: 1, tool_call_id: 'c' },
      msg('u2', 'user', '然后呢'),
      msg('a2', 'assistant', '完成了'),
    ]
    const r = pickMicroFoldCandidates(msgs, 3)
    expect(r!.pairs.length).toBe(1)
    expect(r!.start).toBe(0)
    expect(r!.end).toBe(2)
  })

  it('不足一组返回 null, 最近用户消息之后不折叠', () => {
    expect(pickMicroFoldCandidates([msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b')], 3)).toBeNull()
    const msgs: EngineMessage[] = [
      msg('u1', 'user', '旧问答'),
      msg('a1', 'assistant', '旧回答'),
      msg('u2', 'user', '新问题'),
    ]
    const r = pickMicroFoldCandidates(msgs, 3)
    expect(r).not.toBeNull()
    expect(r!.end).toBe(2)
  })
})
