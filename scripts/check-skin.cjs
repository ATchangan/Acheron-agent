// 通过 CDP 检查外观页：点击主题是否真正生效、是否有报错
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
  const consoleErrors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      const txt = (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200)
      consoleErrors.push(m.params.type + ': ' + txt)
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise(r => {
    const mid = ++id
    pending.set(mid, r)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable')
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result.value
  }
  const state = () => evalJs(`(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      bgRoot: cs.getPropertyValue('--bg-root').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
      hasSkinTab: [...document.querySelectorAll('div,span,button')].some(x => x.innerText && x.innerText.trim() === '外观'),
      err: window.__lastErr || ''
    }
  })()`)
  const clickByText = (t, inGrid = false) => evalJs(`(() => {
    const all = [...document.querySelectorAll('button, div, span, li')]
    const cands = all.filter(x => x.innerText && x.innerText.trim() === ${JSON.stringify(t)} && (!${inGrid} || x.parentElement && x.parentElement.parentElement && x.parentElement.parentElement.style.gridTemplateColumns.includes('1fr 1fr 1fr')))
    const el = cands[cands.length - 1] || all.find(x => x.innerText && x.innerText.trim() === ${JSON.stringify(t)})
    if (el) { el.click(); return true }
    return false
  })()`)
  console.log('BEFORE:', JSON.stringify(await state()))
  await clickByText('设置')
  await new Promise(r => setTimeout(r, 600))
  console.log('SETTINGS:', JSON.stringify(await state()))
  await clickByText('外观')
  await new Promise(r => setTimeout(r, 600))
  console.log('SKIN_OPEN:', JSON.stringify(await state()))
  const themeNames = ['浅色', '极黑', '经典紫', '血月', '晨曦', '暗夜']
  for (const name of themeNames) {
    const ok = await clickByText(name, true)
    await new Promise(r => setTimeout(r, 500))
    const st = await state()
    console.log('CLICK', name, '->', ok, 'theme=', st.theme, 'bg=', st.bgRoot, 'accent=', st.accent)
    const saved = await evalJs(`window.huangquan.settings.load().then(s => s.general.theme || '')`)
    console.log('  saved.theme =', saved)
  }
  // 自定义配色：点「自定义」→ 改强调色 → 应用
  await clickByText('自定义', true)
  await new Promise(r => setTimeout(r, 400))
  const setAccent = await evalJs(`(() => {
    const inputs = [...document.querySelectorAll('input[type=color]')]
    if (!inputs.length) return 'NO_COLOR_INPUT'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inputs[2], '#ff00aa')
    inputs[2].dispatchEvent(new Event('input', { bubbles: true }))
    inputs[2].dispatchEvent(new Event('change', { bubbles: true }))
    return 'SET'
  })()`)
  await new Promise(r => setTimeout(r, 400))
  await clickByText('应用')
  await new Promise(r => setTimeout(r, 500))
  const customSt = await state()
  console.log('CUSTOM:', setAccent, 'theme=', customSt.theme, 'accent=', customSt.accent)
  await clickByText('恢复默认')
  await new Promise(r => setTimeout(r, 500))
  console.log('RESET:', JSON.stringify(await state()))
  // 背景图上传（生成 1x1 PNG 走真实 File 通道）
  const bg = await evalJs(`(async () => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 4
    const ctx = c.getContext('2d'); ctx.fillStyle = '#3366cc'; ctx.fillRect(0, 0, 4, 4)
    const blob = await new Promise(r => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'bg.png', { type: 'image/png' }))
    const input = document.getElementById('bgImg')
    if (!input) return 'NO_BG_INPUT'
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return 'UPLOADED'
  })()`)
  await new Promise(r => setTimeout(r, 1200))
  const bgSt = await evalJs(`(() => ({ hasBg: document.documentElement.hasAttribute('data-bg'), bgImage: document.documentElement.style.getPropertyValue('--bg-image').slice(0, 40), mask: document.documentElement.style.getPropertyValue('--bg-mask-opacity') }))()`)
  console.log('BG:', bg, JSON.stringify(bgSt))
  await clickByText('清除')
  await new Promise(r => setTimeout(r, 600))
  console.log('BG_CLEAR:', JSON.stringify(await evalJs(`(() => ({ hasBg: document.documentElement.hasAttribute('data-bg'), bgImage: document.documentElement.style.getPropertyValue('--bg-image').slice(0, 40) }))()`)))
  console.log('CONSOLE:', JSON.stringify(consoleErrors))
  ws.close()
  process.exit(0)
})().catch(e => { console.log('CHECK_ERR:', e.message); process.exit(1) })
