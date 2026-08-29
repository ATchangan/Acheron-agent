// electron/main-utils.ts —— 主进程纯工具函数（从 main.ts 拆出，行为不变）
import { safeStorage } from 'electron'
import * as fs from 'fs'
import { join, extname, sep } from 'path'
import * as http from 'http'

export interface MainProvider { id: string; type: string; name: string; apiKey?: string; baseUrl?: string; models?: string[]; selectedModel?: string; customHeaders?: string }
export interface MainSettingsData { providers: MainProvider[]; mediaProviders?: { apiKey?: string }[]; general?: Record<string, unknown> }

function safeClone(obj: unknown, seen = new WeakSet()): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  // 防止循环引用
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)
  // 处理数组
  if (Array.isArray(obj)) return obj.map(item => safeClone(item, seen))
  // 处理普通对象
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    try {
      const val = (obj as Record<string, unknown>)[key]
      // 跳过函数、Symbol、DOM 节点等不可序列化类型
      const t = typeof val
      if (t === 'function' || t === 'symbol' || t === 'undefined') continue
      if (val instanceof Error) { result[key] = { message: val.message, name: val.name }; continue }
      if (val && typeof val === 'object') {
        // 跳过 Buffer、Stream、Electron 内部对象等
        if (val.constructor?.name === 'BrowserWindow' || val.constructor?.name === 'WebContents') continue
        if (Buffer.isBuffer(val)) { result[key] = '[Buffer ' + val.length + ' bytes]'; continue }
        result[key] = safeClone(val, seen)
      } else {
        result[key] = val
      }
    } catch (e) { console.debug('[swallow]', e) }
  }
  return result
}

// API Key 加密存储(Windows DPAPI via safeStorage)
function encKey(v: string): string {
  if (!v || v.startsWith('__ENC__')) return v
  try { if (safeStorage.isEncryptionAvailable()) return '__ENC__' + safeStorage.encryptString(v).toString('base64') } catch (e) { console.debug('[swallow]', e) }
  return v
}
function decKey(v: string): string {
  if (!v || !v.startsWith('__ENC__')) return v
  try { return safeStorage.decryptString(Buffer.from(v.slice(7), 'base64')) } catch { return v }
}
// 敏感字段全覆盖 —— apiKey + customHeaders(可含 Authorization) + webReadCookies(登录态)
function encProviders(data: MainSettingsData): MainSettingsData {
  if (!data || typeof data !== 'object') return data
  const out = { ...data, general: data.general ? { ...data.general } : data.general }
  if (Array.isArray(out.providers)) out.providers = out.providers.map((p: MainProvider) => (p && p.apiKey) ? { ...p, apiKey: encKey(p.apiKey), customHeaders: p.customHeaders ? encKey(String(p.customHeaders)) : p.customHeaders } : p)
  if (Array.isArray((out as { mediaProviders?: unknown }).mediaProviders)) (out as { mediaProviders: { apiKey?: string }[] }).mediaProviders = (out as { mediaProviders: { apiKey?: string }[] }).mediaProviders.map((p: { apiKey?: string }) => (p && p.apiKey) ? { ...p, apiKey: encKey(p.apiKey) } : p)
  if (out.general && typeof out.general.webReadCookies === 'string' && out.general.webReadCookies.trim()) out.general.webReadCookies = encKey(out.general.webReadCookies)
  if (out.general && typeof out.general.embeddingApiKey === 'string' && out.general.embeddingApiKey.trim()) out.general.embeddingApiKey = encKey(out.general.embeddingApiKey)
  return out
}
function decProviders(data: MainSettingsData): MainSettingsData {
  if (!data || typeof data !== 'object') return data
  const out = { ...data, general: data.general ? { ...data.general } : data.general }
  if (Array.isArray(out.providers)) out.providers = out.providers.map((p: MainProvider) => (p && p.apiKey) ? { ...p, apiKey: decKey(p.apiKey), customHeaders: p.customHeaders ? decKey(String(p.customHeaders)) : p.customHeaders } : p)
  if (Array.isArray((out as { mediaProviders?: unknown }).mediaProviders)) (out as { mediaProviders: { apiKey?: string }[] }).mediaProviders = (out as { mediaProviders: { apiKey?: string }[] }).mediaProviders.map((p: { apiKey?: string }) => (p && p.apiKey) ? { ...p, apiKey: decKey(p.apiKey) } : p)
  if (out.general && typeof out.general.webReadCookies === 'string' && out.general.webReadCookies.startsWith('__ENC__')) out.general.webReadCookies = decKey(out.general.webReadCookies)
  if (out.general && typeof out.general.embeddingApiKey === 'string' && out.general.embeddingApiKey.startsWith('__ENC__')) out.general.embeddingApiKey = decKey(out.general.embeddingApiKey)
  return out
}

function dirSize(dir: string): number {
  let total = 0
  try {
    if (!fs.existsSync(dir)) return 0
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name)
      if (f.isDirectory()) total += dirSize(p)
      else if (f.isFile()) total += fs.statSync(p).size
    }
  } catch (e) { console.debug('[swallow]', e) }
  return total
}
function fmtSize(b: number): string {
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'
  return (b / 1073741824).toFixed(2) + ' GB'
}

function startServer(distDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
      '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
    }
    const s = http.createServer((req, res) => {
      const reqPath = (req.url || '/').split('?')[0].replace(/\/$/, '') || '/index.html'
      const fp = join(distDir, reqPath)
      // 安全: 前缀必须带尾分隔符, 防 /dist-evil 同前缀兄弟目录绕过
      const rootWithSep = distDir.endsWith(sep) ? distDir : distDir + sep
      if (!fp.startsWith(rootWithSep) && fp !== distDir) { res.writeHead(403); res.end('403'); return }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('404'); return }
        // 静态资源一律不缓存: 桌面本地服务, 避免端口复用/热重启时浏览器命中旧 JS 导致界面显示旧版
        res.writeHead(200, {
          'Content-Type': mime[extname(fp)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        })
        res.end(data)
      })
    })
    // 固定端口让渲染进程 origin 稳定，localStorage(引导/回应/侧栏顺序/快捷键等)才能跨重启持久。
    // 端口被占用则顺延；静态资源已带 no-cache，热重启不会命中旧 JS。
    const tryListen = (port: number) => {
      s.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port < 2111) tryListen(port + 1)
        else { s.removeAllListeners('error'); reject(err) }
      })
      s.listen(port, '127.0.0.1', () => {
        const addr = s.address(); resolve(typeof addr === 'object' ? addr!.port : 0)
      })
    }
    tryListen(2101)
  })
}

export { safeClone, encKey, decKey, encProviders, decProviders, dirSize, fmtSize, startServer }
