// electron/db/db.test.ts — SQLite 基座/双路检索/溯源链单测(v0.4.0 M1/M2/M4)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import {
  initDb, closeDb, insertMemory, listMemories, searchFts, searchVector,
  setMemoryEmbedding, traceSourceChain, softDeleteMemory, saveToolOutput, getToolOutput,
  insertAudit, queryAudit, getMemoriesForDecay, markSuperseded,
} from '../db'

const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'hq-db-test-'))
const dbFile = join(tmpDir, 'test.db')

beforeAll(() => {
  const r = initDb(dbFile)
  expect(r.ok).toBe(true)
})

afterAll(() => {
  closeDb()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

function freshRow(partial: Partial<Parameters<typeof insertMemory>[0]>): Parameters<typeof insertMemory>[0] {
  const now = Date.now()
  return {
    agent: '黄泉', scope: 'global', level: 'normal', layer: 'L1', content: '',
    subject: null, relation: null, object: null, embedding: null, sourceId: null,
    ts: now, lastAccess: now, accessCount: 0, superseded: 0, confidence: 1,
    ...partial,
  }
}

describe('SQLite 存储基座(M1)', () => {
  it('写入/读取记忆, 软删除后不再列出', () => {
    const id = insertMemory(freshRow({ content: 'M1 测试记忆', layer: 'L1' }))
    expect(id).toBeGreaterThan(0)
    const all = listMemories({})
    expect(all.some(m => m.id === id)).toBe(true)
    softDeleteMemory(id)
    expect(listMemories({}).some(m => m.id === id)).toBe(false)
    expect(listMemories({ includeSuperseded: true }).some(m => m.id === id && m.superseded === 1)).toBe(true)
  })

  it('工具输出 side-channel 存取', () => {
    const id = saveToolOutput('s1', 'read', '超长文件内容'.repeat(100))
    expect(id).toBeGreaterThan(0)
    expect(getToolOutput(id)).toBe('超长文件内容'.repeat(100))
    expect(getToolOutput(id + 99999)).toBeNull()
  })

  it('审计写入与筛选查询', () => {
    insertAudit({ ts: 1000, agent: '黄泉', tool: 'exec_command', argsSummary: 'a', resultSummary: 'r', durationMs: 12, tokens: 3 })
    insertAudit({ ts: 2000, agent: '银狼', tool: 'read', argsSummary: 'b', resultSummary: 'r2', durationMs: 5, tokens: null })
    const byAgent = queryAudit({ agent: '银狼', limit: 10 })
    expect(byAgent.length).toBe(1)
    expect(byAgent[0].tool).toBe('read')
    const byRange = queryAudit({ from: 0, to: 1500, limit: 10 })
    expect(byRange.length).toBe(1)
    expect(byRange[0].agent).toBe('黄泉')
  })
})

describe('双路检索(M2)', () => {
  it('FTS5 trigram: ≥3 字 query 命中, 2 字 query 走 LIKE 兜底', () => {
    insertMemory(freshRow({ content: '项目排期阻塞在本周', layer: 'L1' }))
    expect(searchFts('排期阻塞').map(h => h.content)).toContain('项目排期阻塞在本周')
    expect(searchFts('排期').map(h => h.content)).toContain('项目排期阻塞在本周')
    expect(searchFts('不存在的词xyz')).toHaveLength(0)
  })

  it('向量余弦检索返回相似记忆', () => {
    const id = insertMemory(freshRow({ content: '喜欢吃辣的川菜', layer: 'L1' }))
    setMemoryEmbedding(id, [1, 0, 0])
    const hits = searchVector([1, 0, 0], 5)
    expect(hits.some(h => h.id === id)).toBe(true)
    expect(searchVector([0, 0, 1], 5).some(h => h.id === id)).toBe(false)
  })
})

describe('四层溯源(M4)', () => {
  it('L3→L2→L1→L0 沿 source_id 下钻', () => {
    const l0 = insertMemory(freshRow({ content: '原始对话记录', layer: 'L0' }))
    const l1 = insertMemory(freshRow({ content: '原子事实', layer: 'L1', sourceId: l0 }))
    const l2 = insertMemory(freshRow({ content: '场景模式', layer: 'L2', sourceId: l1 }))
    const l3 = insertMemory(freshRow({ content: '核心结论', layer: 'L3', sourceId: l2 }))
    const chain = traceSourceChain(l3)
    expect(chain.map(m => m.layer)).toEqual(['L3', 'L2', 'L1', 'L0'])
  })

  it('superseded 记忆不参与衰减候选', () => {
    const id = insertMemory(freshRow({ content: '待淘汰记忆', layer: 'L1' }))
    markSuperseded(id)
    expect(getMemoriesForDecay().some(m => m.id === id)).toBe(false)
  })
})
