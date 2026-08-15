// electron/ipc/backup.ts — 一键备份/恢复用户数据(settings/tasks/memory/sessions/plans/skills 等)
import { ipcMain, dialog, app, type BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import * as fs from 'fs'
import { join } from 'path'
import { checkpointDb, closeDb } from '../db'

// agent.db 是 0.4.0 的记忆/审计/会话索引/工具结果主库; 旧 JSON 项保留用于兼容旧备份的恢复
const BACKUP_ITEMS = ['settings.json', 'tasks.json', 'agent.db', 'memory.json', 'memory-vector.json', 'search-index.json', 'agent-trace.jsonl', 'crash.log', 'model-cache-stats.json', 'sessions', 'plans', 'skills', 'workspace']

function psQuote(p: string): string {
  return "'" + String(p).replace(/'/g, "''") + "'"
}
function psExec(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 180000 }, e => (e ? reject(e) : resolve()))
  })
}

export function registerBackupIpc(deps: { userDataPath: string; getWorkDir: () => string; getWindow: () => BrowserWindow | null }): void {
  ipcMain.handle('backup:create', async () => {
    try {
      const win = deps.getWindow()
      const stamp = new Date().toISOString().slice(0, 10)
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '备份桌面智能助手 数据',
        defaultPath: join(deps.getWorkDir() || '', '桌面智能助手备份-' + stamp + '.zip'),
        filters: [{ name: 'ZIP 备份', extensions: ['zip'] }],
      })
      if (canceled || !filePath) return { ok: false, canceled: true }
      const staging = join(deps.userDataPath, '.backup-staging-' + Date.now())
      const dst = staging + '.zip'
      try {
        fs.mkdirSync(staging, { recursive: true })
        // 先做 WAL checkpoint, 让 agent.db 主文件包含 -wal/-shm 里的已提交数据, 避免备份丢尾部写入
        checkpointDb()
        for (const item of BACKUP_ITEMS) {
          const src = join(deps.userDataPath, item)
          if (!fs.existsSync(src)) continue
          try { fs.cpSync(src, join(staging, item), { recursive: true }) } catch { /* 单项失败跳过 */ }
        }
        await psExec('Compress-Archive -Path ' + psQuote(join(staging, '*')) + ' -DestinationPath ' + psQuote(dst) + ' -Force')
        fs.cpSync(dst, filePath)
      } finally {
        // v0.3.8: 无论成功失败都清理临时目录, 不留残留
        try { fs.rmSync(staging, { recursive: true, force: true }) } catch { /* 忽略 */ }
        try { fs.rmSync(dst, { force: true }) } catch { /* 忽略 */ }
      }
      return { ok: true, path: filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('backup:restore', async () => {
    try {
      const win = deps.getWindow()
      const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
        title: '选择备份文件恢复',
        filters: [{ name: 'ZIP 备份', extensions: ['zip'] }],
        properties: ['openFile'],
      })
      if (canceled || !filePaths.length) return { ok: false, canceled: true }
      const { response } = await dialog.showMessageBox(win!, {
        type: 'warning',
        buttons: ['取消', '恢复'],
        defaultId: 1,
        cancelId: 0,
        message: '恢复备份将覆盖当前设置、任务、会话、记忆等数据，确定继续？',
      })
      if (response !== 1) return { ok: false, canceled: true }
      // 恢复会覆盖 agent.db, 先关闭数据库句柄避免 Windows 文件锁导致覆盖失败; 恢复完成后应用会重启
      closeDb()
      const extract = join(deps.userDataPath, '.backup-restore-' + Date.now())
      fs.mkdirSync(extract, { recursive: true })
      await psExec('Expand-Archive -Path ' + psQuote(filePaths[0]) + ' -DestinationPath ' + psQuote(extract) + ' -Force')
      // 只恢复白名单项, 防恶意 zip 越权写入
      const base = fs.realpathSync(extract)
      for (const item of BACKUP_ITEMS) {
        const src = join(extract, item)
        if (!fs.existsSync(src)) continue
        try {
          if (!fs.realpathSync(src).startsWith(base)) continue
          const dst = join(deps.userDataPath, item)
          fs.rmSync(dst, { recursive: true, force: true })
          fs.cpSync(src, dst, { recursive: true })
        } catch { /* 单项恢复失败跳过 */ }
      }
      fs.rmSync(extract, { recursive: true, force: true })
      // v0.3.8: 恢复完成后自动重启, 让新数据生效
      setTimeout(() => { app.relaunch(); app.exit(0) }, 300)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
