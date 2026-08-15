// electron/plugins/plugin-policy.test.ts — 父进程侧能力裁决 + 同进程兜底链路单测
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { handleHostCall, isInsideWorkDir, type PluginPolicyEnv } from './plugin-policy'
import { runPluginInMain } from './host-core'
import { assessRisk, isMutatingCommand } from '../security/permission'

function makeEnv(over: Partial<PluginPolicyEnv> = {}): { env: PluginPolicyEnv; calls: string[]; files: Map<string, string> } {
  const workDir = fs.mkdtempSync(join(os.tmpdir(), 'hq-policy-'))
  const calls: string[] = []
  const files = new Map<string, string>()
  const env: PluginPolicyEnv = {
    workDir,
    isDangerous: cmd => assessRisk({ type: 'terminal', command: cmd }) === 'L4',
    isMutating: isMutatingCommand,
    confirmCommand: async (cmd: string) => { calls.push('confirm:' + cmd); return over.confirmCommand ? over.confirmCommand(cmd) : 'allow' },
    runCommand: async (cmd: string) => { calls.push('run:' + cmd); return over.runCommand ? over.runCommand(cmd) : 'CMD_OK' },
    readFile: p => { calls.push('read:' + p); const v = files.get(p); if (v === undefined) throw new Error('no file'); return v },
    writeFile: (p, c) => { calls.push('write:' + p); files.set(p, c) },
  }
  return { env, calls, files }
}

describe('isInsideWorkDir', () => {
  it('工作目录内放行, 目录外拒绝', () => {
    expect(isInsideWorkDir('D:\\work\\a.txt', 'D:\\work')).toBe(true)
    expect(isInsideWorkDir('D:\\work', 'D:\\work')).toBe(true)
    expect(isInsideWorkDir('D:\\else\\a.txt', 'D:\\work')).toBe(false)
  })
})

describe('handleHostCall', () => {
  it('read/write 仅限工作目录', async () => {
    const { env, files, calls } = makeEnv()
    files.set(join(env.workDir, 'a.txt'), 'hello')
    expect(await handleHostCall('read', { path: join(env.workDir, 'a.txt') }, env)).toBe('hello')
    expect(await handleHostCall('read', { path: join(os.tmpdir(), 'secret.txt') }, env)).toContain('仅允许读取')
    expect(await handleHostCall('write', { path: join(env.workDir, 'b.txt'), content: 'x' }, env)).toBe('ok')
    expect(files.get(join(env.workDir, 'b.txt'))).toBe('x')
    expect(await handleHostCall('write', { path: join(os.tmpdir(), 'b.txt'), content: 'x' }, env)).toContain('仅允许写入')
    expect(calls.some(c => c.startsWith('write:'))).toBe(true)
  })

  it('危险命令直接拦截, 只读命令不确认, 变更命令确认后执行', async () => {
    const { env, calls } = makeEnv()
    expect(await handleHostCall('exec_command', { cmd: 'rm -rf /' }, env)).toContain('危险命令')
    expect(calls.some(c => c.startsWith('confirm:'))).toBe(false)
    expect(await handleHostCall('exec_command', { cmd: 'dir' }, env)).toBe('CMD_OK')
    expect(calls.some(c => c.startsWith('confirm:'))).toBe(false)
    expect(await handleHostCall('exec_command', { cmd: 'git push origin main' }, env)).toBe('CMD_OK')
    expect(calls).toContain('confirm:git push origin main')
  })

  it('变更命令被拒绝时不执行', async () => {
    const { env, calls } = makeEnv({ confirmCommand: async () => 'deny' })
    expect(await handleHostCall('exec_command', { cmd: 'git push' }, env)).toContain('拒绝')
    expect(calls.some(c => c.startsWith('run:'))).toBe(false)
  })
})

describe('runPluginInMain 兜底链路', () => {
  it('宿主 + 策略端到端: 插件经桥接读写文件', async () => {
    const { env } = makeEnv()
    const code = `module.exports = { tools: [{ name: 't', description: 'd', params: {}, run: async (a, c) => { await c.tools.run('write', { path: a.path, content: 'ok' }); return await c.tools.run('read', { path: a.path }) } }] }`
    const d = await runPluginInMain(
      { code, tool: 't', args: { path: join(env.workDir, 'out.txt') } },
      (name, args) => handleHostCall(name, args, env),
    )
    expect(d.ok).toBe(true)
    expect(d.result).toBe('ok')
  })
})
