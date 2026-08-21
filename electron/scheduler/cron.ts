// electron/scheduler/cron.ts — 定时任务调度器
import * as fs from 'fs'

interface CronJob { id: string; expression: string; prompt: string; nextRun: number; enabled: boolean }

const jobs: CronJob[] = []
let timer: NodeJS.Timeout | null = null
let dataPath = ''

function parseCron(expr: string, from?: number): Date | null {
  const base = from ?? Date.now()
  // 支持简单格式: "every 30m" / "at 09:00" / "every 1h"
  if (expr.startsWith('every ')) {
    const rest = expr.slice(6)
    const num = parseInt(rest)
    if (rest.endsWith('m')) return new Date(base + num * 60000)
    if (rest.endsWith('h')) return new Date(base + num * 3600000)
  }
  if (expr.startsWith('at ')) {
    const time = expr.slice(3)
    const [h, m] = time.split(':').map(Number)
    const d = new Date(base)
    d.setHours(h || 0, m || 0, 0, 0)
    if (d.getTime() <= base) d.setDate(d.getDate() + 1)
    return d
  }
  return null
}

function checkJobs(sendFn: (prompt: string) => void) {
  const now = Date.now()
  let changed = false
  for (const job of jobs) {
    if (!job.enabled) continue
    if (now >= job.nextRun) {
      sendFn(job.prompt)
      // 基于计划时间（job.nextRun）计算下一次触发，避免漂移累积
      const next = parseCron(job.expression, job.nextRun)
      if (next) { job.nextRun = next.getTime(); changed = true }
    }
  }
  if (changed) saveJobs()
}

function saveJobs() { fs.writeFileSync(dataPath, JSON.stringify(jobs), 'utf-8') }

export function initCron(path: string, sendFn: (prompt: string) => void) {
  dataPath = path
  try { if (fs.existsSync(path)) jobs.push(...JSON.parse(fs.readFileSync(path, 'utf-8'))) } catch (e) { console.warn('[cron] 读取任务文件失败:', e) }
  if (timer) clearInterval(timer)
  timer = setInterval(() => checkJobs(sendFn), 30000) // 每 30 秒检查
}

export function addJob(expression: string, prompt: string): string {
  const next = parseCron(expression)
  if (!next) throw new Error('Invalid cron expression: ' + expression)
  const id = Date.now().toString(36)
  jobs.push({ id, expression, prompt, nextRun: next.getTime(), enabled: true })
  saveJobs()
  return id
}

export function listJobs(): CronJob[] { return [...jobs] }
export function removeJob(id: string) { const i = jobs.findIndex(j => j.id === id); if (i >= 0) { jobs.splice(i, 1); saveJobs() } }
export function toggleJob(id: string) { const j = jobs.find(j => j.id === id); if (j) { j.enabled = !j.enabled; saveJobs() } }
