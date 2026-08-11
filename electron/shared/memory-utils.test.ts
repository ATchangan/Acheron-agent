import { describe, expect, it } from 'vitest'
import { normalizeMemory, MEMORY_CAPS } from './memory-utils'

describe('normalizeMemory 记忆容量封顶(自省整改 #2)', () => {
  it('摘要超限保留最新 N 条', () => {
    const mem = { summaries: Array.from({ length: 230 }, (_, i) => ({ content: 's' + i, timestamp: i })) }
    normalizeMemory(mem)
    expect(mem.summaries.length).toBe(MEMORY_CAPS.summaries)
    expect(mem.summaries[0].content).toBe('s30')
  })

  it('事实/置顶/教训分别封顶, 教训保留最新', () => {
    const mem = {
      facts: Array.from({ length: 510 }, (_, i) => 'f' + i),
      pinnedFacts: Array.from({ length: 12 }, (_, i) => 'p' + i),
      lessons: Array.from({ length: 60 }, (_, i) => ({ content: 'l' + i, ts: i })),
    }
    normalizeMemory(mem)
    expect(mem.facts.length).toBe(500)
    expect(mem.facts[0]).toBe('f10')
    expect(mem.pinnedFacts.length).toBe(10)
    expect(mem.lessons.length).toBe(50)
    expect(mem.lessons[0].content).toBe('l0')
  })

  it('未超限原样保留, 非对象安全返回', () => {
    const mem = { summaries: [{ content: 'a' }], facts: ['b'] }
    normalizeMemory(mem)
    expect(mem.summaries.length).toBe(1)
    expect(normalizeMemory(null)).toBeNull()
  })
})
