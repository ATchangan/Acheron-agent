// src/store/memory.ts —— 记忆读写/自动提取/缓存刷新(v0.3.0 M2)
// 职责: autoExtractMemory/refreshMemoryCache/memoryBlock
// 迁移自 chat.ts() —— 行为未改
import { safeIPC } from '../utils/safe'
import { useSettingsStore } from './settings'
import type { SessionData, MemoryData } from '../global'
import { scoreOverlap, scanMemoryText } from '../../electron/shared/memory-utils'
export { scanMemoryText }

// 记忆安全扫描已抽至 shared/memory-utils（B6-2），此处 re-export 保持调用方兼容

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
    const tail = '\n(更早或更详细的记忆可用 recall_memory 工具检索, 不要凭记忆猜测)\n'
// 记忆护栏 6000 字符: 超限时保留头 4000 + 尾 1500 + 截断标记，保证关键信息不丢
  if (trim) {
    const joined = parts.join('\n\n')
    if (joined.length > 6000) {
      return '\n' + memoryUsageLine() + '\n\n' + joined.slice(0, 4000) + '\n...[\u8bb0忆内容过长已截断]...\n' + joined.slice(-1500) + tail
    }
  }
  // 头部显示记忆使用率
  return parts.length ? '\n' + memoryUsageLine() + '\n\n' + parts.join('\n\n') + tail : ''
}
