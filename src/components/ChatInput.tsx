import React, { useState, useRef, useEffect } from 'react'
import { useChatStore, updateContextLimit } from '../store/chat'
import { useSettingsStore, compressImage } from '../store/settings'
import type { MemoryData } from '../global'
import { Camera, Command, Bookmark, Shield, Lock, Eye, Unlock, Lightbulb, Zap, Flame, Sparkles as SparklesIcon, Send, Square, ImagePlus, Gauge, Brain, Crown } from 'lucide-react'
import { api } from '../services/ipc'

type FilePerm = 'auto' | 'full' | 'ask' | 'readonly'
type ThinkLevel = 'off' | 'quick' | 'medium' | 'deep' | 'extreme' | 'ultra'
const PERM_ICONS: Record<FilePerm, React.ReactNode> = { auto: <Shield size={14} />, full: <Unlock size={14} />, ask: <Lock size={14} />, readonly: <Eye size={14} /> }
const PERM_LABELS: Record<FilePerm, string> = { auto: '自动审核', full: '完整权限', ask: '操作前询问', readonly: '只读' }
const THINK_ICONS: Record<ThinkLevel, React.ReactNode> = { off: <Lightbulb size={14} />, quick: <Gauge size={14} />, medium: <Brain size={14} />, deep: <Flame size={14} />, extreme: <SparklesIcon size={14} />, ultra: <Crown size={14} /> }

// 统一图标按钮组件 — 最小 32x32 触摸区域
const IconBtn: React.FC<{ title: string; onClick?: () => void; children: React.ReactNode; style?: React.CSSProperties; disabled?: boolean }> =
  ({ title, onClick, children, style, disabled }) => (
    <button title={title} onClick={onClick} disabled={disabled} style={{
      width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
      color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 'calc(var(--ui-font-size) + 3px)', lineHeight: 1,
      opacity: disabled ? 0.3 : 1, transition: 'all .12s', padding: 0, ...style,
    }} onMouseEnter={e => { if (!disabled) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--bg-hover)' } }}
      onMouseLeave={e => { if (!disabled) { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent' } }}>
      {children}
    </button>
  )

export default function ChatInput() {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  // 拖拽附件（视频/音频/文档等非图片）
  const [attachments, setAttachments] = useState<{ name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[]>([])
  const [dragOver, setDragOver] = useState(false)
  // 引用内容（显示在输入框上方，像图片预览）
  const [quote, setQuote] = useState<string | null>(null)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [memOpen, setMemOpen] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [thinkOpen, setThinkOpen] = useState(false)
  const [memText, setMemText] = useState('')
  // 权限/推理强度与设置持久化联动（不再是无效果本地状态）
  const [perm, setPerm] = useState<string>(useSettingsStore.getState().general.filePermission || 'auto')
  const [think, setThink] = useState<string>(useSettingsStore.getState().general.thinkLevel || 'medium')
  const send = useChatStore(s => s.send)
  // 发送/停止按钮按"当前会话"判断 —— 聊天/工作会话独立, 其他会话在跑不影响本会话
  const cid = useChatStore(s => s.cid)
  const allSessions = useChatStore(s => s.sessions)
  const curBusy = allSessions.find(x => x.id === cid)?.busy || false
  const contextUsed = useChatStore(s => s.cu)
  const contextLimit = useChatStore(s => s.cl)
  const providers = useSettingsStore(s => s.providers)
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 模型下拉 = 全部已配置供应商/媒体平台的模型, 按能力分类(文字/图片/视频/语音)
  const mediaProviders = useSettingsStore(s => s.mediaProviders || [])
  const classifyModel = (m: string): 'text' | 'image' | 'video' | 'audio' => {
    const ml = m.toLowerCase()
    if (/image|img|flux|dall|sdxl|\bsd-|mj-|seedream|cogview|wanx|kolors|ernie-vilg/i.test(ml)) return 'image'
    if (/video|vid|seedance|kling|pika|runway|gen3|gen4|t2v/i.test(ml)) return 'video'
    if (/asr|tts|whisper|voice|audio|iflytek/i.test(ml)) return 'audio'
    return 'text'
  }
  const cfgProviders = providers.filter(pp => !!pp.apiKey && (pp.models || []).length)
  const cfgMedia = mediaProviders.filter(mp => !!mp.apiKey)
  const modelItems: { key: string; label: string; group: 'text' | 'image' | 'video' | 'audio'; pid: string; model: string; isMedia: boolean }[] = []
  cfgProviders.forEach(pp => (pp.models || []).forEach((m: string) => {
    const g = classifyModel(m)
    modelItems.push({ key: g === 'text' ? pp.id + '::' + m : g + '::' + pp.id + '::' + m, label: m, group: g, pid: pp.id, model: m, isMedia: false })
  }))
  cfgMedia.forEach(mp => {
    const push = (ms: string[], kind: 'image' | 'video' | 'audio') => (ms || []).forEach((m: string) => modelItems.push({ key: kind + '::' + mp.id + '::' + m, label: m, group: kind, pid: mp.id, model: m, isMedia: true }))
    push(mp.imgModels || [], 'image'); push(mp.videoModels || [], 'video'); push(mp.audioModels || [], 'audio')
  })
  const models = modelItems.map(x => x.key)
  const gMain = useSettingsStore(s => (s.general).mainModel)
  const defaultKey = (gMain && models.includes(gMain)) ? gMain : (models[0] || '')
  const [modelSel, setModelSel] = useState(defaultKey)
  const currentModel = modelSel || defaultKey || '未配置'
  const curModelName = (currentModel.includes('::') ? currentModel.split('::').pop() : currentModel) || ''
  // 主模型不支持视觉时仍可上传 —— send() 会自动用视觉辅助模型分析
  const supportsVision = !currentModel || currentModel === '未配置' || /gpt-4o|gpt-4-turbo|gpt-4\.1|claude-3|gemini|vision|vl|vlm|qwen-vl|glm-4v|llava/i.test(curModelName.toLowerCase())
  const visionAssist = !supportsVision
  const ctxRatio = contextLimit > 0 ? Math.min(contextUsed / contextLimit, 1) : 0
  const ctxColor = ctxRatio > 0.9 ? 'var(--danger)' : ctxRatio > 0.7 ? 'var(--warning)' : 'var(--accent)'

  useEffect(() => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px' }
  }, [text])
  // 接收消息引用（全选引入 / 右键选中文字引入）
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (typeof d === 'string' && d.trim()) setQuote(d.trim()) }
    window.addEventListener('huangquan-quote', h)
    return () => window.removeEventListener('huangquan-quote', h)
  }, [])
  // 切换/新建会话时清空输入框与引用, 防止上个会话的文字残留到新会话
  useEffect(() => { setText(''); setQuote('') }, [cid])
  useEffect(() => { if (currentModel && currentModel !== '未配置' && !currentModel.startsWith('img::') && !currentModel.startsWith('vid::') && !currentModel.startsWith('aud::')) updateContextLimit(curModelName) }, [currentModel, curModelName])

  const closeAll = () => { setCmdOpen(false); setMemOpen(false); setPermOpen(false); setThinkOpen(false) }

  const handleSend = async () => {
    const t = text.trim()
    // busy 时不拦截 —— 执行中发送=插话补充指令(send 内部处理), 终止后也可立即发新指令
    if (!t && !images.length) return
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
    // 引用内容拼入消息
    const quoted = quote ? `> ${quote.replace(/\n/g, '\n> ')}\n\n` : ''
    setImages([]); setAttachments([]); setQuote(null)
    await send((quoted + t).trim() || (imgs?.length ? '分析图片' : '请处理我拖入的文件'), imgs, atts)
  }

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return
    const imgs: string[] = []
    for (let i = 0; i < files.length; i++) {
      try {
        // Electron 32 移除了 File.path，改用 webUtils.getPathForFile
        const p = api?.getPathForFile?.(files[i]) || (files[i] as File & { path?: string }).path
        let b = p ? await api.computer.readImageBase64(p) : null
        // 大图压缩（≤1280px JPEG 0.8），避免本地视觉模型超时 + 会话文件膨胀
        if (b && b.length > 400 * 1024) b = await compressImage(b, 1280, 0.8)
        if (b) imgs.push(b)
      } catch (e) { console.warn('[ChatInput] 图片读取失败:', e) }
    }
    setImages(p => [...p, ...imgs])
    if (fileRef.current) fileRef.current.value = ''
  }

  // 拖拽上传 —— 图片走 base64 通道，视频/音频/文档走附件通道
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
      const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)
      const isVid = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'flv', 'wmv', 'm4v'].includes(ext)
      const isAud = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'].includes(ext)
      try {
        if (isImg) {
          const p = api?.getPathForFile?.(f) || (f as File & { path?: string }).path
          let b = p ? await api.computer.readImageBase64(p) : null
          // 拖入的图片同样压缩
          if (b && b.length > 400 * 1024) b = await compressImage(b, 1280, 0.8)
          if (b) newImgs.push(b)
        } else {
          const p = api?.getPathForFile?.(f) || (f as File & { path?: string }).path
          if (p) newAtts.push({ name: f.name, path: p, size: f.size, kind: isVid ? 'video' : isAud ? 'audio' : 'file' })
        }
      } catch (err) { console.warn('[ChatInput] 拖入文件处理失败:', f.name, err) }
    }
    if (newImgs.length) setImages(p => [...p, ...newImgs])
    if (newAtts.length) setAttachments(p => [...p, ...newAtts])
  }

  const saveMemory = async () => {
    if (!memText.trim()) return
    const m = await api.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [], episodic: [], goals: [] }))
    m.facts.push(memText.trim())
    await api.memory.save(m)
    setMemText(''); setMemOpen(false)
  }

  const handleStop = () => { useChatStore.getState().stop() }

  const canSend = !!text.trim() || !!images.length || !!attachments.length || !!quote

  return (
    <div className="chat-input-area" onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }} onDrop={handleDrop}>
      {/* 拖拽遮罩 */}
      {dragOver && <div style={{ position: 'absolute', inset: 0, zIndex: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(var(--skin-accent),.18)', border: '2px dashed var(--accent)', borderRadius: 10, pointerEvents: 'none', fontSize: 'calc(var(--ui-font-size) + 2px)', fontWeight: 600, color: 'var(--accent)' }}>松开鼠标 · 添加图片 / 视频 / 文件</div>}
      {/* 引用内容（显示在输入框上方，类似图片预览） */}
      {quote && (
        <div className="quote-preview" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, padding: '8px 12px', borderRadius: 8, borderLeft: '3px solid var(--accent)', background: 'var(--bg-card)', fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', maxHeight: 80, overflowY: 'auto' }}>
          <span style={{ flexShrink: 0, fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--accent)', fontWeight: 600, marginTop: 2 }}>引用</span>
          <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{quote}</span>
          <button className="image-attach-remove" onClick={() => setQuote(null)} style={{ position: 'static', flexShrink: 0 }}>×</button>
        </div>
      )}
      {!!images.length && (
        <div className="image-attach-preview">
          {images.map((img, i) => (
            <div key={i} className="image-attach-item">
              <img src={img} alt="" />
              <button className="image-attach-remove" onClick={() => setImages(p => p.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* 附件（视频/音频/文档）预览 */}
      {!!attachments.length && (
        <div className="image-attach-preview">
          {attachments.map((a, i) => (
            <div key={i} className="attach-item" title={a.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)', maxWidth: 240 }}>
              <span>{a.kind === 'video' ? '🎬' : a.kind === 'audio' ? '🎵' : '📄'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>{(a.size / 1024).toFixed(0)}KB</span>
              <button className="image-attach-remove" onClick={() => setAttachments(p => p.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}

      <textarea ref={taRef} className="chat-textarea" rows={1}
        placeholder={images.length ? (visionAssist ? '描述图片...（将自动用视觉辅助模型分析）' : '描述图片...') : attachments.length ? '描述或说明这些文件...' : '输入消息，Enter 发送，Shift+Enter 换行（可拖入图片/视频/文件）'}
        value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }} />

      <div className="input-wrapper">
        <div className="input-left-icons">
          {/* 快捷指令 */}
          <div className="dropdown-wrap">
            <IconBtn title="快捷指令" onClick={() => { closeAll(); setCmdOpen(!cmdOpen) }}><Command size={16} /></IconBtn>
            {cmdOpen && (
              <div className="dropdown-menu">
                <div className="dropdown-item" onClick={() => { setText('/diary'); handleSend() }}>📔 /diary 生成日记</div>
                <div className="dropdown-item" onClick={() => { setText('/xing'); handleSend() }}>✨ /xing 提取流程</div>
                <div className="dropdown-item" onClick={() => { setText('/compact'); handleSend() }}>🗜️ /compact 压缩历史</div>
              </div>
            )}
          </div>

          {/* 记忆 */}
          <div className="dropdown-wrap">
            <IconBtn title="记忆管理" onClick={() => { closeAll(); setMemOpen(!memOpen) }}><Bookmark size={16} /></IconBtn>
            {memOpen && (
              <div className="dropdown-menu dropdown-wide">
                <input className="dropdown-input" placeholder="保存到记忆..." value={memText}
                  onChange={e => setMemText(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveMemory()} />
                <button className="btn-small" onClick={saveMemory} style={{ width: '100%' }}>保存</button>
              </div>
            )}
          </div>

          {/* 文件权限 */}
          <div className="dropdown-wrap">
            <IconBtn title={`文件权限: ${PERM_LABELS[perm as FilePerm] || perm}`} onClick={() => { closeAll(); setPermOpen(!permOpen) }}>{PERM_ICONS[perm as FilePerm] || '⚙'}</IconBtn>
            {permOpen && (
              <div className="dropdown-menu">
                {(Object.keys(PERM_ICONS) as FilePerm[]).map(k => (
                  <div key={k} className={`dropdown-item ${perm === k ? 'active' : ''}`} onClick={() => { setPerm(k); setPermOpen(false); useSettingsStore.getState().updateGeneral({ filePermission: k }) }}>
                    {PERM_ICONS[k]} {PERM_LABELS[k]}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 推理强度 */}
          <div className="dropdown-wrap">
            <IconBtn title={`推理强度: ${think}`} onClick={() => { closeAll(); setThinkOpen(!thinkOpen) }}>{THINK_ICONS[think as ThinkLevel] || '🧠'}</IconBtn>
            {thinkOpen && (
              <div className="dropdown-menu">
                {(Object.keys(THINK_ICONS) as ThinkLevel[]).map(k => (
                  <div key={k} className={`dropdown-item ${think === k ? 'active' : ''}`} onClick={() => { setThink(k); setThinkOpen(false); useSettingsStore.getState().updateGeneral({ thinkLevel: k }) }}>
                    {THINK_ICONS[k]} {k}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 语音输入按钮已移除 —— Web Speech API 在 Electron 不可用 */}

          {/* 图片上传 */}
          <label title={supportsVision ? '上传图片' : (visionAssist ? '上传图片（自动用视觉辅助模型分析）' : '上传图片')} style={{
            width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', borderRadius: 6, position: 'relative', overflow: 'hidden',
            transition: 'all .12s',
          }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,image/avif,image/heic" multiple hidden onChange={handleImagePick} />
            <Camera size={16} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
          </label>
        </div>

        <div className="input-right">
          {/* Agent 选择器 */}
          <select className="model-select" style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', padding: '4px 8px', maxWidth: 80, height: 28, borderRadius: 5 }}
            onChange={e => { const v = e.target.value; useChatStore.setState(s => ({ sessions: s.sessions.map(x => x.id === s.cid ? { ...x, agent: v || undefined, agentManual: !!v } : x) })) }}
            defaultValue="">
            <option value="">自动</option>
            <option value="姬子">☕ 主控</option>
            <option value="三月七">📸 文档</option>
            <option value="银狼">🐺 安全</option>
            <option value="艾丝妲">📡 通知</option>
            <option value="知更鸟">🕊️ 陪伴</option>
            <option value="黑天鹅">🦢 设计</option>
            <option value="螺丝咕姆">🤖 开发</option>
          </select>

          {/* 模型选择器 —— 按能力分类(文字/图片/视频/语音), 选择自动写入对应设置 */}
          {models.length > 0 ? (
            <select className="model-select" value={currentModel} onChange={e => {
              const v = e.target.value
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
            }} style={{ height: 28, borderRadius: 5, maxWidth: 140 }}>{(['text', 'image', 'video', 'audio'] as const).filter(g => modelItems.some(x => x.group === g)).map(g => (
              <optgroup key={g} label={g === 'text' ? '文字' : g === 'image' ? '图片' : g === 'video' ? '视频' : '语音'}>
                {modelItems.filter(x => x.group === g).map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
              </optgroup>
            ))}</select>
          ) : <span className="model-tag" style={{ height: 28, display: 'inline-flex', alignItems: 'center' }}>{curModelName || currentModel}</span>}

          {/* Token 用量环 */}
          <svg width="28" height="28" style={{ flexShrink: 0 }}>
            <title>上下文用量：已用 {(contextUsed / 1024).toFixed(1)}K / 上限 {(contextLimit / 1024).toFixed(0)}K</title>
            <circle cx="14" cy="14" r="10" fill="none" stroke="var(--bg-hover)" strokeWidth="2.5" />
            <circle cx="14" cy="14" r="10" fill="none" stroke={ctxColor} strokeWidth="2.5"
              strokeDasharray={`${ctxRatio * 62.8} 62.8`} transform="rotate(-90 14 14)" strokeLinecap="round" />
            <text x="14" y="17" textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontWeight="600">{ctxRatio > 0.7 ? '⚠' : '◉'}</text>
          </svg>

          {/* 发送/停止按钮 —— 流式或工具执行中均可终止 */}
          {curBusy && !text.trim() ? (
            <button className="send-btn stop-btn" onClick={handleStop}
              title="终止任务"
              style={{ width: 36, height: 36, minWidth: 36, borderRadius: 8, fontSize: 18, background: '#cc3333' }}>
              <Square size={16} fill="currentColor" />
            </button>
          ) : curBusy ? (
            <>
              <button className="send-btn stop-btn" onClick={handleStop}
                title="终止任务"
                style={{ width: 36, height: 36, minWidth: 36, borderRadius: 8, fontSize: 18, background: '#cc3333' }}>
                <Square size={16} fill="currentColor" />
              </button>
              <button className="send-btn" onClick={handleSend}
                title="发送（回车）· 工作中发送即补充指令"
                style={{ width: 36, height: 36, minWidth: 36, borderRadius: 8, fontSize: 18 }}>
                <Send size={17} />
              </button>
            </>
          ) : (
            <button className="send-btn" onClick={handleSend} disabled={!canSend}
              title="发送（回车）"
              style={{ width: 36, height: 36, minWidth: 36, borderRadius: 8, fontSize: 18 }}>
              <Send size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
