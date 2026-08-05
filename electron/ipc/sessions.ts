// electron/ipc/sessions.ts —— 会话域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'

// 会话 id 白名单校验 —— 修复路径穿越(id 含 ../ 可读写任意 .json)
const SAFE_ID = /^[0-9a-zA-Z-]{1,64}$/

export function registerSessionIpc(deps: {
  sessionsDir: string
  userDataPath: string
  sessionMeta: Map<string, { title?: string; messageCount?: number; updatedAt?: string }>
  buildSessionMeta: () => void
  safeClone: (obj: unknown, seen?: WeakSet<object>) => unknown
}): void {
  const { sessionsDir, userDataPath, sessionMeta, buildSessionMeta, safeClone } = deps

  // ─── 会话全文关键词搜索(轻量版; 0.4.0 升级 FTS5 后端) ───
  ipcMain.handle('sessions:search', (_e, query: string, limit?: number) => searchSessionsInDir(sessionsDir, query, limit))

  // v0.3.1 E: 每会话串行保存队列 + meta 与写盘绑定(FIX-4/5/7)
  const saveQueues = new Map<string, Promise<void>>()
  const pendingSaves = new Map<string, string>()   // id → 最新 content(防堆积合并)
  const enqueueSave = (id: string, content: string): void => {
    pendingSaves.set(id, content)
    if (saveQueues.has(id)) return               // 已有队列在跑, 合并等待
    const run = async () => {
      while (pendingSaves.has(id)) {
        const latest = pendingSaves.get(id)!; pendingSaves.delete(id)
        try {
          await fs.promises.writeFile(join(sessionsDir, id + '.json'), latest, 'utf-8')
          let mt: { title?: string; messageCount?: number } = {}
          try { mt = JSON.parse(latest) } catch { /* 忽略 */ }
          sessionMeta.set(id, {
            title: String(mt.title || '新对话').slice(0, 60), messageCount: (mt.messageCount || 0) as number,
            updatedAt: new Date().toISOString(),
          })                                       // FIX-5: meta 仅在写盘成功后更新
        } catch (e) {
          console.error('[SESSIONS] save error:', e instanceof Error ? e.message : String(e))
          // 写盘失败: meta 不更新(防幽灵会话)
        }
      }
      saveQueues.delete(id)
    }
    saveQueues.set(id, run())
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
      return [...sessionMeta.entries()].map(([id, m]) => ({ id, title: m.title, messageCount: m.messageCount, updatedAt: m.updatedAt }))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    } catch { return [] }
  })
  ipcMain.handle('sessions:load', (_e, id: string) => {
    // v0.3.1 FIX-7: 加载失败可感知(loadError 标记; 渲染层不覆盖内存版本)
    if (!SAFE_ID.test(String(id || ''))) return { id, title: '新对话', messages: [], loadError: 'invalid-id' }
    const p = join(sessionsDir, id + '.json')
    try {
      if (!fs.existsSync(p)) { sessionMeta.delete(id); return { id, title: '新对话', messages: [], loadError: 'missing' } }
      return JSON.parse(fs.readFileSync(p, 'utf-8'))
    } catch (e) {
      console.error('[SESSIONS] load error:', id, e instanceof Error ? e.message : String(e))
      return { id, title: '（加载失败）', messages: [], loadError: 'corrupt' }
    }
  })
  ipcMain.handle('sessions:save', (_e, s) => {
    // 安全序列化防止循环引用导致 IPC 克隆报错
    const id = String(s?.id || '')
    if (!SAFE_ID.test(id)) return false
    const safe = safeClone(s) as { id?: string; title?: string; messages?: { length?: number } }
    const content = JSON.stringify({ ...safe, updatedAt: new Date().toISOString() })
    enqueueSave(id, content)
    return true
  })
  ipcMain.handle('sessions:delete', (_e, id: string) => { try { if (!SAFE_ID.test(String(id || ''))) return false; fs.unlinkSync(join(sessionsDir, id + '.json')); sessionMeta.delete(id) } catch (e) { /* ok */ console.debug('[swallow]', e) }; return true })
  // 清空全部对话历史
  ipcMain.handle('sessions:clearAll', () => {
    try {
      if (!fs.existsSync(sessionsDir)) return true
      for (const f of fs.readdirSync(sessionsDir)) { if (f.endsWith('.json')) fs.unlinkSync(join(sessionsDir, f)) }
      sessionMeta.clear()
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
        for (const s of all) { lines.push(`=== ${s.title || '对话'} ===`); for (const m of s.messages || []) { if (m.role === 'user' || (m.role === 'assistant' && m.content)) lines.push(`[${m.role === 'user' ? '用户' : '黄泉'}] ${(m.content || '').replace(/\n+/g, ' ')}`) } lines.push('') }
        const out = join(dir, `huangquan-history-${stamp}.txt`)
        fs.writeFileSync(out, lines.join('\n'), 'utf-8')
        return out
      }
      // md
      const lines: string[] = ['# 黄泉Agent 对话历史', '']
      for (const s of all) { lines.push(`## ${s.title || '对话'}`, ''); for (const m of s.messages || []) { if (m.role === 'user' || (m.role === 'assistant' && m.content)) lines.push(`**${m.role === 'user' ? '用户' : '黄泉'}**：${(m.content || '').replace(/\n+/g, '\n\n')}`, '') } }
      const out = join(dir, `huangquan-history-${stamp}.md`)
      fs.writeFileSync(out, lines.join('\n'), 'utf-8')
      return out
    } catch (e: unknown) { return 'E:' + ((e instanceof Error ? e.message : String(e)) || String(e)) }
  })
}

export interface SessionHit { sid: string; title: string; role: string; snippet: string; ts: number }
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
