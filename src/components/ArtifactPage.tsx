// ArtifactPage.tsx —— v0.4.4 产物（对齐参考: 筛选 tab + 三列表格 + 分页）
// 扫描全部会话的工具调用：write/edit/apply_patch → 文件产物；web 相关 → 链接产物。
// 表格三列：标题/名称 | 位置 | 来源会话。支持 搜索 + 类型筛选 + 分页。
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, FileText, Link2, Search } from 'lucide-react'
import { useChatStore } from '../store/chat'

interface Artifact {
  type: 'file' | 'link'
  name: string
  location: string
  sessionId: string
  sessionTitle: string
  ts: number
}

const PAGE_SIZE = 50
const EDIT_TOOLS = new Set(['write', 'edit', 'apply_patch'])
const URL_RE = /https?:\/\/[^\s<>"'）)]+/g

export default function ArtifactPage() {
  const sessions = useChatStore(s => s.sessions)
  const [filter, setFilter] = useState<'all' | 'file' | 'link'>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => { const t = setInterval(() => setRefresh(x => x + 1), 30000); return () => clearInterval(t) }, [])

  const artifacts = useMemo<Artifact[]>(() => {
    void refresh
    const out: Artifact[] = []
    const seen = new Set<string>()
    for (const sess of sessions) {
      const st: Artifact['type'][] = []
      for (const m of sess.messages || []) {
        // 文件产物
        for (const tc of (m.tool_calls || [])) {
          const name = (tc.function?.name || '').toLowerCase()
          if (!EDIT_TOOLS.has(name)) continue
          try {
            const args = JSON.parse(tc.function?.arguments || '{}') as Record<string, unknown>
            const path = typeof args.path === 'string' ? args.path : typeof (args as { file_path?: unknown }).file_path === 'string' ? (args as { file_path: string }).file_path : ''
            if (path && !seen.has(path)) { seen.add(path); out.push({ type: 'file', name: path.split(/[\\/]/).pop() || path, location: path, sessionId: sess.id, sessionTitle: sess.title || '（无标题）', ts: m.timestamp }) }
          } catch { /* 忽略 */ }
        }
        // 链接产物
        const content = String(m.content || '')
        const urls = content.match(URL_RE)
        if (urls) {
          for (const u of urls.slice(0, 5)) {
            const clean = u.replace(/[.,;:!?]+$/, '')
            if (!seen.has(clean)) { seen.add(clean); out.push({ type: 'link', name: clean.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || clean, location: clean, sessionId: sess.id, sessionTitle: sess.title || '（无标题）', ts: m.timestamp }) }
          }
        }
      }
      void st
    }
    return out.sort((a, b) => b.ts - a.ts)
  }, [sessions, refresh])

  const counts = { all: artifacts.length, file: artifacts.filter(a => a.type === 'file').length, link: artifacts.filter(a => a.type === 'link').length }
  const filtered = artifacts.filter(a => (filter === 'all' || a.type === filter) && (!q.trim() || a.name.toLowerCase().includes(norm(q)) || a.location.toLowerCase().includes(norm(q))))
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const norm = (s: string): string => s.toLowerCase()

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部: 搜索 + 筛选 tab + 刷新 */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px 0' }}>
        <div className="hq-sb-search" style={{ width: 220 }}>
          <Search size={13} />
          <input className="hq-search" placeholder="搜索产物…" value={q} onChange={e => { setQ(e.target.value); setPage(0) }} />
        </div>
        <span style={{ flex: 1 }} />
        {(['all', 'file', 'link'] as const).map(k => (
          <button key={k} type="button" className={'sb-ch-tab' + (filter === k ? ' active' : '')} onClick={() => { setFilter(k); setPage(0) }}>
            {k === 'all' ? '全部' : k === 'file' ? '文件' : '链接'} {counts[k]}
          </button>
        ))}
        <button type="button" className="hq-sb-mini" title="刷新" onClick={() => setRefresh(x => x + 1)}><RefreshCw size={12} /></button>
      </div>

      {/* 表头 */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '6px 20px', fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-soft)' }}>
        <span style={{ width: '35%' }}>标题 / 名称</span>
        <span style={{ flex: 1 }}>位置</span>
        <span style={{ width: '28%', textAlign: 'right' }}>会话</span>
      </div>

      {/* 表格 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px' }}>
        {pageItems.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '40px 0', color: 'var(--text-muted)' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {filter === 'link' ? <Link2 size={20} /> : <FileText size={20} />}
            </div>
            <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)' }}>没有{filter === 'all' ? '' : filter === 'file' ? '文件' : '链接'}产物</span>
          </div>
        ) : pageItems.map((a, i) => (
          <div key={a.location + i} className="aux-row" style={{ padding: '8px 4px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '35%', minWidth: 0, flex: 'none' }}>
              {a.type === 'link' ? <Link2 size={13} style={{ color: 'var(--text-muted)', flex: 'none' }} /> : <FileText size={13} style={{ color: 'var(--text-muted)', flex: 'none' }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontSize: 'calc(var(--ui-font-size) - 1px)' }} title={a.name}>{a.name}</span>
            </span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 2px)' }} title={a.location}>
              {a.type === 'link' ? (
                <a href={a.location} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)', textDecoration: 'none' }} onClick={e => { e.stopPropagation(); window.huangquan.web.openExternal(a.location).catch(() => {}) }}>{a.location}</a>
              ) : a.location}
            </span>
            <span style={{ width: '28%', textAlign: 'right', color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 2px)', flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.sessionTitle} · {a.ts ? new Date(a.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </div>
        ))}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, padding: '6px 20px 10px', fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)' }}>
          <span>{page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filtered.length)} 共 {filtered.length} 条</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="hq-sb-mini" disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ opacity: page === 0 ? .3 : 1 }}>‹ 上一页</button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            const p = Math.max(0, Math.min(totalPages - 5, page - 2)) + i
            if (p >= totalPages) return null
            return <button key={p} type="button" className={'sb-ch-tab' + (p === page ? ' active' : '')} style={{ height: 24, padding: '0 8px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={() => setPage(p)}>{p + 1}</button>
          })}
          <button type="button" className="hq-sb-mini" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ opacity: page >= totalPages - 1 ? .3 : 1 }}>下一页 ›</button>
        </div>
      )}
    </div>
  )
}
