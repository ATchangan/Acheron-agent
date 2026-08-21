// 第二轮交互实测: 编队编辑保存/记忆面板添加/自定义供应商
const http = require('node:http')
const fs = require('node:fs')
const port = process.argv[2] || '9256'
const settingsPath = process.argv[3] || ''
const memPath = process.argv[4] || ''
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => { const mid = ++id; const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) { ws.removeEventListener('message', h); r(m.result) } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: mid, method, params })) })
  const evalJs = async (expr) => { const rr = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (rr.exceptionDetails) return { __err: rr.exceptionDetails.exception?.description || rr.exceptionDetails.text }; return rr.result?.value }
  const clickNav = async (label) => { const r = await evalJs(`(() => { const el = [...document.querySelectorAll('.menu-item')].find(x => x.innerText.includes(${JSON.stringify(label)})); if (el) { el.click(); return true } return false })()`); await sleep(600); return r }
  const clickText = async (txt) => { const r = await evalJs(`(() => { const el = [...document.querySelectorAll('button,div,span,li')].find(x => x.innerText.trim().startsWith(${JSON.stringify(txt)}) && x.style && x.style.cursor === 'pointer'); if (el) { el.click(); return true } return false })()`); await sleep(500); return r }

  // 1. 编队编辑保存
  await clickNav('Agent 编队')
  await sleep(500)
  const editBtn = await evalJs(`(() => { const btns = [...document.querySelectorAll('button')]; const b = btns.find(x => x.innerText.trim() === '编辑'); if (b) { b.click(); return true } return false })()`)
  await sleep(500)
  const editInfo = await evalJs(`(() => ({ hasToolChips: document.body.innerText.includes('read') && document.body.innerText.includes('工具白名单'), hasSave: document.body.innerText.includes('保存') }))()`)
  console.log('编队编辑打开:', editBtn, JSON.stringify(editInfo))
  const saveEdit = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '保存'); if (b) { b.click(); return true } return false })()`)
  await sleep(800)
  console.log('编队保存点击:', saveEdit)
  if (settingsPath && fs.existsSync(settingsPath)) {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    console.log('agentOverrides =', JSON.stringify(s.general && s.general.agentOverrides || {}))
  }

  // 2. 记忆面板添加
  await clickNav('对话')
  await sleep(500)
  const memBtn = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.title === '记忆管理'); if (b) { b.click(); return true } return false })()`)
  await sleep(400)
  const memInput = await evalJs(`(() => { const inp = [...document.querySelectorAll('input')].find(x => x.placeholder && x.placeholder.includes('保存到记忆')); if (!inp) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(inp, '测试记忆条目-交互验证'); inp.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(300)
  const memSave = await evalJs(`(() => { const btns = [...document.querySelectorAll('button')]; const b = btns.find(x => x.innerText.includes('保存') || x.innerText.includes('添加')); if (b) { b.click(); return true } return false })()`)
  await sleep(800)
  console.log('记忆面板:', memInput, memSave)
  if (memPath && fs.existsSync(memPath)) {
    const m = JSON.parse(fs.readFileSync(memPath, 'utf-8'))
    console.log('memory pinnedFacts =', JSON.stringify(m.pinnedFacts || []))
  }

  // 3. 自定义供应商
  await clickNav('设置')
  await sleep(500)
  await clickText('供应商')
  await sleep(400)
  const custom = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('自定义')); if (b) { b.click(); return true } return false })()`)
  await sleep(400)
  const customInfo = await evalJs(`(() => {
    const inputs = [...document.querySelectorAll('input')]
    const nameInp = inputs.find(x => x.placeholder && x.placeholder.includes('名称'))
    const keyInp = inputs.find(x => x.type === 'password' || (x.placeholder && x.placeholder.includes('Key')))
    if (!nameInp) return { noName: true, inputs: inputs.map(i => i.placeholder) }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(nameInp, 'TestProvider')
    nameInp.dispatchEvent(new Event('input', { bubbles: true }))
    if (keyInp) { setter.call(keyInp, 'sk-custom-123'); keyInp.dispatchEvent(new Event('input', { bubbles: true })) }
    return { noName: false }
  })()`)
  await sleep(300)
  const customSave = await evalJs(`(() => { const btns = [...document.querySelectorAll('button')]; const b = btns.find(x => x.innerText.includes('添加') || x.innerText.includes('创建')); if (b) { b.click(); return true } return false })()`)
  await sleep(800)
  console.log('自定义供应商:', custom, JSON.stringify(customInfo), customSave)
  if (settingsPath && fs.existsSync(settingsPath)) {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    console.log('providers 含 TestProvider:', (s.providers || []).some(p => p.name === 'TestProvider'))
  }
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
