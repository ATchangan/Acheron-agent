// ClarifyCard.tsx —— v0.4.2  clarify 交互：模型提问时展示可点选选项，选择/回答回传引擎
import React, { useState } from 'react'
import { HelpCircle, Send, X } from 'lucide-react'
import { useChatStore } from '../store/chat'

const letterFor = (i: number) => String.fromCharCode(65 + i)

export default function ClarifyCard() {
  const req = useChatStore(s => s.clarifyReq)
  const cid = useChatStore(s => s.cid)
  const [custom, setCustom] = useState('')
  const [sent, setSent] = useState(false)

  if (!req || req.sid !== cid || sent) return null

  const respond = async (answer: string) => {
    setSent(true)
    await window.huangquan.engine.clarifyRespond(req.sid, answer).catch(() => {})
    useChatStore.setState({ clarifyReq: null })
  }

  return (
    <div className="hq-clarify">
      <div className="hq-clarify-head">
        <HelpCircle size={14} />
        <span className="hq-clarify-question">{req.question}</span>
      </div>
      {req.choices.length > 0 && (
        <div className="hq-clarify-options">
          {req.choices.map((c, i) => (
            <button key={c} type="button" className="hq-clarify-option" onClick={() => void respond(c)}>
              <span className="hq-clarify-key">{letterFor(i)}</span>
              <span className="hq-clarify-label">{c}</span>
            </button>
          ))}
        </div>
      )}
      <div className="hq-clarify-other">
        <input
          value={custom}
          onChange={e => setCustom(e.target.value)}
          placeholder={req.choices.length ? '其他（自定义回答）…' : '输入回答…'}
          onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) void respond(custom.trim()) }}
        />
        <button type="button" className="hq-btn hq-btn-accent" disabled={!custom.trim()} onClick={() => void respond(custom.trim())}>
          <Send size={12} /> 发送
        </button>
        <button type="button" className="hq-btn" title="跳过" aria-label="跳过" onClick={() => void respond('')}>
          <X size={12} /> 跳过
        </button>
      </div>
    </div>
  )
}
