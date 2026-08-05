// 通过 CDP 实测符文工坊运行：Python / JavaScript / PowerShell
const http = require('node:http')
const port = process.argv[2] || '9232'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page')
  if (!page) { console.log('NO_PAGE'); process.exit(3) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
  const send = (method, params = {}) => new Promise(r => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })) })
  await send('Runtime.enable')
  const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value
  await evalJs(`(() => { const el = [...document.querySelectorAll('button,div,span,li')].find(x => x.innerText && x.innerText.trim() === '设置'); if (el) el.click(); return true })()`)
  await new Promise(r => setTimeout(r, 600))
  await evalJs(`(() => { const el = [...document.querySelectorAll('button,div,span,li')].find(x => x.innerText && x.innerText.trim() === '符文工坊'); if (el) el.click(); return true })()`)
  await new Promise(r => setTimeout(r, 800))
  const runCode = async (langLabel, code) => {
    await evalJs(`(() => {
      const tab = [...document.querySelectorAll('button')].find(b => b.innerText && b.innerText.includes(${JSON.stringify(langLabel)}))
      if (tab) tab.click()
      return true
    })()`)
    await new Promise(r => setTimeout(r, 300))
    await evalJs(`(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return 'NO_TEXTAREA'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ${JSON.stringify(code)})
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await new Promise(r => setTimeout(r, 300))
    await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText && x.innerText.includes('运行')); if (b) b.click(); return true })()`)
    await new Promise(r => setTimeout(r, 5000))
    return await evalJs(`(() => {
      const out = document.querySelector('.console, pre')
      const txt = (out ? out.innerText : '') || ''
      return txt.slice(-600)
    })()`)
  }
  console.log('PY:', JSON.stringify(await runCode('Python', 'print("黄泉·测试")')))
  console.log('JS:', JSON.stringify(await runCode('JavaScript', 'console.log("js-ok")')))
  console.log('PS:', JSON.stringify(await runCode('PowerShell', 'Write-Output "ps-ok"')))
  ws.close()
  process.exit(0)
})().catch(e => { console.log('CHECK_ERR:', e.message); process.exit(1) })
