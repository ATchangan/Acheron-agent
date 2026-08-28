import { describe, expect, it, vi } from 'vitest'
import { backoffDelay, resolveStallMs } from './reliability'

describe('engine reliability', () => {
  it('backoffDelay 指数增长、封顶且带抖动上限', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(backoffDelay(0, 500, 8000)).toBe(500)
    expect(backoffDelay(1, 500, 8000)).toBe(1000)
    expect(backoffDelay(20, 500, 8000)).toBeLessThanOrEqual(8000)
    vi.restoreAllMocks()
  })

  it('resolveStallMs 与子任务看门狗口径一致（下限 90s，默认 120s 超时）', () => {
    // toolTimeout=120s → max(90s, 150s) = 150s
    expect(resolveStallMs(120)).toBe(150000)
    // 未配置/0 按默认 120s 计
    expect(resolveStallMs()).toBe(150000)
    expect(resolveStallMs(0)).toBe(150000)
    // 小超时落在 90s 下限
    expect(resolveStallMs(10)).toBe(90000)
    // 大超时随超时增长
    expect(resolveStallMs(600)).toBe(630000)
  })
})
