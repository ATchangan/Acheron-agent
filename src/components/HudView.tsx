// HudView.tsx —— v0.4.4 HUD 模式（对齐参考 标题栏「HUD 模式」）
// 迷你常驻输入条小窗（#hud 路由）：输入即发往当前会话，Esc 关闭小窗。
// 回复通过系统通知（设置→通知）与主窗口查看；小窗不重复渲染消息流。
import { useEffect, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { useChatStore } from '../store/chat'

export default function HudView() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => { void window.huangquan.hud.toggle() }

  useEffect(() => {
    const s = useChatStore.getState()
    setBusy(!!s.sessions.find(x => x.id === s.cid)?.busy)
    const t = setInterval(() => {
      const st = useChatStore.getState()
      setBusy(!!st.sessions.find(x => x.id === st.cid)?.busy)
    }, 1500)
    return () => clearInterval(t)
  }, [])

  const send = async () => {
    const t = text.trim()
    if (!t || busy) return
    await useChatStore.getState().send(t)
    setText('')
  }

  return (
    <div className="hud-view">
      <textarea
        autoFocus
        rows={1}
        value={text}
        placeholder={busy ? '任务进行中，发送将排队…（Esc 关闭）' : '有什么要交给助手？（Esc 关闭）'}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); close() }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
        }}
      />
      {busy && !text.trim() ? (
        <button type="button" className="hud-send hud-stop" title="中止任务" onClick={() => useChatStore.getState().stop()}>
          <Square size={13} fill="currentColor" />
        </button>
      ) : (
        <button type="button" className="hud-send" title={busy ? '排队为后续修改' : '发送'} disabled={!text.trim()} onClick={() => { void send() }}>
          <ArrowUp size={15} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
