export {}

declare global {
  interface Window {
    huangquan: {
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
      }
      settings: {
        load: () => Promise<SettingsData>
        save: (settings: SettingsData) => Promise<boolean>
      }
      sessions: {
        list: () => Promise<SessionMeta[]>
        load: (id: string) => Promise<SessionData>
        save: (session: SessionData) => Promise<boolean>
        delete: (id: string) => Promise<boolean>
      }
      ishiki: { load: () => Promise<string> }
      skills: {
        list: () => Promise<SkillMeta[]>
        load: (path: string) => Promise<string>
      }
      memory: {
        load: () => Promise<MemoryData>
        save: (m: MemoryData) => Promise<boolean>
      }
      computer: {
        exec: (cmd: string) => Promise<string>
        readFile: (path: string) => Promise<string>
        writeFile: (path: string, content: string) => Promise<boolean>
        readDir: (path: string) => Promise<FileItem[]>
        systemInfo: () => Promise<SystemInfo>
        openFile: (path: string) => Promise<boolean>
        selectFile: () => Promise<string | null>
        selectDir: () => Promise<string | null>
        readImageBase64: (path: string) => Promise<string>
        grep: (dir: string, pattern: string) => Promise<string>
        find: (dir: string, glob: string) => Promise<string>
        screenshot: () => Promise<string>
      }
      web: {
        fetch: (url: string) => Promise<string>
        search: (query: string) => Promise<string>
      }
      models: {
        detect: (baseUrl: string, apiKey: string) => Promise<string[]>
      }
      llm: {
        chat: (params: LLMChatParams) => Promise<void>
        abort: () => Promise<boolean>
        onChunk: (callback: (data: ChunkData) => void) => () => void
        onError: (callback: (error: string) => void) => () => void
        onToolCall: (callback: (tc: ToolCallDelta) => void) => () => void
        onToolCallDone: (callback: (data: { finish_reason: string }) => void) => () => void
      }
    }
  }
}

export interface SettingsData { providers: ProviderConfig[]; general: { theme: string; language?: string; mode?: string } }
export interface ProviderConfig {
  id: string
  name: string
  type: string
  apiKey: string
  baseUrl?: string
  models: string[]
  selectedModel?: string
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
}
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  images?: string[]
}
export interface SkillMeta { name: string; path: string; description: string }
export interface MemoryData { facts: string[]; summaries: { content: string; timestamp: number }[] }
export interface FileItem { name: string; isDirectory: boolean; size: number }
export interface SystemInfo {
  platform: string; arch: string; hostname: string
  cpus: number; totalMemory: number; freeMemory: number
  uptime: number; homeDir: string; workspaceDir: string
}
export interface ChunkData { content: string; done: boolean }
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
}
export interface LLMMessage {
  role: string
  content?: string | null | VisionContent[]
  tool_call_id?: string
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]
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
}
