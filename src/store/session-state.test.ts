import { describe, it, expect } from 'vitest'
import { nextTaskGenFor, getTaskGenFor, invalidateSid } from './session-state'

describe('session-state 会话级任务代号', () => {
  const sid = 'sess_test_1'

  it('nextTaskGenFor 首次调用返回 1 且递增', () => {
    const m: Record<string, number> = {}
    expect(nextTaskGenFor(m, sid)).toBe(1)
    expect(nextTaskGenFor(m, sid)).toBe(2)
    expect(nextTaskGenFor(m, sid)).toBe(3)
  })

  it('不同会话代号互相独立', () => {
    const m: Record<string, number> = {}
    nextTaskGenFor(m, 'sess_a')
    nextTaskGenFor(m, 'sess_a')
    expect(nextTaskGenFor(m, 'sess_b')).toBe(1)
    expect(nextTaskGenFor(m, 'sess_a')).toBe(3)
  })

  it('invalidateSid 使代号递增(旧任务失效)', () => {
    const m: Record<string, number> = {}
    nextTaskGenFor(m, sid) // = 1
    const before = getTaskGenFor(m, sid)
    invalidateSid(m, sid)  // = 2
    expect(getTaskGenFor(m, sid)).toBeGreaterThan(before)
    expect(nextTaskGenFor(m, sid)).toBe(3) // 新任务持有新代号
  })

  it('invalidateSid 只影响指定会话', () => {
    const m: Record<string, number> = {}
    nextTaskGenFor(m, 'sess_a') // = 1
    nextTaskGenFor(m, 'sess_b') // = 1
    invalidateSid(m, 'sess_a')  // = 2
    expect(getTaskGenFor(m, 'sess_b')).toBe(1)
    expect(getTaskGenFor(m, 'sess_a')).toBe(2)
    // sess_b 不受影响, 继续递增
    expect(nextTaskGenFor(m, 'sess_b')).toBe(2)
  })
})
