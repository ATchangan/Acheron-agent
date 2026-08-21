// Acheron-agent 版本验证工具 —— CDP 连接运行中的应用, 检查页面健康并截图
// 用法: node scripts/verify-cdp.cjs <port> [输出目录]
// 例:   node scripts/verify-cdp.cjs 9232 C:\Users\ROG\Pictures
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const port = process.argv[2] || '9232'
const outDir = process.argv[3] || process.cwd()
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  let targets
  try {
    targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  } catch (e) {
    console.log('CDP_UNREACHABLE:', e.message)
    process.exit(2)
  }
  const page = targets.find(t => t.type === 'page')
  if (!page) { console.log('NO_PAGE_TARGET'); process.exit(3) }
  console.log('TARGETS:', JSON.stringify(targets.map(t => ({ type: t.type, title: t.title, url: t.url }))))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => {
    const mid = ++id
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable')
  // 可选: 检查"设置 -> 关于"页版本号(传第 4 参 'about')
  if (process.argv[4] === 'about') {
    await send('Runtime.evaluate', {
      expression: `(async () => {
        const all = () => [...document.querySelectorAll('button, div, span, li')]
        const clickByText = (t) => { const el = all().find(x => x.innerText.trim() === t || x.innerText.trim().startsWith(t)); if (el) { el.click(); return true } return false }
        const hit = clickByText('设置')
        await new Promise(r => setTimeout(r, 600))
        const tabs = all().filter(x => x.innerText.trim() === '关于').map(x => x.tagName + '.' + (x.className || ''))
        const hitAbout = clickByText('关于')
        await new Promise(r => setTimeout(r, 600))
        return { hit, tabs, hitAbout, tail: document.body.innerText.slice(-400).replace(/\\n+/g, ' | ') }
      })()`,
      returnByValue: true,
      awaitPromise: true,
    }).then(r => console.log('ABOUT:', JSON.stringify(r.result.value)))
  }
  if (process.argv[4] === 'strategy') {
    await send('Runtime.evaluate', {
      expression: `(async () => {
        const all = () => [...document.querySelectorAll('button, div, span, li')]
        const clickByText = (t) => { const el = all().find(x => x.innerText.trim() === t || x.innerText.trim().startsWith(t)); if (el) { el.click(); return true } return false }
        clickByText('设置')
        await new Promise(r => setTimeout(r, 600))
        clickByText('策略')
        await new Promise(r => setTimeout(r, 800))
        const selects = [...document.querySelectorAll('select')].map(s => ({ label: (s.labels && s.labels[0] ? s.labels[0].innerText : s.previousElementSibling ? s.previousElementSibling.innerText : '').slice(0, 16), value: s.value }))
        const text = document.body.innerText
        return {
          hasStrategyPage: text.includes('主对话模型') || text.includes('策略'),
          selects,
          hasVision: text.includes('视觉'),
          hasAutoMedia: text.includes('自动生成') || text.includes('媒体'),
          hasThink: text.includes('思考') || text.includes('推理'),
          tail: text.slice(-500).replace(/\\n+/g, ' | ')
        }
      })()`,
      returnByValue: true,
      awaitPromise: true,
    }).then(r => console.log('STRATEGY:', JSON.stringify(r.result.value)))
  }
  if (process.argv[4] === 'features') {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => ({
        appInfo: await window.huangquan.appInfo(),
        projectContext: await window.huangquan.projectContext(),
        sessionSearch: await window.huangquan.sessions.search('打包', 3),
        sessionSearchEmpty: await window.huangquan.sessions.search('不存在的词xyz', 3)
      }))()`,
      returnByValue: true,
      awaitPromise: true,
    })
    console.log('FEATURES:', JSON.stringify(r.result.value))
  }
  const info = await send('Runtime.evaluate', {
    expression: `(() => ({
      title: document.title,
      hash: location.hash,
      hasBridge: typeof window.huangquan === 'object',
      bridgeKeys: typeof window.huangquan === 'object' ? Object.keys(window.huangquan).slice(0, 20) : [],
      bodyHead: document.body.innerText.slice(0, 150).replace(/\\n+/g, ' | '),
      bodyLen: document.body.innerText.length,
      textarea: !!document.querySelector('textarea'),
      buttons: document.querySelectorAll('button').length,
      inputs: document.querySelectorAll('input,select').length,
      version: document.querySelector('[class*=version], [class*=about]') ? 'has-version-ui' : 'n/a'
    }))()`,
    returnByValue: true,
  })
  console.log('INFO:', JSON.stringify(info.result.value))
  if (process.argv[4] === 'about') {
    const ai = await send('Runtime.evaluate', {
      expression: `(typeof window.huangquan.appInfo === 'function' ? window.huangquan.appInfo() : Promise.resolve('MISSING'))`,
      returnByValue: true,
      awaitPromise: true,
    })
    console.log('APPINFO:', JSON.stringify(ai.result.value))
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(outDir, `hq-${port}.png`)
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log('SHOT:', file)
  ws.close()
  process.exit(0)
})().catch(e => { console.log('VERIFY_ERR:', e.message); process.exit(1) })
