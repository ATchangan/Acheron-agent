// src/store/agents.ts — 多角色定义(纯数据)
// 从 chat.ts 拆分, 降低单文件复杂度
// v0.3.0 M3: AgentDef 实体化 —— tools 真实白名单('*'=全工具) + capabilities + memoryScope + model 偏好
import type { AgentDef } from '../types'
import { BASE_AGENTS } from '../../electron/shared/agents-data'
import { useSettingsStore } from './settings'

export const AGENTS = BASE_AGENTS as Record<string, AgentDef>

// v0.3.0 M3: 运行时读取(含设置页覆盖)的角色表
// 注意: settings.ts 不 import agents.ts(无循环)
export function useAgents(): Record<string, AgentDef> {
  const ov = useSettingsStore.getState().general?.agentOverrides
  return getAgentsWithOverrides(ov)
}

// v0.3.0 M3: 合并用户覆盖(agentOverrides 设置)后的角色表 —— 白名单/模型偏好/记忆范围可被设置页覆盖
function getAgentsWithOverrides(overrides?: Record<string, Partial<AgentDef>>): Record<string, AgentDef> {
  if (!overrides) return AGENTS
  const out: Record<string, AgentDef> = { ...AGENTS }
  for (const name of Object.keys(out)) {
    const o = overrides[name]
    if (o && typeof o === 'object') {
      out[name] = {
        ...out[name],
        ...o,
        tools: Array.isArray(o.tools) && o.tools.length ? o.tools : out[name].tools,
      }
    }
  }
  return out
}
