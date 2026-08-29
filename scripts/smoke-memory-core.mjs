// scripts/smoke-memory-core.mjs — MemoryCore 网关冒烟测试(验证后可删)
// 用与生产完全一致的方式拉起: ELECTRON_RUN_AS_NODE=1 + vendor 目录 + TDAI_GATEWAY_CONFIG
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const vendorDir = join(ROOT, 'vendor', 'memory-core')
const electronExe = join(vendorDir, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe')
const dataDir = mkdtempSync(join(tmpdir(), 'hq-mem-smoke-'))
const yamlPath = join(dataDir, 'gw.yaml')
const PORT = 8421

writeFileSync(yamlPath, [
  'deployMode: standalone',
  'stateBackend: "local"',
  'server:',
  `  port: ${PORT}`,
  '  host: "127.0.0.1"',
  'data:',
  `  baseDir: ${JSON.stringify(join(dataDir, 'data'))}`,
  'llm:',
  '  baseUrl: "https://api.openai.com/v1"',
  '  apiKey: "${TDAI_LLM_API_KEY}"',
  '  model: "gpt-4o-mini"',
  'memory:',
  '  capture: { enabled: true }',
  '  extraction: { enabled: false }',
  '  recall: { enabled: true, maxResults: 5, strategy: "hybrid" }',
  '  storeBackend: "sqlite"',
  '  embedding: { provider: "none" }',
  '  bm25: { enabled: true, language: "zh" }',
  'skill:',
  '  enabled: true',
].join('\n'))

const child = spawn(electronExe, ['--import', 'tsx', join('src', 'gateway', 'server.ts')], {
  cwd: vendorDir,
  windowsHide: true,
  stdio: 'ignore',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TDAI_GATEWAY_CONFIG: yamlPath, TDAI_LLM_API_KEY: '', TDAI_SKILL_ENABLED: '1' },
})

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function ping() {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1500) }); return r.ok } catch { return false }
}

let healthy = false
for (let i = 0; i < 40; i++) { if (await ping()) { healthy = true; break } await sleep(800) }
console.log('health:', healthy ? 'OK' : 'FAIL')
if (healthy) {
  const cap = await fetch(`http://127.0.0.1:${PORT}/capture`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_content: '我们团队的发布流程约定: 先跑 npm test 再提交', assistant_content: '好的, 已记住这条发布约定。', session_key: 'smoke-1' }),
  }).then(r => r.json()).catch(e => ({ err: String(e) }))
  console.log('capture:', JSON.stringify(cap).slice(0, 120))
  const search = await fetch(`http://127.0.0.1:${PORT}/search/memories`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '发布流程约定' }),
  }).then(r => r.json()).catch(e => ({ err: String(e) }))
  console.log('search/memories:', JSON.stringify(search).slice(0, 160))
  const conv = await fetch(`http://127.0.0.1:${PORT}/search/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '发布约定' }),
  }).then(r => r.json()).catch(e => ({ err: String(e) }))
  console.log('search/conversations total:', conv?.total ?? JSON.stringify(conv).slice(0, 100))
}

child.kill()
await sleep(500)
try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
process.exit(healthy ? 0 : 1)
