// electron/mcp/auto.test.ts — MCP 配置读取/默认值回归
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { readMcpConfig } from './auto'

function writeSettings(general: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-mcp-cfg-'))
  const p = join(dir, 'settings.json')
  fs.writeFileSync(p, JSON.stringify({ general }), 'utf-8')
  return p
}

describe('readMcpConfig', () => {
  it('解析服务器列表/开关/超时(秒→毫秒, 夹在 2-120s)', () => {
    const p = writeSettings({
      mcpServers: [
        { name: 'a', type: 'stdio', command: 'node', args: ['x.js'] },
        { name: 'b', type: 'sse', url: 'http://localhost:8080/sse' },
      ],
      mcpAutoConnectOnStart: true,
      mcpAutoReconnect: false,
      mcpTimeout: 20,
    })
    const cfg = readMcpConfig(p)
    expect(cfg.servers).toHaveLength(2)
    expect(cfg.autoConnect).toBe(true)
    expect(cfg.autoReconnect).toBe(false)
    expect(cfg.timeoutMs).toBe(20000)
  })

  it('缺省与损坏设置回落安全默认', () => {
    expect(readMcpConfig(join(os.tmpdir(), 'not-exists-settings.json'))).toEqual({ servers: [], autoConnect: false, autoReconnect: true, timeoutMs: 15000 })
    const bad = fs.mkdtempSync(join(os.tmpdir(), 'hq-mcp-bad-'))
    const p = join(bad, 'settings.json')
    fs.writeFileSync(p, '{bad json', 'utf-8')
    expect(readMcpConfig(p).servers).toEqual([])
  })
})
