import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
  Notification: class { show() { /* noop */ } },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { AgentEngine } from './engine'
import { initTaskStore } from '../ipc/tasks'

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const TOOL_CHUNK =
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_ls","function":{"name":"ls","arguments":"{}"}}]}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
  'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
  'data: [DONE]\n\n'
const TEXT_CHUNK =
  'data: {"choices":[{"delta":{"content":"\u4efb\u52a1\u5b8c\u6210"}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: {"usage":{"prompt_tokens":20,"completion_tokens":10}}\n\n' +
  'data: [DONE]\n\n'

function updateChunk(id: string): string {
  const args = '{\\"steps\\":[{\\"label\\":\\"\\u67e5\\u770b\\u76ee\\u5f55\\",\\"tool\\":\\"ls\\",\\"status\\":\\"done\\"},{\\"label\\":\\"\\u8bfb\\u53d6\\u6587\\u4ef6\\",\\"tool\\":\\"read\\",\\"status\\":\\"done\\"}]}'
  return (
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"' + id + '","function":{"name":"update_plan","arguments":"' + args + '"}}]}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
    'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
    'data: [DONE]\n\n'
  )
}

function waitFor(events: { type: string }[], type: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise(resolve => {
    const t0 = Date.now()
    const timer = setInterval(() => {
      if (events.some(e => e.type === type)) { clearInterval(timer); resolve(true); return }
      if (Date.now() - t0 > timeoutMs) { clearInterval(timer); resolve(false) }
    }, 50)
  })
}

describe('AgentEngine 主循环(mock LLM)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'hq-engine-'))
    initTaskStore(join(tmp, 'tasks.json'))
  })

  it('工具轮 → 计划状态机 → 最终回复 → 任务完成', async () => {
    const events: { type: string; toolCalls?: unknown[]; content?: string }[] = []
    let call = 0
    const netFetch = vi.fn(async () => {
      call++
      return sseResponse(call === 1 ? [TOOL_CHUNK] : [TEXT_CHUNK])
    }) as unknown as typeof fetch
    const engine = new AgentEngine({
      settingsPath: join(tmp, 'settings.json'),
      userDataPath: tmp,
      memoryPath: join(tmp, 'memory.json'),
      tracePath: join(tmp, 'trace.jsonl'),
      netFetch,
      loadSettings: () => ({
        providers: [{ id: 'p1', name: 'D', type: 'OpenAI Compatible', apiKey: 'k', baseUrl: 'http://x/v1', models: ['m1'], selectedModel: 'm1' }],
        general: { workDir: tmp, maxToolRounds: 50 },
      }),
      loadIshiki: () => '',
      sendEvent: ev => events.push(ev as { type: string }),
      getSender: () => null,
    })

    engine.start({ sid: 's1', taskId: 't1', content: '\u7528\u5de5\u5177\u67e5\u770b', userMsgId: 'u1', userMsgTimestamp: Date.now(), history: [] })

    const done = await waitFor(events, 'task-done')
    expect(done).toBe(true)
    expect(events.some(e => e.type === 'plan-update')).toBe(true)
    expect(events.some(e => e.type === 'step' && Array.isArray(e.toolCalls) && e.toolCalls.length > 0)).toBe(true)
    expect(events.some(e => e.type === 'final' && String(e.content || '').includes('\u4efb\u52a1\u5b8c\u6210'))).toBe(true)
    expect(netFetch).toHaveBeenCalledTimes(2)
  }, 20000)

  it('纯文本任务不经过工具轮也能完成', async () => {
    const events: { type: string; content?: string }[] = []
    const netFetch = vi.fn(async () => sseResponse([TEXT_CHUNK])) as unknown as typeof fetch
    const engine = new AgentEngine({
      settingsPath: join(tmp, 'settings.json'),
      userDataPath: tmp,
      memoryPath: join(tmp, 'memory.json'),
      tracePath: join(tmp, 'trace.jsonl'),
      netFetch,
      loadSettings: () => ({
        providers: [{ id: 'p1', name: 'D', type: 'OpenAI Compatible', apiKey: 'k', baseUrl: 'http://x/v1', models: ['m1'], selectedModel: 'm1' }],
        general: { workDir: tmp },
      }),
      loadIshiki: () => '',
      sendEvent: ev => events.push(ev as { type: string }),
      getSender: () => null,
    })

    engine.start({ sid: 's2', taskId: 't2', content: '\u4f60\u597d', userMsgId: 'u2', userMsgTimestamp: Date.now(), history: [] })

    const done = await waitFor(events, 'task-done')
    expect(done).toBe(true)
    expect(events.some(e => e.type === 'final' && String(e.content || '').includes('\u4efb\u52a1\u5b8c\u6210'))).toBe(true)
  }, 20000)

  it('计划确认门: 先出计划等批准, 批准后才执行工具', async () => {
    const events: { type: string; status?: string; steps?: unknown[] }[] = []
    let call = 0
    const netFetch = vi.fn(async () => {
      call++
      return sseResponse(call === 1 ? [TOOL_CHUNK] : [TEXT_CHUNK])
    }) as unknown as typeof fetch
    const engine = new AgentEngine({
      settingsPath: join(tmp, 'settings.json'),
      userDataPath: tmp,
      memoryPath: join(tmp, 'memory.json'),
      tracePath: join(tmp, 'trace.jsonl'),
      netFetch,
      loadSettings: () => ({
        providers: [{ id: 'p1', name: 'D', type: 'OpenAI Compatible', apiKey: 'k', baseUrl: 'http://x/v1', models: ['m1'], selectedModel: 'm1' }],
        general: { workDir: tmp, maxToolRounds: 50, planGate: true },
      }),
      loadIshiki: () => '',
      sendEvent: ev => events.push(ev as { type: string }),
      getSender: () => null,
    })

    engine.start({ sid: 's3', taskId: 't3', content: '\u7528\u5de5\u5177\u67e5\u770b', userMsgId: 'u3', userMsgTimestamp: Date.now(), history: [] })

    const planned = await waitFor(events, 'plan')
    expect(planned).toBe(true)
    expect(events.some(e => e.type === 'step')).toBe(false)
    engine.approve('s3')
    const done = await waitFor(events, 'task-done')
    expect(done).toBe(true)
    expect(events.some(e => e.type === 'step')).toBe(true)
  }, 20000)

  it('计划确认门: 拒绝后任务中止', async () => {
    const events: { type: string; status?: string }[] = []
    const netFetch = vi.fn(async () => sseResponse([TOOL_CHUNK])) as unknown as typeof fetch
    const engine = new AgentEngine({
      settingsPath: join(tmp, 'settings.json'),
      userDataPath: tmp,
      memoryPath: join(tmp, 'memory.json'),
      tracePath: join(tmp, 'trace.jsonl'),
      netFetch,
      loadSettings: () => ({
        providers: [{ id: 'p1', name: 'D', type: 'OpenAI Compatible', apiKey: 'k', baseUrl: 'http://x/v1', models: ['m1'], selectedModel: 'm1' }],
        general: { workDir: tmp, maxToolRounds: 50, planGate: true },
      }),
      loadIshiki: () => '',
      sendEvent: ev => events.push(ev as { type: string }),
      getSender: () => null,
    })

    engine.start({ sid: 's4', taskId: 't4', content: '\u7528\u5de5\u5177\u67e5\u770b', userMsgId: 'u4', userMsgTimestamp: Date.now(), history: [] })

    const planned = await waitFor(events, 'plan')
    expect(planned).toBe(true)
    engine.reject('s4')
    const done = await waitFor(events, 'task-done')
    expect(done).toBe(true)
    const ev = events.find(e => e.type === 'task-done')
    expect(ev?.status).toBe('aborted')
  }, 20000)

  it('项目指令(AGENTS.md)按目录链注入系统提示', async () => {
    fs.writeFileSync(join(tmp, 'AGENTS.md'), '只准用 PowerShell 命令', 'utf-8')
    const events: { type: string }[] = []
    const bodies: string[] = []
    const netFetch = vi.fn(async (_u: unknown, init?: { body?: string }) => {
      bodies.push(String(init?.body || ''))
      return sseResponse([TEXT_CHUNK])
    }) as unknown as typeof fetch
    const engine = new AgentEngine({
      settingsPath: join(tmp, 'settings.json'),
      userDataPath: tmp,
      memoryPath: join(tmp, 'memory.json'),
      tracePath: join(tmp, 'trace.jsonl'),
      netFetch,
      loadSettings: () => ({
        providers: [{ id: 'p1', name: 'D', type: 'OpenAI Compatible', apiKey: 'k', baseUrl: 'http://x/v1', models: ['m1'], selectedModel: 'm1' }],
        general: { workDir: tmp, maxToolRounds: 50 },
      }),
      loadIshiki: () => '',
      sendEvent: ev => events.push(ev as { type: string }),
      getSender: () => null,
    })

    engine.start({ sid: 's5', taskId: 't5', content: '\u4f60\u597d', userMsgId: 'u5', userMsgTimestamp: Date.now(), history: [] })
    const done = await waitFor(events, 'task-done')
    expect(done).toBe(true)
    expect(bodies.some(b => b.includes('项目约定') && b.includes('只准用 PowerShell 命令'))).toBe(true)
    fs.rmSync(join(tmp, 'AGENTS.md'), { force: true })
  }, 20000)

  it('重复 update_plan 不产生一模一样的两条步骤', async () => {
    const events: { type: string; steps?: { id: string; label: string; status?: string }[] }[] = []
    let call = 0
    const netFetch = vi.fn(async () => {
      call++
      return sseResponse(call === 1 ? [updateChunk('u1')] : call === 2 ? [updateChunk('u2')] : [TEXT_CHUNK])
    }) as unknown as typeof fetch
    const engine = new AgentEngine({
      settingsPath: join(tmp, 'settings.json'),
      userDataPath: tmp,
      memoryPath: join(tmp, 'memory.json'),
      tracePath: join(tmp, 'trace.jsonl'),
      netFetch,
      loadSettings: () => ({
        providers: [{ id: 'p1', name: 'D', type: 'OpenAI Compatible', apiKey: 'k', baseUrl: 'http://x/v1', models: ['m1'], selectedModel: 'm1' }],
        general: { workDir: tmp, maxToolRounds: 50 },
      }),
      loadIshiki: () => '',
      sendEvent: ev => events.push(ev as { type: string }),
      getSender: () => null,
    })

    engine.start({ sid: 's6', taskId: 't6', content: '\u89c4\u5212\u4e00\u4e0b', userMsgId: 'u6', userMsgTimestamp: Date.now(), history: [] })
    const done = await waitFor(events, 'task-done')
    expect(done).toBe(true)
    const lastPlan = [...events].reverse().find(e => e.type === 'plan-update')
    const steps = lastPlan?.steps || []
    expect(steps.length).toBe(2)
    expect(new Set(steps.map(s => s.label)).size).toBe(2)
    const twoStep = events.find(e => e.type === 'plan-update' && (e.steps?.length || 0) === 2)
    expect(twoStep).toBeTruthy()
    expect(twoStep!.steps!.every(s => s.status === 'pending')).toBe(true)
  }, 20000)
})
