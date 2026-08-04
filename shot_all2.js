const http = require('http')
const fs = require('fs')
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  const targets = JSON.parse(await httpGet('http://127.0.0.1:9222/json'))
  let i = 0
  for (const t of targets) {
    if (!t.webSocketDebuggerUrl || t.type !== 'page') continue
    try {
      const ws = new WebSocket(t.webSocketDebuggerUrl)
      await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
      let id = 0
      const send = (method, params = {}) => new Promise(r => { const mid = ++id; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }; ws.send(JSON.stringify({ id: mid, method, params })) })
      await send('Page.enable')
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync('C:\\Users\\ROG\\Pictures\\win_' + (i++) + '.png', Buffer.from(shot.data, 'base64'))
      console.log('OK:', t.url, '-> win_' + (i-1) + '.png')
      ws.close()
      await new Promise(r => setTimeout(r, 500))
    } catch (e) { console.log('ERR:', t.url, e.message) }
  }
  console.log('完成')
  process.exit(0)
})()