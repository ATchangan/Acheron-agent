import { describe, expect, it } from 'vitest'
import { toolDetail, toolExpected, toolLabel } from './tool-labels'
import type { EngineToolCall } from './types'

const tc = (name: string, args: Record<string, unknown> = {}): EngineToolCall => ({ id: 'c1', name, args })

describe('toolLabel', () => {
  it('已知工具返回中文标签', () => {
    expect(toolLabel(tc('read'))).toBe('读取文件')
    expect(toolLabel(tc('exec_command'))).toBe('执行命令')
    expect(toolLabel(tc('apply_patch'))).toBe('结构化编辑')
    expect(toolLabel(tc('update_plan'))).toBe('更新计划')
    expect(toolLabel(tc('terminal_open'))).toBe('打开终端')
  })

  it('未知工具回退工具名', () => {
    expect(toolLabel(tc('custom_xyz'))).toBe('custom_xyz')
  })
})

describe('toolDetail', () => {
  it('优先取常用参数 key', () => {
    expect(toolDetail(tc('read', { path: 'D:/a.txt', offset: 10 }))).toBe('path=D:/a.txt')
  })

  it('无参数返回空串', () => {
    expect(toolDetail(tc('ls'))).toBe('')
  })

  it('长参数截断并压缩空白', () => {
    expect(toolDetail(tc('write', { path: 'x', content: '  a\n\n  b  ' }))).toBe('path=x')
  })
})

describe('toolExpected', () => {
  it('常见工具生成预期描述', () => {
    expect(toolExpected(tc('ls', { dirPath: 'D:/w' }))).toBe('列出 D:/w 下的文件/目录')
    expect(toolExpected(tc('read', { path: 'a' }))).toBe('读取 a 的内容')
    expect(toolExpected(tc('exec_command'))).toBe('执行命令并返回输出')
  })

  it('未知工具返回空', () => {
    expect(toolExpected(tc('browse'))).toBe('')
  })
})
