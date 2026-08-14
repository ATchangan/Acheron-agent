// Electron↔Unity 桌宠桥接回归测试
// 用法: node scripts/pet-unity-bridge-test.mjs
// 校验: 拉起 HuangquanPet.exe → WS 握手 → ready → 下发形态切换/动作/聊天 → 校验回包与 Player.log
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const exe = join(ROOT, 'pet-unity', 'HuangquanPet', 'HuangquanPet.exe')
const vrmNormal = join(ROOT, 'pet', 'models', 'vrm', 'index.vrm')
const vrmUltimate = join(ROOT, 'pet', 'models', 'vrm', 'ultimate.vrm')
const playerLog = join(process.env.USERPROFILE || '', 'AppData', 'LocalLow', 'ATchangan', 'HuangquanPet', 'Player.log')

if (!existsSync(exe)) {
  console.error('FAIL: HuangquanPet.exe 不存在，请先构建')
  process.exit(1)
}

const token = randomBytes(8).toString('hex')
const events = []
let pet = null
let socket = null

const server = createServer()
const wss = new WebSocketServer({ server, host: '127.0.0.1' })
const send = obj => {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(obj) + '\n')
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (url.searchParams.get('token') !== token) {
    ws.close(1008, 'bad token')
    return
  }
  socket = ws
  ws.on('message', raw => {
    for (const line of raw.toString('utf-8').split('\n')) {
      const text = line.trim()
      if (!text) continue
      try { events.push(JSON.parse(text)) } catch { /* ignore */ }
    }
  })
})

const timeout = setTimeout(() => {
  console.error('FAIL: 桥接测试超时')
  console.error('收到的事件:', JSON.stringify(events.slice(0, 20), null, 2))
  cleanup(1)
}, 60000)

function cleanup(code) {
  clearTimeout(timeout)
  try { socket?.close() } catch {}
  try { pet?.kill() } catch {}
  try { wss.close() } catch {}
  try { server.close() } catch {}
  process.exit(code)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  const connect = `ws://127.0.0.1:${port}?token=${token}`
  pet = spawn(exe, ['-force-d3d11-bitblt-model', '-connect', connect, '-vrm', vrmNormal, '-vrm-ultimate', vrmUltimate], {
    windowsHide: true,
    stdio: 'ignore',
  })
  pet.on('exit', code => {
    if (!process.exitCode) console.log(`[pet exit code=${code}]`)
  })

  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    if (events.some(e => e.type === 'event' && e.payload?.event === 'ready')) break
    await sleep(500)
  }
  if (!events.some(e => e.type === 'event' && e.payload?.event === 'ready')) {
    console.error('FAIL: 未收到 ready')
    cleanup(1)
    return
  }
  console.log('PASS: 收到 ready')

  send({ type: 'config', payload: { form: 'ultimate', scale: 1.15, topmost: true } })
  send({ type: 'action', payload: { action: 'dance1' } })
  await sleep(3500)
  const ack = events.find(e => e.type === 'event' && e.payload?.event === 'action-ack')
  if (!ack) {
    console.error('FAIL: 未收到 action-ack')
    cleanup(1)
    return
  }
  console.log('PASS: action-ack', JSON.stringify(ack.payload))

  send({ type: 'chat', payload: { text: '你好，黄泉', streaming: true, delta: '测试' } })
  await sleep(800)

  let switched = false
  if (existsSync(playerLog)) {
    const log = readFileSync(playerLog, 'utf-8')
    switched = /已载入 ultimate/.test(log)
  }
  console.log(switched ? 'PASS: Player.log 显示 ultimate 已载入' : 'FAIL: Player.log 未见 ultimate 载入')
  console.log('PASS: 桥接测试完成')
  cleanup(switched ? 0 : 1)
})
