// electron/engine/task-types.ts — 任务状态与运行类型(0.3.9 结构清理: 从 engine.ts 抽出)
import type { EngineMessage, EngineProvider, EngineSettings, EngineToolCall, EngineUsage, PlanStep, ContextSnapshot } from './types'
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
  clarifyPending?: { reqId: string; resolve: (answer: string) => void } | null
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
  matchedSkills?: { name: string; body: string }[]
  lastCompactAt?: number
  lastPromptTokens?: number
  compactCount?: number
  pendingText?: string
  contextSnapshot?: ContextSnapshot
  // v0.4.4 长任务感知性/停滞兜底: 最近一次活动(LLM产出/工具完成)时间戳、停滞态、在跑工具计数、进度发射节流; runStartedAt=本次任务开始(恢复则现在)用于耗时
  lastActivity: number
  stalled?: boolean
  toolActiveCount: number
  progressLast?: number
  runStartedAt: number
  compacting?: boolean // v0.4.4: 上下文压缩 LLM 调用进行中(看门狗视为活跃, 不判停滞)
}

export type { InstructionFile }
