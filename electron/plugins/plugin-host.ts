// electron/plugins/plugin-host.ts — utilityProcess 子进程入口(仅此文件接触 process.parentPort)
import { runHostCore } from './host-core'

type ParentPort = { on: (ev: string, cb: (m: unknown) => void) => void; postMessage: (m: unknown) => void }
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort

if (!parentPort) process.exit(1)

// Electron 43 utilityProcess 的 message 事件在两端都以 MessageEvent 形式传递({data, ports}), 统一解包
const unwrap = (m: unknown): unknown => {
  if (m && typeof m === 'object' && 'data' in (m as object)) return (m as { data: unknown }).data
  return m
}

parentPort.on('message', (m: unknown) => {
  const msg = unwrap(m) as { type?: string; code?: string; tool?: string; args?: Record<string, unknown> }
  if (msg?.type !== 'init') return
  runHostCore(
    {
      postMessage: x => parentPort.postMessage(x),
      onMessage: cb => parentPort.on('message', m => cb(unwrap(m))),
    },
    { code: String(msg.code || ''), tool: String(msg.tool || ''), args: msg.args || {} },
    { hardenProcess: true },
  )
})

process.on('uncaughtException', (e: unknown) => {
  try { parentPort.postMessage({ type: 'done', ok: false, error: '宿主异常: ' + (e instanceof Error ? e.message : String(e)), logs: [] }) } catch { /* 父进程已退出 */ }
})
