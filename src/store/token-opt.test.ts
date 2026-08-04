import { describe, it, expect } from 'vitest'
import { outputLimit, sessionTokens, foldToolRounds, buildTaskArchives, buildContextualMessages } from './context'
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

describe('0.3.3 T3 buildTaskArchives 跨任务归档', () => {
  function taskBlock(prefix: string, rounds: number): Message[] {
    const out: Message[] = [{ id: prefix + 'u', role: 'user', content: '任务 ' + prefix, timestamp: 1 }]
    for (let i = 0; i < rounds; i++) {
      out.push({ id: prefix + 'a' + i, role: 'assistant', content: null, timestamp: i + 2, tool_calls: [{ id: prefix + 'tc' + i, type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: 'D:/x/' + prefix + i + '.txt' }) } }] })
      out.push({ id: prefix + 't' + i, role: 'tool', content: 'result', timestamp: i + 2, tool_call_id: prefix + 'tc' + i })
    }
    out.push({ id: prefix + 'aend', role: 'assistant', content: '任务 ' + prefix + ' 已完成，文件保存路径 D:/x/out-' + prefix + '.txt', timestamp: 99 })
    return out
  }

  it('最早任务块满足条件时归档, keep 只留后续块', () => {
    const msgs = [...taskBlock('A', 3), ...taskBlock('B', 2)]
    const r = buildTaskArchives(msgs)
    expect(r.archives.length).toBe(1)
    expect(r.archives[0].goal).toContain('任务 A')
    expect(r.archives[0].outputs).toContain('D:/x/A0.txt')
    expect(r.keep[0].role).toBe('user')
    expect(String(r.keep[0].content)).toContain('任务 B')
  })

  it('条件不足(消息少/工具少/单块)不归档', () => {
    expect(buildTaskArchives(taskBlock('A', 1)).archives.length).toBe(0)
    const short = [taskBlock('A', 3)[0], ...taskBlock('B', 2)]
    expect(buildTaskArchives(short).archives.length).toBe(0)
  })
})

describe('0.3.3 T1/T2 图片降级与参数截断(buildContextualMessages 全链路)', () => {
  const gSnap = { mode: 'work', maxTokens: 4000, taskArchive: false } as GeneralSettings
  const opts = { gSnap, cl: 8000, spIshiki: 'x', spFallback: 'x', onAgentRoute: () => {}, agent: '姬子' }

  it('历史轮次图片降级为文字, 最新用户消息带图保留原图', () => {
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: '看这张图', timestamp: 1, images: ['data:image/png;base64,AAAA'] },
      { id: 'a1', role: 'assistant', content: '看到了', timestamp: 2 },
      { id: 'u2', role: 'user', content: '继续', timestamp: 3 },
    ]
    const d = buildContextualMessages(msgs, true, opts)
    const u1 = d.find(m => m.role === 'user' && Array.isArray(m.content))!
    const parts = u1.content as { type: string; text?: string; image_url?: { url: string } }[]
    // u1 是历史轮次 → 图降级为文字
    expect(parts.some(p => p.type === 'image_url')).toBe(false)
    expect(parts.some(p => p.type === 'text' && String(p.text).includes('[图片省略'))).toBe(true)

    const msgs2: Message[] = [
      { id: 'u1', role: 'user', content: '看这张图', timestamp: 1, images: ['data:image/png;base64,AAAA'] },
      { id: 'u2', role: 'user', content: '再看这张', timestamp: 3, images: ['data:image/png;base64,BBBB'] },
    ]
    const d2 = buildContextualMessages(msgs2, true, opts)
    const last = d2[d2.length - 1]!
    const parts2 = last.content as { type: string; image_url?: { url: string } }[]
    expect(parts2.some(p => p.type === 'image_url')).toBe(true)
  })

  it('历史 tool_calls 超长参数截断, path 定位字段全量保留', () => {
    const long = 'x'.repeat(3000)
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: '写文件', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: null, timestamp: 2, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: 'D:/keep.txt', content: long }) } }] },
      { id: 't1', role: 'tool', content: 'ok', timestamp: 3, tool_call_id: 'tc1' },
    ]
    const d = buildContextualMessages(msgs, false, opts)
    const asst = d.find(m => m.role === 'assistant' && m.tool_calls)!
    const args = JSON.parse(asst.tool_calls![0].function.arguments) as Record<string, string>
    expect(args.path).toBe('D:/keep.txt')
    expect(args.content).toContain('…[省略')
    expect(args.content!.length).toBeLessThan(300)
  })
})
