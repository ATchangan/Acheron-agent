// src/store/memory.ts —— 记忆读写/自动提取/缓存刷新(v0.3.0 M2)
// 职责: recordEpisodic/autoExtractMemory/refreshMemoryCache/memoryBlock
// 迁移自 chat.ts() —— 行为未改
import { safeIPC } from '../utils/safe'
import { useSettingsStore } from './settings'
import type { SessionData, MemoryData } from '../global'

let episodicTimer: ReturnType<typeof setTimeout> | null = null
let episodicPending: { op: string; path: string; status: string; ts: number }[] = []

// ─── Hermes 吸收: 记忆安全扫描 ─────────────────────────────────
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /\bapi[_-]?key\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i,
  /\bauthorization\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i,
  /\b[A-Za-z0-9]{32}\.[A-Za-z0-9]{20,}\b/,
]
const INJECT_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+(instructions|prompts)/i,
  /disregard\s+(all\s+)?(prior|previous)\s+(instructions|rules)/i,
  /you\s+are\s+now\s+an?\s+unrestricted/i,
  /忽略(之前|以上|所有)?的?(指令|提示|规则)/,
  /(你现在|你是).{0,10}(不受限制|自由)的?(AI|助手)/,
]
export function scanMemoryText(text: string): { ok: boolean; reason?: string } {
  const t = String(text || '')
  if (!t) return { ok: true }
  for (const re of SECRET_PATTERNS) {
    const m = t.match(re)
    if (m) return { ok: false, reason: '疑似包含密钥/凭证(' + m[0].slice(0, 12) + '…)，已拒绝写入记忆' }
  }
  for (const re of INJECT_PATTERNS) {
    if (re.test(t)) return { ok: false, reason: '疑似提示注入内容，已拒绝写入记忆' }
  }
  return { ok: true }
}

// ─── Hermes 吸收: 记忆冻结快照 + 使用率 ─────────────────────────
let frozenSnapshot: string | null = null
let frozenAt = 0
export function freezeMemory(): void {
  frozenSnapshot = memoryBlock()
  frozenAt = Date.now()
}
export function getFrozenMemory(): string | null {
  return frozenSnapshot === null || Date.now() - frozenAt >= 600000 ? null : frozenSnapshot
}
export function clearFrozenMemory(): void { frozenSnapshot = null; frozenAt = 0 }

function memoryUsageLine(): string {
  const { pinned, facts, summaries } = globalMemoryCache
  return `（记忆: 置顶 ${pinned.length}/10 · 长期 ${facts.length}/500 · 摘要 ${summaries.length}/200，超出可让用户清理或自行整理）`
}
export async function recordEpisodic(name: string, args: Record<string, unknown>, result: string) {
  if (['write', 'edit', 'mkdir', 'exec_command', 'read', 'codebox', 'import_doc', 'save_memory'].includes(name)) {
    episodicPending.push({ op: name, path: String(args.path || args.dirPath || '').slice(0, 120) || String(args.cmd || '').slice(0, 60), status: result.startsWith('E:') ? 'FAIL' : 'OK', ts: Date.now() })
    if (episodicPending.length > 50) episodicPending = episodicPending.slice(-50)
    if (episodicTimer) return
    episodicTimer = setTimeout(async () => {
      episodicTimer = null
      const batch = episodicPending; episodicPending = []
      if (!batch.length) return
      try {
        const mem = await window.huangquan.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [], episodic: [] }))
        const episodic = mem.episodic || []
        episodic.push(...batch)
        if (episodic.length > 200) episodic.splice(0, episodic.length - 200)
        mem.episodic = episodic
        await window.huangquan.memory.save(mem).catch(() => {})
      } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    }, 500)
  }
}

export async function autoExtractMemory(sid: string, sessions: SessionData[]) {
  // 隐私开关(autoMemoryEnabled, 默认开启) + 原文截断收敛(150 字/条)
  try {
    const am = useSettingsStore.getState().general?.autoMemoryEnabled
    if (am === false) return
  } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  const s = sessions.find(x => x.id === sid)
  if (!s || s.messages.length < 3) return
  const last = s.messages.slice(-6).filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
  if (last.length < 2) return
  try {
    const text = last.map(m => `${m.role === 'user' ? '阳间' : '泉'}:${(m.content || '').slice(0, 150)}`).join(' | ')
    // Hermes 吸收: 安全扫描 —— 敏感/注入内容不进自动摘要
    if (!scanMemoryText(text).ok) return
    const mem = await window.huangquan.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [] }))
    mem.summaries.push({ content: `[auto ${new Date().toLocaleDateString('zh-CN')}] ${text.slice(0, 300)}`, timestamp: Date.now() })
    await window.huangquan.memory.save(safeIPC(mem) as Record<string, unknown>)
  } catch (e) { /* 静默 */ console.debug('[swallow]', e) }
}

// 全局记忆缓存 —— 置顶记忆/长期记忆对所有会话共享（启动时加载,发送时刷新）
let globalMemoryCache: { pinned: string[]; facts: string[]; summaries: { content: string }[] } = { pinned: [], facts: [], summaries: [] }
export async function refreshMemoryCache() {
  try {
    const mem = await window.huangquan.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [], episodic: [] }))
    globalMemoryCache = {
      pinned: Array.isArray(mem.pinnedFacts) ? mem.pinnedFacts : [],
      facts: Array.isArray(mem.facts) ? mem.facts : [],
      summaries: Array.isArray(mem.summaries) ? mem.summaries : [],
    }
  } catch (e) { /* 静默 */ console.debug('[swallow]', e) }
}
// 记忆注入段 —— 置顶记忆(全量) + 长期记忆(最近20条) + 情景摘要(最近5条)
export function memoryBlock(): string {
  const { pinned, facts, summaries } = globalMemoryCache
  const parts: string[] = []
  if (pinned.length) parts.push('## 置顶记忆（用户手动固定,跨会话长期生效）\n' + pinned.slice(-10).map((f, i) => `${i + 1}. ${String(f).slice(0, 300)}`).join('\n'))
  if (facts.length) parts.push('## 长期记忆\n' + facts.slice(-10).map((f, i) => `${i + 1}. ${String(f).slice(0, 200)}`).join('\n'))
  if (summaries.length) parts.push('## 近期情景摘要\n' + summaries.slice(-3).map((s: { content: string }, i: number) => `${i + 1}. ${(s.content || '').slice(0, 200)}`).join('\n'))
  const tail = '\n(更早或更详细的记忆可用 recall_memory 工具检索, 不要凭记忆猜测)\n'
  // Hermes 吸收: 头部显示记忆使用率(容量自管理)
  return parts.length ? '\n' + memoryUsageLine() + '\n\n' + parts.join('\n\n') + tail : ''
}
