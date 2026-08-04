// electron/memory/vector.ts — 语义记忆系统 v2
// TF-IDF 向量化 + 余弦相似度 + 重要性评分 + Token预算 + 衰减 + 自动遗忘

import * as fs from 'fs'

interface MemoryEntry {
  id: string
  content: string
  embedding: number[]
  timestamp: number
  importance: number      // 初始权重
  lastAccessed: number    // 最后检索时间
  accessCount: number     // 命中次数
  decayRate: number       // 每日衰减率
}

let entries: MemoryEntry[] = []
let vocabulary: Map<string, number> = new Map()
let idf: number[] = []
let dirty = false
let memPath = ''

// 配置（可运行时调整）
const CONFIG = {
  tokenBudget: 5000,       // 总 token 预算
  dailyDecay: 0.02,        // 每日衰减率
  hitBoost: 5,             // 命中加成
  baseImportance: 10,      // 基础重要度
  forgetSpeed: 1,          // 遗忘速度
  maxEntries: 500,
}

// RAG embedding 升级 —— OpenAI 兼容 /embeddings 接口(本地 LM Studio / OpenAI / 任意兼容服务)
// 配置为空时自动回退 TF-IDF 检索
let embCfg: { baseUrl: string; apiKey: string; model: string } | null = null
export function setEmbeddingConfig(cfg: { baseUrl: string; apiKey: string; model: string } | null) {
  embCfg = cfg && cfg.baseUrl && cfg.model ? { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey || '', model: cfg.model } : null
}
export function getEmbeddingConfig() { return embCfg ? { ...embCfg } : null }

async function embedText(text: string): Promise<number[] | null> {
  if (!embCfg) return null
  try {
    const net = require('electron').net
    const base = embCfg.baseUrl.replace(/\/+$/, '')
    const url = /\/v\d+$/i.test(base) ? base + '/embeddings' : base + '/v1/embeddings'
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (embCfg.apiKey) headers['Authorization'] = 'Bearer ' + embCfg.apiKey
    const res = await net.fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ model: embCfg.model, input: String(text || '').slice(0, 8000) }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const vec = data?.data?.[0]?.embedding
    if (!Array.isArray(vec) || vec.length === 0) return null
    return vec
  } catch { return null }
}

// 维度不同(模型切换)时清空旧向量, 避免余弦计算 NaN
function normalizeVectors() {
  let dim = 0
  for (const e of entries) if (e.embedding && e.embedding.length) { dim = e.embedding.length; break }
  if (!dim) return
  let changed = false
  for (const e of entries) {
    if (e.embedding && e.embedding.length && e.embedding.length !== dim) { e.embedding = []; changed = true }
  }
  if (changed) dirty = true
}

// 中文按双字滑动窗口(bigram)切分 —— 提升 TF-IDF 对中文语义的区分度
function tokenize(text: string): string[] {
  const latin = text.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 0)
  const cnChars = text.match(/[\u4e00-\u9fff]/g) || []
  const bigrams: string[] = []
  for (let i = 0; i < cnChars.length - 1; i++) bigrams.push(cnChars[i] + cnChars[i + 1])
  return [...latin, ...bigrams]
}

function estimateTokens(text: string): number {
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length
  return Math.ceil(cn / 1.5 + (text.length - cn) / 3.5)
}

function buildVocab(allTexts: string[]) {
  vocabulary.clear()
  for (const text of allTexts) {
    for (const token of tokenize(text)) {
      vocabulary.set(token, (vocabulary.get(token) || 0) + 1)
    }
  }
}

function tfidfVector(text: string): number[] {
  const tokens = tokenize(text)
  const vec = new Array(vocabulary.size).fill(0)
  const tf: Map<string, number> = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
  for (const [token, freq] of tf) {
    const idx = vocabulary.get(token)
    if (idx !== undefined) vec[idx] = (freq / tokens.length) * Math.log((entries.length + 1) / ((idf[idx] || 0) + 1))
  }
  return vec
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ─── 衰减计算 ──────────────────────────────────────────
function applyDecay(entry: MemoryEntry): number {
  const daysSinceAccess = (Date.now() - entry.lastAccessed) / (24 * 3600 * 1000)
  const decay = Math.exp(-entry.decayRate * daysSinceAccess * CONFIG.forgetSpeed)
  return entry.importance * decay
}

// ─── Token 预算管理 ───────────────────────────────────
function enforceTokenBudget() {
  const totalTokens = entries.reduce((s, e) => s + estimateTokens(e.content), 0)
  if (totalTokens <= CONFIG.tokenBudget) return

  // 按有效权重排序（衰减后），淘汰最低分
  const scored = entries.map(e => ({ e, score: applyDecay(e) }))
  scored.sort((a, b) => a.score - b.score)

  let removed = 0
  while (entries.reduce((s, e) => s + estimateTokens(e.content), 0) > CONFIG.tokenBudget * 0.85 && entries.length > 0) {
    const victim = scored[0]
    entries = entries.filter(e => e.id !== victim.e.id)
    scored.shift()
    removed++
  }
  if (removed > 0) dirty = true
}

// ─── 老化清理 ─────────────────────────────────────────
function cleanStale() {
  const before = entries.length
  entries = entries.filter(e => applyDecay(e) > 0.5 || e.accessCount > 0)
  if (entries.length < before) dirty = true
}

// ─── 公共 API ─────────────────────────────────────────

let _inited = false
export function initMemory(dataPath: string) {
  // 幂等 —— main.ts 启动预加载 + getVM 懒加载会重复调用, 避免重复读盘
  if (_inited) return
  _inited = true
  memPath = dataPath
  try {
    if (fs.existsSync(memPath)) {
      const data = JSON.parse(fs.readFileSync(memPath, 'utf-8'))
      entries = data.entries || []
      idf = data.idf || []
      if (data.vocab) vocabulary = new Map(Object.entries(data.vocab))
    }
  } catch (e) { /* fresh start */ console.debug('[swallow]', e) }
}

export function addMemory(content: string, importance?: number): string {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const now = Date.now()
  const entry: MemoryEntry = {
    id, content, embedding: [], timestamp: now,
    importance: importance ?? CONFIG.baseImportance,
    lastAccessed: now,
    accessCount: 0,
    decayRate: CONFIG.dailyDecay,
  }
  entries.push(entry)
  dirty = true
  // 异步补 embedding(不阻塞写入; API 不可用时保持空向量走 TF-IDF 回退)
  embedText(content).then(vec => {
    if (vec && vec.length) { entry.embedding = vec; dirty = true }
  }).catch(() => {})
  // 检查预算
  enforceTokenBudget()
  if (entries.length > CONFIG.maxEntries) {
    entries.sort((a, b) => applyDecay(a) - applyDecay(b))
    entries = entries.slice(-CONFIG.maxEntries)
    dirty = true
  }
  return id
}

export async function searchMemory(query: string, limit = 5): Promise<MemoryEntry[]> {
  if (entries.length === 0) return []

  // 先做老化清理
  cleanStale()
  normalizeVectors()

  // ① embedding 向量检索(配置了嵌入引擎且有向量时优先)
  if (embCfg) {
    const qvec = await embedText(query)
    if (qvec) {
      const withVec = entries.filter(e => e.embedding && e.embedding.length)
      if (withVec.length > 0) {
        const now = Date.now()
        const scored = withVec.map(e => {
          const sim = cosineSimilarity(qvec, e.embedding)
          const eff = applyDecay(e) + e.accessCount * 0.5
          return { ...e, score: sim * (1 + eff / 100) }
        })
        const top = scored.sort((a, b) => b.score - a.score).slice(0, limit)
        for (const r of top) {
          const entry = entries.find(e => e.id === r.id)
          if (entry) { entry.lastAccessed = now; entry.accessCount++; entry.importance = Math.min(100, entry.importance + CONFIG.hitBoost) }
        }
        dirty = true
        return top
      }
    }
  }

  // ② TF-IDF 回退(无嵌入配置 / API 不可用 / 向量未生成)
  const allTexts = entries.map(e => e.content)
  buildVocab(allTexts)
  idf = new Array(vocabulary.size).fill(0)
  for (const e of entries) {
    for (const token of tokenize(e.content)) {
      const idx = vocabulary.get(token)
      if (idx !== undefined) idf[idx]++
    }
  }
  const allVectors = entries.map(e => tfidfVector(e.content))
  const queryVec = tfidfVector(query)

  const now = Date.now()
  const scored = entries.map((e, i) => {
    const sim = cosineSimilarity(queryVec, allVectors[i])
    const effImportance = applyDecay(e) + e.accessCount * 0.5
    return { ...e, score: sim * (1 + effImportance / 100) }
  })

  // 更新命中条目的访问时间和计数
  const top = scored.sort((a, b) => b.score - a.score).slice(0, limit)
  for (const result of top) {
    const entry = entries.find(e => e.id === result.id)
    if (entry) {
      entry.lastAccessed = now
      entry.accessCount++
      entry.importance = Math.min(100, entry.importance + CONFIG.hitBoost)
    }
  }
  dirty = true

  return top
}

export function saveMemory() {
  if (!dirty || !memPath) return
  fs.writeFileSync(memPath, JSON.stringify({ entries, vocabulary: Object.fromEntries(vocabulary), idf }), 'utf-8')
  dirty = false
}

export function clearMemory() { entries = []; vocabulary.clear(); idf = []; dirty = true }

// 运行时调整配置
export function setConfig(partial: Partial<typeof CONFIG>) {
  Object.assign(CONFIG, partial)
}

export function getConfig() { return { ...CONFIG } }

export function getStats() {
  const totalTokens = entries.reduce((s, e) => s + estimateTokens(e.content), 0)
  return {
    entries: entries.length,
    totalTokens,
    tokenBudget: CONFIG.tokenBudget,
    usagePercent: Math.round(totalTokens / CONFIG.tokenBudget * 100),
    avgImportance: entries.length ? Math.round(entries.reduce((s, e) => s + e.importance, 0) / entries.length) : 0,
  }
}

// 定期保存（每 30 秒检查一次）
let saveTimer: NodeJS.Timeout | null = null
export function startAutoSave() {
  if (saveTimer) clearInterval(saveTimer)
  saveTimer = setInterval(() => saveMemory(), 30000)
}
export function stopAutoSave() {
  if (saveTimer) { clearInterval(saveTimer); saveTimer = null }
}