// electron/db/db.test.ts — SQLite 基座单测(工具输出/审计/会话索引/技能统计)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import {
  closeDb,
  initDb,
  saveToolOutput,
  getToolOutput,
  insertAudit,
  queryAudit,
  replaceSessionChunks,
  deleteSessionChunks,
  searchSessionIndex,
  pruneToolOutputs,
  pruneSessionChunks,
  pruneAudit,
  recordSkillStat,
  skillStats
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

describe('SQLite 存储基座(M1)', () => {
  it('工具输出 side-channel 存取', () => {
    const id = saveToolOutput('s1', 'read', '超长文件内容'.repeat(100))
    expect(id).toBeGreaterThan(0)
    expect(getToolOutput(id)).toBe('超长文件内容'.repeat(100))
    expect(getToolOutput(id + 99999)).toBeNull()
  })

  it('审计写入与筛选查询', () => {
    insertAudit({ ts: 1000, agent: '助手', tool: 'exec_command', argsSummary: 'a', resultSummary: 'r', durationMs: 12, tokens: 3 })
    insertAudit({ ts: 2000, agent: '安全', tool: 'read', argsSummary: 'b', resultSummary: 'r2', durationMs: 5, tokens: null })
    const byAgent = queryAudit({ agent: '安全', limit: 10 })
    expect(byAgent.length).toBe(1)
    expect(byAgent[0].tool).toBe('read')
    const byRange = queryAudit({ from: 0, to: 1500, limit: 10 })
    expect(byRange.length).toBe(1)
    expect(byRange[0].agent).toBe('助手')
  })
})

describe('索引与维护(v0.4.0 定稿)', () => {
  it('会话索引按 sid 重建后可检索, 重写不残留旧索引', () => {
    replaceSessionChunks('sA', [{ role: 'user', snippet: '设计评审会议记录', ts: 100 }])
    expect(searchSessionIndex('评审会议').some(h => h.sid === 'sA')).toBe(true)
    replaceSessionChunks('sA', [{ role: 'user', snippet: '部署上线清单', ts: 200 }])
    expect(searchSessionIndex('评审会议')).toHaveLength(0)
    expect(searchSessionIndex('部署上线').some(h => h.sid === 'sA')).toBe(true)
    deleteSessionChunks('sA')
    expect(searchSessionIndex('部署上线')).toHaveLength(0)
  })

  it('side-channel 与审计按条数/时间上限清理', () => {
    const id = saveToolOutput('s2', 'read', '待清理内容')
    insertAudit({ ts: Date.now() - 1000, agent: '助手', tool: 'exec_command' })
    expect(getToolOutput(id)).toBe('待清理内容')
    pruneToolOutputs(1, 0)
    expect(getToolOutput(id)).toBeNull()
    pruneAudit(0)
    expect(queryAudit({ agent: '助手', limit: 10 })).toHaveLength(0)
  })

  it('会话索引按时间清理(保留期外移除, 近期仍在)', () => {
    const now = Date.now()
    replaceSessionChunks('sPrune', [
      { role: 'user', snippet: '很旧的一条会议纪要', ts: now - 1000 * 86400 * 200 },
      { role: 'user', snippet: '较新的一条部署记录', ts: now - 1000 * 86400 * 10 },
    ])
    expect(searchSessionIndex('会议纪要').some(h => h.sid === 'sPrune')).toBe(true)
    const removed = pruneSessionChunks(1000 * 86400 * 180, 1000)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(searchSessionIndex('会议纪要')).toHaveLength(0)
    expect(searchSessionIndex('部署记录').some(h => h.sid === 'sPrune')).toBe(true)
    deleteSessionChunks('sPrune')
  })

  it('skill_stats 按日聚合命中统计(只增不改)', () => {
    recordSkillStat('demo', 'hit'); recordSkillStat('demo', 'hit'); recordSkillStat('demo', 'trigger')
    const rows = skillStats(30).filter(r => r.name === 'demo')
    expect(rows.length).toBe(1)
    expect(rows[0].hit).toBe(2)
    expect(rows[0].trigger).toBe(1)
    expect(rows[0].triggerRate).toBeCloseTo(0.5)
  })
})
