// 验证自定义供应商弹窗"保存"按钮
const http = require('node:http')
const fs = require('node:fs')
const port = process.argv[2] || '9256'
const settingsPath = process.argv[3] || ''
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => { const mid = ++id; const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) { ws.removeEventListener('message', h); r(m.result) } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: mid, method, params })) })
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { err: r.exceptionDetails.exception?.description || r.exceptionDetails.text }; return r.result?.value }

  await ev(`[...document.querySelectorAll('.menu-item')].find(x => x.innerText.includes('设置')).click()`)
  await sleep(600)
  await ev(`[...document.querySelectorAll('div')].find(x => x.innerText.trim().startsWith('供应商') && x.style && x.style.cursor === 'pointer').click()`)
  await sleep(500)
  const opened = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('自定义')); if (b) { b.click(); return true } return false })()`)
  await sleep(400)
  const filled = await ev(`(() => {
    const ins = [...document.querySelectorAll('input')]
    const n = ins.find(x => x.placeholder === '名称')
    const k = ins.find(x => x.type === 'password')
    const u = ins.find(x => x.placeholder && (x.placeholder.includes('http') || x.placeholder.includes('URL')))
    if (!n) return { noName: true, ins: ins.map(i => i.placeholder) }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(n, 'TestProvider'); n.dispatchEvent(new Event('input', { bubbles: true }))
    if (k) { setter.call(k, 'sk-custom-123'); k.dispatchEvent(new Event('input', { bubbles: true })) }
    if (u) { setter.call(u, 'https://test.local/v1'); u.dispatchEvent(new Event('input', { bubbles: true })) }
    return { noName: false }
  })()`)
  await sleep(300)
  const saved = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '保存'); if (b) { b.click(); return 'clicked' } return 'no-save-btn' })()`)
  await sleep(1000)
  console.log('opened:', opened, 'filled:', JSON.stringify(filled), 'save:', saved)
  if (settingsPath && fs.existsSync(settingsPath)) {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const tp = (s.providers || []).find(p => p.name === 'TestProvider')
    console.log('TestProvider:', tp ? JSON.stringify({ baseUrl: tp.baseUrl, type: tp.type }) : '未找到')
  }
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
