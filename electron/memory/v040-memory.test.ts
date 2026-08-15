// electron/memory/v040-memory.test.ts — v0.4.0 M2/M3/M4 记忆单测
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { initDb, closeDb, listMemories, insertMemory } from '../db'
import { parseFact, storeFact } from './facts'
import { decayLimit, runDecay } from './decay'
import { rrfFuse } from './searcher'

const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'hq-mem-test-'))

beforeAll(() => {
  expect(initDb(join(tmpDir, 'mem.db')).ok).toBe(true)
})

afterAll(() => {
  closeDb()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

describe('parseFact 中文启发式(M4)', () => {
  it('谓词切分三元组', () => {
    expect(parseFact('项目使用 TypeScript 开发')).toEqual({ subject: '项目', relation: '使用', object: 'TypeScript 开发' })
  })
  it('否定谓词', () => {
    const r = parseFact('我不喜欢加班')
    expect(r.relation).toBe('不喜欢')
  })
  it('无谓词/超长降级为空三元组', () => {
    expect(parseFact('随便聊聊')).toEqual({ subject: null, relation: null, object: null })
    expect(parseFact('甲'.repeat(40) + '是乙')).toEqual({ subject: null, relation: null, object: null })
  })
})

describe('storeFact 去重与冲突(M4)', () => {
  it('同一事实重复 5 次仅 1 行, confidence=5', () => {
    for (let i = 0; i < 5; i++) {
      storeFact({
        agent: '助手', scope: 'global', level: 'normal', layer: 'L1',
        content: '项目使用 TypeScript 开发', subject: '项目', relation: '使用', object: 'TypeScript 开发',
        embedding: null, sourceId: null, ts: Date.now(), lastAccess: Date.now(), accessCount: 0, superseded: 0, confidence: 1,
      })
    }
    const rows = listMemories({ layer: 'L1' }).filter(m => m.subject === '项目')
    expect(rows).toHaveLength(1)
    expect(rows[0].confidence).toBe(5)
  })

  it('同主谓不同宾 → 新行, 旧行 superseded', () => {
    storeFact({
      agent: '助手', scope: 'global', level: 'normal', layer: 'L1',
      content: '项目技术栈是 Electron', subject: '项目技术栈', relation: '是', object: 'Electron',
      embedding: null, sourceId: null, ts: Date.now(), lastAccess: Date.now(), accessCount: 0, superseded: 0, confidence: 1,
    })
    storeFact({
      agent: '助手', scope: 'global', level: 'normal', layer: 'L1',
      content: '项目技术栈是 Tauri', subject: '项目技术栈', relation: '是', object: 'Tauri',
      embedding: null, sourceId: null, ts: Date.now(), lastAccess: Date.now(), accessCount: 0, superseded: 0, confidence: 1,
    })
    const rows = listMemories({ layer: 'L1', includeSuperseded: true }).filter(m => m.subject === '项目技术栈')
    expect(rows).toHaveLength(2)
    expect(rows.filter(r => r.superseded === 1)).toHaveLength(1)
    expect(listMemories({ layer: 'L1' }).filter(m => m.subject === '项目技术栈' && m.object === 'Tauri')).toHaveLength(1)
  })
})

describe('三档衰减(M3)', () => {
  it('pinned 永存, 各档天数正确', () => {
    expect(decayLimit('pinned', 0)).toBe(Infinity)
    expect(decayLimit('normal', 0)).toBe(30)
    expect(decayLimit('normal', 1)).toBe(180)
    expect(decayLimit('important', 0)).toBe(60)
    expect(decayLimit('important', 1)).toBe(360)
  })

  it('超期 normal 软删除, pinned 不删', () => {
    const old = Date.now() - 40 * 86400000
    const pinnedId = insertMemory({ agent: '助手', scope: 'global', level: 'pinned', layer: 'L3', content: '长期约定', subject: null, relation: null, object: null, embedding: null, sourceId: null, ts: old, lastAccess: old, accessCount: 0, superseded: 0, confidence: 1 })
    const normalId = insertMemory({ agent: '助手', scope: 'global', level: 'normal', layer: 'L1', content: '过期事实', subject: null, relation: null, object: null, embedding: null, sourceId: null, ts: old, lastAccess: old, accessCount: 0, superseded: 0, confidence: 2 })
    runDecay()
    const remaining = listMemories({ includeSuperseded: true })
    expect(remaining.some(m => m.id === pinnedId && m.superseded === 0)).toBe(true)
    expect(remaining.some(m => m.id === normalId && m.superseded === 1)).toBe(true)
  })
})

describe('RRF 双路融合(M2)', () => {
  it('关键词+向量共同命中得分更高, level 加权排序', () => {
    const hits = rrfFuse(
      [{ id: 0, score: 1, content: '共同命中记忆' }, { id: 0, score: 1, content: '仅关键词' }],
      [{ content: '共同命中记忆', score: 0.9 }],
      { limit: 5 },
    )
    expect(hits[0].content).toBe('共同命中记忆')
    expect(hits.length).toBe(2)
  })
})
