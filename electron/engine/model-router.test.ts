import { describe, expect, it } from 'vitest'
import { pickInitialModel, resolveModel, resolveThinkLevel, visionCandidates } from './model-router'
import type { EngineProvider, EngineSettings } from './types'

const prov = (id: string, models: string[]): EngineProvider => ({ id, name: id, type: 'OpenAI Compatible', apiKey: 'k', baseUrl: 'http://x', models })
const providers = [prov('p1', ['fast-m', 'small-m', 'main-m', 'large-m']), prov('p2', ['vision-m'])]
const g = (over: Partial<EngineSettings> = {}): EngineSettings => ({ ...over })

describe('pickInitialModel', () => {
  it('复杂任务(含工具词)选大模型', () => {
    const pick = pickInitialModel(g({ mainModel: 'p1::main-m', largeModel: 'p1::large-m', smallModel: 'p1::small-m' }), providers, providers[0], '帮我写一个 Python 脚本读取文件')
    expect(pick.model).toBe('large-m')
  })

  it('简单任务选小模型', () => {
    const pick = pickInitialModel(g({ mainModel: 'p1::main-m', largeModel: 'p1::large-m', smallModel: 'p1::small-m' }), providers, providers[0], '你好')
    expect(pick.model).toBe('small-m')
  })

  it('autoFastModel=false 时简单任务也走大模型', () => {
    const pick = pickInitialModel(g({ autoFastModel: false, mainModel: 'p1::main-m', largeModel: 'p1::large-m', smallModel: 'p1::small-m' }), providers, providers[0], '你好')
    expect(pick.model).toBe('large-m')
  })

  it('未配置路由时回退当前供应商默认模型', () => {
    const pick = pickInitialModel(g({}), providers, providers[0], '你好')
    expect(pick.model).toBe('fast-m')
  })
})

describe('resolveModel', () => {
  it('provider::model 格式解析', () => {
    const r = resolveModel(g({ mainModel: 'p2::vision-m' }), providers, providers[0], 'mainModel')
    expect(r?.model).toBe('vision-m')
    expect(r?.p.id).toBe('p2')
  })

  it('当前供应商内模型名解析', () => {
    const r = resolveModel(g({ mainModel: 'main-m' }), providers, providers[0], 'mainModel')
    expect(r?.model).toBe('main-m')
  })

  it('未配置返回 null', () => {
    expect(resolveModel(g({}), providers, providers[0], 'mainModel')).toBeNull()
  })
})

describe('resolveThinkLevel', () => {
  it('模型覆盖优先于全局档位', () => {
    expect(resolveThinkLevel(g({ thinkLevel: 'medium', thinkOverrides: { 'x-model': 'deep' } }), 'x-model')).toBe('deep')
    expect(resolveThinkLevel(g({ thinkLevel: 'medium', thinkOverrides: { 'x-model': 'deep' } }), 'other')).toBe('medium')
  })

  it('缺省 medium', () => {
    expect(resolveThinkLevel(g({}))).toBe('medium')
  })
})

describe('visionCandidates', () => {
  it('按配置的 provider::model 返回候选', () => {
    const cands = visionCandidates(g({ visionModels: ['p2::vision-m'] }), providers, providers[0])
    expect(cands[0].model).toBe('vision-m')
  })

  it('无配置时从任一供应商找视觉模型', () => {
    const cands = visionCandidates(g({}), providers, providers[0])
    expect(cands[0]?.model).toBe('vision-m')
    const cands2 = visionCandidates(g({}), providers, providers[1])
    expect(cands2[0]?.model).toBe('vision-m')
  })
})
