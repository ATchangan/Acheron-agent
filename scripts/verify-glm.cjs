// 通过 CDP 调用运行中应用的 models:detect 验证智谱视觉模型补充（key 从 apikey.txt 读取，不落日志）
const fs = require('node:fs')
const http = require('node:http')
const port = process.argv[2] || '9232'
const keyFile = process.env.HQ_KEYFILE || 'D:/桌面/apikey.txt'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  const lines = fs.readFileSync(keyFile, 'utf8').split(/\r?\n/).map(s => s.trim())
  let key = ''
  for (let i = 0; i < lines.length; i++) {
    if (/glm api:/i.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) { if (lines[j]) { key = lines[j]; break } }
      break
    }
  }
  if (!key) { console.log('NO_GLM_KEY'); process.exit(2) }
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page')
  if (!page) { console.log('NO_PAGE'); process.exit(3) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => {
    const mid = ++id
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable')
  const expr = `window.huangquan.models.detect('https://open.bigmodel.cn/api/paas/v4', ${JSON.stringify(key)}, {type:'OpenAI Compatible'})`
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  const v = r.result.value
  console.log('GLM ok:', v.ok, '| count:', (v.models || []).length)
  console.log('ids:', (v.models || []).join(', '))
  ws.close()
  process.exit(0)
})().catch(e => { console.log('VERIFY_ERR:', e.message); process.exit(1) })
