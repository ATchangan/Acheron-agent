// 检查页面加载的 JS 是否包含指定文案(定位旧构建问题)
// 用法: node scripts/check-js.cjs <port> <关键词>
const http = require('node:http')
const port = process.argv[2] || '9222'
const kw = process.argv[3] || '说吧'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => { const mid = ++id; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }; ws.send(JSON.stringify({ id: mid, method, params })) })
  const r = await send('Runtime.evaluate', {
    expression: `(async () => {
      const scripts = [...document.scripts].map(s => s.src)
      const hits = []
      for (const src of scripts) {
        try {
          const t = await (await fetch(src)).text()
          hits.push({ src, len: t.length, hasNew: t.includes(${JSON.stringify(kw)}), hasOld: t.includes('有什么需要我做的') })
        } catch (e) { hits.push({ src, err: String(e) }) }
      }
      return hits
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  console.log('CHECK:', JSON.stringify(r.result.value))
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
