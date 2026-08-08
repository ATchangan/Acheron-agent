// cron-utils.ts —— 定时任务纯函数与常量（从 CronView 拆出，行为不变）

export interface TaskMeta {
  [id: string]: { name: string; lastRun: number | null }
}

export type FilterTab = 'all' | 'enabled' | 'disabled' | 'today'

// ─── 常数 ────────────────────────────────────────────
export const EXPR_PRESETS = [
  { label: '每分钟', value: 'every 1m' },
  { label: '每5分钟', value: 'every 5m' },
  { label: '每30分钟', value: 'every 30m' },
  { label: '每小时', value: 'every 1h' },
  { label: '每天 9:00', value: 'at 09:00' },
  { label: '每天 18:00', value: 'at 18:00' },
  { label: '每周一 9:00', value: 'at 09:00' },
]

export const TEMPLATES = [
  { name: '晓报', expr: 'at 08:00', prompt: '生成今日早报，包含天气、新闻摘要、日程提醒和建议。' },
  { name: '巡更', expr: 'every 30m', prompt: '执行系统巡检：检查CPU、内存、磁盘使用率，报告异常指标。' },
  { name: '鸿雁', expr: 'every 1h', prompt: '检查收件箱新邮件，生成简要摘要并按重要程度排序。' },
  { name: '温故', expr: 'at 18:00', prompt: '从记忆库中随机抽取3条知识条目进行复习回顾。' },
  { name: '留档', expr: 'at 17:00', prompt: '检查最新备份时间，如超过24小时未备份则发出提醒。' },
]

export const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已禁用' },
  { value: 'today', label: '今天执行过' },
]

export function exprLabel(expr: string): string {
  const p = EXPR_PRESETS.find((e) => e.value === expr)
  if (p) return p.label
  if (expr.startsWith('every ')) {
    const rest = expr.slice(6)
    const n = parseInt(rest)
    if (rest.endsWith('m')) return `每${n}分钟`
    if (rest.endsWith('h')) return `每${n}小时`
  }
  if (expr.startsWith('at ')) return `每日 ${expr.slice(3)}`
  return expr
}

export function relativeTime(ts: number): string {
  if (!ts) return '—'
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const sign = diff >= 0 ? '' : '前'
  const mins = Math.floor(abs / 60000)
  const hrs = Math.floor(abs / 3600000)
  const days = Math.floor(abs / 86400000)
  if (days > 0) return `${days}天${sign}`
  if (hrs > 0) return `${hrs}小时${mins % 60}分${sign}`
  if (mins > 0) return `${mins}分${sign}`
  return `刚刚`
}

export function countdown(ts: number): string {
  if (!ts) return '—'
  const diff = ts - Date.now()
  if (diff <= 0) return '即将执行'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (h > 0) return `${h}时${m}分${s}秒`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

export function fmtTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const time = `${hh}:${mm}:${ss}`
  if (isToday) return `今日 ${time}`
  const MM = String(d.getMonth() + 1).padStart(2, '0')
  const DD = String(d.getDate()).padStart(2, '0')
  return `${MM}/${DD} ${time}`
}

export function isToday(ts: number): boolean {
  if (!ts) return false
  return new Date(ts).toDateString() === new Date().toDateString()
}

// ─── style ───────────────────────────────────────────
