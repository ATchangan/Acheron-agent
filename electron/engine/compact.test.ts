import { describe, expect, it } from 'vitest'
import { applyCompact, buildCompactPrompt, pickCompactCandidates } from './compact'
import type { EngineMessage } from './types'

function round(u: string, a: string, tool = false): EngineMessage[] {
  const out: EngineMessage[] = [{ id: u, role: 'user', content: 'Q' + u, timestamp: 1 }]
  if (tool) {
    out.push({ id: a + 'a', role: 'assistant', content: null, timestamp: 2, tool_calls: [{ id: a + 'c', type: 'function', function: { name: 'read', arguments: '{}' } }] })
    out.push({ id: a + 't', role: 'tool', content: 'R' + a, timestamp: 3, tool_call_id: a + 'c' })
  } else {
    out.push({ id: a, role: 'assistant', content: 'A' + a, timestamp: 2 })
  }
  return out
}

describe('compact 摘要压缩纯函数', () => {
  it('pickCompactCandidates 保留最近 N 轮, 且保留段以 user 开头', () => {
    const msgs = [...round('u1', 'a1', true), ...round('u2', 'a2'), ...round('u3', 'a3', true), ...round('u4', 'a4')]
    const cands = pickCompactCandidates(msgs, 2)
    expect(cands.length).toBeGreaterThan(0)
    expect(cands[0].role).toBe('user')
    expect(cands[cands.length - 1].role).not.toBe('user') // 候选是完整轮次
    const keepStart = msgs.indexOf(msgs[cands.length])
    expect(keepStart).toBeGreaterThan(0)
  })

  it('候选不足时返回空', () => {
    const msgs = round('u1', 'a1')
    expect(pickCompactCandidates(msgs, 6)).toEqual([])
  })

  it('applyCompact 生成摘要头并保留最近轮次', () => {
    const msgs = [...round('u1', 'a1'), ...round('u2', 'a2'), ...round('u3', 'a3')]
    const out = applyCompact(msgs, '要点摘要', 2)
    expect(out[0].role).toBe('assistant')
    expect(String(out[0].content)).toContain('[历史摘要]')
    expect(String(out[0].content)).toContain('要点摘要')
    expect(out.slice(1).length).toBe(msgs.length - 2)
    expect(out[1].id).toBe('u2')
  })

  it('buildCompactPrompt 包含用户/助手/工具信息且不超长', () => {
    const msgs = [...round('u1', 'a1', true), ...round('u2', 'a2')]
    const { system, user } = buildCompactPrompt(msgs)
    expect(system).toContain('摘要')
    expect(user).toContain('用户')
    expect(user).toContain('工具结果')
    expect(user.length).toBeLessThanOrEqual(20000)
  })
})
