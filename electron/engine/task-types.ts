// electron/engine/task-types.ts — 任务状态与运行类型(0.3.9 结构清理: 从 engine.ts 抽出)
import type { EngineMessage, EngineProvider, EngineSettings, EngineToolCall, EngineUsage, PlanStep } from './types'
import type { EngineMemory } from './memory'
import type { InstructionFile } from './project-instructions'
import type { TaskType } from '../llm/gateway'

export interface TokenStat { requests: number; readTokens: number; inputTokens: number; writeTokens: number; outputTokens: number; hitReqs: number }
export interface ToolLogEntry { name: string; args: Record<string, unknown>; result: string; error: boolean; ms: number; toolCallId?: string; agent?: string }
export interface CallResult { text: string; reasoning?: string; tcs: EngineToolCall[]; ttft?: number; duration?: number; usage?: EngineUsage; msgId?: string; truncated?: boolean }
export interface PlanGate { promise: Promise<void>; resolve: (v: boolean) => void }
export interface TaskGoal {
  objective: string
  status: 'active' | 'completed' | 'failed' | 'aborted'
  startedAt: number
  progress?: string
}

export interface TaskState {
  sid: string
  taskId: string
  myGen: number
  content: string
  images?: string[]
  attachments?: EngineMessage['attachments']
  userMsgId: string
  userMsg: EngineMessage
  messages: EngineMessage[]
  g: EngineSettings
  providers: EngineProvider[]
  p: EngineProvider
  curP: EngineProvider
  model: string
  origModel: string
  taskType?: TaskType
  modelFailCount: number
  modelFallbackUsed: boolean
  triedModels?: string[]
  agent?: string
  agentManual?: boolean
  activeAgents: string[]
  handoffStack: string[]
  handoffCounts: Record<string, number>
  handoffAt: number
  toolLog: ToolLogEntry[]
  tokBase: Record<string, TokenStat>
  memoryText: string
  projectCtx: { file: string; content: string; truncated?: boolean; dirs?: string[] } | null
  instrVisited: Set<string>
  fileSnapshots: Record<string, string | null>
  memory: EngineMemory
  lastMidSave: number
  planSteps: PlanStep[]
  planSummary: string
  planGateChecked: boolean
  planEmitTimer: NodeJS.Timeout | null
  planLastSnapshot: string
  planSurprises: string[]
  planDecisions: string[]
  planDocTimer: NodeJS.Timeout | null
  goal: TaskGoal
  planPending: PlanGate | null
  planApproved: boolean
  stopped: boolean
  taskFinished: boolean
  autoContinueCount?: number
  running: boolean
  lastMsgId?: string
  roundNum: number
  interjects: { text: string; kind: 'supplement' | 'retarget' }[]
  withImages: boolean
  switchedVision: boolean
  earlySummary?: string
  earlySummaryDone?: boolean
  skillsCache?: { name: string; description: string }[]
  lastCompactAt?: number
  lastPromptTokens?: number
  compactCount?: number
  pendingText?: string
}

export type { InstructionFile }
