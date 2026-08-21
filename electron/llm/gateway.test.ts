// electron/llm/gateway.test.ts — 模型网关路由单测(v0.4.0 M5)
import { describe, it, expect } from 'vitest'
import { detectTaskType, routeProfile, buildFallbackChain } from './gateway'
import type { EngineProvider, EngineSettings } from '../engine/types'

function provider(id: string, models: string[], selected?: string, key = 'k'): EngineProvider {
  return { id, name: id, type: 'OpenAI Compatible', apiKey: key, baseUrl: 'https://example.com', models, selectedModel: selected }
}

describe('detectTaskType 任务类型检测', () => {
  it('图片→vision, 长文本→long, 代码特征→code, 其余 text', () => {
    expect(detectTaskType('看看这张图', ['data:image/png;base64,xx'])).toBe('vision')
    expect(detectTaskType('x'.repeat(3000), undefined)).toBe('long')
    expect(detectTaskType('帮我重构这段 TypeScript 代码', undefined)).toBe('code')
    expect(detectTaskType('今天天气怎么样', undefined)).toBe('text')
  })

  it('代码块/行首命令/源码路径识别为 code, URL 与裸文件名不误判', () => {
    expect(detectTaskType('这里出错了:\n```ts\nconst a = 1\n```', undefined)).toBe('code')
    expect(detectTaskType('\nnpm install\n', undefined)).toBe('code')
    expect(detectTaskType('问题在 D:\\work\\src\\main.ts 第 3 行', undefined)).toBe('code')
    expect(detectTaskType('请执行 npm install 后重试', undefined)).toBe('text')
    expect(detectTaskType('看这个页面 https://example.com/index.html', undefined)).toBe('text')
    expect(detectTaskType('文件名叫 app.ts', undefined)).toBe('text')
  })
})

describe('routeProfile 统一路由', () => {
  const g = { codeModel: 'code-x', longTextModel: 'long-x', mainModel: 'main-x' } as unknown as EngineSettings
  const p = provider('a', ['chat-x', 'code-x', 'long-x', 'vision-x'])

  it('任务类型优先级: code→codeModel', () => {
    const r = routeProfile(g, [p], p, { taskType: 'code' })
    expect(r.model).toBe('code-x')
  })

  it('长任务→longTextModel', () => {
    const r = routeProfile(g, [p], p, { taskType: 'long' })
    expect(r.model).toBe('long-x')
  })

  it('视觉→vision 候选队列', () => {
    const g2 = { visionModel: 'vision-x' } as unknown as EngineSettings
    const r = routeProfile(g2, [p], p, { taskType: 'vision' })
    expect(r.model).toBe('vision-x')
  })

  it('角色模型覆盖优先', () => {
    const agents = { 设计: { model: 'chat-x' } } as never
    const r = routeProfile(g, [p], p, { agent: '设计', taskType: 'code', agents })
    expect(r.model).toBe('chat-x')
  })
})

describe('buildFallbackChain 降级链', () => {
  it('当前 → 同供应商 → 跨供应商, 去重封顶 4', () => {
    const p1 = provider('a', ['m1', 'm2'], 'm1')
    const p2 = provider('b', ['m3'], 'm3')
    const chain = buildFallbackChain({} as EngineSettings, [p1, p2], { p: p1, model: 'm1' })
    expect(chain.map(c => c.model)).toEqual(['m1', 'm2', 'm3'])
  })
})
