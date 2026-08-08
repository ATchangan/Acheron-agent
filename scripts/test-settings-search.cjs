// 实测设置页搜索: 输入关键词 → 检查跳转/提示
const http = require('node:http')
const port = process.argv[2] || '9222'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => { const mid = ++id; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }; ws.send(JSON.stringify({ id: mid, method, params })) })
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value

  // 进设置页
  await evalJs(`[...document.querySelectorAll('.menu-item')].find(x => x.innerText.includes('设置')).click()`)
  await sleep(800)
  const setSearch = async (v) => {
    await evalJs(`(() => {
      const inp = [...document.querySelectorAll('input')].find(x => x.placeholder && x.placeholder.includes('搜索设置'))
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, ${JSON.stringify(v)})
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(500)
    const r = await evalJs(`(() => {
      const b = document.body.innerText
      const active = [...document.querySelectorAll('div')].find(x => x.style && x.style.background === 'rgb(220, 38, 38)' || false)
      return {
        noMatch: b.includes('没有匹配的设置项'),
        bodyTail: b.slice(0, 120).replace(/\\n+/g, ' | '),
        activeTab: [...document.querySelectorAll('div')].filter(x => x.innerText && x.style.background).map(x => x.innerText.slice(0, 10)).slice(0, 5)
      }
    })()`)
    return r
  }
  console.log('主题 →', JSON.stringify(await setSearch('主题')))
  console.log('不存在词zz →', JSON.stringify(await setSearch('zz不存在')))
  await setSearch('')
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
