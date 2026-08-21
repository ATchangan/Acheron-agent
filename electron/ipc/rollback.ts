// electron/ipc/rollback.ts — 任务文件改动回滚(快照由引擎在写操作前记录)
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'

const KEEP_MS = 7 * 24 * 60 * 60 * 1000

export function registerRollbackIpc(deps: { userDataPath: string }): void {
  const dir = join(deps.userDataPath, 'rollback')
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* 忽略 */ }

  ipcMain.handle('rollback:apply', (_e, taskId: string) => {
    try {
      const safeId = String(taskId || '')
      if (!/^[0-9a-zA-Z-]{1,64}$/.test(safeId)) return { ok: false, error: '非法任务 id' }
      const p = join(dir, safeId + '.json')
      if (!fs.existsSync(p)) return { ok: false, error: '无该任务的回滚快照' }
      const snap = JSON.parse(fs.readFileSync(p, 'utf-8')) as { files?: Record<string, string | null> }
      let restored = 0
      for (const [path, content] of Object.entries(snap.files || {})) {
        try {
          if (content === '__SKIP__') continue
          if (content === null) {
            if (fs.existsSync(path)) { fs.unlinkSync(path); restored++ }
          } else {
            fs.writeFileSync(path, content, 'utf-8')
            restored++
          }
        } catch { /* 单项失败跳过 */ }
      }
      try { fs.unlinkSync(p) } catch { /* 忽略 */ }
      return { ok: true, restored }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 启动清理 7 天前的快照
  try {
    if (fs.existsSync(dir)) {
      const cutoff = Date.now() - KEEP_MS
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue
        try { if (fs.statSync(join(dir, f)).mtimeMs < cutoff) fs.unlinkSync(join(dir, f)) } catch { /* 忽略 */ }
      }
    }
  } catch { /* 忽略 */ }
}
