// 通过 CDP 调用运行中应用的 models:detect，验证模型读取（不打印密钥明文）
const http = require('node:http')
const port = process.argv[2] || '9232'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page')
  if (!page) { console.log('NO_PAGE_TARGET'); process.exit(3) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => {
    const mid = ++id
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable')
  const r = await send('Runtime.evaluate', {
    expression: `(async () => {
      const cfg = await window.huangquan.settings.load()
      const out = []
      for (const p of (cfg.providers || [])) {
        if (!p.apiKey) continue
        const res = await window.huangquan.models.detect(p.baseUrl || '', p.apiKey, { type: p.type, anthropic: p.type === 'Anthropic Claude' })
        out.push({ name: p.name, ok: res.ok, count: (res.models || []).length, error: res.error || '', sample: (res.models || []).slice(0, 5) })
      }
      return out
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  console.log('MODELS:', JSON.stringify(r.result.value, null, 2))
  ws.close()
  process.exit(0)
})().catch(e => { console.log('VERIFY_ERR:', e.message); process.exit(1) })
