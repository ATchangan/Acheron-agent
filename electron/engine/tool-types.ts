// electron/engine/tool-types.ts — 工具执行上下文与 handler 声明(供 tools.ts / tool-handlers.ts 共用, 避免循环依赖)
import type { EngineMemory } from './memory'
import type { EngineSettings } from './types'
import type { AgentDef } from './agents'

export interface ToolRunCtx {
  sid: string
  taskId: string
  g: EngineSettings
  agents: Record<string, AgentDef>
  agent?: string
  isSubtask?: boolean
  activeAgents: string[]
  workDir: string
  memoryPath: string
  userDataPath: string
  skillsDirs?: string[]
  sender?: Electron.WebContents | null
  latestUserText?: string
  getMemory: () => EngineMemory
  saveMemory: (m: EngineMemory) => void
  onAgentChange: (agent: string) => void
  onWorkDirChange?: (dir: string) => void
  onThemeChange?: (theme: string) => void
  onPlanUpdate?: (steps: { label?: string; status?: string; expected?: string; id?: string; tool?: string }[]) => string
  onGoalUpdate?: (goal: string) => void
  runDispatch: (tasks: { agent: string; task: string }[]) => Promise<string>
  getHandoffCounts?: () => Record<string, number>
  onHandoffRecord?: (agent: string) => void
  logTrace: (level: 'debug' | 'info' | 'warn' | 'error', event: string, detail?: string) => void
}

// v0.3.7: 声明式工具 handler —— name 对应 schema, run 为执行体, 标志控制缓存/写操作
export interface ToolHandler {
  name: string
  run: (A: Record<string, string>, ctx: ToolRunCtx) => Promise<string> | string
  writeOp?: boolean | ((args: Record<string, unknown>) => boolean)  // 写操作: 执行前清除读缓存; 函数形式按本次参数动态判定
  cacheable?: boolean  // 只读可缓存结果(写操作会自动失效)
}
