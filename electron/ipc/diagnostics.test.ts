import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { ipcMain } from 'electron'
import { registerDiagnosticsIpc, runEnvironmentCheck, type DiagDeps } from './diagnostics'

function makeDeps(over: Partial<DiagDeps> = {}): DiagDeps {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-diag-'))
  const settings = join(dir, 'settings.json')
  fs.writeFileSync(settings, JSON.stringify({
    providers: [{ id: 'p1', name: 'D', apiKey: 'k', baseUrl: 'http://x/v1', models: ['m1'], selectedModel: 'm1' }],
    general: { workDir: dir, rendererMode: 'auto' },
  }), 'utf-8')
  return {
    settingsPath: settings,
    userDataPath: dir,
    getWorkDir: () => dir,
    netFetch: async () => new Response('ok', { status: 200 }) as unknown as Response,
    getServerPort: () => 1,
    ...over,
  }
}

describe('环境自检 diagnostics:check', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('健康环境返回全部检查项且核心项通过', async () => {
    const items = await runEnvironmentCheck(makeDeps())
    const names = items.map(i => i.name)
    for (const expectName of ['PowerShell 7', 'Windows PowerShell', 'cmd', '工作目录', '用户数据目录', '会话目录', '回滚目录', 'API 供应商', '供应商网络', '磁盘空间', '内存', '技能', '插件', '浏览器内核', '渲染模式', 'Git', 'MCP 服务器', '本地服务', '运行环境']) {
      expect(names).toContain(expectName)
    }
    expect(new Set(names).size).toBe(names.length)
    expect(items.filter(i => i.status === 'ok').length).toBeGreaterThanOrEqual(15)
    expect(items.find(i => i.name === 'API 供应商')?.status).toBe('ok')
    expect(items.find(i => i.name === '工作目录')?.status).toBe('ok')
  })

  it('未配置供应商时 API 供应商/供应商网络报异常', async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-diag-'))
    const settings = join(dir, 'settings.json')
    fs.writeFileSync(settings, JSON.stringify({ providers: [], general: {} }), 'utf-8')
    const items = await runEnvironmentCheck(makeDeps({ settingsPath: settings, getWorkDir: () => join(dir, 'missing') }))
    expect(items.find(i => i.name === 'API 供应商')?.status).toBe('fail')
    expect(items.find(i => i.name === '工作目录')?.status).toBe('fail')
    expect(items.find(i => i.name === '供应商网络')?.status).toBe('warn')
  })

  it('registerDiagnosticsIpc 注册 diagnostics:check', () => {
    const handlers: Record<string, unknown> = {}
    vi.mocked(ipcMain.handle).mockImplementation(((ch: string, fn: unknown) => { handlers[ch] = fn }) as never)
    registerDiagnosticsIpc(makeDeps())
    expect(handlers['diagnostics:check']).toBeTypeOf('function')
  })
})
