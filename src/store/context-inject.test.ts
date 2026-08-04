import { describe, it, expect, vi, beforeEach } from 'vitest'

// 最小 stub: window 环境 + store 依赖(buildPrompt 内部读取)
vi.mock('./settings', () => ({
  useSettingsStore: { getState: () => ({
    general: { thinkLevel: 'medium', mode: 'work', customSystemPrompt: null, promptInjectPos: 'end', language: 'zh', autoFastModel: true, collabMode: '开启', compactStrategy: 'auto', compactMsgCount: 40, compactTokenLimit: 0, compactThreshold: 0.4, maxTokens: 4000, temperature: 0.7 }
  }) },
}))
vi.mock('./agents', () => ({ useAgents: () => ({}) }))
vi.mock('./memory', async (orig) => ({ ...(await orig()), memoryBlock: () => '' }))
vi.mock('./router', () => ({ routeAgent: () => undefined }))
vi.mock('./chat', () => ({ useChatStore: { getState: () => ({ sessions: [], cid: null }) } }))

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).window = { __huangquan_agent: undefined, __lastSp: undefined } as never
})

import { buildContextualMessages } from './context'
import type { Message } from '../global'
import type { GeneralSettings } from '../types'

const gSnap = { mode: 'work' } as GeneralSettings

function tcMsg(id: string): Message {
  return { id, role: 'assistant', content: null, timestamp: Date.now(), tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'exec_command', arguments: '{}' } }] }
}

describe('context 插话序列修复(_inject 重排)', () => {
  it('_inject 插话在 assistant(tool_calls) 与 tool 之间时, 输出重排到末尾(序列合法)', () => {
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: '执行任务', timestamp: 1 },
      tcMsg('a1'),
      { id: 't1', role: 'tool', content: 'ok', timestamp: 2, tool_call_id: 'tc1' },
      tcMsg('a2'),
      // 插话插在 assistant(tool_calls) 与 tool 结果之间(UI 上屏顺序)
      { id: 'i1', role: 'user', content: '插话补充', timestamp: 3, _inject: true },
      { id: 't2', role: 'tool', content: 'done', timestamp: 4, tool_call_id: 'tc1' },
    ]
    const d = buildContextualMessages(msgs, false, { gSnap, cl: 8000, spIshiki: 'x', spFallback: 'x', onAgentRoute: () => {} })
    const body = d.filter(m => m.role !== 'system')
    // 每对 assistant(tool_calls) 后必须紧跟 tool
    for (let i = 0; i < body.length - 1; i++) {
      const cur = body[i]
      if (cur.role === 'assistant' && cur.tool_calls) {
        expect(body[i + 1].role).toBe('tool')
      }
    }
    // 插话在末尾(最后一条 user 是插话)
    expect(body[body.length - 1].role).toBe('user')
    expect(body[body.length - 1].content).toBe('插话补充')
  })

  it('无插话时序列不变', () => {
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: 2 },
    ]
    const d = buildContextualMessages(msgs, false, { gSnap, cl: 8000, spIshiki: 'x', spFallback: 'x', onAgentRoute: () => {} })
    const body = d.filter(m => m.role !== 'system')
    expect(body.length).toBe(2)
    expect(body[1].content).toBe('hello')
  })

  it('插话在末尾时保持原位(仍合法)', () => {
    const msgs: Message[] = [
      { id: 'u1', role: 'user', content: '任务', timestamp: 1 },
      tcMsg('a1'),
      { id: 't1', role: 'tool', content: 'ok', timestamp: 2, tool_call_id: 'tc1' },
      { id: 'i1', role: 'user', content: '末尾插话', timestamp: 3, _inject: true },
    ]
    const d = buildContextualMessages(msgs, false, { gSnap, cl: 8000, spIshiki: 'x', spFallback: 'x', onAgentRoute: () => {} })
    const body = d.filter(m => m.role !== 'system')
    expect(body[body.length - 1].content).toBe('末尾插话')
    for (let i = 0; i < body.length - 1; i++) {
      if (body[i].role === 'assistant' && body[i].tool_calls) expect(body[i + 1].role).toBe('tool')
    }
  })
})
