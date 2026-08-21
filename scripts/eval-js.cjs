// CDP 执行任意 JS(诊断用): node scripts/eval-js.cjs <port> <expr>
const http = require('node:http')
const port = process.argv[2] || '9222'
const expr = process.argv[3] || '1+1'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => { const mid = ++id; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }; ws.send(JSON.stringify({ id: mid, method, params })) })
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 30000 })
  console.log(JSON.stringify(r))
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
