// electron/ipc/media.ts —— 媒体域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { exec } from 'child_process'

export function registerMediaIpc(deps: {
  settingsPath: string
  userDataPath: string
  netFetch: typeof fetch
  getEffectiveWorkDir: () => string | undefined
}): void {
  const { settingsPath, userDataPath, netFetch, getEffectiveWorkDir } = deps

  ipcMain.handle('media:describe', async (_e, opts?: { local?: boolean; localUrl?: string }) => {
    const out: string[] = []
    // 本地视觉模型探测
    try {
      const url = (opts?.localUrl || 'http://localhost:1234') + '/v1/models'
      const r = await netFetch(url, { signal: AbortSignal.timeout(5000) })
      if (r.ok) {
        const d = (await r.json()) as { data?: { id: string }[] }
        const ids = (d.data || []).map((m: { id: string }) => m.id)
        out.push('本地视觉 (LM Studio): ' + (ids.length ? ids.join(', ') : '无已加载模型'))
        out.push('  API: ' + url)
      } else out.push('本地视觉 (LM Studio): 服务未就绪 (' + r.status + ')')
    } catch { out.push('本地视觉 (LM Studio): 连接失败，请确认服务已启动') }
    if (opts?.local) return out.join('\n')
    // 媒体生成 CLI 探测
    const cliProbe = (cmd: string) => new Promise<string>(resolve => {
      exec(cmd, { timeout: 4000 }, (_e, stdout) => resolve((stdout || '').slice(0, 200).trim()))
    })
    const jimeng = await cliProbe('jimeng --version 2>&1')
    const agnes = await cliProbe('agnes --version 2>&1')
    const kling = await cliProbe('kling --version 2>&1')
    // 从 settings.json 读取多媒体默认配置（主进程无渲染端 store）
    let g: Record<string, unknown> = {}
    try { g = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).general || {} } catch (e) { console.debug('[swallow]', e) }
    out.push('媒体生成适配器:')
    out.push(jimeng ? '  - 即梦 jimeng-cli [OK] ' + jimeng : '  - 即梦 jimeng-cli [X] 未安装')
    out.push(agnes ? '  - Agnes [OK] ' + agnes : '  - Agnes [X] 未安装')
    out.push(kling ? '  - 可灵 Kling [OK] ' + kling : '  - 可灵 Kling [X] 未安装')
    out.push('图片生成默认: ' + (g.mediaImgProvider || '自动探测') + ' / ' + (g.mediaImgMode || 'text2image') + ' / ' + (g.mediaImgRatio || '1:1'))
    out.push('视频生成默认: ' + (g.mediaVideoModel || '自动探测') + ' / ' + (g.mediaVideoMode || 'text2video') + ' / ' + (g.mediaVideoDuration || 5) + 's')
    return out.join('\n')
  })

  // v0.3.0: 媒体生成 —— 生图走 OpenAI 兼容 images API(REST), 生视频走 CLI 适配器(jimeng/agnes/kling 等)
  ipcMain.handle('media:gen', async (_e, opts: { kind: 'img' | 'video'; prompt: string; providerId?: string; model?: string; ratio?: string; duration?: number }) => {
    try {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { general?: Record<string, unknown>; mediaProviders?: { id: string; name: string; apiKey?: string; baseUrl?: string; headers?: string; imgModels?: string[]; videoModels?: string[] }[] }
      const g = (s.general || {}) as Record<string, unknown>
      const mps = (s.mediaProviders || [])
      const wd = getEffectiveWorkDir() || userDataPath
      const mediaDir = join(wd, 'media')
      fs.mkdirSync(mediaDir, { recursive: true })
      if (opts.kind === 'img') {
        const pid = opts.providerId || String(g.mediaImgProvider || '')
        const mp = mps.find(x => x.id === pid) || mps.find(x => (x.imgModels || []).length)
        if (!mp) return { ok: false, error: '未配置图片生成平台(设置→供应商→图片平台, 读取模型后勾选)' }
        const model = opts.model || String((g.mediaImgModel || '').toString().split('::').pop() || '') || (mp.imgModels || [])[0]
        if (!model) return { ok: false, error: '图片平台未读取模型(供应商页点「读取模型」勾选添加)' }
        const baseUrl = String(mp.baseUrl || '').replace(/\/+$/, '')
        if (!baseUrl) return { ok: false, error: '图片平台未配置 Base URL' }
        const ratio = opts.ratio || String(g.mediaImgRatio || '1:1')
        const sizeMap: Record<string, string> = { '1:1': '1024x1024', '16:9': '1280x720', '9:16': '720x1280', '4:3': '1024x768', '3:4': '768x1024', '3:2': '1152x768', '2:3': '768x1152' }
        const size = sizeMap[ratio] || '1024x1024'
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (mp.apiKey) headers['Authorization'] = 'Bearer ' + mp.apiKey
        if (mp.headers) { for (const kv of String(mp.headers).split('\n')) { const i2 = kv.indexOf('='); if (i2 > 0) headers[kv.slice(0, i2).trim()] = kv.slice(i2 + 1).trim() } }
        const r = await netFetch(baseUrl + '/images/generations', { method: 'POST', headers, body: JSON.stringify({ model, prompt: opts.prompt, size, n: 1 }) })
        const d = (await r.json().catch(() => ({}))) as { error?: { message?: string }; message?: string; data?: { url?: string; b64_json?: string }[] }
        if (!r.ok) return { ok: false, error: '生成失败: ' + String(d?.error?.message || d?.message || r.status).slice(0, 300) }
        const item = (d?.data || [])[0]
        const imgUrl = item?.url || item?.b64_json
        if (!imgUrl) return { ok: false, error: '生成接口未返回图片' }
        const fpath = join(mediaDir, 'img_' + Date.now() + '.png')
        if (item?.b64_json) fs.writeFileSync(fpath, Buffer.from(item.b64_json, 'base64'))
        else { const img = await netFetch(String(imgUrl), { signal: AbortSignal.timeout(30000) }); if (!img.ok) return { ok: false, error: '图片下载失败: ' + img.status }; fs.writeFileSync(fpath, Buffer.from(await img.arrayBuffer())) }
        return { ok: true, path: fpath }
      }
      // 视频: CLI 适配器
      const pid2 = opts.providerId || String(g.mediaVideoProvider || '')
      const mp2 = mps.find(x => x.id === pid2) || mps.find(x => (x.videoModels || []).length)
      const cliMap: Record<string, string> = { '即梦Jimeng': 'jimeng', 'Agnes': 'agnes', '可灵Kling': 'kling', 'Runway': 'runway', 'Pika': 'pika' }
      const cli = cliMap[mp2?.name || ''] || 'jimeng'
      const fpath2 = join(mediaDir, 'video_' + Date.now() + '.mp4')
      const dur = opts.duration || Number(g.mediaVideoDuration || 5)
      const cmd = cli + ' --prompt "' + String(opts.prompt).replace(/"/g, '\\"') + '" --duration ' + dur + ' --output "' + fpath2 + '"'
      return await new Promise<{ ok: boolean; path?: string; error?: string }>(resolve => {
        exec(cmd, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
          if (err) resolve({ ok: false, error: '生成失败: ' + String(err.message || '').slice(0, 200) + '（请确认已安装 ' + cli + ' CLI 并配置 API）' })
          else if (fs.existsSync(fpath2)) resolve({ ok: true, path: fpath2 })
          else resolve({ ok: false, error: '生成失败: ' + String(stdout || '').slice(0, 200) })
        })
      })
    } catch (e) { return { ok: false, error: '生成异常: ' + (e instanceof Error ? e.message : String(e)) } }
  })
}
