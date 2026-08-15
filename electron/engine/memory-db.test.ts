// electron/engine/memory-db.test.ts — 记忆收敛(v0.4.0 定稿): SQLite 主路径读写/隔离/去重
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { initDb, closeDb, listMemories, searchFts } from '../db'
import { loadMemory, saveMemory, upsertFactDb, recallMemoryDb, type EngineMemory } from './memory'

const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'hq-memdb-test-'))
const memoryPath = join(tmpDir, 'memory.json')

beforeAll(() => {
  expect(initDb(join(tmpDir, 'agent.db')).ok).toBe(true)
})

afterAll(() => {
  closeDb()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

describe('SQLite 记忆主路径', () => {
  it('save/load 全字段往返 + 事实/置顶/摘要按内容 reconcile', () => {
    const base = {
      facts: ['事实A', '事实B'],
      summaries: [{ content: '摘要一', timestamp: 100 }],
      pinnedFacts: ['用户偏好 PowerShell'],
      lessons: [{ content: '教训一', ts: 100 }],
      goals: [{ goal: '目标一', status: 'open', created: 100 }],
      episodic: [{ op: 'write', path: '/a.txt', status: 'done', ts: 100 }],
    }
    expect(saveMemory(memoryPath, base, { agent: '助手', scope: 'global' })).toBe(true)
    let loaded = loadMemory(memoryPath, { agent: '助手', scope: 'global' })
    expect(loaded.facts).toEqual(['事实A', '事实B'])
    expect(loaded.pinnedFacts).toEqual(['用户偏好 PowerShell'])
    expect(loaded.summaries.map(s => s.content)).toContain('摘要一')
    expect(loaded.lessons?.map(l => l.content)).toContain('教训一')
    expect(loaded.goals?.map(g => g.goal)).toContain('目标一')
    expect(loaded.episodic?.length).toBe(1)

    expect(saveMemory(memoryPath, { ...base, facts: ['事实B', '事实C'] }, { agent: '助手', scope: 'global' })).toBe(true)
    loaded = loadMemory(memoryPath, { agent: '助手', scope: 'global' })
    expect(loaded.facts).toEqual(['事实B', '事实C'])
  })

  it('全局/私有记忆按 agent+scope 隔离, FTS/向量检索只命中本作用域', () => {
    saveMemory(memoryPath, { facts: ['全局事实甲'], summaries: [] }, { agent: '助手', scope: 'global' })
    saveMemory(memoryPath, { facts: ['私有事实乙'], summaries: [] }, { agent: '安全', scope: 'private' })
    expect(searchFts('全局事实甲', 10, { agent: '助手', scope: 'global' }).length).toBe(1)
    expect(searchFts('私有事实乙', 10, { agent: '助手', scope: 'global' })).toHaveLength(0)
    expect(searchFts('私有事实乙', 10, { agent: '安全', scope: 'private' }).length).toBe(1)
  })

  it('upsertFactDb 同事实去重并累计置信度', () => {
    const id1 = upsertFactDb('助手', 'global', '用户喜欢咖啡', false)
    const id2 = upsertFactDb('助手', 'global', '用户喜欢咖啡', false)
    expect(id1).toBeGreaterThan(0)
    expect(id2).toBe(id1)
    const rows = listMemories({ agent: '助手', scope: 'global', layer: 'L1' }).filter(m => m.content === '用户喜欢咖啡')
    expect(rows.length).toBe(1)
    expect(rows[0].confidence).toBe(2)
  })

  it('recallMemoryDb 无嵌入配置时仍走 FTS 关键词路', async () => {
    saveMemory(memoryPath, { facts: ['项目排期阻塞在本周'], summaries: [] }, { agent: '助手', scope: 'global' })
    const hits = await recallMemoryDb('助手', 'global', '排期阻塞', 5)
    expect(hits && hits.map(h => h.content)).toContain('项目排期阻塞在本周')
  })

  it('只带部分字段的保存不会清空缺失字段(防误清库)', () => {
    saveMemory(memoryPath, {
      facts: ['事实A'], summaries: [], pinnedFacts: [],
      lessons: [{ content: '保留教训', ts: 1 }], goals: [], episodic: [],
    }, { agent: '助手', scope: 'global' })
    saveMemory(memoryPath, { facts: ['事实B'], summaries: [] } as EngineMemory, { agent: '助手', scope: 'global' })
    const loaded = loadMemory(memoryPath, { agent: '助手', scope: 'global' })
    expect(loaded.facts).toEqual(['事实B'])
    expect(loaded.lessons?.map(l => l.content)).toContain('保留教训')
  })
})
