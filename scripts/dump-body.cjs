// 输出页面 body 全文(诊断用)
const http = require('node:http')
const port = process.argv[2] || '9222'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => { const mid = ++id; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }; ws.send(JSON.stringify({ id: mid, method, params })) })
  const r = await send('Runtime.evaluate', { expression: `document.body.innerText`, returnByValue: true })
  const txt = r.result.value || ''
  console.log('LEN:', txt.length)
  console.log('--- HEAD 400 ---')
  console.log(txt.slice(0, 400))
  console.log('--- TAIL 1500 ---')
  console.log(txt.slice(-1500))
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
