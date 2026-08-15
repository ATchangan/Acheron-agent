// electron/plugins/host-core.test.ts — 插件宿主核心协议单测(正常/桥接/挂死/逃逸)
import { describe, expect, it } from 'vitest'
import { runHostCore, runPluginInMain, type HostDone } from './host-core'

interface FakePort {
  done: Promise<HostDone>
  postMessage: (m: unknown) => void
  onMessage: (cb: (m: unknown) => void) => void
}

function makePort(handleCall?: (name: string, args: Record<string, unknown>) => Promise<string>): FakePort {
  let onMsg: ((m: unknown) => void) | null = null
  let resolveDone!: (d: HostDone) => void
  const done = new Promise<HostDone>(res => { resolveDone = res })
  return {
    done,
    onMessage: (cb: (m: unknown) => void) => { onMsg = cb },
    postMessage: (m: unknown) => {
      const msg = m as { type?: string; id?: number; name?: string; args?: Record<string, unknown> }
      if (msg?.type === 'call') {
        void handleCall!(String(msg.name || ''), msg.args || {}).then(
          value => onMsg?.({ type: 'result', id: msg.id, value }),
          e => onMsg?.({ type: 'result', id: msg.id, error: e instanceof Error ? e.message : String(e) }),
        )
      } else if (msg?.type === 'done') {
        resolveDone(msg as HostDone)
      }
    },
  }
}

const GOOD = `module.exports = { tools: [{ name: 't', description: 'd', params: {}, run: (a, c) => { c.log('L1'); return 'R' + (a.x || '') } }] }`

describe('runHostCore', () => {
  it('正常执行返回结果与日志', async () => {
    const port = makePort()
    runHostCore(port, { code: GOOD, tool: 't', args: { x: '1' } })
    const d = await port.done
    expect(d.ok).toBe(true)
    expect(d.result).toBe('R1')
    expect(d.logs).toContain('L1')
  })

  it('tools.run 经 call 协议回父进程裁决', async () => {
    const port = makePort(async name => (name === 'read' ? 'FILE_CONTENT' : 'E:unknown'))
    const code = `module.exports = { tools: [{ name: 't', description: 'd', params: {}, run: async (a, c) => await c.tools.run('read', { path: 'a.txt' }) }] }`
    runHostCore(port, { code, tool: 't', args: {} })
    const d = await port.done
    expect(d.ok).toBe(true)
    expect(d.result).toBe('FILE_CONTENT')
  })

  it('ctx.settings 注入插件运行时', async () => {
    const port = makePort()
    const code = `module.exports = { tools: [{ name: 't', description: 'd', params: {}, run: (a, c) => String(c.settings.mode) }] }`
    runHostCore(port, { code, tool: 't', args: {}, settings: { mode: 'fast' } })
    const d = await port.done
    expect(d.ok).toBe(true)
    expect(d.result).toBe('fast')
  })

  it('同步死循环被 vm script 超时打断', async () => {
    const port = makePort()
    const code = `module.exports = { tools: [{ name: 't', description: 'd', params: {}, run: () => { while (true) {} } }] }`
    runHostCore(port, { code, tool: 't', args: {} }, { syncTimeoutMs: 300 })
    const d = await port.done
    expect(d.ok).toBe(false)
    expect(d.error).toContain('超时')
  })

  it('async 永不返回由异步兜底超时', async () => {
    const port = makePort()
    const code = `module.exports = { tools: [{ name: 't', description: 'd', params: {}, run: () => new Promise(() => {}) }] }`
    runHostCore(port, { code, tool: 't', args: {} }, { asyncTimeoutMs: 300 })
    const d = await port.done
    expect(d.ok).toBe(false)
    expect(d.error).toContain('TIMEOUT')
  })

  it('顶层 Function 构造逃逸被 codeGeneration 阻断', async () => {
    const port = makePort()
    const code = `({}).constructor.constructor('return process')()\nmodule.exports = { tools: [] }`
    runHostCore(port, { code, tool: 't', args: {} })
    const d = await port.done
    expect(d.ok).toBe(false)
  })

  it('同进程兜底绝不触碰主进程 process(env/内建模块入口保持)', async () => {
    const envPathBefore = process.env.PATH
    const gbmBefore = typeof (process as unknown as { getBuiltinModule?: unknown }).getBuiltinModule
    const d = await runPluginInMain({ code: GOOD, tool: 't', args: {} }, async () => 'X')
    expect(d.ok).toBe(true)
    expect(process.env.PATH).toBe(envPathBefore)
    expect(typeof (process as unknown as { getBuiltinModule?: unknown }).getBuiltinModule).toBe(gbmBefore)
  })
})
