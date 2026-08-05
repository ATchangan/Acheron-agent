import { describe, it, expect } from 'vitest'
import { tsLabel, progressPct } from './plan-utils'

describe('plan-utils 工具函数', () => {
  it('tsLabel 格式化时间戳', () => {
    // 2024-01-02 03:04 本地时间
    const ts = new Date(2024, 0, 2, 3, 4).getTime()
    expect(tsLabel(ts)).toBe('01/02 03:04')
    expect(tsLabel(0)).toBe('')
  })

  it('progressPct 计算进度百分比', () => {
    const steps = [
      { status: 'completed' as const },
      { status: 'completed' as const },
      { status: 'pending' as const },
      { status: 'in_progress' as const },
    ]
    expect(progressPct(steps as never[] as never)).toBe(50)
    expect(progressPct([] as never)).toBe(0)
  })
})
