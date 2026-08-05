// src/store/memory.ts —— 记忆读写/自动提取/缓存刷新(v0.3.0 M2)
// 职责: recordEpisodic/autoExtractMemory/refreshMemoryCache/memoryBlock
// 迁移自 chat.ts() —— 行为未改
import { safeIPC } from '../utils/safe'
import { useSettingsStore } from './settings'
import type { SessionData, MemoryData } from '../global'

let episodicTimer: ReturnType<typeof setTimeout> | null = null
let episodicPending: { op: string; path: string; status: string; ts: number }[] = []

// ─── 记忆安全扫描 ─────────────────────────────────
// 写入前检测 凭证/API Key/提示注入 模式, 命中则拒绝保存(防敏感信息落盘 + 防记忆投毒)
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{16,}\b/,             // OpenAI/DeepSeek 风格
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/,      // OpenAI project key
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,    // GitHub PAT
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,   // Bearer token
  /\bapi[_-]?key\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i,
  /\bauthorization\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i,
  /\b[A-Za-z0-9]{32}\.[A-Za-z0-9]{20,}\b/, // GLM/火山 风格 key
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

// ─── 记忆冻结快照 + 使用率 ─────────────────────────
// 会话开始(首次发送)时冻结一次记忆快照, 本轮任务内所有轮次复用同一快照:
// ① 保留前缀缓存友好(记忆不变) ② 避免任务中途记忆变化干扰执行
let frozenSnapshot: string | null = null
let frozenAt = 0
export function freezeMemory(userMsg?: string): void {
  frozenSnapshot = memoryBlock(userMsg)
  frozenAt = Date.now()
}
export function getFrozenMemory(): string | null {
  // 快照超过 10 分钟视为过期, 回退实时计算
  return frozenSnapshot === null || Date.now() - frozenAt >= 600000 ? null : frozenSnapshot
}
export function clearFrozenMemory(): void { frozenSnapshot = null; frozenAt = 0 }

// 记忆使用率(容量感知): 让 角色能看到记忆占用
function memoryUsageLine(): string {
  const { pinned, facts, summaries } = globalMemoryCache
  return `（置顶 ${pinned.length}/10 · 长期 ${facts.length}/500 · 摘要 ${summaries.length}/200，写满后旧内容会自动清理）`
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
    // 安全扫描 —— 敏感/注入内容不进自动摘要
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
// v0.3.2 T4: 相关度打分 —— 中文 bigram + 英文单词共现计数(无重合时返回 0, 调用方退回最近 N 条)
function scoreOverlap(content: string, userMsg: string): number {
  const tokens = (s: string): string[] => {
    const en = (s.match(/[a-z0-9]+/gi) || []).map(x => x.toLowerCase())
    const zh = (s.match(/[\u4e00-\u9fff]/g) || [])
    const bigrams: string[] = []
    for (let i = 0; i + 1 < zh.length; i++) bigrams.push(zh[i] + zh[i + 1])
    return [...en, ...bigrams]
  }
  const a = new Set(tokens(userMsg))
  if (!a.size) return 0
  return tokens(content).filter(t => a.has(t)).length
}

// 记忆注入段 —— 置顶记忆(全量) + 长期记忆(按相关度 top5, 无 userMsg 时最近 5 条) + 情景摘要(最近 2 条)
// v0.3.2 T4: 动态段移出 buildPrompt, 由构建层尾部注入(前缀缓存友好); 总量护栏 2500 字符按 置顶>长期>情景 裁尾部
export function memoryBlock(userMsg?: string): string {
  const { pinned, facts, summaries } = globalMemoryCache
  // v0.3.5 T2: memoryTrim 开关关闭时回退 0.3.0 全量注入(最近 10 条/3 条, 无护栏)
  const trim = useSettingsStore.getState().general.perf?.memoryTrim !== false
  const parts: string[] = []
  if (pinned.length) parts.push('## 置顶记忆（用户手动固定,跨会话长期生效）\n' + pinned.slice(-10).map((f, i) => `${i + 1}. ${String(f).slice(0, 300)}`).join('\n'))
  if (facts.length) {
    // 按与最近用户消息的关键词重合度取 top5; 无 userMsg 或全零重合时退回最近 5 条
    const scored = trim && userMsg
      ? [...facts].map(f => ({ f: String(f), s: scoreOverlap(String(f), userMsg) })).sort((a, b) => b.s - a.s).map(x => x.f)
      : facts.map(String).slice(-10)
    parts.push('## 长期记忆\n' + (trim ? scored.slice(-5) : scored).map((f, i) => `${i + 1}. ${f.slice(0, 200)}`).join('\n'))
  }
  if (summaries.length) parts.push('## 近期情景摘要\n' + (trim ? summaries.slice(-2) : summaries.slice(-3)).map((s: { content: string }, i: number) => `${i + 1}. ${(s.content || '').slice(0, 200)}`).join('\n'))
  // 总量护栏 2500 字符: 置顶全量保留, 按 长期→情景 从尾部裁剪
  if (trim) while (parts.join('\n\n').length > 2500 && parts.length > 1) parts.pop()
  const tail = '\n(更早或更详细的记忆可用 recall_memory 工具检索, 不要凭记忆猜测)\n'
  // 头部显示记忆使用率
  return parts.length ? '\n' + memoryUsageLine() + '\n\n' + parts.join('\n\n') + tail : ''
}
