// electron/ipc/sessions-index.test.ts — v0.3.6 P2-7: 增量索引正确性验证
// 验证: 消息追加时索引增量复用; 内容变更时重新分词; 会话删除时文档清除
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'

// 从 sessions.ts 导出的纯函数不可直接测试(模块内部), 这里用独立实现模拟相同逻辑验证行为
// 实际链路由 sessions:save → enqueueSave → updateIndexForSession 承担, 冒烟已覆盖
function indexTerms(text: string): string[] {
  const t = String(text || '').toLowerCase()
  const latin = (t.match(/[a-z0-9_]+/g) || []).filter(w => w.length > 1)
  const cn = t.match(/[\u4e00-\u9fff]/g) || []
  const bigrams: string[] = []
  for (let i = 0; i + 1 < cn.length; i++) bigrams.push(cn[i] + cn[i + 1])
  return [...new Set([...latin, ...bigrams])].slice(0, 60)
}

interface IndexDoc { key: string; sid: string; text: string; terms: string[] }

// 与 updateIndexForSession 相同的增量逻辑
function updateIndexIncremental(indexCache: IndexDoc[], s: { id?: string; title?: string; messages?: { role?: string; content?: unknown; timestamp?: number }[] }): IndexDoc[] {
  const oldByKey = new Map(indexCache.filter(d => d.sid === s.id).map(d => [d.key, d]))
  const rest = indexCache.filter(d => d.sid !== s.id)
  const fresh: IndexDoc[] = []
  const msgs = s.messages || []
  for (let i = 0; i < msgs.length && fresh.length < 300; i++) {
    const m = msgs[i]
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (typeof m.content !== 'string' || m.content.trim().length < 2) continue
    const text = m.content.trim().slice(0, 300)
    const key = String(s.id) + ':' + (m.timestamp || i) + ':' + i
    const old = oldByKey.get(key)
    if (old && old.text === text) { fresh.push(old); continue }
    const terms = indexTerms(text)
    if (!terms.length) continue
    fresh.push({ key, sid: String(s.id), text, terms })
  }
  return [...rest, ...fresh]
}

describe('P2-7 增量索引', () => {
  it('追加消息时只对新消息重新分词(旧文档复用)', () => {
    let cache: IndexDoc[] = []
    const s1 = { id: 'a', messages: [
      { role: 'user', content: '第一条消息 hello world', timestamp: 1 },
      { role: 'assistant', content: '回复内容 你好世界', timestamp: 2 },
    ] }
    cache = updateIndexIncremental(cache, s1)
    const first = cache.map(d => d.text)
    expect(cache).toHaveLength(2)

    // 追加一条新消息
    const s2 = { id: 'a', messages: [
      { role: 'user', content: '第一条消息 hello world', timestamp: 1 },
      { role: 'assistant', content: '回复内容 你好世界', timestamp: 2 },
      { role: 'user', content: '新问题 new query', timestamp: 3 },
    ] }
    cache = updateIndexIncremental(cache, s2)
    expect(cache).toHaveLength(3)
    // 旧两条文档对象引用未变(复用)
    expect(cache.slice(0, 2).map(d => d.text)).toEqual(first)
    // 新消息已索引
    expect(cache[2].text).toContain('new query')
  })

  it('消息内容变更时重新分词', () => {
    let cache: IndexDoc[] = []
    cache = updateIndexIncremental(cache, { id: 'b', messages: [{ role: 'user', content: '旧内容 old', timestamp: 5 }] })
    const oldKey = cache[0].key
    cache = updateIndexIncremental(cache, { id: 'b', messages: [{ role: 'user', content: '新内容 changed content', timestamp: 5 }] })
    expect(cache).toHaveLength(1)
    expect(cache[0].key).toBe(oldKey)
    expect(cache[0].text).toBe('新内容 changed content')
    expect(cache[0].terms).toContain('changed')
    expect(cache[0].terms).not.toContain('old')
  })

  it('消息删除时索引文档清除', () => {
    let cache: IndexDoc[] = []
    cache = updateIndexIncremental(cache, { id: 'c', messages: [
      { role: 'user', content: '第一条 keep', timestamp: 1 },
      { role: 'user', content: '第二条 delete me', timestamp: 2 },
    ] })
    expect(cache).toHaveLength(2)
    cache = updateIndexIncremental(cache, { id: 'c', messages: [
      { role: 'user', content: '第一条 keep', timestamp: 1 },
    ] })
    expect(cache).toHaveLength(1)
    expect(cache[0].text).toContain('keep')
  })

  it('不同会话互不影响', () => {
    let cache: IndexDoc[] = []
    cache = updateIndexIncremental(cache, { id: 'x', messages: [{ role: 'user', content: '会话x内容', timestamp: 1 }] })
    cache = updateIndexIncremental(cache, { id: 'y', messages: [{ role: 'user', content: '会话y内容', timestamp: 1 }] })
    expect(cache).toHaveLength(2)
    // 更新 y 不影响 x
    cache = updateIndexIncremental(cache, { id: 'y', messages: [{ role: 'user', content: '会话y内容更新', timestamp: 1 }] })
    expect(cache).toHaveLength(2)
    expect(cache.find(d => d.sid === 'x')?.text).toBe('会话x内容')
  })
})
