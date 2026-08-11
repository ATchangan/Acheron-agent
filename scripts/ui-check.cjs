// 0.3.5 UI 全页面巡检：设置全部 Tab + 主导航，检查渲染/报错/关键控件
// 用法: node scripts/ui-check.cjs <port> [输出目录]
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const pkg = require('../package.json')

const port = process.argv[2] || '9234'
const outDir = process.argv[3] || process.cwd()
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page' && (t.url.includes('index.html') || t.title === '黄泉Agent')) || targets.find(t => t.type === 'page')
  if (!page) { console.log('NO_PAGE'); process.exit(3) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
  const send = (method, params = {}) => new Promise((r, j) => {
    const mid = ++id
    const timer = setTimeout(() => { pending.delete(mid); j(new Error('CDP timeout: ' + method)) }, 20000)
    pending.set(mid, (v) => { clearTimeout(timer); r(v) })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable')
  const evalJs = async (expr) => {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
      return r.result?.value
    } catch (e) {
      return { __err: String(e && e.message || e) }
    }
  }
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' })
    const f = path.join(outDir, name + '.png')
    fs.writeFileSync(f, Buffer.from(s.data, 'base64'))
    console.log('SHOT:', name)
  }
  const clickText = async (txt) => {
    const r = await evalJs(`(() => {
      const all = [...document.querySelectorAll('button, div, span, li')]
      const exact = all.filter(x => x.innerText && x.innerText.trim() === ${JSON.stringify(txt)})
      const el = exact.find(x => x.style && x.style.cursor === 'pointer')
        || exact[exact.length - 1]
        || all.find(x => x.innerText && x.innerText.trim().startsWith(${JSON.stringify(txt)}) && x.style && x.style.cursor === 'pointer')
      if (el) { el.click(); return true }
      return false
    })()`)
    await sleep(600)
    return r
  }
  const clickNav = async (label) => {
    const r = await evalJs(`(() => {
      const el = [...document.querySelectorAll('.menu-item')].find(x => x.innerText && x.innerText.includes(${JSON.stringify(label)}))
      if (el) { el.click(); return true }
      return false
    })()`)
    await sleep(600)
    return r
  }
  const results = []
  const report = () => {
    const failed = results.filter(x => !x.ok)
    console.log('UI_CHECK_RESULT=' + JSON.stringify(results, null, 2))
    console.log('SUMMARY: total=' + results.length + ' ok=' + (results.length - failed.length) + ' fail=' + failed.length)
    if (failed.length) console.log('FAILED=' + JSON.stringify(failed.map(x => ({ name: x.name, data: x.data })), null, 2))
  }

  try {
    // 主导航（浏览器面板通过 IPC 单独验证，避免自动化卡在嵌入视图）
    for (const nav of ['对话', '角色编队', '文件', '设置']) {
      const ok = await clickNav(nav)
      const st = await evalJs(`(() => ({ len: document.body.innerText.length, head: document.body.innerText.slice(0, 80).replace(/\\n+/g, ' | '), err: !!document.querySelector('.error-bar') }))()`)
      results.push({ name: 'nav:' + nav, ok: !!ok && !st.__err, data: st })
    }
    await shot('ui-nav')

    // 设置全部 Tab
    const tabs = ['供应商', '策略', '角色', '记忆', '协作', '工具', 'MCP', '技能', '外观', '模型缓存统计', '诊断', '引擎', '定时任务', '藏书阁', '式神', '关于']
    await clickNav('设置')
    await sleep(400)
    for (const t of tabs) {
      const ok = await clickText(t)
      const st = await evalJs(`(() => ({
        len: document.body.innerText.length,
        contains: document.body.innerText.includes(${JSON.stringify(t)}),
        err: (document.querySelector('.error-bar') || { innerText: '' }).innerText.slice(0, 100),
        inputs: document.querySelectorAll('input,select,textarea,button').length
      }))()`)
      results.push({ name: 'tab:' + t, ok: !!ok && !!st.contains && !st.__err && !st.err, data: st })
      await shot('ui-tab-' + t)
    }

    // 关于页版本
    await clickText('关于')
    const about = await evalJs(`document.body.innerText.includes(${JSON.stringify(pkg.version)})`)
    results.push({ name: 'about-version', ok: about === true, data: { versionOk: about, expected: pkg.version } })
  } catch (e) {
    results.push({ name: 'script-error', ok: false, data: { error: String(e && e.message || e).slice(0, 300) } })
  }

  report()
  ws.close()
  process.exit(results.some(x => !x.ok) ? 1 : 0)
})().catch(e => { console.log('UI_CHECK_ERR:', e.message); process.exit(1) })
