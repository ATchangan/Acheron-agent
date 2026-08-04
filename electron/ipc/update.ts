// electron/ipc/update.ts —— 自动更新域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import { join } from 'path'

const UPDATE_REPO = 'ATchangan/Acheron-agent'
function currentVersion(): string {
  try { return require('../../package.json').version || app.getVersion() || '0.0.0' } catch { return app.getVersion() || '0.0.0' }
}
function compareVer(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split('.').map(n => parseInt(n) || 0)
  const pb = String(b).replace(/^v/i, '').split('.').map(n => parseInt(n) || 0)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0
    if (x !== y) return x - y
  }
  return 0
}

export function registerUpdateIpc(deps: {
  netFetch: typeof fetch
}): void {
  const { netFetch } = deps

  ipcMain.handle('update:check', async () => {
    try {
      const res = await netFetch('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', {
        headers: { 'User-Agent': 'huangquan-agent', 'Accept': 'application/vnd.github+json' },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status }
      const d = (await res.json()) as { tag_name?: string; html_url?: string; body?: string; assets?: { name: string; browser_download_url: string; size?: number }[] }
      const latest = String(d.tag_name || '').replace(/^v/i, '')
      const cur = currentVersion()
      const has = compareVer(latest, cur) > 0
      return {
        ok: true, hasUpdate: has, version: latest, current: cur,
        url: String(d.html_url || ''),
        assets: (d.assets || []).map((a: { name: string; browser_download_url: string; size?: number }) => ({ name: a.name, size: a.size || 0, url: a.browser_download_url })),
        notes: String(d.body || '').slice(0, 800),
      }
    } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
  })
  // 下载安装包到系统下载目录(带进度事件)
  ipcMain.handle('update:download', async (event, url: string, fileName: string) => {
    try {
      const name = String(fileName || '').replace(/[^\w\-. ]/g, '').slice(0, 120) || 'Acheron-agent-update.exe'
      const dest = join(app.getPath('downloads'), name)
      const res = await netFetch(String(url), { signal: AbortSignal.timeout(1800000) })
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status }
      const reader = res.body?.getReader()
      if (!reader) return { ok: false, error: '无响应流' }
      const chunks: Buffer[] = []
      let received = 0
      const total = Number(res.headers.get('content-length') || 0)
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) chunks.push(Buffer.from(value))
        received += value.length
        if (total > 0 && received % (1024 * 512) < 4096) {
          try { event.sender.send('update:progress', { received, total }) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
        }
      }
      fs.writeFileSync(dest, Buffer.concat(chunks))
      return { ok: true, path: dest, size: received }
    } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
  })
}
