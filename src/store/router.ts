// src/store/router.ts —— 领域检测/意图路由/多角色调度(v0.3.0 M2→M3)
// 职责: routeAgent 意图路由 —— M3 起: 能力路由(第一顺位) + DOMAIN_RE(第二) + 长度兜底(第三)
// 迁移自 chat.ts 行为基线), M3 新增能力路由
import { useSettingsStore } from './settings'
import { routeAgentCore } from '../../electron/shared/route'

// v0.3.0 M3: 能力/领域路由（B6-2：纯函数已抽至 shared/route）
export function routeAgent(userMessage: string): string | null {
  const g = useSettingsStore.getState().general
  return routeAgentCore(userMessage, g.disabledAgents || [], g.collabMode || '自动')
}

// 路径规范化(处理 .. 穿越), 用于 sandbox 权限比较
