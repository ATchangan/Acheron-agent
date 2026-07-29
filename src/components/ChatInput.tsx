import React, { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'

type FilePerm = 'auto' | 'full' | 'ask' | 'readonly'
type ThinkLevel = 'off' | 'medium' | 'deep' | 'extreme'
const PERM_ICONS: Record<FilePerm, string> = { auto: '🛡️', full: '🔓', ask: '🔒', readonly: '👁️' }
const PERM_LABELS: Record<FilePerm, string> = { auto: '自动审核', full: '完整权限', ask: '操作前询问', readonly: '只读' }
const THINK_ICONS: Record<ThinkLevel, string> = { off: '💡', medium: '🔆', deep: '🔥', extreme: '⚡' }

export default function ChatInput() {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [cmdOpen, setCmdOpen] = useState(false)
  const [memOpen, setMemOpen] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [thinkOpen, setThinkOpen] = useState(false)
  const [memText, setMemText] = useState('')
  const [perm, setPerm] = useState<FilePerm>('auto')
  const [think, setThink] = useState<ThinkLevel>('medium')
  const send = useChatStore(s => s.send)
  const streaming = useChatStore(s => s.streaming)
  const contextUsed = useChatStore(s => s.contextUsed)
  const contextLimit = useChatStore(s => s.contextLimit)
  const providers = useSettingsStore(s => s.providers)
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const models = providers[0]?.models || []
  const currentModel = providers[0]?.selectedModel || models[0] || '未配置'
  const visionModels = ['gpt-4o', 'gpt-4-turbo', 'claude-3', 'gemini', 'vision', 'vl', 'flash']
  const supportsVision = !currentModel || visionModels.some(v => currentModel.toLowerCase().includes(v))
  const ctxRatio = contextLimit > 0 ? Math.min(contextUsed / contextLimit, 1) : 0
  const ctxColor = ctxRatio > 0.9 ? '#ff4466' : ctxRatio > 0.7 ? '#ffaa00' : 'var(--accent)'

  useEffect(() => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px' }
  }, [text])

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
    setImages([])
    await send(t || '分析图片', imgs)
  }

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return
    const imgs: string[] = []
    for (let i = 0; i < files.length; i++) {
      try { const b = await window.huangquan.computer.readImageBase64((files[i] as any).path); if (b) imgs.push(b) } catch {}
    }
    setImages(p => [...p, ...imgs])
    if (fileRef.current) fileRef.current.value = ''
  }

  const saveMemory = async () => {
    if (!memText.trim()) return
    const m = await window.huangquan.memory.load().catch(() => ({ facts: [] as string[], summaries: [] as any[] }))
    m.facts.push(memText.trim())
    await window.huangquan.memory.save(m)
    setMemText(''); setMemOpen(false)
  }

  return (
    <div className="chat-input-area">
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

      <textarea ref={taRef} className="chat-textarea" rows={1}
        placeholder={images.length ? '描述图片...' : '说点什么...'}
        value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }} />

      <div className="input-wrapper">
        <div className="input-left-icons">
          {/* 快捷指令 */}
          <div className="dropdown-wrap">
            <button onClick={() => { closeAll(); setCmdOpen(!cmdOpen) }} title="快捷指令">+</button>
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
            <button onClick={() => { closeAll(); setMemOpen(!memOpen) }} title="记忆管理">✦</button>
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
            <button onClick={() => { closeAll(); setPermOpen(!permOpen) }} title={`文件权限: ${PERM_LABELS[perm]}`}>{PERM_ICONS[perm]}</button>
            {permOpen && (
              <div className="dropdown-menu">
                {(Object.keys(PERM_ICONS) as FilePerm[]).map(k => (
                  <div key={k} className={`dropdown-item ${perm === k ? 'active' : ''}`} onClick={() => { setPerm(k); setPermOpen(false) }}>
                    {PERM_ICONS[k]} {PERM_LABELS[k]}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 推理强度 */}
          <div className="dropdown-wrap">
            <button onClick={() => { closeAll(); setThinkOpen(!thinkOpen) }} title={`推理强度: ${think}`}>{THINK_ICONS[think]}</button>
            {thinkOpen && (
              <div className="dropdown-menu">
                {(Object.keys(THINK_ICONS) as ThinkLevel[]).map(k => (
                  <div key={k} className={`dropdown-item ${think === k ? 'active' : ''}`} onClick={() => { setThink(k); setThinkOpen(false) }}>
                    {THINK_ICONS[k]} {k}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="input-right">
          <label className="upload-btn" title={supportsVision ? '上传图片' : '当前模型不支持视觉'}>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={handleImagePick} />
            <span style={{ opacity: supportsVision ? 1 : 0.3 }}>📷</span>
          </label>

          {models.length > 0 ? (
            <select className="model-select" value={currentModel} onChange={e => {
              const idx = models.indexOf(e.target.value)
              if (idx >= 0 && providers[0]) useSettingsStore.getState().updateProvider(providers[0].id, { selectedModel: e.target.value })
            }}>{models.map(m => <option key={m} value={m}>{m}</option>)}</select>
          ) : <span className="model-tag">{currentModel}</span>}

          <svg width="20" height="20"><title>{contextUsed}/{contextLimit} tokens</title>
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--bg-hover)" strokeWidth="2" />
            <circle cx="10" cy="10" r="8" fill="none" stroke={ctxColor} strokeWidth="2"
              strokeDasharray={`${ctxRatio * 50} 50`} transform="rotate(-90 10 10)" strokeLinecap="round" />
          </svg>

          <button className="send-btn" onClick={handleSend} disabled={!text.trim() && !images.length}>
            {streaming ? '···' : '↑'}
          </button>
        </div>
      </div>
    </div>
  )
}
