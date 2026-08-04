import React, { useState, useEffect, useCallback } from 'react'
import { errMsg } from '../utils/safe'
import { CATEGORIES, CATEGORY_HINT, CAT_COLORS, YELLOW_RIVER } from './plugin-types'
import type { PluginManifest, PluginInfo, PluginState } from './plugin-types'
import { s } from './plugin-styles'

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

  // ── プラグイン走査 ──────────────────────────────────
  const scanPlugins = useCallback(async () => {
    setLoading(true)
    setScanError(null)
    try {
      // システム情報から workspaceDir を取得 → userData/plugins を導出
      const sysInfo = await window.huangquan.computer.systemInfo()
      const workspaceDir = sysInfo.workspaceDir
      // workspaceDir = userData/workspace なので、pluginsDir = userData/plugins
      const pluginsDir = workspaceDir.replace(/[\\/]workspace$/, '') + '/plugins'

      let entries: { name: string; isDirectory: boolean }[]
      try {
        entries = await window.huangquan.computer.readDir(pluginsDir)
      } catch {
        // プラグインディレクトリが存在しない場合
        setPlugins([])
        setLoading(false)
        return
      }

      const dirs = entries.filter((e) => e.isDirectory)

      // 保存済みのプラグイン設定を読込
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
          // manifest がない or パース失敗 → スキップ
        }
      }
      setPlugins(loaded)
    } catch (e: unknown) {
      setScanError(errMsg(e) || 'プラグイン走査エラー')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    scanPlugins()
  }, [scanPlugins])

  // ── 有効/無効 切替 ──────────────────────────────────
  const togglePlugin = async (pluginName: string) => {
    const next = plugins.map((p) =>
      p.manifest.name === pluginName ? { ...p, enabled: !p.enabled } : p,
    )
    setPlugins(next)
    await persistState(next)
  }

  // ── カテゴリ変更 ────────────────────────────────────
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

  // ── ローカルからインストール ──────────────────────
  const installLocal = async () => {
    if (!localPath.trim()) return
    setInstalling(true)
    setInstallMsg('')
    try {
      const sysInfo = await window.huangquan.computer.systemInfo()
      const workspaceDir = sysInfo.workspaceDir
      const pluginsDir = workspaceDir.replace(/[\\/]workspace$/, '') + '/plugins'

      // プラグインディレクトリの内容を確認
      let entries: { name: string; isDirectory: boolean }[]
      try {
        entries = await window.huangquan.computer.readDir(localPath)
      } catch {
        setInstallMsg('❌ 指定されたパスが存在しません')
        setInstalling(false)
        return
      }

      // ローカルパスが直接プラグインディレクトリの場合
      let srcDir = localPath
      // manifest.json があるかチェック
      const hasManifest = entries.some((e) => e.name === 'manifest.json')
      if (!hasManifest) {
        // サブディレクトリを探す
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

      // manifest を読んでプラグイン名を取得
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

      // ディレクトリをコピー
      if (isWindows) {
        await window.huangquan.computer.exec(
          `xcopy "${srcDir}" "${destDir}" /E /I /Y`,
        )
      } else {
        await window.huangquan.computer.exec(
          `cp -r "${srcDir}" "${destDir}"`,
        )
      }

      setInstallMsg('✅ インストール成功')
      setLocalPath('')
      await scanPlugins()
    } catch (e: unknown) {
      setInstallMsg(`❌ ${errMsg(e) || 'インストール失敗'}`)
    } finally {
      setInstalling(false)
    }
  }

  // ── Git からインストール ───────────────────────────
  const installGit = async () => {
    if (!gitUrl.trim()) return
    setInstalling(true)
    setInstallMsg('')
    try {
      const sysInfo = await window.huangquan.computer.systemInfo()
      const workspaceDir = sysInfo.workspaceDir
      const pluginsDir = workspaceDir.replace(/[\\/]workspace$/, '') + '/plugins'

      // URL からプラグイン名を推測
      const urlParts = gitUrl.replace(/\.git$/, '').split('/')
      const repoName = urlParts[urlParts.length - 1] || 'plugin'

      const destDir = `${pluginsDir}/${repoName}`
      const result = await window.huangquan.computer.exec(
        `git clone "${gitUrl}" "${destDir}"`,
      )

      if (result.toLowerCase().includes('fatal') || result.toLowerCase().includes('error')) {
        setInstallMsg(`❌ ${result.slice(0, 200)}`)
      } else {
        setInstallMsg('✅ クローン成功')
        setGitUrl('')
        await scanPlugins()
      }
    } catch (e: unknown) {
      setInstallMsg(`❌ ${errMsg(e) || 'クローン失敗'}`)
    } finally {
      setInstalling(false)
    }
  }

  // ── ローカルパス選択 ──────────────────────────────
  const browseLocal = async () => {
    const dir = await window.huangquan.computer.selectDir()
    if (dir) setLocalPath(dir)
  }

  // ── 集計 ──────────────────────────────────────────
  const total = plugins.length
  const enabled = plugins.filter((p) => p.enabled).length
  const disabled = total - enabled

  // ── 主要レンダリング ──────────────────────────────
  return (
    <div className="settings-view">
      {/* ヘッダ */}
      <div style={s.header}>
        <div>
          <h2>🎭 黄泉式神録</h2>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-muted)', marginTop: 2 }}>
            插件拡張 · 契約式神
          </span>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowInstall(!showInstall)}
        >
          {showInstall ? '閉じる' : '+ 契約'}
        </button>
      </div>

      {/* 統計バー */}
      <div style={s.statsBar}>
        <span style={s.statChip}>
          総数 <strong style={{ color: YELLOW_RIVER }}>{total}</strong>
        </span>
        <span style={s.statChip}>
          启用 <strong style={{ color: 'var(--success)' }}>{enabled}</strong>
        </span>
        <span style={s.statChip}>
          停用 <strong style={{ color: 'var(--danger)' }}>{disabled}</strong>
        </span>
      </div>

      {/* インストールフォーム */}
      {showInstall && (
        <div style={s.installForm}>
          <div style={s.installTabs}>
            <button
              style={s.installTab(installType === 'local')}
              onClick={() => { setInstallType('local'); setInstallMsg('') }}
            >
              📁 ローカル
            </button>
            <button
              style={s.installTab(installType === 'git')}
              onClick={() => { setInstallType('git'); setInstallMsg('') }}
            >
              🔗 Git URL
            </button>
          </div>

          {installType === 'local' && (
            <div className="provider-form">
              <div className="form-row">
                <label>プラグインディレクトリ</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="dropdown-input"
                    style={{ flex: 1, marginBottom: 0 }}
                    placeholder="プラグインのフォルダパス..."
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                  />
                  <button className="btn-small" onClick={browseLocal}>
                    選択
                  </button>
                </div>
              </div>
              <button
                className="btn-primary"
                onClick={installLocal}
                disabled={installing || !localPath.trim()}
              >
                {installing ? 'インストール中…' : 'インストール'}
              </button>
            </div>
          )}

          {installType === 'git' && (
            <div className="provider-form">
              <div className="form-row">
                <label>Git リポジトリ URL</label>
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
                {installing ? 'クローン中…' : 'クローン'}
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

      {/* エラー表示 */}
      {scanError && (
        <div className="provider-form">
          <p style={s.msgError}>⚠️ {scanError}</p>
          <button className="btn-small" onClick={scanPlugins} style={{ marginTop: 8 }}>
            再試行
          </button>
        </div>
      )}

      {/* ローディング */}
      {loading && (
        <p className="empty-tip" style={{ padding: 40 }}>
          式神を召喚中...
        </p>
      )}

      {/* 空状態 */}
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
            まだ契約式神がいません
          </p>
          <p className="empty-hint">
            「+ 契約」ボタンからプラグインをインストールしてください
          </p>
        </div>
      )}

      {/* プラグイン一覧 */}
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
              {/* カードヘッダ */}
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
                      {p.manifest.description || '説明なし'}
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
                    title={p.enabled ? '有効' : '無効'}
                  />
                  <span style={s.expandHint}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {/* 展開詳細 */}
              {isExpanded && (
                <div style={s.expandBody}>
                  {/* メタデータ */}
                  <div>
                    <div style={s.sectionTitle}>📋 メタデータ</div>
                    <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {p.manifest.author && (
                        <span>作者: {p.manifest.author}</span>
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
                        <span>ライセンス: {p.manifest.license}</span>
                      )}
                      <span>ディレクトリ: {p.dirName}</span>
                    </div>
                  </div>

                  {/* 権限 */}
                  {p.manifest.permissions && p.manifest.permissions.length > 0 && (
                    <div>
                      <div style={s.sectionTitle}>🔐 権限</div>
                      <div>
                        {p.manifest.permissions.map((perm) => (
                          <span key={perm} style={s.permChip}>
                            {perm}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ツール一覧 */}
                  {p.manifest.tools && p.manifest.tools.length > 0 && (
                    <div>
                      <div style={s.sectionTitle}>🔧 提供ツール</div>
                      {p.manifest.tools.map((t, i) => (
                        <div key={i} style={s.toolRow}>
                          <span style={s.toolName}>{t.name}</span>
                          <span style={{ color: 'var(--text-muted)' }}>
                            — {t.description || '説明なし'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* コマンド一覧 */}
                  {p.manifest.commands && p.manifest.commands.length > 0 && (
                    <div>
                      <div style={s.sectionTitle}>⚡ コマンド</div>
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

                  {/* カテゴリ変更 */}
                  <div>
                    <div style={s.sectionTitle}>🏷️ カテゴリ</div>
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
