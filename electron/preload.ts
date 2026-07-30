import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('huangquan', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    setOpacity: (o: number) => ipcRenderer.invoke('window:setOpacity', o),
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (s: unknown) => ipcRenderer.invoke('settings:save', s),
  },
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    load: (id: string) => ipcRenderer.invoke('sessions:load', id),
    save: (s: unknown) => ipcRenderer.invoke('sessions:save', s),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
  },
  ishiki: { load: () => ipcRenderer.invoke('ishiki:load') },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    load: (path: string) => ipcRenderer.invoke('skills:load', path),
    create: (name: string, content: string) => ipcRenderer.invoke('skills:create', name, content),
    install: (url: string) => ipcRenderer.invoke('skills:install', url),
    delete: (name: string) => ipcRenderer.invoke('skills:delete', name),
  },
  memory: {
    load: () => ipcRenderer.invoke('memory:load'),
    save: (m: unknown) => ipcRenderer.invoke('memory:save', m),
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
  },
  mcpConnect: (name: string, cmd: string, args: string[]) => ipcRenderer.invoke('mcp:connect', name, cmd, args),
  mcpCall: (server: string, tool: string, a: any) => ipcRenderer.invoke('mcp:call', server, tool, a),
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpSSEConnect: (name: string, url: string, headers?: Record<string,string>) => ipcRenderer.invoke('mcp:sse:connect', name, url, headers),
  mcpSSECall: (server: string, tool: string, args: any) => ipcRenderer.invoke('mcp:sse:call', server, tool, args),
  mcpSSEList: () => ipcRenderer.invoke('mcp:sse:list'),
  getPaths: () => ipcRenderer.invoke('get:paths'),
  computer: {
    exec: (cmd: string) => ipcRenderer.invoke('computer:exec', cmd),
    readFile: (path: string) => ipcRenderer.invoke('computer:readFile', path),
    writeFile: (path: string, content: string) => ipcRenderer.invoke('computer:writeFile', path, content),
    readDir: (path: string) => ipcRenderer.invoke('computer:readDir', path),
    systemInfo: () => ipcRenderer.invoke('computer:systemInfo'),
    openFile: (path: string) => ipcRenderer.invoke('computer:openFile', path),
    selectFile: () => ipcRenderer.invoke('computer:selectFile'),
    selectDir: () => ipcRenderer.invoke('computer:selectDir'),
    readImageBase64: (path: string) => ipcRenderer.invoke('computer:readImageBase64', path),
    grep: (dir: string, pattern: string) => ipcRenderer.invoke('computer:grep', dir, pattern),
    find: (dir: string, glob: string) => ipcRenderer.invoke('computer:find', dir, glob),
    screenshot: () => ipcRenderer.invoke('computer:screenshot'),
    clipboardRead: () => ipcRenderer.invoke('computer:clipboardRead'),
    clipboardWrite: (text:string) => ipcRenderer.invoke('computer:clipboardWrite', text),
    processList: () => ipcRenderer.invoke('computer:processList'),
    killProcess: (pid:string) => ipcRenderer.invoke('computer:killProcess', pid),
    codebox: (lang:string, code:string) => ipcRenderer.invoke('computer:codebox', lang, code),
  },
  web: {
    fetch: (url: string) => ipcRenderer.invoke('web:fetch', url),
    search: (query: string) => ipcRenderer.invoke('web:search', query),
    browse: (url: string) => ipcRenderer.invoke('browser:open', url),
    browseScreenshot: (url: string) => ipcRenderer.invoke('browser:screenshot', url),
  },
  models: {
    detect: (baseUrl: string, apiKey: string) => ipcRenderer.invoke('models:detect', baseUrl, apiKey),
  },
  llm: {
    chat: (params: unknown) => ipcRenderer.invoke('llm:chat', params),
    abort: () => ipcRenderer.invoke('llm:abort'),
    onChunk: (cb: (d: { content: string; done: boolean }) => void) => {
      const h = (_: unknown, d: { content: string; done: boolean }) => cb(d)
      ipcRenderer.on('llm:chunk', h); return () => ipcRenderer.removeListener('llm:chunk', h)
    },
    onError: (cb: (e: string) => void) => {
      const h = (_: unknown, e: string) => cb(e)
      ipcRenderer.on('llm:error', h); return () => ipcRenderer.removeListener('llm:error', h)
    },
    onToolCall: (cb: (tc: any) => void) => {
      const h = (_: unknown, tc: any) => cb(tc)
      ipcRenderer.on('llm:toolCall', h); return () => ipcRenderer.removeListener('llm:toolCall', h)
    },
    onToolCallDone: (cb: (d: any) => void) => {
      const h = (_: unknown, d: any) => cb(d)
      ipcRenderer.on('llm:toolCallDone', h); return () => ipcRenderer.removeListener('llm:toolCallDone', h)
    },
  },
})
