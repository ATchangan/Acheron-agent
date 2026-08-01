export {}

declare global {
  interface Window {
    huangquan: {
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        setOpacity: (opacity: number) => Promise<void>
      }
      settings: {
        load: () => Promise<SettingsData>
        save: (data: SettingsData) => Promise<boolean>
        reset: () => Promise<boolean>
      },
      sessions: {
        list: () => Promise<any[]>
        load: (id: string) => Promise<any>
        save: (s: unknown) => Promise<boolean>
        delete: (id: string) => Promise<boolean>
        clearAll: () => Promise<boolean>
        export: (format: string, workDir?: string) => Promise<string>
      },
      ishiki: { load: () => Promise<string> }
      skills: {
        list: () => Promise<SkillMeta[]>
        load: (path: string) => Promise<string>
        create: (name: string, content: string) => Promise<boolean | string>
        install: (url: string) => Promise<string>
        delete: (name: string) => Promise<boolean | string>
      }
      memory: {
        load: () => Promise<MemoryData>
        save: (m: MemoryData) => Promise<boolean>
        search: (query: string) => Promise<SearchResult[]>
        addVector: (content: string) => Promise<boolean>
        importFile: (path: string) => Promise<boolean>
        clearVector: () => Promise<boolean>
      }
      cron: {
        add: (expr: string, prompt: string) => Promise<any>
        list: () => Promise<CronJob[]>
        remove: (id: string) => Promise<any>
        toggle: (id: string) => Promise<any>
      }
      plugins: {
        scan: () => Promise<any>
        tools: () => Promise<any>
        install: (url: string) => Promise<string>
        delete: (name: string) => Promise<boolean | string>
      }
      mcpSSEConnect: (name: string, url: string, headers?: Record<string, string>) => Promise<any>
      mcpSSECall: (server: string, tool: string, args: any) => Promise<any>
      mcpSSEList: () => Promise<any[]>
      mediaDescribe: (opts?: { local?: boolean; localUrl?: string }) => Promise<string>
      getPaths: () => Promise<{ skillsDir: string; pluginsDir: string; workDir: string }>
      computer: {
        exec: (cmd: string) => Promise<string>
        readFile: (path: string, offset?: number, limit?: number) => Promise<string>
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
    clipboardRead: () => Promise<string>
    clipboardWrite: (text: string) => Promise<boolean>
    processList: () => Promise<string>
    killProcess: (pid: string) => Promise<string>
    codebox: (lang: string, code: string) => Promise<string>
    invalidateCache: () => Promise<boolean>
      }
      web: {
        fetch: (url: string) => Promise<string>
        search: (query: string) => Promise<string>
        browse: (url: string) => Promise<string>
        browseScreenshot: (url: string) => Promise<string>
      }
      models: {
        detect: (baseUrl: string, apiKey: string) => Promise<string[]>
      }
      llm: {
        chat: (params: LLMChatParams) => Promise<void>
        chatOnce: (params: { provider: string; model: string; apiKey: string; baseUrl?: string; messages: { role: string; content: string }[] }) => Promise<string>
        vision: (params: { provider: string; model: string; apiKey: string; baseUrl?: string; imageDataUrl: string; prompt?: string }) => Promise<string>
        abort: () => Promise<boolean>
        onChunk: (callback: (data: ChunkData) => void) => () => void
        onError: (callback: (error: string) => void) => () => void
        onToolCall: (callback: (tc: ToolCallDelta) => void) => () => void
        onToolCallDone: (callback: (data: { finish_reason: string }) => void) => () => void
        onUsage: (callback: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void) => () => void
      }
    }
  }
}

export interface SettingsData { providers: ProviderConfig[]; mediaProviders?: MediaProvider[]; general: GeneralSettings }
// v0.2.1: 多媒体供应商（图片生成/视频生成/语音识别）
export interface MediaProvider {
  id: string
  name: string
  apiKey?: string
  baseUrl?: string
  type: string            // image | video | audio | multi
  imgModels: string[]     // 图片生成模型
  videoModels: string[]   // 视频生成模型
  audioModels: string[]   // 语音识别/合成模型
  selectedImg?: string
  selectedVideo?: string
  selectedAudio?: string
}
export interface GeneralSettings {
  theme: string
  language?: string
  mode?: string
  workDir?: string
  opacity?: number
  animation?: boolean
  customColors?: { bg?: string; surface?: string; card?: string; accent?: string; text?: string; border?: string }
  chatPersona?: string
  workPersona?: string
  bgImage?: string
  bgOpacity?: number
  skinColors?: { r: number; g: number; b: number }
  agentAvatar?: string
  agentAvatarImage?: string
  // v0.2.1 新增配置项
  notifyEnabled?: boolean; episodicMemory?: boolean; meltdownLimit?: number
  compactThreshold?: number; maxToolRounds?: number; retryCount?: number
  parallelTools?: boolean; toolTimeout?: number; cardMaxHeight?: number
  singleBubble?: boolean; disabledTools?: string[]
  autoSave?: boolean; maxSessions?: number
  temperature?: number; maxTokens?: number
  filePermission?: string; logLevel?: string; devTools?: boolean
  ragChunkSize?: number; ragThreshold?: number; ragAutoSave?: boolean
  ttsEnabled?: boolean; asrEnabled?: boolean; ttsRate?: number
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
  smallModel?: string
  largeModel?: string
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
  busy?: boolean // v0.2.3: 该会话是否正在工作中（独立于其他会话）
}
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  images?: string[]
  // v0.2.2: 拖拽/上传的附件（视频/音频/文档等非图片文件）
  attachments?: { name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[]
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  // v0.2.2: 回复性能指标 —— ttft 首字延迟(ms)、duration 总时长(ms)
  meta?: { ttft?: number; duration?: number }
  _toolLog?: { name: string; args: any; result: string; error: boolean; ms: number }[]
}
export interface SkillMeta { name: string; path: string; description: string }
export interface MemoryData { facts: string[]; summaries: { content: string; timestamp: number }[]; pinnedFacts?: string[] }
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
  headers?: string | Record<string, string>
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
export interface SearchResult { content: string; score: number }
export interface CronJob { id: string; expression: string; prompt: string; enabled: boolean; lastRun?: string; nextRun?: string }