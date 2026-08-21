// electron/engine/model-router.ts — 多模型路由纯函数(与 TaskState 解耦, 可单测)
import type { EngineProvider, EngineSettings } from './types'
import type { AgentDef } from './agents'
import { isVisionModel } from './context'

export interface ModelPick { p: EngineProvider; model: string }

// 角色专属模型: vision 走视觉候选队列, 否则取角色声明模型
export function pickAgentModel(g: EngineSettings, providers: EngineProvider[], p: EngineProvider, agent: string, agents: Record<string, AgentDef>): string {
  const ag = agents[agent]
  const pref = ag?.model
  if (pref === 'vision') {
    const cand = visionCandidates(g, providers, p)
    if (cand.length) return cand[0].model
  }
  return p.selectedModel || p.models[0] || ''
}

// 多模型策略(与旧渲染层 pickModels 同构): 简单任务小模型/快模型, 复杂任务大模型
export function pickInitialModel(g: EngineSettings, providers: EngineProvider[], p: EngineProvider, content: string, images?: string[]): ModelPick {
  const main = resolveModel(g, providers, p, 'mainModel') || { p, model: p.selectedModel || p.models[0] || '' }
  const heavyWords = ['工具', '代码', '脚本', '文件', '读取', '创建', '查找', '目录', '搜索', '网页', '下载', '执行', '命令', '终端', '分析', '总结', '报告', '修改', '删除', '移动', '复制']
  const isSimple = g.autoFastModel !== false && !images?.length && content.length < 300 && !heavyWords.some(w => content.includes(w))
  const fast = isSimple ? (resolveModel(g, providers, p, 'fastModel') || main) : main
  const small = resolveModel(g, providers, p, 'smallModel')
  const large = resolveModel(g, providers, p, 'largeModel')
  return isSimple ? (small || fast) : (large || main)
}

// 按设置键解析模型(支持 provider::model 与当前供应商内模型名)
export function resolveModel(g: EngineSettings, providers: EngineProvider[], curP: EngineProvider, key: string): ModelPick | null {
  const val = g[key]
  if (!val) return null
  const [pid, m] = String(val).includes('::') ? String(val).split('::') : [null, String(val)]
  if (pid) {
    const pr = providers.find(x => x.id === pid)
    if (pr && (pr.models || []).includes(m)) return { p: pr, model: m }
  } else if ((curP.models || []).includes(String(val))) return { p: curP, model: String(val) }
  return null
}

// 推理强度：每模型覆盖 > 全局档位；缺省回落到 medium
export function resolveThinkLevel(g: EngineSettings, model?: string): string {
  const m = model || ''
  const ov = (g.thinkOverrides || {}) as Record<string, string>
  return (m && ov[m]) || String(g.thinkLevel || 'medium')
}

// 视觉模型候选队列: 配置项 > 当前供应商视觉模型 > 任一供应商视觉模型
export function visionCandidates(g: EngineSettings, providers: EngineProvider[], curP: EngineProvider): ModelPick[] {
  const out: ModelPick[] = []
  const list: string[] = (g.visionModels && g.visionModels.length) ? g.visionModels : (g.visionModel ? [g.visionModel] : [])
  const push = (pid: string | null, m: string) => {
    if (pid) {
      const pr = providers.find(x => x.id === pid || x.name === pid)
      if (pr && (pr.models || []).includes(m) && !out.some(c => c.model === m)) out.push({ p: pr, model: m })
    } else {
      const pr = providers.find(x => (x.models || []).includes(m))
      if (pr && !out.some(c => c.model === m)) out.push({ p: pr, model: m })
    }
  }
  for (const item of list) {
    if (item.startsWith('ref:')) {
      const pid = item.slice(4)
      const pr = providers.find(x => x.id === pid || x.name === pid)
      if (pr) { const m = pr.models.find(isVisionModel); if (m) push(pr.id, m) }
    } else if (item.includes('::')) {
      const [a, b] = item.split('::')
      push(a, b)
    } else push(null, item)
  }
  if (!out.length) {
    const inProv = (curP.models || []).find(isVisionModel)
    if (inProv) out.push({ p: curP, model: inProv })
    else {
      for (const pr of providers) {
        const m = (pr.models || []).find(isVisionModel)
        if (m) { out.push({ p: pr, model: m }); break }
      }
    }
  }
  return out
}

// 子任务模型: 角色专属模型(如设计 vision)优先, 否则继承当前模型
export function pickSubModel(g: EngineSettings, providers: EngineProvider[], curP: EngineProvider, currentModel: string, ag?: AgentDef): ModelPick {
  const pref = ag?.model
  if (pref === 'vision') {
    const cands = visionCandidates(g, providers, curP)
    if (cands.length) return cands[0]
  } else if (pref) {
    for (const pr of providers) {
      if ((pr.models || []).includes(pref)) return { p: pr, model: pref }
    }
  }
  return { p: curP, model: currentModel }
}
