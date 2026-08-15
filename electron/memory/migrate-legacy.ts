// electron/memory/migrate-legacy.ts — v0.3.x JSON 记忆一次性迁移到 SQLite(v0.4.0 M1)
// 旧文件导入成功后改名 .bak(不删除, 可回滚); 失败不阻塞启动, 下次启动重试
import * as fs from 'fs'
import { insertMemory, insertLesson, replaceGoals, isLegacyImported, markLegacyImported } from '../db'

export interface LegacyPaths { vectorPath: string; jsonPath: string }

export function importLegacyMemory(paths: LegacyPaths): { imported: number; ok: boolean } {
  try {
    if (isLegacyImported()) return { imported: 0, ok: true }
    const contents: { text: string; pinned: boolean }[] = []

    // 旧向量记忆(memory-vector.json: entries[].content)
    if (fs.existsSync(paths.vectorPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(paths.vectorPath, 'utf-8')) as { entries?: { content?: string }[] }
        for (const e of data.entries || []) {
          const t = String(e?.content || '').trim()
          if (t) contents.push({ text: t, pinned: false })
        }
      } catch { /* 损坏的向量文件跳过 */ }
    }

    // 旧结构化记忆(memory.json: facts / pinnedFacts / summaries / lessons / goals)
    const summaries: { content: string; ts: number }[] = []
    const lessons: string[] = []
    const goals: { goal: string; status: string; created: number }[] = []
    if (fs.existsSync(paths.jsonPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(paths.jsonPath, 'utf-8')) as {
          facts?: string[]
          pinnedFacts?: string[]
          summaries?: { content?: string; timestamp?: number }[]
          lessons?: { content?: string; ts?: number }[]
          goals?: { goal?: string; status?: string; created?: number }[]
        }
        for (const f of data.facts || []) {
          const t = String(f).trim()
          if (t) contents.push({ text: t, pinned: false })
        }
        for (const f of data.pinnedFacts || []) {
          const t = String(f).trim()
          if (t) contents.push({ text: t, pinned: true })
        }
        for (const s of data.summaries || []) {
          const t = String(s?.content || '').trim()
          if (t) summaries.push({ content: t.slice(0, 1000), ts: Number(s?.timestamp || Date.now()) })
        }
        for (const l of data.lessons || []) {
          const t = String(l?.content || '').trim()
          if (t) lessons.push(t.slice(0, 500))
        }
        for (const g of data.goals || []) {
          const t = String(g?.goal || '').trim()
          if (t) goals.push({ goal: t.slice(0, 1000), status: String(g?.status || 'open'), created: Number(g?.created || Date.now()) })
        }
      } catch { /* 损坏的 memory.json 跳过 */ }
    }

    const now = Date.now()
    const seen = new Set<string>()
    let imported = 0
    for (const c of contents.slice(0, 1000)) {
      const key = c.text.slice(0, 160)
      if (seen.has(key)) continue
      seen.add(key)
      const id = insertMemory({
        agent: '助手',
        scope: 'global',
        level: c.pinned ? 'pinned' : 'normal',
        layer: c.pinned ? 'L3' : 'L1',
        content: c.text.slice(0, 1000),
        subject: null,
        relation: null,
        object: null,
        embedding: null,
        sourceId: null,
        ts: now,
        lastAccess: now,
        accessCount: 0,
        superseded: 0,
        confidence: 1,
      })
      if (id > 0) imported++
    }
    // 摘要/教训/目标迁移(去重后落库)
    for (const s of summaries.slice(0, 200)) {
      insertMemory({
        agent: '助手', scope: 'global', level: 'normal', layer: 'L3', content: s.content,
        subject: null, relation: null, object: null, embedding: null, sourceId: null,
        ts: s.ts, lastAccess: now, accessCount: 0, superseded: 0, confidence: 1,
      })
    }
    for (const l of lessons.slice(0, 50)) insertLesson('助手', 'global', l, now)
    if (goals.length) replaceGoals('助手', 'global', goals.map(g => ({ ...g, updated: now })))

    // 导入完成标记 + 旧文件改名备份(失败也不影响已导入数据)
    markLegacyImported()
    const bak = (p: string): void => {
      try { if (fs.existsSync(p)) fs.renameSync(p, p + '.bak') } catch { /* 忽略 */ }
    }
    bak(paths.vectorPath)
    bak(paths.jsonPath)
    return { imported, ok: true }
  } catch (e) {
    console.warn('[db] 旧记忆迁移失败(下次启动重试):', e instanceof Error ? e.message : String(e))
    return { imported: 0, ok: false }
  }
}
