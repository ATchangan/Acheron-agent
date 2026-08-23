import React, { useState, useEffect } from 'react'
import { C, S } from '../settings-ui'
import { U } from '../ui-styles'


// v0.3.1 块 H: 关于 tab(从 SettingsView 拆分, 行为零变化)
// v0.3.1 更新下载进度条: 订阅 update:progress 显示下载进度
// v0.3.7 下载进度细节: 显示速度/剩余时间/文件名
export default function AboutTab() {
  const [upt, setUpt] = useState<{ checking: boolean; info: { version?: string; hasUpdate?: boolean; url?: string; assets?: { name: string; size: number; url: string; digest?: string }[]; notes?: string; current?: string } | null; error: string; downloading: boolean; progress: { received: number; total: number; ts: number; speed: number } | null; downloadInfo: { ok: boolean; path?: string } | null }>({ checking: false, info: null, error: '', downloading: false, progress: null, downloadInfo: null })
  // 动态版本信息(主进程 app.getVersion + process.versions), 不硬编码
  const [info, setInfo] = useState<{ version: string; electron: string; node: string } | null>(null)
  useEffect(() => { window.huangquan.appInfo().then(setInfo).catch(() => {}) }, [])
  // 订阅下载进度(卸载时取消)
  useEffect(() => {
    const off = window.huangquan.update.onProgress((d) => {
      setUpt(prev => {
        if (!prev.downloading) return prev
        const last = prev.progress
        let speed = 0
        if (last && d.ts > last.ts) speed = Math.max(0, (d.received - last.received) / ((d.ts - last.ts) / 1000))
        return { ...prev, progress: { ...d, speed } }
      })
    })
    return () => off()
  }, [])
  const pct = upt.progress && upt.progress.total > 0 ? Math.min(100, Math.round((upt.progress.received / upt.progress.total) * 100)) : 0
  const fmtSize = (n: number) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'
  const fmtSpeed = (n: number) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB/s' : Math.round(n / 1024) + ' KB/s'
  const fmtEta = (seconds: number) => seconds <= 0 ? '' : seconds < 60 ? `剩余约 ${Math.max(1, Math.round(seconds))} 秒` : `剩余约 ${Math.round(seconds / 60)} 分钟`
  const fileName = (upt.info?.assets || []).find((x: { name: string }) => /\.exe$/i.test(x.name))?.name || ''
  const eta = upt.progress && upt.progress.total > 0 && upt.progress.speed > 0
    ? fmtEta((upt.progress.total - upt.progress.received) / upt.progress.speed)
    : ''
  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <img src="huangquan.png" alt="黄泉" style={{ width: 190, height: 190, objectFit: 'contain', filter: 'drop-shadow(0 10px 24px rgba(0,0,0,.4))' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        </div>
        <div style={S.section}>关于</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[['版本', info?.version || '…'], ['平台', 'Acheron-Agent'], ['Electron', info?.electron || '…'], ['React', React.version], ['Node', info?.node || '…']].map(([k, v]) => (
            <div key={k}><div style={S.hint}>{k}</div><div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: C.text }}>{v}</div></div>
          ))}
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>开发者</div>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>
          由 <b style={{ color: C.accent }}>ATchangan</b> 独立开发并持续维护
        </div>
        <a
          href="#"
          onClick={e => { e.preventDefault(); void window.huangquan.web.openExternal('https://github.com/ATchangan/Acheron-agent') }}
          style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontSize: 'calc(var(--ui-font-size) - 1px)', marginTop: 6, display: 'inline-block' }}
        >
          https://github.com/ATchangan/Acheron-agent
        </a>
      </div>
      <div style={S.card}>
        <div style={S.section}>软件更新</div>
                <div style={S.hint}>从 GitHub 发布页检查最新版本并下载安装包</div>
        <div style={U.wrap8mt8}>
          <button style={S.btn('primary')} onClick={async () => {
            setUpt({ ...upt, checking: true, info: null, error: '', downloading: false, progress: null })
            const r = await window.huangquan.update.check().catch((): { ok: boolean; error?: string; version?: string; hasUpdate?: boolean; url?: string; assets?: { name: string; size: number; url: string; digest?: string }[]; notes?: string; current?: string } => ({ ok: false, error: '检查失败' }))
            if (!r.ok) { setUpt({ ...upt, checking: false, error: r.error || '检查失败' }); return }
            setUpt({ ...upt, checking: false, info: { version: r.version, hasUpdate: r.hasUpdate, url: r.url, assets: r.assets, notes: r.notes, current: r.current } })
          }} disabled={upt.checking}>{upt.checking ? '检查中…' : '检查更新'}</button>
          {upt.info?.hasUpdate && <span style={{ color: C.green, fontSize: 'calc(var(--ui-font-size) - 1px)' }}>发现新版本 v{upt.info.version}（当前 v{upt.info.current}）</span>}
          {upt.info && !upt.info.hasUpdate && <span style={{ color: C.text, fontSize: 'calc(var(--ui-font-size) - 1px)' }}>已是最新版本 v{upt.info.current}</span>}
          {upt.error && <span style={{ color: C.danger, fontSize: 'calc(var(--ui-font-size) - 1px)' }}>检查失败：{upt.error.slice(0, 80)}</span>}
        </div>
        {upt.info?.hasUpdate && (
          <div style={U.mt8}>
            <div style={S.hint}>更新内容：{(upt.info.notes || '（无说明）').slice(0, 200)}</div>
            <div style={U.wrap8mt8}>
              <button style={S.btn('primary')} disabled={upt.downloading} onClick={async () => {
                const asset = (upt.info?.assets || []).find((x: { name: string }) => /\.exe$/i.test(x.name)) || (upt.info?.assets || [])[0]
                if (!asset) { setUpt({ ...upt, error: '发布页无安装包资产' }); return }
                setUpt({ ...upt, downloading: true, error: '', progress: null, downloadInfo: null })
                const r = await window.huangquan.update.download(asset.url, asset.name, asset.digest).catch(() => ({ ok: false, error: '下载失败' }))
                setUpt({ ...upt, downloading: false, downloadInfo: r.ok ? r : null, error: r.ok ? '' : (r.error || '下载失败') })
              }}>{upt.downloading ? '下载中…' : '下载安装包'}</button>
              {upt.downloading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220, flex: '1 1 220px' }}>
                  {fileName && <div style={S.hint}>正在下载 {fileName}</div>}
                  <div style={{ height: 8, borderRadius: 4, background: 'color-mix(in srgb, var(--accent-color) 18%, transparent)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: pct + '%', background: 'var(--accent-color)', borderRadius: 4, transition: 'width 0.2s' }} />
                  </div>
                  <div style={S.hint}>
                    {upt.progress && upt.progress.total > 0
                      ? `${pct}% · ${fmtSize(upt.progress.received)} / ${fmtSize(upt.progress.total)}${upt.progress.speed > 0 ? ` · ${fmtSpeed(upt.progress.speed)}` : ''}${eta ? ` · ${eta}` : ''}`
                      : upt.progress
                        ? `已下载 ${fmtSize(upt.progress.received)}${upt.progress.speed > 0 ? ` · ${fmtSpeed(upt.progress.speed)}` : ''}`
                        : '连接下载中…'}
                  </div>
                </div>
              )}
              {upt.downloadInfo && (
                <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.green }}>
                  已保存到 {upt.downloadInfo.path}
                  <button style={{ ...S.btn('ghost'), marginLeft: 8 }} onClick={async () => { try { await window.huangquan.computer.openFile(upt.downloadInfo?.path || '') } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } }}>打开安装包</button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
