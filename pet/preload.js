// pet/preload.js — 最小 IPC 桥(contextIsolation 开启, 不暴露 node)
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petIpc', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, fn) => { ipcRenderer.on(channel, (_e, ...args) => { try { fn(...args) } catch (e) { /* 忽略 */ } }) },
})
