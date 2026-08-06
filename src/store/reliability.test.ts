import { describe, expect, it, vi } from 'vitest'
import { backoffDelay, budgetExceeded, retryDelay, taskTokensUsed } from './reliability'

describe('reliability', () => {
  it('backoffDelay 指数增长且不超上限', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(backoffDelay(0, 500, 8000)).toBe(500)
    expect(backoffDelay(1, 500, 8000)).toBe(1000)
    expect(backoffDelay(2, 500, 8000)).toBe(2000)
    // 指数封顶: 不超 maxMs
    expect(backoffDelay(20, 500, 8000)).toBeLessThanOrEqual(8000)
    vi.restoreAllMocks()
  })

  it('retryDelay 在 base 与 max 之间', () => {
    for (let i = 0; i < 50; i++) {
      const d = retryDelay(i, 800, 10000)
      expect(d).toBeGreaterThanOrEqual(600)
      expect(d).toBeLessThanOrEqual(10000)
    }
  })

  it('taskTokensUsed 只计增量, 负数归零', () => {
    const now = { m1: { inputTokens: 100, outputTokens: 20, writeTokens: 5 } }
    const base = { m1: { inputTokens: 60, outputTokens: 10, writeTokens: 5 } }
    expect(taskTokensUsed(now, base)).toBe(50)
    expect(taskTokensUsed(undefined, base)).toBe(0)
    expect(taskTokensUsed(now, undefined)).toBe(125)
    const lower = { m1: { inputTokens: 10, outputTokens: 1, writeTokens: 0 } }
    expect(taskTokensUsed(lower, base)).toBe(0)
  })

  it('budgetExceeded 只在设置了正限额时生效', () => {
    expect(budgetExceeded(5000, 0)).toBe(false)
    expect(budgetExceeded(4999, 5000)).toBe(false)
    expect(budgetExceeded(5000, 5000)).toBe(true)
    expect(budgetExceeded(99999, -1)).toBe(false)
  })
})
