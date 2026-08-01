import React, { useState, useRef, useEffect } from 'react'
import { useChatStore, updateContextLimit } from '../store/chat'
import { useSettingsStore, compressImage } from '../store/settings'

type FilePerm = 'auto' | 'full' | 'ask' | 'readonly'
type ThinkLevel = 'off' | 'medium' | 'deep' | 'extreme'
const PERM_ICONS: Record<FilePerm, string> = { auto: '🛡️', full: '🔓', ask: '🔒', readonly: '👁️' }
const PERM_LABELS: Record<FilePerm, string> = { auto: '自动审核', full: '完整权限', ask: '操作前询问', readonly: '只读' }
const THINK_ICONS: Record<ThinkLevel, string> = { off: '💡', medium: '🔆', deep: '🔥', extreme: '⚡' }

// 统一图标按钮组件 — 最小 32x32 触摸区域
const IconBtn: React.FC<{ title: string; onClick?: () => void; children: React.ReactNode; style?: React.CSSProperties; disabled?: boolean }> =
  ({ title, onClick, children, style, disabled }) => (
    <button title={title} onClick={onClick} disabled={disabled} style={{
      width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
      color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 16, lineHeight: 1,
      opacity: disabled ? 0.3 : 1, transition: 'all .12s', padding: 0, ...style,
    }} onMouseEnter={e => { if (!disabled) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--bg-hover)' } }}
      onMouseLeave={e => { if (!disabled) { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent' } }}>
      {children}
    </button>
  )

export default function ChatInput() {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  // v0.2.2: 拖拽附件（视频/音频/文档等非图片）
  const [attachments, setAttachments] = useState<{ name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[]>([])
  const [dragOver, setDragOver] = useState(false)
  // v0.2.2: 引用内容（显示在输入框上方，像图片预览）
  const [quote, setQuote] = useState<string | null>(null)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [memOpen, setMemOpen] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [thinkOpen, setThinkOpen] = useState(false)
  const [memText, setMemText] = useState('')
  // v0.2.1: 权限/推理强度与设置持久化联动（不再是无效果本地状态）
  const [perm, setPerm] = useState<FilePerm>((useSettingsStore.getState().general as any).filePermission || 'auto')
  const [think, setThink] = useState<ThinkLevel>((useSettingsStore.getState().general as any).thinkLevel || 'medium')
  const send = useChatStore(s => s.send)
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const contextUsed = useChatStore(s => s.cu)
  const contextLimit = useChatStore(s => s.cl)
  const providers = useSettingsStore(s => s.providers)
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const models = providers[0]?.models || []
  const currentModel = providers[0]?.selectedModel || models[0] || '未配置'
  // v0.2.1: 主模型不支持视觉时仍可上传 —— send() 会自动用视觉辅助模型分析
  const supportsVision = !currentModel || currentModel === '未配置' || /gpt-4o|gpt-4-turbo|gpt-4\.1|claude-3|gemini|vision|vl|vlm|qwen-vl|glm-4v|llava/i.test(currentModel.toLowerCase())
  const visionAssist = !supportsVision
  const ctxRatio = contextLimit > 0 ? Math.min(contextUsed / contextLimit, 1) : 0
  const ctxColor = ctxRatio > 0.9 ? '#ff4466' : ctxRatio > 0.7 ? '#ffaa00' : 'var(--accent)'

  useEffect(() => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px' }
  }, [text])
  // v0.2.2: 接收消息引用（全选引入 / 右键选中文字引入）
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (typeof d === 'string' && d.trim()) setQuote(d.trim()) }
    window.addEventListener('huangquan-quote', h)
    return () => window.removeEventListener('huangquan-quote', h)
  }, [])
  useEffect(() => { if (currentModel && currentModel !== '未配置') updateContextLimit(currentModel) }, [currentModel])

  const closeAll = () => { setCmdOpen(false); setMemOpen(false); setPermOpen(false); setThinkOpen(false) }

  const handleSend = async () => {
    const t = text.trim()
    if ((!t && !images.length) || streaming) return
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
    // v0.2.2: 引用内容拼入消息
    const quoted = quote ? `> ${quote.replace(/\n/g, '\n> ')}\n\n` : ''
    setImages([]); setAttachments([]); setQuote(null)
    await send((quoted + t).trim() || (imgs?.length ? '分析图片' : '请处理我拖入的文件'), imgs, atts)
  }

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return
    const imgs: string[] = []
    for (let i = 0; i < files.length; i++) {
      try {
        // v0.2.2-fix: Electron 32 移除了 File.path，改用 webUtils.getPathForFile
        const p = (window as any).huangquan?.getPathForFile?.(files[i]) || (files[i] as any).path
        let b = p ? await window.huangquan.computer.readImageBase64(p) : null
        // v0.2.3-fix: 大图压缩（≤1280px JPEG 0.8），避免本地视觉模型超时 + 会话文件膨胀
        if (b && b.length > 400 * 1024) b = await compressImage(b, 1280, 0.8)
        if (b) imgs.push(b)
      } catch (e) { console.warn('[ChatInput] 图片读取失败:', e) }
    }
    setImages(p => [...p, ...imgs])
    if (fileRef.current) fileRef.current.value = ''
  }

  // v0.2.2: 拖拽上传 —— 图片走 base64 通道，视频/音频/文档走附件通道
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
          const p = (window as any).huangquan?.getPathForFile?.(f) || (f as any).path
          let b = p ? await window.huangquan.computer.readImageBase64(p) : null
          // v0.2.3-fix: 拖入的图片同样压缩
          if (b && b.length > 400 * 1024) b = await compressImage(b, 1280, 0.8)
          if (b) newImgs.push(b)
        } else {
          const p = (window as any).huangquan?.getPathForFile?.(f) || (f as any).path
          if (p) newAtts.push({ name: f.name, path: p, size: f.size, kind: isVid ? 'video' : isAud ? 'audio' : 'file' })
        }
      } catch (err) { console.warn('[ChatInput] 拖入文件处理失败:', f.name, err) }
    }
    if (newImgs.length) setImages(p => [...p, ...newImgs])
    if (newAtts.length) setAttachments(p => [...p, ...newAtts])
  }

  const saveMemory = async () => {
    if (!memText.trim()) return
    const m = await window.huangquan.memory.load().catch(() => ({ facts: [] as string[], summaries: [] as any[] }))
    m.facts.push(memText.trim())
    await window.huangquan.memory.save(m)
    setMemText(''); setMemOpen(false)
  }

  const handleStop = () => { useChatStore.getState().stop() }

  const canSend = !!text.trim() || !!images.length || !!attachments.length || !!quote

  return (
    <div className="chat-input-area" onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }} onDrop={handleDrop}>
      {/* v0.2.2: 拖拽遮罩 */}
      {dragOver && <div style={{ position: 'absolute', inset: 0, zIndex: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(124,92,191,0.18)', border: '2px dashed var(--accent)', borderRadius: 10, pointerEvents: 'none', fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}>松开鼠标 · 添加图片 / 视频 / 文件</div>}
      {/* v0.2.2: 引用内容（显示在输入框上方，类似图片预览） */}
      {quote && (
        <div className="quote-preview" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, padding: '8px 12px', borderRadius: 8, borderLeft: '3px solid var(--accent)', background: 'var(--bg-card)', fontSize: 12, color: 'var(--text-secondary)', maxHeight: 80, overflowY: 'auto' }}>
          <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--accent)', fontWeight: 600, marginTop: 2 }}>引用</span>
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

      {/* v0.2.2: 附件（视频/音频/文档）预览 */}
      {!!attachments.length && (
        <div className="image-attach-preview">
          {attachments.map((a, i) => (
            <div key={i} className="attach-item" title={a.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 11, color: 'var(--text-secondary)', maxWidth: 240 }}>
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
            <IconBtn title="快捷指令" onClick={() => { closeAll(); setCmdOpen(!cmdOpen) }}>⌘</IconBtn>
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
            <IconBtn title="记忆管理" onClick={() => { closeAll(); setMemOpen(!memOpen) }}>◈</IconBtn>
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
            <IconBtn title={`文件权限: ${PERM_LABELS[perm]}`} onClick={() => { closeAll(); setPermOpen(!permOpen) }}>{PERM_ICONS[perm]}</IconBtn>
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
            <IconBtn title={`推理强度: ${think}`} onClick={() => { closeAll(); setThinkOpen(!thinkOpen) }}>{THINK_ICONS[think]}</IconBtn>
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

          {/* 语音输入 */}
          <IconBtn title="语音输入 (实验性)" onClick={() => { try { const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (SR) { const r = new SR(); r.lang = 'zh-CN'; r.onresult = (e: any) => setText(t => t + e.results[0][0].transcript); r.start() } } catch {} }}>🎤</IconBtn>

          {/* 图片上传 */}
          <label title={supportsVision ? '上传图片' : (visionAssist ? '上传图片（自动用视觉辅助模型分析）' : '上传图片')} style={{
            width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', borderRadius: 6, position: 'relative', overflow: 'hidden',
            transition: 'all .12s',
          }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={handleImagePick} />
            <span style={{ fontSize: 16, color: 'var(--text-secondary)' }}>📷</span>
          </label>
        </div>

        <div className="input-right">
          {/* Agent 选择器 */}
          <select className="model-select" style={{ fontSize: 11, padding: '4px 8px', maxWidth: 80, height: 28, borderRadius: 5 }}
            onChange={e => { const v = e.target.value; (window as any).__huangquan_agent = v; (window as any).__huangquan_agent_manual = v !== '' }}
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

          {/* 模型选择器 */}
          {models.length > 0 ? (
            <select className="model-select" value={currentModel} onChange={e => {
              const idx = models.indexOf(e.target.value)
              if (idx >= 0 && providers[0]) useSettingsStore.getState().updateProvider(providers[0].id, { selectedModel: e.target.value })
            }} style={{ height: 28, borderRadius: 5 }}>{models.map(m => <option key={m} value={m}>{m}</option>)}</select>
          ) : <span className="model-tag" style={{ height: 28, display: 'inline-flex', alignItems: 'center' }}>{currentModel}</span>}

          {/* Token 用量环 */}
          <svg width="28" height="28" style={{ flexShrink: 0 }}>
            <title>{(contextUsed / 1024).toFixed(1)}K / {(contextLimit / 1024).toFixed(0)}K tokens</title>
            <circle cx="14" cy="14" r="10" fill="none" stroke="var(--bg-hover)" strokeWidth="2.5" />
            <circle cx="14" cy="14" r="10" fill="none" stroke={ctxColor} strokeWidth="2.5"
              strokeDasharray={`${ctxRatio * 62.8} 62.8`} transform="rotate(-90 14 14)" strokeLinecap="round" />
            <text x="14" y="17" textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontWeight="600">{ctxRatio > 0.7 ? '⚠' : '◉'}</text>
          </svg>

          {/* 发送/停止按钮 —— 流式或工具执行中均可终止 */}
          {streaming || executing ? (
            <button className="send-btn stop-btn" onClick={handleStop}
              title="终止任务"
              style={{ width: 36, height: 36, minWidth: 36, borderRadius: 8, fontSize: 18, background: '#cc3333' }}>
              ■
            </button>
          ) : (
            <button className="send-btn" onClick={handleSend} disabled={!canSend}
              title="发送 (Enter)"
              style={{ width: 36, height: 36, minWidth: 36, borderRadius: 8, fontSize: 18 }}>
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
