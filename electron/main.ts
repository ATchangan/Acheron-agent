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
      if (raw.trim()) return JSON.parse(raw)
    }
  } catch (e) { console.error('settings load error:', e) }
  return { providers: [], general: { theme: 'dark' } }
})
ipcMain.handle('settings:save', (_e, s) => {
  try {
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf-8')
    return true
  } catch (e) { console.error('settings save error:', e); return false }
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

// ─── 电脑控制 ──────────────────────────────────────
ipcMain.handle('computer:exec', async (_e, cmd: string) => {
  return new Promise<string>((resolve) => {
    exec(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve(err ? (stderr || err.message) : stdout)
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

// ─── 截图 ─────────────────────────────────────────
ipcMain.handle('computer:screenshot', async () => {
  try {
    const img = await mainWindow?.webContents.capturePage()
    if (!img) throw new Error('截图失败')
    return img.toDataURL()
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : '截图失败')
  }
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

// ─── LLM ───────────────────────────────────────────
let abortFlag = false
ipcMain.handle('llm:abort', () => { abortFlag = true })
ipcMain.handle('llm:chat', async (event, params: any) => {
  const { provider, model, apiKey, baseUrl, messages, temperature = 0.7, tools } = params
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }
  const body: any = { model, messages, temperature, stream: true }
  if (tools?.length) body.tools = tools

  let url: string
  switch (provider) {
    case 'openai': url = (baseUrl || 'https://api.openai.com') + '/v1/chat/completions'; break
    case 'deepseek': url = (baseUrl || 'https://api.deepseek.com') + '/v1/chat/completions'; break
    case 'custom': url = (baseUrl || '').replace(/\/+$/, '') + '/v1/chat/completions'; break
    default: event.sender.send('llm:error', '不支持的 Provider'); return
  }

  try {
    abortFlag = false
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) { const e = await res.text().catch(() => ''); event.sender.send('llm:error', `API ${res.status}: ${e.slice(0, 300)}`); return }
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
