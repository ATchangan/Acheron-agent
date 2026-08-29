// 临时补丁: MessageList 订阅隔离 + StreamingMarkdown 增长事件 (跑完即删)
const fs = require('fs')

// ── MessageList.tsx ──
const pm = 'src/components/MessageList.tsx'
let t = fs.readFileSync(pm, 'utf8').split('\r\n').join('\n')
function must(s) { if (!t.includes(s)) { console.error('MISS: ' + s.slice(0, 60)); process.exit(1) } }

// 1. 去掉整块 streamText 订阅(保留布尔 streamingText)
must('  const streamText = useChatStore(s => s.streamText)\n  const streamingText = useChatStore(s => !!s.streamText)')
t = t.replace(
  '  const streamText = useChatStore(s => s.streamText)\n  const streamingText = useChatStore(s => !!s.streamText)',
  '  // v0.4.5 订阅隔离: MessageList 不再订阅整块 streamText(否则每个 delta 都重渲染整个列表);\n  // 流式增长通过 hq-stream-grew 窗口事件驱动跟滚/停滞计时, 文本仅由 StreamingMarkdown 叶子消费\n  const streamingText = useChatStore(s => !!s.streamText)'
)

// 2. 停滞重置改事件驱动
must(`  useEffect(() => {
    if (!streaming) { setStallActive(false); setStallSec(0); return }
    const len = streamText.length
    if (len !== lastStreamLen.current) {
      lastStreamLen.current = len
      setStallActive(false)
      setStallSec(0)
    }
  }, [streamText, streaming])`)
t = t.replace(
  `  useEffect(() => {
    if (!streaming) { setStallActive(false); setStallSec(0); return }
    const len = streamText.length
    if (len !== lastStreamLen.current) {
      lastStreamLen.current = len
      setStallActive(false)
      setStallSec(0)
    }
  }, [streamText, streaming])`,
  `  useEffect(() => {
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
  }, [streaming])`
)

// 3. 停滞计时器 effect 去掉 streamText 依赖
must('  }, [streamText, streaming, stallActive, streamingText])')
t = t.replace(
  '  }, [streamText, streaming, stallActive, streamingText])',
  '  }, [streaming, stallActive, streamingText])'
)

// 4. 跟滚 effect 拆分: 消息/阶段变化时 + 流式增长事件时
must(`  useEffect(() => {
    const list = listBox.current.el
    if (!list) return
    if (followRef.current) {
      if (rafScroll.current !== null) cancelAnimationFrame(rafScroll.current)
      rafScroll.current = requestAnimationFrame(() => {
        rafScroll.current = null
        list.scrollTop = list.scrollHeight
      })
    }
  }, [msgs, stage, streamText])`)
t = t.replace(
  `  useEffect(() => {
    const list = listBox.current.el
    if (!list) return
    if (followRef.current) {
      if (rafScroll.current !== null) cancelAnimationFrame(rafScroll.current)
      rafScroll.current = requestAnimationFrame(() => {
        rafScroll.current = null
        list.scrollTop = list.scrollHeight
      })
    }
  }, [msgs, stage, streamText])`,
  `  useEffect(() => {
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
  }, [])`
)
fs.writeFileSync(pm, t)
console.log('MessageList done')

// ── ConversationThread.tsx: StreamingMarkdown 派发增长事件 ──
const pc = 'src/components/ConversationThread.tsx'
let c = fs.readFileSync(pc, 'utf8').split('\r\n').join('\n')
function mustC(s) { if (!c.includes(s)) { console.error('C MISS: ' + s.slice(0, 60)); process.exit(1) } }
must(`const StreamingMarkdown: React.FC = React.memo(() => {
  const text = useChatStore(s => s.streamText)
  return (
    <div className="hq-stream-markdown">
      <StreamMarkdown content={text} streaming />
    </div>
  )
})`)
c = c.replace(
  `const StreamingMarkdown: React.FC = React.memo(() => {
  const text = useChatStore(s => s.streamText)
  return (
    <div className="hq-stream-markdown">
      <StreamMarkdown content={text} streaming />
    </div>
  )
})`,
  `const StreamingMarkdown: React.FC = React.memo(() => {
  const text = useChatStore(s => s.streamText)
  // v0.4.5: 内容增长信号(已按 60ms 合批) → MessageList 跟滚/停滞计时
  useEffect(() => {
    try { window.dispatchEvent(new Event('hq-stream-grew')) } catch { /* 忽略 */ }
  }, [text])
  return (
    <div className="hq-stream-markdown">
      <StreamMarkdown content={text} streaming />
    </div>
  )
})`
)
fs.writeFileSync(pc, c)
console.log('ConversationThread done')
