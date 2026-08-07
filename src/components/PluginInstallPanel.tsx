// PluginInstallPanel.tsx —— 插件安装面板（从 PluginsView 拆出，行为不变）
import React from 'react'
import { s } from './plugin-styles'
import { FolderMark, LinkMark } from './themed-icons'
import { U } from './ui-styles'


export const PluginInstallPanel: React.FC<{
  installType: 'local' | 'git'
  localPath: string
  gitUrl: string
  installMsg: string
  installing: boolean
  onType: (t: 'local' | 'git') => void
  onLocalPath: (v: string) => void
  onGitUrl: (v: string) => void
  onInstallLocal: () => void
  onInstallGit: () => void
  onBrowseLocal: () => void
}> = ({ installType, localPath, gitUrl, installMsg, installing, onType, onLocalPath, onGitUrl, onInstallLocal, onInstallGit, onBrowseLocal }) => (
  <div style={s.installForm}>
    <div style={s.installTabs}>
      <button
        style={s.installTab(installType === 'local')}
        onClick={() => onType('local')}
      >
        <span style={U.inlineFlex5}><FolderMark size={13} />本地目录</span>
      </button>
      <button
        style={s.installTab(installType === 'git')}
        onClick={() => onType('git')}
      >
        <span style={U.inlineFlex5}><LinkMark size={13} />仓库地址</span>
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
              onChange={(e) => onLocalPath(e.target.value)}
            />
            <button className="btn-small" onClick={onBrowseLocal}>
              选择
            </button>
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={onInstallLocal}
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
            onChange={(e) => onGitUrl(e.target.value)}
          />
        </div>
        <button
          className="btn-primary"
          onClick={onInstallGit}
          disabled={installing || !gitUrl.trim()}
        >
          {installing ? '克隆中…' : '克隆'}
        </button>
      </div>
    )}

    {installMsg && (
      <p style={installMsg.startsWith('✅') ? s.msgSuccess : s.msgError}>
        {installMsg}
      </p>
    )}
  </div>
)
