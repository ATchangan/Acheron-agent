export {}

declare global {
  interface Window {
    huangquan: HuangquanAPI
  }
}

interface HuangquanAPI {
  window: WindowAPI
  settings: SettingsAPI
  sessions: SessionsAPI
  ishiki: { load: () => Promise<string> }
  skills: SkillsAPI
  memory: MemoryAPI
  computer: ComputerAPI
  web: WebAPI
  llm: LLMAPI
  models: { detect: (baseUrl: string, apiKey: string) => Promise<string[]> }
}

interface WindowAPI {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
}

interface SettingsAPI {
  load: () => Promise<SettingsData>
  save: (s: SettingsData) => Promise<boolean>
}
interface SessionsAPI {
  list: () => Promise<SessionMeta[]>
  load: (id: string) => Promise<SessionData>
  save: (s: SessionData) => Promise<boolean>
  delete: (id: string) => Promise<boolean>
}
interface SkillsAPI {
  list: () => Promise<SkillMeta[]>
  load: (path: string) => Promise<string>
}
interface MemoryAPI {
  load: () => Promise<MemoryData>
  save: (m: MemoryData) => Promise<boolean>
}
interface ComputerAPI {
  exec: (cmd: string) => Promise<string>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<boolean>
  readDir: (path: string) => Promise<FileItem[]>
  systemInfo: () => Promise<SystemInfo>
  openFile: (path: string) => Promise<boolean>
  selectFile: () => Promise<string | null>
  readImageBase64: (path: string) => Promise<string>
  grep: (dir: string, pattern: string) => Promise<string>
  find: (dir: string, glob: string) => Promise<string>
  screenshot: () => Promise<string>
}
interface WebAPI {
  fetch: (url: string) => Promise<string>
  search: (query: string) => Promise<string>
}
interface LLMAPI {
  chat: (params: LLMChatParams) => Promise<void>
  abort: () => Promise<boolean>
  onChunk: (cb: (d: ChunkData) => void) => () => void
  onError: (cb: (e: string) => void) => () => void
  onToolCall: (cb: (tc: ToolCallDelta) => void) => () => void
  onToolCallDone: (cb: (d: { finish_reason: string }) => void) => () => void
}

/* ─── 数据类型 ────────────────────────────────────── */
export interface SettingsData { providers: ProviderConfig[]; general: { theme: string } }
export interface ProviderConfig { id: string; name: string; type: string; apiKey: string; baseUrl?: string; models: string[]; selectedModel?: string }
export interface SessionMeta { id: string; title: string; messageCount: number; updatedAt: string }
export interface SessionData { id: string; title: string; messages: Message[]; updatedAt?: string }
export interface Message { id: string; role: 'user' | 'assistant' | 'system' | 'tool'; content: string; timestamp: number; images?: string[] }
export interface SkillMeta { name: string; path: string; description: string }
export interface MemoryData { facts: string[]; summaries: { content: string; timestamp: number }[] }
export interface FileItem { name: string; isDirectory: boolean; size: number }
export interface SystemInfo { platform: string; arch: string; hostname: string; cpus: number; totalMemory: number; freeMemory: number; uptime: number; homeDir: string; workspaceDir: string }
export interface ChunkData { content: string; done: boolean }
export interface LLMChatParams {
  provider: string; model: string; apiKey: string; baseUrl?: string
  messages: LLMMessage[]
  temperature?: number; tools?: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[]
}
export interface LLMMessage {
  role: string
  content?: string | null | { type: string; text?: string; image_url?: { url: string } }[]
  tool_call_id?: string
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]
}
export interface ToolCallDelta { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }
