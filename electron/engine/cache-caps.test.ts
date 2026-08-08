import { describe, it, expect } from 'vitest'
import { classifyCacheSupport, cacheCapToSupported } from './cache-caps'

describe('classifyCacheSupport 供应商缓存能力判定', () => {
  it('官方返回缓存字段的预设供应商 → supported', () => {
    for (const name of ['DeepSeek', 'OpenAI', '通义千问', '智谱', 'Kimi', 'Claude', 'Gemini', 'SiliconFlow', '豆包(火山方舟)', 'MiniMax', 'OpenRouter', 'Groq', 'Mistral', 'xAI Grok']) {
      expect(classifyCacheSupport({ name, type: 'OpenAI Compatible' }), name).toBe('supported')
    }
    expect(classifyCacheSupport({ name: 'Claude', type: 'Anthropic Claude' })).toBe('supported')
    expect(classifyCacheSupport({ name: 'Gemini', type: 'Google Gemini' })).toBe('supported')
    expect(classifyCacheSupport({ type: 'Azure OpenAI' })).toBe('supported')
  })

  it('官方 chat API 不返回缓存字段 → unsupported', () => {
    for (const name of ['LM Studio', 'Ollama', 'Perplexity', '讯飞星火', 'NVIDIA NIM', '即梦Jimeng']) {
      expect(classifyCacheSupport({ name, type: 'OpenAI Compatible' }), name).toBe('unsupported')
    }
  })

  it('本地 LM Studio/Ollama 即使名字被改也能按 URL 识别为不支持', () => {
    expect(classifyCacheSupport({ name: '本地模型', type: 'OpenAI Compatible', baseUrl: 'http://127.0.0.1:1234/v1' })).toBe('unsupported')
    expect(classifyCacheSupport({ name: '本地模型', type: 'OpenAI Compatible', baseUrl: 'http://localhost:11434/v1' })).toBe('unsupported')
  })

  it('即梦与豆包共用火山 URL, 按名字区分(即梦不支持)', () => {
    expect(classifyCacheSupport({ name: '即梦Jimeng', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' })).toBe('unsupported')
    expect(classifyCacheSupport({ name: '豆包(火山方舟)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' })).toBe('supported')
  })

  it('官方文档未确认的供应商 → unknown, 运行期出现缓存字段后升级为 supported', () => {
    expect(classifyCacheSupport({ name: 'Together', baseUrl: 'https://api.together.xyz/v1' })).toBe('unknown')
    expect(classifyCacheSupport({ name: 'Together', baseUrl: 'https://api.together.xyz/v1' }, true)).toBe('supported')
    expect(classifyCacheSupport({ name: '零一万物' })).toBe('unknown')
  })

  it('未确认在持久化/界面上按不支持处理, 运行期出现缓存字段仍可升级', () => {
    expect(cacheCapToSupported('supported')).toBe(true)
    expect(cacheCapToSupported('unsupported')).toBe(false)
    expect(cacheCapToSupported('unknown')).toBe(false)
  })

  it('自定义 OpenAI Compatible 供应商默认 unknown, 出现缓存字段后视为支持', () => {
    expect(classifyCacheSupport({ name: '我的网关', type: 'OpenAI Compatible', baseUrl: 'https://gw.example.com/v1' })).toBe('unknown')
    expect(classifyCacheSupport({ name: '我的网关', type: 'OpenAI Compatible', baseUrl: 'https://gw.example.com/v1' }, true)).toBe('supported')
  })
})
