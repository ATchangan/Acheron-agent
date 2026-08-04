// src/store/memory.ts —— 记忆读写/自动提取/缓存刷新(v0.3.0 M2)
// 职责: recordEpisodic/autoExtractMemory/refreshMemoryCache/memoryBlock
// 迁移自 chat.ts(v0.2.5) —— 行为未改
import { safeIPC } from '../utils/safe'
import { useSettingsStore } from './settings'
import type { SessionData, MemoryData } from '../global'

let episodicTimer: ReturnType<typeof setTimeout> | null = null
let episodicPending: { op: string; path: string; status: string; ts: number }[] = []
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
    const mem = await window.huangquan.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [] }))
    mem.summaries.push({ content: `[auto ${new Date().toLocaleDateString('zh-CN')}] ${text.slice(0, 300)}`, timestamp: Date.now() })
    await window.huangquan.memory.save(safeIPC(mem) as Record<string, unknown>)
  } catch (e) { /* 静默 */ console.debug('[swallow]', e) }
}

// v0.2.3: 全局记忆缓存 —— 置顶记忆/长期记忆对所有会话共享（启动时加载,发送时刷新）
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
// v0.2.3: 记忆注入段 —— 置顶记忆(全量) + 长期记忆(最近20条) + 情景摘要(最近5条)
export function memoryBlock(): string {
  const { pinned, facts, summaries } = globalMemoryCache
  const parts: string[] = []
  if (pinned.length) parts.push('## 置顶记忆（用户手动固定,跨会话长期生效）\n' + pinned.slice(-10).map((f, i) => `${i + 1}. ${String(f).slice(0, 300)}`).join('\n'))
  if (facts.length) parts.push('## 长期记忆\n' + facts.slice(-10).map((f, i) => `${i + 1}. ${String(f).slice(0, 200)}`).join('\n'))
  if (summaries.length) parts.push('## 近期情景摘要\n' + summaries.slice(-3).map((s: { content: string }, i: number) => `${i + 1}. ${(s.content || '').slice(0, 200)}`).join('\n'))
  const tail = '\n(更早或更详细的记忆可用 recall_memory 工具检索, 不要凭记忆猜测)\n'
  return parts.length ? '\n' + parts.join('\n\n') + tail : ''
}
