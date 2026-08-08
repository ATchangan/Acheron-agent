import { describe, it, expect, beforeEach } from 'vitest'
import { recordRequest, recordTokens, recordEntry, getAll, resetAll, resetOne } from './model-cache-stats'

describe('model-cache-stats 命中率观测口径(HanaAgent 同口径)', () => {
  beforeEach(() => { resetAll() })

  it('支持缓存的请求计入观测分母, 命中请求计入分子', () => {
    recordRequest('s1', 'deepseek', true, true)
    recordRequest('s1', 'deepseek', false, true)
    const m = getAll().models['deepseek']
    expect(m.requests).toBe(2)
    expect(m.observedReqs).toBe(2)
    expect(m.hitReqs).toBe(1)
  })

  it('不支持的请求只计入总请求, 不进命中率观测分母', () => {
    recordRequest('s1', 'perplexity', false, false)
    recordRequest('s1', 'perplexity', true, false)
    const m = getAll().models['perplexity']
    expect(m.requests).toBe(2)
    expect(m.observedReqs).toBe(0)
    expect(m.hitReqs).toBe(0)
  })

  it('未传支持标志时保持旧行为(按可观测处理)', () => {
    recordRequest('s1', 'legacy', true)
    const m = getAll().models['legacy']
    expect(m.requests).toBe(1)
    expect(m.observedReqs).toBe(1)
    expect(m.hitReqs).toBe(1)
  })

  it('recordTokens 记录缓存能力与供应商名', () => {
    recordTokens('s1', 'deepseek', 1664, 5664, 0, 4000, { supported: true, provider: 'DeepSeek' })
    const m = getAll().models['deepseek']
    expect(m.cacheSupported).toBe(true)
    expect(m.providerName).toBe('DeepSeek')
    expect(m.readTokens).toBe(1664)
    expect(m.missTokens).toBe(4000)
    expect(m.inputTokens).toBe(5664)
  })

  it('recordEntry 写入逐请求明细, 新请求在前', () => {
    recordEntry({ sid: 's1', model: 'deepseek', provider: 'DeepSeek', readTokens: 100, missTokens: 200, writeTokens: 0, inputTokens: 300, hit: true, supported: true, ts: 1000 })
    recordEntry({ sid: 's1', model: 'deepseek', provider: 'DeepSeek', readTokens: 50, missTokens: 250, writeTokens: 0, inputTokens: 300, hit: true, supported: true, ts: 2000 })
    const ledger = getAll().ledger
    expect(ledger).toHaveLength(2)
    expect(ledger[0].ts).toBe(2000)
    expect(ledger[0].model).toBe('deepseek')
    expect(ledger[1].readTokens).toBe(100)
  })

  it('resetOne 清除该模型的聚合与明细', () => {
    recordTokens('s1', 'deepseek', 100, 300, 0, 200, { supported: true, provider: 'DeepSeek' })
    recordEntry({ sid: 's1', model: 'deepseek', provider: 'DeepSeek', readTokens: 100, missTokens: 200, writeTokens: 0, inputTokens: 300, hit: true, supported: true, ts: 1000 })
    expect(getAll().ledger).toHaveLength(1)
    expect(resetOne('deepseek')).toBe(true)
    expect(getAll().models['deepseek']).toBeUndefined()
    expect(getAll().ledger).toHaveLength(0)
  })

  it('resetAll 清除聚合与明细', () => {
    recordEntry({ sid: 's1', model: 'deepseek', provider: 'DeepSeek', readTokens: 100, missTokens: 200, writeTokens: 0, inputTokens: 300, hit: true, supported: true, ts: 1000 })
    resetAll()
    expect(getAll().models).toEqual({})
    expect(getAll().ledger).toEqual([])
  })
})
