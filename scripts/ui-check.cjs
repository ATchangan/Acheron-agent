// UI 全页面巡检：主视图 + 设置全部 Tab + 版本号，检查渲染/报错/关键控件（适配 v0.4.2 界面）
// v0.4.2: 渲染进程崩溃恢复后 CDP target 会被替换, 脚本改为断线自动重连 +
// 每个操作前等待页面就绪 + tab 点击重试, 避免崩溃恢复期短路。
// 用法: node scripts/ui-check.cjs <port> [输出目录]
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const pkg = require('../package.json')

const port = process.argv[2] || '9234'
const outDir = process.argv[3] || process.cwd()
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let ws = null
let id = 0
const pending = new Map()

async function connect() {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page' && (t.url.includes('index.html') || t.title === 'Acheron-agent' || (t.title || '').includes('Agent'))) || targets.find(t => t.type === 'page')
  if (!page) throw new Error('NO_PAGE')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws connect failed')) })
  id = 0
  pending.clear()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
  await sendRaw('Runtime.enable')
}

// 页面崩溃恢复时旧 target 会消失, 重新从 /json 拿新 page 再继续
async function reconnect() {
  try { ws?.close() } catch { /* ignore */ }
  ws = null
  await connect()
}

function sendRaw(method, params = {}) {
  return new Promise((r, j) => {
    if (!ws || ws.readyState !== 1) return j(new Error('CDP socket closed: ' + method))
    const mid = ++id
    const timer = setTimeout(() => { pending.delete(mid); j(new Error('CDP timeout: ' + method)) }, 20000)
    pending.set(mid, (v) => { clearTimeout(timer); r(v) })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}

async function send(method, params = {}) {
  try {
    return await sendRaw(method, params)
  } catch (e) {
    // 崩溃恢复导致 socket 断开 → 重连后重试一次
    await reconnect()
    return sendRaw(method, params)
  }
}

const evalJs = async (expr) => {
  try {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result?.value
  } catch (e) {
    return { __err: String(e && e.message || e) }
  }
}

// 崩溃后 app-shell 会重建窗口并重新加载, 必须等 React 挂载完成再操作
async function waitReady(timeoutMs = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const r = await evalJs(`(() => { const root = document.querySelector('#root'); return { ready: document.readyState === 'complete', root: !!root, children: root ? root.children.length : 0 } })()`)
    if (r && !r.__err && r.ready && r.root && r.children > 0) return true
    await sleep(400)
  }
  return false
}
;(async () => {
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
    await sleep(700)
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
    await connect()
    // 0) 首次引导：跳过
    await waitReady(20000)
    await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').includes('跳过引导')); if (b) { b.click(); return true } return false })()`)
    await sleep(600)

    // 1) 聊天主界面
    const chat = await pageState()
    push('chat-main', !chat.err && !chat.renderErr && chat.len > 50, chat)

    // 2) 侧栏主视图(工作区页面 + Overlay 页面)
    for (const nav of ['技能', '产物', '定时任务', '命令中心', '配置档案', 'API Keys']) {
      await waitReady(12000)
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
    await waitReady(12000)
    const openSettings = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.title || '') === '设置' || (x.getAttribute('aria-label') || '') === '设置'); if (b) { b.click(); return true } return false })()`)
    await sleep(800)
    push('settings-open', openSettings === true, await pageState())
    const tabs = ['供应商', '策略', '角色', '记忆', '协作', '工具', 'MCP', '外观', '界面', '快捷键', '模型缓存统计', '诊断', '引擎', '藏书阁', '插件', '关于']
    for (const t of tabs) {
      let ok = false
      let okClick = false
      let st = {}
      // 渲染进程崩溃后会自动恢复(回到聊天页), 每轮先等页面就绪并重开设置
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        await waitReady(12000)
        okClick = await clickSettingsTab(t)
        await sleep(900)
        st = await pageState()
        ok = okClick === true && String(st.activeTab || '').includes(t) && (st.mainLen || 0) > 40 && !st.err && !st.renderErr
        if (!ok && !st.overlay) {
          await waitReady(8000)
          await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.title || '') === '设置'); if (b) { b.click(); return true } return false })()`)
          await sleep(800)
        }
      }
      push('tab:' + t, ok, { ...st, okClick })
    }

    // 4) 关于页版本
    await waitReady(12000)
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
