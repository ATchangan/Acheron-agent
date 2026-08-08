// electron/cache/model-cache-stats.ts — 按 会话×模型 的 TOKEN 缓存命中统计(持久化)
// 口径(用量统计规格 v2): 命中率 = cache.readTokens ÷ input.totalTokens, 不钳制上限
// 字段映射(由 engine.normalizeUsage 归一化后写入):
//   readTokens  = 缓存命中读取(DeepSeek/SiliconFlow hit / OpenAI·智谱·通义·火山·Gemini cached / Kimi cached_tokens / Anthropic cache_read / Gemini cachedContentTokenCount)
//   missTokens  = 缓存未命中(DeepSeek/SiliconFlow miss, 或 总输入 - 命中; 不含缓存写入)
//   inputTokens = 输入总用量(缓存读取 + 未命中 + 写入)
//   writeTokens = 缓存写入(Anthropic cache_creation / OpenRouter cache_write / 通义 cache_creation_input_tokens)
//   cacheSupported = 该模型供应商是否支持缓存统计(false=不支持, true=支持, null=未确认)
// 结构: { [sessionId]: { [model]: { requests, readTokens, inputTokens, cacheSupported } } }
// 右侧面板 = 当前会话维度; 设置页 = 所有会话按模型汇总; 删除会话同步删除统计

import * as fs from 'fs'
import { join } from 'path'
import { classifyCacheSupport, cacheCapToSupported } from '../engine/cache-caps'

interface ModelTok {
  requests: number
  readTokens: number
  inputTokens: number
  writeTokens: number
  hitReqs: number
  observedReqs: number
  missTokens?: number
  cacheSupported?: boolean | null
  providerName?: string
}
type SessionStats = Record<string, Record<string, ModelTok>>

// v0.3.6: 逐请求明细(HanaAgent 请求明细同款) —— 供"请求明细/按日期/按类别"视图使用
export interface LedgerEntry {
  ts: number
  sid: string
  model: string
  provider?: string
  readTokens: number
  missTokens: number
  writeTokens: number
  inputTokens: number
  outputTokens: number
  hit: boolean
  supported: boolean | null
  status: 'ok' | 'error'
}

const FILE = (() => {
  try { return join(require('electron').app.getPath('userData'), 'model-cache-stats.json') } catch { return '' }
})()

let sessions: SessionStats = {}
let ledger: LedgerEntry[] = []
const LEDGER_MAX = 500
let dirty = false
let timer: ReturnType<typeof setTimeout> | null = null

function persist() {
  if (!FILE || !dirty) return
  dirty = false
  try { fs.writeFileSync(FILE, JSON.stringify({ v: 6, sessions, ledger }, null, 2), 'utf-8') } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
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
    // 注意: missTokens 是现行字段, 不能像旧版那样无条件删除(会抹掉重启前累计的未命中数据)
    for (const sid of Object.keys(s)) {
      for (const m of Object.keys(s[sid])) {
        const c = s[sid][m]
        if (typeof c.readTokens !== 'number') c.readTokens = c.hitTokens || 0
        if (typeof c.inputTokens !== 'number') c.inputTokens = (c.hitTokens || 0) + (c.missTokens || 0)
        if (typeof c.writeTokens !== 'number') c.writeTokens = 0
        // v0.3.6 修复: 旧版本曾因无条件 delete missTokens + cached_tokens=0 不兜底, 导致
        // 读取+未命中 < 输入总用量。无写入的行可安全按 input - read 补齐(Anthropic/通义有写入的行跳过)
        if (typeof c.missTokens !== 'number') c.missTokens = Math.max(0, c.inputTokens - c.readTokens - (c.writeTokens || 0))
        else if ((c.writeTokens || 0) === 0 && c.missTokens !== c.inputTokens - c.readTokens) c.missTokens = Math.max(0, c.inputTokens - c.readTokens)
        if (typeof c.hitReqs !== 'number') c.hitReqs = 0
        if (typeof c.observedReqs !== 'number') c.observedReqs = c.requests || 0
        delete c.hitTokens
      }
    }
    sessions = s
    ledger = Array.isArray(raw.ledger)
      ? raw.ledger
        .filter((e: unknown) => e && typeof e === 'object' && typeof (e as LedgerEntry).model === 'string')
        .slice(-LEDGER_MAX)
      : []
  } catch { sessions = {} }
}
loadStats()

function ensure(sid: string, model: string): ModelTok {
  if (!sessions[sid]) sessions[sid] = {}
  if (!sessions[sid][model]) sessions[sid][model] = { requests: 0, readTokens: 0, inputTokens: 0, writeTokens: 0, hitReqs: 0, observedReqs: 0 }
  return sessions[sid][model]
}

// supported=true 的请求才计入命中率观测分母(HanaAgent 同口径: 命中率 = 命中请求 ÷ 有观测请求)
export function recordRequest(sid: string, model: string, hit: boolean, supported?: boolean): void {
  if (!model) return
  const cur = ensure(sid || '_', model)
  cur.requests++
  if (supported === undefined || supported) {
    cur.observedReqs++
    if (hit) cur.hitReqs++
  }
  schedulePersist()
}

// 记录 usage: readT = 缓存命中读取; inputT = 输入总 token; writeT = 缓存写入 token(Anthropic cache_creation)
export function recordTokens(
  sid: string,
  model: string,
  readT: number,
  inputT: number,
  writeT: number,
  missT?: number,
  opts?: { supported?: boolean | null; provider?: string },
): void {
  if (!model) return
  const cur = ensure(sid || '_', model)
  cur.readTokens += readT || 0
  cur.inputTokens += inputT || 0
  cur.writeTokens += writeT || 0
  if (typeof missT === 'number') cur.missTokens = (cur.missTokens || 0) + missT
  if (opts && opts.supported !== undefined) cur.cacheSupported = opts.supported
  if (opts?.provider) cur.providerName = opts.provider
  schedulePersist()
}

// 逐请求明细(每次真实 LLM 请求一条; 由 engine.recordUsage 去重后调用)
export function recordEntry(e: {
  sid: string
  model: string
  provider?: string
  readTokens: number
  missTokens: number
  writeTokens: number
  inputTokens: number
  outputTokens?: number
  hit: boolean
  supported: boolean | null
  ts?: number
}): void {
  if (!e?.model) return
  ledger.push({
    ts: e.ts || Date.now(),
    sid: e.sid || '_',
    model: e.model,
    provider: e.provider || '',
    readTokens: e.readTokens || 0,
    missTokens: e.missTokens || 0,
    writeTokens: e.writeTokens || 0,
    inputTokens: e.inputTokens || 0,
    outputTokens: e.outputTokens || 0,
    hit: !!e.hit,
    supported: e.supported ?? null,
    status: 'ok',
  })
  if (ledger.length > LEDGER_MAX) ledger.splice(0, ledger.length - LEDGER_MAX)
  schedulePersist()
}

export function deleteSession(sid: string): void {
  let removed = false
  if (sessions[sid]) { delete sessions[sid]; removed = true }
  const before = ledger.length
  ledger = ledger.filter(e => e.sid !== sid)
  if (ledger.length !== before) removed = true
  if (removed) schedulePersist()
}

export function getAll() {
  const perModel: Record<string, ModelTok> = {}
  for (const sid of Object.keys(sessions)) {
    for (const m of Object.keys(sessions[sid])) {
      const c = sessions[sid][m]
      const a = perModel[m] || { requests: 0, readTokens: 0, inputTokens: 0, writeTokens: 0, hitReqs: 0, observedReqs: 0 }
      a.requests += c.requests; a.readTokens += c.readTokens; a.inputTokens += c.inputTokens; a.writeTokens += c.writeTokens || 0; a.missTokens = (a.missTokens || 0) + (c.missTokens || 0)
      a.hitReqs += c.hitReqs || 0; a.observedReqs += c.observedReqs || 0
      if (!a.providerName && c.providerName) a.providerName = c.providerName
      if (c.cacheSupported !== undefined) {
        if (a.cacheSupported === undefined) a.cacheSupported = c.cacheSupported
        else if (a.cacheSupported !== c.cacheSupported) a.cacheSupported = null // 同一模型多供应商口径不一致 → 未确认
      }
      perModel[m] = a
    }
  }
  enrichCacheSupport(perModel)
  return { sessions, models: perModel, ledger: [...ledger].reverse() }
}

export function getSession(sid: string) { return sessions[sid] || {} }

// 老数据没有 cacheSupported 时, 从 settings.json 的供应商配置推断模型归属并判定能力
let providerCapsCache: { name: string; type: string; baseUrl?: string; models: string[]; selectedModel?: string }[] | null = null
function loadProviderCaps() {
  if (providerCapsCache) return providerCapsCache
  try {
    const raw = JSON.parse(fs.readFileSync(join(require('electron').app.getPath('userData'), 'settings.json'), 'utf-8'))
    providerCapsCache = (raw?.providers || []).map((p: { name?: string; type?: string; baseUrl?: string; models?: string[]; selectedModel?: string }) => ({
      name: p.name || '', type: p.type || '', baseUrl: p.baseUrl, models: p.models || [], selectedModel: p.selectedModel,
    }))
  } catch { providerCapsCache = [] }
  return providerCapsCache!
}
function enrichCacheSupport(perModel: Record<string, ModelTok>): void {
  for (const [model, a] of Object.entries(perModel)) {
    if (a.cacheSupported !== undefined) continue
    const prov = loadProviderCaps().find(p => (p.models || []).includes(model) || p.selectedModel === model)
    // 未找到供应商或官方未确认 → 一律按不支持（false）展示，避免伪装成 0% 命中率
    if (!prov) { a.cacheSupported = false; continue }
    a.cacheSupported = cacheCapToSupported(classifyCacheSupport(prov))
    if (!a.providerName) a.providerName = prov.name
  }
}

export function resetOne(model: string): boolean {
  let found = false
  for (const sid of Object.keys(sessions)) {
    if (sessions[sid][model]) { delete sessions[sid][model]; found = true }
    if (Object.keys(sessions[sid]).length === 0) delete sessions[sid]
  }
  const before = ledger.length
  ledger = ledger.filter(e => e.model !== model)
  if (ledger.length !== before) found = true
  if (found) schedulePersist()
  return found
}

export function resetAll(): number {
  const n = Object.keys(sessions).length
  sessions = {}
  ledger = []
  schedulePersist()
  return n
}
