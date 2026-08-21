import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { getAgents, setCustomAgentsDir } from './agents'

describe('agents 自定义子代理', () => {
  let dir: string

  beforeEach(() => { dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-agents-')) })
  afterEach(() => {
    setCustomAgentsDir('')
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  })

  it('用户目录 *.json 注册自定义代理, 缺失字段用默认值补齐', () => {
    setCustomAgentsDir(dir)
    fs.writeFileSync(join(dir, 'custom.json'), JSON.stringify({ 小助手: { role: '测试', prompt: '自定义提示', tools: ['read', 'grep'] } }), 'utf-8')
    const a = getAgents()['小助手']
    expect(a).toBeDefined()
    expect(a.role).toBe('测试')
    expect(a.prompt).toBe('自定义提示')
    expect(a.tools).toEqual(['read', 'grep'])
    expect(a.memoryScope).toBe('private')
    expect(a.icon).toBeTruthy()
  })

  it('覆盖内置角色时合并默认字段', () => {
    setCustomAgentsDir(dir)
    fs.writeFileSync(join(dir, 'x.json'), JSON.stringify({ 文档: { role: '覆盖角色', tools: ['read'] } }), 'utf-8')
    const a = getAgents()['文档']
    expect(a.role).toBe('覆盖角色')
    expect(a.tools).toEqual(['read'])
    expect(a.handoff_to.length).toBeGreaterThan(0)
    expect(a.memoryScope).toBe('private')
  })

  it('坏 JSON 文件跳过, 不影响其他自定义代理', () => {
    setCustomAgentsDir(dir)
    fs.writeFileSync(join(dir, 'bad.json'), '{bad json', 'utf-8')
    fs.writeFileSync(join(dir, 'good.json'), JSON.stringify({ X: { role: 'r' } }), 'utf-8')
    expect(getAgents()['X']).toBeDefined()
    expect(getAgents()['bad']).toBeUndefined()
  })
})
