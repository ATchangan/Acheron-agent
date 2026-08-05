import React, { useState, useEffect, useCallback, useRef } from 'react'
import { errMsg } from '../utils/safe'
import type { Lang, HistoryEntry, Template } from './code-data'
import { LANGS, TEMPLATES, detectLang, extForLang, colors } from './code-data'
import { S } from './code-styles'
import { RuneMark, TemplateMark, FolderMark, SaveMark, ClearMark, RunMark, EditMark, OutputMark, HistoryMark, HourglassMark } from './themed-icons'

// v0.3.1 块 K: 代码工坊主组件(数据/样式已拆分, 行为零变化)
export default function CodeView() {
  /* ── state ── */
  const [lang, setLang] = useState<Lang>('python')
  const [code, setCode] = useState('')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [toast, setToast] = useState('')
  const [showHistory, setShowHistory] = useState(true)
  const [memLoaded, setMemLoaded] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const templateBtnRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const lineCount = Math.max(code.split('\n').length, 1)

  /* ── toast helper ── */
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2200)
  }, [])

  /* ── 加载历史 ── */
  const loadHistory = useCallback(async () => {
    try {
      const data = await window.huangquan.memory.load()
      const facts: string[] = data.facts || []
      const histEntries: HistoryEntry[] = []
      for (const fact of facts) {
        if (fact.startsWith('[codehist]')) {
          try {
            const json = fact.slice('[codehist]'.length).trim()
            histEntries.push(JSON.parse(json))
          } catch (e) { /* skip malformed */ console.debug('[swallow]', e) }
        }
      }
      histEntries.sort((a, b) => b.timestamp - a.timestamp)
      setHistory(histEntries.slice(0, 20))
    } catch {
      // memory not available
    } finally {
      setMemLoaded(true)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  /* ── 持久化一条历史 ── */
  const persistHistory = useCallback(async (entry: HistoryEntry) => {
    try {
      const data = await window.huangquan.memory.load()
      const facts: string[] = data.facts || []
      // 移除旧的 [codehist] 条目
      const other = facts.filter(f => !f.startsWith('[codehist]'))
      const histRaws = facts
        .filter(f => f.startsWith('[codehist]'))
        .map(f => {
          try {
            const raw = f.slice('[codehist]'.length).trim()
            return JSON.parse(raw) as HistoryEntry
          } catch { return null }
        })
        .filter(Boolean) as HistoryEntry[]

      // 添加新条目，保留最近 20 条
      histRaws.push(entry)
      histRaws.sort((a, b) => b.timestamp - a.timestamp)
      const kept = histRaws.slice(0, 20)
      const newFacts = [...other, ...kept.map(e => `[codehist] ${JSON.stringify(e)}`)]
      await window.huangquan.memory.save({ facts: newFacts, summaries: data.summaries || [] })
      setHistory(kept)
    } catch {
      // silently fail persistence
    }
  }, [])

  /* ── 清除历史 ── */
  const clearHistory = useCallback(async () => {
    try {
      const data = await window.huangquan.memory.load()
      const facts = (data.facts || []).filter(f => !f.startsWith('[codehist]'))
      await window.huangquan.memory.save({ facts, summaries: data.summaries || [] })
      setHistory([])
    showToast('执行历史已清除')
    } catch {
      showToast('⚠️ 清除失败')
    }
  }, [showToast])

  /* ── 执行代码 ── */
  const handleRun = useCallback(async () => {
    if (!code.trim()) return
    setRunning(true)
    setDuration(null)
    setOutput('')
    const startTime = performance.now()

    try {
      let result = ''
      // 尝试 codebox sandbox，回退到 exec
      const codebox = (window.huangquan.computer.codebox) as
        ((l: string, c: string) => Promise<string>) | undefined
      // 临时文件必须落在执行时的工作目录内, 否则 exec(cwd=工作目录) 找不到相对路径
      const paths = await window.huangquan.getPaths().catch(() => null)
      const baseDir = paths && paths.workDir ? String(paths.workDir).replace(/[\\/]+$/, '') : ''
      const tmp = (name: string) => (baseDir ? baseDir + '\\' + name : name)

      if (lang === 'powershell') {
        // PowerShell: 写入临时文件然后执行
        const psPath = tmp('__huangquan_temp.ps1')
        await window.huangquan.computer.writeFile(psPath, code)
        result = await window.huangquan.computer.exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`)
        await window.huangquan.computer.exec(`del "${psPath}" 2>nul || rm "${psPath}" 2>/dev/null || true`)
      } else if (lang === 'bash') {
        // Bash: 写入临时文件然后执行
        const shPath = tmp('__huangquan_temp.sh')
        await window.huangquan.computer.writeFile(shPath, code)
        result = await window.huangquan.computer.exec(`bash "${shPath}"`)
        await window.huangquan.computer.exec(`rm -f "${shPath}"`)
      } else if ((lang === 'python' || lang === 'javascript') && codebox) {
        // 使用 codebox sandbox
        const langMap: Record<string, string> = {
          python: 'python',
          javascript: 'node',
        }
        result = await codebox(langMap[lang] || lang, code)
      } else {
        // fallback: 写入文件后执行
        const ext = extForLang(lang)
        const tmpPath = tmp('__huangquan_temp' + ext)
        await window.huangquan.computer.writeFile(tmpPath, code)

        const cmdMap: Record<string, string> = {
          python: `python "${tmpPath}"`,
          javascript: `node "${tmpPath}"`,
          typescript: `npx tsx "${tmpPath}"`,
        }
        const cmd = cmdMap[lang]
        if (cmd) {
          result = await window.huangquan.computer.exec(cmd)
        } else {
          result = await window.huangquan.computer.exec(`cat "${tmpPath}"`)
        }
        // 清理
        await window.huangquan.computer.exec(`rm -f "${tmpPath}"`)
      }

      const elapsed = Math.round((performance.now() - startTime))
      setDuration(elapsed)
      setOutput(result || '(无输出)')

      // 保存到历史
      const entry: HistoryEntry = {
        lang,
        code,
        output: result || '(无输出)',
        duration: elapsed,
        timestamp: Date.now(),
      }
      await persistHistory(entry)
    } catch (e: unknown) {
      const elapsed = Math.round((performance.now() - startTime))
      setDuration(elapsed)
      setOutput(`❌ 执行错误:\n${errMsg(e)?.toString?.() || '未知错误'}`)

      const entry: HistoryEntry = {
        lang,
        code,
        output: `❌ ${errMsg(e) || '未知错误'}`,
        duration: elapsed,
        timestamp: Date.now(),
      }
      await persistHistory(entry)
    } finally {
      setRunning(false)
    }
  }, [code, lang, persistHistory])

  /* ── 模板 ── */
  const applyTemplate = useCallback((tpl: Template) => {
    setLang(tpl.lang)
    setCode(tpl.code)
    setOutput('')
    setDuration(null)
    setShowTemplates(false)
    showToast(`已加载模板：${tpl.label}`)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [showToast])

  /* ── 文件操作 ── */
  const handleOpenFile = useCallback(async () => {
    try {
      const path = await window.huangquan.computer.selectFile()
      if (!path) return
      const content = await window.huangquan.computer.readFile(path)
      const detected = detectLang(path)
      if (detected) setLang(detected)
      setCode(content)
      setOutput('')
      setDuration(null)
    showToast(`已打开：${path.split(/[/\\]/).pop()}`)
    } catch (e: unknown) {
      showToast(`⚠️ 打开失败: ${errMsg(e) || '未知错误'}`)
    }
  }, [showToast])

  const handleSaveFile = useCallback(async () => {
    try {
      const ext = extForLang(lang)
      const filename = `huangquan_script${ext}`
      if (!filename) return
      await window.huangquan.computer.writeFile(filename, code)
    showToast(`已保存：${filename}`)
    } catch (e: unknown) {
      showToast(`⚠️ 保存失败: ${errMsg(e) || '未知错误'}`)
    }
  }, [code, lang, showToast])

  /* ── 清空编辑器 ── */
  const handleClear = useCallback(() => {
    setCode('')
    setOutput('')
    setDuration(null)
    showToast('编辑器已清空')
    textareaRef.current?.focus()
  }, [showToast])

  /* ── 从历史加载 ── */
  const loadFromHistory = useCallback((entry: HistoryEntry) => {
    setLang(entry.lang)
    setCode(entry.code)
    setOutput(entry.output)
    setDuration(entry.duration)
    showToast('已加载历史记录')
  }, [showToast])

  /* ── 关闭模板下拉 (点击外部) ── */
  useEffect(() => {
    if (!showTemplates) return
    const handler = (e: MouseEvent) => {
      if (templateBtnRef.current && !templateBtnRef.current.contains(e.target as Node)) {
        setShowTemplates(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTemplates])

  /* ── 键盘快捷键 ── */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl/Cmd + Enter 执行
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleRun()
    }
    // Tab 缩进
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current
      if (!ta) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const before = code.slice(0, start)
      const after = code.slice(end)
      const newCode = before + '  ' + after
      setCode(newCode)
      // 恢复光标位置
      requestAnimationFrame(() => {
        ta.focus()
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }, [code, handleRun])

  /* ── 行号生成 ── */
  const lineNumbers = Array.from({ length: Math.max(lineCount, 1) }, (_, i) =>
    String(i + 1).padStart(3, ' ')
  ).join('\n')

  /* ── 同步滚动 ── */
  const handleEditorScroll = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const lineNumDiv = ta.parentElement?.querySelector('[data-line-nums]') as HTMLElement | null
    if (lineNumDiv) {
      lineNumDiv.scrollTop = ta.scrollTop
    }
  }, [])

  /* ── render ── */
  return (
    <div style={S.root}>
      {/* ═══ Header ═══ */}
      <div style={S.header}>
        <div style={S.titleRow}>
          <span style={S.icon}><RuneMark size={26} /></span>
          <div>
            <h1 style={S.title}>符文工坊</h1>
            <p style={S.subtitle}>符文沙盘 · 即写即运行 · {history.length} 条历史</p>
          </div>
        </div>

        {/* ── 工具栏 ── */}
        <div style={S.toolbar}>
          {LANGS.map(l => (
            <button
              key={l.id}
              style={S.langTab(lang === l.id)}
              onClick={() => setLang(l.id)}
              title={l.label}
            >
              {l.icon} {l.label}
            </button>
          ))}

          <div style={S.toolbarSep} />

          {/* 模板按钮 */}
          <div style={{ position: 'relative' as const }} ref={templateBtnRef}>
            <button
              style={S.actionBtn('var(--accent)')}
              onClick={() => setShowTemplates(v => !v)}
            >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><TemplateMark size={13} />模板</span>
            </button>
            {showTemplates && (
              <div style={S.templateOverlay}>
                {TEMPLATES.map((tpl, i) => (
                  <button
                    key={i}
                    style={S.templateItem}
                    onClick={() => applyTemplate(tpl)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(var(--skin-accent),.15)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button style={S.actionBtn()} onClick={handleOpenFile}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><FolderMark size={13} />打开文件</span>
          </button>
          <button style={S.actionBtn()} onClick={handleSaveFile}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SaveMark size={13} />保存</span>
          </button>
          <button style={S.actionBtn()} onClick={handleClear}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><ClearMark size={13} />清空</span>
          </button>

          <div style={{ flex: 1 }} />

          <button
            style={{
              ...S.runBtn,
              opacity: running ? 0.6 : 1,
              cursor: running ? 'not-allowed' : 'pointer',
            }}
            onClick={handleRun}
            disabled={running}
          >
            {running
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><HourglassMark size={13} />执行中…</span>
              : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><RunMark size={13} />运行</span>}
          </button>
        </div>
      </div>

      {/* ═══ Body: 编辑器 60% + 输出 40% ═══ */}
      <div style={S.body}>
        {/* ── 编辑器 (上60%) ── */}
        <div style={S.editorPane}>
          <div style={S.editorHeader}>
            <span style={{ ...S.editorLabel, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <EditMark size={13} /> {LANGS.find(l => l.id === lang)?.icon} {LANGS.find(l => l.id === lang)?.label} 编辑器
            </span>
            <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-muted)' }}>
              {code.length} 字符 · {lineCount} 行 · Ctrl+Enter 运行
            </span>
          </div>
          <div style={S.editorWrap}>
            <div
              data-line-nums
              style={S.lineNumbers}
              aria-hidden="true"
            >
              {lineNumbers}
            </div>
            <textarea
              ref={textareaRef}
              style={S.textarea}
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={handleEditorScroll}
              placeholder={`// 在此输入 ${LANGS.find(l => l.id === lang)?.label} 代码...`}
              spellCheck={false}
              wrap="off"
            />
          </div>
        </div>

        {/* ── 输出面板 (下40%) ── */}
        <div style={S.outputPane}>
          <div style={S.outputHeader}>
            <span style={{ ...S.outputLabel, display: 'inline-flex', alignItems: 'center', gap: 5 }}><OutputMark size={13} />执行输出</span>
            {duration !== null && (
              <span style={S.outputDuration}>
            {duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration}ms`}
              </span>
            )}
          </div>
          <pre style={S.console}>
            {output ? (
              output
            ) : (
              <span style={S.consolePlaceholder}>
                  {'点击「运行」或按 Ctrl+Enter 执行代码…'}
              </span>
            )}
          </pre>
        </div>

        {/* ── 历史面板 ── */}
        {showHistory && history.length > 0 && (
          <div style={S.historyPanel}>
            <div style={S.historyHeader}>
            <span style={{ ...S.historyTitle, display: 'inline-flex', alignItems: 'center', gap: 5 }}><HistoryMark size={12} />执行历史 ({history.length})</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={S.historyClear} onClick={clearHistory}>
                  清除
                </button>
                <button
                  style={S.historyClear}
                  onClick={() => setShowHistory(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            {history.map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                style={S.historyItem}
                onClick={() => loadFromHistory(entry)}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(var(--skin-accent),.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <span style={S.historyLang(entry.lang)}>
                  {LANGS.find(l => l.id === entry.lang)?.label || entry.lang}
                </span>
                <span style={S.historyCode}>
                  {entry.code.replace(/\n/g, ' ↵ ').slice(0, 80)}
                  {entry.code.length > 80 ? '…' : ''}
                </span>
                <span style={S.historyTime}>
                  {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}

        {!showHistory && history.length > 0 && (
          <div style={{ textAlign: 'center' as const, padding: '4px', flexShrink: 0 }}>
            <button
              style={{ ...S.actionBtn(), fontSize: 'calc(var(--ui-font-size) - 3px)' }}
              onClick={() => setShowHistory(true)}
            >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><HistoryMark size={12} />显示历史 ({history.length})</span>
            </button>
          </div>
        )}
      </div>

      {/* ═══ Toast ═══ */}
      {toast && (
        <div style={S.toast}>{toast}</div>
      )}
    </div>
  )
}
