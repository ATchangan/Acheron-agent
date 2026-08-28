import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Copy, Check, GitPullRequest } from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import { ConversationTurn, ThinkingRow } from './ConversationThread'
import { ZoomLayer } from './zoom'
import ClarifyCard from './ClarifyCard'
import InlinePlanApproval from './InlinePlanApproval'
import { isNearBottom, latestAssistantText } from '../store/chat-view-utils'
import { resolveDisplay } from '../store/display'
import type { Message } from '../global'

// 单条消息渲染错误边界: 某条消息渲染异常时降级为纯文本, 防止拖垮整个渲染进程
class MsgBoundary extends React.Component<{ children: React.ReactNode }, { err: boolean }> {
  state = { err: false }
  static getDerivedStateFromError() { return { err: true } }
  componentDidCatch(e: unknown) { console.error('[MsgBoundary]', e) }
  render() {
    if (this.state.err) {
      return <div className="hq-msg-error">这条消息渲染异常，已折叠显示</div>
    }
    return this.props.children
  }
}

// 回合制: 用户气泡 + 其后助手内容平铺
type Turn = { id: string; user?: Message; blocks: Message[] }

// v0.3.6 P0-1: 消息列表独立组件 —— 只订阅消息/流式/阶段相关状态,
// ChatView 不再订阅 streamText, 流式 chunk 更新时只有本组件及流式块参与渲染。
export default function MessageList(): JSX.Element {
  const session = useChatStore(s => s.cur())
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const stage = useChatStore(s => s.stage)
  const stall = useChatStore(s => s.stall)
  const myStall = session?.id ? stall[session.id] : undefined
  const continueStalled = useChatStore(s => s.continueStalled)
  const stop = useChatStore(s => s.stop)
  const streamText = useChatStore(s => s.streamText)
  const streamingText = useChatStore(s => !!s.streamText)
  const fileChanges = useChatStore(s => s.fileChanges)
  const lastTaskId = useChatStore(s => s.lastTaskId)
  const msgs = session?.messages || []
  const disp = resolveDisplay(useSettingsStore(s => s.general.uiDisplay))

  const endRef = useRef<HTMLDivElement>(null)
  const listBox = useRef({ el: null as HTMLDivElement | null })
  const rafScroll = useRef<number | null>(null)
  // 跟随滚动: 发送指令后强制回到底部并跟随输出最后一行; 用户手动上滑后停止跟随
  const followRef = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [copiedLast, setCopiedLast] = useState(false)
  // 流式停滞检测：有流式文字但 2 秒无新 token → 显示「等待响应」计时
  const [stallActive, setStallActive] = useState(false)
  const [stallSec, setStallSec] = useState(0)
  const lastStreamLen = useRef(-1)

  useEffect(() => {
    if (!streaming) { setStallActive(false); setStallSec(0); return }
    const len = streamText.length
    if (len !== lastStreamLen.current) {
      lastStreamLen.current = len
      setStallActive(false)
      setStallSec(0)
    }
  }, [streamText, streaming])

  useEffect(() => {
    if (!streaming || stallActive || !streamingText) return
    const id = window.setTimeout(() => setStallActive(true), 2000)
    return () => window.clearTimeout(id)
  }, [streamText, streaming, stallActive, streamingText])

  useEffect(() => {
    if (!stallActive) return
    const id = window.setInterval(() => setStallSec(s => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [stallActive])

  const syncScrollBtn = useCallback(() => {
    const list = listBox.current.el
    if (!list) return
    const nb = isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight)
    followRef.current = nb
    setShowScrollBtn(!nb)
  }, [])

  const setListRef = useCallback((el: HTMLDivElement | null) => {
    if (listBox.current.el === el) return
    if (listBox.current.el) listBox.current.el.removeEventListener('scroll', syncScrollBtn)
    listBox.current.el = el
    if (el) el.addEventListener('scroll', syncScrollBtn, { passive: true })
  }, [syncScrollBtn])

  useEffect(() => {
    const list = listBox.current.el
    if (!list) return
    if (followRef.current) {
      if (rafScroll.current !== null) cancelAnimationFrame(rafScroll.current)
      rafScroll.current = requestAnimationFrame(() => {
        rafScroll.current = null
        list.scrollTop = list.scrollHeight
      })
    }
  }, [msgs, stage, streamText])
  useEffect(() => () => { if (rafScroll.current !== null) cancelAnimationFrame(rafScroll.current) }, [])

  // 发送指令后: 恢复跟随并强制回到底部 (用户上滑后再次发送, 也重新跟随)
  useEffect(() => {
    const onFollow = () => {
      followRef.current = true
      const list = listBox.current.el
      if (list) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight })
    }
    window.addEventListener('huangquan-follow-scroll', onFollow)
    return () => window.removeEventListener('huangquan-follow-scroll', onFollow)
  }, [])

  useEffect(() => {
    const list = listBox.current.el
    if (!list) return
    if (!isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight)) setShowScrollBtn(true)
  }, [msgs.length, stage])

  const copyLastReply = async () => {
    const live = useChatStore.getState().streamText
    const target = (live && live.trim()) ? live : lastReply
    if (!target) return
    try {
      if (navigator.clipboard && document.hasFocus()) {
        await navigator.clipboard.writeText(target)
      } else {
        throw new Error('clipboard-unavailable')
      }
    } catch {
      const ta = document.createElement('textarea')
      ta.value = target
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    setCopiedLast(true)
    setTimeout(() => setCopiedLast(false), 1500)
  }

  const lastReply = latestAssistantText(msgs, '')

  // 工具结果映射: call_id -> 结果内容 (工具行展开用)
  const toolResults = useMemo(() => {
    const map = new Map<string, { content: string; timestamp: number }>()
    for (const m of msgs) if (m.role === 'tool' && m.tool_call_id) map.set(m.tool_call_id, { content: m.content || '', timestamp: m.timestamp })
    return map
  }, [msgs])

  useEffect(() => {
    const id = requestAnimationFrame(() => syncScrollBtn())
    return () => cancelAnimationFrame(id)
  }, [msgs, syncScrollBtn])

  // 回合构建: 用户消息开启新回合, 其后 assistant 内容(含工具步骤/最终回复/流式占位)依次平铺
  const turns = useMemo(() => {
    const out: Turn[] = []
    let cur: Turn | null = null
    for (const m of msgs) {
      if (m.role === 'user') {
        cur = { id: m.id, user: m, blocks: [] }
        out.push(cur)
        continue
      }
      if (m.role === 'assistant') {
        if (!cur) { cur = { id: 'lead-' + m.id, blocks: [] }; out.push(cur) }
        cur.blocks.push(m)
        continue
      }
      // tool 结果已折叠进 toolResults, 不单独占一行
      if (!cur) { cur = { id: 'tail-' + m.id, blocks: [] }; out.push(cur) }
    }
    return out
  }, [msgs])

  const streamingPlaceholder = msgs.some(m => m._streaming)
  const lastMsg = msgs.slice(-1)[0]
  const isGeneratingText = streaming && !!lastMsg?.content && lastMsg.content.length > 0
  let lastToolT = 0, lastAsstT = 0
  for (const m of msgs) { if (m.role === 'tool') lastToolT = m.timestamp; else if (m.role === 'assistant') lastAsstT = m.timestamp }
  const isToolWorking = (streaming || executing) && lastToolT > 0 && lastToolT > lastAsstT

  // 思考状态行: 仅在没有流式文字、且阶段为 thinking 时出现
  const renderThinkingRow = () => {
    const isActive = streaming || executing
    if (!isActive) return null
    if (streamingText || streamingPlaceholder) return null
    if (isGeneratingText) return null
    const myStage = stage && stage.sid === session?.id ? stage : null
    const phase = myStage?.phase || (isToolWorking ? 'tool' : 'thinking')
    if (phase === 'tool') return null
    return (
      <ThinkingRow
        label={myStage?.label || '思考中'}
        detail={myStage?.detail || ''}
      />
    )
  }

  return (
    <div className="chat-messages-wrap">
      <div className="message-list hq-thread-viewport" ref={setListRef}>
        <div className="hq-thread-content">
          {turns.map(turn => (
            <MsgBoundary key={turn.id}>
              <ConversationTurn
                user={turn.user}
                blocks={turn.blocks}
                toolResults={toolResults}
                executing={executing}
              />
            </MsgBoundary>
          ))}
          {/*  clarify：模型提问选项卡 */}
          <ClarifyCard />
          {/* 行内计划审批（替代顶部计划卡） */}
          <InlinePlanApproval />
          {/* 改动文件卡：回合末尾 */}
          {fileChanges > 0 && lastTaskId && (
            <div className="hq-changed-card">
              <div className="hq-changed-card-head">
                <GitPullRequest size={13} />
                <span>该任务改动了 {fileChanges} 个文件</span>
                <span className="hq-changed-card-sub">可回滚到任务开始前的状态</span>
              </div>
              <div className="hq-changed-card-actions">
                <button type="button" className="hq-btn hq-btn-accent" onClick={async () => {
                  try {
                    const r = await window.huangquan.rollback.apply(lastTaskId)
                    useChatStore.setState({ fileChanges: 0, lastTaskId: '' })
                    alert(r.ok ? ('已回滚 ' + (r.restored || 0) + ' 个文件') : ('回滚失败：' + (r.error || '')))
                  } catch { useChatStore.setState({ fileChanges: 0, lastTaskId: '' }) }
                }}>回滚文件改动</button>
                <button type="button" className="hq-btn" onClick={() => useChatStore.setState({ fileChanges: 0, lastTaskId: '' })}>忽略</button>
              </div>
            </div>
          )}
          {/* v0.4.4 无进展停滞横幅：继续/中止 */}
          {myStall && myStall.active && (
            <div className="hq-stall-banner" role="status">
              <span className="hq-status-pulse" />
              <span className="hq-stall-label">疑似停滞（{Math.floor(myStall.elapsedMs / 1000)}s 无产出）</span>
              <button type="button" className="hq-btn" onClick={() => continueStalled()}>继续</button>
              <button type="button" className="hq-btn hq-btn-accent" onClick={() => stop()}>中止</button>
            </div>
          )}
          {renderThinkingRow()}
          {stallActive && !isToolWorking && (
            <div className="hq-status-row" role="status">
              <span className="hq-status-pulse" />
              <span className="hq-status-label">等待响应</span>
              <span className="hq-status-timer">{stallSec}s</span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      {showScrollBtn && (
        <button className="chat-fab chat-scroll-btn" title="回到底部" onClick={() => {
          const list = listBox.current.el
          followRef.current = true
          if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
        }}>↓</button>
      )}
      {!disp.hideCopyButtons && lastReply && (
        <button className={`chat-fab chat-copy-last-btn${copiedLast ? ' copied' : ''}`}
          title={copiedLast ? '已复制最后回复' : '复制最后回复（原文 Markdown）'} onClick={copyLastReply}>
          {copiedLast ? <Check size={15} /> : <Copy size={15} />}
        </button>
      )}
      <ZoomLayer />
    </div>
  )
}
