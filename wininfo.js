const http = require('http')
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  const targets = JSON.parse(await httpGet('http://127.0.0.1:9222/json'))
  for (const t of targets) {
    if (!t.webSocketDebuggerUrl || t.type !== 'page') continue
    try {
      const ws = new WebSocket(t.webSocketDebuggerUrl)
      await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
      let id = 0
      const send = (method, params = {}) => new Promise(r => { const mid = ++id; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }; ws.send(JSON.stringify({ id: mid, method, params })) })
      const info = await send('Browser.getWindowForTarget', { targetId: t.id })
      console.log(t.url.slice(-15), '->', JSON.stringify(info.windowBounds))
      // 页面内容摘要
      const r = await send('Runtime.evaluate', { expression: `(() => ({ h: location.hash, txt: document.body.innerText.slice(0, 60), imgs: document.querySelectorAll('img').length }))()`, returnByValue: true })
      console.log('   内容:', JSON.stringify(r.result.value))
      ws.close()
    } catch (e) { console.log('ERR:', t.url, e.message) }
  }
  process.exit(0)
})()