import { describe, it, expect } from 'vitest'
import { pickModels, resolveModel } from './model-pick'
import type { ProviderConfig, SettingsData } from '../global'
import type { GeneralSettings } from '../types'

const prov: ProviderConfig = {
  id: 'dp', name: 'DeepSeek', type: 'OpenAI Compatible', apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com',
  models: ['deepseek-chat', 'deepseek-reasoner'], selectedModel: 'deepseek-chat',
}
const cfg: SettingsData = {
  providers: [prov],
  general: {} as GeneralSettings,
}

const g = (patch: Record<string, unknown> = {}): GeneralSettings => ({ mode: 'work', theme: 'dark', ...patch } as GeneralSettings)

describe('model-pick 模型选择', () => {
  it('默认选主模型(selectedModel 优先)', () => {
    const mc = pickModels(g(), cfg, prov, '你好')
    expect(mc.chosen.model).toBe('deepseek-chat')
    expect(mc.isSimple).toBe(true)
  })

  it('复杂任务(含重词)不用快速模型', () => {
    const mc = pickModels(g(), cfg, prov, '请帮我分析这个代码文件并修改')
    expect(mc.isSimple).toBe(false)
    // 无 large 配置时回退主模型
    expect(mc.chosen.model).toBe('deepseek-chat')
  })

  it('简单任务且配置 fastModel 时用快速模型', () => {
    const g2 = g({ fastModel: 'dp::deepseek-reasoner', autoFastModel: true })
    const mc = pickModels(g2, cfg, prov, '1+1')
    expect(mc.isSimple).toBe(true)
    expect(mc.fast.model).toBe('deepseek-reasoner')
    expect(mc.chosen.model).toBe('deepseek-reasoner')
  })

  it('调度绑定: 复杂任务用 largeModel, 简单任务用 smallModel', () => {
    const g2 = g({ smallModel: 'dp::deepseek-chat', largeModel: 'dp::deepseek-reasoner' })
    const simple = pickModels(g2, cfg, prov, '你好')
    expect(simple.chosen.model).toBe('deepseek-chat')
    const complex = pickModels(g2, cfg, prov, '帮我写一个复杂的代码项目')
    expect(complex.chosen.model).toBe('deepseek-reasoner')
  })

  it('autoFastModel 关闭时即使简单任务也走主模型', () => {
    const g2 = g({ autoFastModel: false, fastModel: 'dp::deepseek-reasoner' })
    const mc = pickModels(g2, cfg, prov, '你好')
    expect(mc.isSimple).toBe(false)
  })

  it('resolveModel 支持 providerId::model 与裸模型名', () => {
    const r1 = resolveModel(g({ mainModel: 'dp::deepseek-reasoner' }), cfg, prov, 'mainModel')
    expect(r1?.model).toBe('deepseek-reasoner')
    const r2 = resolveModel(g({ codeModel: 'deepseek-chat' }), cfg, prov, 'codeModel')
    expect(r2?.model).toBe('deepseek-chat')
    // 不存在的模型返回 null
    expect(resolveModel(g({ mainModel: 'dp::nonexistent' }), cfg, prov, 'mainModel')).toBeNull()
  })
})
