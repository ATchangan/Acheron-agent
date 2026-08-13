export {}
import type { SettingsData, SessionMeta, SessionData, SkillMeta, MemoryData, FileItem, SystemInfo, ChunkData, UsageData, LLMChatParams, ToolCallDelta, SearchResult, CronJob, McpServerInfo, TaskRecord, TraceEntry } from './types/domain'

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
        show: () => Promise<boolean>
        maximize: () => Promise<void>
        close: () => Promise<void>
        setOpacity: (opacity: number) => Promise<void>
        setTitleBarOverlay: (opts: { color?: string; symbolColor?: string; height?: number }) => Promise<boolean>
      }
      risk: {
        respond: (requestId: string, decision: 'allow' | 'deny', approveTask: boolean, taskKey?: string, always?: boolean) => Promise<boolean>
        onConfirm: (cb: (d: RiskConfirmPayload) => void) => () => void
      }
      settings: {
        load: () => Promise<SettingsData>
        save: (data: unknown) => Promise<boolean>
        reset: () => Promise<boolean>
      },
      pet: {
        toggle: (enable: boolean) => Promise<boolean>
        setForm: (form: 'normal' | 'ultimate') => Promise<'normal' | 'ultimate'>
        setAction: (action: 'idle' | 'dance1' | 'dance2' | 'dance3') => Promise<'idle' | 'dance1' | 'dance2' | 'dance3'>
        setAnchor: (anchor: 'float' | 'window' | 'taskbar') => Promise<'float' | 'window' | 'taskbar'>
        resetPos: () => Promise<boolean>
        onChat: (cb: (content: string) => void) => () => void
      }
      sessions: {
        list: () => Promise<SessionMeta[]>
        load: (id: string) => Promise<SessionData>
        save: (s: unknown) => Promise<boolean>
        delete: (id: string) => Promise<boolean>
        audit: () => Promise<string[]>
        clearAll: () => Promise<boolean>
        export: (format: string, workDir?: string) => Promise<string>
        search: (query: string, limit?: number) => Promise<{ sid: string; title: string; role: string; snippet: string; ts: number }[]>
      },
      backup: {
        create: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
        restore: () => Promise<{ ok: boolean; canceled?: boolean; error?: string }>
      },
      rollback: {
        apply: (taskId: string) => Promise<{ ok: boolean; restored?: number; error?: string }>
      },
      diagnostics: {
        check: () => Promise<{ name: string; status: 'ok' | 'warn' | 'fail'; detail: string; fix?: string }[]>
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
      mcpList: () => Promise<McpServerInfo[]>
      mcpSSEConnect: (name: string, url: string, headers?: Record<string, string>) => Promise<{ ok: boolean; error?: string }>
      mcpSSECall: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
      mcpSSEList: () => Promise<McpServerInfo[]>
      mcpConfirm: (info: { server: string; tool: string; args: Record<string, unknown> }) => Promise<boolean>
      tasks: {
        list: () => Promise<TaskRecord[]>
        start: (t: Partial<TaskRecord> & { id: string; sid: string; content: string }) => Promise<boolean>
        update: (id: string, patch: Partial<TaskRecord>) => Promise<boolean>
        finish: (id: string, status: TaskRecord['status'], error?: string) => Promise<boolean>
        clear: (id?: string) => Promise<boolean>
      }
      trace: {
        log: (entry: TraceEntry) => Promise<boolean>
        list: (limit?: number) => Promise<TraceEntry[]>
        clear: () => Promise<boolean>
        export: () => Promise<{ ok: boolean; path?: string; summaryPath?: string; error?: string; entries?: number }>
      }
      engine: {
        start: (p: { sid: string; taskId: string; content: string; images?: string[]; attachments?: { name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[]; history?: unknown[]; userMsgId: string; userMsgTimestamp: number; resumeTaskId?: string; agent?: string; agentManual?: boolean }) => Promise<boolean>
        stop: (sid: string) => Promise<boolean>
        interject: (sid: string, content: string, images?: string[], attachments?: { name: string; path: string; size: number; kind: 'video' | 'audio' | 'file' }[], kind?: string, prefix?: string) => Promise<boolean>
        approve: (sid: string) => Promise<boolean>
        reject: (sid: string) => Promise<boolean>
        resume: (taskId: string) => Promise<boolean>
        subscribe: () => Promise<boolean>
        onEvent: (cb: (ev: unknown) => void) => () => void
      }
      mediaDescribe: (opts?: { local?: boolean; localUrl?: string }) => Promise<string>
      mediaGen: (opts: { kind: 'img' | 'video'; prompt: string; providerId?: string; model?: string; ratio?: string; duration?: number }) => Promise<{ ok: boolean; path?: string; error?: string }>
      tts: {
        speak: (text: string, rate?: number) => Promise<boolean>
      }
      getPaths: () => Promise<{ skillsDir: string; pluginsDir: string; workDir: string }>
      update: {
        check: () => Promise<{ ok: boolean; error?: string; version?: string; hasUpdate?: boolean; url?: string; assets?: { name: string; size: number; url: string }[]; notes?: string; current?: string }>,
        download: (url: string, fileName: string) => Promise<{ ok: boolean; error?: string; path?: string }>
        onProgress: (cb: (d: { received: number; total: number; ts: number }) => void) => () => void
      }
      appInfo: () => Promise<{ version: string; electron: string; node: string }>
      projectContext: () => Promise<{ file: string; content: string; path: string }>
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
        browseSnapshot: (url?: string) => Promise<string>
        browserClick: (ref: string) => Promise<string>
        browserType: (ref: string, text: string) => Promise<string>
        browserPress: (key: string) => Promise<string>
        browserScroll: (direction: string) => Promise<string>
        closeBrowserSession: (sid: string, taskId: string) => Promise<boolean>
        openExternal: (url: string) => Promise<string>
        navigate: (url: string) => Promise<unknown>
        back: () => Promise<unknown>
        forward: () => Promise<unknown>
        reload: () => Promise<unknown>
        current: () => Promise<unknown>
        snapshot: () => Promise<{ url?: string; img?: string; title?: string; loading?: boolean } | null>
        viewLayout: (b: { x: number; y: number; width: number; height: number }) => Promise<unknown>
        viewShow: (key?: string) => Promise<unknown>
        viewHide: () => Promise<unknown>
        showPanel: () => Promise<unknown>
        showFloat: () => Promise<unknown>
        hideFloat: () => Promise<unknown>
        debug: () => Promise<unknown>
        rendererStatus: () => Promise<{ mode: string; gpuAcceleration: string; webgl: string; canvas2d: string }>
        onFloat: (cb: (d: { show: boolean }) => void) => () => void
        onEmbed: (cb: (d: { show: boolean }) => void) => () => void
      }
      models: {
        detect: (baseUrl: string, apiKey?: string, opts?: { anthropic?: boolean; type?: string }) => Promise<{ ok: boolean; models?: string[]; error?: string }>
        test: (baseUrl: string, apiKey?: string, opts?: { anthropic?: boolean }) => Promise<{ ok: boolean; error?: string; message?: string; latency?: number }>
      }
      cacheStats: () => Promise<{ hits: number; misses: number; hit_rate?: string }>
      modelStats: {
        recordRequest: (sid: string, model: string, hit: boolean, supported?: boolean) => Promise<unknown>
        recordTokens: (sid: string, model: string, readT: number, inputT: number, writeT: number, missT?: number, opts?: { supported?: boolean | null; provider?: string }) => Promise<unknown>
        deleteSession: (sid: string) => Promise<unknown>
        get: () => Promise<{
          models?: Record<string, { requests: number; readTokens: number; inputTokens: number; writeTokens: number; hitReqs: number; observedReqs: number; missTokens?: number; cacheSupported?: boolean | null; providerName?: string }>
          ledger?: { ts: number; sid: string; model: string; provider?: string; readTokens: number; missTokens: number; writeTokens: number; inputTokens: number; outputTokens: number; hit: boolean; supported: boolean | null; status: string }[]
        }>
        getSession: (sid: string) => Promise<unknown>
        resetAll: () => Promise<unknown>
        resetOne: (model: string) => Promise<unknown>
      }
      cacheClear: () => Promise<boolean>
      cacheCleanChromium: () => Promise<{ freedMb: number; totalMb: number }>
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

  interface RiskConfirmPayload {
    requestId: string
    kind: string
    detail: string
    level: string
    sid?: string
    taskId?: string
    taskKey?: string
    expiresAt: number
  }
}

export * from './types/domain'
