// 发送消息并捕获渲染进程 console 输出(定位异常堆栈)
const http = require('node:http')
const port = process.argv[2] || '9253'
const msg = process.argv[3] || '读取 D:\\桌面\\黄泉agent\\README.md 的第一行并原样回复'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => {
    const mid = ++id
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) { ws.removeEventListener('message', h); r(m.result) } }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
  const logs = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const txt = (m.params.args || []).map(a => a.value !== undefined ? String(a.value) : a.description || '').join(' ')
      logs.push(txt)
      console.log('CONSOLE_ERROR:', txt.slice(0, 2000))
    }
  }
  await send('Runtime.enable')

  await evalJs(`(() => {
    const errBtn = document.querySelector('.error-bar button')
    if (errBtn) errBtn.click()
    return true
  })()`)
  await sleep(300)
  await evalJs(`(() => {
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(msg)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(500)
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /send/i.test(x.className || ''))
    if (b) { b.click(); return true }
    return false
  })()`)
  console.log('SENT')
  for (let i = 0; i < 90; i++) {
    await sleep(2000)
    const hasErr = await evalJs(`!!document.querySelector('.error-bar')`)
    if (hasErr) { console.log('ERROR_BAR at', i * 2 + 's'); break }
    if (i === 20) console.log('no error yet, waiting...')
  }
  await sleep(1000)
  console.log('DONE, total console errors:', logs.length)
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
