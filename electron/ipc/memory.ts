// electron/ipc/memory.ts —— 记忆域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'

// ─── 语义记忆 ───────────────────────────────────
interface MemoryVectorModule {
  initMemory(p: string): void
  setEmbeddingConfig(cfg: { baseUrl: string; apiKey: string; model: string } | null): void
  searchMemory(q: string, n: number): Promise<{ score: number; content: string }[]>
  addMemory(content: string): unknown
  saveMemory(): void
  clearMemory(): void
}

export function registerMemoryIpc(deps: {
  memoryPath: string
  settingsPath: string
  userDataPath: string
  safeClone: (obj: unknown, seen?: WeakSet<object>) => unknown
  decKey: (enc: string) => string
}): void {
  const { memoryPath, settingsPath, userDataPath, safeClone, decKey } = deps

  let _vm: MemoryVectorModule | null = null
  const getVM = (): MemoryVectorModule => {
    if (!_vm) {
      const m = require('../memory/vector')
      m.initMemory(join(userDataPath, 'memory-vector.json'))
      _vm = m
    }
    return _vm as MemoryVectorModule
  }
  // 从设置刷新 embedding 引擎配置(启动/设置变更后调用, 无需重启)
  const refreshEmbeddingConfig = (): void => {
    try {
      const vm = getVM()
      const g = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general || {}
      if (g.embeddingBaseUrl && g.embeddingModel) {
        const key = typeof g.embeddingApiKey === 'string' && g.embeddingApiKey.startsWith('__ENC__') ? decKey(g.embeddingApiKey) : (g.embeddingApiKey || '')
        vm.setEmbeddingConfig({ baseUrl: String(g.embeddingBaseUrl), apiKey: key, model: String(g.embeddingModel) })
      } else {
        vm.setEmbeddingConfig(null)
      }
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  }

  ipcMain.handle('memory:load', () => {
    try { return fs.existsSync(memoryPath) ? JSON.parse(fs.readFileSync(memoryPath, 'utf-8')) : { facts: [], summaries: [] } }
    catch { return { facts: [], summaries: [] } }
  })
  ipcMain.handle('memory:save', (_e, memory) => {
    // 安全序列化防止循环引用
    // 异步写盘不阻塞主进程
    fs.promises.writeFile(memoryPath, JSON.stringify(safeClone(memory), null, 2), 'utf-8').catch(() => {})
    return true
  })
  ipcMain.handle('memory:search', async (_e, query: string) => {
    try { refreshEmbeddingConfig(); return await getVM().searchMemory(query, 5) } catch { return [] }
  })
  ipcMain.handle('memory:addVector', async (_e, content: string) => {
    try { refreshEmbeddingConfig(); getVM().addMemory(content); getVM().saveMemory(); return true } catch { return false }
  })
  ipcMain.handle('memory:importFile', async (_e, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) return false
      // ragChunkSize/ragThreshold/ragAutoSave 设置接入
      let g: Record<string, unknown> = {}
      try { g = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general || {} } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      const chunkSize = Math.max(100, Number(g.ragChunkSize) || 600)
      const threshold = Number(g.ragThreshold) || 0.35
      const autoSave = g.ragAutoSave !== false
      const content = fs.readFileSync(filePath, 'utf-8')
      const paras = content.split(/\n\s*\n/).filter((c: string) => c.trim().length > 20)
      const chunks: string[] = []
      for (const p of paras) {
        if (p.length <= chunkSize) { chunks.push(p.trim()); continue }
        for (let i = 0; i < p.length; i += chunkSize) chunks.push(p.slice(i, i + chunkSize).trim())
      }
      let added = 0
      for (const chunk of chunks.slice(0, 20)) {
        // ragThreshold: 与现有记忆相似度过高则跳过(语义去重)
        try {
          const hits = await getVM().searchMemory(chunk.slice(0, 120), 1)
          if (hits.length && hits[0].score > threshold) continue
        } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
        getVM().addMemory(chunk)
        added++
      }
      if (autoSave) getVM().saveMemory()
      return added > 0
    } catch { return false }
  })
  ipcMain.handle('memory:clearVector', async () => {
    try { getVM().clearMemory(); getVM().saveMemory(); return true } catch { return false }
  })
}
