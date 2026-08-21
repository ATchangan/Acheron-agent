// electron/plugins/host-core.ts — 插件宿主核心(可跑在 utilityProcess 或同进程 vm 兜底, 无 electron 依赖)
// 协议: 父→子 {type:'init', code, tool, args}; 子→父 {type:'call', id, name, args}; 父→子 {type:'result', id, value|error}; 子→父 {type:'done', ok, result?, error?, logs}
import * as vm from 'vm'
import { createHardenedContext } from './sandbox'

export interface HostPort {
  postMessage: (msg: unknown) => void
  onMessage?: (cb: (msg: unknown) => void) => void
}

export interface HostInitPayload { code: string; tool: string; args: Record<string, unknown>; settings?: Record<string, unknown> }
export interface HostDone { type: 'done'; ok: boolean; result?: string; error?: string; logs: string[] }

export interface HostRunOpts { syncTimeoutMs?: number; asyncTimeoutMs?: number; hardenProcess?: boolean }

export function runHostCore(port: HostPort, payload: HostInitPayload, opts: HostRunOpts = {}): void {
  const syncTimeoutMs = Math.max(100, Number(opts.syncTimeoutMs) || 10000)
  const asyncTimeoutMs = Math.max(100, Number(opts.asyncTimeoutMs) || 120000)
  const logs: string[] = []
  const pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>()
  let callSeq = 0

  if (port.onMessage) {
    port.onMessage((msg: unknown) => {
      const m = msg as { type?: string; id?: number; value?: string; error?: string }
      if (m?.type !== 'result') return
      const p = pending.get(Number(m.id))
      if (!p) return
      pending.delete(Number(m.id))
      if (m.error) p.reject(new Error(m.error))
      else p.resolve(String(m.value ?? ''))
    })
  }

  const finish = (d: HostDone): void => { try { port.postMessage(d) } catch { /* 父进程已退出 */ } }

  // 缩小逃逸面(仅独立宿主进程): 不需要环境变量与内建模块获取入口 —— 同进程兜底绝不能动主进程的 process
  if (opts.hardenProcess) {
    try { process.env = {} } catch { /* 忽略 */ }
    try { (process as unknown as { getBuiltinModule?: unknown }).getBuiltinModule = undefined } catch { /* 忽略 */ }
    try { (process as unknown as { binding?: unknown }).binding = undefined } catch { /* 忽略 */ }
  }

  const sandbox: Record<string, unknown> = {
    module: { exports: {} }, exports: {},
    require: (m: unknown): never => { throw new Error('E:PLUGIN_FORBIDDEN: ' + String(m)) },
    console: { log: (m: unknown) => logs.push(String(m)), warn: (m: unknown) => logs.push('warn: ' + String(m)), error: (m: unknown) => logs.push('error: ' + String(m)) },
    setTimeout, clearTimeout,
    log: (m: unknown) => logs.push(String(m)),
    tools: { run: (n: unknown, a: unknown): Promise<string> => {
      const name = String(n || '')
      const args = (a && typeof a === 'object' && !Array.isArray(a) ? a : {}) as Record<string, unknown>
      const id = ++callSeq
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try { port.postMessage({ type: 'call', id, name, args }) } catch (e: unknown) { pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))) }
      })
    } },
    __hq_args: payload.args || {},
    __hq_ctx: { log: undefined, tools: undefined } as Record<string, unknown>,
  }
  sandbox.__hq_ctx = { log: sandbox.log, tools: sandbox.tools, settings: payload.settings || {} }

  const ctx = createHardenedContext(sandbox)
  try {
    vm.runInContext(payload.code, ctx, { timeout: syncTimeoutMs })
    const exported = vm.runInContext('module.exports', ctx, { timeout: 1000 })
    const tools = Array.isArray(exported?.tools) ? exported.tools : []
    const idx = tools.findIndex((t: unknown) => !!t && (t as { name?: unknown }).name === payload.tool)
    if (idx < 0 || typeof (tools[idx] as { run?: unknown }).run !== 'function') {
      finish({ type: 'done', ok: false, error: 'E:PLUGIN_NO_RUN: ' + payload.tool, logs })
      return
    }
    const callResult = vm.runInContext('module.exports.tools[' + idx + '].run(globalThis.__hq_args, globalThis.__hq_ctx)', ctx, { timeout: syncTimeoutMs })
    Promise.race([
      Promise.resolve(callResult),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('E:PLUGIN_TIMEOUT(' + Math.round(asyncTimeoutMs / 1000) + 's)')), asyncTimeoutMs)),
    ]).then(
      r => finish({ type: 'done', ok: true, result: String(r ?? ''), logs }),
      e => finish({ type: 'done', ok: false, error: e instanceof Error ? e.message : String(e), logs }),
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    finish({ type: 'done', ok: false, error: /timed out/i.test(msg) ? 'E:PLUGIN_TIMEOUT(同步执行超时, 超过 ' + Math.round(syncTimeoutMs / 1000) + 's 已中断)' : msg, logs })
  }
}

// 同进程 vm 兜底传输: 把 call 消息直接路由给父进程侧 handleCall, done 收敛为 Promise
export interface InProcessHost {
  done: Promise<HostDone>
  postMessage: (msg: unknown) => void
  onMessage: (cb: (msg: unknown) => void) => void
}

export function createInProcessHost(handleCall: (name: string, args: Record<string, unknown>) => Promise<string>): InProcessHost {
  let onMsg: ((msg: unknown) => void) | null = null
  let resolveDone!: (d: HostDone) => void
  const done = new Promise<HostDone>(res => { resolveDone = res })
  return {
    done,
    onMessage: (cb: (msg: unknown) => void) => { onMsg = cb },
    postMessage: (msg: unknown) => {
      const m = msg as { type?: string; id?: number; name?: string; args?: Record<string, unknown> }
      if (m?.type === 'call') {
        void handleCall(String(m.name || ''), m.args || {}).then(
          value => onMsg?.({ type: 'result', id: m.id, value }),
          e => onMsg?.({ type: 'result', id: m.id, error: e instanceof Error ? e.message : String(e) }),
        )
      } else if (m?.type === 'done') {
        resolveDone(m as HostDone)
      }
    },
  }
}

export function runPluginInMain(payload: HostInitPayload, handleCall: (name: string, args: Record<string, unknown>) => Promise<string>, opts: HostRunOpts = {}): Promise<HostDone> {
  const host = createInProcessHost(handleCall)
  runHostCore(host, payload, opts)
  return host.done
}
