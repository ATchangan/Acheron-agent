// electron/memory-core.ts — MemoryCore 网关 sidecar(拉起/健康检查/停止) + 轻量 HTTP 客户端
// 新记忆系统(v0.4.5): 记忆内核为 vendor/memory-core 的 MemoryCore 网关(本地 SQLite, 端口 8420)。
// 引擎在任务开始时调用 /recall 注入相关记忆; 任务结束调用 /capture 上报本轮对话(L0 → 服务端异步归纳 L1/L2/L3);
// 模型可用工具 memory_search / conversation_search / skill_search 走 /search/* 与 /v3/skill/search。
// 数据目录指向应用 userData(不用 C 盘默认 ~/.memory-tencentdb); LLM 配置经环境变量注入(key 不落盘)。
import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import { join } from 'path'
import { ipcMain } from 'electron'

export function registerMemoryCoreIpc(): void {
  ipcMain.handle('memory:status', () => getMemoryCoreStatus())
}

export interface MemoryCoreLlmConfig { baseUrl: string; apiKey: string; model: string }

export interface MemoryCoreStartOpts {
  enabled: boolean
  /** memory-core 运行目录(含 src/ node_modules/ package.json) */
  vendorDir: string
  /** 数据目录(userData 下), 记忆 SQLite 与 skill 资源都写在这里 */
  dataDir: string
  port: number
  llm: MemoryCoreLlmConfig
  onStatus?: (status: MemoryCoreStatus, detail?: string) => void
}

export type MemoryCoreStatus = 'disabled' | 'starting' | 'ready' | 'failed' | 'stopped' | 'external'

let child: ChildProcess | null = null
let stopping = false
let status: MemoryCoreStatus = 'stopped'
let baseUrl = ''
let statusDetail = ''

export function getMemoryCoreStatus(): { status: MemoryCoreStatus; baseUrl: string; detail: string } {
  return { status, baseUrl, detail: statusDetail }
}

export function getMemoryCoreBaseUrl(): string { return status === 'ready' || status === 'external' ? baseUrl : '' }

function setStatus(s: MemoryCoreStatus, detail = ''): void {
  status = s
  statusDetail = detail
}

// ─── 健康检查 ───────────────────────────────────────
async function ping(port: number, timeoutMs = 1200): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch { return false }
}

// ─── 生成网关配置(key 不写入: LLM 凭证只经环境变量注入) ──
function writeGatewayConfig(dataDir: string, port: number): string {
  try { fs.mkdirSync(dataDir, { recursive: true }) } catch { /* 目录已存在 */ }
  const yaml = [
    'deployMode: standalone',
    'stateBackend: "local"',
    'server:',
    `  port: ${port}`,
    '  host: "127.0.0.1"',
    'data:',
    `  baseDir: ${JSON.stringify(join(dataDir, 'data'))}`,
    'llm:',
    '  baseUrl: "https://api.openai.com/v1"',
    '  apiKey: "${TDAI_LLM_API_KEY}"',
    '  model: "gpt-4o-mini"',
    'memory:',
    '  capture:',
    '    enabled: true',
    '  extraction:',
    '    enabled: true',
    '    enableDedup: true',
    '  recall:',
    '    enabled: true',
    '    maxResults: 5',
    '    strategy: "hybrid"',
    '  storeBackend: "sqlite"',
    '  embedding:',
    '    provider: "none"',
    '  bm25:',
    '    enabled: true',
    '    language: "zh"',
    'skill:',
    '  enabled: true',
    '  routing:',
    '    mode: "bm25"',
    '    searchTopK: 20',
    '  extraction:',
    '    enabled: true',
  ].join('\n')
  const p = join(dataDir, 'tdai-gateway.yaml')
  fs.writeFileSync(p, yaml, 'utf-8')
  return p
}

/** 拉起 MemoryCore 网关。已就绪(含外部已启动实例)则直接复用。非阻塞: 完成后回调 onStatus。 */
export function startMemoryCore(opts: MemoryCoreStartOpts): void {
  const { enabled, vendorDir, dataDir, port, llm, onStatus } = opts
  if (!enabled) { setStatus('disabled', '已在设置中关闭'); onStatus?.(status, statusDetail); return }
  baseUrl = `http://127.0.0.1:${port}`

  // 已有实例在跑(上次异常退出残留/用户手动启动) → 复用
  void ping(port).then(ok => {
    if (ok) { setStatus('external', '检测到已运行的网关, 直接复用'); onStatus?.(status, statusDetail); return }
    // 入口检查: dev 有源码; 打包后由 electron-builder extraResources 带出
    const entry = join(vendorDir, 'src', 'gateway', 'server.ts')
    const tsxLoader = join(vendorDir, 'node_modules', 'tsx')
    if (!fs.existsSync(entry) || !fs.existsSync(tsxLoader)) {
      setStatus('failed', 'memory-core 资源缺失: ' + vendorDir)
      onStatus?.(status, statusDetail)
      return
    }
    const yamlPath = writeGatewayConfig(dataDir, port)
    setStatus('starting', '正在启动网关…')
    onStatus?.(status, statusDetail)
    try {
      // ELECTRON_RUN_AS_NODE=1: 用 Electron 自带 Node 跑 sidecar, 打包后不依赖系统 node
      child = spawn(process.execPath, ['--import', 'tsx', entry], {
        cwd: vendorDir,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          TDAI_GATEWAY_CONFIG: yamlPath,
          TDAI_LLM_BASE_URL: llm.baseUrl,
          TDAI_LLM_API_KEY: llm.apiKey,
          TDAI_LLM_MODEL: llm.model,
          TDAI_SKILL_ENABLED: '1',
        },
      })
    } catch (e) {
      setStatus('failed', e instanceof Error ? e.message : String(e))
      onStatus?.(status, statusDetail)
      return
    }
    child.on('exit', () => {
      child = null
      if (!stopping) { setStatus('failed', '网关进程异常退出'); onStatus?.(status, statusDetail) }
    })
    // 健康轮询: 最多等 40s(BM25 分词器冷启动较慢)
    const t0 = Date.now()
    const poll = async (): Promise<void> => {
      if (stopping) return
      if (await ping(port)) { setStatus('ready'); onStatus?.(status, statusDetail); return }
      if (Date.now() - t0 > 40_000) { setStatus('failed', '健康检查超时'); onStatus?.(status, statusDetail); return }
      setTimeout(() => { void poll() }, 800)
    }
    setTimeout(() => { void poll() }, 1500)
  })
}

export function stopMemoryCore(): void {
  stopping = true
  if (child) {
    try { child.kill() } catch { /* 忽略 */ }
    child = null
  }
  setStatus('stopped')
}

// ─── 引擎侧 HTTP 客户端(全部安全降级: 失败返回空, 不阻塞任务) ──
async function post<T>(baseUrl: string, path: string, body: unknown, timeoutMs: number, extraHeaders?: Record<string, string>): Promise<T | null> {
  try {
    const r = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) return null
    return await r.json() as T
  } catch { return null }
}

/** 任务开始召回: L1 相关记忆 + L3 画像 → 拼成注入文本(网关 /recall 已聚合) */
export async function memRecall(baseUrl: string, query: string, sessionKey: string): Promise<string> {
  const r = await post<{ context?: string; memory_count?: number }>(baseUrl, '/recall', { query, session_key: sessionKey }, 4000)
  return (r?.context || '').trim()
}

/** 任务结束捕获: 本轮用户/助手内容 → L0(服务端异步抽取归纳) */
export async function memCapture(baseUrl: string, userContent: string, assistantContent: string, sessionKey: string): Promise<void> {
  await post(baseUrl, '/capture', { user_content: userContent, assistant_content: assistantContent, session_key: sessionKey }, 8000)
}

/** L1 记忆检索(模型工具 memory_search) */
export async function memSearchMemories(baseUrl: string, query: string, limit = 5): Promise<string> {
  const r = await post<{ results?: string; total?: number }>(baseUrl, '/search/memories', { query, limit }, 6000)
  const text = (r?.results || '').trim()
  return text || '(无相关记忆)'
}

/** L0 对话检索(模型工具 conversation_search) */
export async function memSearchConversations(baseUrl: string, query: string, limit = 5): Promise<string> {
  const r = await post<{ results?: string; total?: number }>(baseUrl, '/search/conversations', { query, limit }, 6000)
  const text = (r?.results || '').trim()
  return text || '(无相关对话)'
}

/** Skill 检索(模型工具 skill_search, 走 /v3/skill/search) */
export async function memSkillSearch(baseUrl: string, query: string, topK = 5): Promise<string> {
  type SkillItem = { name?: string; description?: string; snippet?: string; score?: number }
  const r = await post<{ code?: number; data?: { items?: SkillItem[] } }>(baseUrl, '/v3/skill/search', { query, top_k: topK, mode: 'bm25' }, 6000)
  const items = r?.data?.items || []
  if (!items.length) return '(无相关技能)'
  return items.map((s, i) => `${i + 1}. ${s.name || '(未命名)'} — ${s.description || ''}${s.snippet ? '\n   ' + s.snippet.slice(0, 200) : ''}`).join('\n')
}
