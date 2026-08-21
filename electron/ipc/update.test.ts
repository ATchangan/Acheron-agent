// electron/ipc/update.test.ts — 下载流式写入/断点续传/SHA256 校验(纯逻辑, 不依赖 Electron)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as http from 'http'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { downloadToFile } from './update'

const tmp = fs.mkdtempSync(join(os.tmpdir(), 'hq-upd-test-'))
const content = Buffer.from('0123456789abcdef'.repeat(64)) // 1024 bytes
const sha = createHash('sha256').update(content).digest('hex')

let server: http.Server
let url = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d+)-/.exec(range)
      if (m) {
        const start = Number(m[1])
        if (start >= content.length) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + content.length })
          res.end()
          return
        }
        const slice = content.subarray(start)
        res.writeHead(206, { 'Content-Range': 'bytes ' + start + '-' + (content.length - 1) + '/' + content.length, 'Content-Length': slice.length })
        res.end(slice)
        return
      }
    }
    res.writeHead(200, { 'Content-Length': content.length })
    res.end(content)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  url = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/file'
})

afterAll(() => {
  server.close()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

describe('downloadToFile', () => {
  it('完整下载 + SHA256 校验通过', async () => {
    const dest = join(tmp, 'a.bin')
    const r = await downloadToFile({ netFetch: fetch, url, dest, expectedSha256: sha })
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(dest).equals(content)).toBe(true)
  })

  it('校验失败丢弃成品与断点文件', async () => {
    const dest = join(tmp, 'b.bin')
    const r = await downloadToFile({ netFetch: fetch, url, dest, expectedSha256: '0'.repeat(64) })
    expect(r.ok).toBe(false)
    expect(fs.existsSync(dest)).toBe(false)
    expect(fs.existsSync(dest + '.part')).toBe(false)
  })

  it('预置半份 .part 后通过 Range 206 续传完成', async () => {
    const dest = join(tmp, 'c.bin')
    fs.writeFileSync(dest + '.part', content.subarray(0, 512))
    const r = await downloadToFile({ netFetch: fetch, url, dest, expectedSha256: sha })
    expect(r.ok).toBe(true)
    expect(r.size).toBe(content.length)
    expect(fs.readFileSync(dest).equals(content)).toBe(true)
  })
})
