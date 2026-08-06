// electron/ipc/tasks.ts — 持久化任务队列(v0.3.3 任务生命周期加固)
// 任务开始/心跳/结束都落盘到 tasks.json(原子写), 应用重启后可列出中断任务供恢复。
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { writeFileAtomic } from '../fs-atomic'

export interface TaskRecord {
  id: string
  sid: string
  content: string
  images?: string[]
  attachments?: unknown[]
  model?: string
  status: 'running' | 'done' | 'failed' | 'aborted'
  startedAt: number
  updatedAt: number
  error?: string
  checkpoint?: unknown // 独立内核断点: { messages, agent, activeAgents, model, round }
}

const MAX_KEEP = 30
let tasksPath = ''
let cache: TaskRecord[] | null = null

function loadAll(): TaskRecord[] {
  if (cache) return cache
  try {
    if (fs.existsSync(tasksPath)) {
      const d = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'))
      cache = Array.isArray(d) ? d : []
    } else cache = []
  } catch { cache = [] }
  return cache
}
function saveAll(list: TaskRecord[]): void {
  cache = list
  try { writeFileAtomic(tasksPath, JSON.stringify(list, null, 2)) } catch (e) { console.error('[TASKS] save error:', e instanceof Error ? e.message : String(e)) }
}
function upsertAll(rec: TaskRecord): void {
  const list = loadAll()
  const i = list.findIndex(t => t.id === rec.id)
  if (i >= 0) list[i] = { ...list[i], ...rec }
  else list.unshift(rec)
  const running = list.filter(t => t.status === 'running')
  const rest = list.filter(t => t.status !== 'running').slice(0, MAX_KEEP)
  saveAll([...running, ...rest])
}

// ─── 供 AgentEngine 直接使用的存储 API(不依赖 IPC) ───
export function initTaskStore(path: string): void {
  tasksPath = path
  loadAll()
}
export function listTasks(): TaskRecord[] { return loadAll() }
export function getTask(id: string): TaskRecord | null { return loadAll().find(t => t.id === id) || null }
export function startTask(t: Partial<TaskRecord> & { id: string; sid: string; content: string }): void {
  const now = Date.now()
  upsertAll({ ...t, status: 'running', startedAt: now, updatedAt: now } as TaskRecord)
}
export function updateTask(id: string, patch: Partial<TaskRecord>): boolean {
  const list = loadAll()
  const i = list.findIndex(t => t.id === id)
  if (i < 0) return false
  upsertAll({ ...list[i], ...patch, updatedAt: Date.now() })
  return true
}
export function finishTask(id: string, status: TaskRecord['status'], error?: string): boolean {
  const list = loadAll()
  const i = list.findIndex(t => t.id === id)
  if (i < 0) return false
  upsertAll({ ...list[i], status, error: error || list[i].error, updatedAt: Date.now() })
  return true
}
export function clearTask(id?: string): boolean {
  const list = loadAll()
  if (id) saveAll(list.filter(t => t.id !== id))
  else saveAll(list.filter(t => t.status === 'running'))
  return true
}

export function registerTaskIpc(deps: { tasksPath: string }): void {
  initTaskStore(deps.tasksPath)

  ipcMain.handle('task:list', () => listTasks())
  ipcMain.handle('task:start', (_e, t: Partial<TaskRecord> & { id: string; sid: string; content: string }) => {
    startTask(t)
    return true
  })
  ipcMain.handle('task:update', (_e, id: string, patch: Partial<TaskRecord>) => {
    return updateTask(id, patch)
  })
  ipcMain.handle('task:finish', (_e, id: string, status: TaskRecord['status'], error?: string) => {
    return finishTask(id, status, error)
  })
  ipcMain.handle('task:clear', (_e, id?: string) => {
    return clearTask(id)
  })
  // 存储路径供设置页统计
  ipcMain.handle('task:path', () => tasksPath)
}
