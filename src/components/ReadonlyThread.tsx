// ReadonlyThread.tsx —— v0.4.2 分栏会话的只读线程：复用回合结构与 Markdown 管线，无编辑/发送交互
import { useEffect, useMemo, useState } from 'react'
import { Check, X, ChevronDown } from 'lucide-react'
import { StreamMarkdown } from './StreamMarkdown'
import type { Message } from '../global'

const fmtClock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

function ReadonlyUserBubble({ message }: { message: Message }) {
  return (
    <div className="ro-user-sticky">
      <div className="ro-user-bubble">
        {message.images?.length ? (
          <div className="ro-user-images">
            {message.images.map((img, i) => <img key={i} src={img} alt="" />)}
          </div>
        ) : null}
        <div className="ro-user-text">{String(message.content || '')}</div>
      </div>
      <span className="ro-stamp">{fmtClock.format(message.timestamp)}</span>
    </div>
  )
}

function ReadonlyToolRow({ tc, result }: {
  tc: { id?: string; function?: { name?: string; arguments?: string } }
  result?: string
}) {
  const [open, setOpen] = useState(false)
  const fn = tc.function || { name: '', arguments: '' }
  const label = fn.name || '工具'
  let args = ''
  try { args = JSON.stringify(JSON.parse(fn.arguments || '{}'), null, 2) } catch { args = fn.arguments || '' }
  const isError = !!result && result.startsWith('E:')
  return (
    <div className={'ro-tool' + (isError ? ' error' : '')}>
      <button type="button" className="ro-tool-head" onClick={() => setOpen(v => !v)}>
        <span className="ro-tool-status">{result ? (isError ? <X size={12} /> : <Check size={12} />) : <span className="ro-tool-pending" />}</span>
        <span className="ro-tool-name">{label}</span>
        <ChevronDown size={12} className={'ro-tool-chev' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="ro-tool-detail">
          {args && <pre className="ro-tool-args">{args}</pre>}
          {result && <pre className={'ro-tool-result' + (isError ? ' error' : '')}>{result.slice(0, 3000)}</pre>}
        </div>
      )}
    </div>
  )
}

export default function ReadonlyThread({ sessionId, pollMs = 0 }: { sessionId: string; pollMs?: number }) {
  const [msgs, setMsgs] = useState<Message[]>([])

  // 非活动会话在 store 中为懒加载(空消息)，这里直接从磁盘加载只读消息
  useEffect(() => {
    let alive = true
    setMsgs([])
    const load = () => {
      window.huangquan.sessions.load(sessionId)
        .then(d => { if (alive && d && Array.isArray(d.messages)) setMsgs(d.messages as Message[]) })
        .catch(() => {})
    }
    load()
    const id = pollMs > 0 ? window.setInterval(load, pollMs) : null
    return () => { alive = false; if (id) window.clearInterval(id) }
  }, [sessionId, pollMs])

  const toolResults = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of msgs) if (m.role === 'tool' && m.tool_call_id) map.set(m.tool_call_id, m.content || '')
    return map
  }, [msgs])

  const turns = useMemo(() => {
    const out: { id: string; user?: Message; blocks: Message[] }[] = []
    let cur: { id: string; user?: Message; blocks: Message[] } | null = null
    for (const m of msgs) {
      if (m.role === 'user') {
        cur = { id: m.id, user: m, blocks: [] }
        out.push(cur)
      } else if (m.role === 'assistant') {
        if (!cur) { cur = { id: 'lead-' + m.id, blocks: [] }; out.push(cur) }
        cur.blocks.push(m)
      }
    }
    return out
  }, [msgs])

  return (
    <div className="ro-thread">
      {turns.length === 0 ? (
        <div className="ro-empty">此会话暂无消息</div>
      ) : (
        turns.map(turn => (
          <div key={turn.id} className="ro-turn">
            {turn.user && <ReadonlyUserBubble message={turn.user} />}
            {turn.blocks.map(m => {
              const content = String(m.content || '')
              const tools = m.tool_calls || []
              return (
                <div key={m.id} className="ro-block">
                  {!!m.reasoning_content && (
                    <details className="ro-reasoning">
                      <summary>思考过程</summary>
                      <StreamMarkdown content={String(m.reasoning_content)} />
                    </details>
                  )}
                  {content ? (
                    <div className="ro-content">
                      <StreamMarkdown content={content} />
                    </div>
                  ) : null}
                  {tools.length > 0 && (
                    <div className="ro-tools">
                      {tools.map((tc, i) => (
                        <ReadonlyToolRow key={tc.id || i} tc={tc} result={toolResults.get(tc.id || '')} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
