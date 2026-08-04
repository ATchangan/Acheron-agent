// src/types/domain.ts —— 领域类型(v0.3.1 补丁 G1: 从 global.d.ts 拆分)
import type { GeneralSettings } from '../types'

export interface SettingsData { providers: ProviderConfig[]; mediaProviders?: MediaProvider[]; general: GeneralSettings }
// 多媒体供应商（图片生成/视频生成/语音识别）
export interface MediaProvider {
  id: string
  name: string
  apiKey?: string
  baseUrl?: string
  headers?: string
  type: string            // API 类型(OpenAI Compatible 等)
  imgModels: string[]     // 图片生成模型
  videoModels: string[]   // 视频生成模型
  audioModels: string[]   // 语音识别/合成模型
  selectedImg?: string
  selectedVideo?: string
  selectedAudio?: string
}
export interface ProviderConfig {
  id: string
  name: string
  type: string
  apiKey: string
  baseUrl?: string
  models: string[]
  selectedModel?: string
  headers?: string
}
export interface SessionMeta {
  id: string
  title: string
  messageCount: number
  updatedAt: string
}
export interface SessionData {
  id: string
  title: string
  messages: Message[]
  updatedAt?: string
  mode?: string
  busy?: boolean // 该会话是否正在工作中（独立于其他会话）
  // v0.3.1 会话修复: 会话级并发状态（FIX-1/2/8/16, 取代全局 window.__huangquan_agent / 全局 streaming / 全局 taskGen）
  agent?: string          // 当前 Agent（路由/handoff 写入, 会话隔离）
  agentManual?: boolean   // 用户手动选择（手动模式下不自动路由覆盖）
  activeAgents?: string[] // 协作链记录（会话隔离）
  streaming?: boolean     // 会话级流式状态（与 busy 对称）
  resumeTimer?: number    // 自动续跑 setTimeout 句柄（stop/新任务时 clearTimeout）
}
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
  timestamp: number
  tool_call_id?: string
  reasoning_content?: string
  images?: string[]
  // 拖拽/上传的附件（视频/音频/文档等非图片文件）
  attachments?: { name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[]
  // 工具调用声明(工具卡片渲染用)与工具名(结果块关联用)
  tool_calls?: { id?: string; type: string; function: { name: string; arguments: string } }[]
  toolName?: string
  usage?: UsageData
  // 回复性能指标 —— ttft 首字延迟(ms)、duration 总时长(ms)
  meta?: { ttft?: number; duration?: number; taskTokens?: number }
  _toolLog?: { name: string; args: Record<string, unknown>; result: string; error: boolean; ms: number }[]
  // v0.3.1 插话序列修复: 插话消息标记 —— 构建上下文时重排到末尾, 保证 assistant(tool_calls)→tool 配对连续性
  _inject?: boolean
}
// v0.3.0 M1: 用量数据结构(含 DeepSeek 缓存口径字段)
export interface UsageData {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  input_tokens?: number
  requestId?: string
  // 前端镜像统计字段(不入盘)
  _readTokens?: number
  _inputTokens?: number
  _writeTokens?: number
}
export interface SkillMeta { name: string; path: string; description: string }
export interface MemoryData { facts: string[]; summaries: { content: string; timestamp: number }[]; pinnedFacts?: string[]; episodic?: { op: string; path: string; status: string; ts: number }[]; goals?: { goal: string; status: string; steps?: unknown[]; created?: number }[]; plugins?: Record<string, { enabled: boolean; category: string }> }
export interface FileItem { name: string; isDirectory: boolean; size: number }
export interface SystemInfo {
  platform: string; arch: string; hostname: string
  cpus: number; totalMemory: number; freeMemory: number
  uptime: number; homeDir: string; workspaceDir: string
}
export interface ChunkData { content: string; done: boolean; requestId?: string }
export interface VisionContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}
export interface LLMChatParams {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  messages: LLMMessage[]
  temperature?: number
  tools?: ToolDef[]
  headers?: string | Record<string, string>
  requestId?: string
  max_tokens?: number
  sid?: string // v0.3.1 C3: 会话级中止过滤
}
export interface LLMMessage {
  role: string
  content?: string | null | VisionContent[]
  tool_call_id?: string
  tool_calls?: { id?: string; type: string; function: { name: string; arguments: string } }[]
  reasoning_content?: string
}
export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}
export interface ToolCallDelta {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
  requestId?: string
}
export interface SearchResult { content: string; score: number }
export interface CronJob { id: string; expression: string; prompt: string; enabled: boolean; lastRun?: string; nextRun?: string }
