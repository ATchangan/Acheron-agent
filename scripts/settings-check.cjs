// 设置页全量实测: 遍历 12 tab 检查渲染/错误/控件值一致性/保存写盘
const http = require('node:http')
const fs = require('node:fs')
const port = process.argv[2] || '9222'
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
    if (rr.exceptionDetails) {
      console.log('EVAL_ERR:', JSON.stringify(rr.exceptionDetails.exception?.description || rr.exceptionDetails).slice(0, 500))
      return { __evalErr: true }
    }
    return rr.result?.value
  }

  const clickByText = async (txt) => {
    const r = await evalJs(`(() => {
      const all = [...document.querySelectorAll('button, div, span, li')]
      const el = all.find(x => x.innerText.trim() === ${JSON.stringify(txt)} || x.innerText.trim().startsWith(${JSON.stringify(txt)}))
      if (el) { el.click(); return true }
      return false
    })()`)
    await sleep(600)
    return r
  }
  const tabs = ['供应商', '策略', '角色', '记忆', '协作', '工具', 'MCP', '技能', '外观', '模型缓存统计', '引擎', '关于']

  await clickByText('设置')
  for (const t of tabs) {
    if (!(await clickByText(t))) { console.log('TAB_CLICK_FAIL:', t); continue }
    const r = await evalJs(`(() => {
      const err = document.querySelector('.error-bar')
      const selects = [...document.querySelectorAll('select')].map(s => ({ v: s.value, opts: s.options.length }))
      const nums = [...document.querySelectorAll('input[type=number]')].map(i => i.value)
      return {
        err: err ? err.innerText.slice(0, 100) : '',
        bodyLen: document.body.innerText.length,
        selects: selects.slice(0, 8),
        nums: nums.slice(0, 6),
        hasSection: document.body.innerText.includes(${JSON.stringify(t)})
      }
    })()`)
    console.log(t, JSON.stringify(r))
  }

  // 保存写盘测试: 引擎页修改"卡片最大高度"(设为 501) → 等保存 → 读文件验证
  await clickByText('引擎')
  await evalJs(`(() => {
    const inp = [...document.querySelectorAll('input')].find(x => x.type === 'number' && x.value === '500')
    if (!inp) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '501')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(1200)
  if (settingsPath && fs.existsSync(settingsPath)) {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    console.log('SAVE_TEST: cardMaxHeight =', s.general && s.general.cardMaxHeight)
  }
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
