// 关键交互实测: 供应商未配置点击/定时任务添加/代码运行/推理强度切换
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
  const evalJs = async (expr) => {
    const rr = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (rr.exceptionDetails) return { __err: rr.exceptionDetails.exception?.description || rr.exceptionDetails.text }
    return rr.result?.value
  }
  const clickText = async (txt) => { const r = await evalJs(`(() => { const el = [...document.querySelectorAll('button,div,span,li')].find(x => x.innerText.trim().startsWith(${JSON.stringify(txt)})); if (el) { el.click(); return true } return false })()`); await sleep(500); return r }

  // 1. 供应商: 点击未配置的 OpenAI
  await clickText('设置')
  await sleep(500)
  await clickText('供应商')
  await sleep(500)
  const before = await evalJs(`(() => { const inputs = [...document.querySelectorAll('input')].map(i => ({ type: i.type, ph: i.placeholder, v: i.value })); return { hasKeyInput: inputs.some(i => i.type === 'password'), inputs: inputs.slice(0, 6) } })()`)
  console.log('供应商初始:', JSON.stringify(before))
  const openai = await evalJs(`(() => { const el = [...document.querySelectorAll('div')].find(x => x.innerText.trim().startsWith('OpenAI') && x.style && x.style.cursor === 'pointer'); if (el) { el.click(); return true } return false })()`)
  await sleep(600)
  console.log('点击 OpenAI:', openai)
  const after = await evalJs(`(() => {
    const inputs = [...document.querySelectorAll('input')].map(i => ({ type: i.type, ph: i.placeholder, v: i.value }))
    const keyInp = document.querySelector('input[type=password]')
    if (keyInp) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(keyInp, 'sk-test-1234567890abcdef')
      keyInp.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return { hasKeyInput: !!keyInp, inputs: inputs.slice(0, 8) }
  })()`)
  console.log('点击后:', JSON.stringify(after))
  await sleep(1000)
  if (settingsPath && fs.existsSync(settingsPath)) {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const openaiP = (s.providers || []).find(p => p.name === 'OpenAI')
    console.log('SAVE_OPENAI:', openaiP ? JSON.stringify({ name: openaiP.name, key: String(openaiP.apiKey || '').slice(0, 12), baseUrl: openaiP.baseUrl, type: openaiP.type }) : '未找到')
  }

  // 2. 定时任务 tab: 渲染 + 添加
  await clickText('定时任务')
  await sleep(600)
  const cron = await evalJs(`(() => ({ hasAdd: document.body.innerText.includes('添加') || document.body.innerText.includes('新建'), bodyLen: document.body.innerText.length, selects: document.querySelectorAll('select').length, inputs: document.querySelectorAll('input').length }))()`)
  console.log('定时任务页:', JSON.stringify(cron))

  // 3. 代码工坊: 渲染
  await clickText('代码工坊')
  await sleep(600)
  const code = await evalJs(`(() => ({ hasRun: /运行|执行|Run/i.test(document.body.innerText), bodyLen: document.body.innerText.length, textareas: document.querySelectorAll('textarea').length }))()`)
  console.log('代码工坊:', JSON.stringify(code))

  // 4. 推理强度切换(输入区)
  await clickText('供应商')
  await sleep(400)
  await evalJs(`[...document.querySelectorAll('.menu-item')].find(x => x.innerText.includes('对话')) && [...document.querySelectorAll('.menu-item')].find(x => x.innerText.includes('对话')).click()`)
  await sleep(500)
  const thinkBtn = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.title && x.title.includes('推理强度')); if (b) { b.click(); return true } return false })()`)
  await sleep(400)
  const thinkSwitch = await evalJs(`(() => { const items = [...document.querySelectorAll('.dropdown-item')]; if (items.length) { const el = items.find(x => x.innerText.includes('deep')) || items[2]; if (el) { el.click(); return el.innerText } } return 'none' })()`)
  console.log('推理强度切换:', thinkSwitch)
  await sleep(800)
  if (settingsPath && fs.existsSync(settingsPath)) {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    console.log('thinkLevel =', s.general && s.general.thinkLevel)
  }
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
