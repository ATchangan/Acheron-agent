import { describe, expect, it } from 'vitest'
import { TOOLS } from './tool-specs'

describe('TOOLS schema 完整性', () => {
  it('工具名唯一', () => {
    const names = TOOLS.map(t => t.function.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('每个工具都有描述和参数对象', () => {
    for (const t of TOOLS) {
      expect(t.function.description.length, t.function.name).toBeGreaterThan(0)
      expect(t.function.parameters.type).toBe('object')
      expect(t.function.parameters.properties).toBeTypeOf('object')
    }
  })

  it('required 引用的属性必须存在', () => {
    for (const t of TOOLS) {
      const { required, properties } = t.function.parameters
      for (const r of required || []) {
        expect(properties[r], `${t.function.name} 的 required 引用了不存在的属性 ${r}`).toBeDefined()
      }
    }
  })

  it('包含核心工具集', () => {
    const names = new Set(TOOLS.map(t => t.function.name))
    for (const n of ['read', 'write', 'edit', 'apply_patch', 'exec_command', 'update_plan', 'terminal_open', 'terminal_run', 'terminal_close', 'grep', 'ls', 'codebox', 'save_goal']) {
      expect(names.has(n), `缺少工具 ${n}`).toBe(true)
    }
  })
})
