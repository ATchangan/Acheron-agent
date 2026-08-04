export {}
import type { GeneralSettings } from './types'
import type { SettingsData, SessionMeta, SessionData, SkillMeta, MemoryData, FileItem, SystemInfo, ChunkData, UsageData, VisionContent, LLMChatParams, LLMMessage, ToolDef, ToolCallDelta, SearchResult, CronJob, MediaProvider, ProviderConfig, Message } from './types/domain'

declare global {
  interface Window {
    // v0.3.0 M5: 运行时调试属性(原 window 断言逃逸, 集中声明)
    __lastSp?: string
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
      appInfo: () => Promise<{ version: string; electron: string; node: string }>
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

export * from './types/domain'
