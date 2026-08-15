const http = require('node:http')
const fs = require('node:fs')
const port = process.argv[2] || '9232'
const out = process.argv[3] || process.env.TEMP || '.'
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
  await send('Page.enable')
  const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value
  await evalJs(`(() => { const el = [...document.querySelectorAll('button,div,span,li')].find(x => x.innerText && x.innerText.trim() === '设置'); if (el) el.click(); return true })()`)
  await new Promise(r => setTimeout(r, 600))
  await evalJs(`(() => { const el = [...document.querySelectorAll('button,div,span,li')].find(x => x.innerText && x.innerText.trim() === '插件'); if (el) el.click(); return true })()`)
  await new Promise(r => setTimeout(r, 800))
  const info = await evalJs(`(() => {
    const root = document.querySelector('.settings-view') || document.body
    const rect = root.getBoundingClientRect()
    const h2 = [...document.querySelectorAll('h2')].find(x => x.innerText && x.innerText.includes('插件库'))
    const h2Info = h2 ? (() => {
      const cs = getComputedStyle(h2)
      const svg = h2.querySelector('svg')
      return {
        rect: h2.getBoundingClientRect().toJSON(),
        svg: svg ? svg.getBoundingClientRect().toJSON() : null,
        font: cs.fontSize, lineH: cs.lineHeight, display: cs.display, margin: cs.margin,
      }
    })() : null
    return {
      bodyLen: document.body.innerText.length,
      head: document.body.innerText.slice(0, 300).replace(/\\n+/g, ' | '),
      rootRect: { w: Math.round(rect.width), h: Math.round(rect.height) },
      scrollW: root.scrollWidth, clientW: root.clientWidth,
      h2: h2Info,
      cards: [...document.querySelectorAll('.settings-view > div')].map(d => ({ cls: d.className || d.getAttribute('style')?.slice(0, 60), w: Math.round(d.getBoundingClientRect().width) })),
    }
  })()`)
  console.log('INFO:', JSON.stringify(info))
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const file = `${out}\\hq-plugins-${port}.png`
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log('SHOT:', file)
  await evalJs(`(() => { const el = [...document.querySelectorAll('button')].find(x => x.innerText && x.innerText.includes('安装')); if (el) el.click(); return true })()`)
  await new Promise(r => setTimeout(r, 500))
  const info2 = await evalJs(`(() => ({
    head: document.body.innerText.slice(0, 500).replace(/\\n+/g, ' | '),
    inputs: [...document.querySelectorAll('input')].map(i => ({ w: Math.round(i.getBoundingClientRect().width), ph: i.placeholder })),
    buttons: [...document.querySelectorAll('button')].map(b => ({ t: (b.innerText || '').trim().slice(0, 12), w: Math.round(b.getBoundingClientRect().width) })),
  }))()`)
  console.log('INSTALL:', JSON.stringify(info2))
  const shot2 = await send('Page.captureScreenshot', { format: 'png' })
  const file2 = `${out}\\hq-plugins-install-${port}.png`
  fs.writeFileSync(file2, Buffer.from(shot2.data, 'base64'))
  console.log('SHOT2:', file2)
  ws.close()
  process.exit(0)
})().catch(e => { console.log('CHECK_ERR:', e.message); process.exit(1) })
