import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { ipcMain } from 'electron'
import { registerRollbackIpc } from './rollback'

const handlers: Record<string, (e: unknown, ...args: unknown[]) => unknown> = {}

function setup(): void {
  handlers['rollback:apply'] = () => 'unset'
  vi.mocked(ipcMain.handle).mockImplementation(((channel: string, listener: (e: unknown, ...args: unknown[]) => unknown) => {
    handlers[channel] = listener
  }) as never)
}

describe('rollback:apply 任务文件回滚', () => {
  beforeEach(() => { setup() })

  it('恢复已修改文件、删除新增文件、跳过超限文件', async () => {
    const userData = fs.mkdtempSync(join(os.tmpdir(), 'hq-rollback-'))
    const work = join(userData, 'work')
    fs.mkdirSync(work, { recursive: true })
    const existing = join(work, 'a.txt')
    fs.writeFileSync(existing, 'v2', 'utf-8')
    const added = join(work, 'b.txt')
    fs.writeFileSync(added, 'new', 'utf-8')
    const skip = join(work, 'c.bin')
    fs.writeFileSync(skip, 'x', 'utf-8')
    try {
      registerRollbackIpc({ userDataPath: userData })
      const snap = { taskId: 't1', sid: 's1', content: 'x', at: Date.now(), files: { [existing]: 'v1', [added]: null, [skip]: '__SKIP__' } }
      fs.writeFileSync(join(userData, 'rollback', 't1.json'), JSON.stringify(snap), 'utf-8')
      const r = await handlers['rollback:apply']({}, 't1')
      expect(r).toEqual({ ok: true, restored: 2 })
      expect(fs.readFileSync(existing, 'utf-8')).toBe('v1')
      expect(fs.existsSync(added)).toBe(false)
      expect(fs.existsSync(skip)).toBe(true)
      expect(fs.existsSync(join(userData, 'rollback', 't1.json'))).toBe(false)
    } finally {
      fs.rmSync(userData, { recursive: true, force: true })
    }
  })

  it('非法/不存在的任务 id 安全返回错误', async () => {
    const userData = fs.mkdtempSync(join(os.tmpdir(), 'hq-rollback-'))
    try {
      registerRollbackIpc({ userDataPath: userData })
      const r1 = await handlers['rollback:apply']({}, '../evil') as { ok?: boolean }
      expect(r1.ok).toBe(false)
      const r2 = await handlers['rollback:apply']({}, 'nope') as { ok?: boolean }
      expect(r2.ok).toBe(false)
    } finally {
      fs.rmSync(userData, { recursive: true, force: true })
    }
  })
})
