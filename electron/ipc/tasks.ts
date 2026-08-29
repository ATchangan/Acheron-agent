// electron/ipc/tasks.ts — 持久化任务队列(v0.3.3 任务生命周期加固)
// 任务开始/心跳/结束都落盘到 tasks.json(原子写), 应用重启后可列出中断任务供恢复。
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { writeFileAtomic } from '../fs-atomic'

// v0.4.2: 系统通知 —— 懒加载避免非 Electron 测试环境炸裂
type NotificationCtor = { new(opts: { title: string; body: string }): { show(): void; on(event: string, cb: () => void): void } }
let NotificationCtor: NotificationCtor | null = null
try {
  const electronMod = require('electron') as { Notification?: NotificationCtor }
  if (electronMod.Notification) NotificationCtor = electronMod.Notification
} catch { /* 非 electron */ }
let getNotifyEnabled: () => boolean = () => false
let onActivate: (() => void) | null = null
let getSender: (() => Electron.WebContents | null) | null = null
let lastNotify: InstanceType<NotificationCtor> | null = null

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
const STALE_TASK_MS = 24 * 60 * 60 * 1000 // v0.3.7: 超过 24h 未收尾的 running 视为僵尸任务
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
  // v0.3.7: 路径变化时强制重读(避免模块级 cache 跨路径失效)
  if (tasksPath && tasksPath !== path) cache = null
  tasksPath = path
  loadAll()
  // v0.3.7: 启动治理 —— 崩溃/强杀残留的超时任务自动标记中止(保留 checkpoint 供人工恢复)
  sweepStaleTasks()
}

export function sweepStaleTasks(now = Date.now()): number {
  cache = null // 治理必须读最新磁盘状态
  const list = loadAll()
  let swept = 0
  for (const t of list) {
    if (t.status === 'running' && now - (t.startedAt || 0) > STALE_TASK_MS) {
      t.status = 'aborted'
      t.error = t.error || '任务中断超时自动清理'
      t.updatedAt = now
      swept++
    }
  }
  if (swept) saveAll(list)
  return swept
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
  // v0.4.2: 任务完成/失败桌面通知（受 设置→引擎→桌面通知 开关控制）
  if (NotificationCtor && getNotifyEnabled() && status !== 'running') {
    try {
      const rec = list[i]
      const done = status === 'done'
      const n = new NotificationCtor({
        title: done ? '任务完成' : status === 'failed' ? '任务失败' : '任务已中止',
        body: String(rec.content || '（无描述任务）').slice(0, 120),
      })
      // v0.4.5: 点击通知 → 聚焦窗口并跳转到任务所属会话
      n.on('click', () => {
        try { onActivate?.() } catch { /* 忽略 */ }
        try { getSender?.()?.send('task:activate', { sid: rec.sid }) } catch { /* 忽略 */ }
      })
      n.on('close', () => { if (lastNotify === n) lastNotify = null })
      lastNotify = n
      lastNotify = n
      n.show()
    } catch { /* 忽略 */ }
  }
  return true
}
export function clearTask(id?: string): boolean {
  const list = loadAll()
  if (id) saveAll(list.filter(t => t.id !== id))
  else saveAll(list.filter(t => t.status === 'running'))
  return true
}

export function registerTaskIpc(deps: { tasksPath: string; getNotifyEnabled?: () => boolean; onActivate?: () => void; getSender?: () => Electron.WebContents | null }): void {
  initTaskStore(deps.tasksPath)
  if (deps.getNotifyEnabled) getNotifyEnabled = deps.getNotifyEnabled
  if (deps.onActivate) onActivate = deps.onActivate
  if (deps.getSender) getSender = deps.getSender

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
