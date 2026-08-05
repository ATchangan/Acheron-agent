// 监控 dispatch 指令发送后的页面状态变化(检测重载/崩溃/消息丢失)
const http = require('node:http')
const port = process.argv[2] || '9251'
const httpGet = (url) => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const msg = '用 dispatch 并行执行两个子任务：螺丝咕姆负责列出 D:\\桌面\\黄泉agent 下的文件夹；三月七负责读取 D:\\桌面\\黄泉agent\\README.md 的前 5 行。执行完汇总结果'
  const getTarget = async () => {
    try {
      const t = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
      return t.find(x => x.type === 'page')
    } catch { return null }
  }
  let page = await getTarget()
  if (!page) { console.log('NO_PAGE'); process.exit(1) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const send = (method, params = {}) => new Promise(r => { const mid = ++id; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === mid) r(m.result) }; ws.send(JSON.stringify({ id: mid, method, params })) })
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value

  // 输入 + 发送
  await evalJs(`(() => {
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(msg)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(500)
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /send/i.test(x.className || ''))
    if (b) { b.click(); return true }
    return false
  })()`)
  console.log('SENT at', new Date().toISOString())

  const startId = page.id
  for (let i = 0; i < 180; i++) {
    await sleep(2000)
    const now = new Date().toISOString().slice(14, 19)
    // 检查 target 是否变化(重载)
    const cur = await getTarget()
    const targetChanged = cur && cur.id !== startId
    let st = null
    try {
      st = await evalJs(`(() => {
        const b = document.body.innerText
        return {
          hasDispatch: b.includes('dispatch'),
          hasUserMsg: b.includes('用 dispatch'),
          busy: b.includes('思考中') || b.includes('执行中'),
          tail: b.slice(-120).replace(/\\n+/g, ' | ')
        }
      })()`)
    } catch { st = { evalFail: true } }
    if (targetChanged) console.log(now, 'TARGET_CHANGED', startId, '→', cur.id)
    if (i % 5 === 0 || targetChanged || (st && !st.busy)) {
      console.log(now, JSON.stringify(st))
      if (st && !st.busy && st.hasUserMsg) break
    }
    if (i % 15 === 0) console.log(now, 'page=', cur && cur.id, 'start=', startId)
  }
  ws.close()
  process.exit(0)
})().catch(e => { console.log('ERR:', e.message); process.exit(1) })
