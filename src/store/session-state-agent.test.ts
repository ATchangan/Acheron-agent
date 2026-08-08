import { describe, it, expect } from 'vitest'
import { getSessionAgent, setSessionAgent } from './session-state'
import type { SessionData } from '../global'

const baseSession: SessionData = {
  id: 's1', title: 'Chat', messages: [], mode: 'work',
}

describe('session-state 会话级角色身份', () => {
  it('getSessionAgent 未设置时返回 undefined', () => {
    expect(getSessionAgent(baseSession)).toBeUndefined()
  })

  it('setSessionAgent 写入角色字段', () => {
    const s = setSessionAgent(baseSession, '螺丝咕姆')
    expect(s.agent).toBe('螺丝咕姆')
    expect(s.agentManual).toBeFalsy()
    // 原对象不可变(返回新对象)
    expect(baseSession.agent).toBeUndefined()
  })

  it('setSessionAgent 支持 manual 标记且保留原 manual', () => {
    const s1 = setSessionAgent(baseSession, '银狼', true)
    expect(s1.agentManual).toBe(true)
    const s2 = setSessionAgent(s1, '姬子')
    expect(s2.agent).toBe('姬子')
    expect(s2.agentManual).toBe(true) // 未传时保留原值
  })

  it('getSessionAgent 读取写入值', () => {
    const s = setSessionAgent(baseSession, '黑天鹅')
    expect(getSessionAgent(s)).toBe('黑天鹅')
  })
})
