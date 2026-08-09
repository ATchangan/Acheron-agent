import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { parseHooksText, runHooks } from './hooks'

function waitForFile(p: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise(resolve => {
    const t0 = Date.now()
    const timer = setInterval(() => {
      try {
        if (fs.existsSync(p) && fs.statSync(p).size > 0) { clearInterval(timer); resolve(true); return }
      } catch { /* 继续等 */ }
      if (Date.now() - t0 > timeoutMs) { clearInterval(timer); resolve(false) }
    }, 50)
  })
}

describe('hooks 事件钩子', () => {
  it('parseHooksText 按行解析事件=命令, 忽略注释/空行/非法事件', () => {
    const out = parseHooksText(
      '# 注释\n' +
      '\n' +
      'tool-before=echo before\n' +
      'tool-before=echo before2\n' +
      'task-start=echo start\n' +
      'bad-event=oops\n' +
      '=no-event\n'
    )
    expect(out['tool-before']).toEqual(['echo before', 'echo before2'])
    expect(out['task-start']).toEqual(['echo start'])
    const anyOut = out as Record<string, string[] | undefined>
    expect(anyOut['bad-event']).toBeUndefined()
    expect(anyOut['']).toBeUndefined()
    expect(parseHooksText('')).toEqual({})
    expect(parseHooksText(undefined)).toEqual({})
  })

  it('runHooks 执行命令并注入 HQ_ 环境变量', async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-hooks-'))
    const out = join(dir, 'out.txt')
    try {
      const cmd = `powershell -NoProfile -Command "Set-Content -LiteralPath '${out}' -Value ($env:HQ_EVENT + '|' + $env:HQ_TOOL)"`
      runHooks({ hooksText: 'tool-before=' + cmd } as never, 'tool-before', { tool: 'read' })
      expect(await waitForFile(out)).toBe(true)
      expect(fs.readFileSync(out, 'utf-8').trim()).toBe('tool-before|read')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 15000)

  it('含中文路径的命令自动走 PowerShell(UTF-8), 无需手动加前缀', async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-hooks-中文-'))
    const out = join(dir, 'out.txt')
    try {
      const cmd = `Set-Content -LiteralPath '${out}' -Value ($env:HQ_EVENT + '|' + $env:HQ_TOOL)`
      runHooks({ hooksText: 'tool-after=' + cmd } as never, 'tool-after', { tool: 'apply_patch' })
      expect(await waitForFile(out)).toBe(true)
      expect(fs.readFileSync(out, 'utf-8').trim()).toBe('tool-after|apply_patch')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 15000)

  it('未配置对应事件时不执行任何命令', () => {
    expect(() => runHooks({ hooksText: 'task-start=echo hi' } as never, 'tool-after', { tool: 'read' })).not.toThrow()
    expect(() => runHooks({ hooksText: undefined } as never, 'task-start', {})).not.toThrow()
  })
})
