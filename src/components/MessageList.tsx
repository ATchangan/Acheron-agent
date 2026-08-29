import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Copy, Check, GitPullRequest, ChevronDown } from 'lucide-react'
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
// ------------------------------------------------------------
// 会话内查找(Ctrl+F): Electron 原生 findInPage, 命中计数/上下跳转
// ------------------------------------------------------------
// ------------------------------------------------------------
// 右缘 prompt 时间线: >=4 个用户回合时出现, 悬停展开预览, 点击跳转
// ------------------------------------------------------------
const TimelineRail: React.FC<{ turns: { id: string; preview: string }[] }> = ({ turns }) => {
  const [hover, setHover] = useState(false)
  const jump = (id: string) => {
    document.querySelector('[data-message-id="' + id + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  if (turns.length < 4) return null
  return (
    <div className="hq-tl-rail" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {turns.map((tt, i) => (
        <button key={tt.id} className="hq-tl-dot hq-tl-num" title={'跳转到第 ' + (i + 1) + ' 条问题'} onClick={() => jump(tt.id)} aria-label={'跳转到第 ' + (i + 1) + ' 条问题'}>{i + 1}</button>
      ))}
      {hover && (
        <div className="hq-tl-pop" role="list">
          {turns.map((tt, i) => (
            <button key={tt.id} role="listitem" onClick={() => jump(tt.id)}><b>第 {i + 1} 条问题</b>{tt.preview}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// v0.6.0 改动摘要卡: 从会话消息里的编辑类工具调用统计 每文件 +/- 行数,
// 展开文件清单; 回滚走既有 rollback.apply(任务级快照)。
type FileStat = { path: string; added: number; removed: number }
const EDIT_TOOLS_SET = new Set(['write', 'edit', 'apply_patch'])
function collectFileStats(msgs: Message[]): FileStat[] {
  const map = new Map<string, FileStat>()
  for (const m of msgs) {
    for (const tc of (m.tool_calls || [])) {
      const name = (tc.function?.name || '').toLowerCase()
      if (!EDIT_TOOLS_SET.has(name)) continue
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.function?.arguments || '{}') as Record<string, unknown> } catch { continue }
      const path = typeof args.path === 'string' ? args.path : typeof (args as { file_path?: unknown }).file_path === 'string' ? (args as { file_path: string }).file_path : ''
      if (!path) continue
      const st = map.get(path) || { path, added: 0, removed: 0 }
      const lines = (v: unknown) => (typeof v === 'string' && v.length ? v.split('\n').length : 0)
      if (name === 'write') st.added += lines(args.content)
      else if (name === 'edit') { st.removed += lines(args.oldText); st.added += lines(args.newText) }
      else if (name === 'apply_patch' && Array.isArray(args.hunks)) {
        for (const h of args.hunks as { oldText?: unknown; newText?: unknown }[]) {
          st.removed += lines(h.oldText)
          st.added += lines(h.newText)
        }
      }
      map.set(path, st)
    }
  }
  return [...map.values()].sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
}

const ChangedSummaryCard: React.FC = () => {
  const session = useChatStore(s => s.cur())
  const lastTaskId = useChatStore(s => s.lastTaskId)
  const [open, setOpen] = useState(false)
  const [rolling, setRolling] = useState(false)
  const stats = useMemo(() => collectFileStats(session?.messages || []), [session?.messages])
  const added = stats.reduce((n, x) => n + x.added, 0)
  const removed = stats.reduce((n, x) => n + x.removed, 0)
  const baseName = (p: string) => p.split(/[\\/]/).pop() || p
  const rollback = async () => {
    setRolling(true)
    try {
      const r = await window.huangquan.rollback.apply(lastTaskId)
      useChatStore.setState({ fileChanges: 0, lastTaskId: '' })
      if (r.ok) window.alert('已回滚 ' + (r.restored || 0) + ' 个文件')
      else window.alert('回滚失败：' + (r.error || ''))
    } catch { useChatStore.setState({ fileChanges: 0, lastTaskId: '' }) }
    setRolling(false)
  }
  if (!stats.length) return null
  return (
    <div className="hq-diff-card" data-changed-card="">
      <button type="button" className="hq-diff-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <GitPullRequest size={13} />
        <span className="hq-diff-title">{stats.length} 个文件已更改</span>
        <span className="hq-diff-plus">+{added}</span>
        <span className="hq-diff-minus">-{removed}</span>
        <span style={{ flex: 1 }} />
        <ChevronDown size={13} className={'hq-act-chevron' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="hq-diff-list">
          {stats.map(f => (
            <div key={f.path} className="hq-diff-file" title={f.path}>
              <span className="hq-diff-name">{baseName(f.path)}</span>
              <span className="hq-diff-dir">{f.path}</span>
              <span className="hq-diff-plus">+{f.added}</span>
              <span className="hq-diff-minus">-{f.removed}</span>
            </div>
          ))}
        </div>
      )}
      <div className="hq-diff-actions">
        <button type="button" className="hq-btn hq-btn-accent" disabled={rolling} onClick={() => { void rollback() }}>{rolling ? '回滚中…' : '撤销本轮改动'}</button>
        <button type="button" className="hq-btn" onClick={() => useChatStore.setState({ fileChanges: 0, lastTaskId: '' })}>忽略</button>
      </div>
    </div>
  )
}

const FindBar: React.FC<{ onClose: () => void }> = ({ onClose }) => {  const [q, setQ] = useState('')
  const [result, setResult] = useState<{ matches: number; active: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const off = window.huangquan.find.onResult(r => setResult(r))
    return off
  }, [])
  useEffect(() => {
    const id = window.setTimeout(() => { void window.huangquan.find.start(q) }, 150)
    return () => window.clearTimeout(id)
  }, [q])
  const jump = (forward: boolean) => { if (q) void window.huangquan.find.start(q, forward) }
  return (
    <div className="hq-findbar" role="search">
      <input
        ref={inputRef}
        value={q}
        placeholder="在会话中查找…"
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); jump(!e.shiftKey) }
          else if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
      />
      <span className="hq-findbar-count">{result ? (result.matches ? (result.active + '/' + result.matches) : '无结果') : ''}</span>
      <button title="上一个 (Shift+Enter)" onClick={() => jump(false)}>↑</button>
      <button title="下一个 (Enter)" onClick={() => jump(true)}>↓</button>
      <button title="关闭 (Esc)" onClick={onClose}>×</button>
    </div>
  )
}

export default function MessageList(): JSX.Element {
  const session = useChatStore(s => s.cur())
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const stage = useChatStore(s => s.stage)
  const stall = useChatStore(s => s.stall)
  const myStall = session?.id ? stall[session.id] : undefined
  const continueStalled = useChatStore(s => s.continueStalled)
  const stop = useChatStore(s => s.stop)
  // v0.4.5 订阅隔离: MessageList 不再订阅整块 streamText(否则每个 delta 都重渲染整个列表);
  // 流式增长通过 hq-stream-grew 窗口事件驱动跟滚/停滞计时, 文本仅由 StreamingMarkdown 叶子消费
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
  // 会话内查找(Ctrl+F)
  const [findOpen, setFindOpen] = useState(false)
  const closeFind = useCallback(() => { setFindOpen(false); void window.huangquan.find.stop() }, [])
  // v0.4.5 渲染预算分页: 默认只挂载最近 16 个回合, "加载更早"按 12 个回合金字塔回填
  const [visibleTurns, setVisibleTurns] = useState(16)
  const loadOlder = useCallback(() => {
    const list = listBox.current.el
    const beforeH = list?.scrollHeight || 0
    const beforeTop = list?.scrollTop || 0
    followRef.current = false
    setVisibleTurns(v => v + 12)
    requestAnimationFrame(() => { if (list) list.scrollTop = list.scrollHeight - beforeH + beforeTop })
  }, [])
  const [copiedLast, setCopiedLast] = useState(false)
  // 流式停滞检测：有流式文字但 2 秒无新 token → 显示「等待响应」计时
  const [stallActive, setStallActive] = useState(false)
  const [stallSec, setStallSec] = useState(0)
  const lastStreamLen = useRef(-1)

  useEffect(() => {
    if (!streaming) { setStallActive(false); setStallSec(0); return }
    const onGrow = () => {
      const len = useChatStore.getState().streamText.length
      if (len !== lastStreamLen.current) {
        lastStreamLen.current = len
        setStallActive(false)
        setStallSec(0)
      }
    }
    window.addEventListener('hq-stream-grew', onGrow)
    return () => window.removeEventListener('hq-stream-grew', onGrow)
  }, [streaming])

  useEffect(() => {
    if (!streaming || stallActive || !streamingText) return
    const id = window.setTimeout(() => setStallActive(true), 2000)
    return () => window.clearTimeout(id)
  }, [streaming, stallActive, streamingText])

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
  }, [msgs, stage])
  // v0.4.5: 流式内容增长(已按帧合批) → 跟随滚动到底
  useEffect(() => {
    const onGrow = () => {
      const list = listBox.current.el
      if (!list || !followRef.current) return
      if (rafScroll.current !== null) cancelAnimationFrame(rafScroll.current)
      rafScroll.current = requestAnimationFrame(() => {
        rafScroll.current = null
        list.scrollTop = list.scrollHeight
      })
    }
    window.addEventListener('hq-stream-grew', onGrow)
    return () => window.removeEventListener('hq-stream-grew', onGrow)
  }, [])
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

  // v0.4.5: Ctrl+F 打开会话内查找
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f') { ev.preventDefault(); setFindOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  // 渲染预算: 只挂载最近 visibleTurns 个回合
  const totalTurns = turns.length
  const shownTurns = totalTurns > visibleTurns ? turns.slice(totalTurns - visibleTurns) : turns
  // 时间线数据: 用户消息(id + 预览)
  const railTurns = useMemo(() => turns.filter(x => x.user).map(x => ({ id: x.user!.id, preview: String(x.user!.content || '').replace(/s+/g, ' ').slice(0, 60) || '(图片/附件)' })), [turns])

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
                    {totalTurns > visibleTurns && (
            <button className="hq-load-older" onClick={loadOlder}>加载更早（还有 {totalTurns - visibleTurns} 个回合）</button>
          )}
{shownTurns.map(turn => (
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
          {/* v0.6.0 改动摘要卡: N 个文件已更改 +x/-y, 可展开文件清单, 可回滚 */}
          {fileChanges > 0 && lastTaskId && <ChangedSummaryCard />}
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
      <TimelineRail turns={railTurns} />
      {findOpen && <FindBar onClose={closeFind} />}
      <ZoomLayer />
    </div>
  )
}
