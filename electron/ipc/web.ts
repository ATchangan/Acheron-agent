// electron/ipc/web.ts —— 网络域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'
import * as fs from 'fs'

export function registerWebIpc(deps: {
  settingsPath: string
  netFetch: (url: string, opts?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ text(): Promise<string> }>
  decKey: (enc: string) => string
}): void {
  const { settingsPath, netFetch, decKey } = deps

  ipcMain.handle('web:search', async (_e, query: string) => {
    try {
      const u = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)
      const r = await netFetch(u, { signal: AbortSignal.timeout(10000) })
      const h = await r.text()
      // 多层正则 fallback 以应对 DDG 页面结构变化
      let out: string[] = []
      // 尝试主解析模式
      const re1 = /<a[^>]*class="result__a"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*?>([^<]+)<\/a>/gi
      let m
      while ((m = re1.exec(h)) && out.length < 5) {
        out.push(`${out.length + 1}. ${m[1].trim()}: ${m[2].trim().replace(/<[^>]+>/g, '')}`)
      }
      // fallback: 尝试更宽松的匹配
      if (!out.length) {
        const re2 = /class="result__title"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/gi
        const re2b = /class="result__snippet"[^>]*>([^<]+)/gi
        const titles: string[] = []; const snippets: string[] = []
        while ((m = re2.exec(h))) titles.push(m[1].trim().replace(/<[^>]+>/g, ''))
        while ((m = re2b.exec(h))) snippets.push(m[1].trim().replace(/<[^>]+>/g, ''))
        for (let i = 0; i < Math.min(titles.length, snippets.length, 5); i++) {
          out.push(`${i + 1}. ${titles[i]}: ${snippets[i]}`)
        }
      }
      return out.length ? out.join('\n') : '(无结果)'
    } catch { return '(搜索失败)' }
  })

  ipcMain.handle('web:fetch', async (_e, url: string) => {
    try {
      const res = await netFetch(url, { signal: AbortSignal.timeout(15000) })
      return await res.text().then(t => t.slice(0, 50000))
    } catch (err: unknown) {
      return 'Error: ' + (err instanceof Error ? err.message : String(err))
    }
  })

  // v0.3.3 性能优化: web_read 缓存加条数上限 + 过期清扫(原 TTL 过期条目从不清理, 无上限)
  const WEB_READ_CACHE_MAX = 200
  const WEB_READ_CACHE_TTL_MS = 10000
  const webReadCache = new Map<string, { ts: number; result: string }>()
  const sweepWebReadCache = (): void => {
    const now = Date.now()
    for (const [k, v] of webReadCache) {
      if (now - v.ts > WEB_READ_CACHE_TTL_MS) webReadCache.delete(k)
    }
    while (webReadCache.size >= WEB_READ_CACHE_MAX) {
      const k = webReadCache.keys().next().value
      if (!k) break
      webReadCache.delete(k)
    }
  }
  ipcMain.handle('web:read', async (_e, url: string, mode?: string) => {
    const cacheKey = url + '|' + (mode || 'text')
    const cachedHit = webReadCache.get(cacheKey)
    if (cachedHit && Date.now() - cachedHit.ts < WEB_READ_CACHE_TTL_MS) return cachedHit.result
    if (cachedHit) webReadCache.delete(cacheKey)
    try {
      const { webRead } = require('../webtools')
      // 读取设置中的浏览器解析配置(双向绑定全局配置文件)
      let cfg: Record<string, unknown> = {}
      try { cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general || {} } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      // 直接读文件时 cookie 是密文, 需解密后传给 web_read
      if (typeof cfg.webReadCookies === 'string' && cfg.webReadCookies.startsWith('__ENC__')) cfg.webReadCookies = decKey(cfg.webReadCookies)
      // 总开关: 关闭后 角色无法调用 web_read
      if (cfg.webReadEnabled === false) {
        return JSON.stringify({ ok: false, error: 'web_read 已被禁用', advice: '请在 设置 → 工具 → 无头浏览器网页解析工具 中开启总开关' })
      }
      const timeoutMs = parseInt(String(cfg.webReadTimeout || '')) || 15000
      const result = await webRead({
        url,
        mode: mode || 'text',
        headless: cfg.webReadHeadless !== false,
        timeoutMs,
        userAgent: cfg.webReadUA || '',
        proxy: cfg.webReadProxy || '',
        ignoreHTTPSErrors: true,
        cleanAds: cfg.webReadCleanAds !== false,
        autoClose: cfg.webReadAutoClose !== false,
        cookies: cfg.webReadCookies || '',
      })
      sweepWebReadCache()
      webReadCache.set(cacheKey, { ts: Date.now(), result: JSON.stringify(result) })
      return JSON.stringify(result)
    } catch (e: unknown) {
      return JSON.stringify({ ok: false, error: 'web_read 调用异常: ' + (e instanceof Error ? e.message : String(e)), advice: '请查看应用日志或稍后重试' })
    }
  })
}
