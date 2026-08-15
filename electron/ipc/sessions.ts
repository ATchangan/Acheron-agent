// electron/ipc/sessions.ts —— 会话域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { writeFileAtomic, writeFileAtomicAsync } from '../fs-atomic'
import { tokenizeSearch, docsForSession, mergeIndexIncremental } from '../shared/search-utils'

// 会话 id 白名单校验 —— 修复路径穿越(id 含 ../ 可读写任意 .json)
const SAFE_ID = /^[0-9a-zA-Z-]{1,64}$/

export function registerSessionIpc(deps: {
  sessionsDir: string
  userDataPath: string
  sessionMeta: Map<string, { title?: string; messageCount?: number; updatedAt?: string; mode?: string; pinned?: boolean }>
  buildSessionMeta: () => void
}): void {
  const { sessionsDir, userDataPath, sessionMeta, buildSessionMeta } = deps
  const searchIndexPath = join(userDataPath, 'search-index.json')

  // ─── 会话全文关键词搜索(v0.3.3: FTS5-lite 倒排索引, 替代全量扫描) ───
  ipcMain.handle('sessions:search', async (_e, query: string, limit?: number) => {
    if (indexCache === null) loadIndex(searchIndexPath, sessionsDir)
    if ((indexCache?.length || 0) === 0 && fs.existsSync(sessionsDir)) rebuildIndexFromDir(sessionsDir)
    return searchSessionsIndex(query, limit)
  })

  // v0.3.1 E: 每会话串行保存队列 + meta 与写盘绑定(FIX-4/5/7)
  // v0.3.6 P2-7: pendingSaves 存对象引用, 写盘时一次 stringify; 索引直接用对象(省一次全量 parse)
  const saveQueues = new Map<string, Promise<void>>()
  const pendingSaves = new Map<string, Record<string, unknown>>()   // id → 最新对象(防堆积合并)
  const enqueueSave = (id: string, obj: Record<string, unknown>): void => {
    pendingSaves.set(id, obj)
    if (saveQueues.has(id)) return               // 已有队列在跑, 合并等待
    const run = async () => {
      while (pendingSaves.has(id)) {
        const latest = pendingSaves.get(id)!; pendingSaves.delete(id)
        try {
          await writeFileAtomicAsync(join(sessionsDir, id + '.json'), JSON.stringify(latest))
          const mt = latest as { title?: string; messageCount?: number; mode?: string; pinned?: boolean }
          try {
            if (latest && latest.id === id) updateIndexForSession(latest as { id?: string; title?: string; messages?: { role?: string; content?: unknown; timestamp?: number }[] }, searchIndexPath)
          } catch { /* 忽略 */ }
          sessionMeta.set(id, {
            title: String(mt.title || '新对话').slice(0, 60), messageCount: (mt.messageCount || 0) as number,
            updatedAt: new Date().toISOString(), mode: String(mt.mode || 'work'), pinned: mt.pinned === true,
          })                                       // FIX-5: meta 仅在写盘成功后更新
        } catch (e) {
          console.error('[SESSIONS] save error:', e instanceof Error ? e.message : String(e))
          // 写盘失败: meta 不更新(防幽灵会话)
        }
        // 关键修复: 让出事件循环 —— 让同 id 的后续 save 能并入 pendingSaves,
        // 否则 run() 同步跑完后 saveQueues 里残留"已完成"的 promise, 后续保存全部被吞
        await new Promise<void>(r => setImmediate(r))
      }
    }
    const p = run().finally(() => saveQueues.delete(id))
    saveQueues.set(id, p)
  }

  ipcMain.handle('sessions:audit', () => {
    try {
      if (!fs.existsSync(sessionsDir)) return []
      return fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    } catch { return [] }
  })
  ipcMain.handle('sessions:list', () => {
    try {
      if (sessionMeta.size === 0 && fs.existsSync(sessionsDir)) buildSessionMeta()
      return [...sessionMeta.entries()].map(([id, m]) => ({ id, title: m.title, messageCount: m.messageCount, updatedAt: m.updatedAt, mode: m.mode, pinned: m.pinned }))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    } catch { return [] }
  })
  ipcMain.handle('sessions:load', (_e, id: string) => {
    // v0.3.1 FIX-7: 加载失败可感知(loadError 标记; 渲染层不覆盖内存版本)
    if (!SAFE_ID.test(String(id || ''))) return { id, title: '新对话', messages: [], loadError: 'invalid-id' }
    const p = join(sessionsDir, id + '.json')
    try {
      if (!fs.existsSync(p)) { sessionMeta.delete(id); return { id, title: '新对话', messages: [], loadError: 'missing' } }
      const d = JSON.parse(fs.readFileSync(p, 'utf-8'))
      // v0.3.8: schema 版本校验 —— 未来版本文件提示, 避免静默错读
      if (d && typeof d === 'object' && Number(d.schemaVersion || 1) > 1) {
        return { ...d, loadError: 'newer-schema' }
      }
      return d
    } catch (e) {
      console.error('[SESSIONS] load error:', id, e instanceof Error ? e.message : String(e))
      return { id, title: '（加载失败）', messages: [], loadError: 'corrupt' }
    }
  })
  ipcMain.handle('sessions:save', (_e, s) => {
    // v0.3.6 P2-7: IPC 结构化克隆已保证无循环引用, 去掉 safeClone 二次深拷贝; 直接传对象给保存队列
    const id = String(s?.id || '')
    if (!SAFE_ID.test(id)) return false
    // v0.3.8: 会话文件 schema 版本 —— 为未来迁移预留
    const obj = { ...(s as Record<string, unknown>), updatedAt: new Date().toISOString(), schemaVersion: 1 }
    enqueueSave(id, obj)
    return true
  })
  ipcMain.handle('sessions:delete', (_e, id: string) => {
    try {
      if (!SAFE_ID.test(String(id || ''))) return false
      fs.unlinkSync(join(sessionsDir, id + '.json'))
      sessionMeta.delete(id)
      if (indexCache) {
        indexCache = indexCache.filter(d => d.sid !== id)
        indexDirty = true
        saveIndexNow()
      }
    } catch (e) { /* ok */ console.debug('[swallow]', e) }
    return true
  })
  // 清空全部对话历史
  ipcMain.handle('sessions:clearAll', () => {
    try {
      if (!fs.existsSync(sessionsDir)) return true
      for (const f of fs.readdirSync(sessionsDir)) { if (f.endsWith('.json')) fs.unlinkSync(join(sessionsDir, f)) }
      sessionMeta.clear()
      indexCache = []
      indexDirty = true
      saveIndexNow()
      return true
    } catch { return false }
  })
  // 导出对话历史（md/json/txt）到工作目录
  ipcMain.handle('sessions:export', async (_e, format: string, workDir?: string) => {
    try {
      const dir = workDir && fs.existsSync(workDir) ? workDir : userDataPath
      const files = fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')) : []
      const all = files.map(f => { try { return JSON.parse(fs.readFileSync(join(sessionsDir, f), 'utf-8')) } catch { return null } }).filter(Boolean)
      const stamp = new Date().toISOString().slice(0, 10)
      if (format === 'json') {
        const out = join(dir, `huangquan-history-${stamp}.json`)
        fs.writeFileSync(out, JSON.stringify(all, null, 2), 'utf-8')
        return out
      }
      if (format === 'txt') {
        const lines: string[] = []
        for (const s of all) { lines.push(`=== ${s.title || '对话'} ===`); for (const m of s.messages || []) { if (m.role === 'user' || (m.role === 'assistant' && m.content)) lines.push(`[${m.role === 'user' ? '用户' : '助手'}] ${(m.content || '').replace(/\n+/g, ' ')}`) } lines.push('') }
        const out = join(dir, `huangquan-history-${stamp}.txt`)
        fs.writeFileSync(out, lines.join('\n'), 'utf-8')
        return out
      }
      // md
      const lines: string[] = ['# 桌面智能助手 对话历史', '']
      for (const s of all) { lines.push(`## ${s.title || '对话'}`, ''); for (const m of s.messages || []) { if (m.role === 'user' || (m.role === 'assistant' && m.content)) lines.push(`**${m.role === 'user' ? '用户' : '助手'}**：${(m.content || '').replace(/\n+/g, '\n\n')}`, '') } }
      const out = join(dir, `huangquan-history-${stamp}.md`)
      fs.writeFileSync(out, lines.join('\n'), 'utf-8')
      return out
    } catch (e: unknown) { return 'E:' + ((e instanceof Error ? e.message : String(e)) || String(e)) }
  })
}

export interface SessionHit { sid: string; title: string; role: string; snippet: string; ts: number }

// ─── FTS5-lite 全文索引(v0.3.3 存储加固) ─────────────────
// 无原生依赖的轻量倒排索引: 英文单词 + 中文 bigram, 会话保存时增量更新, 搜索不再全量扫 JSON。
interface IndexDoc {
  key: string
  sid: string
  title: string
  role: string
  text: string
  ts: number
  terms: string[]
}
let indexCache: IndexDoc[] | null = null
let indexDirty = false
let indexTimer: NodeJS.Timeout | null = null
let idxPath = ''

function saveIndexNow(): void {
  if (!indexDirty || !idxPath) return
  try { writeFileAtomic(idxPath, JSON.stringify({ version: 1, docs: indexCache || [] })) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  indexDirty = false
}

function scheduleIndexSave(): void {
  indexDirty = true
  if (indexTimer) return
  indexTimer = setTimeout(() => { indexTimer = null; try { saveIndexNow() } catch { /* 忽略 */ } }, 1500)
}

function loadIndex(indexPath: string, sessionsDir?: string): void {
  idxPath = indexPath
  try {
    if (fs.existsSync(indexPath)) {
      const d = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
      indexCache = Array.isArray(d?.docs) ? d.docs : []
      return
    }
  } catch { /* 损坏则重建 */ }
  indexCache = []
  if (sessionsDir && fs.existsSync(sessionsDir)) rebuildIndexFromDir(sessionsDir)
}

function rebuildIndexFromDir(sessionsDir: string): void {
  try {
    const docs: IndexDoc[] = []
    for (const f of fs.readdirSync(sessionsDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const s = JSON.parse(fs.readFileSync(join(sessionsDir, f), 'utf-8'))
        docs.push(...docsForSession(s))
      } catch { /* 跳过损坏会话 */ }
    }
    indexCache = docs
    indexDirty = true
    saveIndexNow()
  } catch { /* 忽略 */ }
}

function updateIndexForSession(s: { id?: string; title?: string; messages?: { role?: string; content?: unknown; timestamp?: number }[] }, indexPath: string): void {
  idxPath = indexPath
  if (!indexCache) loadIndex(indexPath)
  indexCache = mergeIndexIncremental(indexCache || [], s)
  scheduleIndexSave()
}

function searchSessionsIndex(query: string, limit = 5): SessionHit[] {
  const qterms = tokenizeSearch(query)
  if (!qterms.length) return []
  const docs = indexCache || []
  const scored: { doc: IndexDoc; score: number }[] = []
  for (const d of docs) {
    let score = 0
    for (const t of qterms) if (d.terms.includes(t)) score += /^[a-z0-9]/.test(t) ? 1 : 2
    if (score > 0) scored.push({ doc: d, score })
  }
  scored.sort((a, b) => b.score - a.score || b.doc.ts - a.doc.ts)
  return scored.slice(0, Math.max(1, Math.min(20, Number(limit) || 5))).map(x => {
    const lower = x.doc.text.toLowerCase()
    const idx = qterms.map(t => lower.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0]
    const from = idx >= 0 ? Math.max(0, idx - 30) : 0
    return { sid: x.doc.sid, title: x.doc.title, role: x.doc.role, snippet: x.doc.text.slice(from, from + 120), ts: x.doc.ts }
  })
}

export function searchSessionsInDir(dir: string, query: string, limit = 5): SessionHit[] {
  const q = String(query || '').toLowerCase().trim()
  if (!q || q.length < 2) return []
  const hits: SessionHit[] = []
  let files: string[] = []
  try { files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [] } catch { return [] }
  for (const f of files) {
    let s: { id?: string; title?: string; messages?: { role?: string; content?: unknown; timestamp?: number }[] }
    try {
      const p = join(dir, f)
      const st = fs.statSync(p)
      if (st.size > 5 * 1024 * 1024) continue // 超大会话跳过, 防阻塞
      s = JSON.parse(fs.readFileSync(p, 'utf-8'))
    } catch { continue }
    for (const m of s.messages || []) {
      if (m.role !== 'user' && m.role !== 'assistant') continue
      const text = typeof m.content === 'string' ? m.content : ''
      if (!text) continue
      const idx = text.toLowerCase().indexOf(q)
      if (idx < 0) continue
      hits.push({
        sid: s.id || f.replace(/\.json$/, ''),
        title: String(s.title || '对话'),
        role: m.role || '',
        snippet: text.slice(Math.max(0, idx - 30), idx + q.length + 60).replace(/\s+/g, ' '),
        ts: Number(m.timestamp) || 0,
      })
      if (hits.length >= limit * 3) break
    }
  }
  hits.sort((a, b) => b.ts - a.ts)
  return hits.slice(0, limit)
}
