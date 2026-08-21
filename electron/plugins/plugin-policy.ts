// electron/plugins/plugin-policy.ts — 插件能力裁决(父进程侧, 纯函数可单测)
// 子进程宿主不持有 fs/命令/确认能力: 所有特权操作经跨进程 call 消息回到父进程, 由本模块统一裁决,
// 保证插件无论跑在 utilityProcess 还是同进程 vm 兜底, 权限边界完全一致。
export interface PluginPolicyEnv {
  workDir: string
  isDangerous: (cmd: string) => boolean
  isMutating: (cmd: string) => boolean
  confirmCommand: (cmd: string) => Promise<'allow' | 'deny'>
  runCommand: (cmd: string) => Promise<string>
  readFile: (p: string) => string
  writeFile: (p: string, content: string) => void
}

export function isInsideWorkDir(p: string, workDir: string): boolean {
  try {
    if (!workDir) return false
    const { resolve, sep } = require('path')
    const rp = resolve(p)
    const rw = resolve(workDir)
    return rp === rw || rp.startsWith(rw + sep)
  } catch { return false }
}

export async function handleHostCall(name: string, args: Record<string, unknown>, env: PluginPolicyEnv): Promise<string> {
  const n = String(name || '')
  if (n === 'read') {
    const p = String((args as { path?: unknown }).path || '')
    if (!isInsideWorkDir(p, env.workDir)) return 'E:仅允许读取工作目录内的文件'
    try { return env.readFile(p).slice(0, 8000) } catch (e: unknown) { return 'E:' + (e instanceof Error ? e.message : String(e)) }
  }
  if (n === 'write') {
    const p = String((args as { path?: unknown }).path || '')
    if (!isInsideWorkDir(p, env.workDir)) return 'E:仅允许写入工作目录内的文件'
    try { env.writeFile(p, String((args as { content?: unknown }).content ?? '')); return 'ok' } catch (e: unknown) { return 'E:' + (e instanceof Error ? e.message : String(e)) }
  }
  if (n === 'exec_command') {
    const cmd = String((args as { cmd?: unknown }).cmd || '')
    if (env.isDangerous(cmd)) return 'E:permission denied: 危险命令已被拦截'
    if (env.isMutating(cmd)) {
      const d = await env.confirmCommand(cmd)
      if (d !== 'allow') return 'E:permission denied: 用户拒绝了插件命令确认(或确认超时)'
    }
    try { return await env.runCommand(cmd) } catch (e: unknown) { return 'E:' + (e instanceof Error ? e.message : String(e)) }
  }
  return 'E:未知工具: ' + n
}
