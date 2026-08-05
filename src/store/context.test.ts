import { describe, it, expect } from 'vitest'
import { isVisionModel, estimateTokens } from './context'

describe('context 视觉模型识别', () => {
  it('识别视觉模型', () => {
    expect(isVisionModel('gpt-4o')).toBe(true)
    expect(isVisionModel('qwen-vl-max')).toBe(true)
    expect(isVisionModel('deepseek-chat')).toBe(false)
    expect(isVisionModel('claude-3-5-sonnet')).toBe(true)
    expect(isVisionModel('deepseek-v4-flash')).toBe(false)
  })
})

describe('context Token 估算', () => {
  it('中文按字符估算', () => {
    const n = estimateTokens('你好世界')
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(10)
  })

  it('英文按词估算', () => {
    const n = estimateTokens('hello world test message')
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(10)
  })

  it('空串为 0', () => {
    expect(estimateTokens('')).toBe(0)
  })
})
