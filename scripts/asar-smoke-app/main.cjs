// 打包 asar 场景验证: utilityProcess 能否从 app.asar 内加载插件宿主并完成一次桥接调用
const { app, utilityProcess } = require('electron')
const { join } = require('path')
const fs = require('fs')

app.whenReady().then(() => {
  const resultPath = join(__dirname, '..', 'asar-smoke-result.json')
  const finish = (r) => {
    try { fs.writeFileSync(resultPath, JSON.stringify(r, null, 2), 'utf-8') } catch (e) { /* 忽略 */ }
    app.exit(0)
  }
  const timer = setTimeout(() => finish({ timeout: true }), 15000)
  const unwrap = (m) => (m && typeof m === 'object' && 'data' in m) ? m.data : m
  let child
  try {
    child = utilityProcess.fork(join(__dirname, 'plugins', 'plugin-host.js'), [], { serviceName: 'hq-plugin-asar-smoke' })
  } catch (e) {
    clearTimeout(timer)
    finish({ forkError: String(e && e.message || e) })
    return
  }
  child.on('message', (m) => {
    const msg = unwrap(m)
    if (msg && msg.type === 'call') child.postMessage({ type: 'result', id: msg.id, value: 'FILE_CONTENT' })
    else if (msg && msg.type === 'done') { clearTimeout(timer); finish({ ok: msg.ok, result: msg.result, error: msg.error, logs: msg.logs }) }
  })
  child.on('exit', (code) => { if (code !== 0) { clearTimeout(timer); finish({ exit: code }) } })
  child.postMessage({
    type: 'init',
    code: `module.exports={tools:[{name:'t',description:'d',params:{},run:async(a,c)=>await c.tools.run('read',{path:'x'})}]}`,
    tool: 't',
    args: {},
  })
})
