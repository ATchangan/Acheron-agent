// electron/shared/pwsh.ts —— PowerShell 可执行文件检测(全引擎共用)
// 优先级: 1) PATH 中的 pwsh(需真实可启动) 2) 已知安装路径的 pwsh(Program Files\PowerShell\7 等, 覆盖绿色版/非 PATH 安装)
//         3) Windows PowerShell; pwsh 必须真实可启动才算可用, 损坏/别名失效视为未安装
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export interface PowerShellInfo {
  exe: string       // 实际可执行名或完整路径(可能含空格)
  isPwsh: boolean
}

// 覆盖常见非 PATH 安装位置: MSI/Winget 的 7 与 7-preview
export function knownPowerShell7Paths(): string[] {
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  return [
    join(pf, 'PowerShell', '7', 'pwsh.exe'),
    join(pf, 'PowerShell', '7-preview', 'pwsh.exe'),
  ]
}

export function probePowerShell(exe: string): boolean {
  try {
    execSync('"' + exe + '" -NoProfile -NonInteractive -Command "exit 0"', { windowsHide: true, stdio: 'pipe', timeout: 4000 })
    return true
  } catch { return false }
}

// 纯决策函数(可注入以便单测覆盖各安装场景)
export function resolvePowerShell(
  probe: (exe: string) => boolean = probePowerShell,
  knownPaths: string[] = knownPowerShell7Paths(),
  exists: (p: string) => boolean = existsSync,
): PowerShellInfo {
  if (probe('pwsh')) return { exe: 'pwsh', isPwsh: true }
  for (const p of knownPaths) {
    if (p && exists(p) && probe(p)) return { exe: p, isPwsh: true }
  }
  return { exe: 'powershell', isPwsh: false }
}

let cached: PowerShellInfo | null = null

export function resetPowerShellDetection(): void { cached = null }

export function getPowerShellInfo(): PowerShellInfo {
  if (!cached) cached = resolvePowerShell()
  return cached
}

export function getPowerShellCmd(): string {
  return getPowerShellInfo().exe
}

export function getPowerShellIsPwsh(): boolean {
  return getPowerShellInfo().isPwsh
}

// 嵌入 cmd 命令行时使用: 完整路径含空格自动加引号
export function quotePowerShellExe(exe: string): string {
  return exe.includes(' ') ? '"' + exe + '"' : exe
}

export function getPowerShellCmdQuoted(): string {
  return quotePowerShellExe(getPowerShellCmd())
}
