import { contextBridge, ipcRenderer, webUtils } from 'electron'

// ─── v0.2.1: 安全参数清洗——消除 Proxy、循环引用等不可序列化对象导致的 IPC 报错 ──
function safeArg(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  // 始终通过 JSON 往返消除 Proxy 包装器
  try { return JSON.parse(JSON.stringify(obj)) } catch {
    // 慢速路径：手动深拷贝，跳过不可序列化属性
    const seen = new WeakSet()
    const clone = (o: unknown): unknown => {
      if (o === null || typeof o !== 'object') return o
      if (typeof o === 'object' && o !== null && seen.has(o)) return '[Circular]'
      seen.add(o)
      if (Array.isArray(o)) return o.map(clone)
      const r: Record<string, unknown> = {}
      for (const k of Object.keys(o as Record<string, unknown>)) {
        try {
          const v = (o as Record<string, unknown>)[k]
          const t = typeof v
          if (t === 'function' || t === 'symbol') continue
          r[k] = clone(v)
        } catch (e) { /* skip */ console.debug('[swallow]', e) }
      }
      return r
    }
    return clone(obj)
  }
}

contextBridge.exposeInMainWorld('huangquan', {
  // Electron 32 移除了 File.path，必须用 webUtils.getPathForFile 获取真实路径
  getPathForFile: (f: File) => webUtils.getPathForFile(f),
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    setOpacity: (o: number) => ipcRenderer.invoke('window:setOpacity', o),
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (s: unknown) => ipcRenderer.invoke('settings:save', safeArg(s)),
    reset: () => ipcRenderer.invoke('settings:reset'),
  },
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    load: (id: string) => ipcRenderer.invoke('sessions:load', id),
    save: (s: unknown) => ipcRenderer.invoke('sessions:save', safeArg(s)),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    audit: () => ipcRenderer.invoke('sessions:audit'),
    clearAll: () => ipcRenderer.invoke('sessions:clearAll'),
    export: (format: string, workDir?: string) => ipcRenderer.invoke('sessions:export', format, workDir),
  },
  ishiki: { load: () => ipcRenderer.invoke('ishiki:load') },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    load: (path: string) => ipcRenderer.invoke('skills:load', path),
    create: (name: string, content: string) => ipcRenderer.invoke('skills:create', name, content),
    install: (url: string) => ipcRenderer.invoke('skills:install', url),
    installLocal: (src: string) => ipcRenderer.invoke('skills:installLocal', src),
    pickLocal: () => ipcRenderer.invoke('skills:pickLocal'),
    delete: (name: string) => ipcRenderer.invoke('skills:delete', name),
  },
  memory: {
    load: () => ipcRenderer.invoke('memory:load'),
    save: (m: unknown) => ipcRenderer.invoke('memory:save', safeArg(m)),
    search: (query: string) => ipcRenderer.invoke('memory:search', query),
    addVector: (content: string) => ipcRenderer.invoke('memory:addVector', content),
    importFile: (path: string) => ipcRenderer.invoke('memory:importFile', path),
    clearVector: () => ipcRenderer.invoke('memory:clearVector'),
  },
  cron: {
    add: (expr: string, prompt: string) => ipcRenderer.invoke('cron:add', expr, prompt),
    list: () => ipcRenderer.invoke('cron:list'),
    remove: (id: string) => ipcRenderer.invoke('cron:remove', id),
    toggle: (id: string) => ipcRenderer.invoke('cron:toggle', id),
  },
  plugins: {
    scan: () => ipcRenderer.invoke('plugins:scan'),
    tools: () => ipcRenderer.invoke('plugins:tools'),
    install: (url: string) => ipcRenderer.invoke('plugins:install', url),
    delete: (name: string) => ipcRenderer.invoke('plugins:delete', name),
    // v0.3.0 M4: 插件工具执行(vm 沙箱)
    exec: (plugin: string, tool: string, args: Record<string, unknown>) => ipcRenderer.invoke('plugins:exec', { plugin, tool, args }),
  },
  mcpConnect: (name: string, cmd: string, args: string[]) => ipcRenderer.invoke('mcp:connect', name, cmd, args),
  mcpCall: (server: string, tool: string, a: Record<string, unknown>) => ipcRenderer.invoke('mcp:call', server, tool, a),
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpSSEConnect: (name: string, url: string, headers?: Record<string,string>) => ipcRenderer.invoke('mcp:sse:connect', name, url, headers),
  mcpSSECall: (server: string, tool: string, args: Record<string, unknown>) => ipcRenderer.invoke('mcp:sse:call', server, tool, args),
  mcpSSEList: () => ipcRenderer.invoke('mcp:sse:list'),
  mediaDescribe: (opts?: { local?: boolean; localUrl?: string }) => ipcRenderer.invoke('media:describe', opts),
    mediaGen: (opts: { kind: 'img' | 'video'; prompt: string; providerId?: string; model?: string; ratio?: string; duration?: number }) => ipcRenderer.invoke('media:gen', opts),
  tts: { speak: (text: string, rate?: number) => ipcRenderer.invoke('tts:speak', text, rate) },
  getPaths: () => ipcRenderer.invoke('get:paths'),
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: (url: string, fileName: string) => ipcRenderer.invoke('update:download', url, fileName),
    onProgress: (cb: (d: { received: number; total: number }) => void) => {
      const h = (_: unknown, d: { received: number; total: number }) => cb(d)
      ipcRenderer.on('update:progress', h); return () => ipcRenderer.removeListener('update:progress', h)
    },
  },
  computer: {
    exec: (cmd: string) => ipcRenderer.invoke('computer:exec', cmd),
    readFile: (path: string, offset?: number, limit?: number) => ipcRenderer.invoke('computer:readFile', path, offset, limit),
    stat: (p: string) => ipcRenderer.invoke('computer:stat', p),
    sysPerf: () => ipcRenderer.invoke('computer:sysPerf'),
    setWorkDir: (dir: string) => ipcRenderer.invoke('computer:setWorkDir', dir),
    writeFile: (path: string, content: string) => ipcRenderer.invoke('computer:writeFile', path, content),
    readDir: (path: string) => ipcRenderer.invoke('computer:readDir', path),
    mkdir: (path: string) => ipcRenderer.invoke('computer:mkdir', path),
    remove: (path: string) => ipcRenderer.invoke('computer:remove', path),
    rename: (oldPath: string, newName: string) => ipcRenderer.invoke('computer:rename', oldPath, newName),
    createFile: (filePath: string, content?: string) => ipcRenderer.invoke('computer:createFile', filePath, content),
    contextMenu: (opts: { path: string; isDir: boolean; isWorkDir?: boolean }) => ipcRenderer.invoke('computer:contextMenu', opts),
    systemInfo: () => ipcRenderer.invoke('computer:systemInfo'),
    openFile: (path: string) => ipcRenderer.invoke('computer:openFile', path),
    selectFile: () => ipcRenderer.invoke('computer:selectFile'),
    selectDir: () => ipcRenderer.invoke('computer:selectDir'),
    readImageBase64: (path: string) => ipcRenderer.invoke('computer:readImageBase64', path),
    readFileAsDataUrl: (path: string) => ipcRenderer.invoke('computer:readFileAsDataUrl', path),
    grep: (dir: string, pattern: string) => ipcRenderer.invoke('computer:grep', dir, pattern),
    find: (dir: string, glob: string) => ipcRenderer.invoke('computer:find', dir, glob),
    screenshot: () => ipcRenderer.invoke('computer:screenshot'),
    clipboardRead: () => ipcRenderer.invoke('computer:clipboardRead'),
    clipboardWrite: (text:string) => ipcRenderer.invoke('computer:clipboardWrite', text),
    processList: () => ipcRenderer.invoke('computer:processList'),
    killProcess: (pid:string) => ipcRenderer.invoke('computer:killProcess', pid),
    codebox: (lang:string, code:string) => ipcRenderer.invoke('computer:codebox', lang, code),
    invalidateCache: () => ipcRenderer.invoke('cache:invalidate:write'),
  },
  web: {
    fetch: (url: string) => ipcRenderer.invoke('web:fetch', url),
    search: (query: string) => ipcRenderer.invoke('web:search', query),
    // v0.2.5: 无头浏览器网页解析工具（Playwright 内核, 返回 JSON 字符串）
    read: (url: string, mode?: string) => ipcRenderer.invoke('web:read', url, mode),
    browse: (url: string) => ipcRenderer.invoke('browser:open', url),
    browseScreenshot: (url: string) => ipcRenderer.invoke('browser:screenshot', url),
    // v0.2.3: 实时浏览器面板
    navigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    current: () => ipcRenderer.invoke('browser:current'),
    snapshot: () => ipcRenderer.invoke('browser:snapshot'),
    // v0.2.3: 独立浏览器窗口 + 悬浮窗
    showPanel: () => ipcRenderer.invoke('browser:showPanel'),
    showFloat: () => ipcRenderer.invoke('browser:showFloat'),
    hideFloat: () => ipcRenderer.invoke('browser:hideFloat'),
    debug: () => ipcRenderer.invoke('browser:debug'),
    // v0.2.6: 渲染加速状态
    rendererStatus: () => ipcRenderer.invoke('renderer:status'),
    // v0.2.4: 主窗口内"正在使用浏览器"横幅事件
    onFloat: (cb: (d: { show: boolean }) => void) => {
      const h = (_: unknown, d: { show: boolean }) => cb(d)
      ipcRenderer.on('browser:float', h); return () => ipcRenderer.removeListener('browser:float', h)
    },
  },
  models: {
    detect: (baseUrl: string, apiKey: string, opts?: { anthropic?: boolean; type?: string }) => ipcRenderer.invoke('models:detect', baseUrl, apiKey, opts),
    // v0.2.2: 测试连接
    test: (baseUrl: string, apiKey: string, opts?: { anthropic?: boolean }) => ipcRenderer.invoke('models:test', baseUrl, apiKey, opts),
  },
  cacheStats: () => ipcRenderer.invoke('cache:stats'),
  modelStats: {
    recordRequest: (sid: string, model: string, hit: boolean) => ipcRenderer.invoke('modelStats:recordRequest', sid, model, hit),
    recordTokens: (sid: string, model: string, hitT: number, missT: number, writeT: number, missTok?: number) => ipcRenderer.invoke('modelStats:recordTokens', sid, model, hitT, missT, writeT, missTok),
    deleteSession: (sid: string) => ipcRenderer.invoke('modelStats:deleteSession', sid),
    get: () => ipcRenderer.invoke('modelStats:get'),
    getSession: (sid: string) => ipcRenderer.invoke('modelStats:getSession', sid),
    resetAll: () => ipcRenderer.invoke('modelStats:resetAll'),
    resetOne: (model: string) => ipcRenderer.invoke('modelStats:resetOne', model),
  },
  cacheClear: () => ipcRenderer.invoke('cache:clear'),
  storageStats: () => ipcRenderer.invoke('storage:stats'),
  llm: {
    chat: (params: unknown) => ipcRenderer.invoke('llm:chat', params),
    chatOnce: (params: unknown) => ipcRenderer.invoke('llm:chatOnce', params),
    vision: (params: unknown) => ipcRenderer.invoke('llm:vision', params),
    abort: (requestId?: string) => ipcRenderer.invoke('llm:abort', requestId),
    // v0.2.3: 多会话并发 —— 回调均带 requestId，由调用方过滤只收自己的流
    onChunk: (cb: (d: { content: string; done: boolean; requestId?: string }) => void) => {
      const h = (_: unknown, d: { content: string; done: boolean; requestId?: string }) => cb(d)
      ipcRenderer.on('llm:chunk', h); return () => ipcRenderer.removeListener('llm:chunk', h)
    },
    onError: (cb: (e: unknown) => void) => {
      const h = (_: unknown, e: any) => cb(e)
      ipcRenderer.on('llm:error', h); return () => ipcRenderer.removeListener('llm:error', h)
    },
    onToolCall: (cb: (tc: unknown) => void) => {
      const h = (_: unknown, tc: any) => cb(tc)
      ipcRenderer.on('llm:toolCall', h); return () => ipcRenderer.removeListener('llm:toolCall', h)
    },
    onUsage: (cb: (u: unknown) => void) => {
      const h = (_: unknown, u: any) => cb(u)
      ipcRenderer.on('llm:usage', h); return () => ipcRenderer.removeListener('llm:usage', h)
    },
  },
})
