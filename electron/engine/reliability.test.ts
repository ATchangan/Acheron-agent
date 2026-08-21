import { describe, expect, it, vi } from 'vitest'
import { backoffDelay } from './reliability'

describe('engine reliability', () => {
  it('backoffDelay 指数增长、封顶且带抖动上限', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(backoffDelay(0, 500, 8000)).toBe(500)
    expect(backoffDelay(1, 500, 8000)).toBe(1000)
    expect(backoffDelay(20, 500, 8000)).toBeLessThanOrEqual(8000)
    vi.restoreAllMocks()
  })
})
