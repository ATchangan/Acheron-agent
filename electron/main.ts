import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } from 'electron'
import { join, extname, dirname } from 'path'
import * as fs from 'fs'
import * as http from 'http'
import { exec } from 'child_process'
import * as os from 'os'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let serverPort = 0

// ─── 路径 ───────────────────────────────────────────
const ROOT = join(__dirname, '..')
const resourcesDir = join(ROOT, 'resources')
const distDir = join(ROOT, 'dist')
const skillsDir = join(ROOT, 'skills')
const userDataPath = app.getPath('userData')
const sessionsDir = join(userDataPath, 'sessions')
const settingsPath = join(userDataPath, 'settings.json')
const memoryPath = join(userDataPath, 'memory.json')
const workspaceDir = join(userDataPath, 'workspace')

for (const d of [sessionsDir, workspaceDir, skillsDir, join(resourcesDir, 'skills')]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

// 启动时初始向量记忆
import('./memory/vector').then(m => { m.initMemory(join(userDataPath, 'memory-vector.json')); m.startAutoSave() }).catch(() => {})
// 启动定时任务
import('./scheduler/cron').then(m => m.initCron(join(userDataPath, 'cron.json'), (prompt: string) => {
  mainWindow?.webContents.send('cron:trigger', prompt)
})).catch(() => {})
// v0.2: 初始化多Agent系统
import('./agent').then(m => { m.initAgentSystemSync() }).catch(() => {})
// v0.2: 启动时加载MCP SSE
import('./mcp/sse-transport').catch(() => {})
import('./cache/tool-cache').catch(() => {})

// ─── HTTP 服务器 ──────────────────────────────────
function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
      '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
    }
    const s = http.createServer((req, res) => {
      const reqPath = (req.url || '/').split('?')[0].replace(/\/$/, '') || '/index.html'
      const fp = join(distDir, reqPath)
      if (!fp.startsWith(distDir)) { res.writeHead(403); res.end('403'); return }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('404'); return }
        res.writeHead(200, { 'Content-Type': mime[extname(fp)] || 'application/octet-stream' })
        res.end(data)
      })
    })
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address(); resolve(typeof addr === 'object' ? addr!.port : 0)
    })
    s.on('error', reject)
  })
}

// ─── 菜单 ──────────────────────────────────────────
function createAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '黄泉Agent', submenu: [
        { label: '关于黄泉Agent', role: 'about' }, { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit() } },
      ],
    },
    {
      label: '编辑', submenu: [
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
        { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图', submenu: [
        { label: '重新加载', role: 'reload' }, { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { label: '实际大小', role: 'resetZoom' },
      ],
    },
    { label: '窗口', submenu: [{ label: '最小化', role: 'minimize' }, { label: '关闭', role: 'close' }] },
  ]))
}

// ─── 窗口 / 托盘 ────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: '黄泉Agent', icon: join(resourcesDir, 'icon.png'),
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    backgroundColor: '#08080f', show: false, frame: false,
  })
  mainWindow.loadURL('http://127.0.0.1:' + serverPort + '/index.html')
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('close', (e) => { if (!isQuitting) { e.preventDefault(); mainWindow?.hide() } })
}

function createTray() {
  const icon = nativeImage.createFromPath(join(resourcesDir, 'icon.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('黄泉Agent')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on('click', () => mainWindow?.show())
}

// ─── 窗口控制 IPC ─────────────────────────────────
ipcMain.handle('window:setOpacity', (_e, opacity: number) => {
  if (mainWindow) mainWindow.setOpacity(Math.max(0.3, Math.min(1, opacity)))
})
ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window:close', () => { isQuitting = true; app.quit() })

// ─── 设置/会话 ─────────────────────────────────────
ipcMain.handle('settings:load', () => {
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      if (raw.trim()) { const data = JSON.parse(raw); console.log('[SETTINGS] loaded providers:', data?.providers?.length); return data }
    }
  } catch (e) { console.error('settings load error:', e) }
  return { providers: [], general: { theme: 'dark' } }
})
ipcMain.handle('settings:save', (_e, s) => {
  try {
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf-8')
    console.log('[SETTINGS] saved to', settingsPath, 'providers:', s?.providers?.length)
    return true
  } catch (e) { console.error('[SETTINGS] save error:', e); return false }
})

ipcMain.handle('sessions:list', () => {
  try {
    if (!fs.existsSync(sessionsDir)) return []
    return fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')).map(f => {
      const d = JSON.parse(fs.readFileSync(join(sessionsDir, f), 'utf-8'))
      return { id: f.replace('.json', ''), title: d.title || f, messageCount: d.messages?.length || 0, updatedAt: d.updatedAt || '' }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch { return [] }
})
ipcMain.handle('sessions:load', (_e, id: string) => {
  try { const p = join(sessionsDir, id + '.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : { id, title: '新对话', messages: [] } }
  catch { return { id, title: '新对话', messages: [] } }
})
ipcMain.handle('sessions:save', (_e, s) => { fs.writeFileSync(join(sessionsDir, s.id + '.json'), JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2), 'utf-8'); return true })
ipcMain.handle('sessions:delete', (_e, id: string) => { try { fs.unlinkSync(join(sessionsDir, id + '.json')) } catch { /* ok */ }; return true })

// ─── 人格定义 ──────────────────────────────────────
ipcMain.handle('ishiki:load', () => {
  try { const p = join(resourcesDir, 'ishiki.md'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '' }
  catch { return '' }
})

// ─── Skills 系统 ───────────────────────────────────
ipcMain.handle('skills:list', () => {
  try {
    const dirs = [join(resourcesDir, 'skills')]
    if (fs.existsSync(skillsDir)) dirs.push(skillsDir)
    const skills: { name: string; path: string; description: string }[] = []
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir)) {
        const skillDir = join(dir, entry)
        const mdPath = join(skillDir, 'SKILL.md')
        if (fs.existsSync(mdPath)) {
          const content = fs.readFileSync(mdPath, 'utf-8')
          const desc = (content.match(/description:\s*(.+)/i)?.[1] || entry).trim()
          skills.push({ name: entry, path: mdPath, description: desc })
        }
      }
    }
    return skills
  } catch { return [] }
})
ipcMain.handle('skills:load', (_e, path: string) => {
  try { return fs.readFileSync(path, 'utf-8') }
  catch { return '' }
})

// ─── 记忆系统 ──────────────────────────────────────
ipcMain.handle('memory:load', () => {
  try { return fs.existsSync(memoryPath) ? JSON.parse(fs.readFileSync(memoryPath, 'utf-8')) : { facts: [], summaries: [] } }
  catch { return { facts: [], summaries: [] } }
})
ipcMain.handle('memory:save', (_e, memory) => {
  fs.writeFileSync(memoryPath, JSON.stringify(memory, null, 2), 'utf-8')
  return true
})

// ─── 语义记忆 ───────────────────────────────────
let _vm: any = null
function getVM() {
  if (!_vm) {
    const m = require('./memory/vector')
    m.initMemory(join(userDataPath, 'memory-vector.json'))
    _vm = m
  }
  return _vm
}
ipcMain.handle('memory:search', async (_e, query: string) => {
  try { return getVM().searchMemory(query, 5) } catch { return [] }
})
ipcMain.handle('memory:addVector', async (_e, content: string) => {
  try { getVM().addMemory(content); getVM().saveMemory(); return true } catch { return false }
})
ipcMain.handle('memory:importFile', async (_e, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return false
    const content = fs.readFileSync(filePath, 'utf-8')
    for (const chunk of content.split('\n\n').filter((c:string) => c.trim().length > 50).slice(0, 20)) {
      getVM().addMemory(chunk.trim())
    }
    getVM().saveMemory()
    return true
  } catch { return false }
})
ipcMain.handle('memory:clearVector', async () => {
  try { getVM().clearMemory(); getVM().saveMemory(); return true } catch { return false }
})

// ─── 电脑控制 ──────────────────────────────────────
ipcMain.handle('computer:exec', async (_e, cmd: string) => {
  return new Promise<string>((resolve) => {
    // 智能检测 PowerShell vs cmd
    const isPS = /^(powershell|pwsh)\b/i.test(cmd.trim()) || cmd.includes('$') || cmd.includes('Invoke-WebRequest') || cmd.includes('try {')
    let finalCmd
    if (isPS) {
      finalCmd = `powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${cmd.replace(/"/g, '\\"')}"`
    } else {
      finalCmd = `cmd /c "${cmd.replace(/"/g, '\\"')}"`
    }
    exec(finalCmd, { timeout: 300000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' }, (err, stdout, stderr) => {
      const out = err ? (stderr || err.message) : (stdout || '')
      const truncated = out.length > 8000 ? out.slice(0, 8000) + '\n...(已截断，共' + out.length + '字符)' : out
      resolve(truncated)
    })
  })
})

ipcMain.handle('computer:readFile', async (_e, filePath: string) => {
  if (!fs.existsSync(filePath)) throw new Error('文件不存在')
  const stat = fs.statSync(filePath)
  if (stat.size > 5 * 1024 * 1024) throw new Error('文件过大 (>5MB)')
  return fs.readFileSync(filePath, 'utf-8')
})
ipcMain.handle('computer:writeFile', async (_e, filePath: string, content: string) => {
  fs.mkdirSync(dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
  return true
})
ipcMain.handle('computer:readDir', async (_e, dirPath: string) => {
  const items = fs.readdirSync(dirPath, { withFileTypes: true })
  return items.map(item => ({ name: item.name, isDirectory: item.isDirectory(), size: item.isFile() ? fs.statSync(join(dirPath, item.name)).size : 0 }))
})
ipcMain.handle('computer:systemInfo', () => ({
  platform: os.platform(), arch: os.arch(), hostname: os.hostname(),
  cpus: os.cpus().length, totalMemory: os.totalmem(), freeMemory: os.freemem(),
  uptime: os.uptime(), homeDir: os.homedir(), workspaceDir,
}))
ipcMain.handle('computer:openFile', async (_e, filePath: string) => { await shell.openPath(filePath); return true })
ipcMain.handle('computer:selectFile', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('computer:selectDir', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('computer:readImageBase64', async (_e, filePath: string) => {
  const buf = fs.readFileSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const mm: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
  return 'data:' + (mm[ext] || 'image/png') + ';base64,' + buf.toString('base64')
})
ipcMain.handle('computer:grep', async (_e, dirPath: string, pattern: string) => {
  const results: string[] = []
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') walk(fp)
      else if (entry.isFile() && entry.name.match(/\.(ts|tsx|js|jsx|json|md|css|html|py|rs|go|java|c|cpp)$/)) {
        try {
          const content = fs.readFileSync(fp, 'utf-8')
          const lines = content.split('\n')
          lines.forEach((line, idx) => {
            if (line.includes(pattern)) results.push(`${fp}:${idx + 1}:${line.trim()}`)
          })
        } catch { /* binary skip */ }
      }
    }
  }
  try { walk(dirPath) } catch { /* ok */ }
  return results.slice(0, 100).join('\n')
})
ipcMain.handle('computer:find', async (_e, dirPath: string, glob: string) => {
  const results: string[] = []
  const regex = new RegExp(glob.replace(/\*/g, '.*').replace(/\./g, '\\.'))
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') walk(fp)
      else if (entry.isFile() && regex.test(entry.name)) results.push(fp)
    }
  }
  try { walk(dirPath) } catch { /* ok */ }
  return results.slice(0, 200).join('\n')
})

// ─── 浏览器自动化 ───────────────────────────────
ipcMain.handle('browser:open', async (_e, url: string) => {
  return new Promise<string>(resolve => {
    const bw = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { sandbox: true } })
    bw.loadURL(url)
    bw.webContents.on('did-finish-load', async () => {
      try {
        const title = await bw.webContents.executeJavaScript('document.title')
        const text = await bw.webContents.executeJavaScript('document.body.innerText')
        bw.close()
        resolve(`${title}

${text.slice(0, 10000)}`)
      } catch { bw.close(); resolve('(load error)') }
    })
    bw.webContents.on('did-fail-load', () => { bw.close(); resolve('(failed)') })
    setTimeout(() => { try { bw.close() } catch {}; resolve('(timeout)') }, 15000)
  })
})
ipcMain.handle('browser:screenshot', async (_e, url: string) => {
  return new Promise<string>(resolve => {
    const bw = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { sandbox: true } })
    bw.loadURL(url)
    bw.webContents.on('did-finish-load', async () => {
      try {
        const img = await bw.webContents.capturePage()
        bw.close()
        resolve(img.toDataURL())
      } catch { bw.close(); resolve('') }
    })
    setTimeout(() => { try { bw.close() } catch {}; resolve('') }, 15000)
  })
})
ipcMain.handle('computer:screenshot', async () => {
  try {
    const img = await mainWindow?.webContents.capturePage()
    if (!img) throw new Error('截图失败')
    return img.toDataURL()
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : '截图失败')
  }
})

// ─── 剪贴板 ─────────────────────────────────────
ipcMain.handle('computer:clipboardRead', () => { try{return require('electron').clipboard.readText()}catch{return''} })
ipcMain.handle('computer:clipboardWrite', (_e,text:string) => { try{require('electron').clipboard.writeText(text);return true}catch{return false} })

// ─── 代码沙箱 ───────────────────────────────────
ipcMain.handle('computer:codebox', async (_e, lang:string, code:string) => {
  return new Promise<string>(resolve => {
    const tmpDir = join(userDataPath, 'codebox')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const ext = lang === 'python' ? '.py' : lang === 'node' ? '.js' : '.txt'
    const fp = join(tmpDir, 'codebox_' + Date.now() + ext)
    fs.writeFileSync(fp, code, 'utf-8')
    const cmd = lang === 'python' ? `python "${fp}"` : lang === 'node' ? `node "${fp}"` : `echo "unsupported: ${lang}"`
    exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve(err ? (stderr || err.message) : stdout)
      try { fs.unlinkSync(fp) } catch {}
    })
  })
})
ipcMain.handle('computer:processList', async () => {
  return new Promise<string>(resolve=>{ exec('tasklist /FO CSV /NH',{timeout:5000},(e,o)=>resolve(o||'')) })
})
ipcMain.handle('computer:killProcess', async (_e,pid:string) => {
  return new Promise<string>(resolve=>{ exec(`taskkill /PID ${pid} /F`,{timeout:5000},(e,o)=>resolve(o||e?.message||'')) })
})

// ─── 浏览器 / 搜索 / 模型探测 ──────────────────────
ipcMain.handle('models:detect', async (_e, baseUrl: string, apiKey: string) => {
  try {
    const url = (baseUrl || 'https://api.deepseek.com') + '/v1/models'
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + apiKey }, signal: AbortSignal.timeout(10000) })
    const data: any = await res.json()
    return (data.data || []).map((m: any) => m.id).filter((id: string) => !id.includes('embedding') && !id.includes('rerank'))
  } catch { return [] }
})

ipcMain.handle('web:search', async (_e, query: string) => {
  try {
    const u = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) })
    const h = await r.text()
    const re = /<a[^>]*class="result__a"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*?>([^<]+)<\/a>/gi
    const out: string[] = []; let m
    while ((m = re.exec(h)) && out.length < 5) out.push(`${out.length + 1}. ${m[1].trim()}: ${m[2].trim().replace(/<[^>]+>/g, '')}`)
    return out.length ? out.join('\n') : '(无结果)'
  } catch { return '(搜索失败)' }
})

ipcMain.handle('web:fetch', async (_e, url: string) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    return await res.text().then(t => t.slice(0, 50000))
  } catch (err: unknown) {
    return 'Error: ' + (err instanceof Error ? err.message : String(err))
  }
})

// ─── 定时任务 ───────────────────────────────────
ipcMain.handle('cron:add', async (_e, expr:string, prompt:string) => {
  try { return require('./scheduler/cron').addJob(expr, prompt) } catch(e:any) { return 'Error: ' + e.message }
})
ipcMain.handle('cron:list', () => { try { return require('./scheduler/cron').listJobs() } catch { return [] } })
ipcMain.handle('cron:remove', (_e, id:string) => { try { require('./scheduler/cron').removeJob(id); return true } catch { return false } })

ipcMain.handle('mcp:connect', async (_e, name, cmd, args) => {
  try { return await require('./mcp/client').connectServer(name, cmd, args||[]) } catch(e:any) { return { error: e.message } }
})
ipcMain.handle('mcp:call', async (_e, server, tool, a) => {
  try { return await require('./mcp/client').callMCPTool(server, tool, a) } catch(e:any) { return 'Error: ' + e.message }
})
ipcMain.handle('mcp:list', () => { try { return require('./mcp/client').listServers() } catch { return [] } })
ipcMain.handle('get:paths', () => ({ skillsDir, pluginsDir: join(userDataPath, 'plugins'), workDir: workspaceDir }))
ipcMain.handle('skills:create', (_e, name: string, content: string) => {
  try {
    const dir = join(skillsDir, name)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')
    return true
  } catch (e: any) { return 'Error: ' + e.message }
})
ipcMain.handle('skills:install', (_e, url: string) => {
  return new Promise<string>(resolve => {
    const name = url.split('/').pop()?.replace('.git','') || 'skill'
    const dir = join(skillsDir, name)
    exec('git clone ' + url + ' "' + dir + '"', { timeout: 30000 }, (err, stdout, stderr) => {
      resolve(err ? ('Error: ' + (stderr || err.message)) : 'ok')
    })
  })
})
ipcMain.handle('skills:delete', (_e, name: string) => {
  try {
    const dir = join(skillsDir, name)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    }
    // 也尝试删除 resources/skills 下的
    const altDir = join(resourcesDir, 'skills', name)
    if (fs.existsSync(altDir)) {
      fs.rmSync(altDir, { recursive: true, force: true })
      return true
    }
    return 'Error: skill not found'
  } catch (e: any) { return 'Error: ' + e.message }
})
ipcMain.handle('plugins:install', (_e, url: string) => {
  return new Promise<string>(resolve => {
    const dir = join(userDataPath, 'plugins')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const name = url.split('/').pop() || 'plugin'
    exec('git clone ' + url + ' "' + join(dir, name) + '"', { timeout: 30000 }, (err, stdout, stderr) => {
      resolve(err ? ('Error: ' + (stderr || err.message)) : 'ok')
    })
  })
})
ipcMain.handle('plugins:scan', () => { try { return require('./plugins/loader').scanPlugins(join(userDataPath, 'plugins')) } catch { return [] } })
ipcMain.handle('plugins:tools', () => { try { return require('./plugins/loader').getPluginTools() } catch { return [] } })
ipcMain.handle('plugins:delete', (_e, name: string) => {
  try {
    const dir = join(userDataPath, 'plugins', name)
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); return true }
    return 'Error: plugin not found'
  } catch (e: any) { return 'Error: ' + e.message }
})
ipcMain.handle('cron:toggle', (_e, id:string) => { try { require('./scheduler/cron').toggleJob(id); return true } catch { return false } })
let abortFlag = false
ipcMain.handle('llm:abort', () => { abortFlag = true })
ipcMain.handle('llm:chat', async (event, params: any) => {
  const { provider, model, apiKey, baseUrl, messages, temperature = 0.7, tools, headers: customHeaders } = params
  const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }
  // 合并自定义 Headers（JSON 或 key=value 多行格式）
  if (customHeaders) {
    try { const extra = JSON.parse(customHeaders); Object.assign(reqHeaders, extra) } catch {
      customHeaders.split('\n').forEach((line: string) => { const idx = line.indexOf('='); if (idx > 0) reqHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim() })
    }
  }
  const body: any = { model, messages, temperature, stream: true }
  if (tools?.length) { body.tools = tools }

  let url: string
  switch (provider) {
    case 'openai': url = (baseUrl || 'https://api.openai.com') + '/v1/chat/completions'; break
    case 'deepseek': url = (baseUrl || 'https://api.deepseek.com') + '/v1/chat/completions'; break
    case 'custom': url = (baseUrl || '').replace(/\/+$/, '') + '/v1/chat/completions'; break
    default: event.sender.send('llm:error', '不支持的 Provider'); return
  }

  try {
    abortFlag = false
    console.log('[LLM]', provider, model, url, 'msgs:', messages?.length, 'tools:', tools?.length || 0)
    const res = await fetch(url, { method: 'POST', headers: reqHeaders, body: JSON.stringify(body) })
    if (!res.ok) { const e = await res.text().catch(() => ''); console.error('[LLM] FAIL', res.status, e.slice(0, 400)); event.sender.send('llm:error', `API ${res.status}: ${e.slice(0, 400)}`); return }
    console.log('[LLM] stream ok')
    const reader = res.body?.getReader(); if (!reader) { event.sender.send('llm:error', '无流'); return }

    const dec = new TextDecoder(); let buf = ''
    // 累积工具调用参数
    let tcIdx = -1, tcId = '', tcName = '', tcArgs = ''

    while (true) {
      if (abortFlag) { event.sender.send('llm:chunk', { content: '', done: true }); break }
      const { done, value } = await reader.read()
      if (done) { if (tcIdx >= 0) event.sender.send('llm:toolCall', { index: tcIdx, id: tcId, type: 'function', function: { name: tcName, arguments: tcArgs } }); event.sender.send('llm:chunk', { content: '', done: true }); break }
      buf += dec.decode(value, { stream: true })
      for (const line of buf.split('\n').slice(0, -1)) { buf = buf.split('\n').pop() || ''
        const t = line.trim(); if (!t.startsWith('data: ')) continue
        const d = t.slice(6); if (d === '[DONE]') { if (tcIdx >= 0) event.sender.send('llm:toolCall', { index: tcIdx, id: tcId, type: 'function', function: { name: tcName, arguments: tcArgs } }); event.sender.send('llm:chunk', { content: '', done: true }); continue }
        try {
          const p = JSON.parse(d), choice = p.choices?.[0]
          // 累积工具调用参数片段
          const deltaTc = choice?.delta?.tool_calls?.[0]
          if (deltaTc) {
            if (deltaTc.index !== undefined) tcIdx = deltaTc.index
            if (deltaTc.id) tcId = deltaTc.id
            if (deltaTc.function?.name) tcName = deltaTc.function.name
            if (deltaTc.function?.arguments !== undefined) tcArgs += deltaTc.function.arguments
          }
          if (choice?.finish_reason) {
            if (tcIdx >= 0) event.sender.send('llm:toolCall', { index: tcIdx, id: tcId, type: 'function', function: { name: tcName, arguments: tcArgs } })
            event.sender.send('llm:chunk', { content: '', done: true })
            continue
          }
          const c = choice?.delta?.content || ''
          if (c) event.sender.send('llm:chunk', { content: c, done: false })
        } catch { /* */ }
      }
    }
  } catch (err: unknown) { event.sender.send('llm:error', err instanceof Error ? err.message : String(err)) }
})

// ─── v0.2: MCP SSE 传输 ─────────────────────────────
ipcMain.handle('mcp:sse:connect', async (_e, name: string, url: string, headers?: Record<string,string>) => {
  try { const tools = await require('./mcp/sse-transport').connectSSE({ name, type:'sse', url, headers }); return tools }
  catch(e:any) { return { error: e.message } }
})
ipcMain.handle('mcp:sse:call', async (_e, server:string, tool:string, args:any) => {
  try { return await require('./mcp/sse-transport').callSSETool(server, tool, args) }
  catch(e:any) { return 'Error: ' + e.message }
})
ipcMain.handle('mcp:sse:list', () => { try { return require('./mcp/sse-transport').listSSEServers() } catch { return [] } })

// ─── v0.2: Agent 系统 ──────────────────────────────
ipcMain.handle('agent:list', () => {
  try { return require('./agent').BUILTIN_AGENTS.map((a:any) => ({ name:a.name, role:a.role, icon:a.icon, tools:a.tools, handoff_to:a.handoff_to })) }
  catch { return [] }
})
ipcMain.handle('agent:route', (_e, msg:string) => {
  try { return require('./agent').routeIntent(msg)?.name || '阎罗王' }
  catch { return '阎罗王' }
})

// ─── v0.2: 工具缓存 ────────────────────────────────
ipcMain.handle('cache:stats', () => {
  try { return require('./cache/tool-cache').getCacheStats() }
  catch { return { size:0, hits:0, misses:0, hit_rate:'0%' } }
})
ipcMain.handle('cache:clear', () => {
  try { return require('./cache/tool-cache').invalidateCache() }
  catch { return 0 }
})

// ─── 启动 ──────────────────────────────────────────
app.whenReady().then(async () => {
  serverPort = await startServer()
  createAppMenu()
  createWindow()
  createTray()
  app.on('activate', () => mainWindow?.show())
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { isQuitting = true })
