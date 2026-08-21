// KnowledgeView.tsx —— 藏书阁（状态编排；导入/检索/列表/问答已拆至子组件）
import React, { useEffect, useState, useCallback } from 'react'
import { errMsg } from '../utils/safe'
import { ScrollMark } from './themed-icons'
import { DocMeta, SearchResult, DOC_TAG, SUPPORTED_FORMATS, baseName, parentDir } from './knowledge-utils'
import { S } from './knowledge-styles'
import { KnowledgeImportBar } from './KnowledgeImportBar'
import { KnowledgeSearchBar } from './KnowledgeSearchBar'
import { KnowledgeDocList } from './KnowledgeDocList'
import { KnowledgeQaPanel } from './KnowledgeQaPanel'

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

  // 加载卷宗列表：从记忆 facts 中筛出 [doc] 前缀的元数据并解析
  const loadDocs = useCallback(async () => {
    try {
      const mem = await window.huangquan.memory.load()
      const docFacts = mem.facts.filter((f) => f.startsWith(DOC_TAG))
      const parsed: DocMeta[] = []
      for (const f of docFacts) {
        try {
          const d = JSON.parse(f.slice(DOC_TAG.length))
          if (d && typeof d.name === 'string') parsed.push(d as DocMeta)
        } catch (e) { console.debug('[swallow]', e) }
      }
      setDocs(parsed)
      const last =
        parsed.length > 0
          ? new Date(Math.max(...parsed.map((d) => d.importedAt))).toLocaleString('zh-CN')
          : '暂无'
      setStats({ totalDocs: parsed.length, lastImport: last })
    } catch (e) { console.debug('[swallow]', e) }
  }, [])

  useEffect(() => {
    loadDocs()
  }, [loadDocs])

  // 卷宗录入：选择文件 → 校验格式 → 交给主进程分块入向量库 → 记录元数据
  const handleImport = async () => {
    setImportMsg('')
    let path: string | null = null
    try {
      path = await window.huangquan.computer.selectFile()
    } catch {
    setImportMsg('[X] 文件选择器不可用')
      return
    }
    if (!path) return

    const name = baseName(path)
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
    if (!SUPPORTED_FORMATS.includes(ext)) {
    setImportMsg(`△ 不支持的格式: ${ext}（支持 ${SUPPORTED_FORMATS.join(', ')}）`)
      return
    }

    setImporting(true)
    setImportMsg(`正在录入 ${name} …`)

    try {
      const api = window.huangquan.memory
      if (typeof api.importFile !== 'function') {
    setImportMsg('[X] 卷宗录入接口不可用（请确认后端已开启检索能力）')
        setImporting(false)
        return
      }

      const ok = await api.importFile(path)
      if (ok) {
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
          } catch (e) { console.debug('[swallow]', e) }
        }

        const doc: DocMeta = { name, path, importedAt: Date.now(), size }
        const mem = await window.huangquan.memory.load()
        mem.facts.push(`${DOC_TAG}${JSON.stringify(doc)}`)
        await window.huangquan.memory.save(mem)

    setImportMsg(`[OK] ${name} 录入成功`)
        await loadDocs()
        setTimeout(() => setImportMsg(''), 3000)
      } else {
    setImportMsg(`[X] ${name} 录入失败`)
      }
    } catch (e: unknown) {
    setImportMsg(`[X] 错误: ${errMsg(e)}`)
    } finally {
      setImporting(false)
    }
  }

  // 删除卷宗：从记忆 facts 中移除对应元数据
  const handleDelete = async (idx: number) => {
    const doc = docs[idx]
    if (!doc) return
    try {
      const mem = await window.huangquan.memory.load()
      const target = `${DOC_TAG}${JSON.stringify(doc)}`
      mem.facts = mem.facts.filter((f) => f !== target)
      await window.huangquan.memory.save(mem)
      await loadDocs()
    } catch (e) { console.debug('[swallow]', e) }
  }

  // 寻章检索：调主进程语义搜索，返回相关正文块
  const handleSearch = async () => {
    const q = searchQ.trim()
    if (!q) return
    setSearching(true)
    setResults([])
    try {
      const api = window.huangquan.memory
      if (typeof api.search !== 'function') {
    setResults([{ content: '[X] memory.search 不可用', score: 0 }])
        setSearching(false)
        return
      }
      const hits: SearchResult[] = await api.search(q)
      setResults(hits || [])
    } catch (e: unknown) {
    setResults([{ content: `[X] 寻章出错: ${errMsg(e)}`, score: 0 }])
    } finally {
      setSearching(false)
    }
  }

  // 典籍问答：检索 top5 片段拼成上下文展示
  const handleQa = async () => {
    const q = qaQ.trim()
    if (!q) return
    setQaLoading(true)
    setQaA('')
    try {
      const api = window.huangquan.memory
      if (typeof api.search !== 'function') {
    setQaA('[X] 寻章检索不可用，无法组织回答。')
        setQaLoading(false)
        return
      }

      const hits: SearchResult[] = await api.search(q)
      if (!hits || hits.length === 0) {
        setQaA('藏书阁中未找到相关内容。请先录入卷宗。')
        setQaLoading(false)
        return
      }

      const topHits = hits.slice(0, 5)
      const context = topHits
        .map((h, i) => `[来源 ${i + 1} · 相关度 ${(h.score * 100).toFixed(0)}%]\n${h.content}`)
        .join('\n\n---\n\n')

      setQaA(
        `**基于藏书阁的参考回答**\n\n` +
          `**问题：** ${q}\n\n` +
          `**检索到 ${hits.length} 个相关片段，取前 ${topHits.length} 条：**\n\n` +
          context +
          `\n\n---\n*提示：可将上述检索结果交给对话模型，获得更准确的回答*`
      )
    } catch (e: unknown) {
    setQaA(`[X] 回答出错: ${errMsg(e)}`)
    } finally {
      setQaLoading(false)
    }
  }

  return (
    <div style={S.root}>
      {/* header */}
      <div style={S.header}>
        <div style={S.headerTitle}>
          <span style={S.headerIcon}><ScrollMark size={24} /></span>
          <div>
  <h1 style={S.headerH1}>藏书阁</h1>
            <span style={S.headerSub}>私人典籍 · 寻章摘句</span>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>支持 txt / md / json / csv，录入后可在对话中检索引用</div>
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
        <KnowledgeImportBar importing={importing} importMsg={importMsg} onImport={handleImport} />
        <KnowledgeSearchBar q={searchQ} results={results} searching={searching} onChange={setSearchQ} onSearch={handleSearch} />
        <KnowledgeDocList docs={docs} onDelete={handleDelete} />
        <KnowledgeQaPanel q={qaQ} a={qaA} loading={qaLoading} onChange={setQaQ} onAsk={handleQa} />
      </div>

      {/* keyframe for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
