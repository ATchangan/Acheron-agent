import React, { useState, useEffect, useCallback } from 'react'
import { errMsg } from '../utils/safe'
import { CATEGORIES, CATEGORY_HINT, CAT_COLORS, YELLOW_RIVER } from './plugin-types'
import type { PluginManifest, PluginInfo, PluginState } from './plugin-types'
import { s } from './plugin-styles'
import { MaskMark } from './themed-icons'

// v0.3.1 块 K: 插件视图主组件(类型/样式已拆分, 行为零变化)
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

  // ── 主渲染 ──────────────────────────────────────────
  return (
    <div className="settings-view">
      {/* 顶部 */}
      <div style={s.header}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><MaskMark size={26} />黄泉式神录</h2>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-muted)', marginTop: 2 }}>
            契约式神 · 插件接入
          </span>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowInstall(!showInstall)}
        >
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

      {/* 安装表单 */}
      {showInstall && (
        <div style={s.installForm}>
          <div style={s.installTabs}>
            <button
              style={s.installTab(installType === 'local')}
              onClick={() => { setInstallType('local'); setInstallMsg('') }}
            >
              📁 本地目录
            </button>
            <button
              style={s.installTab(installType === 'git')}
              onClick={() => { setInstallType('git'); setInstallMsg('') }}
            >
              🔗 仓库地址
            </button>
          </div>

          {installType === 'local' && (
            <div className="provider-form">
              <div className="form-row">
                <label>插件目录</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="dropdown-input"
                    style={{ flex: 1, marginBottom: 0 }}
                    placeholder="插件文件夹路径…"
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                  />
                  <button className="btn-small" onClick={browseLocal}>
                    选择
                  </button>
                </div>
              </div>
              <button
                className="btn-primary"
                onClick={installLocal}
                disabled={installing || !localPath.trim()}
              >
                {installing ? '安装中…' : '安装'}
              </button>
            </div>
          )}

          {installType === 'git' && (
            <div className="provider-form">
              <div className="form-row">
                <label>仓库地址</label>
                <input
                  className="dropdown-input"
                  placeholder="https://github.com/user/plugin.git"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                />
              </div>
              <button
                className="btn-primary"
                onClick={installGit}
                disabled={installing || !gitUrl.trim()}
              >
                {installing ? '克隆中…' : '克隆'}
              </button>
            </div>
          )}

          {installMsg && (
            <p
              style={
                installMsg.startsWith('✅') ? s.msgSuccess : s.msgError
              }
            >
              {installMsg}
            </p>
          )}
        </div>
      )}

      {/* 错误提示 */}
      {scanError && (
        <div className="provider-form">
          <p style={s.msgError}>⚠️ {scanError}</p>
          <button className="btn-small" onClick={scanPlugins} style={{ marginTop: 8 }}>
            重试
          </button>
        </div>
      )}

      {/* 加载中 */}
      {loading && (
        <p className="empty-tip" style={{ padding: 40 }}>
          正在加载…
        </p>
      )}

      {/* 空状态 */}
      {!loading && plugins.length === 0 && !scanError && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 20px',
          }}
        >
          <div style={s.emptyIcon}>📭</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--ui-font-size)', marginBottom: 6 }}>
          还没有安装任何插件
          </p>
          <p className="empty-hint">
            点击「+ 安装」即可安装插件
          </p>
        </div>
      )}

      {/* 插件列表 */}
      {!loading &&
        plugins.map((p) => {
          const cat = CATEGORIES[p.category] || CATEGORIES['oni']
          const isExpanded = expanded === p.manifest.name
          const catColor = CAT_COLORS[p.category] || CAT_COLORS['oni']

          return (
            <div
              key={p.manifest.name}
              style={s.card}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLDivElement).style.borderColor =
                  YELLOW_RIVER
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLDivElement).style.borderColor =
                  'var(--border)'
              }}
            >
      {/* 卡片头部 */}
              <div
                style={s.cardHeader}
                onClick={() =>
                  setExpanded(isExpanded ? null : p.manifest.name)
                }
              >
                <div style={s.cardLeft}>
                  <div style={s.pluginIcon}>{cat.emoji}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={s.pluginName}>{p.manifest.name}</div>
                    <div style={s.pluginMeta}>
                      <span>v{p.manifest.version || '0.0.0'}</span>
                      <span style={s.categoryBadge}>
                        {cat.label}({CATEGORY_HINT[p.category]})
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 'calc(var(--ui-font-size) - 2px)',
                        color: 'var(--text-muted)',
                        marginTop: 3,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.manifest.description || '暂无说明'}
                    </div>
                  </div>
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
                >
                  <span
                    className={`toggle ${p.enabled ? 'on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePlugin(p.manifest.name)
                    }}
                    title={p.enabled ? '禁用' : '启用'}
                  />
                  <span style={s.expandHint}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </div>
              </div>

      {/* 展开详情 */}
              {isExpanded && (
                <div style={s.expandBody}>
              {/* 基本信息 */}
                  <div>
                    <div style={s.sectionTitle}>📋 基本信息</div>
                    <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {p.manifest.author && (
                        <span>作者：{p.manifest.author}</span>
                      )}
                      {p.manifest.homepage && (
                        <span>
                          {' '}
                          <a
                            href={p.manifest.homepage}
                            style={{ color: 'var(--accent)' }}
                            onClick={(e) => e.stopPropagation()}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {p.manifest.homepage}
                          </a>
                        </span>
                      )}
                      {p.manifest.license && (
                        <span>许可协议：{p.manifest.license}</span>
                      )}
                      <span>目录：{p.dirName}</span>
                    </div>
                  </div>

                  {/* 权限 */}
                  {p.manifest.permissions && p.manifest.permissions.length > 0 && (
                    <div>
                      <div style={s.sectionTitle}>🔐 权限</div>
                      <div>
                        {p.manifest.permissions.map((perm) => (
                          <span key={perm} style={s.permChip}>
                            {perm}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 工具列表 */}
                  {p.manifest.tools && p.manifest.tools.length > 0 && (
                    <div>
                      <div style={s.sectionTitle}>🔧 提供工具</div>
                      {p.manifest.tools.map((t, i) => (
                        <div key={i} style={s.toolRow}>
                          <span style={s.toolName}>{t.name}</span>
                          <span style={{ color: 'var(--text-muted)' }}>
                            — {t.description || '暂无说明'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 命令列表 */}
                  {p.manifest.commands && p.manifest.commands.length > 0 && (
                    <div>
                      <div style={s.sectionTitle}>⚡ 命令</div>
                      {p.manifest.commands.map((c, i) => (
                        <div key={i} style={s.toolRow}>
                          <span style={s.toolName}>{c.name}</span>
                          <span style={{ color: 'var(--text-muted)', fontFamily: "'JetBrains Mono',monospace", fontSize: 'calc(var(--ui-font-size) - 3px)' }}>
                            {c.action}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 类别切换 */}
                  <div>
                    <div style={s.sectionTitle}>🏷️ 类别</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {Object.entries(CATEGORIES).map(([key, val]) => (
                        <button
                          key={key}
                          onClick={(e) => {
                            e.stopPropagation()
                            setCategory(p.manifest.name, key)
                          }}
                          style={{
                            fontSize: 'calc(var(--ui-font-size) - 2px)',
                            padding: '3px 10px',
                            borderRadius: 14,
                            border: `1px solid ${
                              p.category === key
                                ? CAT_COLORS[key]
                                : 'var(--border)'
                            }`,
                            background:
                              p.category === key
                                ? `${CAT_COLORS[key]}20`
                                : 'transparent',
                            color:
                              p.category === key
                                ? CAT_COLORS[key]
                                : 'var(--text-muted)',
                            cursor: 'pointer',
                            fontWeight: p.category === key ? 600 : 400,
                          }}
                        >
                          {val.emoji} {val.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}
