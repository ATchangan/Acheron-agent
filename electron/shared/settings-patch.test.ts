// electron/shared/settings-patch.test.ts — 聊天改设置白名单与脱敏回归
import { describe, expect, it } from 'vitest'
import { sanitizeGeneralPatch, sanitizeProvidersPatch, redactSettings } from './settings-patch'

describe('sanitizeGeneralPatch', () => {
  it('合法字段通过并保留类型', () => {
    const r = sanitizeGeneralPatch({ theme: 'dark', animation: false, uiFontSize: 15, toolPerms: { exec_command: 'ask' }, perf: { outputCap: false }, uiDisplay: { hidePlanCards: true } })
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({ theme: 'dark', animation: false, uiFontSize: 15, toolPerms: { exec_command: 'ask' }, perf: { outputCap: false }, uiDisplay: { hidePlanCards: true } })
  })

  it('类型错误与未知字段报错且不通过', () => {
    expect(sanitizeGeneralPatch({ animation: 'yes' }).ok).toBe(false)
    expect(sanitizeGeneralPatch({ unknownField: 1 }).ok).toBe(false)
    expect(sanitizeGeneralPatch({ toolPerms: { exec_command: 'maybe' } }).ok).toBe(false)
  })

  it('密钥/风险/命令相关字段被明确拒绝', () => {
    const r = sanitizeGeneralPatch({ riskConfirm: false, mcpServers: [], pluginStates: {}, filePermission: 'full' })
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toContain('不允许')
  })

  it('超长文本字段截断', () => {
    const r = sanitizeGeneralPatch({ customSystemPrompt: 'x'.repeat(25000) })
    expect(r.ok).toBe(true)
    expect(String(r.value.customSystemPrompt).length).toBe(20000)
  })

  it('pluginSettings 仅接受字符串/数字/布尔', () => {
    expect(sanitizeGeneralPatch({ pluginSettings: { p: { mode: 'fast', n: 1, on: true } } }).ok).toBe(true)
    expect(sanitizeGeneralPatch({ pluginSettings: { p: { bad: { x: 1 } } } }).ok).toBe(false)
  })
})

describe('sanitizeProvidersPatch', () => {
  it('非密钥字段可改, 密钥字段拒绝', () => {
    const ok = sanitizeProvidersPatch([{ id: 'p1', name: '新名', baseUrl: 'https://x', apiKey: 'sk-secret' }], 'providers')
    expect(ok.ok).toBe(false)
    expect(ok.problems.join(' ')).toContain('apiKey')
    const ok2 = sanitizeProvidersPatch([{ id: 'p1', name: '新名', selectedModel: 'm1' }], 'providers')
    expect(ok2.ok).toBe(true)
  })

  it('必须为数组且每项含 id', () => {
    expect(sanitizeProvidersPatch({}, 'providers').ok).toBe(false)
    expect(sanitizeProvidersPatch([{ name: 'x' }], 'providers').ok).toBe(false)
  })

  it('数组/字符串字段类型校验', () => {
    expect(sanitizeProvidersPatch([{ id: 'p1', models: [1, 2] }], 'providers').ok).toBe(false)
    expect(sanitizeProvidersPatch([{ id: 'p1', selectedModel: 3 }], 'providers').ok).toBe(false)
    expect(sanitizeProvidersPatch([{ id: 'p1', models: ['a', 'b'] }], 'providers').ok).toBe(true)
  })
})

describe('redactSettings', () => {
  it('脱敏密钥并剔除超大字段', () => {
    const out = redactSettings({ providers: [{ apiKey: 'sk-abc', customHeaders: 'Auth: x', baseUrl: 'https://x' }], general: { embeddingApiKey: 'ek', bgImage: 'data:image/png;base64,xxx', theme: 'dark' } })
    expect(out).toEqual({ providers: [{ apiKey: '***', customHeaders: '***', baseUrl: 'https://x' }], general: { embeddingApiKey: '***', theme: 'dark' } })
  })

  it('插件设置中的敏感键脱敏', () => {
    const out = redactSettings({ general: { pluginSettings: { p: { apiKey: 'abc', mode: 'fast' } } } })
    expect(out).toEqual({ general: { pluginSettings: { p: { apiKey: '***', mode: 'fast' } } } })
  })
})
