// 关键页面自动截图(供视觉模型审查 UI)
// 用法: node scripts/capture-pages.cjs <port> <输出目录>
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const port = process.argv[2] || '9222'
const outDir = process.argv[3] || process.cwd()
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
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
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' })
    const f = path.join(outDir, name + '.png')
    fs.writeFileSync(f, Buffer.from(s.data, 'base64'))
    console.log('SHOT:', name)
  }
  const click = async (textOrTitle) => {
    const r = await evalJs(`(() => {
      const all = [...document.querySelectorAll('button, div, span, li')]
      const byTitle = all.find(x => x.title && x.title.includes(${JSON.stringify(textOrTitle)}))
      const byText = all.find(x => x.innerText.trim() === ${JSON.stringify(textOrTitle)} || x.innerText.trim().startsWith(${JSON.stringify(textOrTitle)}))
      const el = byTitle || byText
      if (el) { el.click(); return true }
      return false
    })()`)
    await sleep(700)
    return r
  }
  const clickNav = async (label) => {
    const r = await evalJs(`(() => {
      const el = [...document.querySelectorAll('.menu-item')].find(x => x.innerText.includes(${JSON.stringify(label)}))
      if (el) { el.click(); return true }
      return false
    })()`)
    await sleep(700)
    return r
  }
  const clickByTitle = async (title) => {
    const r = await evalJs(`(() => {
      const el = [...document.querySelectorAll('button')].find(x => x.title === ${JSON.stringify(title)})
      if (el) { el.click(); return true }
      return false
    })()`)
    await sleep(700)
    return r
  }

  await sleep(1500)
  await shot('ui-01-chat')
  if (await click('Agent 编队')) await shot('ui-02-agents')
  if (await click('对话')) await sleep(700)
  if (await click('设置')) {
    await sleep(600)
    const tabs = ['供应商', '策略', '角色', '记忆', '协作', '工具', 'MCP', '技能', '外观', '模型缓存统计', '引擎', '关于']
    for (const t of tabs) { if (await click(t)) await shot('ui-tab-' + t) }
  }
  if (await clickNav('对话')) {
    if (await clickByTitle('记忆管理')) await shot('ui-05-memory')
    if (await clickNav('对话')) {
      await sleep(600)
      if (await clickByTitle('快捷指令')) await shot('ui-panel-quickcmds')
      if (await clickByTitle('文件权限: 自动审核') || await clickByTitle('文件权限')) await shot('ui-panel-perm')
    }
  }
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
