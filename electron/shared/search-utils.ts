// electron/shared/search-utils.ts —— 会话搜索索引纯函数（v0.3.6 P2-7 dedup）
// renderer/main 共用；约束：禁止 import electron API / zustand / fs
// 原实现位于 electron/ipc/sessions.ts 模块内部, 抽为共享纯函数后 sessions.ts 与单测直接复用

export interface IndexDoc {
  key: string
  sid: string
  title: string
  role: string
  text: string
  ts: number
  terms: string[]
}

// 分词: 英文单词(>1 字符) + 中文 bigram
export function tokenizeSearch(text: string): string[] {
  const t = String(text || '').toLowerCase()
  const latin = (t.match(/[a-z0-9_]+/g) || []).filter(w => w.length > 1)
  const cn = t.match(/[\u4e00-\u9fff]/g) || []
  const bigrams: string[] = []
  for (let i = 0; i + 1 < cn.length; i++) bigrams.push(cn[i] + cn[i + 1])
  return [...latin, ...bigrams]
}

// 去重 + 限长(单文档最多 60 个检索词)
export function indexTerms(text: string): string[] {
  return [...new Set(tokenizeSearch(text))].slice(0, 60)
}

// 会话 → 索引文档(最多 300 条 user/assistant 消息, 每条内容取前 300 字符)
export function docsForSession(s: { id?: string; title?: string; messages?: { role?: string; content?: unknown; timestamp?: number }[] }): IndexDoc[] {
  const out: IndexDoc[] = []
  const msgs = s.messages || []
  for (let i = 0; i < msgs.length && out.length < 300; i++) {
    const m = msgs[i]
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (typeof m.content !== 'string' || m.content.trim().length < 2) continue
    const text = m.content.trim().slice(0, 300)
    const terms = indexTerms(text)
    if (!terms.length) continue
    out.push({ key: String(s.id) + ':' + (m.timestamp || i) + ':' + i, sid: String(s.id), title: String(s.title || '对话'), role: m.role, text, ts: Number(m.timestamp) || 0, terms })
  }
  return out
}

// v0.3.6 P2-7: 增量合并 —— 已索引且内容未变的消息复用旧文档(key 命中), 只对新增/变更消息重新分词
// 语义与全量重建等价(同 key 同 text 的旧文档原样保留), 但避免每次保存全量重新分词
export function mergeIndexIncremental(indexCache: IndexDoc[], s: { id?: string; title?: string; messages?: { role?: string; content?: unknown; timestamp?: number }[] }): IndexDoc[] {
  const oldDocs = (indexCache || []).filter(d => d.sid === s.id)
  const oldByKey = new Map(oldDocs.map(d => [d.key, d]))
  const rest = (indexCache || []).filter(d => d.sid !== s.id)
  const fresh: IndexDoc[] = []
  const msgs = s.messages || []
  for (let i = 0; i < msgs.length && fresh.length < 300; i++) {
    const m = msgs[i]
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (typeof m.content !== 'string' || m.content.trim().length < 2) continue
    const text = m.content.trim().slice(0, 300)
    const key = String(s.id) + ':' + (m.timestamp || i) + ':' + i
    const old = oldByKey.get(key)
    if (old && old.text === text) { fresh.push(old); continue }  // 未变: 复用, 不重新分词
    const terms = indexTerms(text)
    if (!terms.length) continue
    fresh.push({ key, sid: String(s.id), title: String(s.title || '对话'), role: m.role, text, ts: Number(m.timestamp) || 0, terms })
  }
  return [...rest, ...fresh]
}
