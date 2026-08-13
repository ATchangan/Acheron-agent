// electron/llm/gateway.ts — 模型网关(v0.4.0 M5)
// 统一路由入口: 任务类型检测(text/code/vision/long) + 角色覆盖 + 设置键解析 + 降级链构建。
// 流式请求仍走 llm-core.streamChat, 降级循环复用引擎 switchFallbackModel(0.3.9 已交付), 本模块只负责"选路"。
import type { EngineProvider, EngineSettings } from '../engine/types'
import type { AgentDef } from '../engine/agents'
import { resolveModel, visionCandidates } from '../engine/model-router'

export type TaskType = 'text' | 'code' | 'vision' | 'long'

export interface ModelPick { p: EngineProvider; model: string }

const CODE_WORDS = ['代码', '脚本', '程序', '函数', '类', '接口', 'bug', '调试', '报错', '编译', '重构', '算法', '单元测试', '数据库', 'SQL', '正则']

// 任务类型检测(纯函数, 可单测): 图片→vision; 长文本→long; 代码特征→code; 其余 text
export function detectTaskType(content: string, images: string[] | undefined, opts?: { longCharThreshold?: number }): TaskType {
  if (images && images.length) return 'vision'
  const text = String(content || '')
  if (text.length >= (opts?.longCharThreshold ?? 3000)) return 'long'
  const lower = text.toLowerCase()
  if (CODE_WORDS.some(w => lower.includes(w.toLowerCase()))) return 'code'
  return 'text'
}

// 统一路由: Agent 模型覆盖 > 任务类型默认 > 全局默认(main/fast) > 当前供应商选中模型
export function routeProfile(g: EngineSettings, providers: EngineProvider[], curP: EngineProvider, opts: { agent?: string; agentManual?: boolean; taskType?: TaskType; agents?: Record<string, AgentDef> }): ModelPick {
  const taskType: TaskType = opts.taskType || 'text'
  const agents = opts.agents || {}

  // 1) 角色覆盖(手动切换角色时尊重用户显式选择; AgentDef.model 优先)
  if (opts.agent) {
    const ag = agents[opts.agent]
    if (ag?.model && ag.model !== 'vision') {
      for (const pr of providers) {
        if ((pr.models || []).includes(ag.model)) return { p: pr, model: ag.model }
      }
    }
    if (ag?.model === 'vision') {
      const cand = visionCandidates(g, providers, curP)
      if (cand.length) return cand[0]
    }
  }

  // 2) 任务类型默认模型
  if (taskType === 'vision') {
    const cand = visionCandidates(g, providers, curP)
    if (cand.length) return cand[0]
  } else if (taskType === 'code') {
    const code = resolveModel(g, providers, curP, 'codeModel')
    if (code) return code
  } else if (taskType === 'long') {
    const long = resolveModel(g, providers, curP, 'longTextModel')
    if (long) return long
  }

  // 3) 全局默认
  const main = resolveModel(g, providers, curP, 'mainModel')
  if (main) return main
  return { p: curP, model: curP.selectedModel || (curP.models && curP.models[0]) || '' }
}

// 降级链: 当前模型 → 同供应商未试模型 → 其他有 key 供应商(去重, 最多 4 个候选)
export function buildFallbackChain(g: EngineSettings, providers: EngineProvider[], start: ModelPick): ModelPick[] {
  const out: ModelPick[] = [{ ...start }]
  const seen = new Set<string>([start.model])
  const push = (p: EngineProvider, m: string): void => {
    if (!m || seen.has(m)) return
    if (!(p.models || []).includes(m)) return
    seen.add(m)
    out.push({ p, model: m })
  }
  for (const m of start.p.models || []) push(start.p, m)
  for (const pr of providers) {
    if (!pr.apiKey || !pr.baseUrl || pr.id === start.p.id) continue
    push(pr, pr.selectedModel || (pr.models && pr.models[0]) || '')
    for (const m of pr.models || []) push(pr, m)
  }
  void g
  return out.slice(0, 4)
}
