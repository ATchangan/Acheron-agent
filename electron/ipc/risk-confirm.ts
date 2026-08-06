// electron/ipc/risk-confirm.ts —— 软件内风险确认(v0.3.3)
// 替代原生 Windows 弹窗: 主进程把确认请求推给渲染层角落卡片, 用户点「允许/拒绝」,
// 可勾选「本次任务都批准」(按 sid+taskId 记录, 新任务自动失效)。
// 60 秒无人操作自动拒绝, 任务不再无限挂起。
import { ipcMain } from 'electron'

export type RiskDecision = 'allow' | 'deny' | 'timeout'

export interface RiskConfirmPayload {
  requestId: string
  kind: string
  detail: string
  level: string
  sid?: string
  taskId?: string
  taskKey?: string
  expiresAt: number
}

export const RISK_CONFIRM_TIMEOUT_MS = 60000

let getMainWindow: () => Electron.BrowserWindow | null = () => null
const pending = new Map<string, (d: RiskDecision) => void>()
const approvedTasks = new Set<string>()

export function registerRiskConfirm(deps: { getMainWindow: () => Electron.BrowserWindow | null }): void {
  getMainWindow = deps.getMainWindow
  ipcMain.handle(
    'risk:respond',
    (_e, requestId: string, decision: 'allow' | 'deny', approveTask: boolean, taskKey?: string) => {
      const resolve = pending.get(requestId)
      if (!resolve) return false
      pending.delete(requestId)
      if (decision === 'allow' && approveTask && taskKey) approvedTasks.add(taskKey)
      resolve(decision === 'allow' ? 'allow' : 'deny')
      return true
    },
  )
}

/** 新任务开始时清除该会话的「本次任务都批准」记录 */
export function clearApprovedForSid(sid: string): void {
  const prefix = sid + '::'
  for (const k of approvedTasks) {
    if (k.startsWith(prefix)) approvedTasks.delete(k)
  }
}

export function requestRiskConfirm(p: {
  kind: string
  detail: string
  level: string
  sid?: string
  taskId?: string
}): Promise<RiskDecision> {
  const taskKey = p.sid && p.taskId ? p.sid + '::' + p.taskId : undefined
  if (taskKey && approvedTasks.has(taskKey)) return Promise.resolve('allow')
  const requestId = 'rc' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
  return new Promise<RiskDecision>((resolve) => {
    pending.set(requestId, resolve)
    const payload: RiskConfirmPayload = {
      requestId,
      kind: p.kind,
      detail: p.detail,
      level: p.level,
      sid: p.sid,
      taskId: p.taskId,
      taskKey,
      expiresAt: Date.now() + RISK_CONFIRM_TIMEOUT_MS,
    }
    try {
      getMainWindow()?.webContents.send('risk:confirm', payload)
    } catch { /* 无窗口时按超时处理 */ }
    setTimeout(() => {
      const r = pending.get(requestId)
      if (!r) return
      pending.delete(requestId)
      console.warn('[risk] 确认超时自动拒绝: ' + p.kind)
      r('timeout')
    }, RISK_CONFIRM_TIMEOUT_MS)
  })
}
