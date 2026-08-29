// WorkspaceSettings.tsx —— 设置「工作区」页：工作目录选择与打开
import { FolderOpen, FolderGit2 } from 'lucide-react'
import { useSettingsStore } from '../../store/settings'
import { C } from '../settings-ui'

export default function WorkspaceSettings() {
  const workDir = useSettingsStore(s => s.general.workDir)
  const setWorkDir = useSettingsStore(s => s.setWorkDir)
  const pick = async () => {
    const dir = await window.huangquan.computer.selectDir()
    if (dir) await setWorkDir(dir)
  }
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 26px 30px' }}>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, marginBottom: 16 }}>助手读写文件、执行命令都在工作区内进行；产物与项目扫描也基于它。</div>
      <div className="aux-row">
        <div className="aux-row-main">
          <div className="aux-row-name">工作目录</div>
          <div className="aux-row-sub" style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={workDir}>{workDir || '未设置'}</div>
        </div>
        <div className="aux-row-actions">
          <button type="button" className="hq-btn" style={{ height: 30, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => { if (workDir) void window.huangquan.computer.openFile(workDir) }}>
            <FolderOpen size={13} />打开
          </button>
          <button type="button" className="hq-btn hq-btn-accent" style={{ height: 30, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => { void pick() }}>
            <FolderGit2 size={13} />选择目录
          </button>
        </div>
      </div>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, marginTop: 14, lineHeight: 1.7 }}>
        提示：工作目录下的 git 仓库会出现在侧栏「项目」区，可一键切换。
      </div>
    </div>
  )
}
