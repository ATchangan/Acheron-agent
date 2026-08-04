// src/store/router.ts —— 领域检测/意图路由/多Agent调度(v0.3.0 M2→M3)
// 职责: routeAgent 意图路由 —— M3 起: 能力路由(第一顺位) + DOMAIN_RE(第二) + 长度兜底(第三)
// 迁移自 chat.ts v0.2.5(行为基线), M3 新增能力路由
import { DOMAIN_RE } from './constants'
import { useSettingsStore } from './settings'

// v0.3.0 M3: 能力路由关键词表(第一顺位) —— 命中 1 个能力 → 该 Agent; ≥2 → 姬子 dispatch; chat 为闲聊兜底不主动命中
const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  code: ['代码', '脚本', '项目', 'bug', '修复', '开发', '编程', '写个', '实现', '重构'],
  doc: ['文档', '报告', '翻译', '总结', '纪要', '整理', '校对'],
  security: ['安全', '漏洞', '审查', '风险', '黑客', '攻防'],
  automation: ['定时', '监控', '自动化', '提醒', '调度', '巡检'],
  vision: ['图片', '截图', '设计', '配色', '看图', 'ui', '图标', '视觉'],
  chat: [],
}
const CAP_TO_AGENT: Record<string, string> = { code: '螺丝咕姆', doc: '三月七', security: '银狼', automation: '艾丝妲', vision: '黑天鹅', chat: '知更鸟' }

export function routeAgent(userMessage: string): string | null {
  const t = userMessage.toLowerCase()
  const disabled = useSettingsStore.getState().general.disabledAgents || []
  const collabMode = useSettingsStore.getState().general.collabMode || '自动'
  if (collabMode === '关闭') return null
  if (collabMode === '手动') return null // 手动模式下由用户显式指定，不自动路由
  // v0.3.0 M3: 能力路由(第一顺位)
  const hitCaps = Object.entries(CAPABILITY_KEYWORDS)
    .filter(([cap, kws]) => kws.length > 0 && kws.some(k => t.includes(k.toLowerCase())))
    .map(([cap]) => cap)
  if (hitCaps.length >= 2 && !disabled.includes('姬子')) return '姬子'
  if (hitCaps.length === 1) {
    const capAg = CAP_TO_AGENT[hitCaps[0]]
    if (capAg && !disabled.includes(capAg)) return capAg
  }
  // v0.2.3: 多领域检测 —— 命中 2+ 个不同领域 → 交姬子主控调度(触发 dispatch 强制分发, 无需用户明说)
  let hitDomains = 0
  for (const [name, re] of Object.entries(DOMAIN_RE)) {
    if (re.test(t) && !disabled.includes(name)) hitDomains++
  }
  if (hitDomains >= 2 && !disabled.includes('姬子')) return '姬子'
  for (const [name, re] of Object.entries(DOMAIN_RE)) {
    if (re.test(t)) return disabled.includes(name) ? null : name
  }
  // v0.2.3: 简单任务判定 —— 无任何领域命中且消息很短(闲聊/简单问答/单步指令) → 不路由, 主 Agent 直接完成
  if (t.trim().length < 30) return null
  // 姬子：架构/系统/复杂任务 + 默认兜底(长消息无领域命中视为复杂任务)
  return disabled.includes('姬子') ? null : '姬子'
}

// v0.2.3: 路径规范化(处理 .. 穿越), 用于 sandbox 权限比较
