// electron/llm/vision.test.ts — 命令切分/一次性命令/健康检查(v0.4.0 定稿安全加固)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as http from 'http'
import { splitCommand, runCommand, healthCheck } from './vision'

describe('splitCommand 命令切分', () => {
  it('按空格切分并尊重引号, 空命令返回空数组', () => {
    expect(splitCommand('node -e "console.log(1)"')).toEqual(['node', '-e', 'console.log(1)'])
    expect(splitCommand("echo 'a b' c")).toEqual(['echo', 'a b', 'c'])
    expect(splitCommand('   ')).toEqual([])
  })
})

describe('runCommand 一次性命令', () => {
  it('退出码 0 判定成功, 非 0 判定失败', async () => {
    expect(await runCommand('node -e "process.exit(0)"', 10000)).toBe(true)
    expect(await runCommand('node -e "process.exit(2)"', 10000)).toBe(false)
  })
})

let server: http.Server

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"data":[]}')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
})

afterAll(() => server.close())

describe('healthCheck 健康检查', () => {
  it('服务 200 判定健康, 端口非法直接失败', async () => {
    const port = (server.address() as { port: number }).port
    expect(await healthCheck(fetch, port, 2, 100)).toBe(true)
    expect(await healthCheck(fetch, 0, 1, 10)).toBe(false)
    expect(await healthCheck(fetch, 99999, 1, 10)).toBe(false)
  })
})
