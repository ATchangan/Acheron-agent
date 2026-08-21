// src/store/memory.ts —— 记忆自动提取(v0.3.9 结构清理: 渲染侧记忆块已由引擎接管)
// 职责: autoExtractMemory
// 迁移自 chat.ts() —— 行为未改
import { safeIPC } from '../utils/safe'
import { useSettingsStore } from './settings'
import type { SessionData, MemoryData } from '../global'
import { scanMemoryText } from '../../electron/shared/memory-utils'
export { scanMemoryText }

// 记忆安全扫描已抽至 shared/memory-utils（B6-2），此处 re-export 保持调用方兼容

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
    const text = last.map(m => `${m.role === 'user' ? '用户' : '泉'}:${(m.content || '').slice(0, 150)}`).join(' | ')
    // 安全扫描 —— 敏感/注入内容不进自动摘要
    if (!scanMemoryText(text).ok) return
    const mem = await window.huangquan.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [] }))
    mem.summaries.push({ content: `[auto ${new Date().toLocaleDateString('zh-CN')}] ${text.slice(0, 300)}`, timestamp: Date.now() })
    await window.huangquan.memory.save(safeIPC(mem) as Record<string, unknown>)
  } catch (e) { /* 静默 */ console.debug('[swallow]', e) }
}
