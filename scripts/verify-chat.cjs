// Acheron-agent 真实对话验证 —— 通过 CDP 驱动 UI 发消息, 直接从会话存储读取结果
// 用法: node scripts/verify-chat.cjs <port> <消息1> [消息2]
const http = require('node:http')

const port = process.argv[2] || '9240'
const msg1 = process.argv[3] || '你好，用一句话介绍自己'
const msg2 = process.argv[4] || ''
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  let targets
  try { targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`)) }
  catch (e) { console.log('CDP_UNREACHABLE:', e.message); process.exit(2) }
  const page = targets.find(t => t.type === 'page' && (t.url.includes('index.html') || t.title === 'Acheron-agent')) || targets.find(t => t.type === 'page')
  if (!page) { console.log('NO_PAGE'); process.exit(3) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => {
    const mid = ++id
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result?.value
  }

  // 1. 等页面加载 + 输入框出现
  await evalJs(`(() => { const el = [...document.querySelectorAll('.menu-item')].find(x => x.innerText.includes('对话')); if (el) { el.click(); return true } return false })()`)
  await sleep(1000)
  let ready = false
  for (let i = 0; i < 20; i++) {
    ready = await evalJs(`!!document.querySelector('textarea')`)
    if (ready) break
    await sleep(1000)
  }
  console.log('INPUT_READY:', ready)

  const sendMsg = async (text) => {
    // 输入并触发 React onChange
    const setRes = await evalJs(`(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return { ok: false, err: 'no textarea' }
      try {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, ${JSON.stringify(text)})
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.dispatchEvent(new Event('change', { bubbles: true }))
        return { ok: true, v: ta.value.slice(0, 30) }
      } catch (e) { return { ok: false, err: String(e), v: ta.value.slice(0, 30) } }
    })()`)
    console.log('SET:', JSON.stringify(setRes))
    await sleep(500)
    // 点击发送按钮(文本/图标兜底) + Enter 兜底
    const clicked = await evalJs(`(() => {
      const all = [...document.querySelectorAll('button')]
      const b = all.find(x => x.innerText.includes('发送') || x.title === '发送' || /send/i.test(x.className || ''))
      if (b) { b.click(); return 'btn' }
      return 'none'
    })()`)
    console.log('CLICK:', clicked)
    if (clicked === 'none') {
      await evalJs(`(() => {
        const ta = document.querySelector('textarea')
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
        return true
      })()`)
    }
    await sleep(1500)
    const afterClick = await evalJs(`(() => {
      const ta = document.querySelector('textarea')
      const errBar = document.querySelector('.error-bar')
      const body = document.body.innerText
      return {
        v: ta ? ta.value.slice(0, 40) : 'NO_TA',
        err: errBar ? errBar.innerText.slice(0, 120) : '',
        shown: body.includes(${JSON.stringify(text.slice(0, 10))}),
        bodyTail: body.slice(-200).replace(/\\n+/g, ' | ')
      }
    })()`)
    console.log('AFTER_CLICK:', JSON.stringify(afterClick))
    // 2. 等待回复完成: 轮询页面状态("思考中/执行中"消失 = 任务收尾), 再等落盘
    let done = false
    for (let i = 0; i < 150; i++) {
      await sleep(1000)
      const st = await evalJs(`(() => {
        const b = document.body.innerText
        return { busy: b.includes('思考中') || b.includes('执行中'), hasText: b.includes(${JSON.stringify(text.slice(0, 10))}) }
      })()`)
      if (st && st.hasText && !st.busy) { done = true; break }
    }
    console.log('DONE_WAIT:', done)
    await sleep(3000) // 等待会话保存队列落盘
    // 3. 读取完整会话消息结构
    const result = await evalJs(`(async () => {
      const list = await window.huangquan.sessions.list()
      if (!list || !list.length) {
        const ta = document.querySelector('textarea')
        return {
          error: 'no session',
          inputValue: ta ? ta.value.slice(0, 60) : 'NO_TA',
          bodyTail: document.body.innerText.slice(-300).replace(/\\n+/g, ' | '),
          btnInfo: [...document.querySelectorAll('button')].map(b => (b.title || '') + '|' + (b.className || '') + '|' + b.innerText.slice(0, 12)).slice(-12)
        }
      }
      const s = await window.huangquan.sessions.load(list[0].id)
      return {
        msgCount: (s.messages || []).length,
        roles: (s.messages || []).map(m => m.role).join(','),
        toolCalls: (s.messages || []).filter(m => m.tool_calls).length,
        toolResults: (s.messages || []).filter(m => m.role === 'tool').length,
        lastAssistant: [...(s.messages || [])].reverse().find(m => m.role === 'assistant' && m.content)?.content?.slice(0, 300) || '',
        hasUserMsg: (s.messages || []).some(m => m.role === 'user' && String(m.content).includes(${JSON.stringify(text.slice(0, 20))}))
      }
    })()`)
    console.log('MSG_RESULT:', JSON.stringify(result))
    return result
  }

  console.log('--- 消息1 ---')
  await sendMsg(msg1)
  if (msg2) {
    await sleep(5000)
    console.log('--- 消息2 ---')
    await sendMsg(msg2)
  }
  ws.close()
  process.exit(0)
})().catch(e => { console.log('CHAT_ERR:', e.message); process.exit(1) })
