import { describe, expect, it } from 'vitest'
import { applyPatchToContent } from './patch-utils'

describe('applyPatchToContent', () => {
  it('单个 hunk 精确替换', () => {
    const r = applyPatchToContent('hello world\nfoo bar\n', [{ oldText: 'foo bar', newText: 'foo baz' }])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toBe('hello world\nfoo baz\n')
  })

  it('多个 hunk 按顺序应用', () => {
    const r = applyPatchToContent('a\nb\nc\n', [
      { oldText: 'a', newText: 'A' },
      { oldText: 'c', newText: 'C' },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toBe('A\nb\nC\n')
  })

  it('找不到片段时返回错误且不写盘', () => {
    const r = applyPatchToContent('abc', [{ oldText: 'xyz', newText: '1' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('未找到匹配片段')
  })

  it('片段不唯一时返回错误', () => {
    const r = applyPatchToContent('xx\nxx\n', [{ oldText: 'xx', newText: 'yy' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('不唯一')
  })

  it('缺 oldText 报错', () => {
    const r = applyPatchToContent('abc', [{ oldText: '', newText: '1' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('缺少 oldText')
  })

  it('多个错误全部返回', () => {
    const r = applyPatchToContent('abc', [{ oldText: 'nope1', newText: '1' }, { oldText: 'nope2', newText: '2' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toHaveLength(2)
  })
})
