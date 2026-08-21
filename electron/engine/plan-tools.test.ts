import { describe, expect, it } from 'vitest'
import { isPlanReadonlyTool } from './plan-tools'

describe('isPlanReadonlyTool 计划阶段只读判断', () => {
  it('只读/规划工具放行', () => {
    for (const t of ['read', 'ls', 'grep', 'find', 'web_search', 'web_fetch', 'web_read', 'session_search', 'recall_memory', 'list_agents', 'list_workflows', 'list_goals', 'list_schedules', 'system_info', 'update_plan', 'read_skill']) {
      expect(isPlanReadonlyTool(t)).toBe(true)
    }
  })

  it('git 仅放行 status/diff/log, 忽略大小写与空白', () => {
    expect(isPlanReadonlyTool('git', { action: 'status' })).toBe(true)
    expect(isPlanReadonlyTool('git', { action: ' DIFF ' })).toBe(true)
    expect(isPlanReadonlyTool('git', { action: 'log' })).toBe(true)
    expect(isPlanReadonlyTool('git', { action: 'commit' })).toBe(false)
    expect(isPlanReadonlyTool('git', { action: 'stash' })).toBe(false)
    expect(isPlanReadonlyTool('git', { action: 'push' })).toBe(false)
    expect(isPlanReadonlyTool('git', { action: 'pull' })).toBe(false)
    expect(isPlanReadonlyTool('git', { action: 'checkout' })).toBe(false)
    expect(isPlanReadonlyTool('git', {})).toBe(false)
  })

  it('写/副作用工具一律拦截', () => {
    expect(isPlanReadonlyTool('write')).toBe(false)
    expect(isPlanReadonlyTool('edit')).toBe(false)
    expect(isPlanReadonlyTool('apply_patch')).toBe(false)
    expect(isPlanReadonlyTool('exec_command')).toBe(false)
    expect(isPlanReadonlyTool('terminal_open')).toBe(false)
    expect(isPlanReadonlyTool('mkdir')).toBe(false)
  })
})
