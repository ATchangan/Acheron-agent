import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('huangquan', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
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
  },
  memory: {
    load: () => ipcRenderer.invoke('memory:load'),
    save: (m: unknown) => ipcRenderer.invoke('memory:save', m),
  },
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
  },
  web: {
    fetch: (url: string) => ipcRenderer.invoke('web:fetch', url),
    search: (query: string) => ipcRenderer.invoke('web:search', query),
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
