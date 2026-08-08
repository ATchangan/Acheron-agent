// 0.3.5 全量功能检测：通过 CDP 调用 preload 桥接 IPC，逐项验证可用性
// 用法: node scripts/full-check.cjs <port>
const http = require('node:http')

const port = process.argv[2] || '9234'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))

;(async () => {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = targets.find(t => t.type === 'page' && (t.url.includes('index.html') || t.title === '黄泉Agent')) || targets.find(t => t.type === 'page')
  if (!page) { console.log('NO_PAGE'); process.exit(3) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => {
    const mid = ++id
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) { ws.removeEventListener('message', h); r(m.result) } }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

  const expression = `(async () => {
    const h = window.huangquan
    const out = []
    const run = async (name, fn, timeoutMs) => {
      const t = timeoutMs || 30000
      try {
        const v = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + t + 'ms')), t))])
        out.push({ name, ok: true, data: v })
      } catch (e) {
        out.push({ name, ok: false, error: String((e && e.message) || e).slice(0, 300) })
      }
    }
    const paths = await h.getPaths().catch(() => ({}))
    const snapCount = (v) => Array.isArray(v) ? { count: v.length } : { raw: String(v).slice(0, 200) }

    await run('appInfo', () => h.appInfo())
    await run('getPaths', () => h.getPaths())
    await run('projectContext', () => h.projectContext())
    await run('settings.load', async () => {
      const s = await h.settings.load()
      return { providers: (s.providers || []).length, generalKeys: Object.keys(s.general || {}).length }
    })
    await run('sessions.list', async () => snapCount(await h.sessions.list()))
    await run('sessions.search', async () => snapCount(await h.sessions.search('打包', 3)))
    await run('ishiki.load', async () => { const v = await h.ishiki.load(); return { len: String(v || '').length } })
    await run('skills.list', async () => snapCount(await h.skills.list()))
    await run('memory.load', async () => {
      const m = await h.memory.load()
      return { facts: (m.facts || []).length, pinned: (m.pinnedFacts || []).length, summaries: (m.summaries || []).length, episodic: (m.episodic || []).length }
    })
    await run('memory.search', async () => snapCount(await h.memory.search('测试')))
    await run('cron.list', async () => snapCount(await h.cron.list()))
    await run('plugins.scan', async () => snapCount(await h.plugins.scan()))
    await run('plugins.tools', async () => snapCount(await h.plugins.tools()))
    await run('mcpList', async () => snapCount(await h.mcpList()))
    await run('mcpSSEList', async () => snapCount(await h.mcpSSEList()))
    await run('tasks.list', async () => snapCount(await h.tasks.list()))
    await run('trace.list', async () => snapCount(await h.trace.list(5)))
    await run('cacheStats', async () => { const v = await h.cacheStats(); return typeof v === 'object' ? Object.keys(v) : String(v).slice(0, 100) })
    await run('storageStats', async () => { const v = await h.storageStats(); return typeof v === 'object' ? Object.keys(v) : String(v).slice(0, 100) })
    await run('modelStats.get', async () => { const v = await h.modelStats.get(); return { keys: Object.keys(v || {}).length, raw: String(v).slice(0, 120) } })
    await run('rendererStatus', async () => h.web.rendererStatus())
    await run('computer.systemInfo', async () => String(await h.computer.systemInfo()).slice(0, 200))
    await run('computer.sysPerf', async () => String(await h.computer.sysPerf()).slice(0, 200))
    await run('computer.processList', async () => String(await h.computer.processList()).slice(0, 200))
    await run('computer.readDir', async () => {
      const dir = paths.workspaceDir || 'D:\\\\桌面\\\\黄泉agent'
      return snapCount(await h.computer.readDir(dir))
    })
    await run('computer.grep', async () => {
      const r = await h.computer.grep('D:\\\\桌面\\\\黄泉agent\\\\黄泉agent开发版\\\\src\\\\store', 'export function')
      return { lines: String(r).split('\\n').length, head: String(r).slice(0, 120) }
    })
    await run('computer.find', async () => {
      const r = await h.computer.find('D:\\\\桌面\\\\黄泉agent\\\\黄泉agent开发版\\\\src\\\\store', '*.ts')
      return { lines: String(r).split('\\n').length, head: String(r).slice(0, 120) }
    })
    await run('computer.fileIO', async () => {
      const dir = 'D:\\\\桌面\\\\黄泉agent\\\\_verify_tmp'
      await h.computer.mkdir(dir)
      const file = dir + '\\\\test.txt'
      await h.computer.writeFile(file, 'verify-ok')
      const read = await h.computer.readFile(file)
      const stat = await h.computer.stat(file)
      await h.computer.remove(dir)
      return { read, stat: String(stat).slice(0, 120) }
    })
    await run('computer.codebox', async () => {
      const r = await h.computer.codebox('node', 'console.log(1+1)')
      return String(r).slice(0, 200)
    })
    await run('memory.addVector+search', async () => {
      await h.memory.addVector('__verify_dedup_20260807__')
      const r = await h.memory.search('__verify_dedup_20260807__')
      return snapCount(r)
    })
    await run('cron.add/list/remove', async () => {
      const created = await h.cron.add('* * * * *', '__verify__')
      const id = (created && (created.id || created._id)) || ''
      const list = await h.cron.list()
      if (id) await h.cron.remove(id)
      return { created: String(created).slice(0, 150), id, listed: Array.isArray(list) ? list.length : 0 }
    })
    await run('skills.create/list/delete', async () => {
      await h.skills.create('__verify__', '# test')
      const list = await h.skills.list()
      await h.skills.delete('__verify__')
      return { count: Array.isArray(list) ? list.length : 0, names: Array.isArray(list) ? list.filter(x => String(x.name || x).includes('__verify__')) : [] }
    })
    await run('web.search', async () => {
      const r = await h.web.search('黄泉Agent')
      return { len: String(r).length, head: String(r).slice(0, 150) }
    }, 45000)
    await run('web.fetch', async () => {
      const r = await h.web.fetch('https://example.com')
      return { len: String(r).length, head: String(r).slice(0, 100) }
    }, 45000)
    await run('web.read', async () => {
      const r = await h.web.read('https://example.com', 'text')
      return { len: String(r).length, head: String(r).slice(0, 150) }
    }, 60000)
    return out
  })()`

  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) {
    console.log('EVAL_ERR:', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails).slice(0, 1000))
    process.exit(1)
  }
  const list = r.result.value
  console.log('FULL_CHECK_RESULT=' + JSON.stringify(list, null, 2))
  const failed = list.filter(x => !x.ok)
  console.log('SUMMARY: total=' + list.length + ' ok=' + (list.length - failed.length) + ' fail=' + failed.length)
  if (failed.length) {
    console.log('FAILED_ITEMS=' + JSON.stringify(failed.map(x => ({ name: x.name, error: x.error })), null, 2))
  }
  ws.close()
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.log('FULL_CHECK_ERR:', e.message); process.exit(1) })
