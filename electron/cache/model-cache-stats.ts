// electron/cache/model-cache-stats.ts — 按 会话×模型 的 TOKEN 缓存命中统计(持久化)
// 口径(用量统计规格 v1): 命中率 = cache.readTokens ÷ input.totalTokens, 不钳制上限
// 字段映射: DeepSeek prompt_cache_hit_tokens → readTokens; prompt_tokens → inputTokens
// 结构: { [sessionId]: { [model]: { requests, readTokens, inputTokens } } }
// 右侧面板 = 当前会话维度; 设置页 = 所有会话按模型汇总; 删除会话同步删除统计

import * as fs from 'fs'
import { join } from 'path'

interface ModelTok { requests: number; readTokens: number; inputTokens: number; writeTokens: number; hitReqs: number; observedReqs: number; missTokens?: number }
type SessionStats = Record<string, Record<string, ModelTok>>

const FILE = (() => {
  try { return join(require('electron').app.getPath('userData'), 'model-cache-stats.json') } catch { return '' }
})()

let sessions: SessionStats = {}
let dirty = false
let timer: any = null

function persist() {
  if (!FILE || !dirty) return
  dirty = false
  try { fs.writeFileSync(FILE, JSON.stringify({ v: 4, sessions }, null, 2), 'utf-8') } catch { /* 忽略 */ }
}
function schedulePersist() {
  dirty = true
  if (timer) return
  timer = setTimeout(() => { timer = null; persist() }, 1200)
}

export function loadStats() {
  if (!FILE) return
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf-8')) || {}
    const s = (raw.v >= 2 && raw.sessions) ? raw.sessions : {}
    // 迁移旧口径(v2: hitTokens/missTokens → readTokens/inputTokens; v3 → 补 writeTokens)
    for (const sid of Object.keys(s)) {
      for (const m of Object.keys(s[sid])) {
        const c = s[sid][m]
        if (typeof c.readTokens !== 'number') c.readTokens = c.hitTokens || 0
        if (typeof c.inputTokens !== 'number') c.inputTokens = (c.hitTokens || 0) + (c.missTokens || 0)
        if (typeof c.writeTokens !== 'number') c.writeTokens = 0
        delete c.hitTokens; delete c.missTokens
      }
    }
    sessions = s
  } catch { sessions = {} }
}
loadStats()

function ensure(sid: string, model: string): ModelTok {
  if (!sessions[sid]) sessions[sid] = {}
  if (!sessions[sid][model]) sessions[sid][model] = { requests: 0, readTokens: 0, inputTokens: 0, writeTokens: 0, hitReqs: 0, observedReqs: 0 }
  return sessions[sid][model]
}

export function recordRequest(sid: string, model: string, hit: boolean): void {
  if (!model) return
  const cur = ensure(sid || '_', model)
  cur.requests++
  cur.observedReqs++
  if (hit) cur.hitReqs++
  schedulePersist()
}

// 记录 usage: readT = 缓存命中读取; inputT = 输入总 token; writeT = 缓存写入 token(Anthropic cache_creation)
export function recordTokens(sid: string, model: string, readT: number, inputT: number, writeT: number, missT?: number): void {
  if (!model) return
  const cur = ensure(sid || '_', model)
  cur.readTokens += readT || 0
  cur.inputTokens += inputT || 0
  cur.writeTokens += writeT || 0
  if (typeof missT === 'number') cur.missTokens = (cur.missTokens || 0) + missT
  schedulePersist()
}

export function deleteSession(sid: string): void {
  if (sessions[sid]) { delete sessions[sid]; schedulePersist() }
}

export function getAll() {
  const perModel: Record<string, ModelTok> = {}
  for (const sid of Object.keys(sessions)) {
    for (const m of Object.keys(sessions[sid])) {
      const c = sessions[sid][m]
      const a = perModel[m] || { requests: 0, readTokens: 0, inputTokens: 0, writeTokens: 0, hitReqs: 0, observedReqs: 0 }
      a.requests += c.requests; a.readTokens += c.readTokens; a.inputTokens += c.inputTokens; a.writeTokens += c.writeTokens || 0; a.missTokens = (a.missTokens || 0) + (c.missTokens || 0)
      a.hitReqs += c.hitReqs || 0; a.observedReqs += c.observedReqs || 0
      perModel[m] = a
    }
  }
  return { sessions, models: perModel }
}

export function getSession(sid: string) { return sessions[sid] || {} }

export function resetOne(model: string): boolean {
  let found = false
  for (const sid of Object.keys(sessions)) {
    if (sessions[sid][model]) { delete sessions[sid][model]; found = true }
    if (Object.keys(sessions[sid]).length === 0) delete sessions[sid]
  }
  if (found) schedulePersist()
  return found
}

export function resetAll(): number {
  const n = Object.keys(sessions).length
  sessions = {}
  schedulePersist()
  return n
}
