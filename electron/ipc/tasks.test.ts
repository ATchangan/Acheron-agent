import { describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { initTaskStore, listTasks, startTask, updateTask, finishTask, clearTask, getTask, sweepStaleTasks } from './tasks'

function makeStore(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-task-'))
  return join(dir, 'tasks.json')
}

describe('tasks 持久化存储', () => {
  it('start/update/finish 生命周期落盘', () => {
    const p = makeStore()
    try {
      initTaskStore(p)
      startTask({ id: 'a', sid: 's1', content: '任务A' })
      expect(getTask('a')?.status).toBe('running')
      updateTask('a', { model: 'm1' })
      expect(getTask('a')?.model).toBe('m1')
      expect(finishTask('a', 'done')).toBe(true)
      expect(getTask('a')?.status).toBe('done')
    } finally { fs.rmSync(join(p, '..'), { recursive: true, force: true }) }
  })

  it('clearTask 清理指定任务', () => {
    const p = makeStore()
    try {
      initTaskStore(p)
      startTask({ id: 'a', sid: 's1', content: 'A' })
      startTask({ id: 'b', sid: 's1', content: 'B' })
      expect(clearTask('a')).toBe(true)
      expect(getTask('a')).toBeNull()
      expect(getTask('b')).not.toBeNull()
    } finally { fs.rmSync(join(p, '..'), { recursive: true, force: true }) }
  })

  it('sweepStaleTasks: 超时 running 自动标记 aborted', () => {
    const p = makeStore()
    try {
      initTaskStore(p)
      startTask({ id: 'stale', sid: 's1', content: '僵尸任务' })
      const stale = Date.now() - 25 * 60 * 60 * 1000
      const list = JSON.parse(fs.readFileSync(p, 'utf-8'))
      list[0].startedAt = stale
      fs.writeFileSync(p, JSON.stringify(list), 'utf-8')
      // 治理强制重读磁盘
      expect(sweepStaleTasks()).toBe(1)
      expect(listTasks()[0].status).toBe('aborted')
      expect(listTasks()[0].error).toContain('超时')
    } finally { fs.rmSync(join(p, '..'), { recursive: true, force: true }) }
  })
})
