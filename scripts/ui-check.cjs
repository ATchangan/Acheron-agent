// UI 全页面巡检：主视图 + 设置全部 Tab + 版本号，检查渲染/报错/关键控件（适配 v0.4.2 界面）
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
  const page = targets.find(t => t.type === 'page' && (t.url.includes('index.html') || t.title === 'Acheron-agent')) || targets.find(t => t.type === 'page')
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
    fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(s.data, 'base64'))
    console.log('SHOT:', name)
  }
  const clickSidebarPage = async (label) => {
    const r = await evalJs(`(() => {
      const el = [...document.querySelectorAll('.hq-nav-item, .hq-sb-page')].find(x => x.innerText && x.innerText.trim().includes(${JSON.stringify(label)}))
      if (el) { el.click(); return true }
      return false
    })()`)
    await sleep(700)
    return r
  }
  const clickSettingsTab = async (label) => {
    const r = await evalJs(`(() => {
      const el = [...document.querySelectorAll('.hq-settings-nav-item')].find(x => x.innerText && x.innerText.trim().includes(${JSON.stringify(label)}))
      if (el) { el.click(); return true }
      return false
    })()`)
    await sleep(500)
    return r
  }
  const pageState = () => evalJs(`(() => {
    const err = document.querySelector('.error-bar')
    const overlay = document.querySelector('.hq-overlay-card')
    const active = document.querySelector('.hq-settings-nav-item.active')
    return {
      len: document.body.innerText.length,
      head: document.body.innerText.slice(0, 60).replace(/\\n+/g, ' | '),
      err: err ? err.innerText.slice(0, 100) : '',
      renderErr: document.body.innerText.includes('渲染错误') || document.body.innerText.includes('运行时错误'),
      overlay: !!overlay,
      overlayTitle: overlay ? (overlay.innerText || '').slice(0, 30) : '',
      activeTab: active ? active.innerText.trim() : '',
      mainLen: (document.querySelector('.hq-settings-content') || { innerText: '' }).innerText.length
    }
  })()`)

  const results = []
  const push = (name, ok, data) => { results.push({ name, ok: !!ok, data }) }

  try {
    // 0) 首次引导：跳过
    await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').includes('跳过引导')); if (b) { b.click(); return true } return false })()`)
    await sleep(600)

    // 1) 聊天主界面
    const chat = await pageState()
    push('chat-main', !chat.err && !chat.renderErr && chat.len > 50, chat)

    // 2) 侧栏主视图(工作区页面 + Overlay 页面)
    for (const nav of ['技能', '产物', '定时任务', '命令中心', '配置档案', 'API Keys']) {
      const okClick = await clickSidebarPage(nav)
      const st = await pageState()
      const hasOverlay = st.overlay && st.overlayTitle.includes(nav)
      const hasPage = !st.err && !st.renderErr && st.len > 80
      push('page:' + nav, okClick === true && hasPage && (hasOverlay || !st.overlay), { ...st, okClick })
      if (st.overlay) {
        await evalJs(`(() => { const b = document.querySelector('.hq-overlay-close'); if (b) b.click(); return true })()`)
        await sleep(500)
      }
    }

    // 3) 设置全部 Tab
    const openSettings = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.title || '') === '设置' || (x.getAttribute('aria-label') || '') === '设置'); if (b) { b.click(); return true } return false })()`)
    await sleep(800)
    push('settings-open', openSettings === true, await pageState())
    const tabs = ['供应商', '策略', '角色', '记忆', '协作', '工具', 'MCP', '外观', '界面', '快捷键', '模型缓存统计', '诊断', '引擎', '藏书阁', '插件', '关于']
    for (const t of tabs) {
      let okClick = await clickSettingsTab(t)
      let st = await pageState()
      // 渲染进程若崩溃自动恢复(回到聊天页), 重开设置并重试一次
      if (!st.overlay) {
        await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.title || '') === '设置'); if (b) { b.click(); return true } return false })()`)
        await sleep(800)
        okClick = await clickSettingsTab(t)
        st = await pageState()
      }
      const ok = okClick === true && st.activeTab.includes(t) && st.mainLen > 40 && !st.err && !st.renderErr
      push('tab:' + t, ok, { ...st, okClick })
    }

    // 4) 关于页版本
    let stAbout = await pageState()
    if (!stAbout.overlay) {
      await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.title || '') === '设置'); if (b) { b.click(); return true } return false })()`)
      await sleep(800)
    }
    await clickSettingsTab('关于')
    const about = await evalJs(`document.body.innerText.includes(${JSON.stringify(pkg.version)})`)
    push('about-version', about === true, { versionOk: about, expected: pkg.version })
    await shot('ui-final')
  } catch (e) {
    push('script-error', false, { error: String(e && e.message || e).slice(0, 300) })
  }

  const failed = results.filter(x => !x.ok)
  console.log('UI_CHECK_RESULT=' + JSON.stringify(results, null, 2))
  console.log('SUMMARY: total=' + results.length + ' ok=' + (results.length - failed.length) + ' fail=' + failed.length)
  if (failed.length) console.log('FAILED=' + JSON.stringify(failed.map(x => ({ name: x.name, data: x.data })), null, 2))
  ws.close()
  process.exit(results.some(x => !x.ok) ? 1 : 0)
})().catch(e => { console.log('UI_CHECK_ERR:', e.message); process.exit(1) })
