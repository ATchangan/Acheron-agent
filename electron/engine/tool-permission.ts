// electron/engine/tool-permission.ts — 文件权限检查纯函数(分发器与终端 handler 共用)
import type { ToolRunCtx } from './tool-types'

function normPath(p: string): string {
  const norm = String(p || '').replace(/\\/g, '/')
  const isAbs = /^[a-zA-Z]:\//.test(norm) || norm.startsWith('/')
  const parts: string[] = []
  for (const seg of norm.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return (isAbs ? '/' : '') + parts.join('/')
}

export function checkFilePermission(name: string, args: Record<string, unknown>, ctx: ToolRunCtx): string | null {
  const perm = ctx.g.filePermission || 'full'
  if (perm === 'full') return null
  const wd = ctx.workDir || ''
  const p = String(args.path || args.dirPath || '')
  if (perm === 'sandbox' && wd && p) {
    const rp = normPath(p).toLowerCase()
    const rw = normPath(wd).toLowerCase()
    if (!(rp === rw || (rw && rp.startsWith(rw + '/')))) return 'E:permission denied (sandbox): path outside work directory'
  }
  if (perm === 'readonly' && ['write', 'edit', 'apply_patch', 'mkdir', 'exec_command', 'codebox'].includes(name)) return 'E:permission denied (readonly): ' + name + ' not allowed'
  if (perm === 'ask' && ['write', 'edit', 'apply_patch', 'mkdir', 'exec_command', 'codebox'].includes(name)) return 'E:permission denied (ask): ' + name + ' requires manual confirmation. Use settings to change permission level.'
  return null
}
