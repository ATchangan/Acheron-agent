export {}
import type { GeneralSettings } from './types'

declare global {
  interface Window {
    // v0.3.0 M5: 运行时调试属性(原 window 断言逃逸, 集中声明)
    __lastSp?: string
    __lastModel?: string
    __routeDebug?: string
    __huangquan_agent?: string
    __huangquan_agent_manual?: boolean
    __watchState?: Record<string, string>
    huangquan: {
      getPathForFile: (f: File) => string
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        setOpacity: (opacity: number) => Promise<void>
      }
      settings: {
        load: () => Promise<SettingsData>
        save: (data: unknown) => Promise<boolean>
        reset: () => Promise<boolean>
      },
      sessions: {
        list: () => Promise<SessionMeta[]>
        load: (id: string) => Promise<SessionData>
        save: (s: unknown) => Promise<boolean>
        delete: (id: string) => Promise<boolean>
        audit: () => Promise<string[]>
        clearAll: () => Promise<boolean>
        export: (format: string, workDir?: string) => Promise<string>
      },
      ishiki: { load: () => Promise<string> }
      skills: {
        list: () => Promise<SkillMeta[]>
        load: (path: string) => Promise<string>
        create: (name: string, content: string) => Promise<boolean | string>
        install: (url: string) => Promise<string>
        installLocal: (src: string) => Promise<string>
        pickLocal: () => Promise<string | null>
        delete: (name: string) => Promise<boolean | string>
      }
      memory: {
        load: () => Promise<MemoryData>
        save: (m: MemoryData | Record<string, unknown>) => Promise<boolean>
        search: (query: string) => Promise<SearchResult[]>
        addVector: (content: string) => Promise<boolean>
        importFile: (path: string) => Promise<boolean>
        clearVector: () => Promise<boolean>
      }
      cron: {
        add: (expr: string, prompt: string) => Promise<{ ok: boolean; error?: string; id?: string }>
        list: () => Promise<CronJob[]>
        remove: (id: string) => Promise<{ ok: boolean; error?: string }>
        toggle: (id: string) => Promise<{ ok: boolean; error?: string }>
      }
      plugins: {
        scan: () => Promise<{ name: string; version: string; description?: string; hasImpl?: boolean }[]>
        tools: () => Promise<{ plugin: string; name: string; description: string; params: Record<string, string> }[]>
        install: (url: string) => Promise<string>
        delete: (name: string) => Promise<boolean | string>
        exec: (plugin: string, tool: string, args: Record<string, unknown>) => Promise<string>
      }
      mcpConnect: (name: string, cmd: string, args: string[]) => Promise<{ ok: boolean; error?: string }>
      mcpCall: (server: string, tool: string, a: Record<string, unknown>) => Promise<unknown>
      mcpList: () => Promise<{ name: string; cmd?: string; args?: string[]; tools?: string[] }[]>
      mcpSSEConnect: (name: string, url: string, headers?: Record<string, string>) => Promise<{ ok: boolean; error?: string }>
      mcpSSECall: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
      mcpSSEList: () => Promise<{ name: string; tools?: string[] }[]>
      mediaDescribe: (opts?: { local?: boolean; localUrl?: string }) => Promise<string>
      mediaGen: (opts: { kind: 'img' | 'video'; prompt: string; providerId?: string; model?: string; ratio?: string; duration?: number }) => Promise<{ ok: boolean; path?: string; error?: string }>
      tts: {
        speak: (text: string, rate?: number) => Promise<boolean>
      }
      getPaths: () => Promise<{ skillsDir: string; pluginsDir: string; workDir: string }>
      update: {
        check: () => Promise<{ ok: boolean; error?: string; version?: string; hasUpdate?: boolean; url?: string; assets?: { name: string; size: number; url: string }[]; notes?: string; current?: string }>,
        download: (url: string, fileName: string) => Promise<{ ok: boolean; error?: string; path?: string }>
        onProgress: (cb: (d: { received: number; total: number }) => void) => () => void
      }
      computer: {
        exec: (cmd: string) => Promise<string>
        readFile: (path: string, offset?: number, limit?: number) => Promise<string>
        stat: (p: string) => Promise<{ size: number; isDirectory: boolean; modifiedAt: number }>
        sysPerf: () => Promise<{ cpuPct: number; memPct: number; memUsed: number; memTotal: number; gpuPct: number; gpuName: string; cpus: number }>
        setWorkDir: (dir: string) => Promise<boolean>
        writeFile: (path: string, content: string) => Promise<boolean>
        readDir: (path: string) => Promise<FileItem[]>
        mkdir: (path: string) => Promise<{ ok: boolean; error?: string }>
        remove: (path: string) => Promise<{ ok: boolean; error?: string }>
        rename: (oldPath: string, newName: string) => Promise<{ ok: boolean; error?: string }>
        createFile: (filePath: string, content?: string) => Promise<{ ok: boolean; error?: string }>
        contextMenu: (opts: { path: string; isDir: boolean; isWorkDir?: boolean }) => Promise<string>
        systemInfo: () => Promise<SystemInfo>
        openFile: (path: string) => Promise<boolean>
        selectFile: () => Promise<string | null>
        selectDir: () => Promise<string | null>
        readImageBase64: (path: string) => Promise<string>
      readFileAsDataUrl: (path: string) => Promise<string>
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
        read: (url: string, mode?: string) => Promise<string>
        browse: (url: string) => Promise<string>
        browseScreenshot: (url: string) => Promise<string>
        navigate: (url: string) => Promise<unknown>
        back: () => Promise<unknown>
        forward: () => Promise<unknown>
        reload: () => Promise<unknown>
        current: () => Promise<unknown>
        snapshot: () => Promise<{ url?: string; img?: string; title?: string; loading?: boolean } | null>
        showPanel: () => Promise<unknown>
        showFloat: () => Promise<unknown>
        hideFloat: () => Promise<unknown>
        debug: () => Promise<unknown>
        rendererStatus: () => Promise<{ mode: string; gpuAcceleration: string; webgl: string; canvas2d: string }>
        onFloat: (cb: (d: { show: boolean }) => void) => () => void
      }
      models: {
        detect: (baseUrl: string, apiKey?: string, opts?: { anthropic?: boolean; type?: string }) => Promise<{ ok: boolean; models?: string[]; error?: string }>
        test: (baseUrl: string, apiKey?: string, opts?: { anthropic?: boolean }) => Promise<{ ok: boolean; error?: string; message?: string; latency?: number }>
      }
      cacheStats: () => Promise<{ hits: number; misses: number; hit_rate?: string }>
      modelStats: {
        recordRequest: (sid: string, model: string, hit: boolean) => Promise<unknown>
        recordTokens: (sid: string, model: string, hitT: number, missT: number, writeT: number, missTok?: number) => Promise<unknown>
        deleteSession: (sid: string) => Promise<unknown>
        get: () => Promise<{ models?: Record<string, { requests: number; readTokens: number; inputTokens: number; writeTokens: number; hitReqs: number; observedReqs: number; missTokens?: number }> }>
        getSession: (sid: string) => Promise<unknown>
        resetAll: () => Promise<unknown>
        resetOne: (model: string) => Promise<unknown>
      }
      cacheClear: () => Promise<boolean>
      storageStats: () => Promise<Record<string, unknown>>
      llm: {
        chat: (params: LLMChatParams) => Promise<void>
        chatOnce: (params: { provider: string; model: string; apiKey: string; baseUrl?: string; messages: { role: string; content: string }[] }) => Promise<string>
        vision: (params: { provider: string; model: string; apiKey: string; baseUrl?: string; imageDataUrl: string; prompt?: string }) => Promise<string>
        abort: (requestId?: string) => Promise<boolean>
        onChunk: (callback: (data: ChunkData) => void) => () => void
        onError: (callback: (error: string) => void) => () => void
        onToolCall: (callback: (tc: ToolCallDelta) => void) => () => void
        onToolCallDone: (callback: (data: { finish_reason: string }) => void) => () => void
        onUsage: (callback: (usage: UsageData) => void) => () => void
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
  busy?: boolean // v0.2.3: 该会话是否正在工作中（独立于其他会话）
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
  // v0.2.2: 拖拽/上传的附件（视频/音频/文档等非图片文件）
  attachments?: { name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[]
  // v0.2.3: 工具调用声明(工具卡片渲染用)与工具名(结果块关联用)
  tool_calls?: { id?: string; type: string; function: { name: string; arguments: string } }[]
  toolName?: string
  usage?: UsageData
  // v0.2.2: 回复性能指标 —— ttft 首字延迟(ms)、duration 总时长(ms)
  meta?: { ttft?: number; duration?: number; taskTokens?: number }
  _toolLog?: { name: string; args: Record<string, unknown>; result: string; error: boolean; ms: number }[]
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
  // v0.2.6: 前端镜像统计字段(不入盘)
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
