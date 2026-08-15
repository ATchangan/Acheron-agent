// electron/security/permission.test.ts — 命令变更判定回归(插件桥与主 exec_command 共用)
import { describe, expect, it } from 'vitest'
import { assessRisk, isMutatingCommand } from './permission'

describe('isMutatingCommand', () => {
  it('只读查询不视为变更', () => {
    expect(isMutatingCommand('git status')).toBe(false)
    expect(isMutatingCommand('node -v')).toBe(false)
    expect(isMutatingCommand('dir')).toBe(false)
    expect(isMutatingCommand('npm ls')).toBe(false)
  })

  it('写/删除/发布类命令视为变更', () => {
    expect(isMutatingCommand('git push origin main')).toBe(true)
    expect(isMutatingCommand('npm install lodash')).toBe(true)
    expect(isMutatingCommand('del a.txt')).toBe(true)
    expect(isMutatingCommand('mkdir x')).toBe(true)
  })
})

describe('assessRisk', () => {
  it('危险命令定级 L4, 只读命令 L1, 其余 L2', () => {
    expect(assessRisk({ type: 'terminal', command: 'rm -rf /' })).toBe('L4')
    expect(assessRisk({ type: 'terminal', command: 'dir' })).toBe('L1')
    expect(assessRisk({ type: 'terminal', command: 'git push' })).toBe('L2')
  })
})
