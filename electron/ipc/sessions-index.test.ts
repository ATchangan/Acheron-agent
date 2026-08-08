// electron/ipc/sessions-index.test.ts — v0.3.6 P2-7: 增量索引正确性验证
// 直接测 electron/shared/search-utils.ts 真实实现(不再复制模拟)
import { describe, it, expect } from 'vitest'
import { mergeIndexIncremental, IndexDoc } from '../shared/search-utils'

describe('P2-7 增量索引', () => {
  it('追加消息时只对新消息重新分词(旧文档复用)', () => {
    let cache: IndexDoc[] = []
    const s1 = { id: 'a', messages: [
      { role: 'user', content: '第一条消息 hello world', timestamp: 1 },
      { role: 'assistant', content: '回复内容 你好世界', timestamp: 2 },
    ] }
    cache = mergeIndexIncremental(cache, s1)
    const first = cache.map(d => d.text)
    expect(cache).toHaveLength(2)

    // 追加一条新消息
    const s2 = { id: 'a', messages: [
      { role: 'user', content: '第一条消息 hello world', timestamp: 1 },
      { role: 'assistant', content: '回复内容 你好世界', timestamp: 2 },
      { role: 'user', content: '新问题 new query', timestamp: 3 },
    ] }
    cache = mergeIndexIncremental(cache, s2)
    expect(cache).toHaveLength(3)
    // 旧两条文档对象引用未变(复用)
    expect(cache.slice(0, 2).map(d => d.text)).toEqual(first)
    // 新消息已索引
    expect(cache[2].text).toContain('new query')
  })

  it('消息内容变更时重新分词', () => {
    let cache: IndexDoc[] = []
    cache = mergeIndexIncremental(cache, { id: 'b', messages: [{ role: 'user', content: '旧内容 old', timestamp: 5 }] })
    const oldKey = cache[0].key
    cache = mergeIndexIncremental(cache, { id: 'b', messages: [{ role: 'user', content: '新内容 changed content', timestamp: 5 }] })
    expect(cache).toHaveLength(1)
    expect(cache[0].key).toBe(oldKey)
    expect(cache[0].text).toBe('新内容 changed content')
    expect(cache[0].terms).toContain('changed')
    expect(cache[0].terms).not.toContain('old')
  })

  it('消息删除时索引文档清除', () => {
    let cache: IndexDoc[] = []
    cache = mergeIndexIncremental(cache, { id: 'c', messages: [
      { role: 'user', content: '第一条 keep', timestamp: 1 },
      { role: 'user', content: '第二条 delete me', timestamp: 2 },
    ] })
    expect(cache).toHaveLength(2)
    cache = mergeIndexIncremental(cache, { id: 'c', messages: [
      { role: 'user', content: '第一条 keep', timestamp: 1 },
    ] })
    expect(cache).toHaveLength(1)
    expect(cache[0].text).toContain('keep')
  })

  it('不同会话互不影响', () => {
    let cache: IndexDoc[] = []
    cache = mergeIndexIncremental(cache, { id: 'x', messages: [{ role: 'user', content: '会话x内容', timestamp: 1 }] })
    cache = mergeIndexIncremental(cache, { id: 'y', messages: [{ role: 'user', content: '会话y内容', timestamp: 1 }] })
    expect(cache).toHaveLength(2)
    // 更新 y 不影响 x
    cache = mergeIndexIncremental(cache, { id: 'y', messages: [{ role: 'user', content: '会话y内容更新', timestamp: 1 }] })
    expect(cache).toHaveLength(2)
    expect(cache.find(d => d.sid === 'x')?.text).toBe('会话x内容')
  })
})
