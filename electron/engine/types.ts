// electron/engine/types.ts — 独立内核共享类型

export interface EngineProvider {
  id: string
  name: string
  type: string
  apiKey: string
  baseUrl?: string
  models: string[]
  selectedModel?: string
  headers?: string
}

// 引擎用设置快照(主进程直接读 settings.json, 无需渲染层)
export interface EngineSettings {
  workDir?: string
  mode?: string
  language?: string
  temperature?: number
  maxTokens?: number
  maxToolRounds?: number
  retryCount?: number
  parallelTools?: boolean
  meltdownLimit?: number
  toolTimeout?: number
  maxTaskTokens?: number
  riskConfirm?: boolean
  planGate?: boolean
  llmSummary?: boolean
  microCompact?: boolean
  traceEnabled?: boolean
  mcpAutoInject?: boolean
  filePermission?: string
  collabMode?: string
  disabledAgents?: string[]
  disabledTools?: string[]
  toolPerms?: Record<string, string>
  pluginPerm?: Record<string, string>
  autoMemoryEnabled?: boolean
  autoFastModel?: boolean
  mainModel?: string
  fastModel?: string
  smallModel?: string
  largeModel?: string
  codeModel?: string
  longTextModel?: string
  visionModels?: string[]
  visionModel?: string
  maxHandoffChain?: number
  singleBubble?: boolean
  thinkLevel?: string
  thinkOverrides?: Record<string, string>
  chatPersona?: string
  workPersona?: string
  customSystemPrompt?: string
  promptInjectPos?: string
  agentName?: string
  userAlias?: string
  toneStyle?: string
  verbosity?: number
  compactStrategy?: string
  compactMsgCount?: number
  compactTokenLimit?: number
  compactThreshold?: number
  taskArchive?: boolean
  perf?: Record<string, boolean | undefined>
  episodicMemory?: boolean
  [k: string]: unknown
}

export interface EngineToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface EngineMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
  timestamp: number
  tool_call_id?: string
  reasoning_content?: string
  _streaming?: boolean
  images?: string[]
  attachments?: { name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[]
  tool_calls?: { id?: string; type: string; function: { name: string; arguments: string } }[]
  usage?: Record<string, unknown>
  meta?: { ttft?: number; duration?: number; taskTokens?: number; taskMs?: number }
  _toolLog?: { name: string; args: Record<string, unknown>; result: string; error: boolean; ms: number; toolCallId?: string }[]
  _inject?: boolean
  _injectPrefix?: string
}

export interface EngineToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: { type: 'object'; properties: Record<string, { type: string; description?: string; enum?: string[]; items?: unknown }>; required?: string[] }
  }
}

export interface EngineUsage {
  requestId?: string
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  input_tokens?: number
  output_tokens?: number
  _readTokens?: number
  _inputTokens?: number
  _writeTokens?: number
}

export type EngineEvent =
  | { type: 'user-msg'; sid: string; msg: EngineMessage }
  | { type: 'assistant-chunk'; sid: string; id: string; content: string; reasoning?: string; streaming: boolean }
  | { type: 'assistant-usage'; sid: string; id: string; usage: EngineUsage }
  | { type: 'step'; sid: string; id: string; content: string | null; reasoning?: string; toolCalls: EngineToolCall[]; meta?: { ttft?: number; duration?: number } }
  | { type: 'tool-msg'; sid: string; msg: EngineMessage }
  | { type: 'tool-log'; sid: string; stepId: string; log: { name: string; args: Record<string, unknown>; result: string; error: boolean; ms: number; toolCallId?: string }[] }
  | { type: 'stage'; sid: string; phase: 'thinking' | 'tool'; label: string; detail: string }
  | { type: 'stage-clear'; sid: string }
  | { type: 'final'; sid: string; id: string; content: string; reasoning?: string; toolLog: { name: string; args: Record<string, unknown>; result: string; error: boolean; ms: number; toolCallId?: string }[]; taskTokens: number; taskMs: number }
  | { type: 'stream'; sid: string; streaming: boolean; executing: boolean }
  | { type: 'busy'; sid: string; busy: boolean }
  | { type: 'agent'; sid: string; agent: string; activeAgents: string[] }
  | { type: 'interject'; sid: string; msg: EngineMessage; kind: 'supplement' | 'retarget' }
  | { type: 'usage'; sid: string; model: string; usage: EngineUsage }
  | { type: 'context'; sid: string; used: number; limit: number }
  | { type: 'restore'; sid: string; messages: EngineMessage[]; agent?: string; activeAgents: string[]; model: string }
  | { type: 'ui'; sid: string; workDir?: string; theme?: string }
  | { type: 'plan'; sid: string; summary: string; steps: { tool: string; args: Record<string, unknown> }[] }
  | { type: 'compact'; sid: string; messages: EngineMessage[] }
  | { type: 'task-done'; sid: string; taskId: string; status: 'done' | 'failed' | 'aborted'; error?: string }
  | { type: 'error'; sid: string; message: string }

export interface EngineStartParams {
  sid: string
  taskId: string
  content: string
  images?: string[]
  attachments?: EngineMessage['attachments']
  history?: EngineMessage[] // 完整会话历史(已含本条用户消息), 保证跨轮对话记忆
  userMsgId: string
  userMsgTimestamp: number
  resumeTaskId?: string
  agent?: string
  agentManual?: boolean
}
