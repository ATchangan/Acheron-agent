// src/store/model-pick.ts —— 模型选择策略(v0.3.1 补丁 D3: 从 chat-send.ts 拆出, 行为零变化)
import type { ProviderConfig, SettingsData } from '../global'
import type { GeneralSettings } from '../types'

interface ModelChoice {
  main: { p: ProviderConfig; model: string }
  fast: { p: ProviderConfig; model: string }
  small: { p: ProviderConfig; model: string } | null
  large: { p: ProviderConfig; model: string } | null
  chosen: { p: ProviderConfig; model: string }
  isSimple: boolean
}

export function resolveModel(gNow: GeneralSettings, cfg: SettingsData, p: ProviderConfig, key: string): { p: ProviderConfig; model: string } | null {
  const val = (gNow as unknown as Record<string, string | undefined>)[key]
  if (!val) return null
  const [pid, m] = val.includes('::') ? val.split('::') : [null, val]
  if (pid) { const pr = (cfg.providers || []).find((x: ProviderConfig) => x.id === pid); if (pr && (pr.models || []).includes(m)) return { p: pr, model: m } }
  else if ((p.models || []).includes(val)) return { p, model: val }
  return null
}

// 简单任务自动用快速模型（autoFastModel 开启且消息短/无图片时）—— 词表扩充, 减少误判
const heavyWords = ['工具', '代码', '脚本', '文件', '读取', '创建', '查找', '目录', '搜索', '网页', '下载', '执行', '命令', '终端', '分析', '总结', '报告', '修改', '删除', '移动', '复制']

export function pickModels(gSnap: GeneralSettings, cfg: SettingsData, p: ProviderConfig, content: string, images?: string[]): ModelChoice {
  const gNow = gSnap
  const main = resolveModel(gNow, cfg, p, 'mainModel') || { p, model: p.selectedModel || p.models[0] || 'deepseek-v4-pro' }
  const isSimple = gNow.autoFastModel !== false && !images?.length && content.length < 300 && !heavyWords.some(w => content.includes(w))
  const fast = isSimple ? (resolveModel(gNow, cfg, p, 'fastModel') || main) : main
  // 调度绑定（全局公用，含自定义模型）—— 轻量任务→小模型，复杂任务→大模型
  const small = resolveModel(gNow, cfg, p, 'smallModel')
  const large = resolveModel(gNow, cfg, p, 'largeModel')
  const chosen = isSimple ? (small || fast) : (large || main)
  return { main, fast, small, large, chosen, isSimple }
}
