import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as os from 'os'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('./risk-confirm', () => ({ requestRiskConfirm: vi.fn(async () => 'allow' as const), RISK_CONFIRM_TIMEOUT_MS: 100 }))

import { ipcMain } from 'electron'
import { registerComputerIpc } from './computer'

const handlers: Record<string, (e: unknown, ...args: unknown[]) => unknown> = {}

function setup() {
  handlers['computer:exec'] = () => 'unset'
  vi.mocked(ipcMain.handle).mockImplementation(((channel: string, listener: (e: unknown, ...args: unknown[]) => unknown) => {
    handlers[channel] = listener
  }) as never)
  registerComputerIpc({
    assertInsideWorkDir: () => true,
    assessRisk: (e: { command?: string }) => /del|taskkill|format c:|shutdown|diskpart|bcdedit|rmdir|rd \/s/i.test(String(e?.command || '')) ? 'L4' : 'L1',
    getEffectiveWorkDir: () => os.tmpdir(),
    getWorkDirOverride: () => null,
    setWorkDirOverride: () => { /* noop */ },
    netFetch: fetch,
    workspaceDir: os.tmpdir(),
    userDataPath: os.tmpdir(),
  })
}

async function runExec(cmd: string): Promise<string> {
  const handler = handlers['computer:exec']
  return String(await handler({}, cmd))
}

describe('computer:exec shell 分流', () => {
  beforeEach(() => { setup() })

  it('含中文命令走 PowerShell, 中文输出不乱码', async () => {
    const out = await runExec('echo \u4e2d\u6587\u8def\u5f84\u6d4b\u8bd5')
    expect(out).toContain('\u4e2d\u6587\u8def\u5f84\u6d4b\u8bd5')
  }, 30000)

  it('纯 ASCII 简单命令走 cmd', async () => {
    const out = await runExec('echo hello')
    expect(out).toContain('hello')
  }, 30000)

  it('PowerShell 语法命令正常执行', async () => {
    const out = await runExec('Write-Output "PS_OK_123"')
    expect(out).toContain('PS_OK_123')
  }, 30000)
})

describe('computer:exec 危险命令拦截', () => {
  beforeEach(() => { setup() })

  it('拦截危险删除命令', async () => {
    const out = await runExec('del /f /s /q C:\\Windows\\temp')
    expect(out).toContain('危险命令已被拦截')
  })

  it('大小写/反斜杠变体同样拦截', async () => {
    const out = await runExec('dEl /F /S /Q C:\\\\Windows\\\\temp')
    expect(out).toContain('危险命令已被拦截')
  })

  it('taskkill 变体拦截', async () => {
    const out = await runExec('taskkill //f //im explorer.exe')
    expect(out).toContain('危险命令已被拦截')
  })

  it('Format-Table 等正常 PowerShell 命令不被误拦', async () => {
    const out = await runExec('Get-ChildItem C:\\Windows | Select-Object Name | Format-Table')
    expect(out).not.toContain('危险命令')
  }, 30000)

  it('cmd 输出按 GBK 解码, 不出现替换字符乱码', async () => {
    const out = await runExec('dir C:\\Windows')
    expect(out.length).toBeGreaterThan(0)
    expect(out).not.toContain('\uFFFD')
  }, 30000)

  it('正常命令不误拦', async () => {
    const out = await runExec('echo safe command')
    expect(out).not.toContain('危险命令已被拦截')
  })
})
