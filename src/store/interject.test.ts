import { describe, it, expect, beforeEach } from 'vitest'
import { pushInterject, hasInterjectForSid, drainInterjections, peekInterjectKind, clearInterjectForSid, getInterjectDropCount, MAX_INTERJECT_PER_SID, detectInterjectKind } from './interject'

describe('interject 队列有界+合并+类型(M1)', () => {
  beforeEach(() => { clearInterjectForSid('s1'); clearInterjectForSid('s2') })

  it('M1-1: 同 kind 连续 supplement 合并为 1 条(\\n 连接)', () => {
    pushInterject('s1', '补充1')
    pushInterject('s1', '补充2')
    pushInterject('s1', '补充3')
    expect(hasInterjectForSid('s1')).toBe(true)
    // 合并后只有 1 条, 内容以 \n 连接
    const t = drainInterjections('s1')
    expect(t).toContain('补充1')
    expect(t).toContain('补充2')
    expect(t).toContain('补充3')
    expect(drainInterjections('s1')).toBeNull()
  })

  it('M1-3: retarget 不与 supplement 合并(独立成项)', () => {
    pushInterject('s1', '补充一点')
    pushInterject('s1', '别做了', 'retarget')
    pushInterject('s1', '再加一条')
    expect(peekInterjectKind('s1')).toBe('supplement')
    drainInterjections('s1')
    expect(peekInterjectKind('s1')).toBe('retarget')
    drainInterjections('s1')
    expect(peekInterjectKind('s1')).toBe('supplement')
  })

  it('M1-2: 队列有界(超 MAX 丢弃并统计)', () => {
    // 每 2 条非连续 supplement 才能独立(交替 kind 避免合并)
    for (let i = 0; i < MAX_INTERJECT_PER_SID + 10; i++) {
      pushInterject('s1', 'a' + i, i % 2 === 0 ? 'supplement' : 'retarget')
    }
    const cnt = getInterjectDropCount()
    expect(cnt).toBeGreaterThanOrEqual(10)
    // 队列内最多 MAX 条
    let n = 0
    while (hasInterjectForSid('s1')) { drainInterjections('s1'); n++ }
    expect(n).toBeLessThanOrEqual(MAX_INTERJECT_PER_SID)
  })

  it('detectInterjectKind 改向关键词识别', () => {
    expect(detectInterjectKind('别做了')).toBe('retarget')
    expect(detectInterjectKind('重新来')).toBe('retarget')
    expect(detectInterjectKind('换一个方案')).toBe('retarget')
    expect(detectInterjectKind('不要继续了')).toBe('retarget')
    expect(detectInterjectKind('加上文件大小')).toBe('supplement')
  })
})
