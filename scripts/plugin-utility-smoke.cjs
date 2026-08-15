// scripts/plugin-utility-smoke.cjs — 插件 utilityProcess 宿主冒烟(正常/挂死强杀/崩溃/命令裁决)
// 用法: node_modules/electron/dist/electron.exe scripts/plugin-utility-smoke.cjs
const { app } = require('electron')
const { join } = require('path')
const fs = require('fs')
const os = require('os')
const LOG = join(__dirname, 'plugin-utility-smoke-' + process.pid + '.log')
try { fs.rmSync(LOG, { force: true }) } catch { /* 忽略 */ }
const L = (...a) => { try { fs.appendFileSync(LOG, a.map(String).join(' ') + '\n') } catch { /* 忽略 */ } }
app.on('will-quit', (e) => L('will-quit'))
process.on('exit', (code) => L('process-exit', code))
process.on('uncaughtException', (e) => L('uncaught', e && e.stack || String(e)))
process.on('unhandledRejection', (e) => L('unhandled', String(e)))

app.whenReady().then(async () => {
  L('ready')
  const root = join(__dirname, '..', 'dist-electron')
  const { runPluginInUtility } = require(join(root, 'plugins', 'plugin-runner.js'))
  const { handleHostCall } = require(join(root, 'plugins', 'plugin-policy.js'))
  const { assessRisk, isMutatingCommand } = require(join(root, 'security', 'permission.js'))

  const workDir = fs.mkdtempSync(join(os.tmpdir(), 'hq-plugin-smoke-'))
  const out = []
  const makeEnv = confirm => ({
    workDir,
    isDangerous: cmd => assessRisk({ type: 'terminal', command: cmd }) === 'L4',
    isMutating: isMutatingCommand,
    confirmCommand: confirm || (async () => 'allow'),
    runCommand: cmd => new Promise(r => require('child_process').exec(cmd, { cwd: workDir, timeout: 15000, windowsHide: true }, (e, so, se) => r((so || '') + (se ? '\n[stderr] ' + se : '') + (e ? '\n[exit] ' + e.message : '')))),
    readFile: p => fs.readFileSync(p, 'utf-8'),
    writeFile: (p, c) => fs.writeFileSync(p, c, 'utf-8'),
  })
  const handleCall = (env, n, a) => handleHostCall(n, a, env)
  const childPath = join(root, 'plugins', 'plugin-host.js')

  async function run(name, payload, env, opts) {
    L('run-start', name)
    const t0 = Date.now()
    try {
      const d = await runPluginInUtility(childPath, payload, (n, a) => handleCall(env, n, a), opts)
      out.push({ name, ok: d.ok, result: d.result, error: d.error, ms: Date.now() - t0 })
    } catch (e) {
      out.push({ name, ok: false, error: String(e && e.message || e), ms: Date.now() - t0 })
    }
    L('run-end', name, JSON.stringify(out[out.length - 1]))
  }

  // 1. 正常执行 + 经桥接写/读文件
  await run('normal-bridge', {
    code: `module.exports={tools:[{name:'t',description:'d',params:{},run:async(a,c)=>{await c.tools.run('write',{path:a.path,content:'ok'});return await c.tools.run('read',{path:a.path})}}]}`,
    tool: 't', args: { path: join(workDir, 'out.txt') },
  }, makeEnv())

  // 2. 同步死循环 → 父进程超时强杀
  await run('sync-hang-kill', {
    code: `module.exports={tools:[{name:'t',description:'d',params:{},run:()=>{while(true){}}}]}`,
    tool: 't', args: {},
  }, makeEnv(), { killTimeoutMs: 3000 })

  // 3. run 抛异常 → 错误返回, 主进程存活
  await run('crash-isolate', {
    code: `module.exports={tools:[{name:'t',description:'d',params:{},run:()=>{throw new Error('boom')}}]}`,
    tool: 't', args: {},
  }, makeEnv())

  // 4. 变更命令被父进程策略拒绝
  await run('confirm-deny', {
    code: `module.exports={tools:[{name:'t',description:'d',params:{},run:async(a,c)=>await c.tools.run('exec_command',{cmd:'git push'})}]}`,
    tool: 't', args: {},
  }, makeEnv(async () => 'deny'))

  console.log('SMOKE_RESULT ' + JSON.stringify(out, null, 2))
  L('final', JSON.stringify(out))
  try { fs.writeFileSync(join(__dirname, 'plugin-utility-smoke-result.json'), JSON.stringify(out, null, 2), 'utf-8') } catch { /* 忽略 */ }
  const passed = out[0]?.ok === true && /TIMEOUT/.test(out[1]?.error || '') && out[2]?.ok === false && /拒绝/.test(out[3]?.result || '')
  try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  app.exit(passed ? 0 : 1)
})
