// ChatInput.tsx —— 聊天输入框（面板/工具栏/附件/推理已拆至子组件）
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useChatStore, updateContextLimit } from '../store/chat'
import { useSettingsStore, compressImage } from '../store/settings'
import { ArrowUp, Square, ChevronDown, AtSign, RefreshCw, Settings2, Search, Check } from 'lucide-react'
import { api } from '../services/ipc'
import { useChatPanels } from './useChatPanels'
import { useModelItems } from './useModelItems'
import { ChatAttachmentBar } from './ChatAttachmentBar'
import { ChatToolbar } from './ChatToolbar'
import { U } from './ui-styles'
import { slashCompletions, execSlash } from '../store/slash'
import { resolveDisplay } from '../store/display'


export default function ChatInput() {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [attachments, setAttachments] = useState<{ name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [quote, setQuote] = useState<string | null>(null)
  const [extraText, setExtraText] = useState('')
  const [perm, setPerm] = useState<string>(useSettingsStore.getState().general.filePermission || 'auto')
  const { extraOpen, setExtraOpen, cmdOpen, setCmdOpen, permOpen, setPermOpen } = useChatPanels()
  const fileRef = useRef<HTMLInputElement>(null)
  const attFileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { mediaProviders, modelItems, models, currentModel, curModelName, setModelSel, supportsVision } = useModelItems()
  const providers = useSettingsStore(s => s.providers || [])
  const visionAssist = !supportsVision
  const [modelOpen, setModelOpen] = useState(false)
  // v0.4.2: @文件引用 / 粘贴聚焦
  const [atOpen, setAtOpen] = useState(false)
  const [atQuery, setAtQuery] = useState('')
  const [atItems, setAtItems] = useState<string[]>([])
  const atSel = useRef(0)
  const [slashSel, setSlashSel] = useState(0)
  const workDir = useSettingsStore(s => s.general.workDir)
  const [moreTools, setMoreTools] = useState(false)
  // v0.4.5 统一斜杠命令: "/" 开头触发补全; 含空格(带参)时关闭补全, 回车走 execSlash
  const slashQ = text.startsWith('/') && !text.includes(' ') ? text.slice(1) : null
  const slashOpen = slashQ !== null
  const slashItems = slashOpen ? slashCompletions(slashQ) : []
  const slashIdx = slashItems.length ? slashSel % slashItems.length : 0
  // 关闭"实际下拉/面板"(模型/@引用/补充上下文/快捷指令/记忆/权限/推理)，保留更多工具(more)组展开
  const closeAllPanels = () => { setModelOpen(false); setAtOpen(false); setExtraOpen(false); setCmdOpen(false); setPermOpen(false) }
  // 连更多工具组一起关(用于点外部关闭、打开模型选择器等非 more 区的入口)
  const closeAllInput = () => { closeAllPanels(); setMoreTools(false) }
  // v0.4.3 点击"下方菜单/触发器之外"的任何地方(含输入框、聊天区)→ 关闭所有输入区下拉
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t && typeof t.closest === 'function' && t.closest('.dropdown-menu, .hq-model-menu, .hq-at-pop, .context-extra-wrap, .dropdown-wrap, .input-left-icons, .hq-model-picker, .hq-think-selector, .composer-plus-wrap, .hq-perm-picker')) return
      closeAllInput()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [])
  // v0.4.3 系统级"选中即问"草稿(全局热键带入)
  const askDraft = useChatStore(s => s.askDraft)
  const setAskDraft = useChatStore(s => s.setAskDraft)
  useEffect(() => {
    if (!askDraft) return
    setText(t => (t ? t + '\n' : '') + askDraft)
    setAskDraft('')
    taRef.current?.focus()
  }, [askDraft, setAskDraft])

  // 粘贴到聊天区任意位置 → 聚焦输入框
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const ta = taRef.current
      if (!ta) return
      const t = e.target as HTMLElement | null
      if (t && t.closest('input,textarea,select,[contenteditable="true"]')) return
      if (document.activeElement !== ta) ta.focus()
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  const loadAtItems = async (q: string) => {
    if (!workDir) { setAtItems([]); return }
    try {
      const list = await window.huangquan.computer.readDir(workDir)
      const names = (list || []).map(i => (i.isDirectory ? i.name + '/' : i.name))
      setAtItems(q ? names.filter(n => n.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : names.slice(0, 8))
    } catch { setAtItems([]) }
  }

  const onTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setText(v)
    const caret = e.target.selectionStart ?? v.length
    const before = v.slice(0, caret)
    const m = before.match(/@([^\s@]*)$/)
    const prev = m && m.index !== undefined && m.index > 0 ? before[m.index - 1] : ''
    if (m && (!prev || /[\s（(]/.test(prev))) {
      setAtOpen(true)
      setAtQuery(m[1] || '')
      atSel.current = 0
      void loadAtItems(m[1] || '')
    } else {
      setAtOpen(false)
    }
  }

  const insertAt = (name: string) => {
    const ta = taRef.current
    const caret = ta?.selectionStart ?? text.length
    const before = text.slice(0, caret)
    const after = text.slice(caret)
    const atIdx = before.lastIndexOf('@')
    const path = name.replace(/\/$/, '')
    const next = before.slice(0, Math.max(0, atIdx)) + '@' + path + ' ' + after
    setText(next)
    setAtOpen(false)
    requestAnimationFrame(() => {
      ta?.focus()
      const pos = Math.max(0, atIdx) + path.length + 2
      if (ta) { ta.selectionStart = pos; ta.selectionEnd = pos }
    })
  }

  const send = useChatStore(s => s.send)
  const cid = useChatStore(s => s.cid)
  const allSessions = useChatStore(s => s.sessions)
  const curBusy = allSessions.find(x => x.id === cid)?.busy || false

  useEffect(() => { if (currentModel && currentModel !== '未配置' && !currentModel.startsWith('img::') && !currentModel.startsWith('vid::') && !currentModel.startsWith('aud::')) updateContextLimit(curModelName) }, [currentModel, curModelName])

  // 输入框高度自适应
  useEffect(() => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px' }
  }, [text])

  // 接收消息引用
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (typeof d === 'string' && d.trim()) setQuote(d.trim()) }
    window.addEventListener('huangquan-quote', h)
    return () => window.removeEventListener('huangquan-quote', h)
  }, [])

  const handleSend = async () => {
    const t = text.trim()
    if (!t && !images.length && !attachments.length && !extraText.trim()) return
    window.dispatchEvent(new CustomEvent('huangquan-follow-scroll'))
    if (t.startsWith('/')) {
      setText(''); closeAllInput()
      if (!execSlash(t)) window.alert('未知命令: ' + t.split(' ')[0] + '（输入 /help 查看全部命令）')
      return
    }
    setText('')
    const imgs = images.length ? [...images] : undefined
    const atts = attachments.length ? [...attachments] : undefined
    const quoted = quote ? `> ${quote.replace(/\n/g, '\n> ')}\n\n` : ''
    const extra = extraText.trim()
    const extraBlock = extra ? '[补充上下文]\n' + extra + '\n\n' : ''
    setImages([]); setAttachments([]); setQuote(null); setExtraText(''); setExtraOpen(false)
    await send((quoted + extraBlock + t).trim() || (imgs?.length ? '分析图片' : '请处理我拖入的文件'), imgs, atts)
  }

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return
    const imgs: string[] = []
    for (let i = 0; i < files.length; i++) {
      try {
        const p = api?.getPathForFile?.(files[i]) || (files[i] as File & { path?: string }).path
        let b = p ? await api.computer.readImageBase64(p) : null
        if (b && b.length > 400 * 1024) b = await compressImage(b, 1280, 0.8)
        if (b) imgs.push(b)
      } catch (e) { console.warn('图片读取失败:', e) }
    }
    setImages(p => [...p, ...imgs])
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const newAtts: { name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const ext = (f.name.split('.').pop() || '').toLowerCase()
      const isVid = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'flv', 'wmv', 'm4v'].includes(ext)
      const isAud = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'].includes(ext)
      const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)
      const p = api?.getPathForFile?.(f) || (f as File & { path?: string }).path
      if (!p) continue
      if (isImg) {
        try {
          let b = await api.computer.readImageBase64(p)
          if (b && b.length > 400 * 1024) b = await compressImage(b, 1280, 0.8)
          if (b) setImages(prev => [...prev, b])
        } catch (e) { console.warn('图片读取失败:', e) }
      } else {
        newAtts.push({ name: f.name, path: p, size: f.size, kind: isVid ? 'video' : isAud ? 'audio' : 'file' })
      }
    }
    if (newAtts.length) setAttachments(p => [...p, ...newAtts])
    if (attFileRef.current) attFileRef.current.value = ''
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (!files || !files.length) return
    const newImgs: string[] = []
    const newAtts: { name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const ext = (f.name.split('.').pop() || '').toLowerCase()
      const isVid = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'flv', 'wmv', 'm4v'].includes(ext)
      const isAud = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'].includes(ext)
      const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)
      const p = api?.getPathForFile?.(f) || (f as File & { path?: string }).path
      if (!p) continue
      if (isImg) {
        try {
          let b = await api.computer.readImageBase64(p)
          if (b && b.length > 400 * 1024) b = await compressImage(b, 1280, 0.8)
          if (b) newImgs.push(b)
        } catch (e) { console.warn('图片读取失败:', e) }
      } else {
        newAtts.push({ name: f.name, path: p, size: f.size, kind: isVid ? 'video' : isAud ? 'audio' : 'file' })
      }
    }
    if (newImgs.length) setImages(p => [...p, ...newImgs])
    if (newAtts.length) setAttachments(p => [...p, ...newAtts])
  }

  const handleStop = () => { useChatStore.getState().stop() }

  // 模型选择：pill 按钮 + 分组菜单
  const pickModel = (v: string) => {
    setModelOpen(false)
    setModelSel(v)
    const item = modelItems.find(x => x.key === v)
    if (!item) return
    if (item.group === 'text') {
      useSettingsStore.getState().updateGeneral({ mainModel: v })
      useSettingsStore.getState().updateProvider(item.pid, { selectedModel: item.model })
    } else {
      const mp = mediaProviders.find(x => x.id === item.pid)
      if (item.group === 'image') { useSettingsStore.getState().updateMediaProvider(item.pid, { selectedImg: item.model }); if (mp) useSettingsStore.getState().updateGeneral({ mediaImgProvider: mp.name }) }
      if (item.group === 'video') { useSettingsStore.getState().updateMediaProvider(item.pid, { selectedVideo: item.model }); if (mp) useSettingsStore.getState().updateGeneral({ mediaVideoProvider: mp.name }) }
    }
  }

  // v0.4.4 模型选择器（对齐参考）: 搜索 + 按供应商分组 + 刷新/编辑
  const [modelQuery, setModelQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const modelGroups = useMemo(() => {
    const nameOf = (pid: string): string => providers.find(x => x.id === pid)?.name || mediaProviders.find(x => x.id === pid)?.name || '其他'
    const groups: { key: string; label: string; items: typeof modelItems }[] = []
    for (const x of modelItems) {
      const label = nameOf(x.pid)
      let g = groups.find(y => y.key === label)
      if (!g) { g = { key: label, label, items: [] }; groups.push(g) }
      g.items.push(x)
    }
    return groups
  }, [modelItems, providers, mediaProviders])
  const refreshModels = async () => {
    setRefreshing(true)
    try {
      for (const pr of providers.filter(x => x.apiKey && x.baseUrl)) {
        try {
          const r = await window.huangquan.models.detect(pr.baseUrl || '', pr.apiKey || '', { type: pr.type, anthropic: pr.type === 'Anthropic Claude' })
          if (r.ok && r.models && r.models.length) {
            const merged = [...new Set([...(pr.models || []), ...r.models])]
            if (merged.length !== (pr.models || []).length) useSettingsStore.getState().updateProvider(pr.id, { models: merged })
          }
        } catch { /* 单个供应商失败不影响其余 */ }
      }
    } finally { setRefreshing(false) }
  }
  const canSend = !!text.trim() || !!images.length || !!attachments.length || !!quote || !!extraText.trim()
  const disp = resolveDisplay(useSettingsStore(s => s.general.uiDisplay))
  // v0.6.0 排队输入 + 上下文用量
  const queuedItems = useChatStore(s => (cid ? s.queued[cid] : undefined)) || []
  const removeQueued = useChatStore(s => s.removeQueued)
  const basePlaceholder = images.length
    ? (visionAssist ? '描述图片...（将自动用视觉辅助模型分析）' : '描述图片...')
    : attachments.length ? '描述或说明这些文件...' : (curBusy ? '继续输入以排队后续修改' : '从一个目标开始')
  const placeholder = curBusy ? '执行中：回车发送=补充指令插话 · ' + basePlaceholder : basePlaceholder

  return (
    <div className="chat-input-area" onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }} onDrop={handleDrop}>
      {/* 拖拽遮罩 */}
      {dragOver && <div style={{ position: 'absolute', inset: 0, zIndex: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(var(--skin-accent),.18)', border: '2px dashed var(--accent)', borderRadius: 10, pointerEvents: 'none', fontSize: 'calc(var(--ui-font-size) + 2px)', fontWeight: 600, color: 'var(--accent)' }}>松开鼠标 · 添加图片 / 视频 / 文件</div>}
      {!disp.hideAttachmentBar && (
        <ChatAttachmentBar
          quote={quote}
          images={images}
          attachments={attachments}
          onRemoveQuote={() => setQuote(null)}
          onRemoveImage={(i) => setImages(p => p.filter((_, j) => j !== i))}
          onRemoveAttachment={(i) => setAttachments(p => p.filter((_, j) => j !== i))}
        />
      )}

      {/* v0.4.4 对齐参考: 首页不放快捷建议 chips（需要时可从设置→界面加回） */}

      {/* v0.6.0 排队中的后续修改 */}
      {curBusy && queuedItems.length > 0 && (
        <div className="hq-queue-bar">
          <span className="hq-queue-label">排队后续修改 {queuedItems.length}</span>
          {queuedItems.map(q => (
            <span key={q.id} className="hq-queue-chip" title={q.text}>
              <span className="hq-queue-text">{q.text}</span>
              <button type="button" className="hq-queue-remove" aria-label="移除" onClick={() => removeQueued(cid!, q.id)}>×</button>
            </span>
          ))}
          <span style={{ flex: 1 }} />
          <button type="button" className="hq-queue-parallel" title="开一个新会话并行跑别的任务" onClick={() => useChatStore.getState().create()}>并行新任务</button>
        </div>
      )}

      <div className="input-card">
        {extraOpen && (
          <div className="context-extra-wrap">
            <div className="context-extra-head">
              <span className="context-extra-title">补充上下文</span>
              <span className="context-extra-hint">随消息一起发送</span>
            </div>
            <textarea className="context-extra" rows={2}
              placeholder="补充背景、需求细节或约束条件…"
              value={extraText} onChange={e => setExtraText(e.target.value)} />
          </div>
        )}
        {/* v0.4.4 单行 composer（对齐参考）: [+] [输入区] [模型选择器] [发送] */}
        <div className="composer-row">
        {!disp.hideChatToolbar && (
          <ChatToolbar
            extraOpen={extraOpen}
            cmdOpen={cmdOpen}
            permOpen={permOpen}
            perm={perm}
            supportsVision={supportsVision}
            visionAssist={visionAssist}
            fileRef={fileRef}
            attFileRef={attFileRef}
            onToggleExtra={() => { closeAllPanels(); setExtraOpen(!extraOpen) }}
            onToggleCmd={() => { closeAllPanels(); setCmdOpen(!cmdOpen) }}
            onTogglePerm={() => { closeAllPanels(); setPermOpen(!permOpen) }}
            onPerm={setPerm}
            onSetText={setText}
            onSend={handleSend}
            onImagePick={handleImagePick}
            onFilePick={handleFilePick}
            moreOpen={moreTools}
            onToggleMore={() => { const next = !moreTools; if (next) closeAllPanels(); setMoreTools(next) }}
          />
        )}
        <textarea ref={taRef} className="chat-textarea" rows={1}
          placeholder={placeholder}
          value={text} onChange={onTextChange}
          onKeyDown={e => {
            if (slashOpen && slashItems.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSel(s => s + 1); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSel(s => s - 1 + slashItems.length); return }
              if (e.key === 'Tab') { e.preventDefault(); setText(slashItems[slashIdx].cmd + ' '); return }
              if (e.key === 'Enter') {
                e.preventDefault()
                const def = slashItems[slashIdx]
                setText('')
                closeAllInput()
                if (def.kind === 'local') execSlash(def.cmd)
                else void send(def.cmd)
                return
              }
              if (e.key === 'Escape') { e.preventDefault(); setText(''); return }
            }
            if (atOpen && atItems.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); atSel.current = (atSel.current + 1) % atItems.length; return }
              if (e.key === 'ArrowUp') { e.preventDefault(); atSel.current = (atSel.current - 1 + atItems.length) % atItems.length; return }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertAt(atItems[atSel.current] || atItems[0]); return }
              if (e.key === 'Escape') { e.preventDefault(); setAtOpen(false); return }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
          }} />

        {/* 右簇: 模型选择器 + 发送 */}
        <div className="composer-right">
            {!disp.hideModelPicker && (models.length > 0 ? (
              <div className="dropdown-wrap hq-model-picker">
                <button type="button" className="hq-model-pill" title="切换模型" onClick={() => { closeAllInput(); setModelOpen(v => !v) }}>
                  <span className="hq-model-name">{curModelName || currentModel}</span>
                  <span className="hq-model-effort">· {useSettingsStore.getState().general.thinkLevel || '中'}</span>
                  <span className="hq-model-live-dot" />
                  <ChevronDown size={12} />
                </button>
                {modelOpen && (
                  <div className="dropdown-menu hq-model-menu">
                    <div className="hq-model-search">
                      <Search size={13} />
                      <input autoFocus placeholder="搜索模型" value={modelQuery} onChange={e => setModelQuery(e.target.value)} />
                    </div>
                    <div className="hq-model-groups">
                      {modelGroups.map(g => {
                        const items = g.items.filter(x => !modelQuery.trim() || x.label.toLowerCase().includes(modelQuery.trim().toLowerCase()) || g.label.toLowerCase().includes(modelQuery.trim().toLowerCase()))
                        if (!items.length) return null
                        return (
                          <div key={g.key}>
                            <div className="hq-model-group-label">{g.label}</div>
                            {items.map(x => (
                              <div key={x.key} className={'dropdown-item hq-model-item' + (currentModel === x.key ? ' active' : '')} onClick={() => { pickModel(x.key); setModelQuery('') }}>
                                <span className="hq-model-item-name">{x.label}</span>
                                {currentModel === x.key && <Check size={13} className="hq-model-check" />}
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                    <div className="hq-model-menu-actions">
                      <button type="button" className="hq-model-action" disabled={refreshing} onClick={() => { void refreshModels() }}>
                        <RefreshCw size={13} className={refreshing ? 'hq-spin' : ''} />{refreshing ? '刷新中…' : '刷新模型'}
                      </button>
                      <button type="button" className="hq-model-action" onClick={() => { setModelOpen(false); window.dispatchEvent(new CustomEvent('hq-open-settings', { detail: 'providers' })) }}>
                        <Settings2 size={13} />编辑模型…
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : <span className="model-tag" style={{ height: 28, display: 'inline-flex', alignItems: 'center' }}>{curModelName || currentModel}</span>)}

            {/* 发送/停止按钮: 忙时发送 = 排队为后续修改 */}
            {curBusy && !text.trim() && !images.length && !attachments.length ? (
              <button className="send-btn stop-btn" onClick={handleStop}
                title="终止任务（会同时丢弃排队中的后续修改）"
                style={U.stopBtn}>
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button className="send-btn" onClick={handleSend} disabled={!canSend}
                title={curBusy ? '排队为后续修改（回车）' : '发送（回车）'}
                style={{ width: 36, height: 36, minWidth: 36, borderRadius: '50%', fontSize: 18 }}>
                <ArrowUp size={18} strokeWidth={2.5} />
              </button>
            )}
        </div>
        </div>{/* /composer-row */}
        {/* @ 文件引用弹出（inline refs） */}
        {atOpen && (atItems.length > 0 ? (
          <div className="hq-at-pop">
            {atItems.map((n, i) => (
              <button key={n} type="button" className={'hq-at-item' + (i === atSel.current ? ' selected' : '')}
                onMouseEnter={() => { atSel.current = i }}
                onClick={() => insertAt(n)}>
                <AtSign size={12} />{n}
              </button>
            ))}
          </div>
        ) : (
          <div className="hq-at-pop"><div className="hq-at-item" style={{ cursor: 'default' }}>没有匹配「{atQuery}」的文件</div></div>
        ))}
        {/* 斜杠命令补全 */}
        {slashOpen && (slashItems.length > 0 ? (
          <div className="hq-at-pop">
            {slashItems.map((d, i) => (
              <button key={d.cmd} type="button" className={'hq-at-item' + (i === slashIdx ? ' selected' : '')}
                onMouseEnter={() => setSlashSel(i)}
                onClick={() => {
                  setText('')
                  closeAllInput()
                  if (d.kind === 'local') execSlash(d.cmd)
                  else void send(d.cmd)
                }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{d.cmd}</span>{d.argsHint ? ' ' + d.argsHint : ''} — {d.desc}
              </button>
            ))}
          </div>
        ) : (
          <div className="hq-at-pop"><div className="hq-at-item" style={{ cursor: 'default' }}>未知命令，输入 /help 查看全部</div></div>
        ))}

      </div>
    </div>
  )
}
