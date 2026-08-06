// electron/engine/registry.ts — 主进程工具 handler 注册表(v0.3.3 独立内核)
// 在 registerXxxIpc 之前包装 ipcMain.handle, 捕获全部 handler。
// AgentEngine 直接调用这些 handler(传入假 event), 无需把 18 个 IPC 域模块再拆一遍。
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const handlerMap = new Map<string, Handler>()

const origHandle = ipcMain.handle.bind(ipcMain) as (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void
// 包装 handle —— 捕获 handler 进注册表, 同时保留原行为(渲染层 IPC 不受影响)
;(ipcMain as unknown as { handle: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void }).handle = ((channel: string, listener: Handler) => {
  handlerMap.set(channel, listener)
  return origHandle(channel, listener)
})

export function hasHandler(channel: string): boolean {
  return handlerMap.has(channel)
}

export function invokeHandler(channel: string, args: unknown[], sender?: WebContents | null): Promise<unknown> {
  const h = handlerMap.get(channel)
  if (!h) return Promise.resolve('E:handler-not-found:' + channel)
  const fakeEvent = { sender: sender || null } as unknown as IpcMainInvokeEvent
  try {
    const r = h(fakeEvent, ...args)
    return Promise.resolve(r)
  } catch (e) {
    return Promise.resolve('E:' + (e instanceof Error ? e.message : String(e)))
  }
}
