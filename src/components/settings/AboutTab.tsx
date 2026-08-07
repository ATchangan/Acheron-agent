import React, { useState, useEffect } from 'react'
import { C, S } from '../settings-ui'
import { U } from '../ui-styles'


// v0.3.1 块 H: 关于 tab(从 SettingsView 拆分, 行为零变化)
// v0.3.1 更新下载进度条: 订阅 update:progress 显示下载进度
export default function AboutTab() {
  const [upt, setUpt] = useState<{ checking: boolean; info: { version?: string; hasUpdate?: boolean; url?: string; assets?: { name: string; size: number; url: string }[]; notes?: string; current?: string } | null; error: string; downloading: boolean; progress: { received: number; total: number } | null; downloadInfo: { ok: boolean; path?: string } | null }>({ checking: false, info: null, error: '', downloading: false, progress: null, downloadInfo: null })
  // 动态版本信息(主进程 app.getVersion + process.versions), 不硬编码
  const [info, setInfo] = useState<{ version: string; electron: string; node: string } | null>(null)
  useEffect(() => { window.huangquan.appInfo().then(setInfo).catch(() => {}) }, [])
  // 订阅下载进度(卸载时取消)
  useEffect(() => {
    const off = window.huangquan.update.onProgress((d) => {
      setUpt(prev => prev.downloading ? { ...prev, progress: d } : prev)
    })
    return () => off()
  }, [])
  const pct = upt.progress && upt.progress.total > 0 ? Math.min(100, Math.round((upt.progress.received / upt.progress.total) * 100)) : 0
  const fmtSize = (n: number) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'
  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={S.section}>关于</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[['版本', info?.version || '…'], ['平台', '黄泉Agent'], ['Electron', info?.electron || '…'], ['React', React.version], ['Node', info?.node || '…']].map(([k, v]) => (
            <div key={k}><div style={S.hint}>{k}</div><div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: C.text }}>{v}</div></div>
          ))}
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>软件更新</div>
                <div style={S.hint}>从 GitHub 发布页检查最新版本并下载安装包</div>
        <div style={U.wrap8mt8}>
          <button style={S.btn('primary')} onClick={async () => {
            setUpt({ ...upt, checking: true, info: null, error: '', downloading: false, progress: null })
            const r = await window.huangquan.update.check().catch((): { ok: boolean; error?: string; version?: string; hasUpdate?: boolean; url?: string; assets?: { name: string; size: number; url: string }[]; notes?: string; current?: string } => ({ ok: false, error: '检查失败' }))
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
                const r = await window.huangquan.update.download(asset.url, asset.name).catch(() => ({ ok: false, error: '下载失败' }))
                setUpt({ ...upt, downloading: false, downloadInfo: r.ok ? r : null, error: r.ok ? '' : (r.error || '下载失败') })
              }}>{upt.downloading ? '下载中…' : '下载安装包'}</button>
              {upt.downloading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220, flex: '1 1 220px' }}>
                  <div style={{ height: 8, borderRadius: 4, background: 'color-mix(in srgb, var(--accent-color) 18%, transparent)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: pct + '%', background: 'var(--accent-color)', borderRadius: 4, transition: 'width 0.2s' }} />
                  </div>
                  <div style={S.hint}>
                    {upt.progress && upt.progress.total > 0
                      ? `下载中 ${pct}% · ${fmtSize(upt.progress.received)} / ${fmtSize(upt.progress.total)}`
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
