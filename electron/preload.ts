import { contextBridge, ipcRenderer, webUtils } from 'electron'

// ─── 安全参数清洗——消除 Proxy、循环引用等不可序列化对象导致的 IPC 报错 ──
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
    show: () => ipcRenderer.invoke('window:show'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    setOpacity: (o: number) => ipcRenderer.invoke('window:setOpacity', o),
    setTitleBarOverlay: (o: { color?: string; symbolColor?: string; height?: number }) => ipcRenderer.invoke('window:setTitleBarOverlay', o),
  },
  risk: {
    respond: (requestId: string, decision: 'allow' | 'deny', approveTask: boolean, taskKey?: string, always?: boolean) =>
      ipcRenderer.invoke('risk:respond', requestId, decision, approveTask, taskKey, always),
    onConfirm: (cb: (d: unknown) => void) => {
      const h = (_: unknown, d: unknown) => cb(d)
      ipcRenderer.on('risk:confirm', h)
      return () => ipcRenderer.removeListener('risk:confirm', h)
    },
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (s: unknown) => ipcRenderer.invoke('settings:save', safeArg(s)),
    reset: () => ipcRenderer.invoke('settings:reset'),
  },
  pet: {
    toggle: (enable: boolean) => ipcRenderer.invoke('pet:toggle', enable),
    setForm: (form: 'normal' | 'ultimate') => ipcRenderer.invoke('pet:set-form', form),
    resetPos: () => ipcRenderer.invoke('pet:reset-pos'),
  },
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    load: (id: string) => ipcRenderer.invoke('sessions:load', id),
    save: (s: unknown) => ipcRenderer.invoke('sessions:save', safeArg(s)),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    audit: () => ipcRenderer.invoke('sessions:audit'),
    clearAll: () => ipcRenderer.invoke('sessions:clearAll'),
    export: (format: string, workDir?: string) => ipcRenderer.invoke('sessions:export', format, workDir),
    search: (query: string, limit?: number) => ipcRenderer.invoke('sessions:search', query, limit),
  },
  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    restore: () => ipcRenderer.invoke('backup:restore'),
  },
  rollback: {
    apply: (taskId: string) => ipcRenderer.invoke('rollback:apply', taskId),
  },
  diagnostics: {
    check: () => ipcRenderer.invoke('diagnostics:check'),
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
  mcpConfirm: (info: { server: string; tool: string; args: Record<string, unknown> }) => ipcRenderer.invoke('mcp:confirm', info),
  tasks: {
    list: () => ipcRenderer.invoke('task:list'),
    start: (t: unknown) => ipcRenderer.invoke('task:start', t),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('task:update', id, patch),
    finish: (id: string, status: string, error?: string) => ipcRenderer.invoke('task:finish', id, status, error),
    clear: (id?: string) => ipcRenderer.invoke('task:clear', id),
  },
  trace: {
    log: (entry: unknown) => ipcRenderer.invoke('trace:log', entry),
    list: (limit?: number) => ipcRenderer.invoke('trace:list', limit),
    clear: () => ipcRenderer.invoke('trace:clear'),
    export: () => ipcRenderer.invoke('trace:export'),
  },
  engine: {
    start: (p: unknown) => ipcRenderer.invoke('engine:start', p),
    stop: (sid: string) => ipcRenderer.invoke('engine:stop', sid),
    interject: (sid: string, content: string, images?: string[], attachments?: unknown, kind?: string, prefix?: string) => ipcRenderer.invoke('engine:interject', sid, content, images, attachments, kind, prefix),
    approve: (sid: string) => ipcRenderer.invoke('engine:approve', sid),
    reject: (sid: string) => ipcRenderer.invoke('engine:reject', sid),
    resume: (taskId: string) => ipcRenderer.invoke('engine:resume', taskId),
    subscribe: () => ipcRenderer.invoke('engine:subscribe'),
    onEvent: (cb: (ev: unknown) => void) => {
      const h = (_: unknown, ev: unknown) => cb(ev)
      ipcRenderer.on('engine:event', h)
      return () => ipcRenderer.removeListener('engine:event', h)
    },
  },
  mediaDescribe: (opts?: { local?: boolean; localUrl?: string }) => ipcRenderer.invoke('media:describe', opts),
    mediaGen: (opts: { kind: 'img' | 'video'; prompt: string; providerId?: string; model?: string; ratio?: string; duration?: number }) => ipcRenderer.invoke('media:gen', opts),
  tts: { speak: (text: string, rate?: number) => ipcRenderer.invoke('tts:speak', text, rate) },
  getPaths: () => ipcRenderer.invoke('get:paths'),
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: (url: string, fileName: string) => ipcRenderer.invoke('update:download', url, fileName),
    onProgress: (cb: (d: { received: number; total: number; ts: number }) => void) => {
      const h = (_: unknown, d: { received: number; total: number; ts: number }) => cb(d)
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
    // 无头浏览器网页解析工具（Playwright 内核, 返回 JSON 字符串）
    read: (url: string, mode?: string) => ipcRenderer.invoke('web:read', url, mode),
    browse: (url: string) => ipcRenderer.invoke('browser:open', url),
    browseScreenshot: (url: string) => ipcRenderer.invoke('browser:screenshot', url),
    // v0.3.3: 浏览器交互工具
    browseSnapshot: (url?: string) => ipcRenderer.invoke('browser:snapshotA11y', url),
    browserClick: (ref: string) => ipcRenderer.invoke('browser:click', ref),
    browserType: (ref: string, text: string) => ipcRenderer.invoke('browser:type', ref, text),
    browserPress: (key: string) => ipcRenderer.invoke('browser:press', key),
    browserScroll: (direction: string) => ipcRenderer.invoke('browser:scroll', direction),
    closeBrowserSession: (sid: string, taskId: string) => ipcRenderer.invoke('browser:closeSession', sid + '::' + taskId),
    openExternal: (url: string) => ipcRenderer.invoke('browser:openExternal', url),
    // 实时浏览器面板
    navigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    current: () => ipcRenderer.invoke('browser:current'),
    snapshot: () => ipcRenderer.invoke('browser:snapshot'),
    // v0.3.4: 内嵌实时画面(WebContentsView)布局/显示/隐藏
    viewLayout: (b: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('browser:viewLayout', b),
    viewShow: (key?: string) => ipcRenderer.invoke('browser:viewShow', key),
    viewHide: () => ipcRenderer.invoke('browser:viewHide'),
    // 浏览器面板 + 悬浮窗
    showPanel: () => ipcRenderer.invoke('browser:showPanel'),
    showFloat: () => ipcRenderer.invoke('browser:showFloat'),
    hideFloat: () => ipcRenderer.invoke('browser:hideFloat'),
    debug: () => ipcRenderer.invoke('browser:debug'),
    // 渲染加速状态
    rendererStatus: () => ipcRenderer.invoke('renderer:status'),
    // 主窗口内"正在使用浏览器"横幅事件
    onFloat: (cb: (d: { show: boolean }) => void) => {
      const h = (_: unknown, d: { show: boolean }) => cb(d)
      ipcRenderer.on('browser:float', h); return () => ipcRenderer.removeListener('browser:float', h)
    },
    // v0.3.4: 主进程请求切换到内嵌浏览器面板
    onEmbed: (cb: (d: { show: boolean }) => void) => {
      const h = (_: unknown, d: { show: boolean }) => cb(d)
      ipcRenderer.on('browser:embed', h); return () => ipcRenderer.removeListener('browser:embed', h)
    },
  },
  models: {
    detect: (baseUrl: string, apiKey: string, opts?: { anthropic?: boolean; type?: string }) => ipcRenderer.invoke('models:detect', baseUrl, apiKey, opts),
    // 测试连接
    test: (baseUrl: string, apiKey: string, opts?: { anthropic?: boolean }) => ipcRenderer.invoke('models:test', baseUrl, apiKey, opts),
  },
  cacheStats: () => ipcRenderer.invoke('cache:stats'),
  modelStats: {
    recordRequest: (sid: string, model: string, hit: boolean, supported?: boolean) => ipcRenderer.invoke('modelStats:recordRequest', sid, model, hit, supported),
    recordTokens: (sid: string, model: string, readT: number, inputT: number, writeT: number, missT?: number, opts?: { supported?: boolean | null; provider?: string }) => ipcRenderer.invoke('modelStats:recordTokens', sid, model, readT, inputT, writeT, missT, opts),
    deleteSession: (sid: string) => ipcRenderer.invoke('modelStats:deleteSession', sid),
    get: () => ipcRenderer.invoke('modelStats:get'),
    getSession: (sid: string) => ipcRenderer.invoke('modelStats:getSession', sid),
    resetAll: () => ipcRenderer.invoke('modelStats:resetAll'),
    resetOne: (model: string) => ipcRenderer.invoke('modelStats:resetOne', model),
  },
  cacheClear: () => ipcRenderer.invoke('cache:clear'),
  cacheCleanChromium: () => ipcRenderer.invoke('cache:cleanChromium'),
  storageStats: () => ipcRenderer.invoke('storage:stats'),
  llm: {
    chat: (params: unknown) => ipcRenderer.invoke('llm:chat', params),
    chatOnce: (params: unknown) => ipcRenderer.invoke('llm:chatOnce', params),
    vision: (params: unknown) => ipcRenderer.invoke('llm:vision', params),
    abort: (requestId?: string) => ipcRenderer.invoke('llm:abort', requestId),
    // 多会话并发 —— 回调均带 requestId，由调用方过滤只收自己的流
    onChunk: (cb: (d: { content: string; done: boolean; requestId?: string }) => void) => {
      const h = (_: unknown, d: { content: string; done: boolean; requestId?: string }) => cb(d)
      ipcRenderer.on('llm:chunk', h); return () => ipcRenderer.removeListener('llm:chunk', h)
    },
    onError: (cb: (e: unknown) => void) => {
      const h = (_: unknown, e: unknown) => cb(e)
      ipcRenderer.on('llm:error', h); return () => ipcRenderer.removeListener('llm:error', h)
    },
    onToolCall: (cb: (tc: unknown) => void) => {
      const h = (_: unknown, tc: unknown) => cb(tc)
      ipcRenderer.on('llm:toolCall', h); return () => ipcRenderer.removeListener('llm:toolCall', h)
    },
    onUsage: (cb: (u: unknown) => void) => {
      const h = (_: unknown, u: unknown) => cb(u)
      ipcRenderer.on('llm:usage', h); return () => ipcRenderer.removeListener('llm:usage', h)
    },
  },
  appInfo: () => ipcRenderer.invoke('app:info'),
  projectContext: () => ipcRenderer.invoke('get:projectContext'),
})
