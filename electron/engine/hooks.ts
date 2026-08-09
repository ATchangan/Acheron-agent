// electron/engine/hooks.ts — 事件钩子(Hooks): 工具调用前后/任务启停/文件写入时执行自定义命令
import { exec } from 'child_process'
import type { EngineSettings } from './types'
import { getPowerShellCmd } from '../shared/pwsh'

export type HookEvent = 'tool-before' | 'tool-after' | 'task-start' | 'task-end' | 'file-write'
const HOOK_EVENTS: HookEvent[] = ['tool-before', 'tool-after', 'task-start', 'task-end', 'file-write']

// 解析 hooksText: 每行 "事件=命令", # 开头为注释
export function parseHooksText(text: string | undefined): Partial<Record<HookEvent, string[]>> {
  const out: Partial<Record<HookEvent, string[]>> = {}
  if (!text || !String(text).trim()) return out
  for (const line of String(text).split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const ev = t.slice(0, eq).trim() as HookEvent
    const cmd = t.slice(eq + 1).trim()
    if (!HOOK_EVENTS.includes(ev) || !cmd) continue
    ;(out[ev] = out[ev] || []).push(cmd)
  }
  return out
}

export function runHooks(g: EngineSettings, event: HookEvent, vars: Record<string, string> = {}): void {
  const hooks = parseHooksText(g.hooksText)
  const cmds = hooks[event]
  if (!cmds || !cmds.length) return
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HQ_EVENT: event }
  for (const [k, v] of Object.entries(vars)) env['HQ_' + k.toUpperCase()] = String(v)
  // v0.3.8: 同一事件多条命令串行执行(按配置顺序), 全程不阻塞主流程; 单条 10s 超时
  void (async () => {
    for (const raw of cmds) {
      // 含中文路径/输出的命令自动走 PowerShell(UTF-8), 与 exec_command 同源策略, 避免 cmd 乱码;
      // 用户已显式写 powershell/pwsh 前缀或纯 ASCII 命令保持原样
      const trimmed = raw.trim()
      const cmd = /[^\x00-\x7F]/.test(raw) && !/^(powershell|pwsh)\b/i.test(trimmed)
        ? getPowerShellCmd() + ' -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + raw.replace(/"/g, '\\"') + '"'
        : raw
      await new Promise<void>(resolve => {
        try {
          exec(cmd, { timeout: 10000, windowsHide: true, env, maxBuffer: 1024 * 1024 }, err => {
            if (err) console.debug('[hooks] ' + event + ' -> ' + err.message)
            resolve()
          })
        } catch { resolve() }
      })
    }
  })()
}
