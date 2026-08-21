import React, { useState, useEffect, useCallback } from 'react'
import { errMsg } from '../utils/safe'
import { useSettingsStore } from '../store/settings'
import { YELLOW_RIVER } from './plugin-types'
import type { PluginManifest, PluginInfo, PluginState } from './plugin-types'
import { s } from './plugin-styles'
import { MaskMark, EmptyMark } from './themed-icons'
import { PluginInstallPanel } from './PluginInstallPanel'
import { PluginScanBar } from './PluginScanBar'
import { PluginList } from './PluginList'
import { U } from './ui-styles'


export default function PluginsView() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  // Install form
  const [showInstall, setShowInstall] = useState(false)
  const [installType, setInstallType] = useState<'local' | 'git'>('local')
  const [localPath, setLocalPath] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [installMsg, setInstallMsg] = useState('')
  const [installing, setInstalling] = useState(false)

  // ── 插件扫描 ──────────────────────────────────
  const scanPlugins = useCallback(async () => {
    setLoading(true)
    setScanError(null)
    try {
      // v0.4.x: 插件目录由主进程 get:paths 直接提供(不再从工作区字符串截取推导)
      const paths = await window.huangquan.getPaths()
      const pluginsDir = paths.pluginsDir

      let entries: { name: string; isDirectory: boolean }[]
      try {
        entries = await window.huangquan.computer.readDir(pluginsDir)
      } catch {
        // 插件目录不存在时
        setPlugins([])
        setLoading(false)
        return
      }

      const dirs = entries.filter((e) => e.isDirectory)

      // v0.4.x: 插件状态存 settings.json(general.pluginStates), 修复 SQLite 迁移后丢状态的旧问题
      const rawState = await window.huangquan.plugins.getState()
      const savedState: Record<string, PluginState> = {}
      for (const [k, v] of Object.entries(rawState || {})) {
        savedState[k] = { enabled: v?.enabled ?? true, category: v?.category || 'oni' }
      }

      const loaded: PluginInfo[] = []
      for (const dir of dirs) {
        const manifestPath = `${pluginsDir}/${dir.name}/manifest.json`
        try {
          const raw = await window.huangquan.computer.readFile(manifestPath)
          const manifest: PluginManifest = JSON.parse(raw)
          loaded.push({
            manifest,
            dirName: dir.name,
            enabled: savedState[dir.name]?.enabled ?? true,
            category:
              savedState[dir.name]?.category ||
              manifest.category ||
              'oni',
          })
        } catch {
        // 缺少清单或解析失败 → 跳过
        }
      }
      setPlugins(loaded)
    } catch (e: unknown) {
      setScanError(errMsg(e) || '插件扫描失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    scanPlugins()
  }, [scanPlugins])

  // v0.4.x 自写插件: Agent 通过 install_plugin/remove_plugin 落盘后, 主进程推送刷新信号 → 立即重扫
  useEffect(() => {
    try { return window.huangquan.plugins.onChanged(() => { void scanPlugins() }) } catch { return undefined }
  }, [scanPlugins])

  // ── 启用/禁用 切换 ──────────────────────────────────
  const togglePlugin = async (pluginName: string) => {
    const next = plugins.map((p) =>
      p.manifest.name === pluginName ? { ...p, enabled: !p.enabled } : p,
    )
    setPlugins(next)
    await persistState(next)
  }

  // ── 类别切换 ────────────────────────────────────────
  const setCategory = async (pluginName: string, cat: string) => {
    const next = plugins.map((p) =>
      p.manifest.name === pluginName ? { ...p, category: cat } : p,
    )
    setPlugins(next)
    await persistState(next)
  }

  // ── 状態永続化 ──────────────────────────────────────
  const persistState = async (list: PluginInfo[]) => {
    try {
      const plugins: Record<string, PluginState> = {}
      for (const p of list) {
        plugins[p.dirName] = { enabled: p.enabled, category: p.category }
      }
      await window.huangquan.plugins.setState(plugins)
    } catch (e) { /* best effort */ console.debug('[swallow]', e) }
  }

  // ── 插件设置(manifest.settings 声明 schema, 自动渲染设置卡片) ─────────────────
  const pluginSettings = useSettingsStore(s => (s.general.pluginSettings) || {})
  const setPluginSetting = (plugin: string, key: string, value: string | number | boolean) => {
    const cur = pluginSettings[plugin] || {}
    useSettingsStore.getState().updateGeneral({ pluginSettings: { ...pluginSettings, [plugin]: { ...cur, [key]: value } } })
  }
  const settingValue = (plugin: string, def: { key: string; type: string; default?: string | number | boolean; options?: string[] }): string | number | boolean => {
    const v = pluginSettings[plugin]?.[def.key]
    if (v !== undefined) return v
    if (def.default !== undefined) return def.default
    return def.type === 'number' ? 0 : def.type === 'boolean' ? false : def.type === 'select' && def.options?.length ? def.options[0] : ''
  }
  const pluginsWithSettings = plugins.filter(p => Array.isArray(p.manifest.settings) && p.manifest.settings.length > 0)

  // ── 本地安装 ────────────────────────────────────────
  const installLocal = async () => {
    if (!localPath.trim()) return
    setInstalling(true)
    setInstallMsg('')
    try {
      const sysInfo = await window.huangquan.computer.systemInfo()
      const paths = await window.huangquan.getPaths()
      const pluginsDir = paths.pluginsDir

        // 检查插件目录内容
      let entries: { name: string; isDirectory: boolean }[]
      try {
        entries = await window.huangquan.computer.readDir(localPath)
      } catch {
    setInstallMsg('[X] 指定的路径不存在')
        setInstalling(false)
        return
      }

        // 本地路径直接是插件目录的情况
      let srcDir = localPath
      // 检查是否存在 manifest.json
      const hasManifest = entries.some((e) => e.name === 'manifest.json')
      if (!hasManifest) {
        // 查找子目录
        for (const e of entries) {
          if (!e.isDirectory) continue
          try {
            const subEntries = await window.huangquan.computer.readDir(
              `${localPath}/${e.name}`,
            )
            if (subEntries.some((s) => s.name === 'manifest.json')) {
              srcDir = `${localPath}/${e.name}`
              break
            }
          } catch { /* 子目录读取失败跳过该候选 */ }
        }
      }

        // 读取 manifest 获取插件名
      let pluginName = ''
      try {
        const raw = await window.huangquan.computer.readFile(
          `${srcDir}/manifest.json`,
        )
        pluginName = JSON.parse(raw).name || ''
      } catch {
        pluginName = srcDir.split('/').pop() || srcDir.split('\\').pop() || ''
      }

      const destDir = `${pluginsDir}/${pluginName}`
      const platform = sysInfo.platform
      const isWindows = platform === 'win32'

      // 复制目录
      if (isWindows) {
        await window.huangquan.computer.exec(
          `xcopy "${srcDir}" "${destDir}" /E /I /Y`,
        )
      } else {
        await window.huangquan.computer.exec(
          `cp -r "${srcDir}" "${destDir}"`,
        )
      }

    setInstallMsg('[OK] 安装成功')
      setLocalPath('')
      await scanPlugins()
    } catch (e: unknown) {
    setInstallMsg(`[X] ${errMsg(e) || '安装失败'}`)
    } finally {
      setInstalling(false)
    }
  }

  // ── 从仓库安装 ──────────────────────────────────────
  const installGit = async () => {
    if (!gitUrl.trim()) return
    setInstalling(true)
    setInstallMsg('')
    try {
      const paths = await window.huangquan.getPaths()
      const pluginsDir = paths.pluginsDir

      // 从 URL 推测插件名
      const urlParts = gitUrl.replace(/\.git$/, '').split('/')
      const repoName = urlParts[urlParts.length - 1] || 'plugin'

      const destDir = `${pluginsDir}/${repoName}`
      const result = await window.huangquan.computer.exec(
        `git clone "${gitUrl}" "${destDir}"`,
      )

      if (result.toLowerCase().includes('fatal') || result.toLowerCase().includes('error')) {
    setInstallMsg(`[X] ${result.slice(0, 200)}`)
      } else {
    setInstallMsg('[OK] 克隆成功')
        setGitUrl('')
        await scanPlugins()
      }
    } catch (e: unknown) {
    setInstallMsg(`[X] ${errMsg(e) || '克隆失败'}`)
    } finally {
      setInstalling(false)
    }
  }

  // ── 选择本地路径 ────────────────────────────────────
  const browseLocal = async () => {
    const dir = await window.huangquan.computer.selectDir()
    if (dir) setLocalPath(dir)
  }

  // ── 集計 ──────────────────────────────────────────
  const total = plugins.length
  const enabled = plugins.filter((p) => p.enabled).length
  const disabled = total - enabled

  return (
    <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto', height: '100%' }}>
      {/* 顶部 */}
      <div style={s.header}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 600, color: 'var(--accent)', margin: '0 0 12px' }}><MaskMark size={26} />插件库</h2>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-muted)', marginTop: 2 }}>
            插件接入 · 扩展能力
          </span>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', marginTop: 2 }}>安装第三方能力（插件）扩展助手的本领</div>
        </div>
        <button className="btn-primary" onClick={() => setShowInstall(!showInstall)}>
          {showInstall ? '收起' : '+ 安装'}
        </button>
      </div>

      {/* 统计栏 */}
      <div style={s.statsBar}>
        <span style={s.statChip}>
          总数 <strong style={{ color: YELLOW_RIVER }}>{total}</strong>
        </span>
        <span style={s.statChip}>
          启用 <strong style={{ color: 'var(--success)' }}>{enabled}</strong>
        </span>
        <span style={s.statChip}>
          停用 <strong style={U.danger}>{disabled}</strong>
        </span>
      </div>

      {showInstall && (
        <PluginInstallPanel
          installType={installType}
          localPath={localPath}
          gitUrl={gitUrl}
          installMsg={installMsg}
          installing={installing}
          onType={(t) => { setInstallType(t); setInstallMsg('') }}
          onLocalPath={setLocalPath}
          onGitUrl={setGitUrl}
          onInstallLocal={installLocal}
          onInstallGit={installGit}
          onBrowseLocal={browseLocal}
        />
      )}

      {scanError && <PluginScanBar error={scanError} onRetry={scanPlugins} />}

      {loading && (
        <p className="empty-tip" style={{ padding: 40 }}>
          正在加载…
        </p>
      )}

      {!loading && plugins.length === 0 && !scanError && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
          <div style={s.emptyIcon}><EmptyMark size={40} /></div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--ui-font-size)', marginBottom: 6 }}>
            还没有安装任何插件
          </p>
          <p className="empty-hint">
            点击「+ 安装」即可安装插件
          </p>
        </div>
      )}

      {!loading && (
        <PluginList
          plugins={plugins}
          expanded={expanded}
          onToggle={togglePlugin}
          onExpand={setExpanded}
          onSetCategory={setCategory}
        />
      )}

      {!loading && pluginsWithSettings.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>插件设置</div>
          {pluginsWithSettings.map(p => (
            <div key={p.dirName} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', marginBottom: 12 }}>
              <div style={{ fontSize: 'var(--ui-font-size)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{p.manifest.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 'calc(var(--ui-font-size) - 2px)' }}>v{p.manifest.version}</span></div>
              {(p.manifest.settings || []).map(def => {
                const v = settingValue(p.dirName, def)
                return (
                  <div key={def.key} style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)', marginBottom: 4 }}>{def.label}</div>
                    {def.type === 'boolean' ? (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'calc(var(--ui-font-size) - 2px)' }}>
                        <input type="checkbox" checked={v === true} onChange={e => setPluginSetting(p.dirName, def.key, e.target.checked)} />
                        {v === true ? '开启' : '关闭'}
                      </label>
                    ) : def.type === 'select' ? (
                      <select style={{ height: 32, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '0 8px', fontSize: 'calc(var(--ui-font-size) - 2px)', outline: 'none' }} value={String(v)} onChange={e => setPluginSetting(p.dirName, def.key, e.target.value)}>
                        {(def.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type={def.type === 'number' ? 'number' : 'text'} value={def.type === 'number' ? Number(v) : String(v)} onChange={e => setPluginSetting(p.dirName, def.key, def.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)} style={{ height: 32, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '0 8px', fontSize: 'calc(var(--ui-font-size) - 2px)', outline: 'none', width: '100%', maxWidth: 320, boxSizing: 'border-box' }} />
                    )}
                    {def.hint && <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-muted)', marginTop: 4 }}>{def.hint}</div>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
