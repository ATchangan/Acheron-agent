// src/store/session-state.ts —— 会话级并发状态（v0.3.1 FIX-1/2/8/16）
// 职责: 取代全局 window.__huangquan_agent / 全局 streaming / 全局 taskGen
// 用法: 由 chat.ts 持有并读写; 禁止其他模块直接 import 本模块内部可变值（只读导出）
import type { SessionData } from '../global'

// ── FIX-1: 会话级角色身份 ──────────────────────────────
// SessionData 字段: agent? / agentManual? / activeAgents?（见 global.d.ts）
export function getSessionAgent(s: SessionData): string | undefined { return s.agent }
export function setSessionAgent(s: SessionData, name: string | undefined, manual?: boolean): SessionData {
  return { ...s, agent: name, agentManual: manual ?? s.agentManual }
}

// ── FIX-2/16: 会话级流式状态 ──────────────────────────────
// SessionData.streaming?: boolean; UI 与判断一律读 s.streaming
// 全局 get().streaming 保留为"当前会话的 streaming"派生值（读取点: const streaming = cur?.streaming ?? false）

// ── FIX-8: 会话级任务代号 ─────────────────────────────────
// 取代 runtime.ts 全局 taskGen: 每个会话独立代号; stop 只递增当前会话代号
export function nextTaskGenFor(bySid: Record<string, number>, sid: string): number {
  const cur = bySid[sid] || 0
  bySid[sid] = cur + 1
  return bySid[sid]
}
export function invalidateSid(bySid: Record<string, number>, sid: string): number {
  const cur = bySid[sid] || 0
  bySid[sid] = cur + 1
  return bySid[sid]                       // stop: 仅使当前会话代号失效
}
export function getTaskGenFor(bySid: Record<string, number>, sid: string): number {
  return bySid[sid] || 0
}
