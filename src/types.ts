// src/types.ts —— 渲染层类型入口
// GeneralSettings / AgentDef 唯一来源已迁移到 electron/shared/settings-types.ts(与主进程引擎共用一份)
export type { AgentDef, GeneralSettings } from '../electron/shared/settings-types'

interface ToolParam {
  type: string
  description?: string
  enum?: string[]
  items?: ToolParam
  properties?: Record<string, ToolParam>
  required?: string[]
}

export interface ToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: { type: 'object'; properties: Record<string, ToolParam>; required?: string[] }
  }
}
