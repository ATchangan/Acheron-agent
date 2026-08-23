// scripts/dev.cjs — 开发热重载(零额外依赖)
// 1) tsc --watch 编译主进程 electron/*.ts -> dist-electron
// 2) vite dev server 提供渲染层(HMR): 改 React 即时热更新, 不重启
// 3) 主进程产物(dist-electron)变化 -> 自动重启 Electron
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')

const ROOT = path.join(__dirname, '..')
const node = process.execPath
const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const electronExe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const distElectron = path.join(ROOT, 'dist-electron')
const DEV_URL = process.env.HQ_DEV_URL || 'http://localhost:5173'

let electron = null
let timer = null

function startElectron() {
  if (electron) { try { electron.kill() } catch { /* 忽略 */ } electron = null }
  electron = spawn(electronExe, ['.'], { cwd: ROOT, stdio: 'inherit', windowsHide: false, env: { ...process.env, HQ_DEV_URL: DEV_URL } })
  electron.on('exit', () => { electron = null })
}

function retry(url, tries) {
  if (tries > 120) { console.error('[dev] Vite 未就绪, 超时退出'); process.exit(1) }
  setTimeout(() => waitReady(url, tries + 1), 500)
}
function waitReady(url, tries) {
  const req = http.get(url, r => {
    r.resume()
    if (r.statusCode === 200) { console.log('[dev] Vite 就绪, 启动 Electron — ' + url); startElectron() }
    else retry(url, tries)
  })
  req.on('error', () => { try { req.destroy() } catch { /* 忽略 */ } retry(url, tries) })
}

// 主进程增量编译
const tsc = spawn(node, [tscBin, '-p', path.join(ROOT, 'electron', 'tsconfig.json'), '--watch'], { cwd: ROOT, stdio: 'inherit' })
// 渲染层 HMR 开发服务器(vite 无子命令 = dev server)
const vite = spawn(node, [viteBin], { cwd: ROOT, stdio: 'inherit' })

try {
  fs.watch(distElectron, { recursive: true }, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { console.log('[dev] 主进程产物变更, 重启 Electron…'); startElectron() }, 400)
  })
} catch (e) { console.error('[dev] 监听失败:', e) }

waitReady(DEV_URL, 0)

function shutdown() {
  if (timer) clearTimeout(timer)
  for (const c of [electron, tsc, vite]) { try { c?.kill() } catch { /* 忽略 */ } }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
