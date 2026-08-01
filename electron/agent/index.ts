// electron/agent/index.ts — Agent 模块总出口
export * from './planner'
export * from './multi-agent'
export * from './context'

import { initMultiAgent, BUILTIN_AGENTS } from './multi-agent'

let initialized = false

export function initAgentSystemSync() {
  if (initialized) return
  initMultiAgent()
  initialized = true
  console.log('[黄泉Agent] 多Agent系统已初始化，注册 ' + BUILTIN_AGENTS.length + ' 个Agent')
}

export function getAgentCount(): number { return BUILTIN_AGENTS.length }
