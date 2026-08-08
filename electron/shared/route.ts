// electron/shared/route.ts —— 角色意图路由纯函数（renderer/main 共享，B6-2）
// 约束：禁止 import electron API / zustand / fs
import { DOMAIN_RE } from './constants'

const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  code: ['代码', '脚本', '项目', 'bug', '修复', '开发', '编程', '写个', '实现', '重构'],
  doc: ['文档', '报告', '翻译', '总结', '纪要', '整理', '校对'],
  security: ['安全', '漏洞', '审查', '风险', '黑客', '攻防'],
  automation: ['定时', '监控', '自动化', '提醒', '调度', '巡检'],
  vision: ['图片', '截图', '设计', '配色', '看图', 'ui', '图标', '视觉'],
  chat: [],
}
const CAP_TO_AGENT: Record<string, string> = { code: '螺丝咕姆', doc: '三月七', security: '银狼', automation: '艾丝妲', vision: '黑天鹅', chat: '知更鸟' }

export function routeAgentCore(userMessage: string, disabled: string[], collabMode: string): string | null {
  const t = userMessage.toLowerCase()
  if (collabMode === '关闭' || collabMode === '手动') return null
  const hitCaps = Object.entries(CAPABILITY_KEYWORDS)
    .filter(([, kws]) => kws.length > 0 && kws.some(k => t.includes(k.toLowerCase())))
    .map(([cap]) => cap)
  if (hitCaps.length >= 2 && !disabled.includes('姬子')) return '姬子'
  if (hitCaps.length === 1) {
    const capAg = CAP_TO_AGENT[hitCaps[0]]
    if (capAg && !disabled.includes(capAg)) return capAg
  }
  let hitDomains = 0
  for (const [name, re] of Object.entries(DOMAIN_RE)) {
    if (re.test(t) && !disabled.includes(name)) hitDomains++
  }
  if (hitDomains >= 2 && !disabled.includes('姬子')) return '姬子'
  for (const [name, re] of Object.entries(DOMAIN_RE)) {
    if (re.test(t)) return disabled.includes(name) ? null : name
  }
  if (t.trim().length < 30) return null
  return disabled.includes('姬子') ? null : '姬子'
}
