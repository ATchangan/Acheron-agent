// electron/memory/decay.ts — 三档记忆衰减(v0.4.0 M3)
// 每日 04:00 运行(可配): pinned 永存; important 60/360 天; normal 30/180 天(有访问历史延长)
// 半衰期: normal 超一半天数时 confidence 减半(下限 1), 不删除
import { getMemoriesForDecay, softDeleteMemory, setMeta, getMeta, setConfidenceValue, pruneToolOutputs, pruneAudit, optimizeDb, vacuumDb } from '../db'

const DAY = 24 * 3600 * 1000
export const DECAY_LIMITS = { normal: 30, normalActive: 180, important: 60, importantActive: 360 }
const TOOL_OUTPUT_RETENTION_DAYS = 30
const AUDIT_RETENTION_DAYS = 180
const VACUUM_INTERVAL_DAYS = 7

export function decayLimit(level: 'normal' | 'important' | 'pinned', accessCount: number): number {
  if (level === 'pinned') return Infinity
  if (level === 'important') return accessCount > 0 ? DECAY_LIMITS.importantActive : DECAY_LIMITS.important
  return accessCount > 0 ? DECAY_LIMITS.normalActive : DECAY_LIMITS.normal
}

export interface DecayResult { checked: number; softDeleted: number; weakened: number }

export function runDecay(now = Date.now()): DecayResult {
  const out: DecayResult = { checked: 0, softDeleted: 0, weakened: 0 }
  for (const m of getMemoriesForDecay()) {
    out.checked++
    const days = (now - m.lastAccess) / DAY
    const limit = decayLimit(m.level, m.accessCount)
    if (days > limit) {
      softDeleteMemory(m.id as number)
      out.softDeleted++
      continue
    }
    if (m.level === 'normal' && days > limit / 2 && m.confidence > 1) {
      try {
        const next = Math.max(1, Math.floor(m.confidence / 2))
        setConfidenceValue(m.id as number, next)
        out.weakened++
      } catch { /* 忽略 */ }
    }
  }
  return out
}

// 每日至多跑一次: 记录 meta.decay_last_run(日期键), 跨天且过 04:00 才执行
export function maybeRunDailyDecay(now = Date.now()): DecayResult | null {
  const d = new Date(now)
  const dayKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const lastKey = getMeta('decay_last_run')
  const afterFour = d.getHours() >= 4
  if (!afterFour || lastKey === dayKey) return null
  const res = runDecay(now)
  // 追加表的保留期清理(时间+条数双上限)与索引优化, 与衰减共用每日一次的机会
  pruneToolOutputs(TOOL_OUTPUT_RETENTION_DAYS * DAY)
  pruneAudit(AUDIT_RETENTION_DAYS * DAY)
  optimizeDb()
  const lastVacuum = getMeta('vacuum_last_run')
  const lastVacuumTs = lastVacuum ? Number(lastVacuum) || 0 : 0
  if (now - lastVacuumTs >= VACUUM_INTERVAL_DAYS * DAY) {
    vacuumDb()
    setMeta('vacuum_last_run', String(now))
  }
  setMeta('decay_last_run', dayKey)
  return res
}
