// ChatInput.tsx —— 聊天输入框（面板/工具栏/附件/推理已拆至子组件）
import React, { useState, useRef, useEffect } from 'react'
import { useChatStore, updateContextLimit } from '../store/chat'
import { useSettingsStore, compressImage } from '../store/settings'
import type { MemoryData } from '../global'
import { ArrowUp, Square, ChevronDown, AtSign } from 'lucide-react'
import { api } from '../services/ipc'
import { useChatPanels } from './useChatPanels'
import { useModelItems } from './useModelItems'
import { useThinkSelector } from './useThinkSelector'
import { ChatAttachmentBar } from './ChatAttachmentBar'
import { ChatToolbar } from './ChatToolbar'
import { ChatThinkSelector } from './ChatThinkSelector'
import { U } from './ui-styles'
import { resolveDisplay } from '../store/display'


export default function ChatInput() {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [attachments, setAttachments] = useState<{ name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [quote, setQuote] = useState<string | null>(null)
  const [extraText, setExtraText] = useState('')
  const [memText, setMemText] = useState('')
  const [perm, setPerm] = useState<string>(useSettingsStore.getState().general.filePermission || 'auto')
  const { extraOpen, setExtraOpen, cmdOpen, setCmdOpen, memOpen, setMemOpen, permOpen, setPermOpen, thinkOpen, setThinkOpen, closeAll } = useChatPanels()
  const fileRef = useRef<HTMLInputElement>(null)
  const attFileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { mediaProviders, modelItems, models, currentModel, curModelName, setModelSel, supportsVision } = useModelItems()
  const visionAssist = !supportsVision
  const { thinkOnly, effThink, thinkLabel, ovModel, setThinkMode, toggleThinkOnly, setThinkLevel } = useThinkSelector(currentModel, curModelName)
  const [modelOpen, setModelOpen] = useState(false)
  // v0.4.2: @文件引用 / 粘贴聚焦
  const [atOpen, setAtOpen] = useState(false)
  const [atQuery, setAtQuery] = useState('')
  const [atItems, setAtItems] = useState<string[]>([])
  const atSel = useRef(0)
  const workDir = useSettingsStore(s => s.general.workDir)

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
  const curMsgCount = useChatStore(s => s.cur()?.messages.length ?? 0)
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
      const cmd = t.slice(1); setText(''); closeAll()
      if (cmd === 'diary') await send('请将本次对话整理为一篇日记。')
      else if (cmd === 'xing') await send('请从本次对话中提取可复用的流程。')
      else if (cmd === 'compact') await send('请精简压缩本次对话历史。')
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

  const saveMemory = async () => {
    if (!memText.trim()) return
    try {
      const m = await api.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [], episodic: [], goals: [] }))
      m.facts.push(memText.trim())
      await api.memory.save(m)
      setMemText('')
      setMemOpen(false)
    } catch { /* ignore */ }
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
      if (item.group === 'audio') { useSettingsStore.getState().updateMediaProvider(item.pid, { selectedAudio: item.model }); if (mp) useSettingsStore.getState().updateGeneral({ mediaAudioProvider: mp.name }) }
    }
  }

  const canSend = !!text.trim() || !!images.length || !!attachments.length || !!quote || !!extraText.trim()
  const disp = resolveDisplay(useSettingsStore(s => s.general.uiDisplay))
  const basePlaceholder = images.length
    ? (visionAssist ? '描述图片...（将自动用视觉辅助模型分析）' : '描述图片...')
    : attachments.length ? '描述或说明这些文件...' : '输入消息，Enter 发送，Shift+Enter 换行（可拖入图片/视频/文件）'
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

      {/* 建议 pills：空输入时显示快捷建议 */}
      {!curBusy && curMsgCount === 0 && !text.trim() && !images.length && !attachments.length && !extraText.trim() && (
        <div className="hq-suggestion-pills">
          {['继续当前任务', '总结本次对话', '生成今日工作日报', '检查项目代码问题', '把常用操作整理成技能'].map(s => (
            <button key={s} type="button" className="hq-suggestion-pill" onClick={() => { setText(s); taRef.current?.focus() }}>{s}</button>
          ))}
        </div>
      )}

      <div className="input-card">
        {curBusy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 2px 6px', fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-muted)' }}>
            <span>任务进行中：发送将作为补充指令插话；长任务可在新会话并行执行，互不阻塞。</span>
            <button style={{ background: 'var(--border)', border: 'none', borderRadius: 4, color: 'var(--text-primary)', cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '2px 8px' }} onClick={() => useChatStore.getState().create()}>并行新任务</button>
          </div>
        )}
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
        <textarea ref={taRef} className="chat-textarea" rows={1}
          placeholder={placeholder}
          value={text} onChange={onTextChange}
          onKeyDown={e => {
            if (atOpen && atItems.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); atSel.current = (atSel.current + 1) % atItems.length; return }
              if (e.key === 'ArrowUp') { e.preventDefault(); atSel.current = (atSel.current - 1 + atItems.length) % atItems.length; return }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertAt(atItems[atSel.current] || atItems[0]); return }
              if (e.key === 'Escape') { e.preventDefault(); setAtOpen(false); return }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
          }} />
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

        <div className="input-wrapper">
          {!disp.hideChatToolbar && (
            <ChatToolbar
              extraOpen={extraOpen}
              cmdOpen={cmdOpen}
              memOpen={memOpen}
              permOpen={permOpen}
              memText={memText}
              perm={perm}
              supportsVision={supportsVision}
              visionAssist={visionAssist}
              fileRef={fileRef}
              attFileRef={attFileRef}
              onToggleExtra={() => { closeAll(); setExtraOpen(!extraOpen) }}
              onToggleCmd={() => { closeAll(); setCmdOpen(!cmdOpen) }}
              onToggleMem={() => { closeAll(); setMemOpen(!memOpen) }}
              onTogglePerm={() => { closeAll(); setPermOpen(!permOpen) }}
              onMemText={setMemText}
              onSaveMemory={saveMemory}
              onPerm={setPerm}
              onSetText={setText}
              onSend={handleSend}
              onImagePick={handleImagePick}
              onFilePick={handleFilePick}
            />
          )}

          <div className="input-right">
            {/* 模型选择器 */}
            {!disp.hideModelPicker && (models.length > 0 ? (
              <div className="dropdown-wrap hq-model-picker">
                <button type="button" className="hq-model-pill" title="切换模型" onClick={() => setModelOpen(v => !v)}>
                  <span className="model-dot" />
                  <span className="hq-model-name">{curModelName || currentModel}</span>
                  <ChevronDown size={12} />
                </button>
                {modelOpen && (
                  <div className="dropdown-menu hq-model-menu">
                    {(['text', 'image', 'video', 'audio'] as const).filter(g => modelItems.some(x => x.group === g)).map(g => (
                      <div key={g}>
                        <div className="hq-model-group-label">{g === 'text' ? '文字' : g === 'image' ? '图片' : g === 'video' ? '视频' : '语音'}</div>
                        {modelItems.filter(x => x.group === g).map(x => (
                          <div key={x.key} className={'dropdown-item' + (currentModel === x.key ? ' active' : '')} onClick={() => pickModel(x.key)}>{x.label}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : <span className="model-tag" style={{ height: 28, display: 'inline-flex', alignItems: 'center' }}>{curModelName || currentModel}</span>)}

            {!disp.hideThinkSelector && (
              <ChatThinkSelector
                thinkLabel={thinkLabel}
                effThink={effThink}
                thinkOpen={thinkOpen}
                ovModel={ovModel}
                thinkOnly={thinkOnly}
                onToggle={() => { closeAll(); setThinkOpen(!thinkOpen) }}
                onToggleThinkMode={setThinkMode}
                onToggleThinkOnly={toggleThinkOnly}
                onSetLevel={setThinkLevel}
              />
            )}

            {/* 发送/停止按钮 */}
            {curBusy && !text.trim() ? (
              <button className="send-btn stop-btn" onClick={handleStop}
                title="终止任务"
                style={U.stopBtn}>
                <Square size={16} fill="currentColor" />
              </button>
            ) : curBusy ? (
              <>
                <button className="send-btn stop-btn" onClick={handleStop}
                  title="终止任务"
                  style={U.stopBtn}>
                  <Square size={16} fill="currentColor" />
                </button>
                <button className="send-btn" onClick={handleSend}
                  title="发送（回车）·执行中发送=补充指令插话"
                  style={{ width: 36, height: 36, minWidth: 36, borderRadius: '50%', fontSize: 18, position: 'relative' }}>
                  <ArrowUp size={18} strokeWidth={2.5} />
                  <span style={{ position: 'absolute', top: -6, right: -6, width: 15, height: 15, borderRadius: '50%', background: 'var(--warning)', color: '#fff', fontSize: 9, lineHeight: '15px', fontWeight: 700, textAlign: 'center', pointerEvents: 'none' }}>插</span>
                </button>
              </>
            ) : (
              <button className="send-btn" onClick={handleSend} disabled={!canSend}
                title="发送（回车）"
                style={{ width: 36, height: 36, minWidth: 36, borderRadius: '50%', fontSize: 18 }}>
                <ArrowUp size={18} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
