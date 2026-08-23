// electron/ipc/memory.ts —— 记忆域 IPC(v0.4.0 定稿: SQLite 主路径, 建库失败自动降级 JSON)
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { normalizeMemory } from '../shared/memory-utils'
import { loadMemory, saveMemory, upsertFactDb, type EngineMemory } from '../engine/memory'
import { listMemories, softDeleteMemory, setMemoryEmbedding, searchFts, searchVector, forgetMemoryText } from '../db'
import { setEmbeddingConfig, embedText, embedBatch } from '../memory/embeddings'
import { rrfFuse } from '../memory/searcher'

const GLOBAL_SCOPE = { agent: '助手', scope: 'global' as const }

export function registerMemoryIpc(deps: {
  memoryPath: string
  settingsPath: string
  userDataPath: string
  safeClone: (obj: unknown, seen?: WeakSet<object>) => unknown
  decKey: (enc: string) => string
}): void {
  const { memoryPath, settingsPath, safeClone, decKey } = deps

  const refreshEmbeddingConfig = (): void => {
    try {
      const g = (JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { general?: { embeddingBaseUrl?: unknown; embeddingModel?: unknown; embeddingApiKey?: unknown } })?.general || {}
      if (g.embeddingBaseUrl && g.embeddingModel) {
        const key = typeof g.embeddingApiKey === 'string' && g.embeddingApiKey.startsWith('__ENC__') ? decKey(g.embeddingApiKey) : String(g.embeddingApiKey || '')
        setEmbeddingConfig({ baseUrl: String(g.embeddingBaseUrl), apiKey: key, model: String(g.embeddingModel) })
      } else {
        setEmbeddingConfig(null)
      }
    } catch { setEmbeddingConfig(null) }
  }

  ipcMain.handle('memory:load', () => loadMemory(memoryPath, GLOBAL_SCOPE))
  ipcMain.handle('memory:save', (_e, memory) => {
    const safe = normalizeMemory(safeClone(memory) as Record<string, unknown>) as unknown as EngineMemory
    return saveMemory(memoryPath, safe, GLOBAL_SCOPE)
  })
  ipcMain.handle('memory:search', async (_e, query: string) => {
    refreshEmbeddingConfig()
    try {
      const q = String(query || '')
      const fts = searchFts(q, 20, GLOBAL_SCOPE)
      const qvec = await embedText(q)
      const vec = qvec ? searchVector(qvec, 20, GLOBAL_SCOPE).map(h => ({ content: h.content, score: h.score })) : []
      return rrfFuse(fts, vec, { limit: 5 }).map(h => ({ content: h.content, score: h.score }))
    } catch { return [] }
  })
  ipcMain.handle('memory:addVector', async (_e, content: string) => {
    refreshEmbeddingConfig()
    const text = String(content || '').trim()
    if (!text) return false
    const id = upsertFactDb('助手', 'global', text, false)
    if (id > 0) {
      const vec = await embedText(text)
      if (vec && vec.length) setMemoryEmbedding(id, vec)
      return true
    }
    return false
  })
  ipcMain.handle('memory:importFile', async (_e, filePath: string) => {
    // 卷宗录入: 批量 embedding(一次请求), 与库内语义去重后逐条落库
    try {
      if (!fs.existsSync(filePath)) return false
      let g: Record<string, unknown> = {}
      try { g = (JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { general?: Record<string, unknown> })?.general || {} } catch { /* 忽略 */ }
      refreshEmbeddingConfig()
      const chunkSize = Math.max(100, Number(g.ragChunkSize) || 600)
      const threshold = Number(g.ragThreshold) || 0.35
      const content = fs.readFileSync(filePath, 'utf-8')
      const paras = content.split(/\n\s*\n/).filter(c => c.trim().length > 20)
      const chunks: string[] = []
      for (const p of paras) {
        if (p.length <= chunkSize) { chunks.push(p.trim()); continue }
        for (let i = 0; i < p.length; i += chunkSize) chunks.push(p.slice(i, i + chunkSize).trim())
      }
      const batch = chunks.slice(0, 20)
      const vecs = await embedBatch(batch)
      let added = 0
      for (let i = 0; i < batch.length; i++) {
        const vec = vecs[i]
        if (vec) {
          const hits = searchVector(vec, 1, GLOBAL_SCOPE)
          if (hits.length && hits[0].score > threshold) continue
        }
        const id = upsertFactDb('助手', 'global', batch[i], false)
        if (id > 0) {
          if (vec) setMemoryEmbedding(id, vec)
          added++
        }
      }
      return added > 0
    } catch { return false }
  })
  ipcMain.handle('memory:clearVector', () => {
    const rows = listMemories({ agent: '助手', scope: 'global', layer: 'L1', includeSuperseded: false, limit: 2000 })
      .filter(m => m.level !== 'pinned')
    for (const r of rows) softDeleteMemory(r.id as number)
    return true
  })

  // v0.4.3 记忆治理: "撤回即不复活" —— 用户主动遗忘, 物理删除 + 进遗忘清单
  ipcMain.handle('memory:forget', (_e, content: string) => {
    return forgetMemoryText(String(content || ''))
  })

  // v0.4.3 语义透明度: 告诉用户当前"语义记忆"是否真在跑(避免静默降级成纯关键词)
  ipcMain.handle('memory:semanticStatus', () => {
    try {
      const g = (JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { general?: { embeddingBaseUrl?: unknown; embeddingModel?: unknown } })?.general || {}
      const on = !!(g.embeddingBaseUrl && g.embeddingModel)
      return { on, note: on ? '语义向量检索已启用（FTS 关键词 + 向量双路融合）' : '未配置嵌入模型：仅用关键词(FTS)检索，语义召回会退化' }
    } catch {
      return { on: false, note: '语义向量检索状态未知' }
    }
  })
}
