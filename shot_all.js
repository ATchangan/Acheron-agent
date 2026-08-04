const http = require('http')
const fs = require('fs')

http.get('http://127.0.0.1:9222/json', res => {
  let d = ''
  res.on('data', c => d += c)
  res.on('end', async () => {
    const targets = JSON.parse(d)
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      if (!t.webSocketDebuggerUrl) { console.log('窗口' + i + ':', t.url, '(无WS)'); continue }
      try {
        const ws = new WebSocket(t.webSocketDebuggerUrl)
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
        let id = 0
        const send = (method, params = {}) => new Promise(r => { const mid = ++id; ws.onmessage = function h(ev) { const m = JSON.parse(ev.data); if (m.id === mid) { ws.onmessage = null; r(m.result) } }; ws.send(JSON.stringify({ id: mid, method, params })) })
        await send('Page.enable')
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync('C:\\Users\\ROG\\Pictures\\win_' + i + '.png', Buffer.from(shot.data, 'base64'))
        console.log('窗口' + i + ':', t.url, '-> 截图OK')
        ws.close()
      } catch (e) { console.log('窗口' + i + ':', t.url, 'ERR', e.message) }
    }
  })
})