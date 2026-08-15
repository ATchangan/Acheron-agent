import React, { useState } from 'react'
import { Check, X, Loader2, Pause, Circle, CircleSlash, ChevronRight, ChevronDown, Folder } from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import ChatInput from './ChatInput'
import MessageList from './MessageList'
import { U } from './ui-styles'
import { fmtDur } from './work-steps'
import { resolveDisplay } from '../store/display'
import { compileStatusLine } from '../store/display'
import { useModelItems } from './useModelItems'

// v0.3.6 P0-1: ChatView 只负责头部/空态/错误/输入区,
// 消息列表与流式渲染完全下沉到 MessageList, 不再订阅 streamText。
export default function ChatView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const streaming = useChatStore(s => s.streaming)
  const executing = useChatStore(s => s.executing)
  const error = useChatStore(s => s.error)
  const errorStep = useChatStore(s => s.errorStep)
  const fileChanges = useChatStore(s => s.fileChanges)
  const lastTaskId = useChatStore(s => s.lastTaskId)
  const activeAgents = useChatStore(s => s.activeAgents)
  const orphanTasks = useChatStore(s => s.orphanTasks)
  const restoreTask = useChatStore(s => s.restoreTask)
  const plansMap = useChatStore(s => s.plans)
  const sessionId = useChatStore(s => s.cur()?.id ?? null)
  const msgCount = useChatStore(s => s.cur()?.messages.length ?? 0)
  const plan = sessionId ? plansMap[sessionId] : undefined
  const providers = useSettingsStore(s => s.providers)
  const mode = useSettingsStore(s => s.general.mode || 'work')
  const workDir = useSettingsStore(s => s.general.workDir)
  const hasProvider = providers.some(p => p.apiKey)
  const disp = resolveDisplay(useSettingsStore(s => s.general.uiDisplay))
  const { curModelName } = useModelItems()
  const contextUsed = useChatStore(s => s.cu)
  const contextLimit = useChatStore(s => s.cl)
  const sessTokMap = useChatStore(s => s.sessTok)
  const fmtK = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
  const tokSum = React.useMemo(() => {
    const m = (sessionId && sessTokMap[sessionId]) || {}
    let input = 0, output = 0
    for (const c of Object.values(m)) { input += c.inputTokens || 0; output += c.outputTokens || 0 }
    return { input, output }
  }, [sessTokMap, sessionId])
  const statusLine = disp.statusLine ? compileStatusLine(disp.statusLine, {
    workDir: workDir ? String(workDir.split(/[/\\]/).pop()) : '',
    model: curModelName || '',
    context: contextLimit > 0 ? Math.round(contextUsed / 102.4) / 10 + 'K/' + Math.round(contextLimit / 102.4) / 10 + 'K' : '',
    tokens: '入' + fmtK(tokSum.input) + '/出' + fmtK(tokSum.output),
    agents: activeAgents.join(' '),
  }) : ''
  const [showDoneSteps, setShowDoneSteps] = useState(false)

  const jumpToMsg = (mid: string) => {
    const el = document.querySelector(`[data-message-id="${mid}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const retryLast = async () => {
    useChatStore.setState({ error: null })
    const cur = useChatStore.getState().cur()
    if (!cur || cur.streaming || cur.busy) return
    for (let i = cur.messages.length - 1; i >= 0; i--) {
      const m = cur.messages[i]
      if (m.role === 'user') { await useChatStore.getState().resendFrom(m.id); return }
    }
  }

  const empty = !sessionId || msgCount === 0

  return (
    <>
      <div className="chat-header-tab">
        {statusLine ? (
          <span style={{ marginLeft: 8, fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{statusLine}</span>
        ) : (
          <>
            {workDir && mode === 'work' && <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)', marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }} title={workDir}><Folder size={12} />{workDir.split(/[/\\]/).pop()}</span>}
            {(streaming || executing) && activeAgents.length > 0 && (
              <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8, flexWrap: 'wrap' }}>
                {activeAgents.map(a => (
                  <span key={a} style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 'calc(var(--ui-font-size) - 3px)', background: 'rgba(var(--skin-accent),.12)', border: '1px solid rgba(var(--skin-accent),.28)', borderRadius: 10, padding: '1px 8px' }}>● {a}</span>
                ))}
              </span>
            )}
          </>
        )}
      </div>

      {orphanTasks.length > 0 && (
        <div className="error-bar" style={U.wrap8}>
          <span>上次退出时有 {orphanTasks.length} 个任务未完成：</span>
          {orphanTasks.slice(0, 3).map(t => (
            <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.content}>{String(t.content || '').slice(0, 40)}</span>
              {t.planProgress && <span style={U.textMuted}>已完成 {t.planProgress}</span>}
              <button className="tab-btn active" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={() => restoreTask(t.id)}>恢复</button>
              <button className="tab-btn" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={async () => { await window.huangquan.tasks.finish(t.id, 'aborted', '用户忽略'); useChatStore.setState(s => ({ orphanTasks: s.orphanTasks.filter(x => x.id !== t.id) })) }}>忽略</button>
            </span>
          ))}
          {orphanTasks.length > 3 && <span style={U.textMuted}>…</span>}
          <button className="tab-btn" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)', marginLeft: 'auto' }} onClick={async () => {
            for (const t of orphanTasks) await window.huangquan.tasks.finish(t.id, 'aborted', '用户忽略').catch(() => {})
            useChatStore.setState({ orphanTasks: [] })
          }}>全部忽略</button>
        </div>
      )}

      {!disp.hidePlanCards && plan && sessionId && (
        <div className="plan-card" style={U.wrap8}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0 }}>
            <span style={U.b600}>执行计划</span>
            {(() => {
              const total = plan.steps.length
              const done = plan.steps.filter(s => s.status === 'done').length
              const failed = plan.steps.filter(s => s.status === 'failed' || s.status === 'aborted').length
              const aborted = plan.steps.filter(s => s.status === 'aborted').length
              const terminal = total > 0 && done + failed === total
              const label = plan.pending ? '等待批准' : (!total || terminal ? (aborted > 0 ? '已中止' : '已完成') : `执行中 ${done}/${total}`)
              const color = plan.pending ? 'var(--accent)' : (terminal ? (aborted > 0 ? 'var(--text-secondary)' : 'var(--accent-green)') : 'var(--accent)')
              return (
                <span style={{ flex: 'none', color, background: 'rgba(var(--skin-accent),.10)', border: '1px solid rgba(var(--skin-accent),.28)', borderRadius: 10, padding: '0 8px', fontSize: 'calc(var(--ui-font-size) - 3px)' }}>
                  {label}{failed > 0 && !plan.pending ? ` · ${failed} 失败` : ''}
                </span>
              )
            })()}
            {plan.summary && <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }} title={plan.summary}>{plan.summary}</span>}
            <button className="tab-btn" style={{ marginLeft: 'auto', padding: '0 8px', fontSize: 'calc(var(--ui-font-size) - 1px)' }} title="关闭计划面板" onClick={() => useChatStore.setState(s => { const pp = { ...s.plans }; delete pp[sessionId]; return { plans: pp } })}>×</button>
          </div>
          {plan.steps.length > 0 && (
            <div style={{ width: '100%', maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {plan.steps.filter(s => s.status !== 'done').map(s => {
                const color = s.status === 'running' ? 'var(--accent)' : s.status === 'failed' ? 'var(--danger)' : s.status === 'paused' ? 'var(--text-secondary)' : 'var(--text-muted)'
                return (
                  <div key={s.id} onClick={s.messageId ? () => jumpToMsg(s.messageId!) : undefined} title={(s.messageId ? '点击跳转到执行记录' : '') + (s.expected ? '\n预期: ' + s.expected : '')} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 'calc(var(--ui-font-size) - 2px)', minWidth: 0, cursor: s.messageId ? 'pointer' : 'default' }}>
                    <span style={{ color, width: 16, display: 'inline-flex', justifyContent: 'center', flex: 'none' }}>
                      {s.status === 'running' ? <Loader2 size={12} className="hq-spin" /> : s.status === 'failed' ? <X size={12} /> : s.status === 'aborted' ? <CircleSlash size={12} /> : s.status === 'paused' ? <Pause size={12} /> : <Circle size={10} />}
                    </span>
                    <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                    {s.tool && <span style={{ flex: 'none', color: 'var(--text-secondary)', background: 'rgba(var(--skin-accent),.10)', border: '1px solid rgba(var(--skin-accent),.25)', borderRadius: 8, padding: '0 6px', fontSize: 'calc(var(--ui-font-size) - 4px)' }}>{s.tool}</span>}
                    {s.detail && <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, fontSize: 'calc(var(--ui-font-size) - 3px)' }} title={s.detail}>{s.detail}</span>}
                    {s.ms != null && <span style={{ flex: 'none', color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 3px)' }}>{fmtDur(s.ms)}</span>}
                  </div>
                )
              })}
              {plan.steps.filter(s => s.status === 'done').length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button className="tab-btn" style={{ padding: '0 6px', fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-secondary)' }} onClick={() => setShowDoneSteps(v => !v)}>
                    {showDoneSteps ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 已完成 {plan.steps.filter(s => s.status === 'done').length} 步
                  </button>
                </div>
              )}
              {showDoneSteps && plan.steps.filter(s => s.status === 'done').map(s => (
                <div key={s.id} onClick={s.messageId ? () => jumpToMsg(s.messageId!) : undefined} title={s.messageId ? '点击跳转到执行记录' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 'calc(var(--ui-font-size) - 2px)', minWidth: 0, cursor: s.messageId ? 'pointer' : 'default' }}>
                  <span style={{ color: 'var(--accent-green)', width: 16, display: 'inline-flex', justifyContent: 'center', flex: 'none' }}><Check size={12} /></span>
                  <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                  {s.tool && <span style={{ flex: 'none', color: 'var(--text-secondary)', background: 'rgba(var(--skin-accent),.10)', border: '1px solid rgba(var(--skin-accent),.25)', borderRadius: 8, padding: '0 6px', fontSize: 'calc(var(--ui-font-size) - 4px)' }}>{s.tool}</span>}
                  {s.ms != null && <span style={{ flex: 'none', color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 3px)' }}>{fmtDur(s.ms)}</span>}
                </div>
              ))}
            </div>
          )}
          {plan.pending && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, width: '100%' }}>
              <button className="tab-btn" style={U.px12} onClick={async () => { await window.huangquan.engine.reject(sessionId); useChatStore.setState(s => { const pp = { ...s.plans }; delete pp[sessionId]; return { plans: pp } }) }}>拒绝</button>
              <button className="tab-btn active" style={U.px12} onClick={async () => { useChatStore.setState(s => ({ plans: { ...s.plans, [sessionId]: { ...s.plans[sessionId], pending: false } } })); await window.huangquan.engine.approve(sessionId) }}>批准执行</button>
            </div>
          )}
        </div>
      )}

      {fileChanges > 0 && lastTaskId && (
        <div className="error-bar" style={U.wrap8}>
          <span>该任务修改了 {fileChanges} 个文件，可回滚到任务开始前的状态</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <button className="tab-btn" style={U.px12} onClick={async () => {
              try {
                const r = await window.huangquan.rollback.apply(lastTaskId)
                useChatStore.setState({ fileChanges: 0, lastTaskId: '' })
                alert(r.ok ? ('已回滚 ' + (r.restored || 0) + ' 个文件') : ('回滚失败：' + (r.error || '')))
              } catch { useChatStore.setState({ fileChanges: 0, lastTaskId: '' }) }
            }}>回滚文件改动</button>
            <button className="tab-btn" style={{ padding: '0 6px' }} title="关闭提示" onClick={() => useChatStore.setState({ fileChanges: 0, lastTaskId: '' })}>×</button>
          </span>
        </div>
      )}

      {!hasProvider ? (
        <div className="chat-center-empty">
          <h1>助手</h1><p>请先在「模型服务」中配置一个服务商</p>
          <button className="btn-primary" style={U.mt8} onClick={() => onNavigate('settings')}>前往设置</button>
        </div>
      ) : empty ? (
        <div className="chat-center-empty">
          <h1>助手</h1>
          <p>{mode === 'chat' ? '雨停了没多久。你是循着声音来的，还是碰巧路过？' : '说吧，这次要处理什么？'}</p>
          <span className="memory-badge">{mode === 'chat' ? '● 聊天模式' : '● 工作模式'}</span>
        </div>
      ) : (
        <MessageList />
      )}
      {!empty && error && (
        <div className="error-bar">
          <span>{error}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {errorStep?.messageId && <button className="tab-btn" style={{ padding: '1px 10px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={() => jumpToMsg(errorStep.messageId!)}>定位失败步骤</button>}
            <button className="tab-btn" style={{ padding: '1px 12px', fontSize: 'calc(var(--ui-font-size) - 2px)' }} onClick={retryLast}>重试</button>
            <button onClick={() => useChatStore.setState({ error: null })}>×</button>
          </span>
        </div>
      )}
      {hasProvider && <ChatInput />}
    </>
  )
}
