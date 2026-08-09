import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
  Notification: class { show() { /* noop */ } },
}))

vi.mock('./registry', () => ({
  invokeHandler: vi.fn(async (channel: string, args: unknown[]) => {
    switch (channel) {
      case 'computer:readFile': return fs.readFileSync(String(args[0]), 'utf-8')
      case 'computer:writeFile': fs.writeFileSync(String(args[0]), String(args[1]), 'utf-8'); return true
      case 'computer:readDir': return [{ name: 'a.txt', isDirectory: false, size: 3 }]
      case 'computer:exec': return 'ok'
      case 'computer:mkdir': return { ok: true }
      default: return 'E:handler-not-found:' + channel
    }
  }),
}))

import { runTool } from './tools'
import type { ToolRunCtx } from './tool-types'

function makeCtx(over: Partial<ToolRunCtx> = {}): ToolRunCtx {
  const memory = { facts: [], pinnedFacts: [], goals: [], episodic: [], summaries: [] }
  return {
    sid: 's1',
    taskId: 't1',
    g: { filePermission: 'full' },
    agents: {},
    activeAgents: ['main'],
    workDir: os.tmpdir(),
    memoryPath: '',
    userDataPath: '',
    getMemory: () => memory,
    saveMemory: () => { /* noop */ },
    onAgentChange: () => { /* noop */ },
    runDispatch: async () => 'ok',
    logTrace: () => { /* noop */ },
    ...over,
  }
}

describe('runTool 分发器', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('未知工具返回 E:unknown', async () => {
    expect(await runTool('nope', {}, makeCtx())).toBe('E:unknown:nope')
  })

  it('read 走 handler 并返回内容', async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-tool-'))
    const f = join(dir, 'a.txt')
    fs.writeFileSync(f, 'hello', 'utf-8')
    try {
      expect(await runTool('read', { path: f }, makeCtx())).toBe('hello')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('只读工具二次调用命中缓存', async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-tool-'))
    const f = join(dir, 'a.txt')
    fs.writeFileSync(f, 'hello', 'utf-8')
    try {
      const first = await runTool('read', { path: f }, makeCtx())
      const second = await runTool('read', { path: f }, makeCtx())
      expect(first).toBe('hello')
      expect(second).toBe('hello [cache]')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('write 后 read 缓存失效', async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-tool-'))
    const f = join(dir, 'a.txt')
    fs.writeFileSync(f, 'v1', 'utf-8')
    try {
      await runTool('read', { path: f }, makeCtx())
      expect(await runTool('write', { path: f, content: 'v2' }, makeCtx())).toContain('(2 chars)')
      expect(fs.readFileSync(f, 'utf-8')).toBe('v2')
      expect(await runTool('read', { path: f }, makeCtx())).toBe('v2')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('readonly 权限拒绝写类工具', async () => {
    const ctx = makeCtx({ g: { filePermission: 'readonly' } })
    expect(await runTool('write', { path: '/x', content: '1' }, ctx)).toContain('permission denied')
    expect(await runTool('exec_command', { cmd: 'dir' }, ctx)).toContain('permission denied')
    expect(await runTool('read', { path: '/x' }, ctx)).not.toContain('permission denied')
  })

  it('toolPerms deny 拒绝工具', async () => {
    const ctx = makeCtx({ g: { toolPerms: { read: 'deny' } } })
    expect(await runTool('read', { path: '/x' }, ctx)).toContain('已被禁止')
  })

  it('受限角色白名单: 拒绝未授权工具, 放行 update_plan/read_skill', async () => {
    const ctx = makeCtx({ agent: 'worker', agents: { worker: { name: 'w', icon: '', role: 'r', prompt: 'p', tools: ['read'] } as never } })
    expect(await runTool('write', { path: '/x', content: '1' }, ctx)).toContain('权限不足')
    expect(await runTool('update_plan', { steps: [{ label: 'x' }] }, ctx)).not.toContain('权限不足')
    expect(await runTool('read_skill', { name: 'nope' }, ctx)).not.toContain('权限不足')
  })

  it('apply_patch 多 hunk 编辑真实文件', async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-tool-'))
    const f = join(dir, 'a.txt')
    fs.writeFileSync(f, 'a\nb\nc\n', 'utf-8')
    try {
      const r = await runTool('apply_patch', { path: f, hunks: [{ oldText: 'a', newText: 'A' }, { oldText: 'c', newText: 'C' }] }, makeCtx())
      expect(r).toContain('patched 2 hunks')
      expect(fs.readFileSync(f, 'utf-8')).toBe('A\nb\nC\n')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('git 工具: 合法 action 转发 computer:exec, 非法 action 拒绝', async () => {
    const ctx = makeCtx()
    expect(await runTool('git', { action: 'status' }, ctx)).toBe('ok')
    expect(await runTool('git', { action: 'commit', args: '-am "msg"' }, ctx)).toBe('ok')
    const { invokeHandler } = await import('./registry')
    const calls = vi.mocked(invokeHandler).mock.calls.filter(c => c[0] === 'computer:exec')
    expect(calls.some(c => String(c[1]?.[0]) === 'git status')).toBe(true)
    expect(calls.some(c => String(c[1]?.[0]) === 'git commit -am "msg"')).toBe(true)
    expect(await runTool('git', { action: 'reset' }, ctx)).toContain('E:action 仅支持')
    expect(await runTool('git', {}, ctx)).toContain('E:action 仅支持')
  })

  it('git 只读动作不清空读缓存, 写动作清空', async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-tool-'))
    const f = join(dir, 'a.txt')
    fs.writeFileSync(f, 'v1', 'utf-8')
    try {
      const ctx = makeCtx()
      expect(await runTool('read', { path: f }, ctx)).toBe('v1')
      expect(await runTool('git', { action: 'status' }, ctx)).toBe('ok')
      expect(await runTool('read', { path: f }, ctx)).toBe('v1 [cache]')
      expect(await runTool('git', { action: 'commit', args: '-am x' }, ctx)).toBe('ok')
      expect(await runTool('read', { path: f }, ctx)).toBe('v1')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('init_project_docs 生成 AGENTS.md 草稿且不覆盖已有文件', async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-tool-'))
    try {
      const ctx = makeCtx({ workDir: dir })
      const r = await runTool('init_project_docs', {}, ctx)
      expect(r).toContain('AGENTS.md')
      expect(r).toContain('已生成')
      expect(fs.existsSync(join(dir, 'AGENTS.md'))).toBe(true)
      const r2 = await runTool('init_project_docs', {}, ctx)
      expect(r2).toContain('E:AGENTS.md 已存在')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
