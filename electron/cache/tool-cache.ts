// electron/cache/tool-cache.ts — 工具结果缓存
// 灵感来源：LangChain Cache / Claude Prompt Caching
//
// 缓存策略：
//   - 幂等操作缓存（read, ls, system_info, grep, find, web_search, process_list）
//   - 基于 (tool_name + args_hash) 的 LRU 缓存
//   - TTL 过期：文件系统 30s，Web 搜索 120s，系统信息 60s

import * as crypto from 'crypto'
import * as fs from 'fs'
import { join } from 'path'

// 缓存统计持久化 —— 跨重启累计命中率
const STATS_PATH = (() => {
  try { return join(require('electron').app.getPath('userData'), 'cache-stats.json') } catch { return '' }
})()
let statsTimer: ReturnType<typeof setTimeout> | null = null
function persistStats() {
  if (!STATS_PATH || statsTimer) return
  statsTimer = setTimeout(() => {
    statsTimer = null
    try { fs.writeFileSync(STATS_PATH, JSON.stringify({ hits, misses }, null, 2), 'utf-8') } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  }, 2000)
}
function loadStats() {
  if (!STATS_PATH) return
  try {
    const d = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'))
    if (typeof d.hits === 'number') hits = d.hits
    if (typeof d.misses === 'number') misses = d.misses
  } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
}
loadStats()

interface CacheEntry {
  tool: string
  args_hash: string
  result: string
  created_at: number
  ttl_ms: number
  hit_count: number
}

const cache: Map<string, CacheEntry> = new Map()
let hits = 0
let misses = 0

const TTL: Record<string, number> = {
  read: 30_000, ls: 30_000, grep: 30_000, find: 30_000,
  web_search: 120_000, web_fetch: 120_000, browse: 120_000, browse_screenshot: 120_000,
  system_info: 60_000, process_list: 60_000, screenshot: 10_000, clipboard_read: 5_000,
  recall_memory: 0, default: 10_000,
}

const CACHEABLE = new Set([
  'read', 'ls', 'grep', 'find', 'system_info', 'process_list',
  'web_search', 'web_fetch', 'browse', 'browse_screenshot', 'screenshot', 'clipboard_read',
])

const MAX_ENTRIES = 500

function hashArgs(args: Record<string, unknown>): string {
  // JSON 序列化, 避免对象参数 [object Object] 碰撞
  const sorted = Object.keys(args).sort().map(k => `${k}=${JSON.stringify(args[k])}`).join('&')
  return crypto.createHash('md5').update(sorted).digest('hex').slice(0, 12)
}

export function isCachable(toolName: string): boolean { return CACHEABLE.has(toolName) }

export function getCacheKey(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${hashArgs(args)}`
}

export function getCached(toolName: string, args: Record<string, unknown>): string | null {
  const key = getCacheKey(toolName, args)
  const entry = cache.get(key)
  if (!entry) { misses++; persistStats(); return null }
  const ttl = TTL[toolName] ?? TTL.default
  if (ttl > 0 && Date.now() - entry.created_at > ttl) { cache.delete(key); misses++; persistStats(); return null }
  entry.hit_count++; hits++; persistStats()
  return entry.result
}

export function setCache(toolName: string, args: Record<string, unknown>, result: string): void {
  const key = getCacheKey(toolName, args)
  const ttl = TTL[toolName] ?? TTL.default
  if (ttl === 0) return
  if (cache.size >= MAX_ENTRIES) {
    let oldestKey = '', oldestTime = Infinity
    for (const [k, v] of cache) { if (v.created_at < oldestTime) { oldestTime = v.created_at; oldestKey = k } }
    if (oldestKey) cache.delete(oldestKey)
  }
  cache.set(key, { tool: toolName, args_hash: hashArgs(args), result, created_at: Date.now(), ttl_ms: ttl, hit_count: 0 })
}

export function invalidateCache(toolName?: string): number {
  if (!toolName) { const count = cache.size; cache.clear(); return count }
  let count = 0
  for (const [key] of cache) { if (key.startsWith(toolName + ':')) { cache.delete(key); count++ } }
  return count
}

export function getCacheStats() {
  return {
    size: cache.size, hits, misses,
    hit_rate: hits + misses > 0 ? (hits / (hits + misses) * 100).toFixed(1) + '%' : '0%',
  }
}

export function onWriteOperation(toolName: string) {
  if (['write', 'edit', 'mkdir', 'exec_command'].includes(toolName)) {
    invalidateCache('read'); invalidateCache('ls'); invalidateCache('grep'); invalidateCache('find')
  }
}
