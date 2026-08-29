// electron/cron.test.ts — 定时任务调度纯函数单测
import { describe, it, expect } from 'vitest'
import { cronMatches } from './cron'

describe('cronMatches(5 段表达式)', () => {
  const d = (expr: string, spec: string) => cronMatches(expr, new Date(spec))

  it('固定分钟命中', () => {
    expect(d('30 9 * * *', '2026-08-29T09:30:00')).toBe(true)
    expect(d('30 9 * * *', '2026-08-29T09:31:00')).toBe(false)
  })
  it('步长 */n', () => {
    expect(d('*/15 * * * *', '2026-08-29T10:45:00')).toBe(true)
    expect(d('*/15 * * * *', '2026-08-29T10:50:00')).toBe(false)
  })
  it('列表与区间', () => {
    expect(d('0 8-10 * * 1,3,5', '2026-08-31T09:00:00')).toBe(true) // 周一
    expect(d('0 8-10 * * 1,3,5', '2026-08-29T09:00:00')).toBe(false) // 周六
  })
  it('日/月 字段', () => {
    expect(d('0 0 1 1 *', '2026-01-01T00:00:00')).toBe(true)
    expect(d('0 0 1 1 *', '2026-02-01T00:00:00')).toBe(false)
  })
  it('周日 0/7 等价', () => {
    expect(d('0 12 * * 0', '2026-08-30T12:00:00')).toBe(true) // 周日 getDay=0
    expect(d('0 12 * * 7', '2026-08-30T12:00:00')).toBe(true)
  })
  it('快捷式 @daily/@hourly', () => {
    expect(d('@daily', '2026-08-29T00:00:00')).toBe(true)
    expect(d('@hourly', '2026-08-29T05:00:00')).toBe(true)
    expect(d('@daily', '2026-08-29T00:01:00')).toBe(false)
  })
  it('非法表达式恒不命中(不抛错)', () => {
    expect(d('not a cron', '2026-08-29T09:30:00')).toBe(false)
    expect(d('* * *', '2026-08-29T09:30:00')).toBe(false)
    expect(d('99 * * * *', '2026-08-29T09:30:00')).toBe(false)
  })
})
