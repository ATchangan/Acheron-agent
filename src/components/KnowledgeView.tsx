import React, { useEffect, useState, useCallback } from 'react'
import { errMsg } from '../utils/safe'

/* ─── types ─── */

interface DocMeta {
  name: string
  path: string
  importedAt: number
  size: number
}

interface SearchResult {
  content: string
  score: number
}

const SUPPORTED_FORMATS = ['.txt', '.md', '.json', '.csv']
const DOC_TAG = '[doc]'

/* ─── helpers ─── */

function fmtSize(bytes: number): string {
  if (bytes <= 0) return '未知'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function baseName(p: string): string {
  return p.split(/[/\\]/).pop() || p
}

function parentDir(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/'
  const idx = p.lastIndexOf(sep)
  return idx > 0 ? p.slice(0, idx) : '.'
}

/* ─── inline styles ─── */

const S = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 24px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    gap: '12px',
  } as React.CSSProperties,
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  headerIcon: {
    fontSize: '24px',
  },
  headerH1: {
    fontSize: '18px',
    fontWeight: 600 as const,
    color: 'var(--accent)',
  },
  headerSub: {
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
  statsRow: {
    display: 'flex',
    gap: '16px',
  },
  statBadge: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '4px 14px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '11px',
    color: 'var(--text-secondary)',
  },
  statVal: {
    fontSize: '16px',
    fontWeight: 700 as const,
    color: 'var(--accent-purple)',
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px 24px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  section: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '16px',
  },
  sectionTitle: {
    fontSize: '12px',
    fontWeight: 600 as const,
    color: 'var(--accent)',
    marginBottom: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  sectionIcon: {
    fontSize: '14px',
  },
  /* import */
  importRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap' as const,
  },
  formatHint: {
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
  importMsg: {
    fontSize: '11px',
    marginTop: '6px',
    minHeight: '16px',
  },
  /* search */
  searchRow: {
    display: 'flex',
    gap: '8px',
  },
  searchInput: {
    flex: 1,
    padding: '7px 10px',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    outline: 'none',
    fontSize: '12px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
  },
  searchBtn: {
    padding: '7px 14px',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600 as const,
  },
  results: {
    marginTop: '10px',
    maxHeight: '300px',
    overflowY: 'auto' as const,
  },
  resultItem: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '10px 12px',
    marginBottom: '6px',
  },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
    fontSize: '11px',
  },
  resultScore: {
    color: 'var(--accent-green)',
    fontWeight: 600 as const,
  },
  resultContent: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: '120px',
    overflowY: 'auto' as const,
  },
  /* doc library */
  docList: {
    maxHeight: '220px',
    overflowY: 'auto' as const,
  },
  docItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    borderRadius: 'var(--radius)',
    borderBottom: '1px solid var(--border)',
    transition: 'background .12s',
  },
  docInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
    flex: 1,
    minWidth: 0,
  },
  docName: {
    fontSize: '12px',
    color: 'var(--text-primary)',
    fontWeight: 500 as const,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis' as const,
  },
  docMeta: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    display: 'flex',
    gap: '10px',
  },
  docDel: {
    background: 'none',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: '11px',
    flexShrink: 0,
  },
  emptyHint: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    padding: '20px 0',
    textAlign: 'center' as const,
  },
  /* Q&A */
  qaInputRow: {
    display: 'flex',
    gap: '8px',
  },
  qaInput: {
    flex: 1,
    padding: '7px 10px',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    outline: 'none',
    fontSize: '12px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
  },
  qaBtn: {
    padding: '7px 14px',
    background: 'var(--accent-purple)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600 as const,
  },
  qaContextBox: {
    marginTop: '10px',
    padding: '10px 12px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    maxHeight: '200px',
    overflowY: 'auto' as const,
    fontSize: '12px',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
  },
  qaLabel: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    marginBottom: '6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '.5px',
  },
  spinner: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    border: '2px solid var(--border)',
    borderTopColor: 'var(--accent)',
    borderRadius: '50%',
    animation: 'spin .6s linear infinite',
  } as React.CSSProperties,
}

/* ─── component ─── */

export default function KnowledgeView() {
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [searchQ, setSearchQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [importing, setImporting] = useState(false)

  const [qaQ, setQaQ] = useState('')
  const [qaA, setQaA] = useState('')
  const [qaLoading, setQaLoading] = useState(false)

  const [stats, setStats] = useState({ totalDocs: 0, lastImport: '' })

  /* ── load docs from memory ── */

  const loadDocs = useCallback(async () => {
    try {
      const mem = await window.huangquan.memory.load()
      const docFacts = mem.facts.filter((f) => f.startsWith(DOC_TAG))
      const parsed: DocMeta[] = []
      for (const f of docFacts) {
        try {
          const d = JSON.parse(f.slice(DOC_TAG.length))
          if (d && typeof d.name === 'string') parsed.push(d as DocMeta)
        } catch (e) { /* skip corrupt entries */ console.debug('[swallow]', e) }
      }
      setDocs(parsed)
      const last =
        parsed.length > 0
          ? new Date(Math.max(...parsed.map((d) => d.importedAt))).toLocaleString('zh-CN')
          : '暂无'
      setStats({ totalDocs: parsed.length, lastImport: last })
    } catch (e) { /* ignore load errors */ console.debug('[swallow]', e) }
  }, [])

  useEffect(() => {
    loadDocs()
  }, [loadDocs])

  /* ── import ── */

  const handleImport = async () => {
    setImportMsg('')
    let path: string | null = null
    try {
      path = await window.huangquan.computer.selectFile()
    } catch {
      setImportMsg('❌ 文件选择器不可用')
      return
    }
    if (!path) return

    const name = baseName(path)
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
    if (!SUPPORTED_FORMATS.includes(ext)) {
      setImportMsg(`⚠️ 不支持的格式: ${ext}（支持 ${SUPPORTED_FORMATS.join(', ')}）`)
      return
    }

    setImporting(true)
      setImportMsg(`⏳ 正在录入 ${name} …`)

    try {
      // memory.importFile is a runtime extension
      const api = window.huangquan.memory
      if (typeof api.importFile !== 'function') {
        setImportMsg('❌ 卷宗录入接口不可用（请确认后端已开启检索能力）')
        setImporting(false)
        return
      }

      const ok = await api.importFile(path)
      if (ok) {
        // determine file size – try readDir on parent, fallback to content length
        let size = 0
        try {
          const parent = parentDir(path)
          const items = await window.huangquan.computer.readDir(parent)
          const match = items.find((i) => i.name === name)
          if (match && !match.isDirectory) size = match.size
        } catch {
          try {
            const content = await window.huangquan.computer.readFile(path)
            size = new Blob([content]).size
          } catch (e) { /* keep 0 */ console.debug('[swallow]', e) }
        }

        const doc: DocMeta = { name, path, importedAt: Date.now(), size }

        const mem = await window.huangquan.memory.load()
        mem.facts.push(`${DOC_TAG}${JSON.stringify(doc)}`)
        await window.huangquan.memory.save(mem)

        setImportMsg(`✅ ${name} 录入成功`)
        await loadDocs()
        setTimeout(() => setImportMsg(''), 3000)
      } else {
        setImportMsg(`❌ ${name} 录入失败`)
      }
    } catch (e: unknown) {
      setImportMsg(`❌ 错误: ${errMsg(e)}`)
    } finally {
      setImporting(false)
    }
  }

  /* ── delete ── */

  const handleDelete = async (idx: number) => {
    const doc = docs[idx]
    if (!doc) return
    try {
      const mem = await window.huangquan.memory.load()
      const target = `${DOC_TAG}${JSON.stringify(doc)}`
      mem.facts = mem.facts.filter((f) => f !== target)
      await window.huangquan.memory.save(mem)
      await loadDocs()
    } catch (e) { /* ignore */ console.debug('[swallow]', e) }
  }

  /* ── search ── */

  const handleSearch = async () => {
    const q = searchQ.trim()
    if (!q) return
    setSearching(true)
    setResults([])
    try {
      const api = window.huangquan.memory
      if (typeof api.search !== 'function') {
        setResults([{ content: '❌ memory.search 不可用', score: 0 }])
        setSearching(false)
        return
      }
      const hits: SearchResult[] = await api.search(q)
      setResults(hits || [])
    } catch (e: unknown) {
    setResults([{ content: `❌ 寻章出错: ${errMsg(e)}`, score: 0 }])
    } finally {
      setSearching(false)
    }
  }

  /* ── Q&A ── */

  const handleQa = async () => {
    const q = qaQ.trim()
    if (!q) return
    setQaLoading(true)
    setQaA('')
    try {
      const api = window.huangquan.memory
      if (typeof api.search !== 'function') {
      setQaA('❌ 寻章检索不可用，无法组织回答。')
        setQaLoading(false)
        return
      }

      // 1. semantic search for relevant chunks
      const hits: SearchResult[] = await api.search(q)
      if (!hits || hits.length === 0) {
        setQaA('📭 藏书阁中未找到相关内容。请先录入卷宗。')
        setQaLoading(false)
        return
      }

      // 2. Build a context string from top results
      const topHits = hits.slice(0, 5)
      const context = topHits
        .map((h, i) => `[来源 ${i + 1} · 相关度 ${(h.score * 100).toFixed(0)}%]\n${h.content}`)
        .join('\n\n---\n\n')

      // 3. Format the answer as context + question
      setQaA(
        `📖 **基于藏书阁的参考回答**\n\n` +
          `**问题：** ${q}\n\n` +
          `**检索到 ${hits.length} 个相关片段，取前 ${topHits.length} 条：**\n\n` +
          context +
          `\n\n---\n💡 *提示：可将上述检索结果交给对话模型，获得更精确的回答*`
      )
    } catch (e: unknown) {
      setQaA(`❌ 回答出错: ${errMsg(e)}`)
    } finally {
      setQaLoading(false)
    }
  }

  /* ── render ── */

  return (
    <div style={S.root}>
      {/* header */}
      <div style={S.header}>
        <div style={S.headerTitle}>
          <span style={S.headerIcon}>📜</span>
          <div>
            <h1 style={S.headerH1}>◇ 藏书阁</h1>
            <span style={S.headerSub}>私人典籍 · 寻章摘句</span>
          </div>
        </div>
        <div style={S.statsRow}>
          <div style={S.statBadge}>
            <span style={S.statVal}>{stats.totalDocs}</span>
            <span>卷宗</span>
          </div>
          <div style={S.statBadge}>
            <span style={S.statVal}>{stats.lastImport === '暂无' ? '—' : stats.lastImport.split(' ')[0]}</span>
            <span>最近录入</span>
          </div>
        </div>
      </div>

      {/* body */}
      <div style={S.body}>
        {/* ── 1. Import ── */}
        <div style={S.section}>
          <div style={S.sectionTitle}>
            <span style={S.sectionIcon}>📥</span>卷宗录入
          </div>
          <div style={S.importRow}>
            <button
              className="btn-primary"
              onClick={handleImport}
              disabled={importing}
              style={{ opacity: importing ? 0.6 : 1 }}
            >
              {importing ? '录入中…' : '选择文件'}
            </button>
            <span style={S.formatHint}>
              支持格式：{SUPPORTED_FORMATS.join('、')}
            </span>
          </div>
          {importMsg && (
            <div
              style={{
                ...S.importMsg,
                color: importMsg.startsWith('✅')
                  ? 'var(--accent-green)'
                  : importMsg.startsWith('❌') || importMsg.startsWith('⚠️')
                  ? 'var(--danger)'
                  : 'var(--accent)',
              }}
            >
              {importing && <span style={S.spinner} />} {importMsg}
            </div>
          )}
        </div>

        {/* ── 2. Search ── */}
        <div style={S.section}>
          <div style={S.sectionTitle}>
            <span style={S.sectionIcon}>🔍</span>寻章检索
          </div>
          <div style={S.searchRow}>
            <input
              style={S.searchInput}
              placeholder="输入要寻章的内容…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button
              style={S.searchBtn}
              onClick={handleSearch}
              disabled={searching || !searchQ.trim()}
            >
              {searching ? '寻章中…' : '寻章'}
            </button>
          </div>
          {results.length > 0 && (
            <div style={S.results}>
              {results.map((r, i) => (
                <div key={i} style={S.resultItem}>
                  <div style={S.resultHeader}>
                    <span style={{ color: 'var(--text-muted)' }}>结果 {i + 1}</span>
                    <span style={S.resultScore}>契合度: {(r.score * 100).toFixed(0)}%</span>
                  </div>
                  <div style={S.resultContent}>
                    {r.content.slice(0, 600)}
                    {r.content.length > 600 ? '...' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
          {searching && <div className="empty-hint" style={{ textAlign: 'center' }}>寻章中…</div>}
        </div>

        {/* ── 3. Document Library ── */}
        <div style={S.section}>
          <div style={S.sectionTitle}>
            <span style={S.sectionIcon}>📋</span>卷宗库
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>
              （{docs.length} 份卷宗）
            </span>
          </div>
          {docs.length === 0 ? (
            <div style={S.emptyHint}>暂无卷宗，请先录入文件。</div>
          ) : (
            <div style={S.docList}>
              {docs.map((d, i) => (
                <div
                  key={`${d.path}-${d.importedAt}`}
                  style={S.docItem}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  <div style={S.docInfo}>
                    <span style={S.docName} title={d.path}>
                      📄 {d.name}
                    </span>
                    <span style={S.docMeta}>
                      <span>{new Date(d.importedAt).toLocaleString('zh-CN')}</span>
                      <span>{fmtSize(d.size)}</span>
                    </span>
                  </div>
                  <button
                    className="btn-icon btn-danger"
                    onClick={() => handleDelete(i)}
                    title="删除卷宗"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 4. Q&A ── */}
        <div style={S.section}>
          <div style={S.sectionTitle}>
            <span style={S.sectionIcon}>💬</span>典籍问答
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>
              依据卷宗作答
            </span>
          </div>
          <div style={S.qaInputRow}>
            <input
              style={S.qaInput}
              placeholder="输入问题…"
              value={qaQ}
              onChange={(e) => setQaQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQa()}
            />
            <button
              style={S.qaBtn}
              onClick={handleQa}
              disabled={qaLoading || !qaQ.trim()}
            >
              {qaLoading ? '寻章中…' : '发问'}
            </button>
          </div>
          {qaA && (
            <div style={S.qaContextBox}>
              <div style={S.qaLabel}>📖 参考回答</div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{qaA}</div>
            </div>
          )}
        </div>
      </div>

      {/* keyframe for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
