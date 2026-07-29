import React, { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'

type FilePerm = 'auto' | 'full' | 'ask' | 'readonly'
type ThinkLevel = 'off' | 'medium' | 'deep' | 'extreme'

const PERM_ICONS: Record<FilePerm, string> = { auto: '🛡️', full: '🔓', ask: '🔒', readonly: '👁️' }
const PERM_LABELS: Record<FilePerm, string> = { auto: '自动', full: '完整', ask: '询问', readonly: '只读' }
const THINK_ICONS: Record<ThinkLevel, string> = { off: '💡', medium: '🔆', deep: '🔥', extreme: '⚡' }

export default function ChatInput() {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const sendMessage = useChatStore(s => s.sendMessage)
  const streaming = useChatStore(s => s.streaming)
  const providers = useSettingsStore(s => s.providers)
  const contextUsed = useChatStore(s => s.contextUsed)
  const contextLimit = useChatStore(s => s.contextLimit)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [cmdOpen, setCmdOpen] = useState(false)
  const [memOpen, setMemOpen] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [thinkOpen, setThinkOpen] = useState(false)
  const [perm, setPerm] = useState<FilePerm>('auto')
  const [think, setThink] = useState<ThinkLevel>('medium')

  const closeAll = () => { setCmdOpen(false); setMemOpen(false); setPermOpen(false); setThinkOpen(false) }
  const [modelIdx, setModelIdx] = useState(0)
  const [memText, setMemText] = useState('')

  const allModels = providers[0]?.models || []
  const currentModel = allModels[modelIdx] || providers[0]?.selectedModel || '未配置'
  const ctxRatio = contextLimit > 0 ? Math.min(contextUsed / contextLimit, 1) : 0
  const ctxColor = ctxRatio > 0.9 ? '#ff4466' : ctxRatio > 0.7 ? '#ffaa00' : 'var(--accent)'

  useEffect(() => {
    const ta = textareaRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px' }
  }, [text])

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return
    const imgs: string[] = []
    for (let i = 0; i < files.length; i++) {
      try {
        const p = (files[i] as any).path
        const b = await window.huangquan.computer.readImageBase64(p)
        if (b) imgs.push(b)
      } catch { /* skip */ }
    }
    setImages(prev => [...prev, ...imgs])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeImage = (i: number) => setImages(prev => prev.filter((_, idx) => idx !== i))

  const handleSend = async () => {
    const trimmed = text.trim()
    if ((!trimmed && images.length === 0) || streaming) return
    if (text.startsWith('/')) {
      await handleSlash(text)
    } else {
      setText('')
      const imgs = images.length > 0 ? [...images] : undefined
      setImages([])
      await sendMessage(trimmed || '分析这张图片', imgs)
    }
  }

  const handleSlash = async (cmd: string) => {
    const createSession = useChatStore.getState().createSession
    setText('')
    switch (cmd) {
      case '/diary':
        await sendMessage('请将本次对话整理为一篇日记，记录关键内容和思考。')
        break
      case '/xing':
        await sendMessage('请从本次对话中提取可复用的工作流程，整理为一份技能指南。')
        break
      case '/compact':
        await sendMessage('请将本次对话的历史进行精简压缩，保留关键信息，去掉冗余内容。')
        break
    }
    setCmdOpen(false)
  }

  const handleSaveMemory = async () => {
    if (!memText.trim()) return
    const mem = await window.huangquan.memory.load()
    mem.facts.push(memText.trim())
    await window.huangquan.memory.save(mem)
    setMemText('')
    setMemOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="chat-input-area">
      {images.length > 0 && (
        <div className="image-attach-preview">
          {images.map((img, i) => (
            <div key={i} className="image-attach-item">
              <img src={img} alt="" />
              <button className="image-attach-remove" onClick={() => removeImage(i)}>×</button>
            </div>
          ))}
        </div>
      )}

      <textarea ref={textareaRef} className="chat-textarea" rows={1}
        placeholder={images.length > 0 ? '描述这张图片...' : '说点什么...'}
        value={text} onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown} disabled={streaming} />

      <div className="input-wrapper">
        {/* 加号 → 快捷指令 */}
        <div className="input-left-icons">
          <div className="dropdown-wrap">
            <button onClick={() => { closeAll(); setCmdOpen(!cmdOpen) }} title="快捷指令">+</button>
            {cmdOpen && (
              <div className="dropdown-menu">
                <div className="dropdown-item" onClick={() => handleSlash('/diary')}>📔 /diary</div>
                <div className="dropdown-item" onClick={() => handleSlash('/xing')}>✨ /xing</div>
                <div className="dropdown-item" onClick={() => handleSlash('/compact')}>🗜️ /compact</div>
              </div>
            )}
          </div>

          {/* 星形 → 记忆管理 */}
          <div className="dropdown-wrap">
            <button onClick={() => { closeAll(); setMemOpen(!memOpen) }} title="记忆">✦</button>
            {memOpen && (
              <div className="dropdown-menu dropdown-wide">
                <input className="dropdown-input" placeholder="保存到记忆..."
                  value={memText} onChange={e => setMemText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveMemory()} />
                <button className="btn-small" onClick={handleSaveMemory} style={{ width: '100%' }}>保存</button>
              </div>
            )}
          </div>

          {/* 盾牌 → 文件权限 */}
          <div className="dropdown-wrap">
            <button onClick={() => { closeAll(); setPermOpen(!permOpen) }} title={`文件权限：${PERM_LABELS[perm]}`}>
              {PERM_ICONS[perm]}
            </button>
            {permOpen && (
              <div className="dropdown-menu">
                {(['auto','full','ask','readonly'] as FilePerm[]).map(m => (
                  <div key={m} className={`dropdown-item ${perm === m ? 'active' : ''}`}
                    onClick={() => { setPerm(m); setPermOpen(false) }}>
                    {PERM_ICONS[m]} {PERM_LABELS[m]}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 灯泡 → 推理强度 */}
          <div className="dropdown-wrap">
            <button onClick={() => { closeAll(); setThinkOpen(!thinkOpen) }} title={`推理强度：${think}`}>
              {THINK_ICONS[think]}
            </button>
            {thinkOpen && (
              <div className="dropdown-menu">
                {(['off','medium','deep','extreme'] as ThinkLevel[]).map(l => (
                  <div key={l} className={`dropdown-item ${think === l ? 'active' : ''}`}
                    onClick={() => { setThink(l); setThinkOpen(false) }}>
                    {THINK_ICONS[l]} {l}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右侧控件 */}
        <div className="input-right">
          {/* 图片上传 */}
          <label className="upload-btn" title="上传图片">
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleImagePick} />
            📷
          </label>

          {/* 模型选择器 */}
          {allModels.length > 0 && (
            <select className="model-select" value={currentModel}
              onChange={e => {
                const idx = allModels.indexOf(e.target.value)
                if (idx >= 0) setModelIdx(idx)
              }}>
              {allModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {allModels.length === 0 && <span className="model-tag">{currentModel}</span>}
          <svg className="context-ring" width="20" height="20">
            <title>{`${contextUsed}/${contextLimit} tokens`}</title>
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--bg-hover)" strokeWidth="2" />
            <circle cx="10" cy="10" r="8" fill="none" stroke={ctxColor} strokeWidth="2"
              strokeDasharray={`${ctxRatio * 50} 50`} transform="rotate(-90 10 10)" strokeLinecap="round" />
          </svg>

          {/* 发送 */}
          <button className="send-btn" onClick={handleSend}
            disabled={(!text.trim() && images.length === 0)}>
            {streaming ? '···' : '↑'}
          </button>
        </div>
      </div>
    </div>
  )
}
