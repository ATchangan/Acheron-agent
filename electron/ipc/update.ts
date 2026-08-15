// electron/ipc/update.ts —— 自动更新域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

const UPDATE_REPO = 'ATchangan/Acheron-agent'

export interface DownloadProgress { received: number; total: number; ts: number }

// 纯下载逻辑(独立于 Electron IPC, 便于单测): 流式写入 + Range 断点续传 + SHA256 校验 + 原子替换
export async function downloadToFile(opts: {
  netFetch: typeof fetch
  url: string
  dest: string
  expectedSha256?: string
  signal?: AbortSignal
  onProgress?: (p: DownloadProgress) => void
}): Promise<{ ok: boolean; error?: string; path?: string; size?: number }> {
  const { netFetch, url, dest, expectedSha256, signal, onProgress } = opts
  const part = dest + '.part'
  const hash = createHash('sha256')
  let offset = 0
  try {
    // 已有 .part 时用 Range 断点续传; 服务器不支持(返回 200)则从头重下
    try { offset = fs.statSync(part).size || 0 } catch { offset = 0 }
    let res: Awaited<ReturnType<typeof netFetch>> | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers: Record<string, string> = {}
      if (offset > 0) headers['Range'] = 'bytes=' + offset + '-'
      res = await netFetch(url, { headers, signal })
      if (res.status === 416 && offset > 0) { try { fs.rmSync(part, { force: true }) } catch { /* 忽略 */ } offset = 0; continue }
      if (!res.ok && !(offset > 0 && res.status === 206)) return { ok: false, error: 'HTTP ' + res.status }
      if (offset > 0 && res.status !== 206) { try { fs.rmSync(part, { force: true }) } catch { /* 忽略 */ } offset = 0 }
      break
    }
    if (!res || !res.body) return { ok: false, error: '无响应流' }
    // 续传时摘要需要先覆盖已下载的部分, 否则最终 SHA256 不完整
    if (offset > 0 && expectedSha256) {
      const fd = fs.createReadStream(part)
      for await (const chunk of fd) hash.update(chunk as Buffer)
    }
    const stream = fs.createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' })
    const reader = res.body.getReader()
    let received = offset
    const total = offset + Number(res.headers.get('content-length') || 0)
    let lastSentAt = 0
    let lastSentBytes = 0
    const sendProgress = (): void => {
      lastSentAt = Date.now()
      lastSentBytes = received
      onProgress?.({ received, total, ts: lastSentAt })
    }
    sendProgress()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          const buf = Buffer.from(value)
          hash.update(buf)
          await new Promise<void>((resolve, reject) => { stream.write(buf, (err: Error | null | undefined) => (err ? reject(err) : resolve())) })
          received += buf.length
        }
        if (received - lastSentBytes >= 256 * 1024 || Date.now() - lastSentAt >= 300) sendProgress()
      }
      await new Promise<void>((resolve, reject) => { stream.end((err: Error | null | undefined) => (err ? reject(err) : resolve())) })
    } catch (e) {
      stream.destroy()
      return { ok: false, error: '下载中断, 已保留进度, 可再次点击继续: ' + (e instanceof Error ? e.message : String(e)) }
    }
    sendProgress()
    if (expectedSha256) {
      const expected = String(expectedSha256).toLowerCase().replace(/^sha256:/, '')
      if (expected && hash.digest('hex') !== expected) {
        try { fs.rmSync(part, { force: true }) } catch { /* 忽略 */ }
        return { ok: false, error: 'SHA256 校验失败, 已丢弃损坏的下载' }
      }
    }
    // 同目录 rename 近似原子替换; Windows 覆盖式 rename 会失败, 先删旧文件
    try { fs.rmSync(dest, { force: true }) } catch { /* 忽略 */ }
    fs.renameSync(part, dest)
    return { ok: true, path: dest, size: received }
  } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
}

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
      const d = (await res.json()) as { tag_name?: string; html_url?: string; body?: string; assets?: { name: string; browser_download_url: string; size?: number; digest?: string }[] }
      const latest = String(d.tag_name || '').replace(/^v/i, '')
      const cur = currentVersion()
      const has = compareVer(latest, cur) > 0
      return {
        ok: true, hasUpdate: has, version: latest, current: cur,
        url: String(d.html_url || ''),
        assets: (d.assets || []).map((a: { name: string; browser_download_url: string; size?: number; digest?: string }) => ({ name: a.name, size: a.size || 0, url: a.browser_download_url, digest: String(a.digest || '') })),
        notes: String(d.body || '').slice(0, 800),
      }
    } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
  })
  // 下载安装包到系统下载目录(带进度事件)
  ipcMain.handle('update:download', async (event, url: string, fileName: string, expectedSha256?: string) => {
    const name = String(fileName || '').replace(/[^\w\-. ]/g, '').slice(0, 120) || 'Acheron-agent-update.exe'
    const dest = join(app.getPath('downloads'), name)
    const r = await downloadToFile({
      netFetch,
      url: String(url),
      dest,
      expectedSha256: expectedSha256 ? String(expectedSha256) : undefined,
      signal: AbortSignal.timeout(1800000),
      onProgress: p => {
        try { event.sender.send('update:progress', p) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      },
    })
    return r
  })

  // v0.4.0 E3: electron-updater 增量更新(GitHub Release, app-update.yml 由构建生成)
  // 未打包/未配置时静默禁用; 手动下载通道保留为兜底
  let autoUpdater: import('electron-updater').AppUpdater | null = null
  try {
    if (app.isPackaged) {
      const updater = require('electron-updater') as typeof import('electron-updater')
      autoUpdater = updater.autoUpdater
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      const broadcast = (channel: string, payload: unknown): void => {
        for (const w of BrowserWindow.getAllWindows()) {
          try { w.webContents.send(channel, payload) } catch { /* 忽略 */ }
        }
      }
      autoUpdater.on('update-available', (info) => broadcast('update:auto-available', info))
      autoUpdater.on('update-not-available', (info) => broadcast('update:auto-none', info))
      autoUpdater.on('download-progress', (p) => broadcast('update:auto-progress', p))
      autoUpdater.on('update-downloaded', (info) => broadcast('update:auto-downloaded', info))
      autoUpdater.on('error', (e) => broadcast('update:auto-error', { message: e instanceof Error ? e.message : String(e) }))
    }
  } catch { autoUpdater = null }

  ipcMain.handle('update:auto-check', async () => {
    try {
      if (!autoUpdater) return { ok: false, error: '自动更新不可用(未打包或未配置发布源)' }
      const r = await autoUpdater.checkForUpdates()
      return { ok: true, version: r?.updateInfo?.version || '', current: currentVersion() }
    } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
  })
  ipcMain.handle('update:auto-download', async () => {
    try {
      if (!autoUpdater) return { ok: false, error: '自动更新不可用' }
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e: unknown) { return { ok: false, error: (e instanceof Error ? e.message : String(e)) } }
  })
  ipcMain.handle('update:auto-install', () => {
    if (!autoUpdater) return { ok: false, error: '自动更新不可用' }
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  })
}
