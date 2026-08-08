// 0.3.5 写路径功能验证：记忆保存/定时任务/会话搜索/插件安装执行
// 用法: node scripts/feature-write-check.cjs <port>
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const port = process.argv[2] || '9233'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page' && (t.url.includes('index.html') || t.title === '黄泉Agent')) || targets.find(t => t.type === 'page')
  if (!page) { console.log('NO_PAGE'); process.exit(3) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
  const send = (method, params = {}) => new Promise(r => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })) })
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result?.value
  }

  // 插件临时目录
  const pluginsDir = path.join(process.env.APPDATA, 'huangquan-agent', 'plugins')
  const pluginDir = path.join(pluginsDir, '__verify_plugin__')
  fs.mkdirSync(pluginDir, { recursive: true })
  fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({ name: '__verify_plugin__', version: '1.0.0', description: 'verify', tools: [{ name: 'ping', description: 'ping', params: { x: 'string' } }] }, null, 2), 'utf-8')
  fs.writeFileSync(path.join(pluginDir, 'index.js'), `module.exports = { tools: [{ name: 'ping', description: 'ping', params: { x: 'string' }, run: async (args) => 'pong:' + (args && args.x || '') }] }`, 'utf-8')

  const results = []
  try {
    // 记忆保存
    const mem = await evalJs(`(async () => {
      const h = window.huangquan
      const m0 = await h.memory.load()
      const facts = Array.isArray(m0.facts) ? m0.facts : []
      await h.memory.save({ ...m0, facts: [...facts, '__verify_mem__'] })
      const m1 = await h.memory.load()
      return { saved: (m1.facts || []).includes('__verify_mem__'), count: (m1.facts || []).length }
    })()`)
    results.push({ name: 'memory.save', ok: mem && mem.saved === true, data: mem })

    // 定时任务增删
    const cron = await evalJs(`(async () => {
      const h = window.huangquan
      const id = await h.cron.add('every 30m', '__verify_cron__')
      const list1 = await h.cron.list()
      const found = Array.isArray(list1) && list1.some(j => j.id === id)
      await h.cron.remove(id)
      const list2 = await h.cron.list()
      return { id, found, afterRemove: Array.isArray(list2) ? list2.some(j => j.id === id) : true }
    })()`)
    results.push({ name: 'cron.add/list/remove', ok: !!(cron && cron.id && cron.found === true && cron.afterRemove === false), data: cron })

    // 会话搜索（中文关键词）
    const ses = await evalJs(`(async () => {
      const h = window.huangquan
      const hits = await h.sessions.search('你好', 5)
      return { count: (hits || []).length, first: (hits || [])[0] || null }
    })()`)
    results.push({ name: 'sessions.search', ok: ses && ses.count > 0, data: ses })

    // 插件扫描/工具/执行
    const plugin = await evalJs(`(async () => {
      const h = window.huangquan
      const s = await h.settings.load()
      s.general = s.general || {}
      s.general.pluginPerm = s.general.pluginPerm || {}
      s.general.pluginPerm['__verify_plugin__:ping'] = 'allow'
      await h.settings.save(s)
      const scanned = await h.plugins.scan()
      const tools = await h.plugins.tools()
      const exec = await h.plugins.exec('__verify_plugin__', 'ping', { x: 'ok' })
      return { scanned: (scanned || []).some(p => p.name === '__verify_plugin__'), toolInjected: (tools || []).some(t => t.name === 'ping'), exec: String(exec) }
    })()`)
    results.push({ name: 'plugin.scan/tools/exec', ok: !!(plugin && plugin.scanned === true && plugin.toolInjected === true && String(plugin.exec).includes('pong:ok')), data: plugin })
  } catch (e) {
    results.push({ name: 'script-error', ok: false, data: { error: String(e && e.message || e) } })
  } finally {
    try { fs.rmSync(pluginDir, { recursive: true, force: true }) } catch (e) { console.log('PLUGIN_CLEANUP_ERR:', e.message) }
  }

  console.log('FEATURE_WRITE_RESULT=' + JSON.stringify(results, null, 2))
  const failed = results.filter(x => !x.ok)
  console.log('SUMMARY: total=' + results.length + ' ok=' + (results.length - failed.length) + ' fail=' + failed.length)
  ws.close()
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.log('FEATURE_WRITE_ERR:', e.message); process.exit(1) })
