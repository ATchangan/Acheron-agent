// electron/engine/agents.ts — 引擎侧角色表(基础数据来自 shared/agents-data, 此处只做自定义目录加载与覆盖合并)
import * as fs from 'fs'
import { join } from 'path'
import { BASE_AGENTS } from '../shared/agents-data'
import { normalizeAgentName } from '../shared/agents-data'

export interface AgentDef {
  role: string
  prompt: string
  tools: string[]
  handoff_to: string[]
  icon: string
  model?: string
  memoryScope: string
  capabilities: string[]
}

export const AGENTS = BASE_AGENTS as Record<string, AgentDef>

// v0.3.8: 自定义子代理目录 —— 用户在该目录放 *.json({ "名称": { role, prompt, tools, model? } }) 即可注册自定义子代理
let customAgentsDir = ''
export function setCustomAgentsDir(dir: string): void { customAgentsDir = dir }
function loadCustomAgents(): Record<string, Partial<AgentDef>> {
  const out: Record<string, Partial<AgentDef>> = {}
  if (!customAgentsDir) return out
  try {
    if (!fs.existsSync(customAgentsDir)) return out
    for (const f of fs.readdirSync(customAgentsDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const d = JSON.parse(fs.readFileSync(join(customAgentsDir, f), 'utf-8')) as Record<string, Partial<AgentDef>>
        for (const [name, def] of Object.entries(d || {})) {
          if (name && def && typeof def === 'object') out[name] = def
        }
      } catch { /* 单个文件失败跳过 */ }
    }
  } catch { /* 忽略 */ }
  return out
}

export function getAgents(overrides?: Record<string, Partial<AgentDef>>): Record<string, AgentDef> {
  const out: Record<string, AgentDef> = { ...AGENTS }
  const custom = loadCustomAgents()
  for (const [name, o] of Object.entries({ ...custom, ...(overrides || {}) })) {
    if (!o || typeof o !== 'object') continue
    const key = normalizeAgentName(name)
    const base = out[key] || { role: '自定义子代理', prompt: '你是自定义子代理 ' + key + '，按用户配置执行任务。', tools: ['*'], handoff_to: [], icon: '客', memoryScope: 'private', capabilities: [] }
    out[key] = {
      ...base,
      ...o,
      tools: Array.isArray(o.tools) && o.tools.length ? o.tools : base.tools,
      handoff_to: Array.isArray(o.handoff_to) ? o.handoff_to : base.handoff_to,
    }
  }
  return out
}
