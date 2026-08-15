// electron/llm/vision.ts — 本地视觉推理服务自动切换(v0.4.0 M6, 0.4.0 定稿安全加固)
// 命令/模型/端口全部来自 settings(localVision), 代码不写死任何服务;
// 命令不经 shell 直接 spawn(参数按引号切分), 服务进程登记在册并在退出时回收。
import { spawn, type ChildProcess } from 'child_process'

export interface LocalVisionCfg {
  enabled?: boolean
  loadCommand?: string
  serverCommand?: string
  port?: number
  model?: string
}

// 简单命令切分: 尊重单/双引号, 不经过 shell(避免 &&、管道、重定向等注入)
export function splitCommand(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (const ch of String(cmd || '')) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = '' }
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out.filter(Boolean)
}

const serverProcesses = new Set<ChildProcess>()

export function stopLocalVisionProcesses(): void {
  for (const proc of [...serverProcesses]) {
    try { proc.kill() } catch { /* 忽略 */ }
    serverProcesses.delete(proc)
  }
}

export function runCommand(cmd: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const parts = splitCommand(cmd)
    if (!parts.length) { resolve(false); return }
    let proc: ChildProcess
    try {
      proc = spawn(parts[0], parts.slice(1), { windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      try { proc.kill() } catch { /* 忽略 */ }
      resolve(false)
    }, timeoutMs)
    proc.on('error', () => { clearTimeout(timer); resolve(false) })
    proc.on('close', (code: number | null) => {
      clearTimeout(timer)
      // 长驻服务命令不会退出, 这里只对"加载/一次性命令"判 0; 服务命令由健康检查确认
      resolve(code === 0 || code === null)
    })
  })
}

function buildUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  return /\/v\d+$/i.test(b) ? b + path : b + '/v1' + path
}

export async function healthCheck(netFetch: typeof fetch, port: number, retries = 3, intervalMs = 2000): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false
  for (let i = 0; i < retries; i++) {
    try {
      const res = await netFetch('http://127.0.0.1:' + port + '/v1/models', { signal: AbortSignal.timeout(8000) })
      if (res.ok) return true
    } catch { /* 重试 */ }
    if (i < retries - 1) await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

export async function localVisionOnce(netFetch: typeof fetch, cfg: LocalVisionCfg, imageDataUrl: string, prompt: string): Promise<string | null> {
  if (!cfg.enabled || !cfg.port || !cfg.model) return null
  try {
    const base = 'http://127.0.0.1:' + cfg.port
    const res = await netFetch(buildUrl(base, '/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 800,
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt || '请描述这张图片的内容' },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ] }],
      }),
      signal: AbortSignal.timeout(180000),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => ({})) as { choices?: { message?: { content?: unknown } }[] }
    const text = data.choices?.[0]?.message?.content
    return typeof text === 'string' && text.trim() ? text.trim() : null
  } catch { return null }
}

interface Pending { netFetch: typeof fetch; cfg: LocalVisionCfg; imageDataUrl: string; prompt: string; resolve: (r: string | null) => void }

let busy = false
const queue: Pending[] = []

// 本地视觉任务队列: 并发 1, 排队 ≤2(超出直接返回 null 走云)
export function enqueueLocalVision(netFetch: typeof fetch, cfg: LocalVisionCfg, imageDataUrl: string, prompt: string): Promise<string | null> {
  if (!cfg.enabled) return Promise.resolve(null)
  return new Promise<string | null>(resolve => {
    if (queue.length >= 2) { resolve(null); return }
    queue.push({ netFetch, cfg, imageDataUrl, prompt, resolve })
    void pump()
  })
}

async function pump(): Promise<void> {
  if (busy) return
  const next = queue.shift()
  if (!next) return
  busy = true
  try {
    // 加载模型(120s) → 启动服务(30s) → 健康检查 → 推理; 失败返回 null
    if (next.cfg.loadCommand) {
      const ok = await runCommand(next.cfg.loadCommand, 120000)
      if (!ok) { next.resolve(null); return }
    }
    if (next.cfg.serverCommand) {
      // 服务命令长驻: 无 shell 后台启动并登记, 应用退出时统一回收
      const parts = splitCommand(next.cfg.serverCommand)
      if (!parts.length) { next.resolve(null); return }
      try {
        const proc = spawn(parts[0], parts.slice(1), { windowsHide: true, detached: true, stdio: 'ignore' })
        serverProcesses.add(proc)
        proc.on('exit', () => serverProcesses.delete(proc))
        proc.on('error', () => serverProcesses.delete(proc))
        proc.unref?.()
      } catch { /* 启动失败由健康检查判定 */ }
      await new Promise(r => setTimeout(r, 3000))
    }
    const healthy = await healthCheck(next.netFetch, next.cfg.port as number)
    if (!healthy) { next.resolve(null); return }
    const result = await localVisionOnce(next.netFetch, next.cfg, next.imageDataUrl, next.prompt)
    next.resolve(result)
  } catch {
    next.resolve(null)
  } finally {
    busy = false
    void pump()
  }
}
