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
  longTaskAutoContinue?: boolean
  longTaskAutoMax?: number
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
  compactThreshold?: number
  compactKeepRounds?: number
  compactTokenCap?: number
  compactOverrides?: Record<string, number>
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

// v0.3.7: 计划执行 —— 一个工具调用对应一个步骤, 状态机实时推进
export interface PlanStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'aborted' | 'paused'
  tool?: string
  detail?: string
  toolCallId?: string   // 绑定 LLM 工具调用 id: 状态机按 id 关联, 不依赖队列顺序
  expected?: string     // 预期结果/验收标准(可选)
  ms?: number           // 工具执行耗时(ms)
  messageId?: string    // 对应步骤消息 id, UI 点击跳转
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
  // DeepSeek / SiliconFlow: 显式缓存命中与未命中
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  // OpenAI / 智谱 / 通义 / 火山方舟 / Gemini(OpenAI 兼容): 明细字段
  prompt_tokens_details?: {
    cached_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    cache_write_tokens?: number
  }
  // OpenRouter: 顶层缓存写入(部分代理透传形态)
  cache_write_tokens?: number
  // Mistral: 顶层缓存命中数 + 单数拼写的明细字段
  num_cached_tokens?: number
  prompt_token_details?: { cached_tokens?: number }
  // Moonshot / Kimi: 顶层 cached_tokens
  cached_tokens?: number
  // OpenAI Responses API 风格明细
  input_tokens_details?: { cached_tokens?: number }
  // Anthropic 原生: 缓存读取 / 缓存写入(不计入 input_tokens)
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  // Anthropic SDK 形态: cache_control 计费块
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  // Gemini 原生: usageMetadata
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    cachedContentTokenCount?: number
  }
  input_tokens?: number
  output_tokens?: number
  _readTokens?: number
  _missTokens?: number
  _inputTokens?: number
  _writeTokens?: number
}

export type EngineEvent =
  | { type: 'user-msg'; sid: string; msg: EngineMessage }
  // v0.3.6 P1-5: content 改为可选(旧全量格式兜底), 流式正文走 delta 增量
  | { type: 'assistant-chunk'; sid: string; id: string; delta?: string; content?: string; reasoning?: string; streaming: boolean }
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
  | { type: 'interject'; sid: string; msg: EngineMessage; kind: 'supplement' | 'retarget' | 'system' }
  | { type: 'usage'; sid: string; model: string; usage: EngineUsage }
  | { type: 'context'; sid: string; used: number; limit: number }
  | { type: 'restore'; sid: string; messages: EngineMessage[]; agent?: string; activeAgents: string[]; model: string }
  | { type: 'ui'; sid: string; workDir?: string; theme?: string }
  | { type: 'plan'; sid: string; summary: string; steps: PlanStep[] }
  | { type: 'plan-update'; sid: string; summary?: string; steps: PlanStep[] }
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
