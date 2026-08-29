// StatusBar.tsx —— v0.4.2 底部状态栏：左簇(模式/模型/会话/工作目录) + 上下文用量 + 右簇(版本/命令面板)
import React, { useEffect, useRef, useState } from 'react'
import { Monitor } from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import { useModelItems } from './useModelItems'
import { resolveDisplay, compileStatusLine } from '../store/display'
import { Command, X, Zap } from 'lucide-react'
import type { ContextSnapshot } from '../global'

export default function StatusBar({ hidden, onToggleHidden }: { hidden: boolean; onToggleHidden: () => void }) {
  const { curModelName } = useModelItems()
  const workDir = useSettingsStore(s => s.general.workDir)
  const sessionCount = useChatStore(s => s.sessions.length)
  const contextUsed = useChatStore(s => s.cu)
  const contextLimit = useChatStore(s => s.cl)
  const sessTokMap = useChatStore(s => s.sessTok)
  const cid = useChatStore(s => s.cid)
  const activeAgents = useChatStore(s => s.activeAgents)
  const streaming = useChatStore(s => s.streaming)
  const streamText = useChatStore(s => s.streamText)
  const progress = useChatStore(s => s.progress)
  const stall = useChatStore(s => s.stall)
  const stop = useChatStore(s => s.stop)
  const continueStalled = useChatStore(s => s.continueStalled)
  const disp = resolveDisplay(useSettingsStore(s => s.general.uiDisplay))
  const [ver, setVer] = useState('')
  const [host, setHost] = useState('')
  const [ctxOpen, setCtxOpen] = useState(false)
  const ctxRef = useRef<HTMLDivElement>(null)
  const [ctxSnap, setCtxSnap] = useState<ContextSnapshot | null>(null)
  const [hiddenIds, setHiddenIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('hq_statusbar_hidden') || '[]') } catch { return [] }
  })
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    try {
      window.huangquan?.appInfo?.().then(i => setVer(i.version)).catch(() => {})
      // v0.4.4: 状态栏左侧显示设备名（对齐参考）
      window.huangquan?.computer?.systemInfo?.().then(i => setHost(String(i.hostname || ''))).catch(() => {})
    } catch { /* 非 Electron 环境忽略 */ }
  }, [])

  useEffect(() => {
    if (!ctxOpen) return
    const onDown = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ctxOpen])

  // v0.4.3 上下文内容可见: 点开明细时拉取"它心里装着什么"
  useEffect(() => {
    if (ctxOpen && cid) {
      window.huangquan.engine.contextSnapshot(cid).then(s => setCtxSnap(s as ContextSnapshot | null)).catch(() => setCtxSnap(null))
    } else { setCtxSnap(null) }
  }, [ctxOpen, cid])

  const ratio = contextLimit > 0 ? Math.min(contextUsed / contextLimit, 1) : 0
  const ctxColor = ratio > 0.9 ? 'var(--danger)' : ratio > 0.7 ? 'var(--warning)' : 'var(--accent)'
  const fmtK = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))

  // v0.4.4 长任务进度: 记录最近一次进度事件时间戳, 每秒重算"已运行", 避免长工具期间冻结
  const setProgTick = useState(0)[1]
  const progAt = useRef(0)
  const prog = cid ? progress[cid] : undefined
  const st = cid ? stall[cid] : undefined
  useEffect(() => { if (prog) { progAt.current = Date.now(); setProgTick(t => t + 1) } }, [prog, cid])
  useEffect(() => {
    if (!prog) return
    const id = setInterval(() => setProgTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [prog, cid])
  const progElapsed = prog ? prog.elapsedMs + (Date.now() - progAt.current) : 0
  const fmtHms = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
  }

  // 当前会话输入/输出 token 统计
  const tokSum = React.useMemo(() => {
    const m = (cid && sessTokMap[cid]) || {}
    let input = 0
    let output = 0
    for (const c of Object.values(m)) { input += c.inputTokens || 0; output += c.outputTokens || 0 }
    return { input, output }
  }, [sessTokMap, cid])

  const toggleHidden = (id: string) => {
    const next = hiddenIds.includes(id) ? hiddenIds.filter(x => x !== id) : [...hiddenIds, id]
    setHiddenIds(next)
    localStorage.setItem('hq_statusbar_hidden', JSON.stringify(next))
  }
  const resetHidden = () => { setHiddenIds([]); localStorage.removeItem('hq_statusbar_hidden') }
  const vis = (id: string) => !hiddenIds.includes(id)

  // 右键自定义菜单：点击外部关闭
  useEffect(() => {
    if (!ctxMenu) return
    const onDown = () => setCtxMenu(null)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ctxMenu])

  // Token 输出速度（估算）：流式输出时每 500ms 采样字符增量，中英混合按 ~1.5 字符/token 折算
  const [outSpeed, setOutSpeed] = useState(0)
  const speedSamples = useRef<number[]>([])
  const lastSample = useRef({ len: 0, ts: 0 })

  useEffect(() => {
    if (!streaming) {
      setOutSpeed(0)
      speedSamples.current = []
      lastSample.current = { len: streamText.length, ts: 0 }
      return
    }
    const now = Date.now()
    const last = lastSample.current
    if (last.ts === 0) {
      lastSample.current = { len: streamText.length, ts: now }
      return
    }
    const dt = now - last.ts
    if (dt >= 500) {
      const cps = Math.max(0, streamText.length - last.len) / (dt / 1000)
      const tps = cps / 1.5
      const buf = [...speedSamples.current.slice(-5), tps]
      speedSamples.current = buf
      lastSample.current = { len: streamText.length, ts: now }
      setOutSpeed(buf.reduce((a, b) => a + b, 0) / buf.length)
    }
  }, [streamText, streaming])

  // 用户自定义状态行模板(${model}/${workDir}/${context}/${tokens}/${agents})
  const statusLine = disp.statusLine ? compileStatusLine(disp.statusLine, {
    workDir: workDir ? String(workDir.split(/[/\\]/).pop()) : '',
    model: curModelName || '',
    context: contextLimit > 0 ? Math.round(contextUsed / 102.4) / 10 + 'K/' + Math.round(contextLimit / 102.4) / 10 + 'K' : '',
    tokens: '入' + fmtK(tokSum.input) + '/出' + fmtK(tokSum.output),
    agents: activeAgents.join(' '),
  }) : ''

  if (hidden) return null

  return (
    <footer
      className="app-statusbar"
      onContextMenu={e => {
        e.preventDefault()
        setCtxMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {/* 左簇: 设备名 + 引擎状态（对齐参考: [icon] ROG / 网关 就绪） */}
      <div className="hq-sb-cluster">
        {vis('mode') && (
          <span className="sb-item" title="本机设备">
            <Monitor size={11} />
            {host || '本机'}
          </span>
        )}
        <span className="sb-item" title="引擎状态">
          <span className="sb-dot" />
          引擎 就绪
        </span>
        {statusLine && vis('statusline') && <span className="sb-item" title="自定义状态行">{statusLine}</span>}
        {vis('sessions') && (
          <span className="sb-item" title="会话数量">
            会话 {sessionCount}
          </span>
        )}
        {vis('dir') && workDir && (
          <span className="sb-item sb-dir" title={workDir}>
            {workDir.split(/[/\\]/).pop()}
          </span>
        )}
      </div>

      <span className="sb-spacer" />

      {/* 右簇 */}
      <div className="hq-sb-cluster">
        {/* v0.4.4 长任务进度（运行中）：已完成步数为单调计数, 不显示会随新步骤增长的"总步数" */}
        {vis('progress') && prog && (
          <span className="sb-item hq-sb-prog" title="当前任务运行进度（第N轮·已完成步数·token·耗时）">
            <span className="sb-dot" style={{ background: prog.stalled ? 'var(--warning)' : 'var(--accent)' }} />
            第{prog.round}轮 · 已完成{prog.stepsDone}步 · {fmtK(prog.tokensUsed)}tok · {fmtHms(progElapsed)}
            {prog.currentTool && <span className="hq-sb-prog-tool"> · {prog.currentTool}</span>}
          </span>
        )}
        {/* v0.4.4 无进展停滞提示：继续/中止 */}
        {st && st.active && (
          <span className="sb-item hq-sb-stall" title="检测到无进展停滞，请选择继续或中止">
            <span className="sb-dot" style={{ background: 'var(--warning)' }} />
            疑似停滞 {fmtHms(st.elapsedMs)}
            <button type="button" className="hq-stall-btn" onClick={() => continueStalled()}>继续</button>
            <button type="button" className="hq-stall-btn hq-stall-stop" onClick={() => stop()}>中止</button>
          </span>
        )}
        {/* 当前模型（只读指示；切换在输入框右下角） */}
        <span className="sb-item hq-sb-ctx-btn" title="当前模型（在输入框右下角切换）">
          <span className="sb-dot" style={{ background: 'var(--accent)' }} />
          {curModelName || '模型'}
        </span>
        {/* Token 输出速度（上下文左侧） */}
        {streaming && outSpeed > 0 && !disp.hideTokenUsage && vis('speed') && (
          <span className="sb-item" title="Token 输出速度（按字符估算）">
            <Zap size={11} />
            出 {outSpeed.toFixed(1)} tok/s
          </span>
        )}
        {/* 上下文用量（点击展开明细） */}
        <div className="hq-sb-ctx" ref={ctxRef}>
          <button
            type="button"
            className="sb-item hq-sb-ctx-btn"
            title="上下文用量（点击查看明细）"
            onClick={() => setCtxOpen(v => !v)}
          >
            <span>上下文 {contextLimit > 0 ? `${fmtK(contextUsed)}/${fmtK(contextLimit)}` : fmtK(contextUsed)}</span>
            <span className="sb-ctxbar">
              <span className="sb-ctxfill" style={{ width: (ratio * 100).toFixed(1) + '%', background: ctxColor }} />
            </span>
          </button>
          {ctxOpen && (
            <div className="hq-ctx-pop">
              <div className="hq-ctx-pop-head">
                <span>上下文用量</span>
                <button type="button" className="hq-icon-btn" aria-label="关闭" onClick={() => setCtxOpen(false)}><X size={13} /></button>
              </div>
              <div className="hq-ctx-pop-bar">
                <span className="hq-ctx-pop-fill" style={{ width: (ratio * 100).toFixed(1) + '%', background: ctxColor }} />
              </div>
              <div className="hq-ctx-pop-grid">
                <div className="hq-ctx-pop-row"><span>已用</span><b>{fmtK(contextUsed)}</b></div>
                <div className="hq-ctx-pop-row"><span>上限</span><b>{contextLimit > 0 ? fmtK(contextLimit) : '—'}</b></div>
                <div className="hq-ctx-pop-row"><span>占比</span><b style={{ color: ctxColor }}>{Math.round(ratio * 100)}%</b></div>
                <div className="hq-ctx-pop-row"><span>输入</span><b>{fmtK(tokSum.input)}</b></div>
              <div className="hq-ctx-pop-row"><span>输出</span><b>{fmtK(tokSum.output)}</b></div>
              </div>
              {ctxSnap && (
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                  <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>内容组成（它心里装着什么）</div>
                  <div className="hq-ctx-pop-grid">
                    {ctxSnap.sections.map((s, i) => (
                      <div key={i} className="hq-ctx-pop-row"><span>{s.label}</span><b>{fmtK(s.tokens)} tok</b></div>
                    ))}
                    <div className="hq-ctx-pop-row"><span>历史</span><b>{ctxSnap.history.count} 条 · {fmtK(ctxSnap.history.tokens)} tok</b></div>
                    <div className="hq-ctx-pop-row"><span>合计</span><b style={{ color: ctxColor }}>{fmtK(ctxSnap.totalTokens)} tok</b></div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {vis('cmd') && (
          <span className="sb-item" title="命令面板快捷键">
            <Command size={11} />K
          </span>
        )}
        {vis('version') && <span className="sb-item sb-ver" title="当前版本"># v{ver || '0.4.4'}</span>}
        <button type="button" className="sb-item hq-sb-hide" title="隐藏状态栏" aria-label="隐藏状态栏" onClick={onToggleHidden}>
          <X size={11} />
        </button>
      </div>
      {ctxMenu && (
        <div className="hq-statusbar-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onMouseDown={e => e.stopPropagation()}>
          <div className="hq-statusbar-menu-title">自定义状态栏</div>
          {([
            ['mode', '模式'], ['model', '模型'], ['sessions', '会话数'], ['dir', '工作目录'],
            ['statusline', '自定义状态行'], ['speed', '输出速度'], ['progress', '任务进度'], ['cmd', '命令面板提示'], ['version', '版本'],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" className="hq-statusbar-menu-item" onClick={() => toggleHidden(id)}>
              <span className={'hq-check' + (vis(id) ? ' on' : '')} />
              {label}
            </button>
          ))}
          <div className="hq-statusbar-menu-sep" />
          <button type="button" className="hq-statusbar-menu-item" onClick={resetHidden}>恢复默认</button>
          <button type="button" className="hq-statusbar-menu-item" onClick={onToggleHidden}>隐藏整个状态栏</button>
        </div>
      )}
    </footer>
  )
}
