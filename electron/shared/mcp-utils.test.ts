// electron/shared/mcp-utils.test.ts — MCP 工具名压平/反查回归
import { describe, expect, it } from 'vitest'
import { parseMcpToolName, sanitizeMcpPart, resolveMcpToolName } from './mcp-utils'

describe('sanitizeMcpPart', () => {
  it('非字母数字转下划线并折叠连续下划线', () => {
    expect(sanitizeMcpPart('My.Server')).toBe('My_Server')
    expect(sanitizeMcpPart('foo__bar')).toBe('foo_bar')
    expect(sanitizeMcpPart('Do Thing')).toBe('Do_Thing')
  })
})

describe('parseMcpToolName', () => {
  it('按首个 __ 切分 server/tool', () => {
    expect(parseMcpToolName('mcp__srv__tool')).toEqual({ server: 'srv', tool: 'tool' })
    expect(parseMcpToolName('mcp__')).toBeNull()
    expect(parseMcpToolName('plugin_x__y')).toBeNull()
  })
})

describe('resolveMcpToolName', () => {
  const servers = [{ name: 'My.Server', tools: ['Do Thing', 'plain'] }]

  it('含点/空格的名称反查回真实 server/tool', () => {
    expect(resolveMcpToolName('mcp__My_Server__Do_Thing', servers)).toEqual({ server: 'My.Server', tool: 'Do Thing' })
    expect(resolveMcpToolName('mcp__My_Server__plain', servers)).toEqual({ server: 'My.Server', tool: 'plain' })
  })

  it('服务器名含双下划线也能正确反查', () => {
    const s = [{ name: 'foo__bar', tools: ['baz'] }]
    expect(resolveMcpToolName('mcp__foo_bar__baz', s)).toEqual({ server: 'foo__bar', tool: 'baz' })
  })

  it('无匹配返回 null(保持旧格式兼容调用方回退)', () => {
    expect(resolveMcpToolName('mcp__nope__x', servers)).toBeNull()
  })
})
