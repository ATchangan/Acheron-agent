import React, { useState, useEffect, useCallback } from 'react'
import { errMsg } from '../utils/safe'
import { CATEGORIES, CATEGORY_HINT, CAT_COLORS, YELLOW_RIVER } from './plugin-types'
import type { PluginManifest, PluginInfo, PluginState } from './plugin-types'
import { s } from './plugin-styles'
import { MaskMark, EmptyMark } from './themed-icons'
import { PluginInstallPanel } from './PluginInstallPanel'
import { PluginScanBar } from './PluginScanBar'
import { PluginList } from './PluginList'

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
      // 从系统信息获取工作区目录 → 推导插件目录
      const sysInfo = await window.huangquan.computer.systemInfo()
      const workspaceDir = sysInfo.workspaceDir
      // 工作区目录 = userData/workspace，插件目录 = userData/plugins
      const pluginsDir = workspaceDir.replace(/[\\/]workspace$/, '') + '/plugins'

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

      // 读取已保存的插件设置
      const memory = await window.huangquan.memory.load()
      const savedState: Record<string, PluginState> =
        (memory.plugins || {}) as Record<string, PluginState>

      const loaded: PluginInfo[] = []
      for (const dir of dirs) {
        const manifestPath = `${pluginsDir}/${dir.name}/manifest.json`
        try {
          const raw = await window.huangquan.computer.readFile(manifestPath)
          const manifest: PluginManifest = JSON.parse(raw)
          loaded.push({
            manifest,
            dirName: dir.name,
            enabled: savedState[manifest.name]?.enabled ?? true,
            category:
              savedState[manifest.name]?.category ||
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
      const memory = await window.huangquan.memory.load()
      const plugins: Record<string, PluginState> = {}
      for (const p of list) {
        plugins[p.manifest.name] = { enabled: p.enabled, category: p.category }
      }
      memory.plugins = plugins as Record<string, PluginState>
      await window.huangquan.memory.save(memory)
    } catch (e) { /* best effort */ console.debug('[swallow]', e) }
  }

  // ── 本地安装 ────────────────────────────────────────
  const installLocal = async () => {
    if (!localPath.trim()) return
    setInstalling(true)
    setInstallMsg('')
    try {
      const sysInfo = await window.huangquan.computer.systemInfo()
      const workspaceDir = sysInfo.workspaceDir
      const pluginsDir = workspaceDir.replace(/[\\/]workspace$/, '') + '/plugins'

        // 检查插件目录内容
      let entries: { name: string; isDirectory: boolean }[]
      try {
        entries = await window.huangquan.computer.readDir(localPath)
      } catch {
        setInstallMsg('❌ 指定的路径不存在')
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

      setInstallMsg('✅ 安装成功')
      setLocalPath('')
      await scanPlugins()
    } catch (e: unknown) {
      setInstallMsg(`❌ ${errMsg(e) || '安装失败'}`)
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
      const sysInfo = await window.huangquan.computer.systemInfo()
      const workspaceDir = sysInfo.workspaceDir
      const pluginsDir = workspaceDir.replace(/[\\/]workspace$/, '') + '/plugins'

      // 从 URL 推测插件名
      const urlParts = gitUrl.replace(/\.git$/, '').split('/')
      const repoName = urlParts[urlParts.length - 1] || 'plugin'

      const destDir = `${pluginsDir}/${repoName}`
      const result = await window.huangquan.computer.exec(
        `git clone "${gitUrl}" "${destDir}"`,
      )

      if (result.toLowerCase().includes('fatal') || result.toLowerCase().includes('error')) {
        setInstallMsg(`❌ ${result.slice(0, 200)}`)
      } else {
        setInstallMsg('✅ 克隆成功')
        setGitUrl('')
        await scanPlugins()
      }
    } catch (e: unknown) {
      setInstallMsg(`❌ ${errMsg(e) || '克隆失败'}`)
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
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 600, color: 'var(--accent)', margin: '0 0 12px' }}><MaskMark size={26} />黄泉式神录</h2>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-muted)', marginTop: 2 }}>
            契约式神 · 插件接入
          </span>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', marginTop: 2 }}>安装第三方能力（插件）扩展黄泉的本领</div>
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
          停用 <strong style={{ color: 'var(--danger)' }}>{disabled}</strong>
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
    </div>
  )
}
