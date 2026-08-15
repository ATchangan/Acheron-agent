// src/store/display.test.ts — 界面显示配置解析回归
import { describe, expect, it } from 'vitest'
import { resolveDisplay, CUSTOM_CSS_MAX, compileStatusLine } from './display'

describe('resolveDisplay', () => {
  it('未配置时全部显示, 密度默认 comfortable', () => {
    const d = resolveDisplay(undefined)
    expect(d.hiddenNav).toEqual([])
    expect(d.hideToolCalls).toBe(false)
    expect(d.density).toBe('comfortable')
    expect(d.customCss).toBe('')
  })

  it('按配置解析开关/密度/自定义 CSS', () => {
    const d = resolveDisplay({ hiddenNav: ['agents', 'browser'], hideSessionSearch: true, hideToolCalls: true, density: 'compact', customCss: '.x{color:red}' })
    expect(d.hiddenNav).toEqual(['agents', 'browser'])
    expect(d.hideSessionSearch).toBe(true)
    expect(d.hideToolCalls).toBe(true)
    expect(d.density).toBe('compact')
    expect(d.customCss).toBe('.x{color:red}')
  })

  it('自定义 CSS 超长截断, 非法密度回落默认', () => {
    const d = resolveDisplay({ customCss: 'a'.repeat(CUSTOM_CSS_MAX + 10), density: 'huge' as never })
    expect(d.customCss.length).toBe(CUSTOM_CSS_MAX)
    expect(d.density).toBe('comfortable')
  })

  it('statusLine 模板解析且超长截断', () => {
    expect(resolveDisplay({ statusLine: 'a'.repeat(600) }).statusLine.length).toBe(500)
    expect(compileStatusLine('${model} | ${context} | ${agents}', { model: 'gpt-5', context: '32K/200K', agents: '主控' })).toBe('gpt-5 | 32K/200K | 主控')
    expect(compileStatusLine('${model} | ${missing} | ${context}', { model: 'gpt-5' })).toBe('gpt-5')
    expect(compileStatusLine('${model} | ${context} | ${agents}', { model: 'm', context: 'c' })).toBe('m | c')
    expect(compileStatusLine('${nope}', {})).toBe('')
  })
})
