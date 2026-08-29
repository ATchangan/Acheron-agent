// electron/cron.ts — 定时任务回归(v0.4.5): 轻量调度器 + IPC
// 表达式: 标准 5 段 cron(分 时 日 月 周), 支持 * 数字 列表(,) 区间(-) 步长(/); 另支持 @hourly/@daily/@weekly
// 触发: 主进程每 30s 对钟一次; 命中后经 'cron:fire' 通知渲染层, 由渲染层走标准 send 流程
// (复用既有会话/保存/事件管线); 应用缩到托盘时照常触发, 完全退出则不触发。
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'

export interface CronJob {
  id: string
  /** 触发类型: cron=定时表达式(默认); watch=文件/目录变化监控 */
  trigger?: 'cron' | 'watch'
  expression?: string
  watchPath?: string
  prompt: string
  enabled: boolean
  createdAt: number
  lastRun?: number
  lastKey?: string
}

let dataFile = ''
let jobs: CronJob[] = []
let getFireTarget: (() => Electron.WebContents | null) | null = null

function load(): void {
  try { jobs = JSON.parse(fs.readFileSync(dataFile, 'utf-8')) as CronJob[] } catch { jobs = [] }
  if (!Array.isArray(jobs)) jobs = []
}
function save(): void {
  try { fs.mkdirSync(join(dataFile, '..'), { recursive: true }) } catch { /* 忽略 */ }
  fs.writeFileSync(dataFile, JSON.stringify(jobs, null, 2), 'utf-8')
}


/** 解析单个 cron 字段 → 命中的取值集合; 非法返回 null */
function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart ? Number(stepPart) : 1
    if (!Number.isInteger(step) || step < 1) return null
    let lo = min, hi = max
    if (rangePart !== '*') {
      if (rangePart.includes('-')) {
        const [a, b] = rangePart.split('-').map(Number)
        if (!Number.isInteger(a) || !Number.isInteger(b)) return null
        lo = a; hi = b
      } else {
        const v = Number(rangePart)
        if (!Number.isInteger(v)) return null
        lo = hi = v
      }
    }
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

/** 是否匹配当前时间; date 由调用方传(测试友好) */
export function cronMatches(expression: string, date: Date): boolean {
  let expr = expression.trim().toLowerCase()
  const shortcuts: Record<string, string> = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *' }
  if (shortcuts[expr]) expr = shortcuts[expr]
  const fields = expr.split(/\s+/)
  if (fields.length !== 5) return false
  const sets: (Set<number> | null)[] = [
    parseField(fields[0], 0, 59),
    parseField(fields[1], 0, 23),
    parseField(fields[2], 1, 31),
    parseField(fields[3], 1, 12),
    parseField(fields[4], 0, 7), // 0 与 7 都是周日
  ]
  for (const s of sets) if (!s) return false
  const values = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()]
  for (let i = 0; i < 5; i++) {
    const set = sets[i]
    if (!set) return false
    if (i === 4) {
      // 周日 0 与 7 等价(两个方向都入集合)
      if (set.has(0)) set.add(7)
      if (set.has(7)) set.add(0)
    }
    if (!set.has(values[i])) return false
  }
  return true
}

function tick(): void {
  const now = new Date()
  const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`
  let changed = false
  for (const job of jobs) {
    if (!job.enabled || job.trigger === 'watch') continue
    const jk = key + ':' + job.id
    if (job.lastKey === jk) continue
    if (!cronMatches(job.expression ?? '', now)) continue
    job.lastRun = Date.now()
    job.lastKey = jk
    changed = true
    try { getFireTarget?.()?.send('cron:fire', { id: job.id, prompt: job.prompt }) } catch { /* 忽略 */ }
  }
  if (changed) save()
}

export function addCronJob(expression: string, prompt: string): { ok: boolean; id?: string; error?: string } {
  const probe = new Date()
  if (!cronMatches(expression.trim(), probe) && !cronMatches(expression.trim(), new Date(2026, 0, 1, 12, 0))) {
    // 语法校验: 两个采样时刻都不匹配也可能是合法表达式(如 2 月 30 日), 这里只拦明显非法(字段数错)
    const n = expression.trim().replace(/@\w+/, '@daily').split(/\s+/).length
    if (expression.trim().startsWith('@')) { /* 快捷式放行 */ } else if (n !== 5) return { ok: false, error: '表达式需要 5 段(分 时 日 月 周)' }
  }
  const job: CronJob = {
    id: 'cron-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    trigger: 'cron',
    expression: expression.trim(),
    prompt: prompt.trim(),
    enabled: true,
    createdAt: Date.now(),
  }
  jobs.push(job)
  save()
  return { ok: true, id: job.id }
}

// v0.4.5: 文件监控触发 —— 监控路径内容变化(hash 抑制)后触发一次
export function addWatchJob(watchPath: string, prompt: string): { ok: boolean; id?: string; error?: string } {
  const wp = String(watchPath || '').trim()
  if (!wp || !fs.existsSync(wp)) return { ok: false, error: '监控路径不存在' }
  const job: CronJob = {
    id: 'watch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    trigger: 'watch',
    watchPath: wp,
    prompt: prompt.trim(),
    enabled: true,
    createdAt: Date.now(),
  }
  jobs.push(job)
  save()
  syncWatchers()
  return { ok: true, id: job.id }
}

// ── 文件监控 watcher(按 job 生命周期增减) ──
const watchers = new Map<string, fs.FSWatcher>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

function hashPath(root: string): string {
  let acc = ''
  let count = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || count > 800) return
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { acc += dir + ':ERR;' ; return }
    for (const e of entries) {
      if (count > 800) return
      const fp = join(dir, e.name)
      count++
      if (e.isDirectory()) { acc += e.name + '/;' ; walk(fp, depth + 1) }
      else {
        try { const st = fs.statSync(fp); acc += e.name + ':' + st.size + ':' + st.mtimeMs + ';' } catch { acc += e.name + ':ERR;' }
      }
    }
  }
  walk(root, 0)
  // djb2
  let h = 5381
  for (let i = 0; i < acc.length; i++) h = ((h << 5) + h + acc.charCodeAt(i)) >>> 0
  return String(h)
}

function syncWatchers(): void {
  const wanted = new Map(jobs.filter(j => j.enabled && j.trigger === 'watch' && j.watchPath && fs.existsSync(j.watchPath)).map(j => [j.id, j.watchPath as string]))
  for (const [id, w] of watchers) {
    if (!wanted.has(id)) { try { w.close() } catch { /* 忽略 */ } ; watchers.delete(id) }
  }
  for (const [id, wp] of wanted) {
    if (watchers.has(id)) continue
    try {
      const job = jobs.find(j => j.id === id)
      if (job) job.lastKey = hashPath(wp) // 建立监控时记基线, 不立即触发
      const w = fs.watch(wp, { recursive: true }, () => {
        const t = debounceTimers.get(id)
        if (t) clearTimeout(t)
        debounceTimers.set(id, setTimeout(() => {
          debounceTimers.delete(id)
          const j = jobs.find(x => x.id === id)
          if (!j || !j.enabled || !j.watchPath) return
          const h = hashPath(j.watchPath)
          if (h === j.lastKey) return
          j.lastKey = h
          j.lastRun = Date.now()
          save()
          try { getFireTarget?.()?.send('cron:fire', { id: j.id, prompt: j.prompt }) } catch { /* 忽略 */ }
        }, 1500))
      })
      watchers.set(id, w)
    } catch { /* 单个监控建立失败不影响其它 */ }
  }
}

export function registerCronIpc(deps: { dataFile: string; getSender: () => Electron.WebContents | null }): void {
  dataFile = deps.dataFile
  getFireTarget = deps.getSender
  load()
  ipcMain.handle('cron:list', () => [...jobs].sort((a, b) => b.createdAt - a.createdAt))
  ipcMain.handle('cron:add', (_e, expression: string, prompt: string) => addCronJob(String(expression || ''), String(prompt || '')))
  ipcMain.handle('cron:remove', (_e, id: string) => { jobs = jobs.filter(j => j.id !== id); save(); syncWatchers(); return true })
  ipcMain.handle('cron:toggle', (_e, id: string) => {
    const j = jobs.find(x => x.id === id)
    if (j) { j.enabled = !j.enabled; save(); syncWatchers() }
    return true
  })
  setInterval(tick, 30_000)
  ipcMain.handle('cron:addWatch', (_e, watchPath: string, prompt: string) => addWatchJob(String(watchPath || ''), String(prompt || '')))
  syncWatchers()
}
